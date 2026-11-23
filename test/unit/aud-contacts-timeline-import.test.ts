import assert from 'node:assert/strict';
import test from 'node:test';
import { contactSearchCommands, contactSortKeys } from '../../src/contracts';
import { createMautic } from '../../src/server/mautic';
import { UpstreamError } from '../../src/server/upstream';
import {
  createImportDraft, deleteContactView, importIssuesCsv, listContactViews, runContactImport, saveContactView, startImport, suggestImportMapping,
} from '../../src/server/audience';
import { db } from '../../src/server/db';

type Seen = { method: string; path: string; params: URLSearchParams; body: Record<string, unknown> | null };

function client(handler: (seen: Seen) => unknown) {
  const calls: Seen[] = [];
  const api = createMautic({
    url: 'http://marketing-engine.local/', username: 'integration', password: 'unit-test-password',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.text();
      const seen: Seen = { method: request.method, path: url.pathname, params: url.searchParams, body: text.startsWith('{') ? JSON.parse(text) : null };
      calls.push(seen);
      return Response.json(handler(seen));
    },
  });
  return { api, calls };
}

const person = (id: number, email: string) => ({ id, dateAdded: '2026-10-24T16:09:00+00:00', points: 1, doNotContact: [], fields: { all: { email } }, tags: [] });

/* ── AUD-03: contact list ─────────────────────────────────────────────────── */

test('AUD-03 command searches reach the engine unchanged and plain words are quoted as one phrase', async () => {
  const { api, calls } = client(() => ({ total: 0, contacts: [] }));
  await api.contacts({ search: 'tag:vip is:unowned !email:*@example.test' });
  await api.contacts({ search: 'Ada Lovelace' });
  await api.contacts({ search: 'name:ada', tag: 'vip' });
  assert.equal(calls[0].params.get('search'), 'tag:vip is:unowned !email:*@example.test');
  assert.equal(calls[1].params.get('search'), '"Ada Lovelace"');
  assert.equal(calls[2].params.get('search'), 'tag:"vip" name:ada');
  await assert.rejects(api.contacts({ search: 'name:"ada' }), (error: unknown) => error instanceof UpstreamError && error.status === 400);
});

test('AUD-03 every one of the search commands in the catalogue is accepted', async () => {
  assert.equal(contactSearchCommands.length, 28);
  const { api, calls } = client(() => ({ total: 0, contacts: [] }));
  for (const item of contactSearchCommands) await api.contacts({ search: item.example });
  assert.deepEqual(calls.map(call => call.params.get('search')), contactSearchCommands.map(item => item.example));
});

test('AUD-03 anonymous contacts show only when the search asks for them', async () => {
  const { api, calls } = client(() => ({ total: 0, contacts: [] }));
  await api.contacts({ search: 'is:anonymous' });
  await api.contacts({ search: 'tag:vip' });
  assert.equal(calls[0].params.has('where[0][col]'), false);
  assert.equal(calls[1].params.get('where[0][col]'), 'l.date_identified');
});

test('AUD-03 any listable column sorts through orderBy and orderByDir, and the engine order is kept', async () => {
  const { api, calls } = client(() => ({ total: 2, contacts: { 1: person(1, 'a@example.test'), 2: person(2, 'b@example.test') } }));
  const page = await api.contacts({ orderBy: 'email', orderByDir: 'asc' });
  assert.equal(calls[0].params.get('orderBy'), 'l.email');
  assert.equal(calls[0].params.get('orderByDir'), 'ASC');
  assert.deepEqual(page.items.map(item => item.id), [1, 2]);
  for (const key of contactSortKeys) {
    await api.contacts({ orderBy: key });
    assert.match(calls.at(-1)!.params.get('orderBy')!, /^l\.[a-z_]+$/);
  }
  // @ts-expect-error not a listable column
  await assert.rejects(api.contacts({ orderBy: 'password' }), (error: unknown) => error instanceof UpstreamError && error.status === 400);
});

test('AUD-03 a page larger than 100 is read from the engine in chunks of 100', async () => {
  const { api, calls } = client(seen => {
    const start = Number(seen.params.get('start'));
    const size = Number(seen.params.get('limit'));
    return { total: 1000, contacts: Object.fromEntries(Array.from({ length: size }, (_, i) => [start + i + 1, person(start + i + 1, `p${start + i + 1}@example.test`)])) };
  });
  const page = await api.contacts({ page: 2, limit: 250 });
  assert.deepEqual(calls.map(call => [call.params.get('start'), call.params.get('limit')]), [['250', '100'], ['350', '100'], ['450', '50']]);
  assert.equal(page.items.length, 250);
  assert.equal(page.limit, 250);
  assert.equal(page.total, 1000);
});

