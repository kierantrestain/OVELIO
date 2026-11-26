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
