import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentFilterFromRule, emptySegmentRule, staticSegmentFields } from '../../src/contracts';
import { segmentFiltersPayload } from '../../src/server/mautic/helpers';

// The newsletter engine client reads its address when the module loads, so the environment is set first.
process.env.CONTACT_HMAC_KEY = 'unit-test-key-unit-test-key-unit-test-key';
process.env.MAUTIC_URL = 'http://marketing-engine.local';
process.env.MAUTIC_USERNAME = 'integration';
process.env.MAUTIC_PASSWORD = 'unit-test-password';
process.env.LISTMONK_URL = 'http://newsletter-engine.local';
process.env.LISTMONK_USERNAME = 'service';
process.env.LISTMONK_PASSWORD = 'secret';

const audience = await import('../../src/server/audience');
const { db } = await import('../../src/server/db');
const { emailKey } = await import('../../src/server/config');
const { maintainJobs } = await import('../../src/server/jobs');

/* ── A small world: both engines and the OVELIO database, in memory ───────── */

type Dnc = { id: number; reason: number; comments: string; dateAdded: string };
type Sub = { id: number; email: string; status: 'enabled' | 'blocklisted'; updated_at: string; lists: { id: number; subscription_status: string; subscription_updated_at: string }[] };
type Job = { kind: string; key: string; payload: Record<string, unknown> };

const address = 'ada@example.test';
const key = emailKey(address);
let tickCount = 0;
const clock = () => new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + (++tickCount) * 1000);

function createWorld() {
  const world = {
    dnc: new Map<string, Dnc>(),
    nextDncId: 0,
    mauticDown: false,
    listmonkDown: false,
    sub: { id: 11, email: address, status: 'enabled', updated_at: clock().toISOString(), lists: [{ id: 3, subscription_status: 'confirmed', subscription_updated_at: clock().toISOString() }] } as Sub,
    suppressions: new Map<string, { reason: string; comment: string; created_at: Date }>(),
    removals: new Map<string, { removed_at: Date; reason: string }>(),
    state: { contact_id: '1', email_key: key, subscriber_id: '11', consent: 'opted_in' } as { contact_id: string; email_key: string; subscriber_id: string | null; consent: string },
    events: [] as { action: string; evidence: string }[],
    jobs: [] as Job[],
    settings: new Map<string, unknown>(),
    lockFree: true,
    sql: [] as string[],
    listmonkQueries: [] as URLSearchParams[],
  };
  return world;
}
type World = ReturnType<typeof createWorld>;

function setDnc(world: World, channel: string, reason: number, comments: string) {
  world.dnc.set(channel, { id: ++world.nextDncId, reason, comments, dateAdded: clock().toISOString() });
}

function mauticContact(world: World) {
  return {
    id: 1, dateAdded: '2026-10-24T16:09:00+00:00', points: 0, tags: [], fields: { all: { email: address } },
    doNotContact: [...world.dnc].map(([channel, entry]) => ({ id: entry.id, channel, reason: entry.reason, comments: entry.comments, dateAdded: entry.dateAdded })),
  };
}

function nativeSub(sub: Sub) {
  return { id: sub.id, email: sub.email, name: 'Ada', status: sub.status, updated_at: sub.updated_at, attribs: { mautic_id: 1 }, lists: sub.lists };
}