async function withDb(handler: (sql: string, values?: unknown[]) => unknown[], task: () => Promise<void>) {
  const original = { query: db.query, connect: db.connect };
  const run = async (sql: string, values?: unknown[]) => { const rows = handler(sql, values); return { rows, rowCount: rows.length } as never; };
  db.query = run as never;
  db.connect = (async () => ({ query: run, release() {} })) as never;
  try { await task(); } finally { db.query = original.query; db.connect = original.connect; }
}

test('AUD-03 saved views are stored for the whole team, with unique names', async () => {
  const stored = { id: 'v1', name: 'VIPs', search: 'tag:vip', sort_by: 'points', sort_dir: 'desc', created_by: 'u1', updated_at: new Date('2026-11-01T00:00:00Z') };
  let duplicate = false;
  const sql: string[] = [];
  await withDb(text => {
    sql.push(text);
    if (duplicate && /INSERT INTO contact_views/.test(text)) throw Object.assign(new Error('dup'), { code: '23505' });
    return [stored];
  }, async () => {
    const saved = await saveContactView({ name: 'VIPs', search: 'tag:vip', sortBy: 'points', sortDir: 'desc' }, 'u1');
    assert.deepEqual([saved.name, saved.search, saved.sortBy, saved.sortDir], ['VIPs', 'tag:vip', 'points', 'desc']);
    assert.equal((await listContactViews()).length, 1);
    await deleteContactView('v1');
    duplicate = true;
    await assert.rejects(saveContactView({ name: 'vips', search: '', sortBy: 'email', sortDir: 'asc' }), { status: 409 });
  });
  assert.ok(sql.some(text => /DELETE FROM contact_views/.test(text)));
});

/* ── AUD-07: point actions ────────────────────────────────────────────────── */

function pointClient(stored: Record<string, unknown> = {}) {
  return client(seen => {
    if (seen.path === '/api/points/groups') return { total: 1, pointGroups: { 3: { id: 3, name: 'Engagement' } } };
    if (seen.method === 'GET') return { point: { id: 8, name: 'Rule', type: 'url.hit', delta: 5, ...stored } };
    return { point: { id: 8, name: 'Rule', type: 'x', delta: 5, ...seen.body, group: seen.body?.group ? { id: seen.body.group, name: 'Engagement' } : null } };
  });
}

test('AUD-07 every action type stores the property key its engine subscriber reads', async () => {
  const { api, calls } = pointClient();
  const create = (type: string, properties: Record<string, unknown>) => api.createPointAction({ name: 'R', type, delta: 5, properties });
  await create('email.open', { emails: ['4', 4, 6] });
  await create('email.send', { emails: [7] });
  await create('form.submit', { forms: [2] });
  await create('page.hit', { pages: [9, 10] });
  await create('asset.download', { assets: [11] });
  await create('url.hit', { page_url: ' https://example.test/pricing* ', page_hits: '3', first_time: true, returns_within: '2', returns_within_unit: 'D' });
  assert.deepEqual(calls.map(call => call.body!.properties), [
    { emails: [4, 6] }, { emails: [7] }, { forms: [2] }, { pages: [9, 10] }, { assets: [11] },
    {
      page_url: 'https://example.test/pricing*', page_hits: 3, first_time: true,
      accumulative_time: '', accumulative_time_unit: 'H', returns_within: '2', returns_within_unit: 'D', returns_after: '', returns_after_unit: 'H',
    },
  ]);
});

test('AUD-07 repeatable and the point group are sent and read back', async () => {
  const { api, calls } = pointClient();
  const saved = await api.createPointAction({ name: 'R', type: 'form.submit', delta: 5, repeatable: true, groupId: 3 });
  assert.equal(calls[0].body!.repeatable, true);
  assert.equal(calls[0].body!.group, 3);
  assert.deepEqual([saved.repeatable, saved.groupId, saved.groupName], [true, 3, 'Engagement']);
  const cleared = await api.updatePointAction(8, { groupId: null, repeatable: false });
  assert.equal(calls.at(-1)!.body!.group, null);
  assert.equal(cleared.groupId, null);
  assert.deepEqual(await api.pointGroups(), [{ id: 3, name: 'Engagement' }]);
});

