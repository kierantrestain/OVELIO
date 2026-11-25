import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { crmModule } = await import('../../src/server/crm/module');
const { searchContacts } = await import('../../src/server/directory');
const { drainPlatformJobs } = await import('../../src/server/platform/jobs');
const { listEvents } = await import('../../src/server/events');
const { positionBetween } = await import('../../src/contracts/crm');
type Board = import('../../src/contracts/crm').DealBoard;
type Deal = import('../../src/contracts/crm').Deal;

after(async () => { await db.close(); });

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@ovelio.test', name: 'Developer Test', role: 'admin' as const };

async function call<T>(method: string, path: string, body?: unknown, query = ''): Promise<T> {
  const entry = crmModule.endpoints.find(item => item.method === method && item.path.test(path));
  assert.ok(entry, `${method} ${path} is routed`);
  const match = entry.path.exec(path)!;
  const request = new Request('http://localhost/api/console/' + path + (query ? '?' + query : ''), {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await entry.handler({ request, user, params: match.slice(1), query: new URL(request.url).searchParams });
  if (result instanceof Response) {
    if (result.status === 204) return undefined as T;
    const type = result.headers.get('content-type') ?? '';
    return (type.includes('json') ? await result.json() : await result.text()) as T;
  }
  return result as T;
}

test('CRM-01 GET sales/pipelines honours the cross-lane contract', async () => {
  const { items } = await call<{ items: { id: string; name: string; currency: string; isDefault: boolean; stages: { id: string; name: string; position: number; probability: number; outcome: string }[] }[] }>('GET', 'sales/pipelines');
  const main = items.find(item => item.isDefault);
  assert.ok(main);
  assert.equal(typeof main.currency, 'string');
  assert.deepEqual(Object.keys(main.stages[0]).filter(key => ['id', 'name', 'position', 'probability', 'outcome'].includes(key)).sort(), ['id', 'name', 'outcome', 'position', 'probability']);
});

test('CRM-02 board positions fall between neighbours and renumber when the gap closes', () => {
  assert.equal(positionBetween(null, null), 0);
  assert.equal(positionBetween(null, 4), 3);
  assert.equal(positionBetween(2, null), 3);
  assert.equal(positionBetween(1, 2), 1.5);
  assert.equal(positionBetween(1, 1 + 1e-9), null);
});

test('CRM-03 dragging a deal to another stage and within a column persists order, totals and history', async () => {
  const [claire] = await searchContacts('claire');
  const board = await call<Board>('GET', 'sales/board');
  const [first, second] = board.columns;
  const a = await call<Deal>('POST', 'sales/deals', { name: 'CRM-03 A', amount: 1000, contactId: claire.id, stageId: first.stage.id });
  const b = await call<Deal>('POST', 'sales/deals', { name: 'CRM-03 B', amount: 3000, stageId: second.stage.id });
  const c = await call<Deal>('POST', 'sales/deals', { name: 'CRM-03 C', amount: 500, stageId: second.stage.id });
  assert.equal(a.contactEmail, claire.email);
  assert.equal(a.ownerId, user.id, 'the creator owns a new deal by default');
  // Drop A between C (top) and B in the second column.
  await call('POST', `sales/deals/${a.id}/move`, { stageId: second.stage.id, previousId: c.id, nextId: b.id });
  const after = await call<Board>('GET', 'sales/board');
  const column = after.columns.find(item => item.stage.id === second.stage.id)!;
  assert.deepEqual(column.deals.filter(deal => deal.name.startsWith('CRM-03')).map(deal => deal.name), ['CRM-03 C', 'CRM-03 A', 'CRM-03 B']);
  const ours = column.deals.filter(deal => deal.name.startsWith('CRM-03'));
  assert.equal(ours.reduce((sum, deal) => sum + deal.amount, 0), 4500);
  assert.ok(column.weighted <= column.total, 'weighted value is an estimate below the total');
  const detail = await call<{ history: { toStageName: string }[]; timeline: { type: string }[] }>('GET', `sales/deals/${a.id}`);
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[0].toStageName, second.stage.name);
  assert.ok(detail.timeline.some(item => item.type === 'deal.stage_changed'));
});

test('CRM-04 closing a deal as won records the measured amount; lost keeps the reason', async () => {
  const won = await call<Deal>('POST', 'sales/deals', { name: 'CRM-04 won', amount: 12000 });
  const closed = await call<Deal>('POST', `sales/deals/${won.id}/close`, { outcome: 'won' });
  assert.equal(closed.status, 'won');
  assert.ok(closed.closedAt);
  const events = await listEvents({ dealId: won.id });
  assert.equal(events.find(event => event.type === 'deal.won')?.amount, 12000);
  const lost = await call<Deal>('POST', 'sales/deals', { name: 'CRM-04 lost', amount: 400 });
  const lostDeal = await call<Deal>('POST', `sales/deals/${lost.id}/close`, { outcome: 'lost', lostReason: 'Chose a competitor' });
  assert.equal(lostDeal.lostReason, 'Chose a competitor');
  const reopened = await call<Deal>('POST', `sales/deals/${lost.id}/reopen`, {});
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.lostReason, '');
});

