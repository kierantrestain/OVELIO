import { z } from 'zod';
import type { InboxConversation, InboxThread, InboxThreadMessage, InboxThreadSummary } from '@/contracts/crm';
import { inboxTeamStatuses } from '@/contracts/mailbox-team';
import { AppError } from '../config';
import { db } from '../db';
import { getContacts } from '../directory';
import { readBody } from '../http';
import { canReadMailbox, mailboxRecordVisible } from '../mailbox-access';
import { route } from '../routes/shared';
import { csvResponse, uuid } from './shared';

type ConversationRow = {
  contact_id: string; subject: string; body: string; direction: InboxConversation['direction'];
  at: Date; count: string; source: InboxConversation['source']; email: string | null;
};

async function inbox(viewerId: string, query: string): Promise<InboxConversation[]> {
  const { rows } = await db.query<ConversationRow>(
    `WITH items AS (
       SELECT a.contact_id, a.subject, a.body, a.direction, a.occurred_at AS at,
         CASE WHEN a.mailbox_id IS NOT NULL THEN 'mailbox' ELSE 'logged' END AS source, m.to_email AS email,
         a.id
       FROM activities a LEFT JOIN messages m ON m.id = a.message_id
       WHERE a.type = 'email' AND a.contact_id IS NOT NULL AND ${mailboxRecordVisible('a.mailbox_id', '$1')}
       UNION ALL
       SELECT m.contact_id, m.subject, m.status_reason, 'outbound', m.created_at,
         CASE WHEN m.mailbox_id IS NULL THEN 'sent' ELSE 'mailbox' END, m.to_email, m.id
       FROM messages m
       WHERE m.category = 'sales' AND m.contact_id IS NOT NULL AND ${mailboxRecordVisible('m.mailbox_id', '$1')}
         AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.message_id = m.id)
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY contact_id ORDER BY at DESC, id DESC) AS n,
         count(*) OVER (PARTITION BY contact_id) AS count
       FROM items WHERE strpos(lower(concat_ws(' ', subject, body, email)), lower($2)) > 0
     )
     SELECT contact_id, subject, body, direction, at, count, source, email FROM ranked WHERE n = 1 ORDER BY at DESC, id DESC LIMIT 100`,
    [viewerId, query],
  );
  const contacts = await getContacts(rows.map(row => Number(row.contact_id)));
  return rows.map(row => {
    const contactId = Number(row.contact_id);
    const contact = contacts.get(contactId);
    return {
      contactId, contactName: contact?.name ?? row.email ?? 'Unknown contact', contactEmail: contact?.email ?? row.email ?? '',
      subject: row.subject, snippet: row.body.slice(0, 200), direction: row.direction, at: new Date(row.at).toISOString(),
      count: Number(row.count), source: row.source,
    };
  });
}

// Some historical messages have no provider thread. Treat each as a standalone conversation.
const threadKey = "coalesce(nullif(mm.thread_id, ''), mm.provider_message_id)";

type ThreadMessageRow = {
  provider_message_id: string; contact_id: string | null; subject: string; snippet: string;
  from_email: string; to_emails: string; direction: InboxThreadMessage['direction']; occurred_at: Date;
};

type ReplyRow = {
  provider_message_id: string; thread_id: string; contact_id: string; from_email: string; subject: string;
};

const newestInbound = "mm.direction = 'inbound' AND mm.contact_id IS NOT NULL AND mm.from_email <> '' AND mm.thread_id <> ''";

function toThreadMessage(row: ThreadMessageRow): InboxThreadMessage {
  return {
    id: row.provider_message_id, contactId: row.contact_id == null ? null : Number(row.contact_id),
    subject: row.subject, snippet: row.snippet, fromEmail: row.from_email, toEmails: row.to_emails,
    direction: row.direction, at: new Date(row.occurred_at).toISOString(),
  };
}

const threadFilter = z.object({
  status: z.enum(inboxTeamStatuses).nullable(),
  assignment: z.enum(['mine', 'unassigned']).nullable(),
});

