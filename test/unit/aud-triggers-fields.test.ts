import assert from 'node:assert/strict';
import test from 'node:test';
import { createMautic } from '../../src/server/mautic';
import { UpstreamError } from '../../src/server/upstream';
import { contactFields, exportContacts, importContacts } from '../../src/server/audience';
import { db } from '../../src/server/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { [key: string]: any };
type Seen = { method: string; path: string; search: string; body: Body | null };

function client(handler: (seen: Seen) => unknown) {
  const calls: Seen[] = [];
  const api = createMautic({
    url: 'http://marketing-engine.local/',
    username: 'integration',
    password: 'unit-test-password',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.text();
      const seen: Seen = { method: request.method, path: url.pathname, search: url.search, body: text && text.startsWith('{') ? JSON.parse(text) : null };
      calls.push(seen);
      return Response.json(handler(seen));
    },
  });
  return { api, calls };
}

const storedTrigger = {
  id: 9, name: 'Warm lead', description: '', points: 50, isPublished: true, triggerExistingLeads: false,
  events: {
    31: { id: 31, name: 'Tag it', type: 'lead.changetags', properties: { add_tags: ['warm'], remove_tags: [] } },
    32: { id: 32, name: 'Old stage', type: 'lead.changestage', properties: { addstage: 4 } },
  },
};

test('AUD-01 creating a trigger sends its events with type and properties', async () => {
  const { api, calls } = client(() => ({ trigger: storedTrigger }));
  const saved = await api.createPointTrigger({
    name: 'Warm lead', points: 50,
    events: [
      { type: 'lead.changetags', properties: { add_tags: ['warm', 'warm'], remove_tags: ['cold'] } },
      { type: 'lead.changestage', name: 'Move to MQL', properties: { addstage: '4' } },
    ],
  });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/api/points/triggers/new');
  assert.deepEqual(calls[0].body!.events, [
    { name: 'Change tags', type: 'lead.changetags', properties: { add_tags: ['warm'], remove_tags: ['cold'] } },
    { name: 'Move to MQL', type: 'lead.changestage', properties: { addstage: 4 } },
  ]);
  assert.deepEqual(saved.events.map(event => [event.id, event.type, event.properties]), [
    [31, 'lead.changetags', { add_tags: ['warm'], remove_tags: [] }],
    [32, 'lead.changestage', { addstage: 4 }],
  ]);
});

test('AUD-01 every trigger event type is sent with the property keys Mautic reads', async () => {
  const { api, calls } = client(() => ({ trigger: storedTrigger }));
  await api.createPointTrigger({
    name: 'Everything', points: 10,
    events: [
      { type: 'lead.changelists', properties: { addToLists: [3, 4], removeFromLists: [] } },
      { type: 'email.send', properties: { email: 7 } },
      { type: 'email.send_to_user', properties: { useremail: { email: 8 }, user_id: ['2'], to_owner: true, to: 'sales@example.test' } },
      { type: 'campaign.changecampaign', properties: { addTo: [5], removeFrom: [6] } },
      { type: 'plugin.leadpush', properties: { integration: ' Hubspot ' } },
    ],
  });
  const events = calls[0].body!.events as { type: string; properties: unknown }[];
  assert.deepEqual(events.map(event => event.properties), [
    { addToLists: [3, 4], removeFromLists: [] },
    { email: 7 },
    { useremail: { email: 8 }, user_id: [2], to_owner: true, to: 'sales@example.test', cc: '', bcc: '' },
    { addTo: [5], removeFrom: [6] },
    { integration: 'Hubspot' },
  ]);
});