function fakeFetch(world: World): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const path = url.pathname;
    if (url.host === 'marketing-engine.local') {
      const dncRoute = path.match(/^\/api\/contacts\/1\/dnc\/([a-z]+)\/(add|remove)$/);
      if (dncRoute && request.method === 'POST') {
        const [, channel, verb] = dncRoute;
        if (verb === 'add') {
          // Mautic keeps an existing unsubscribed row as it is.
          if (world.dnc.get(channel)?.reason !== 1) {
            const form = new URLSearchParams(text);
            setDnc(world, channel, Number(form.get('reason')), form.get('comments') ?? '');
          }
        } else world.dnc.delete(channel);
        return Response.json({ contact: mauticContact(world) });
      }
      if (world.mauticDown) return Response.json({ message: 'down' }, { status: 503 });
      if (path === '/api/stats/lead_donotcontact') {
        const after = Number(url.searchParams.get('where[0][val]'));
        const desc = url.searchParams.get('order[0][dir]') === 'DESC';
        const rows = [...world.dnc].map(([channel, entry]) => ({ id: entry.id, lead_id: 1, channel, reason: entry.reason, comments: entry.comments, date_added: entry.dateAdded }))
          .filter(row => row.id > after && row.channel === url.searchParams.get('where[1][val]')).sort((a, b) => desc ? b.id - a.id : a.id - b.id);
        return Response.json({ total: rows.length, stats: rows.slice(0, Number(url.searchParams.get('limit'))) });
      }
      if (path === '/api/contacts/1') return Response.json({ contact: mauticContact(world) });
      if (path === '/api/contacts') {
        const search = url.searchParams.get('search') ?? '';
        const after = Number(url.searchParams.get('where[0][val]'));
        const emailMatch = url.searchParams.get('where[0][col]') === 'l.email';
        let found = [mauticContact(world)];
        if (search.startsWith('dnc:')) found = found.filter(contact => contact.id > after && world.dnc.has(search.slice(4)));
        if (emailMatch) found = url.searchParams.get('where[0][val]') === address ? found : [];
        return Response.json({ total: found.length, contacts: Object.fromEntries(found.map(contact => [contact.id, contact])) });
      }
      return Response.json({ total: 0, lists: {}, notes: {}, campaigns: {}, companies: {}, devices: {}, events: [], types: {} });
    }
    // The newsletter engine.
    if (world.listmonkDown) return Response.json({ message: 'down' }, { status: 503 });
    const sub = world.sub;
    const reply = (data: unknown) => Response.json({ data });
    if (request.method === 'GET' && path === '/api/subscribers') {
      world.listmonkQueries.push(url.searchParams);
      const query = url.searchParams.get('query');
      if (query) {
        const after = Number(query.match(/subscribers\.id > (\d+)/)?.[1] ?? 0);
        const since = query.match(/updated_at > '([^']+)'/)?.[1];
        const suppressed = sub.status === 'blocklisted' || sub.lists.some(list => list.subscription_status === 'unsubscribed');
        const touched = !since || Date.parse(sub.updated_at) > Date.parse(since) || sub.lists.some(list => Date.parse(list.subscription_updated_at) > Date.parse(since));
        const rows = sub.id > after && suppressed && touched ? [nativeSub(sub)] : [];
        return reply({ results: rows, total: rows.length });
      }
      const search = url.searchParams.get('search');
      const rows = !search || search === sub.email ? [nativeSub(sub)] : [];
      return reply({ results: rows, total: rows.length });
    }
    if (request.method === 'GET' && path === '/api/subscribers/11') return reply(nativeSub(sub));
    if (request.method === 'PUT' && path === '/api/subscribers/11/blocklist') {
      sub.status = 'blocklisted'; sub.updated_at = clock().toISOString();
      for (const list of sub.lists) { list.subscription_status = 'unsubscribed'; list.subscription_updated_at = sub.updated_at; }
      return reply(true);
    }
    if (request.method === 'PUT' && path === '/api/subscribers/11') {
      const body = JSON.parse(text) as { status: 'enabled' | 'blocklisted'; lists: number[] };
      sub.status = body.status; sub.updated_at = clock().toISOString();
      sub.lists = sub.lists.filter(list => body.lists.includes(list.id));
      return reply(nativeSub(sub));
    }
    return Response.json({ message: 'unexpected ' + request.method + ' ' + path }, { status: 500 });
  }) as typeof fetch;
}

