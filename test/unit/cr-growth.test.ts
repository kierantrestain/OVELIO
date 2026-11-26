import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { crmModule } = await import('../../src/server/crm/module');
const { searchContacts } = await import('../../src/server/directory');
type ContactPage = import('../../src/contracts/crm').CrmContactPage;

after(async () => { await db.close(); });

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@ovelio.test', name: 'Developer Test', role: 'admin' as const };
const MAYA = '00000000-0000-4000-8000-000000000002';
const LIAM = '00000000-0000-4000-8000-000000000003';

export async function call<T>(method: string, path: string, body?: unknown, query = ''): Promise<T> {
  const entry = crmModule.endpoints.find(item => item.method === method && item.path.test(path));
  assert.ok(entry, `${method} ${path} is routed`);
  const request = new Request('http://localhost/api/console/' + path + (query ? '?' + query : ''), {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await entry.handler({ request, user, params: entry.path.exec(path)!.slice(1), query: new URL(request.url).searchParams });
  if (result instanceof Response) return (result.status === 204 ? undefined : await result.json()) as T;
  return result as T;
}

test('CR-01 contact list filters by owner and stage, shows open deals, and bulk reassignment moves ownership', async () => {
  const all = await call<ContactPage>('GET', 'crm/contacts', undefined, 'limit=50');
  const claire = all.items.find(item => item.email.startsWith('claire'))!;
  assert.equal(claire.ownerName, 'Developer Test');
  assert.ok(claire.openDeals >= 1 && claire.openDealValue > 0, 'open deals come from OVELIO deals');
  assert.ok(claire.lastActivityAt, 'logged activities set last activity');
  const mine = await call<ContactPage>('GET', 'crm/contacts', undefined, 'ownerId=me&stage=Marketing+Qualified');
  assert.deepEqual(mine.items.map(item => item.email), [claire.email]);
  const unowned = await call<ContactPage>('GET', 'crm/contacts', undefined, 'ownerId=none');
  assert.ok(unowned.items.every(item => !item.ownerId));
  await call('POST', 'crm/owners', { object: 'contact', ids: unowned.items.map(item => item.id), ownerId: LIAM });
  const liam = await call<ContactPage>('GET', 'crm/contacts', undefined, `ownerId=${LIAM}&hasOpenDeal=no`);
  assert.ok(liam.items.length >= unowned.items.filter(item => item.openDeals === 0).length);
  const suppressed = await call<ContactPage>('GET', 'crm/contacts', undefined, 'consent=suppressed');
  assert.ok(suppressed.items.every(item => item.consent === 'suppressed') && suppressed.items.length >= 1);
  const companies = await call<{ items: { name: string; ownerName: string; openDeals: number; people: number }[] }>('GET', 'crm/companies', undefined, `ownerId=${MAYA}`);
  assert.ok(companies.items.some(item => item.name === 'Harbourline Retail' && item.openDeals > 0 && item.people >= 1));
  const [daniel] = await searchContacts('daniel');
  assert.ok(daniel);
});

test('CR-03 a form lead goes to the next rep in rotation, once, and only when it has no owner', async () => {
  const { upsertContact } = await import('../../src/server/directory');
  const { emitEvent, listEvents } = await import('../../src/server/events');
  const { drainPlatformJobs } = await import('../../src/server/platform/jobs');
  await call('POST', 'crm/routing', { name: 'Demo requests', matchField: 'form', matchValue: 'Demo request', userIds: [MAYA, LIAM] });
  await call('POST', 'crm/routing', { name: 'Everyone else', matchField: 'any', userIds: [user.id] });
  const owner = async (id: number) => (await db.query<{ owner_id: string }>(`SELECT owner_id FROM record_owners WHERE object = 'contact' AND record_id = $1`, [id])).rows[0]?.owner_id;
  const leads = [];
  for (const email of ['lead.one@routing.example', 'lead.two@routing.example']) {
    const { contact } = await upsertContact({ email, source: 'test' });
    const event = await emitEvent({ type: 'form.submitted', contactId: contact.id, entityType: 'form', entityId: 'f-demo', properties: { formName: 'Demo request' } });
    leads.push({ contact, event: event! });
  }
  await drainPlatformJobs({ maxJobs: 200 });
  assert.equal(await owner(leads[0].contact.id), MAYA);
  assert.equal(await owner(leads[1].contact.id), LIAM, 'the second lead goes to the next rep');
  const { routeLead } = await import('../../src/server/crm/routing');
  await routeLead(leads[0].event);
  assert.equal(await owner(leads[0].contact.id), MAYA, 'a redelivered event changes nothing');
  const { contact: other } = await upsertContact({ email: 'lead.three@routing.example', source: 'test' });
  await emitEvent({ type: 'contact.created', contactId: other.id, source: 'import' });
  await drainPlatformJobs({ maxJobs: 200 });
  assert.equal(await owner(other.id), user.id, 'the catch-all rule takes leads no other rule matches');
  const changes = await listEvents({ contactId: leads[1].contact.id, types: ['contact.owner_changed'] });
  assert.equal(changes.length, 1);
});

test('CR-04 cards carry next action, last touch and health; a move into a stage with missing required fields is refused with the reason', async () => {
  type Board = import('../../src/contracts/crm').DealBoard;
  const board = await call<Board>('GET', 'sales/board');
  const deals = board.columns.flatMap(column => column.deals);
  const content = deals.find(deal => deal.name.includes('Content hub'))!;
  assert.equal(content.health, 'at_risk');
  assert.ok(content.healthReasons.includes('Expected close date has passed'));
  const loyalty = deals.find(deal => deal.name.includes('Loyalty platform'))!;
  assert.match(loyalty.nextTask?.title ?? '', /Call Daniel/);
  assert.ok(loyalty.lastActivityAt);
  const proposal = board.columns.find(column => column.stage.name === 'Proposal')!.stage;
  await call('PATCH', `sales/stages/${proposal.id}`, { requiredFields: ['expected_close_date', 'contact'] });
  const deal = await call<{ id: string }>('POST', 'sales/deals', { name: 'CR-04 bare deal', amount: 500 });
  await assert.rejects(call('POST', `sales/deals/${deal.id}/move`, { stageId: proposal.id }),
    (error: Error & { status?: number }) => error.status === 409 && /Add an expected close date and a contact before moving “CR-04 bare deal” to Proposal/.test(error.message));
  const [hannah] = await searchContacts('hannah');
  await call('PATCH', `sales/deals/${deal.id}`, { expectedCloseDate: '2027-03-01', contactId: hannah.id });
  const moved = await call<{ stageName: string }>('POST', `sales/deals/${deal.id}/move`, { stageId: proposal.id });
  assert.equal(moved.stageName, 'Proposal');
  await call('PATCH', `sales/stages/${proposal.id}`, { requiredFields: [] });
});

test('CR-05 sequence steps wait for the recipient’s send window and the sender’s daily limit', async () => {
  const { nextSendTime, zoneForCountry } = await import('../../src/server/crm/send-window');
  const { drainPlatformJobs } = await import('../../src/server/platform/jobs');
  const window = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
  assert.equal(zoneForCountry('United States'), 'America/New_York');
  assert.equal(zoneForCountry('Atlantis', {} as unknown as NodeJS.ProcessEnv), 'UTC');
  assert.equal(nextSendTime(new Date('2026-11-28T10:00:00Z'), 'Europe/London', window).toISOString(), '2026-11-30T09:00:00.000Z', 'Saturday waits for Monday 09:00');
  assert.equal(nextSendTime(new Date('2026-11-30T12:00:00Z'), 'America/New_York', window).toISOString(), '2026-11-30T14:00:00.000Z', '07:00 in New York waits for 09:00 local');
  const inside = new Date('2026-12-01T10:30:00Z');
  assert.equal(nextSendTime(inside, 'Europe/London', window), inside);
  const sequence = await call<{ id: string; dailyLimit: number }>('POST', 'sales/sequences', {
    name: 'CR-05 limited', dailyLimit: 1, sendWindow: { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] },
    steps: [{ kind: 'email', delayDays: 0, businessHours: false, subject: 'Hi {{contact.first_name}}', body: 'Hello' }],
  });
  assert.equal(sequence.dailyLimit, 1);
  const [claire] = await searchContacts('claire');
  const [daniel] = await searchContacts('daniel');
  await call('POST', `sales/sequences/${sequence.id}/enrol`, { contactIds: [claire.id, daniel.id] });
  await drainPlatformJobs({ maxJobs: 200 });
  const enrolments = await call<{ runs: unknown[]; waitReason: string; nextRunAt: string }[]>('GET', `sales/sequences/${sequence.id}/enrolments`);
  assert.equal(enrolments.filter(item => item.runs.length === 1).length, 1, 'one email goes out today');
  const waiting = enrolments.find(item => item.runs.length === 0)!;
  assert.match(waiting.waitReason, /daily limit of 1/);
  assert.ok(Date.parse(waiting.nextRunAt) > Date.now(), 'the other waits for tomorrow');
});

test('CR-02 duplicates are detected by email or name and company, and a merge moves every OVELIO record to the survivor', async () => {
  const { upsertContact, getContact } = await import('../../src/server/directory');
  const { listEvents } = await import('../../src/server/events');
  const { contact: dup } = await upsertContact({ email: 'claire.b@northbridge-old.example', firstName: 'Claire', lastName: 'Bennett', company: 'Northbridge Studio', tags: ['legacy-import'], source: 'test' });
  const groups = await call<{ reason: string; contacts: { id: number }[] }[]>('GET', 'crm/duplicates');
  const group = groups.find(item => item.contacts.some(contact => contact.id === dup.id));
  assert.equal(group?.reason, 'Same name and company');
  const survivor = group!.contacts.find(contact => contact.id !== dup.id)!.id;
  const deal = await call<{ id: string }>('POST', 'sales/deals', { name: 'CR-02 deal', contactId: dup.id });
  await call('POST', 'sales/tasks', { title: 'CR-02 task', contactId: dup.id });
  await call('POST', 'crm/activities', { type: 'note', body: 'CR-02 note', contactId: dup.id });
  const result = await call<{ merged: number }>('POST', 'crm/duplicates/merge', { survivorId: survivor, duplicateIds: [dup.id] });
  assert.equal(result.merged, 1);
  assert.equal(await getContact(dup.id), null, 'the duplicate is deleted from the directory');
  const moved = await db.query<{ deals: string; tasks: string; acts: string; left: string }>(
    `SELECT (SELECT count(*) FROM deals WHERE id = $1 AND contact_id = $2) AS deals, (SELECT count(*) FROM tasks WHERE title = 'CR-02 task' AND contact_id = $2) AS tasks,
       (SELECT count(*) FROM activities WHERE body = 'CR-02 note' AND contact_id = $2) AS acts,
       (SELECT count(*) FROM tasks WHERE contact_id = $3) + (SELECT count(*) FROM activities WHERE contact_id = $3) + (SELECT count(*) FROM events WHERE contact_id = $3) AS left`,
    [deal.id, survivor, dup.id]);
  assert.deepEqual(Object.values(moved.rows[0]).map(Number), [1, 1, 1, 0]);
  const merged = await getContact(survivor);
  assert.ok(merged?.tags.includes('legacy-import'), 'tags are combined');
  const events = await listEvents({ contactId: survivor, types: ['contact.updated'] });
  assert.equal(events[0]?.properties.mergedContactId, dup.id);
  const audited = await db.query(`SELECT 1 FROM audit_log WHERE action = 'merge' AND entity_id = $1`, [String(survivor)]);
  assert.equal(audited.rows.length, 1);
});
