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

test('CRM-08 forecast separates estimates from measured won revenue and computes win rate', async () => {
  const { summarise } = await import('../../src/server/crm/forecast');
  const base = { ownerId: 'u1', ownerName: 'Ada', createdAt: '2026-10-01T00:00:00.000Z', closedAt: null } as const;
  const deals = [
    { ...base, status: 'open', amount: 1000, weightedAmount: 500, effectiveProbability: 50, expectedCloseDate: '2026-12-10' },
    { ...base, status: 'open', amount: 2000, weightedAmount: 1600, effectiveProbability: 80, expectedCloseDate: '2027-01-05' },
    { ...base, status: 'won', amount: 3000, weightedAmount: 3000, effectiveProbability: 100, expectedCloseDate: null, closedAt: '2026-12-02T10:00:00.000Z' },
    { ...base, status: 'lost', amount: 900, weightedAmount: 0, effectiveProbability: 0, expectedCloseDate: null, closedAt: '2026-12-03T10:00:00.000Z' },
  ] as unknown as Deal[];
  const result = summarise(deals, [
    { key: '2026-12', label: 'Dec', start: '2026-12-01', end: '2026-12-31' },
    { key: '2027-01', label: 'Jan', start: '2027-01-01', end: '2027-01-31' },
  ], 75);
  assert.equal(result.totals.weighted, 2100);
  assert.equal(result.totals.bestCase, 3000);
  assert.equal(result.totals.committed, 2000);
  assert.equal(result.totals.closedWon, 3000);
  assert.equal(result.totals.winRate, 50);
  assert.equal(result.months[0].closedWon, 3000);
  assert.equal(result.owners[0].label, 'Ada');
  const live = await call<{ totals: { closedWon: number }; currency: string }>('GET', 'sales/forecast', undefined, 'from=2026-09&months=6');
  assert.ok(live.totals.closedWon > 0, 'seeded won deals count as measured revenue');
});

test('CRM-09 a sequence sends through the mailer with honest status and stops when the contact replies', async () => {
  const [claire] = await searchContacts('claire');
  const sequence = await call<{ id: string }>('POST', 'sales/sequences', {
    name: 'CRM-09', steps: [
      { kind: 'email', delayDays: 0, subject: 'Hello {{contact.first_name}}', body: 'Hi {{contact.first_name}}' },
      { kind: 'task', delayDays: 2, taskTitle: 'Call Claire' },
    ],
  });
  const { results } = await call<{ results: { status: string }[] }>('POST', `sales/sequences/${sequence.id}/enrol`, { contactIds: [claire.id] });
  assert.equal(results[0].status, 'enrolled');
  await drainPlatformJobs({ maxJobs: 100 });
  const [enrolment] = await call<{ id: string; status: string; runs: { status: string; reason: string }[] }[]>('GET', `sales/sequences/${sequence.id}/enrolments`);
  assert.equal(enrolment.runs[0].status, 'not_sent', 'the preview has no relay, so the step says so');
  assert.match(enrolment.runs[0].reason, /Not delivered/);
  assert.equal(enrolment.status, 'active');
  const { emitEvent } = await import('../../src/server/events');
  await emitEvent({ type: 'email.replied', contactId: claire.id, properties: { threadId: 't1', messageId: 'm1' } });
  await drainPlatformJobs({ maxJobs: 100 });
  const [after] = await call<{ status: string; stoppedReason: string }[]>('GET', `sales/sequences/${sequence.id}/enrolments`);
  assert.equal(after.status, 'stopped');
  assert.match(after.stoppedReason, /replied/);
});