test('AUD-01 an incomplete or unknown trigger event is rejected before it reaches the engine', async () => {
  const { api, calls } = client(() => ({ trigger: storedTrigger }));
  const bad = [
    { type: 'lead.changelists', properties: {} },
    { type: 'lead.changetags', properties: { add_tags: ['-nope'] } },
    { type: 'lead.changestage', properties: {} },
    { type: 'email.send', properties: { email: 0 } },
    { type: 'email.send_to_user', properties: { useremail: { email: 3 } } },
    { type: 'campaign.changecampaign', properties: { addTo: ['x'] } },
    { type: 'plugin.leadpush', properties: {} },
    { type: 'form.submit', properties: {} },
  ];
  for (const event of bad) {
    await assert.rejects(api.createPointTrigger({ name: 'Bad', points: 5, events: [event as never] }), (error: unknown) =>
      error instanceof UpstreamError && error.status === 400);
  }
  assert.equal(calls.length, 0);
});

test('AUD-01 editing without events leaves them alone, editing with events replaces them with a PUT', async () => {
  const { api, calls } = client(() => ({ trigger: storedTrigger }));
  await api.updatePointTrigger(9, { name: 'Renamed' });
  assert.equal(calls[0].method, 'PATCH');
  assert.equal('events' in calls[0].body!, false);

  calls.length = 0;
  await api.updatePointTrigger(9, {
    points: 75,
    events: [
      { id: 31, type: 'lead.changetags', properties: { add_tags: ['hot'] } },
      { id: 999, type: 'email.send', properties: { email: 2 } },
    ],
  });
  assert.deepEqual(calls.map(call => [call.method, call.path]), [['GET', '/api/points/triggers/9'], ['PUT', '/api/points/triggers/9/edit']]);
  const body = calls[1].body!;
  assert.equal(body.name, 'Warm lead');
  assert.equal(body.points, 75);
  assert.equal(body.isPublished, true);
  // Event 32 is left out, so the PUT removes it. An id the trigger does not own becomes a new event.
  assert.deepEqual(body.events.map((event: { id?: number; type: string }) => [event.id, event.type]), [[31, 'lead.changetags'], [undefined, 'email.send']]);
});

const definitions = [
  { id: 1, label: 'Age', alias: 'age', type: 'number', isPublished: true },
  { id: 2, label: 'Newsletter', alias: 'wants_news', type: 'boolean', isPublished: true },
  { id: 3, label: 'Renewal', alias: 'renewal', type: 'date', isPublished: true },
  { id: 4, label: 'Seen', alias: 'last_seen', type: 'datetime', isPublished: true },
  { id: 5, label: 'Plan', alias: 'plan', type: 'select', isPublished: true, properties: { list: [{ label: 'free', value: 'free' }, { label: 'pro', value: 'pro' }] } },
  { id: 6, label: 'Interests', alias: 'interests', type: 'multiselect', isPublished: true, properties: { list: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] } },
  { id: 7, label: 'Blog', alias: 'blog', type: 'url', isPublished: true },
  { id: 8, label: 'Backup email', alias: 'backup_email', type: 'email', isPublished: true },
  { id: 9, label: 'Nickname', alias: 'nickname', type: 'text', isPublished: true },
  { id: 10, label: 'Zone', alias: 'zone', type: 'timezone', isPublished: true },
  { id: 11, label: 'Mobile', alias: 'mobile', type: 'tel', isPublished: true },
  { id: 12, label: 'Locale', alias: 'lang', type: 'locale', isPublished: true },
  { id: 13, label: 'Tier', alias: 'tier', type: 'text', isPublished: true, isRequired: true },
  { id: 14, label: 'Retired', alias: 'retired', type: 'text', isPublished: false },
];

const stored = {
  id: 5, doNotContact: [], points: 3,
  fields: { all: { email: 'a@example.test', firstname: 'Ada', plan: 'pro', age: '41', interests: 'a|b', wants_news: '1', last_seen: '', id: 5, points: 3 } },
  tags: [],
};

function contactClient(onWrite?: (seen: Seen) => void) {
  return client(seen => {
    if (seen.path === '/api/fields/contact') return { total: definitions.length, fields: definitions };
    if (seen.method === 'GET' && seen.path === '/api/contacts') return { total: 1, contacts: { 5: stored } };
    onWrite?.(seen);
    return { contact: stored };
  });
}