function fakeDb(world: World) {
  return (sql: string, values: unknown[] = []): unknown[] => {
    world.sql.push(sql);
    const has = (pattern: RegExp) => pattern.test(sql);
    if (has(/pg_try_advisory_lock/)) return [{ ok: world.lockFree }];
    if (has(/^(BEGIN|COMMIT|ROLLBACK)$/) || has(/pg_advisory_xact_lock/) || has(/INSERT INTO activity/)) return [];
    if (has(/FROM contact_state WHERE contact_id = \$1/)) return [world.state];
    if (has(/INSERT INTO contact_state/)) {
      const [id, emailHash, consent] = values as [number, string, string];
      const old = world.state;
      const replaced = old.email_key !== emailHash;
      world.state = { contact_id: String(id), email_key: emailHash, subscriber_id: replaced ? null : old.subscriber_id, consent: consent === 'suppressed' || replaced ? consent : old.consent };
      return [world.state];
    }
    if (has(/INSERT INTO suppressions/)) {
      const [emailHash, reason, comment] = values as string[];
      if (world.suppressions.has(emailHash)) return [];
      world.suppressions.set(emailHash, { reason, comment, created_at: clock() });
      return [{ email_key: emailHash }];
    }
    if (has(/SELECT 1 FROM suppressions WHERE email_key = \$1/)) return world.suppressions.has(values[0] as string) ? [{ one: 1 }] : [];
    if (has(/SELECT (reason|reason, comment|reason, comment, created_at) FROM suppressions WHERE email_key = \$1/)) {
      const row = world.suppressions.get(values[0] as string);
      return row ? [row] : [];
    }
    if (has(/SELECT email_key FROM suppressions WHERE email_key = ANY/)) return (values[0] as string[]).filter(item => world.suppressions.has(item)).map(email_key => ({ email_key }));
    if (has(/FROM suppressions s JOIN contact_state cs/)) {
      const rows = [...world.suppressions].filter(([emailHash]) => emailHash === world.state.email_key && emailHash > (values[0] as string))
        .map(([emailHash, row]) => ({ contact_id: world.state.contact_id, reason: row.reason, email_key: emailHash }));
      return rows;
    }
    if (has(/DELETE FROM suppressions WHERE email_key/)) { world.suppressions.delete(values[0] as string); return []; }
    if (has(/INSERT INTO suppression_removals/)) { world.removals.set(values[0] as string, { removed_at: clock(), reason: values[1] as string }); return []; }
    if (has(/SELECT removed_at FROM suppression_removals/)) { const row = world.removals.get(values[0] as string); return row ? [row] : []; }
    if (has(/UPDATE contact_state SET consent = 'suppressed'/)) { world.state.consent = 'suppressed'; return [{ contact_id: world.state.contact_id }]; }
    if (has(/UPDATE contact_state SET consent = 'unknown'/)) {
      if (has(/AND consent = 'suppressed'/) && (world.state.consent !== 'suppressed' || world.suppressions.size)) return [];
      world.state.consent = 'unknown';
      return [];
    }
    if (has(/INSERT INTO consent_events/)) {
      world.events.push({ action: sql.match(/'(opted_in|suppressed|unsuppressed)', \$3/)![1], evidence: values[2] as string });
      return [];
    }
    if (has(/SELECT id, action, evidence, created_at FROM consent_events/)) return [];
    if (has(/INSERT INTO jobs/)) {
      const [kind, dedupe, payload] = values as string[];
      const job = { kind, key: dedupe, payload: JSON.parse(payload) as Record<string, unknown> };
      const at = world.jobs.findIndex(item => item.key === dedupe);
      if (at >= 0) world.jobs[at] = job; else world.jobs.push(job);
      return [];
    }
    if (has(/SELECT value FROM settings WHERE key = 'suppression_sweep'/)) return world.settings.has('suppression_sweep') ? [{ value: world.settings.get('suppression_sweep') }] : [];
    if (has(/INSERT INTO settings/)) { world.settings.set('suppression_sweep', { ...(world.settings.get('suppression_sweep') as object | undefined), ...JSON.parse(values[0] as string) }); return []; }
    if (has(/FROM contact_state cs JOIN suppressions s/)) return world.suppressions.has(world.state.email_key) ? [{ contact_id: world.state.contact_id }] : [];
    return [];
  };
}

async function inWorld(task: (world: World) => Promise<void>) {
  const world = createWorld();
  const saved = { fetch: globalThis.fetch, query: db.query, connect: db.connect };
  const handler = fakeDb(world);
  const run = async (sql: string, values?: unknown[]) => { const rows = handler(sql.trim(), values); return { rows, rowCount: rows.length } as never; };
  db.query = run as never;
  db.connect = (async () => ({ query: run, release() {} })) as never;
  globalThis.fetch = fakeFetch(world);
  try { await task(world); } finally { globalThis.fetch = saved.fetch; db.query = saved.query; db.connect = saved.connect; }
}

// Runs the queued jobs the way the worker does, until none is left.
async function settle(world: World) {
  for (let guard = 0; world.jobs.length && guard < 20; guard++) {
    const job = world.jobs.shift()!;
    if (job.kind === 'suppress') await audience.propagateSuppression(Number(job.payload.contactId), job.payload.reason as 'unsubscribe');
    else if (job.kind === 'unsuppress') await audience.applySuppressionRemoval(Number(job.payload.contactId), String(job.payload.emailKey));
  }
}

