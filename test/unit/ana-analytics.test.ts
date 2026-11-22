import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANALYTICS_LIMITS, OPERATOR_LABELS, SEGMENT_DIMENSION_OPERATORS, normalizeSegmentOperator, operatorLabel,
} from '../../src/contracts/analytics';
import { createUmami } from '../../src/server/umami';

const siteId = '22b3bfe1-b34f-4472-bc18-123994f2ef31';
const range = { startAt: 1767225600000, endAt: 1767311999999 };
const path = `/api/websites/${siteId}`;

function harness(respond: (url: URL, init?: RequestInit) => unknown) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return Response.json(respond(url, init));
  };
  return { api: createUmami({ url: 'http://tracking.test', token: 'k', fetch: fetcher }), calls };
}

test('ANA-01 operator labels match the 16 Umami operators', () => {
  assert.deepEqual(Object.keys(OPERATOR_LABELS).sort(),
    ['af', 'bf', 'c', 'dnc', 'eq', 'f', 'gt', 'gte', 'lt', 'lte', 'neq', 'nre', 'ns', 're', 's', 't']);
  assert.equal(Object.keys(OPERATOR_LABELS).length, 16);
  assert.equal(OPERATOR_LABELS.dnc, 'does not contain');
  assert.equal(OPERATOR_LABELS.s, 'is set');
  assert.equal(OPERATOR_LABELS.ns, 'is not set');
});

test('ANA-01 dimension segments offer only operators Umami applies', () => {
  assert.deepEqual([...SEGMENT_DIMENSION_OPERATORS], ['eq', 'neq', 'c', 'dnc', 're', 'nre']);
});

test('ANA-01 legacy nc reads as dnc and s/ns keep their real meaning', async () => {
  assert.equal(normalizeSegmentOperator('nc'), 'dnc');
  assert.equal(operatorLabel('nc'), 'does not contain');
  assert.equal(operatorLabel('s'), 'is set');
  assert.equal(operatorLabel('ns'), 'is not set');
  const { api } = harness(url => url.pathname === `${path}/segments`
    ? { data: [{ id: siteId, name: 'Old', type: 'segment', parameters: { filters: [{ name: 'path', operator: 'nc', value: '/x' }, { name: 'path', operator: 's', value: '' }] } }], count: 1, page: 1, pageSize: 100 }
    : {});
  const [segment] = await api.segments(siteId);
  assert.deepEqual(segment.filters.map(f => f.operator), ['dnc', 's']);
});

test('ANA-01 new segments are sent to Umami with dnc, never nc', async () => {
  const { api, calls } = harness(() => ({ id: siteId, name: 'S', type: 'segment', parameters: {} }));
  await api.createSegment(siteId, { name: 'S', type: 'segment', filters: [{ name: 'path', operator: 'nc', value: '/x' }] });
  const body = JSON.parse(String(calls.at(-1)?.init?.body));
  assert.equal(body.parameters.filters[0].operator, 'dnc');
});

test('ANA-04 channel and screen filters are refused, not silently dropped', async () => {
  const { api, calls } = harness(() => ({}));
  await assert.rejects(() => api.retention(siteId, range, { channel: 'email' }), /cannot filter by channel/);
  await assert.rejects(() => api.breakdown(siteId, range, ['country'], { screen: '1920x1080' }), /cannot filter by screen/);
  await assert.rejects(() => api.createSegment(siteId, { name: 'S', type: 'segment', filters: [{ name: 'screen', operator: 'eq', value: 'x' }] }));
  assert.equal(calls.length, 0);
});

test('ANA-04 every supported filter reaches the engine on breakdown and attribution', async () => {
  const { api, calls } = harness(url => url.pathname.endsWith('/attribution') ? { total: { pageviews: 1, visitors: 1, visits: 1 } } : []);
  await api.breakdown(siteId, range, ['country'], { device: 'mobile', utmSource: 'news' });
  assert.equal(calls.at(-1)?.url.searchParams.get('device'), 'mobile');
  assert.equal(calls.at(-1)?.url.searchParams.get('utmSource'), 'news');
  await api.attribution(siteId, range, { model: 'last-click', type: 'event', step: 'buy', currency: 'eur', filters: { country: 'GB' } });
  const q = calls.at(-1)!.url.searchParams;
  assert.equal(q.get('country'), 'GB');
  assert.equal(q.get('currency'), 'EUR');
  assert.equal(q.get('step'), 'buy');
});

test('ANA-04 limits live in one place and match Umami', async () => {
  assert.equal(ANALYTICS_LIMITS.funnelWindowMinutes, 10_080);
  assert.equal(ANALYTICS_LIMITS.stepValueLength, 500);
  assert.equal(ANALYTICS_LIMITS.breakdownFields, 20);
  const { api } = harness(() => []);
  const longStep = 'x'.repeat(ANALYTICS_LIMITS.stepValueLength);
  await api.funnel(siteId, range, [{ type: 'path', value: longStep }, { type: 'path', value: '/b' }], ANALYTICS_LIMITS.funnelWindowMinutes);
  await assert.rejects(() => api.funnel(siteId, range, [{ type: 'path', value: '/a' }, { type: 'path', value: '/b' }], ANALYTICS_LIMITS.funnelWindowMinutes + 1));
});
