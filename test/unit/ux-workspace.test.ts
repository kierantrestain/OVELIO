import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { createDeal, moveDeal, createTask } = await import('../../src/server/records');
const { emitEvent } = await import('../../src/server/events');
const { drainPlatformJobs } = await import('../../src/server/platform/jobs');
const { listNotifications, markNotificationsRead, notify } = await import('../../src/server/platform/notifications');
const { recordAt } = await import('../../src/contracts/workspace');

after(async () => { await db.close(); });

const dev = '00000000-0000-4000-8000-000000000001';
const maya = '00000000-0000-4000-8000-000000000002';

async function drain() {
  for (let round = 0; round < 6; round++) if (!await drainPlatformJobs({ maxJobs: 200, budgetMs: 10_000 })) break;
}

test('UX-21 notify() is idempotent per dedupe key and marks read', async () => {
  const first = await notify({ userIds: [dev, dev], kind: 'test', title: 'Hello', dedupeKey: 'ux-21' });
  const again = await notify({ userIds: [dev], kind: 'test', title: 'Hello', dedupeKey: 'ux-21' });
  assert.equal(first, 1);
  assert.equal(again, 0);
  const list = await listNotifications(dev);
  assert.ok(list.unread >= 1);
  await markNotificationsRead(dev);
  assert.equal((await listNotifications(dev)).unread, 0);
});

test('UX-21 a task assigned to someone else, its reminder, a won deal, a form lead and a failed flow notify the right people', async () => {
  await createTask({ title: 'UX call back', assigneeId: maya, actorId: dev, remindAt: new Date(Date.now() - 1000).toISOString(), source: 'test' });
  const deal = await createDeal({ name: 'UX won deal', amount: 500, ownerId: dev, source: 'test' });
  const won = (await db.query<{ id: string }>(`SELECT id FROM pipeline_stages WHERE outcome = 'won' LIMIT 1`)).rows[0].id;
  await moveDeal(deal.id, { stageId: won });
  const form = (await db.query<{ id: string }>(`SELECT id FROM forms LIMIT 1`)).rows[0];
  await emitEvent({ type: 'form.submitted', entityType: 'form', entityId: form.id, contactId: 1, source: 'test', properties: { formName: 'UX form' } });
  const flow = (await db.query<{ id: string; owner_id: string | null }>(`SELECT id, owner_id FROM journey_flows LIMIT 1`)).rows[0];
  await emitEvent({ type: 'flow.failed', entityType: 'flow', entityId: flow.id, source: 'test', properties: { flowName: 'UX flow', error: 'Step failed' } });
  await drain();

  const kinds = async (user: string) => (await listNotifications(user, 100)).items.map(item => item.kind);
  const mayaKinds = await kinds(maya);
  assert.ok(mayaKinds.includes('task.assigned'), 'assignee told about the task');
  assert.ok(mayaKinds.includes('task.reminder'), 'assignee reminded');
  const devKinds = await kinds(dev);
  assert.ok(devKinds.includes('deal.won'), 'owner told about the won deal');
  assert.ok(devKinds.includes('form.lead') || mayaKinds.includes('form.lead'), 'form owner or admins told about the lead');
  const flowOwner = flow.owner_id ?? dev;
  assert.ok((await kinds(flowOwner)).includes('flow.failed'), 'flow owner told about the failure');
});

test('UX-22 record pages are recognised for recents and stars', () => {
  assert.deepEqual(recordAt('/crm/contacts/12'), { kind: 'contact', recordId: '12' });
  assert.equal(recordAt('/sales/deals/1d5d1e0a-9a00-4d1b-a5cb-08dccbf200e1')?.kind, 'deal');
  assert.equal(recordAt('/sales/deals'), null);
});