// The one invariant: OVELIO suppressions, Mautic email DNC and the Listmonk subscriber say the same thing.
function assertAgreement(world: World, label: string) {
  const suppressed = world.suppressions.has(key);
  const mautic = world.dnc.has('email');
  const listmonkBlocked = world.sub.status === 'blocklisted';
  // A subscriber with no subscriptions left (after a removal dropped them) has none to unsubscribe.
  const listmonkUnsubscribed = world.sub.lists.length ? world.sub.lists.every(list => list.subscription_status === 'unsubscribed') : suppressed;
  assert.equal(mautic, suppressed, label + ': Mautic DNC');
  assert.equal(listmonkBlocked, suppressed, label + ': Listmonk blocklist');
  assert.equal(listmonkUnsubscribed, suppressed, label + ': Listmonk list unsubscribe');
  assert.equal(world.state.consent === 'suppressed', suppressed, label + ': contact consent');
}

/* ── X-03: every path ends with all three agreeing ────────────────────────── */

type Path = { name: string; run: (world: World) => Promise<void>; suppressedAtEnd: boolean };

const paths: Path[] = [
  {
    name: 'Mautic-origin DNC (its unsubscribe page, bounce handling or a campaign action)', suppressedAtEnd: true,
    run: async world => {
      setDnc(world, 'email', 1, 'Unsubscribed via email');
      await audience.sweepEngineSuppressions(clock());
    },
  },
  {
    name: 'Listmonk blocklist (bounce action or unsubscribe page)', suppressedAtEnd: true,
    run: async world => {
      world.sub.status = 'blocklisted'; world.sub.updated_at = clock().toISOString();
      for (const list of world.sub.lists) { list.subscription_status = 'unsubscribed'; list.subscription_updated_at = world.sub.updated_at; }
      await audience.sweepEngineSuppressions(clock());
    },
  },
  {
    name: 'Listmonk list unsubscribe', suppressedAtEnd: true,
    run: async world => {
      world.sub.lists[0].subscription_status = 'unsubscribed'; world.sub.lists[0].subscription_updated_at = clock().toISOString();
      await audience.sweepEngineSuppressions(clock());
    },
  },
  {
    name: 'OVELIO manual suppress', suppressedAtEnd: true,
    run: async () => { await audience.manualSuppress(address, 'manual', 'Phone request, 1 Nov'); },
  },
  {
    name: 'email DNC removal', suppressedAtEnd: false,
    run: async world => {
      await audience.manualSuppress(address, 'unsubscribe', 'Asked to stop');
      await settle(world);
      assertAgreement(world, 'before removal');
      await audience.removeEmailDnc(1, { evidence: 'Asked to hear from us again, 2 Nov' });
    },
  },
  {
    name: 'bounce removal without confirmation is rejected', suppressedAtEnd: true,
    run: async world => {
      await audience.receiveSuppression(address, 'bounce', 'Hard bounce');
      await settle(world);
      await assert.rejects(audience.removeEmailDnc(1, { evidence: 'Looks fine now' }), { status: 409 });
      await assert.rejects(audience.removeEmailDnc(1, { evidence: 'Looks fine now', confirmFixed: false }), { status: 409 });
    },
  },
];

for (const path of paths) {
  test(`X-03 ${path.name} ends with Mautic, Listmonk and OVELIO in agreement`, async () => {
    await inWorld(async world => {
      await path.run(world);
      await settle(world);
      // A second sweep and a second settle change nothing: the pass is idempotent.
      await audience.sweepEngineSuppressions(clock());
      await settle(world);
      assert.equal(world.suppressions.has(key), path.suppressedAtEnd);
      assertAgreement(world, path.name);
    });
  });
}

