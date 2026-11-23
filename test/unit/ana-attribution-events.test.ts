import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sql } from '../../src/server/db';
import { createUmami } from '../../src/server/umami';
import {
  authenticateApiKey, createApiKey, ingestEvents, revokeApiKey, serverEventsBody, SERVER_USER_AGENT,
} from '../../src/server/analytics-events';
import { createHash } from 'node:crypto';

const siteId = '22b3bfe1-b34f-4472-bc18-123994f2ef31';
const range = { startAt: 1767225600000, endAt: 1767311999999 };
const path = `/api/websites/${siteId}`;
const stats = { sum: 120, count: 4, uniqueCount: 3, totalSessions: 10, average: 30, arpu: 12 };

function harness(respond: (url: URL) => unknown) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json(respond(url));
  };
  return { api: createUmami({ url: 'http://tracking.test', token: 'k', fetch: fetcher }), calls };
}

const attributionBody = {
  referrer: [{ name: 'google.com', value: 4 }], paidAds: [], utm_source: [], utm_medium: [], utm_campaign: [],
  total: { pageviews: 9, visitors: 4, visits: 5 },
};

test('ANA-08 attribution applies the active filters and returns revenue under the same filters', async () => {
  const { api, calls } = harness(url => url.pathname.endsWith('/attribution') ? attributionBody : stats);
  const result = await api.attribution(siteId, range, {
    model: 'last-click', type: 'event', step: 'purchase', currency: 'gbp',
    filters: { rules: [{ dimension: 'country', operator: 'eq', values: ['GB'] }] },
  });
  const attribution = calls.find(url => url.pathname === `${path}/attribution`)!;
  assert.equal(attribution.searchParams.get('country'), 'eq.GB');
  assert.equal(attribution.searchParams.get('model'), 'last-click');
  const revenue = calls.find(url => url.pathname === `${path}/revenue/stats`)!;
  assert.equal(revenue.searchParams.get('country'), 'eq.GB');
  assert.equal(revenue.searchParams.get('currency'), 'GBP');
  assert.deepEqual(result.revenue, { currency: 'GBP', sum: 120, count: 4 });
});

test('ANA-08 a lookback window widens the search start but revenue keeps the chosen range', async () => {
  const { api, calls } = harness(url => url.pathname.endsWith('/attribution') ? attributionBody : stats);
  const result = await api.attribution(siteId, range, { model: 'first-click', type: 'path', step: '/thanks', lookbackDays: 30 });
  const attribution = calls.find(url => url.pathname.endsWith('/attribution'))!;
  assert.equal(attribution.searchParams.get('startAt'), String(range.startAt - 30 * 86_400_000));
  assert.equal(attribution.searchParams.get('endAt'), String(range.endAt));
  assert.equal(calls.find(url => url.pathname.endsWith('/revenue/stats'))!.searchParams.get('startAt'), String(range.startAt));
  assert.equal(result.lookbackDays, 30);
  await assert.rejects(api.attribution(siteId, range, { model: 'first-click', type: 'path', step: '/x', lookbackDays: 400 }));
});

test('ANA-08 revenue is empty, not an error, when the site records none', async () => {
  const { api } = harness(url => url.pathname.endsWith('/attribution') ? attributionBody : { ...stats, sum: 0, count: 0 });
  assert.equal((await api.attribution(siteId, range, { model: 'first-click', type: 'path', step: '/x' })).revenue, null);
});

test('ANA-08 revenue by UTM source asks for each top value with an is filter', async () => {
  const { api, calls } = harness(url => {
    if (url.pathname.endsWith('/metrics/expanded')) {
      return [{ name: 'news', pageviews: 1, visitors: 1, visits: 1, bounces: 0, totaltime: 0 }, { name: 'ads', pageviews: 1, visitors: 1, visits: 1, bounces: 0, totaltime: 0 }];
    }
    return url.searchParams.get('utmSource') === 'eq.ads' ? stats : { ...stats, sum: 0, count: 0 };
  });
  const report = await api.revenueByUtm(siteId, range, 'utmSource', 'usd');
  assert.deepEqual(report.rows, [{ name: 'ads', sum: 120, count: 4 }]);
  assert.equal(calls.filter(url => url.pathname.endsWith('/revenue/stats')).length, 2);
});