test('CRM-10 mailbox tokens are encrypted, OAuth URLs carry state and PKCE, and sync emits email.replied for our threads', async () => {
  const mailboxes = await import('../../src/server/crm/mailboxes');
  const key = Buffer.alloc(32, 7);
  const sealed = mailboxes.encryptToken('refresh-token-value', key);
  assert.ok(!sealed.includes('refresh-token-value'));
  assert.equal(mailboxes.decryptToken(sealed, key), 'refresh-token-value');
  assert.throws(() => mailboxes.decryptToken(sealed.slice(0, -2) + 'AA', key));
  const env = { GOOGLE_CLIENT_ID: 'client-123' } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(mailboxes.providerStatus('google', 'http://localhost:3201', env).missing, ['GOOGLE_CLIENT_SECRET', 'MAILBOX_ENCRYPTION_KEY']);
  const url = new URL(mailboxes.buildAuthUrl('google', { state: 's1', challenge: 'c1', redirectUri: 'http://localhost/cb' }, env));
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  const graph = new URL(mailboxes.buildAuthUrl('microsoft', { state: 's2', challenge: 'c2', redirectUri: 'http://localhost/cb' }, { MICROSOFT_CLIENT_ID: 'ms' } as unknown as NodeJS.ProcessEnv));
  assert.match(graph.searchParams.get('scope') ?? '', /offline_access/);
  const parsed = mailboxes.parseGmailMessage({ id: 'g1', threadId: 'th1', snippet: 'Sounds good', internalDate: '1764000000000', payload: { headers: [
    { name: 'From', value: 'Claire Bennett <claire.bennett@northbridge.example>' }, { name: 'To', value: 'rep@ovelio.test' }, { name: 'Subject', value: 'Re: Proposal' }] } });
  assert.equal(parsed.from, 'claire.bennett@northbridge.example');
  assert.equal(mailboxes.parseGraphMessage({ id: 'o1', conversationId: 'c', from: { emailAddress: { address: 'A@B.example' } } }).from, 'a@b.example');
  const [claire] = await searchContacts('claire');
  const mailbox = (await db.query<{ id: string }>(`INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc) VALUES ($1, 'google', 'rep@ovelio.test', 'x') RETURNING id`, [user.id])).rows[0].id;
  await db.query(`INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, contact_id, direction, occurred_at)
    VALUES ($1, 'sent1', 'th1', $2, 'outbound', $3)`, [mailbox, claire.id, new Date(Date.parse(parsed.at) - 60_000).toISOString()]);
  assert.equal(await mailboxes.ingestMessages(mailbox, 'rep@ovelio.test', [parsed]), 1);
  assert.equal(await mailboxes.ingestMessages(mailbox, 'rep@ovelio.test', [parsed]), 0, 'sync is idempotent');
  const replies = await listEvents({ contactId: claire.id, types: ['email.replied'] }, user.id);
  assert.ok(replies.some(event => event.properties.messageId === 'g1'));
});

test('CRM-11 preview seed creates two pipelines and sample deals; search finds deals and tasks', async () => {
  const { items } = await call<{ items: { name: string }[] }>('GET', 'sales/pipelines');
  assert.ok(items.some(item => item.name === 'New business'));
  assert.ok(items.some(item => item.name === 'Renewals'));
  const seeded = await db.query<{ n: string }>(`SELECT count(*) AS n FROM deals WHERE source = 'preview-seed'`);
  assert.equal(Number(seeded.rows[0].n), 18);
  const results = await crmModule.search('loyalty', user);
  assert.ok(results.some(item => item.kind === 'deal' && item.href.startsWith('/sales/deals/')));
  assert.ok(results.some(item => item.kind === 'task'));
});

test('CRM-12 contact profile: owner change emits an event, 1:1 email reports the mailer status, activities join the timeline', async () => {
  const [daniel] = await searchContacts('daniel');
  await call('POST', 'crm/owners', { object: 'contact', ids: [daniel.id], ownerId: '00000000-0000-4000-8000-000000000003' });
  const result = await call<{ status: string; reason: string }>('POST', `crm/contacts/${daniel.id}/email`, { subject: 'Quick question', body: 'Hi {{contact.first_name}},\n\nAre you free Thursday?' });
  assert.equal(result.status, 'not_sent');
  assert.match(result.reason, /no email relay/);
  await call('POST', 'crm/activities', { type: 'call', subject: 'CRM-12 call', outcome: 'Left voicemail', contactId: daniel.id });
  const profile = await call<{ owner: { name: string } | null; deals: unknown[]; timeline: { title: string; type: string }[]; messages: { status: string }[] }>('GET', `crm/contacts/${daniel.id}/profile`);
  assert.equal(profile.owner?.name, 'Liam Brooks');
  assert.ok(profile.deals.length >= 1);
  assert.equal(profile.messages[0].status, 'not_sent');
  assert.ok(profile.timeline.some(item => item.title === 'CRM-12 call'));
  assert.ok(profile.timeline.some(item => item.type === 'contact.owner_changed'));
  const company = await call<{ company: { name: string; openDeals: number; wonRevenue: number }; people: unknown[] }>('GET', 'crm/companies/2/profile');
  assert.equal(company.company.name, 'Harbourline Retail');
  assert.ok(company.company.wonRevenue > 0);
  assert.ok(company.people.length >= 1);
});