async function listThreads(viewerId: string, query: string, unreadOnly: boolean, filters: z.infer<typeof threadFilter>): Promise<InboxThreadSummary[]> {
  const { rows } = await db.query<ThreadMessageRow & {
    mailbox_id: string; mailbox_email: string; thread_key: string; count: string; unread: boolean;
    status: InboxThreadSummary['status']; assignee_name: string | null;
  }>(
    `WITH ranked AS (
       SELECT mm.*, m.email AS mailbox_email, ${threadKey} AS thread_key,
         row_number() OVER (thread ORDER BY mm.occurred_at DESC, mm.provider_message_id DESC) AS n,
         count(*) OVER thread AS count,
         bool_or(mm.direction = 'inbound' AND mm.ingest_order > coalesce(r.read_through, 0)) OVER thread AS unread,
         bool_or(strpos(lower(concat_ws(' ', mm.subject, mm.snippet, mm.from_email, mm.to_emails)), lower($2)) > 0) OVER thread AS matches
       FROM crm_mailbox_messages mm JOIN crm_mailboxes m ON m.id = mm.mailbox_id
       LEFT JOIN crm_mailbox_thread_reads r ON r.mailbox_id = mm.mailbox_id AND r.thread_key = ${threadKey} AND r.user_id = $1
       WHERE ${canReadMailbox('mm.mailbox_id', '$1')}
       WINDOW thread AS (PARTITION BY mm.mailbox_id, ${threadKey})
     )
     SELECT r.*, coalesce(t.status, 'open') AS status, assigned.name AS assignee_name
     FROM ranked r LEFT JOIN crm_mailbox_thread_team t ON t.mailbox_id = r.mailbox_id AND t.thread_key = r.thread_key
     LEFT JOIN users assigned ON assigned.id = t.assignee_id AND ${canReadMailbox('r.mailbox_id', 'assigned.id')}
     WHERE n = 1 AND matches AND (NOT $3 OR unread)
       AND ($4::text IS NULL OR coalesce(t.status, 'open') = $4)
       AND ($5::text IS NULL OR ($5 = 'mine' AND assigned.id = $1) OR ($5 = 'unassigned' AND assigned.id IS NULL))
     ORDER BY r.occurred_at DESC, r.mailbox_id, r.provider_message_id DESC LIMIT 100`,
    [viewerId, query, unreadOnly, filters.status, filters.assignment]);
  return rows.map(row => ({
    ...toThreadMessage(row), mailboxId: row.mailbox_id, mailboxEmail: row.mailbox_email, threadId: row.thread_key, count: Number(row.count),
    unread: row.unread, status: row.status, assigneeName: row.assignee_name,
  }));
}

async function readThread(viewerId: string, mailboxId: string, threadId: string): Promise<InboxThread> {
  const { rows } = await db.query<ThreadMessageRow & { read_version: string; unread: boolean; can_reply: boolean }>(
    `SELECT mm.*, coalesce(max(mm.ingest_order) FILTER (WHERE mm.direction = 'inbound') OVER (), 0)::text AS read_version,
       bool_or(mm.direction = 'inbound' AND mm.ingest_order > coalesce(r.read_through, 0)) OVER () AS unread,
       (m.user_id = $3 AND bool_or(${newestInbound}) OVER ()) AS can_reply
     FROM crm_mailbox_messages mm JOIN crm_mailboxes m ON m.id = mm.mailbox_id
     LEFT JOIN crm_mailbox_thread_reads r ON r.mailbox_id = mm.mailbox_id AND r.thread_key = ${threadKey} AND r.user_id = $3
     WHERE mm.mailbox_id = $1 AND ${threadKey} = $2 AND ${canReadMailbox('mm.mailbox_id', '$3')}
     ORDER BY mm.occurred_at DESC, mm.provider_message_id DESC LIMIT 250`, [mailboxId, threadId, viewerId]);
  if (!rows.length) throw new AppError(404, 'That conversation was not found.');
  const { read_version: readVersion, unread, can_reply: canReply } = rows[0];
  return { mailboxId, threadId, readVersion, unread, canReply, messages: rows.reverse().map(toThreadMessage) };
}

const readInput = z.object({
  read: z.boolean(),
  through: z.string().refine(value => /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n).optional(),
});

async function markThread(viewerId: string, mailboxId: string, threadId: string, input: z.infer<typeof readInput>) {
  const { rows: [state] } = await db.query<{ unread: boolean }>(
    `WITH visible AS (
       SELECT $1::uuid AS mailbox_id, $2::text AS thread_key,
         coalesce(max(mm.ingest_order) FILTER (WHERE mm.direction = 'inbound'), 0) AS latest
       FROM crm_mailbox_messages mm WHERE mm.mailbox_id = $1 AND ${threadKey} = $2 AND ${canReadMailbox('mm.mailbox_id', '$3')}
       HAVING count(*) > 0
     ), saved AS (
       INSERT INTO crm_mailbox_thread_reads AS r (mailbox_id, thread_key, user_id, read_through)
       SELECT mailbox_id, thread_key, $3, CASE WHEN $4 THEN least(latest, coalesce($5::bigint, latest)) ELSE 0 END FROM visible
       ON CONFLICT (mailbox_id, thread_key, user_id) DO UPDATE SET read_through =
         CASE WHEN $4 THEN greatest(r.read_through, excluded.read_through) ELSE 0 END
       RETURNING read_through
     ) SELECT visible.latest > saved.read_through AS unread FROM visible CROSS JOIN saved`,
    [mailboxId, threadId, viewerId, input.read, input.through ?? null],
  );
  if (!state) throw new AppError(404, 'That conversation was not found.');
  return state;
}