/** An in-memory stand-in for the three tables the events API touches. */
function memorySql() {
  const keys = new Map<string, { id: string; rate: number; revoked: boolean }>();
  const used = new Set<string>();
  const log: string[] = [];
  const sql: Sql = {
    query: (async (text: string, values: unknown[] = []) => {
      if (text.includes('INSERT INTO analytics_api_keys')) {
        const row = {
          id: 'k1', name: values[0], key_prefix: values[1], rate_limit_per_minute: values[3], created_at: new Date(), last_used_at: null, revoked_at: null,
        };
        keys.set(String(values[2]), { id: 'k1', rate: Number(values[3]), revoked: false });
        log.push('hash:' + values[2]);
        return { rows: [row], rowCount: 1 };
      }
      if (text.includes('UPDATE analytics_api_keys SET last_used_at')) {
        const key = keys.get(String(values[0]));
        return key && !key.revoked ? { rows: [{ id: key.id, rate_limit_per_minute: key.rate }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (text.includes('SET revoked_at')) {
        const key = [...keys.values()].find(item => item.id === values[0]);
        if (!key || key.revoked) return { rows: [], rowCount: 0 };
        key.revoked = true;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO analytics_event_idempotency')) {
        const k = `${values[0]}:${values[1]}`;
        if (used.has(k)) return { rows: [], rowCount: 0 };
        used.add(k);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('DELETE FROM analytics_event_idempotency WHERE api_key_id')) {
        for (const item of values[1] as string[]) used.delete(`${values[0]}:${item}`);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }) as Sql['query'],
  };
  return { sql, keys, used, log };
}

const event = (over: Record<string, unknown> = {}) => ({
  websiteId: siteId, name: 'purchase', url: 'https://shop.example.test/thanks?utm_source=news', data: { revenue: 20, currency: 'GBP' },
  distinctId: 'cust-1', idempotencyKey: 'order-1', ...over,
});
const parseEvents = (items: unknown) => serverEventsBody.parse(items);
const noLimit = async () => {};

test('ANA-10 a new key is shown once and only its hash is stored', async () => {
  const { sql, keys, log } = memorySql();
  const created = await createApiKey({ name: 'Checkout' }, null, sql);
  assert.ok(created.key.startsWith('ovl_'));
  assert.equal(log[0], 'hash:' + createHash('sha256').update(created.key).digest('hex'));
  assert.ok(!log[0].includes(created.key));
  assert.equal(keys.size, 1);
  assert.deepEqual(await authenticateApiKey(`Bearer ${created.key}`, sql), { id: 'k1', rateLimitPerMinute: 120 });
});

test('ANA-10 missing, wrong and revoked keys are refused with 401', async () => {
  const { sql } = memorySql();
  const created = await createApiKey({ name: 'Checkout' }, null, sql);
  await assert.rejects(authenticateApiKey(null, sql), { status: 401 });
  await assert.rejects(authenticateApiKey('Bearer nope', sql), { status: 401 });
  await revokeApiKey('k1', sql);
  await assert.rejects(authenticateApiKey(`Bearer ${created.key}`, sql), { status: 401 });
  await assert.rejects(revokeApiKey('k1', sql), { status: 404 });
});

test('ANA-10 a repeated idempotency key is accepted once', async () => {
  const { sql } = memorySql();
  const sent: unknown[][] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ size: 1, processed: 1, errors: 0, details: [] });
  };
  const deps = { sql, fetch: fetcher, umamiUrl: 'http://tracking.test', limit: noLimit };
  const key = { id: 'k1', rateLimitPerMinute: 60 };
  const first = await ingestEvents(key, parseEvents([event()]), deps);
  const second = await ingestEvents(key, parseEvents([event()]), deps);
  assert.equal(first[0].status, 'accepted');
  assert.equal(second[0].status, 'duplicate');
  assert.equal(sent.length, 1);
});

test('ANA-10 events are forwarded to the collect batch endpoint with a normal user agent and a Unix-seconds timestamp', async () => {
  const { sql } = memorySql();
  let url = '';
  let body: { type: string; payload: Record<string, unknown> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return Response.json({ size: 1, processed: 1, errors: 0, details: [] });
  };
  await ingestEvents({ id: 'k1', rateLimitPerMinute: 60 }, parseEvents([event({ timestamp: '2026-01-01T00:00:00Z' })]), {
    sql, fetch: fetcher, umamiUrl: 'http://tracking.test/', limit: noLimit,
  });
  assert.equal(url, 'http://tracking.test/api/batch');
  assert.equal(body[0].type, 'event');
  assert.equal(body[0].payload.timestamp, 1767225600);
  assert.equal(body[0].payload.userAgent, SERVER_USER_AGENT);
  assert.equal(body[0].payload.url, '/thanks?utm_source=news');
  assert.equal(body[0].payload.hostname, 'shop.example.test');
  assert.equal(body[0].payload.id, 'cust-1');
  assert.ok(!/bot|crawl|spider/i.test(SERVER_USER_AGENT));
});

test('ANA-10 a failed forward releases its idempotency key so the caller can retry', async () => {
  const { sql, used } = memorySql();
  const failing: typeof fetch = async () => Response.json({ message: 'x' }, { status: 500 });
  const deps = { sql, umamiUrl: 'http://tracking.test', limit: noLimit };
  const key = { id: 'k1', rateLimitPerMinute: 60 };
  const first = await ingestEvents(key, parseEvents([event()]), { ...deps, fetch: failing });
  assert.equal(first[0].status, 'failed');
  assert.equal(used.size, 0);
  const ok: typeof fetch = async () => Response.json({ size: 1, processed: 1, errors: 0, details: [] });
  assert.equal((await ingestEvents(key, parseEvents([event()]), { ...deps, fetch: ok }))[0].status, 'accepted');
});

test('ANA-10 per-event failures reported by the engine are mapped by index', async () => {
  const { sql } = memorySql();
  const fetcher: typeof fetch = async () => Response.json({ size: 2, processed: 1, errors: 1, details: [{ index: 1, response: { message: 'Website not found.' } }] });
  const results = await ingestEvents({ id: 'k1', rateLimitPerMinute: 60 }, parseEvents([event(), event({ idempotencyKey: 'order-2' })]), {
    sql, fetch: fetcher, umamiUrl: 'http://tracking.test', limit: noLimit,
  });
  assert.deepEqual(results.map(r => r.status), ['accepted', 'failed']);
  assert.equal(results[1].error, 'Website not found.');
});

test('ANA-10 the per-key rate limit runs before anything is sent', async () => {
  const { sql } = memorySql();
  const buckets: unknown[][] = [];
  const limit = async (bucket: string, max: number, seconds: number) => {
    buckets.push([bucket, max, seconds]);
    throw Object.assign(new Error('Too many attempts.'), { status: 429 });
  };
  let sent = false;
  const fetcher: typeof fetch = async () => { sent = true; return Response.json({}); };
  await assert.rejects(ingestEvents({ id: 'k1', rateLimitPerMinute: 5 }, parseEvents([event()]), { sql, fetch: fetcher, umamiUrl: 'http://t.test', limit }), { status: 429 });
  assert.deepEqual(buckets, [['events:k1', 5, 60]]);
  assert.equal(sent, false);
});

test('ANA-10 validation rejects a bad website id, a future timestamp, an empty batch and a missing idempotency key', () => {
  assert.throws(() => parseEvents([event({ websiteId: 'nope' })]));
  assert.throws(() => parseEvents([event({ timestamp: Date.now() + 3_600_000 })]));
  assert.throws(() => parseEvents([]));
  assert.throws(() => parseEvents([event({ idempotencyKey: '' })]));
  assert.throws(() => parseEvents([event({ name: '=cmd' })]));
  assert.equal(parseEvents({ events: [event()] }).length, 1);
});