test('CRM-05 deal edits refresh association snapshots, filters narrow the table and export is CSV', async () => {
  const [daniel] = await searchContacts('daniel');
  const deal = await call<Deal>('POST', 'sales/deals', { name: 'CRM-05 retail rollout', amount: 7000, expectedCloseDate: '2027-01-15' });
  const updated = await call<Deal>('PATCH', `sales/deals/${deal.id}`, { contactId: daniel.id, amount: 9000, probability: 40 });
  assert.equal(updated.contactName, daniel.name);
  assert.equal(updated.companyName, daniel.company, 'company snapshot follows the new contact when the deal had none');
  assert.equal(updated.weightedAmount, 3600);
  const page = await call<{ items: Deal[]; total: number }>('GET', 'sales/deals', undefined, 'q=retail+rollout&minAmount=8000');
  assert.deepEqual(page.items.map(item => item.id), [deal.id]);
  const csv = await call<string>('GET', 'sales/deals/export', undefined, 'q=CRM-05');
  assert.match(csv, /^Deal,Pipeline,Stage/);
  assert.match(csv, /CRM-05 retail rollout/);
});

test('CRM-06 stages: reorder, refuse deleting a stage with deals unless a target is given', async () => {
  const pipeline = await call<{ id: string; stages: { id: string; name: string; outcome: string }[] }>('POST', 'sales/pipelines', { name: 'CRM-06 Renewals', currency: 'EUR' });
  assert.equal(pipeline.stages.length, 6);
  const [lead, qualified] = pipeline.stages;
  const reordered = await call<{ stages: { id: string }[] }>('POST', `sales/pipelines/${pipeline.id}/stages/order`, { ids: [qualified.id, lead.id] });
  assert.equal(reordered.stages[0].id, qualified.id);
  await call('POST', 'sales/deals', { name: 'CRM-06 deal', stageId: lead.id });
  await assert.rejects(call('DELETE', `sales/stages/${lead.id}`), /holds 1 deal/);
  const result = await call<{ stages: { id: string }[] }>('DELETE', `sales/stages/${lead.id}`, undefined, `targetStageId=${qualified.id}`);
  assert.ok(!result.stages.some(stage => stage.id === lead.id));
});

test('CRM-07 a task reminder job marks the task as due and lists it under reminders', async () => {
  const soon = new Date(Date.now() - 1000).toISOString();
  const task = await call<{ id: string }>('POST', 'sales/tasks', { title: 'CRM-07 follow up', type: 'follow_up', dueAt: new Date(Date.now() + 3600_000).toISOString(), remindAt: soon });
  await drainPlatformJobs({ maxJobs: 100 });
  const reminders = await call<{ items: { id: string; remindedAt: string | null }[] }>('GET', 'sales/tasks', undefined, 'view=reminders');
  assert.ok(reminders.items.find(item => item.id === task.id)?.remindedAt);
  await call('POST', `sales/tasks/${task.id}/complete`);
  const done = await call<{ items: { id: string }[]; counts: Record<string, number> }>('GET', 'sales/tasks', undefined, 'view=completed');
  assert.ok(done.items.some(item => item.id === task.id));
  assert.ok(done.counts.completed >= 1);
});