test('AUD-02 custom field values round-trip through create and detail', async () => {
  const { api, calls } = contactClient();
  const created = await api.createContact({
    email: 'A@Example.test', firstName: 'Ada',
    customFields: { age: '41', plan: 'pro', interests: ['a', 'b'], wants_news: 'yes', last_seen: '2026-05-01T10:30', renewal: '2026-12-31', nickname: ' Countess ' },
  });
  const write = calls.find(call => call.method === 'POST')!;
  assert.equal(write.path, '/api/contacts/new');
  assert.deepEqual(
    Object.fromEntries(['age', 'plan', 'interests', 'wants_news', 'last_seen', 'renewal', 'nickname'].map(key => [key, write.body![key]])),
    { age: '41', plan: 'pro', interests: 'a|b', wants_news: '1', last_seen: '2026-05-01 10:30:00', renewal: '2026-12-31', nickname: 'Countess' },
  );
  assert.equal(write.body!.firstname, 'Ada');
  assert.equal(write.body!.email, 'a@example.test');
  // Core fields stay out of customFields, empty values are dropped and the rest come back as strings.
  assert.deepEqual(created.customFields, { plan: 'pro', age: '41', interests: 'a|b', wants_news: '1' });
  assert.equal(created.firstName, 'Ada');

  const detail = await api.contact(5);
  assert.equal(detail.customFields?.plan, 'pro');
  const page = await api.contacts();
  assert.equal(page.items[0].customFields?.age, '41');
});

test('AUD-02 custom field values are checked against the field definition type', async () => {
  const { api, calls } = contactClient();
  const rejected: Record<string, string>[] = [
    { age: 'forty' }, { wants_news: 'maybe' }, { renewal: '31/12/2026' }, { renewal: '2026-02-31' }, { last_seen: 'yesterday' },
    { plan: 'enterprise' }, { blog: 'not a url' }, { blog: 'javascript:alert(1)' }, { backup_email: 'nope' },
    { zone: 'Mars/Base' }, { mobile: 'call me' }, { lang: 'english' }, { tier: '' },
    { nobody: 'x' }, { retired: 'x' }, { firstname: 'Ada' },
  ];
  for (const values of rejected) {
    await assert.rejects(api.createContact({ email: 'a@example.test', customFields: values }), (error: unknown) =>
      error instanceof UpstreamError && error.status === 400, JSON.stringify(values));
  }
  await assert.rejects(api.createContact({ email: 'a@example.test', customFields: { interests: ['a', 'z'], tier: 'x' } }));
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  await api.createContact({ email: 'a@example.test', customFields: { tier: 'gold', zone: 'Europe/London', mobile: '+44 20 7946 0192', lang: 'en_GB', blog: 'https://example.test/blog' } });
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('AUD-02 an empty custom value clears the field with overwriteWithBlank and an untouched field is not sent', async () => {
  let write: Seen | undefined;
  const { api } = contactClient(seen => { write = seen; });
  await api.updateContact(5, { email: 'a@example.test', customFields: { nickname: '', plan: 'free' } });
  assert.equal(write!.method, 'PATCH');
  assert.equal(write!.path, '/api/contacts/5/edit');
  assert.equal(write!.body!.nickname, '');
  assert.equal(write!.body!.plan, 'free');
  assert.equal(write!.body!.overwriteWithBlank, true);
  assert.equal('age' in write!.body!, false);

  await api.updateContact(5, { email: 'a@example.test', customFields: { plan: 'pro' } });
  assert.equal('overwriteWithBlank' in write!.body!, false);
  await api.updateContact(5, { email: 'a@example.test', firstName: 'Ada' });
  assert.equal('plan' in write!.body!, false);
});

test('AUD-02 a required custom field cannot be cleared', async () => {
  const { api } = contactClient();
  await assert.rejects(api.updateContact(5, { email: 'a@example.test', customFields: { tier: '   ' } }), /Tier: this field is required/);
});

test('AUD-02 the contact form schema accepts custom field values and rejects malformed aliases', () => {
  const base = { email: 'a@example.test' };
  assert.deepEqual(contactFields.parse({ ...base, customFields: { plan: 'pro', interests: ['a'] } }).customFields, { plan: 'pro', interests: ['a'] });
  assert.throws(() => contactFields.parse({ ...base, customFields: { 'Bad Alias': 'x' } }));
  assert.throws(() => contactFields.parse({ ...base, customFields: { plan: 5 } }));
});

type Query = { sql: string; values: unknown[] | undefined };

// Runs a task with the database and the engine replaced by recordings; restores both afterwards.
async function withEngine(task: (writes: Seen[]) => Promise<void>) {
  const writes: Seen[] = [];
  const original = { fetch: globalThis.fetch, query: db.query, connect: db.connect, env: { ...process.env } };
  process.env.CONTACT_HMAC_KEY = 'unit-test-key-unit-test-key-unit-test-key';
  process.env.MAUTIC_URL = 'http://marketing-engine.local';
  process.env.MAUTIC_USERNAME = 'integration';
  process.env.MAUTIC_PASSWORD = 'unit-test-password';
  const run = async (sql: string) => {
    const rows = /FROM suppressions/.test(sql) || /contact_id = ANY/.test(sql) ? []
      : /INSERT INTO contact_state/.test(sql) ? [{ contact_id: '5', email_key: 'k', subscriber_id: null, consent: 'unknown' }] : [];
    return { rows, rowCount: rows.length } as never;
  };
  const queries: Query[] = [];
  db.query = (async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return run(sql); }) as never;
  db.connect = (async () => ({ query: run, release() {} })) as never;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const seen: Seen = { method: request.method, path: url.pathname, search: url.search, body: text.startsWith('{') ? JSON.parse(text) : null };
    if (url.pathname === '/api/fields/contact') return Response.json({ total: definitions.length, fields: definitions });
    if (request.method === 'GET' && url.pathname === '/api/contacts') return Response.json({ total: 1, contacts: { 5: stored } });
    writes.push(seen);
    return Response.json({ contact: stored });
  }) as typeof fetch;
  try {
    await task(writes);
  } finally {
    globalThis.fetch = original.fetch;
    db.query = original.query;
    db.connect = original.connect;
    process.env = original.env;
  }
}