test('AUD-07 bad properties are refused before anything is sent', async () => {
  const { api, calls } = pointClient();
  await assert.rejects(api.createPointAction({ name: 'R', type: 'url.hit', delta: 1, properties: {} }), { status: 400 });
  await assert.rejects(api.createPointAction({ name: 'R', type: 'email.open', delta: 1, properties: { emails: ['x'] } }), { status: 400 });
  await assert.rejects(api.createPointAction({ name: 'R', type: 'form.submit', delta: 1, groupId: 0 }), { status: 400 });
  assert.equal(calls.length, 0);
});

test('AUD-07 changing only the properties of a rule keeps its stored type', async () => {
  const { api, calls } = pointClient({ type: 'page.hit' });
  await api.updatePointAction(8, { properties: { pages: [3] } });
  assert.deepEqual(calls.at(-1)!.body!.properties, { pages: [3] });
});

/* ── AUD-09: timeline ─────────────────────────────────────────────────────── */

test('AUD-09 the timeline asks for filters, search, order and paging, and returns every event type', async () => {
  const { api, calls } = client(() => ({
    total: 61, page: 2, limit: 25,
    types: { 'email.read': 'Email read', 'form.submitted': 'Form submitted', 'page.hit': 'Page hit' },
    events: [
      { event: 'email.read', eventId: '5', eventLabel: { label: 'Welcome', href: 'https://engine.test/email/5' }, eventType: 'Email read', timestamp: '2026-10-25T10:00:00+00:00' },
      { event: 'form.submitted', eventId: '6', eventLabel: 'Newsletter form', timestamp: '2026-10-24T10:00:00+00:00' },
      { event: 'page.hit', eventId: '7', eventLabel: '', eventType: 'Page hit', timestamp: 'bad' },
    ],
  }));
  const timeline = await api.contactTimeline(17, { page: 2, limit: 25, search: 'welcome', include: ['email.read', 'page.hit'], exclude: ['form.submitted'] });
  const params = calls[0].params;
  assert.equal(calls[0].path, '/api/contacts/17/activity');
  assert.deepEqual(params.getAll('filters[includeEvents][]'), ['email.read', 'page.hit']);
  assert.deepEqual(params.getAll('filters[excludeEvents][]'), ['form.submitted']);
  assert.deepEqual([params.get('filters[search]'), params.get('page'), params.get('limit'), params.get('order[0]'), params.get('order[1]')], ['welcome', '2', '25', 'timestamp', 'DESC']);
  assert.deepEqual(timeline.events.map(event => [event.type, event.typeLabel, event.label]), [
    ['email.read', 'Email read', 'Welcome'], ['form.submitted', 'Form submitted', 'Newsletter form'],
  ]);
  assert.equal(timeline.events[0].href, 'https://engine.test/email/5');
  assert.deepEqual([timeline.total, timeline.page, Object.keys(timeline.types).length], [61, 2, 3]);
});

test('AUD-09 the detail view still gets the latest events through the same call', async () => {
  const { api, calls } = client(() => ({ total: 1, types: {}, events: [{ event: 'lead.create', eventLabel: 'Created', timestamp: '2026-10-25T10:00:00+00:00' }] }));
  const events = await api.contactActivity(17);
  assert.equal(calls[0].params.get('limit'), '25');
  assert.deepEqual(events.map(event => [event.type, event.label]), [['lead.create', 'Created']]);
  await assert.rejects(api.contactTimeline(17, { page: 0 }), { status: 400 });
});

/* ── AUD-10: import ───────────────────────────────────────────────────────── */

type ImportState = {
  row: Record<string, unknown>; issues: Map<number, { outcome: string; email: string; message: string }>; jobs: { key: string }[];
};

function importDb(csv: string, over: Record<string, unknown> = {}): ImportState {
  return {
    row: {
      id: 'i1', file_name: 'c.csv', status: 'queued', dry_run: false, csv, mapping: { email: 'email', name: 'firstName' }, evidence: null,
      update_existing: true, total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: 0, created_at: new Date(), finished_at: null, ...over,
    },
    issues: new Map(), jobs: [],
  };
}

