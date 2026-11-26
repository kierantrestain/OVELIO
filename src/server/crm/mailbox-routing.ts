import { z } from 'zod';
import type { MailboxRoutingSettings } from '@/contracts/mailbox-routing';
import type { InboxAssignee } from '@/contracts/mailbox-team';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { readBody } from '../http';
import { activeMailboxUser, canReadMailbox } from '../mailbox-access';
import { route } from '../routes/shared';

const id = z.uuid();
const routingInput = z.object({ assigneeId: id.nullable() });
const missingMailbox = () => new AppError(404, 'That mailbox was not found.');

async function readRouting(mailboxId: string, viewerId: string, client: Sql = db): Promise<MailboxRoutingSettings> {
  const { rows: [settings] } = await client.query<{ assignee_id: string | null; assignment_options: InboxAssignee[] }>(
    `SELECT assignee.id AS assignee_id,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('id', member.id, 'name', member.name) ORDER BY lower(member.name), member.id), '[]'::jsonb)
        FROM users member WHERE ${activeMailboxUser('member')} AND (
          member.id = m.user_id OR EXISTS (SELECT 1 FROM crm_mailbox_members mm WHERE mm.mailbox_id = m.id AND mm.user_id = member.id)
        )) AS assignment_options
     FROM crm_mailboxes m LEFT JOIN crm_mailbox_routing r ON r.mailbox_id = m.id
     LEFT JOIN users assignee ON assignee.id = r.assignee_id AND ${canReadMailbox('m.id', 'assignee.id')}
     WHERE m.id = $1 AND ${canReadMailbox('m.id', '$2', true)}`, [mailboxId, viewerId],
  );
  if (!settings) throw missingMailbox();
  return { assigneeId: settings.assignee_id, assignmentOptions: settings.assignment_options };
}

async function updateRouting(mailboxId: string, viewerId: string, assigneeId: string | null) {
  return transaction(async client => {
    // Membership changes use the same row lock. Evaluate permissions after acquiring it.
    await client.query('SELECT id FROM crm_mailboxes WHERE id = $1 FOR UPDATE', [mailboxId]);
    const owned = await client.query(
      `SELECT m.id FROM crm_mailboxes m WHERE m.id = $1 AND ${canReadMailbox('m.id', '$2', true)}`, [mailboxId, viewerId],
    );
    if (!owned.rowCount) throw missingMailbox();

    if (assigneeId) {
      const target = await client.query(
        `SELECT id FROM users candidate WHERE id = $2 AND ${canReadMailbox('$1', 'candidate.id')} FOR SHARE`, [mailboxId, assigneeId],
      );
      if (!target.rowCount) throw new AppError(400, 'Choose an active mailbox owner or member.');
      await client.query(`INSERT INTO crm_mailbox_routing (mailbox_id, assignee_id) VALUES ($1, $2)
        ON CONFLICT (mailbox_id) DO UPDATE SET assignee_id = excluded.assignee_id`, [mailboxId, assigneeId]);
    } else {
      await client.query('DELETE FROM crm_mailbox_routing WHERE mailbox_id = $1', [mailboxId]);
    }
    return readRouting(mailboxId, viewerId, client);
  });
}

/** Call after inserting a new inbound message, within the same mailbox-locked transaction. */
export async function routeNewMailboxThread(client: Sql, mailboxId: string, threadKey: string): Promise<string | null> {
  const { rows: [assigned] } = await client.query<{ assignee_id: string }>(
    `INSERT INTO crm_mailbox_thread_team (mailbox_id, thread_key, assignee_id)
     SELECT r.mailbox_id, $2, r.assignee_id FROM crm_mailbox_routing r
     WHERE r.mailbox_id = $1 AND ${canReadMailbox('r.mailbox_id', 'r.assignee_id')}
       AND (SELECT count(*) FROM (
         SELECT 1 FROM crm_mailbox_messages mm WHERE mm.mailbox_id = r.mailbox_id
           AND coalesce(nullif(mm.thread_id, ''), mm.provider_message_id) = $2 AND mm.direction = 'inbound' LIMIT 2
       ) incoming) = 1
     ON CONFLICT (mailbox_id, thread_key) DO NOTHING RETURNING assignee_id`, [mailboxId, threadKey],
  );
  return assigned?.assignee_id ?? null;
}

export const mailboxRoutingEndpoints = [
  route('GET', /^mailboxes\/([0-9a-f-]{36})\/routing$/, async ({ params, user }) => readRouting(id.parse(params[0]), user.id), 'marketer'),
  route('PATCH', /^mailboxes\/([0-9a-f-]{36})\/routing$/, async ({ params, request, user }) => {
    const { assigneeId } = await readBody(request, routingInput, 4096);
    return updateRouting(id.parse(params[0]), user.id, assigneeId);
  }, 'marketer'),
];
