import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { User } from '../../src/contracts';
import type { InboxResponseReport } from '../../src/contracts/inbox-response-report';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;
const { db } = await import('../../src/server/db');
const { inboxResponseReportEndpoints } = await import('../../src/server/crm/inbox-response-report');

after(() => db.close());

async function actor(name: string, role: User['role'] = 'marketer') {
  const { rows: [user] } = await db.query<User>(
    "INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, 'synthetic') RETURNING id, email, name, role",
    [name + '@example.test', name, role],
  );
  return user;
}

async function mailbox(user: User, name: string) {
  const { rows: [item] } = await db.query<{ id: string }>(
    "INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc) VALUES ($1, 'google', $2, 'synthetic') RETURNING id",
    [user.id, name + '@example.test'],
  );
  return item.id;
}

type Message = [id: string, thread: string, direction: 'inbound' | 'outbound', secondsAgo: number];
async function messages(mailboxId: string, items: Message[]) {
  await db.query(`
    INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, direction, occurred_at)
    SELECT $1, message.id, message.thread, message.direction, now() - make_interval(secs => message.age)
    FROM jsonb_to_recordset($2::jsonb) AS message(id text, thread text, direction text, age integer)
  `, [mailboxId, JSON.stringify(items.map(([id, thread, direction, age]) => ({ id, thread, direction, age })))]);
}

async function report(user: User, days?: string) {
  const url = new URL('http://localhost/api/console/sales/inbox/response-report');
  if (days !== undefined) url.searchParams.set('days', days);
  const endpoint = inboxResponseReportEndpoints.find(item => item.method === 'GET' && item.path.test('sales/inbox/response-report'));
  assert.equal(endpoint?.role, 'marketer');
  return await endpoint!.handler({ request: new Request(url), user, params: [], query: url.searchParams }) as InboxResponseReport;
}

const measured = ({ conversations, replied, awaitingFirstReply, resolvedWithoutReply, averageSeconds, medianSeconds }: InboxResponseReport) =>
  ({ conversations, replied, awaitingFirstReply, resolvedWithoutReply, averageSeconds, medianSeconds });

const empty = {
  conversations: 0, replied: 0, awaitingFirstReply: 0, resolvedWithoutReply: 0, averageSeconds: null, medianSeconds: null,
};

test('INB-19 response aggregates follow current mailbox access without an administrator bypass', async () => {
  const owner = await actor('report-owner');
  const member = await actor('report-member');
  const admin = await actor('report-admin', 'admin');
  const shared = await mailbox(owner, 'report-shared');
  const privateMailbox = await mailbox(owner, 'report-private');
  await messages(shared, [['in', 'same', 'inbound', 3600], ['out', 'same', 'outbound', 3500]]);
  await messages(privateMailbox, [['in', 'same', 'inbound', 1800]]);
  await db.query('INSERT INTO crm_mailbox_members (mailbox_id, user_id) VALUES ($1, $2)', [shared, member.id]);

  assert.deepEqual(measured(await report(admin)), empty);
  const own = measured(await report(owner));
  assert.deepEqual(own, { ...empty, averageSeconds: 100, medianSeconds: 100, conversations: 2, replied: 1, awaitingFirstReply: 1 });
  const sharedReport = await report(member);
  assert.deepEqual(measured(sharedReport), { ...own, conversations: 1, awaitingFirstReply: 0 });
  assert.deepEqual(Object.keys(sharedReport).sort(), [
    ...Object.keys(empty), 'from', 'through', 'sampleLimited', 'messageLimit',
  ].sort());
  await db.query('DELETE FROM crm_mailbox_members WHERE mailbox_id = $1 AND user_id = $2', [shared, member.id]);
  assert.deepEqual(measured(await report(member)), empty);
  await db.query("UPDATE crm_mailboxes SET status = 'revoked' WHERE id = $1", [shared]);
  assert.deepEqual(measured(await report(owner)), { ...empty, conversations: 1, awaitingFirstReply: 1 });
});

test('INB-20 first recorded incoming date defines the cohort and resolved threads leave the waiting count', async () => {
  const owner = await actor('report-window-owner');
  const box = await mailbox(owner, 'report-window');
  const day = 86_400;
  await messages(box, [
    ['fast-in', 'fast', 'inbound', 3600], ['fast-out', 'fast', 'outbound', 3510], ['fast-later', 'fast', 'outbound', 3350],
    ['slow-in', 'slow', 'inbound', 2 * day], ['slow-out', 'slow', 'outbound', 2 * day - 210],
    ['pending-in', 'pending', 'inbound', 4 * day], ['pending-prev', 'pending', 'outbound', 4 * day + 600],
    ['pending-same', 'pending', 'outbound', 4 * day], ['pending-future', 'pending', 'outbound', -60],
    ['resolved-in', 'resolved', 'inbound', 3 * day],
    ['old-in', 'old', 'inbound', 45 * day], ['old-out', 'old', 'outbound', 45 * day - 360], ['old-follow-up', 'old', 'inbound', day],
    ['legacy-in', '', 'inbound', 5 * day], ['legacy-out', '', 'outbound', 5 * day - 60],
  ]);
  await db.query("INSERT INTO crm_mailbox_thread_team (mailbox_id, thread_key, status) VALUES ($1, 'resolved', 'resolved')", [box]);
  const recent = await report(owner, '7');
  assert.equal(Date.parse(recent.through) - Date.parse(recent.from), 7 * day * 1000);
  assert.deepEqual(measured(recent), {
    conversations: 5, replied: 2, awaitingFirstReply: 2, resolvedWithoutReply: 1, averageSeconds: 150, medianSeconds: 150,
  });
  assert.equal((await report(owner, '90')).averageSeconds, 220);
  const defaults = await report(owner);
  assert.equal(Date.parse(defaults.through) - Date.parse(defaults.from), 30 * day * 1000);
  await assert.rejects(report(owner, '91'));
});

test('INB-21 the incoming sample is capped after access checks and reports its limit', async () => {
  const owner = await actor('report-cap-owner');
  const admin = await actor('report-cap-admin', 'admin');
  const box = await mailbox(owner, 'report-cap');
  const { messageLimit } = await report(owner);
  await db.query(`
    INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, direction, occurred_at)
    SELECT $1, 'inbound-' || n, 'busy', 'inbound', now() - interval '1 hour'
    FROM generate_series(1, $2::integer) AS n
  `, [box, messageLimit]);
  assert.equal((await report(owner)).sampleLimited, false);
  await messages(box, [['older', 'older', 'inbound', 7200]]);
  const limited = await report(owner);
  assert.equal(limited.sampleLimited, true);
  assert.deepEqual(measured(limited), { ...empty, conversations: 1, awaitingFirstReply: 1 });
  assert.equal((await report(admin)).sampleLimited, false);
});