test('X-03 a removal is not undone by a sweep while an engine still shows the old entry', async () => {
  await inWorld(async world => {
    await audience.manualSuppress(address, 'unsubscribe', 'Asked to stop');
    await settle(world);
    await audience.removeEmailDnc(1, { evidence: 'Asked to hear from us again' });
    // The removal job has not run: both engines still hold the old entry.
    assert.equal(world.dnc.has('email'), true);
    assert.equal(world.sub.status, 'blocklisted');
    // Sweeps (the walk by id and the changed-since lane) see the leftovers and must ignore them.
    await audience.sweepEngineSuppressions(clock());
    await audience.sweepEngineSuppressions(clock());
    assert.equal(world.suppressions.has(key), false);
    assert.equal(world.jobs.some(job => job.kind === 'suppress'), false);
    await settle(world);
    assertAgreement(world, 'after removal job');
    assert.equal(world.state.consent, 'unknown');
  });
});

test('X-03 an unsubscribe that happens after a removal is taken in again', async () => {
  await inWorld(async world => {
    await audience.manualSuppress(address, 'unsubscribe', 'Asked to stop');
    await settle(world);
    await audience.removeEmailDnc(1, { evidence: 'Asked to hear from us again' });
    await settle(world);
    setDnc(world, 'email', 1, 'Unsubscribed again');
    await audience.sweepEngineSuppressions(clock());
    await settle(world);
    assert.equal(world.suppressions.has(key), true);
    assertAgreement(world, 'new unsubscribe');
  });
});

test('X-03 a sweep that cannot take the advisory lock does nothing, and each page is bounded', async () => {
  await inWorld(async world => {
    world.lockFree = false;
    const skipped = await audience.sweepEngineSuppressions(clock());
    assert.equal(skipped.skipped, true);
    assert.equal(world.listmonkQueries.length, 0);
    world.lockFree = true;
    await audience.sweepEngineSuppressions(clock());
    assert.ok(world.listmonkQueries.length >= 2);
    for (const query of world.listmonkQueries) assert.equal(query.get('per_page'), '50');
    assert.ok(world.settings.has('suppression_sweep'), 'the cursors are stored in settings');
  });
});

test('X-03 the bounce action that blocklists without a timestamp is found by the walk by id', async () => {
  await inWorld(async world => {
    await audience.sweepEngineSuppressions(clock());
    world.sub.status = 'blocklisted';
    world.sub.lists[0].subscription_status = 'unsubscribed';
    // updated_at and subscription_updated_at stay older than the stored watermark (queries/bounces.sql:14-17).
    await audience.sweepEngineSuppressions(clock());
    await settle(world);
    assert.equal(world.suppressions.has(key), true);
    assertAgreement(world, 'bounce blocklist');
  });
});

test('X-03 the Mautic change feed finds a new DNC row on the next tick, with its own cursor', async () => {
  await inWorld(async world => {
    await audience.sweepEngineSuppressions(clock());
    const start = (world.settings.get('suppression_sweep') as { dncStatId: number }).dncStatId;
    setDnc(world, 'email', 2, 'Bounced: mailbox unknown');
    // Hide the contact from the slow walk so only the feed can have found it.
    const walked = world.sql.length;
    await audience.sweepEngineSuppressions(clock());
    assert.ok(world.sql.length > walked);
    assert.equal(world.suppressions.get(key)?.reason, 'bounce');
    assert.ok((world.settings.get('suppression_sweep') as { dncStatId: number }).dncStatId > start);
    await settle(world);
    assertAgreement(world, 'feed');
  });
});

test('X-03 one engine being down does not stop the other lanes or roll back their cursors', async () => {
  await inWorld(async world => {
    await audience.sweepEngineSuppressions(clock());
    setDnc(world, 'email', 1, 'Unsubscribed');
    world.listmonkDown = true;
    const summary = await audience.sweepEngineSuppressions(clock());
    assert.deepEqual(summary.failed, ['newsletter-changed', 'newsletter-walk']);
    // The Mautic lane ran and took the suppression in; the mirror lane ran and re-queued it.
    assert.equal(world.suppressions.has(key), true);
    const cursors = world.settings.get('suppression_sweep') as Record<string, unknown>;
    assert.equal(cursors.dncStatId, world.dnc.get('email')!.id);
    assert.equal(cursors.reassertAfter, '');
    assert.ok(world.jobs.some(job => job.kind === 'suppress'));
    // The failed lanes kept their old cursors and catch up when the engine is back.
    world.listmonkDown = false;
    assert.deepEqual((await audience.sweepEngineSuppressions(clock())).failed, []);
  });
});

/* ── AUD-08: do not contact ───────────────────────────────────────────────── */

