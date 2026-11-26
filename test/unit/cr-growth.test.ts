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
