import { z } from 'zod';
import type { InboxConversation, InboxThread, InboxThreadMessage, InboxThreadSummary } from '@/contracts/crm';
import { AppError } from '../config';
import { db } from '../db';
import { getContacts } from '../directory';
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

function toThreadMessage(row: ThreadMessageRow): InboxThreadMessage {
  return {
    id: row.provider_message_id, contactId: row.contact_id == null ? null : Number(row.contact_id),
    subject: row.subject, snippet: row.snippet, fromEmail: row.from_email, toEmails: row.to_emails,
    direction: row.direction, at: new Date(row.occurred_at).toISOString(),
  };
}

async function listThreads(viewerId: string, query: string): Promise<InboxThreadSummary[]> {
  const { rows } = await db.query<ThreadMessageRow & { mailbox_id: string; mailbox_email: string; thread_key: string; count: string }>(
    `WITH ranked AS (
       SELECT mm.*, m.email AS mailbox_email, ${threadKey} AS thread_key,
         row_number() OVER (thread ORDER BY mm.occurred_at DESC, mm.provider_message_id DESC) AS n,
         count(*) OVER thread AS count,
         bool_or(strpos(lower(concat_ws(' ', mm.subject, mm.snippet, mm.from_email, mm.to_emails)), lower($2)) > 0) OVER thread AS matches
       FROM crm_mailbox_messages mm JOIN crm_mailboxes m ON m.id = mm.mailbox_id
       WHERE ${canReadMailbox('mm.mailbox_id', '$1')}
       WINDOW thread AS (PARTITION BY mm.mailbox_id, ${threadKey})
     )
     SELECT * FROM ranked WHERE n = 1 AND matches ORDER BY occurred_at DESC, mailbox_id, provider_message_id DESC LIMIT 100`, [viewerId, query]);
  return rows.map(row => ({
    ...toThreadMessage(row), mailboxId: row.mailbox_id, mailboxEmail: row.mailbox_email, threadId: row.thread_key, count: Number(row.count),
  }));
}

async function readThread(viewerId: string, mailboxId: string, threadId: string): Promise<InboxThread> {
  const { rows } = await db.query<ThreadMessageRow>(
    `SELECT mm.* FROM crm_mailbox_messages mm
     WHERE mm.mailbox_id = $1 AND ${threadKey} = $2 AND ${canReadMailbox('mm.mailbox_id', '$3')}
     ORDER BY mm.occurred_at DESC, mm.provider_message_id DESC LIMIT 250`, [mailboxId, threadId, viewerId]);
  if (!rows.length) throw new AppError(404, 'That conversation was not found.');
  return { mailboxId, threadId, messages: rows.reverse().map(toThreadMessage) };
}

const search = (query: URLSearchParams) => (query.get('q') ?? '').trim().slice(0, 200);
const providerThreadId = z.string().min(1).max(1024);

export const inboxEndpoints = [
  route('GET', /^sales\/inbox$/, async ({ query, user }) => inbox(user.id, search(query)), 'marketer'),
  route('GET', /^sales\/inbox\/threads$/, async ({ query, user }) => listThreads(user.id, search(query)), 'marketer'),
  route('GET', /^sales\/inbox\/thread$/, async ({ query, user }) =>
    readThread(user.id, uuid.parse(query.get('mailboxId')), providerThreadId.parse(query.get('threadId'))), 'marketer'),
  route('GET', /^sales\/inbox\/export$/, async ({ query, user }) => {
    const rows = await inbox(user.id, search(query));
    return csvResponse(rows.map(row => [row.contactName, row.contactEmail, row.subject, row.snippet, row.direction, row.at, row.count]),
      ['Contact', 'Email', 'Subject', 'Snippet', 'Direction', 'Latest activity', 'Messages'], 'ovelio-inbox.csv');
  }, 'marketer'),
];