test('AUD-08 an email entry is added through OVELIO with its reason and comment, and shows on the contact', async () => {
  await inWorld(async world => {
    const detail = await audience.addContactDnc(1, 'email', 'bounced', 'Mailbox full for a month');
    assert.equal(world.suppressions.get(key)?.reason, 'bounce');
    await settle(world);
    assert.deepEqual(world.dnc.get('email')?.reason, 2);
    assert.match(world.dnc.get('email')!.comments, /Mailbox full/);
    const email = (await audience.contactDetail(1)).dnc?.find(entry => entry.channel === 'email');
    assert.deepEqual([email?.reason, email?.comment.includes('Mailbox full')], ['bounced', true]);
    assert.equal(detail.consent, 'suppressed');
    assertAgreement(world, 'added');
  });
});

test('AUD-08 an SMS entry goes straight to Mautic and never touches OVELIO suppressions', async () => {
  await inWorld(async world => {
    await audience.addContactDnc(1, 'sms', 'unsubscribed', 'Replied STOP');
    assert.deepEqual([world.dnc.get('sms')?.reason, world.suppressions.size, world.jobs.length], [1, 0, 0]);
    const detail = await audience.contactDetail(1);
    assert.deepEqual(detail.dnc?.map(entry => [entry.channel, entry.reason, entry.comment]), [['sms', 'unsubscribed', 'Replied STOP']]);
    assert.equal(detail.suppressed, false, 'a text-message entry does not block email');
    await audience.removeContactDnc(1, 'sms', { evidence: 'Opted in again by SMS' });
    assert.equal(world.dnc.has('sms'), false);
  });
});

test('AUD-08 removal needs evidence, is audited, does not opt the contact in, and a bounce needs the fixed-address confirmation', async () => {
  await inWorld(async world => {
    await audience.receiveSuppression(address, 'bounce', 'Hard bounce');
    await settle(world);
    await assert.rejects(audience.removeEmailDnc(1, { evidence: '   ' }), { status: 400 });
    await assert.rejects(audience.removeEmailDnc(1, { evidence: 'Fixed' }), { status: 409 });
    assert.equal(world.suppressions.has(key), true);
    await audience.removeEmailDnc(1, { evidence: 'Customer gave a new mailbox', confirmFixed: true });
    await settle(world);
    assert.equal(world.suppressions.has(key), false);
    assert.equal(world.state.consent, 'unknown', 'removal does not record opt-in');
    const audit = world.events.at(-1)!;
    assert.equal(audit.action, 'unsuppressed');
    assert.match(audit.evidence, /confirmed fixed.*new mailbox/);
    assert.equal(world.sub.lists.length, 0, 'the old subscriptions were dropped, so no unsubscribed row can re-suppress');
    assertAgreement(world, 'bounce removal');
  });
});

test('AUD-08 an erasure suppression cannot be removed', async () => {
  await inWorld(async world => {
    await audience.receiveSuppression(address, 'erasure', 'Erasure requested');
    await settle(world);
    await assert.rejects(audience.removeEmailDnc(1, { evidence: 'Please', confirmFixed: true }), { status: 409 });
    assert.equal(world.suppressions.has(key), true);
  });
});

test('AUD-08 the six DNC segment filters use Mautic\'s keys, boolean type and 1/0 values', () => {
  const keys = ['dnc_bounced', 'dnc_unsubscribed', 'dnc_manual_email', 'dnc_bounced_sms', 'dnc_unsubscribed_sms', 'dnc_manual_sms'];
  const catalogue = staticSegmentFields;
  for (const item of keys) {
    const field = catalogue.find(entry => entry.key === item)!;
    assert.ok(field, item);
    const rule = emptySegmentRule(field);
    const filter = segmentFilterFromRule({ ...rule, text: '0' }, field, 0);
    assert.deepEqual(segmentFiltersPayload([filter])[0], {
      glue: 'and', field: item, object: 'lead', type: 'boolean', operator: '=', filter: 0, properties: { filter: 0 },
    });
  }
});

test('AUD-08 maintenance drops abandoned draft imports older than 7 days', async () => {
  await inWorld(async world => {
    await maintainJobs();
    assert.ok(world.sql.some(sql => /DELETE FROM contact_imports WHERE status = 'draft' AND created_at < now\(\) - interval '7 days'/.test(sql)));
  });
});