test('AUD-02 CSV import fills custom fields from columns named after their alias', async () => {
  await withEngine(async writes => {
    const csv = [
      'email,first_name,Plan,Interests,wants-news,age,retired',
      'a@example.test,Ada,pro,a|b,yes,41,ignored',
      'b@example.test,Bea,enterprise,,,,',
      'c@example.test,Cy,,,,,',
    ].join('\n');
    const result = await importContacts(csv);
    assert.deepEqual(result.failed, [{ row: 3, message: 'Plan: choose one of the listed options.' }]);
    assert.equal(result.imported, 2);
    assert.deepEqual(result.failed, [{ row: 3, message: 'Plan: choose one of the listed options.' }]);
    const first = writes.find(write => write.body?.email === 'a@example.test')!;
    assert.deepEqual(
      [first.body!.plan, first.body!.interests, first.body!.age, 'retired' in first.body!],
      ['pro', 'a|b', '41', false],
    );
    // Blank cells never clear a stored value.
    const last = writes.find(write => write.body?.email === 'c@example.test')!;
    assert.equal('plan' in last.body!, false);
    assert.equal('overwriteWithBlank' in last.body!, false);
  });
});

test('AUD-02 contact export carries a column per custom field alias', async () => {
  await withEngine(async () => {
    const lines = (await exportContacts()).trim().split(/\r?\n/);
    const header = lines[0].split(',');
    assert.deepEqual(header.slice(0, 10), ['email', 'first_name', 'last_name', 'company', 'phone', 'position', 'city', 'country', 'tags', 'consent']);
    assert.deepEqual(header.slice(10), definitions.filter(field => field.isPublished).sort((a, b) => a.label.localeCompare(b.label)).map(field => field.alias));
    const row = lines[1].split(',');
    assert.equal(row[header.indexOf('plan')], 'pro');
    assert.equal(row[header.indexOf('interests')], 'a|b');
    assert.equal(row[header.indexOf('nickname')], '');
  });
});
