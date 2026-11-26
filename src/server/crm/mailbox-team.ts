import { z } from 'zod';
import { inboxTeamStatuses } from '@/contracts/mailbox-team';
import type { InboxAssignee, InboxTeam, InboxTeamNote, InboxTeamPatch, InboxTeamStatus, SavedReply, SavedReplyInput } from '@/contracts/mailbox-team';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { json, readBody } from '../http';
import { activeMailboxUser, canReadMailbox } from '../mailbox-access';
import { route } from '../routes/shared';

const queryThread = z.string().min(1).max(1024);
const uuid = z.uuid();
const patchInput = z.object({ status: z.enum(inboxTeamStatuses).optional(), assigneeId: uuid.nullable().optional() })
  .refine(input => input.status !== undefined || input.assigneeId !== undefined, 'Choose a status or assignee.');
const plainText = (max: number) => z.string().trim().min(1).max(max).refine(value => !value.includes('\0'), 'Remove unsupported characters.');
const noteInput = z.object({ body: plainText(4000) });
const replyInput = z.object({ title: plainText(100), body: plainText(5000) });
const maxBodyBytes = 32 * 1024;

type ThreadRef = [mailboxId: string, threadKey: string, viewerId: string];
const threadRef = (query: URLSearchParams, viewerId: string): ThreadRef =>
  [uuid.parse(query.get('mailboxId')), queryThread.parse(query.get('threadId')), viewerId];

// Keep the same composite thread identity as inbox reads, including legacy messages without a provider thread ID.
const visibleThread = `SELECT m.id AS mailbox_id, m.user_id AS owner_id FROM crm_mailboxes m
  WHERE m.id = $1 AND ${canReadMailbox('m.id', '$3')} AND EXISTS (
    SELECT 1 FROM crm_mailbox_messages mm
    WHERE mm.mailbox_id = m.id AND coalesce(nullif(mm.thread_id, ''), mm.provider_message_id) = $2
  )`;

const missingThread = () => new AppError(404, 'That conversation was not found.');
type NoteRow = { id: string; author_name: string | null; body: string; created_at: Date | string };
const toNote = (row: NoteRow): InboxTeamNote =>
  ({ id: row.id, authorName: row.author_name ?? 'Former teammate', body: row.body, createdAt: new Date(row.created_at).toISOString() });

type TeamRow = {
  owner_id: string; status: InboxTeamStatus; assignee_id: string | null; assignee_name: string | null;
  assignment_options: InboxAssignee[]; notes: NoteRow[];
};

async function readTeam(ref: ThreadRef, client: Sql = db): Promise<InboxTeam> {
  const { rows: [team] } = await client.query<TeamRow>(
    `SELECT v.owner_id, coalesce(t.status, 'open') AS status, assignee.id AS assignee_id, assignee.name AS assignee_name,
       CASE WHEN v.owner_id = $3 THEN (
         SELECT coalesce(jsonb_agg(jsonb_build_object('id', member.id, 'name', member.name) ORDER BY lower(member.name), member.id), '[]'::jsonb)
         FROM users member WHERE ${activeMailboxUser('member')} AND (
           member.id = v.owner_id OR EXISTS (SELECT 1 FROM crm_mailbox_members mm WHERE mm.mailbox_id = v.mailbox_id AND mm.user_id = member.id)
         )
       ) ELSE '[]'::jsonb END AS assignment_options,
       (SELECT coalesce(jsonb_agg(recent ORDER BY recent.created_at, recent.id), '[]'::jsonb) FROM (
         SELECT n.id, author.name AS author_name, n.body, n.created_at FROM crm_mailbox_thread_notes n
         LEFT JOIN users author ON author.id = n.author_id
         WHERE n.mailbox_id = v.mailbox_id AND n.thread_key = $2
         ORDER BY n.created_at DESC, n.id DESC LIMIT 100
       ) recent) AS notes
     FROM (${visibleThread}) v
     LEFT JOIN crm_mailbox_thread_team t ON t.mailbox_id = v.mailbox_id AND t.thread_key = $2
     LEFT JOIN users assignee ON assignee.id = t.assignee_id AND ${canReadMailbox('v.mailbox_id', 'assignee.id')}`, ref,
  );
  if (!team) throw missingThread();
  const canAssign = team.owner_id === ref[2];
  return {
    status: team.status,
    assignee: team.assignee_id && team.assignee_name !== null ? { id: team.assignee_id, name: team.assignee_name } : null,
    canAssign,
    canChangeStatus: canAssign || team.assignee_id === ref[2],
    assignmentOptions: team.assignment_options,
    notes: team.notes.map(toNote),
  };
}