async function replyToThread(viewerId: string, mailboxId: string, threadId: string, body: string, requestId?: string) {
  const { rows: [target] } = await db.query<ReplyRow>(
    `SELECT mm.provider_message_id, mm.thread_id, mm.contact_id, mm.from_email, mm.subject
     FROM crm_mailbox_messages mm WHERE mm.mailbox_id = $1 AND mm.thread_id = $2 AND ${newestInbound}
       AND ${canReadMailbox('mm.mailbox_id', '$3', true)}
     ORDER BY mm.occurred_at DESC, mm.ingest_order DESC LIMIT 1`, [mailboxId, threadId, viewerId],
  );
  if (!target) throw new AppError(404, 'That conversation is unavailable for replies.');
  const to = z.email().max(254).parse(target.from_email.toLowerCase());
  const subject = /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`;
  const { sendFromMailbox } = await import('./mailboxes');
  return sendFromMailbox(mailboxId, {
    contactId: Number(target.contact_id), to, subject, body, dealId: null,
    reply: { threadId: target.thread_id, providerId: target.provider_message_id },
    idempotencyKey: requestId ? `mailbox-reply:${mailboxId}:${viewerId}:${requestId}` : undefined,
  }, { id: viewerId });
}

const search = (query: URLSearchParams) => (query.get('q') ?? '').trim().slice(0, 200);
const providerThreadId = z.string().min(1).max(1024);
const providerItemId = z.string().min(1).max(2048);

export const inboxEndpoints = [
  route('GET', /^sales\/inbox$/, async ({ query, user }) => inbox(user.id, search(query)), 'marketer'),
  route('GET', /^sales\/inbox\/threads$/, async ({ query, user }) => listThreads(user.id, search(query), query.get('unread') === 'true',
    threadFilter.parse({ status: query.get('status'), assignment: query.get('assignment') })), 'marketer'),
  route('GET', /^sales\/inbox\/thread$/, async ({ query, user }) =>
    readThread(user.id, uuid.parse(query.get('mailboxId')), providerThreadId.parse(query.get('threadId'))), 'marketer'),
  route('PATCH', /^sales\/inbox\/thread$/, async ({ query, user, request }) =>
    markThread(user.id, uuid.parse(query.get('mailboxId')), providerThreadId.parse(query.get('threadId')), await readBody(request, readInput, 4096)), 'marketer'),
  route('GET', /^sales\/inbox\/message$/, async ({ query, user }) => {
    const { readMessageContent } = await import('./mailbox-reader');
    return readMessageContent(user.id, uuid.parse(query.get('mailboxId')), providerItemId.parse(query.get('messageId')));
  }, 'marketer'),
  route('GET', /^sales\/inbox\/attachment$/, async ({ query, user }) => {
    const { downloadAttachment } = await import('./mailbox-reader');
    return downloadAttachment(user.id, uuid.parse(query.get('mailboxId')), providerItemId.parse(query.get('messageId')), providerItemId.parse(query.get('attachmentId')));
  }, 'marketer'),
  route('POST', /^sales\/inbox\/reply$/, async ({ query, request, user }) => {
    const { body, requestId } = await readBody(request, z.object({ body: z.string().trim().min(1).max(50_000), requestId: uuid.optional() }), 320_000);
    return replyToThread(user.id, uuid.parse(query.get('mailboxId')), providerThreadId.parse(query.get('threadId')), body, requestId);
  }, 'marketer'),
  route('GET', /^sales\/inbox\/export$/, async ({ query, user }) => {
    const rows = await inbox(user.id, search(query));
    return csvResponse(rows.map(row => [row.contactName, row.contactEmail, row.subject, row.snippet, row.direction, row.at, row.count]),
      ['Contact', 'Email', 'Subject', 'Snippet', 'Direction', 'Latest activity', 'Messages'], 'ovelio-inbox.csv');
  }, 'marketer'),
];