function importHandler(state: ImportState) {
  return (sql: string, values?: unknown[]) => {
    if (/UPDATE contact_imports SET processed/.test(sql)) {
      const [, processed, created, updated, skipped, errors] = values as number[];
      Object.assign(state.row, {
        processed, created: Number(state.row.created) + created, updated: Number(state.row.updated) + updated,
        skipped: Number(state.row.skipped) + skipped, errors: Number(state.row.errors) + errors,
      });
      return [];
    }
    if (/INSERT INTO contact_import_issues/.test(sql)) {
      for (const issue of JSON.parse(values![1] as string)) state.issues.set(issue.row, issue);
      return [];
    }
    if (/INSERT INTO contact_imports/.test(sql)) return [state.row];
    if (/INSERT INTO jobs/.test(sql)) { state.jobs.push({ key: (values![1] as string) }); return []; }
    if (/SET status = 'running'/.test(sql)) { state.row.status = 'running'; return []; }
    if (/SET status = 'done'/.test(sql)) {
      Object.assign(state.row, { status: 'done', csv: state.row.dry_run ? state.row.csv : '' });
      return [{ created: state.row.created, updated: state.row.updated }];
    }
    if (/FROM contact_imports WHERE id/.test(sql)) return [state.row];
    if (/INSERT INTO contact_state/.test(sql)) return [{ contact_id: '5', email_key: 'k', subscriber_id: null, consent: 'unknown' }];
    if (/FROM suppressions WHERE email_key = ANY|FROM suppressions/.test(sql)) return suppressedKeys.size ? [{ one: 1 }] : [];
    return [];
  };
}
let suppressedKeys = new Set<string>();

type Engine = { existing: Set<string>; writes: string[] };

async function withImportEngine(state: ImportState, engine: Engine, task: () => Promise<void>) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  process.env.CONTACT_HMAC_KEY = 'unit-test-key-unit-test-key-unit-test-key';
  process.env.MAUTIC_URL = 'http://marketing-engine.local';
  process.env.MAUTIC_USERNAME = 'integration';
  process.env.MAUTIC_PASSWORD = 'unit-test-password';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/api/fields/contact') return Response.json({ total: 0, fields: [] });
    if (request.method === 'GET' && url.pathname === '/api/contacts') {
      const email = url.searchParams.get('where[0][val]') ?? '';
      return Response.json(engine.existing.has(email) ? { total: 1, contacts: { 9: person(9, email) } } : { total: 0, contacts: [] });
    }
    const body = JSON.parse(await request.text()) as { email: string };
    engine.writes.push(body.email);
    return Response.json({ contact: person(5, body.email) });
  }) as typeof fetch;
  try { await withDb(importHandler(state), task); } finally { globalThis.fetch = saved.fetch; process.env = saved.env; suppressedKeys = new Set(); }
}

test('AUD-10 columns are mapped to core and custom fields by name', () => {
  const mapping = suggestImportMapping(
    ['E-mail', 'First Name', 'Last_name', 'Organisation', 'Plan Tier', 'Favourite colour', 'notes'],
    [{ alias: 'plan_tier', label: 'Tier' }, { alias: 'colour', label: 'Favourite colour' }],
  );
  assert.deepEqual(mapping, {
    'E-mail': 'email', 'First Name': 'firstName', 'Last_name': 'lastName', Organisation: 'company',
    'Plan Tier': 'custom:plan_tier', 'Favourite colour': 'custom:colour', notes: 'skip',
  });
});

test('AUD-10 an upload makes a draft with a preview and a suggested mapping, and writes nothing to the audience', async () => {
  const csv = 'Email,First name\na@example.test,Ada\nb@example.test,Bea\n';
  const state = importDb(csv);
  await withImportEngine(state, { existing: new Set(), writes: [] }, async () => {
    const draft = await createImportDraft(csv, 'people.csv', 'u1');
    assert.deepEqual([draft.preview.rowCount, draft.preview.mapping], [2, { Email: 'email', 'First name': 'firstName' }]);
    assert.deepEqual(draft.preview.rows[0], ['a@example.test', 'Ada']);
  });
});

test('AUD-10 a dry run reports created, updated and skipped rows with reasons without writing', async () => {
  const csv = ['email,name,consent', 'new@example.test,Ada,', 'old@example.test,Bea,', 'bad,Cy,', 'opt@example.test,Di,opted_in'].join('\n');
  const state = importDb(csv, { dry_run: true, total: 4, mapping: { email: 'email', name: 'firstName', consent: 'consent' } });
  const engine: Engine = { existing: new Set(['old@example.test']), writes: [] };
  await withImportEngine(state, engine, async () => {
    await runContactImport('i1');
    assert.equal(state.row.status, 'done');
    assert.deepEqual([state.row.created, state.row.updated, state.row.skipped, state.row.errors], [1, 1, 0, 2]);
    assert.deepEqual([...state.issues.values()].map(issue => issue.message), ['Check the email and field lengths.', 'Record where and when the contact consented.']);
    assert.deepEqual(engine.writes, []);
    // The dry run keeps the upload so the real run can follow it.
    assert.equal(state.row.csv, csv);
  });
});

