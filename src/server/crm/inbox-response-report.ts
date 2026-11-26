import { z } from 'zod';
import { inboxResponseWindows } from '@/contracts/inbox-response-report';
import type { InboxResponseReport, InboxResponseWindow } from '@/contracts/inbox-response-report';
import { db } from '../db';
import { canReadMailbox } from '../mailbox-access';
import { route } from '../routes/shared';

const windowInput = z.enum(inboxResponseWindows).default('30');
const messageLimit = 5000;
const threadKey = "coalesce(nullif(mm.thread_id, ''), mm.provider_message_id)";

type ReportRow = {
  conversations: string;
  replied: string;
  awaiting_first_reply: string;
  resolved_without_reply: string;
  average_seconds: string | null;
  median_seconds: string | null;
  sample_limited: boolean;
};

async function responseReport(viewerId: string, days: InboxResponseWindow): Promise<InboxResponseReport> {
  const end = new Date();
  const through = end.toISOString();
  const from = new Date(end.getTime() - Number(days) * 86_400_000).toISOString();
  // Sample the most recent incoming messages, then find each selected conversation's first recorded incoming date.
  // The report uses that date to include conversations in the window.
  const { rows: [row] } = await db.query<ReportRow>(`
    WITH candidates AS (
      SELECT id FROM crm_mailboxes WHERE user_id = $1
      UNION SELECT mailbox_id FROM crm_mailbox_members WHERE user_id = $1
    ), visible AS MATERIALIZED (
      SELECT candidate.id FROM candidates candidate WHERE ${canReadMailbox('candidate.id', '$1')}
    ), recent AS MATERIALIZED (
      SELECT visible.id AS mailbox_id, incoming.*
      FROM visible CROSS JOIN LATERAL (
        SELECT ${threadKey} AS thread_key, mm.occurred_at, mm.provider_message_id
        FROM crm_mailbox_messages mm
        WHERE mm.mailbox_id = visible.id AND mm.direction = 'inbound'
          AND mm.occurred_at >= $2::timestamptz AND mm.occurred_at < $3::timestamptz
        ORDER BY mm.occurred_at DESC, mm.provider_message_id DESC LIMIT $4::integer + 1
      ) incoming
      ORDER BY occurred_at DESC, mailbox_id, provider_message_id DESC LIMIT $4::integer + 1
    ), sample AS (
      SELECT DISTINCT mailbox_id, thread_key FROM (
        SELECT mailbox_id, thread_key FROM recent
        ORDER BY occurred_at DESC, mailbox_id, provider_message_id DESC LIMIT $4::integer
      ) selected
    ), measurements AS (
      SELECT extract(epoch FROM (reply.occurred_at - opening.occurred_at)) AS seconds,
        coalesce(team.status = 'resolved', false) AS resolved
      FROM sample s
      CROSS JOIN LATERAL (
        SELECT mm.occurred_at FROM crm_mailbox_messages mm
        WHERE mm.mailbox_id = s.mailbox_id AND ${threadKey} = s.thread_key AND mm.direction = 'inbound'
        ORDER BY mm.occurred_at LIMIT 1
      ) opening
      LEFT JOIN LATERAL (
        SELECT mm.occurred_at FROM crm_mailbox_messages mm
        WHERE mm.mailbox_id = s.mailbox_id AND ${threadKey} = s.thread_key AND mm.direction = 'outbound'
          AND mm.occurred_at > opening.occurred_at AND mm.occurred_at < $3::timestamptz
        ORDER BY mm.occurred_at LIMIT 1
      ) reply ON true
      LEFT JOIN crm_mailbox_thread_team team ON team.mailbox_id = s.mailbox_id AND team.thread_key = s.thread_key
      WHERE opening.occurred_at >= $2::timestamptz
    )
    SELECT count(*) AS conversations, count(seconds) AS replied,
      count(*) FILTER (WHERE seconds IS NULL AND NOT resolved) AS awaiting_first_reply,
      count(*) FILTER (WHERE seconds IS NULL AND resolved) AS resolved_without_reply,
      round(avg(seconds)) AS average_seconds,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds))::numeric) AS median_seconds,
      (SELECT count(*) > $4::integer FROM recent) AS sample_limited
    FROM measurements
  `, [viewerId, from, through, messageLimit]);
  return {
    from, through,
    conversations: Number(row.conversations), replied: Number(row.replied),
    awaitingFirstReply: Number(row.awaiting_first_reply), resolvedWithoutReply: Number(row.resolved_without_reply),
    averageSeconds: row.average_seconds === null ? null : Number(row.average_seconds),
    medianSeconds: row.median_seconds === null ? null : Number(row.median_seconds),
    sampleLimited: row.sample_limited, messageLimit,
  };
}

export const inboxResponseReportEndpoints = [
  route('GET', /^sales\/inbox\/response-report$/, async ({ query, user }) =>
    responseReport(user.id, windowInput.parse(query.get('days') ?? undefined)), 'marketer'),
];