async function updateTeam(ref: ThreadRef, input: InboxTeamPatch) {
  const [mailboxId, threadKey, viewerId] = ref;
  return transaction(async client => {
    // Membership edits take the same mailbox lock. Check access in a fresh statement after locking it.
    await client.query('SELECT id FROM crm_mailboxes WHERE id = $1 FOR UPDATE', [mailboxId]);
    const { rows: [current] } = await client.query<{ owner_id: string; status: InboxTeamStatus; assignee_id: string | null }>(
      `SELECT v.owner_id, coalesce(t.status, 'open') AS status, t.assignee_id
       FROM (${visibleThread}) v LEFT JOIN crm_mailbox_thread_team t ON t.mailbox_id = v.mailbox_id AND t.thread_key = $2`, ref,
    );
    if (!current) throw missingThread();
    const isOwner = current.owner_id === viewerId;
    if (input.assigneeId !== undefined && !isOwner) throw new AppError(403, 'Only the mailbox owner can assign conversations.');
    if (input.status && !isOwner && current.assignee_id !== viewerId) throw new AppError(403, 'Only the mailbox owner or assignee can change the status.');
    if (input.assigneeId) {
      const candidate = await client.query(`SELECT id FROM users candidate
        WHERE id = $2 AND ${canReadMailbox('$1', 'candidate.id')} FOR SHARE`, [mailboxId, input.assigneeId]);
      if (!candidate.rowCount) throw new AppError(400, 'Choose an active mailbox owner or member.');
    }
    const assigneeId = input.assigneeId === undefined ? current.assignee_id : input.assigneeId;
    await client.query(`INSERT INTO crm_mailbox_thread_team (mailbox_id, thread_key, status, assignee_id)
      VALUES ($1, $2, $3, $4) ON CONFLICT (mailbox_id, thread_key) DO UPDATE SET
      status = excluded.status, assignee_id = excluded.assignee_id, updated_at = now()`,
    [mailboxId, threadKey, input.status ?? current.status, assigneeId]);
    return readTeam(ref, client);
  });
}

async function addNote(ref: ThreadRef, body: string) {
  const { rows: [note] } = await db.query<NoteRow>(
    `WITH written AS (
       INSERT INTO crm_mailbox_thread_notes (mailbox_id, thread_key, author_id, body)
       SELECT v.mailbox_id, $2::text, $3::uuid, $4::text FROM (${visibleThread}) v
       RETURNING id, author_id, body, created_at
     ) SELECT written.*, author.name AS author_name FROM written JOIN users author ON author.id = written.author_id`, [...ref, body],
  );
  if (!note) throw missingThread();
  return toNote(note);
}

type SavedReplyRow = SavedReplyInput & { id: string; updated_at: Date };
const toReply = (row: SavedReplyRow): SavedReply => ({ id: row.id, title: row.title, body: row.body, updatedAt: new Date(row.updated_at).toISOString() });
const missingReply = () => new AppError(404, 'That saved reply was not found.');

export const inboxTeamEndpoints = [
  route('GET', /^sales\/inbox\/team$/, async ({ query, user }) => readTeam(threadRef(query, user.id)), 'marketer'),
  route('PATCH', /^sales\/inbox\/team$/, async ({ request, query, user }) =>
    updateTeam(threadRef(query, user.id), await readBody(request, patchInput, 4096)), 'marketer'),
  route('POST', /^sales\/inbox\/notes$/, async ({ request, query, user }) => {
    const input = await readBody(request, noteInput, maxBodyBytes);
    return json(await addNote(threadRef(query, user.id), input.body), 201);
  }, 'marketer'),
  route('GET', /^sales\/inbox\/saved-replies$/, async ({ user }) => {
    const { rows } = await db.query<SavedReplyRow>(
      'SELECT id, title, body, updated_at FROM crm_mailbox_saved_replies WHERE user_id = $1 ORDER BY lower(title), id', [user.id],
    );
    return { items: rows.map(toReply) };
  }, 'marketer'),
  route('POST', /^sales\/inbox\/saved-replies$/, async ({ request, user }) => {
    const input = await readBody(request, replyInput, maxBodyBytes);
    const { rows: [saved] } = await db.query<SavedReplyRow>(
      'INSERT INTO crm_mailbox_saved_replies (user_id, title, body) VALUES ($1, $2, $3) RETURNING id, title, body, updated_at',
      [user.id, input.title, input.body],
    );
    return json(toReply(saved), 201);
  }, 'marketer'),
  route('PATCH', /^sales\/inbox\/saved-replies\/([0-9a-f-]{36})$/, async ({ request, params, user }) => {
    const input = await readBody(request, replyInput, maxBodyBytes);
    const { rows: [saved] } = await db.query<SavedReplyRow>(
      `UPDATE crm_mailbox_saved_replies SET title = $3, body = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING id, title, body, updated_at`,
      [uuid.parse(params[0]), user.id, input.title, input.body],
    );
    if (!saved) throw missingReply();
    return toReply(saved);
  }, 'marketer'),
  route('DELETE', /^sales\/inbox\/saved-replies\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const removed = await db.query('DELETE FROM crm_mailbox_saved_replies WHERE id = $1 AND user_id = $2', [uuid.parse(params[0]), user.id]);
    if (!removed.rowCount) throw missingReply();
    return new Response(null, { status: 204 });
  }, 'marketer'),
];