test('AUD-10 existing contacts are skipped when updates are switched off', async () => {
  const csv = 'email,name\nold@example.test,Bea\nnew@example.test,Ada\n';
  const state = importDb(csv, { update_existing: false, total: 2 });
  const engine: Engine = { existing: new Set(['old@example.test']), writes: [] };
  await withImportEngine(state, engine, async () => {
    await runContactImport('i1');
    assert.deepEqual([state.row.created, state.row.updated, state.row.skipped], [1, 0, 1]);
    assert.deepEqual(engine.writes, ['new@example.test']);
    assert.match([...state.issues.values()][0].message, /already exists/);
  });
});

test('AUD-10 opted_in rows keep the evidence and suppression rules', async () => {
  const csv = ['email,consent,evidence', 'a@example.test,opted_in,', 'b@example.test,opted_in,Signup form 2026-01-15', 'c@example.test,opted_in,Signup form'].join('\n');
  const state = importDb(csv, { mapping: { email: 'email', consent: 'consent', evidence: 'evidence' }, total: 3 });
  suppressedKeys = new Set(['any']);
  await withImportEngine(state, { existing: new Set(), writes: [] }, async () => {
    await runContactImport('i1');
    const messages = [...state.issues.entries()].map(([row, issue]) => [row, issue.message]);
    assert.deepEqual(messages, [[2, 'Record where and when the contact consented.'], [3, 'This email address is suppressed.'], [4, 'This email address is suppressed.']]);
    assert.equal(state.row.created, 0);
  });
});

test('AUD-10 more than 500 rows import in batches and the job queues itself when its time slice ends', async () => {
  const rows = Array.from({ length: 650 }, (_, i) => `p${i}@example.test,Person ${i}`);
  const csv = ['email,name', ...rows].join('\n');
  const state = importDb(csv, { total: 650 });
  const engine: Engine = { existing: new Set(), writes: [] };
  await withImportEngine(state, engine, async () => {
    // First slice: the clock jumps past the deadline after three batches, so progress is saved and a continuation is queued.
    let ticks = 0;
    await runContactImport('i1', () => (++ticks > 4 ? 1e12 : 0));
    assert.equal(state.row.status, 'running');
    assert.equal(state.row.processed, 120);
    assert.deepEqual(state.jobs, [{ key: 'contact_import:i1:120' }]);
    // Second slice resumes from the saved row and finishes without the cap.
    await runContactImport('i1');
    assert.equal(state.row.status, 'done');
    assert.deepEqual([state.row.processed, state.row.created, state.row.errors], [650, 650, 0]);
    assert.equal(new Set(engine.writes).size, 650);
    // A finished real run drops the stored upload.
    assert.equal(state.row.csv, '');
  });
});

test('AUD-10 starting a run checks the mapping, queues one job and refuses a second while it runs', async () => {
  const csv = 'email,name\na@example.test,Ada\n';
  const state = importDb(csv, { status: 'draft' });
  await withImportEngine(state, { existing: new Set(), writes: [] }, async () => {
    await assert.rejects(startImport('i1', { mapping: { email: 'skip', name: 'firstName' }, dryRun: false, updateExisting: true }), { status: 400 });
    await assert.rejects(startImport('i1', { mapping: { email: 'email', name: 'email' }, dryRun: false, updateExisting: true }), { status: 400 });
    const run = await startImport('i1', { mapping: { email: 'email', name: 'firstName' }, dryRun: true, updateExisting: true });
    assert.equal(run.id, 'i1');
    assert.deepEqual(state.jobs, [{ key: 'contact_import:i1:0' }]);
    state.row.status = 'running';
    await assert.rejects(startImport('i1', { mapping: { email: 'email' }, dryRun: false, updateExisting: true }), { status: 409 });
  });
});

test('AUD-10 skipped and failed rows download as a CSV with the reason', async () => {
  const state = importDb('');
  await withDb(sql => /contact_import_issues/.test(sql)
    ? [{ row_number: 3, outcome: 'error', email: 'bad', message: 'Check the email and field lengths.' }] : [state.row], async () => {
    const csv = await importIssuesCsv('i1');
    assert.equal(csv, 'row,result,email,reason\r\n3,error,bad,Check the email and field lengths.');
  });
});
