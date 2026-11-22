import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FILTER_DIMENSIONS, PROPERTY_OPERATORS, SEGMENT_DIMENSION_OPERATORS, describeFilterRule, describePropertyFilter,
  equalityRule, filterQueryParams, goalMatchKind, hasFilters, parseFilterParams,
} from '../../src/contracts/analytics';
import type { FilterRule, ReportFilters } from '../../src/contracts/analytics';
import { createUmami } from '../../src/server/umami';

const siteId = '22b3bfe1-b34f-4472-bc18-123994f2ef31';
const sessionId = '9c3a7e1f-44db-4f8b-94aa-22cc0f91a010';
const goalId = '61048d54-4909-4b06-a9b4-5b1e54e44b60';
const segmentId = '3b6d3c0e-6a0d-4a47-9d52-1f1a2c9d5b11';
const cohortId = 'c9d3d6b2-5a0f-4e7a-8f2b-0a7f5d6e1c22';
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

const rule = (dimension: FilterRule['dimension'], operator: FilterRule['operator'], ...values: string[]): FilterRule => ({ dimension, operator, values });
const parse = (query: string) => parseFilterParams(new URLSearchParams(query).entries());

test('ANA-06 contains filters are encoded as Umami expects', () => {
  assert.deepEqual(filterQueryParams({ rules: [rule('path', 'c', '/blog')] }), { path: 'c./blog' });
  assert.deepEqual(filterQueryParams({ rules: [rule('title', 'dnc', 'draft')] }), { title: 'dnc.draft' });
  assert.deepEqual(filterQueryParams({ rules: [rule('query', 're', '^utm_')] }), { query: 're.^utm_' });
  assert.deepEqual(filterQueryParams({ rules: [rule('referrer', 'nre', 'spam\\.')] }), { referrer: 'nre.spam\\.' });
});

test('ANA-06 every filterable dimension accepts every operator Umami applies to it', () => {
  assert.equal(FILTER_DIMENSIONS.length, 20);
  assert.deepEqual([...SEGMENT_DIMENSION_OPERATORS], ['eq', 'neq', 'c', 'dnc', 're', 'nre']);
  for (const dimension of FILTER_DIMENSIONS) {
    for (const operator of SEGMENT_DIMENSION_OPERATORS) {
      const encoded = filterQueryParams({ rules: [rule(dimension, operator, 'x')] });
      assert.deepEqual(encoded, { [dimension]: `${operator}.x` });
      assert.deepEqual(parse(new URLSearchParams(encoded).toString())?.rules, [rule(dimension, operator, 'x')]);
    }
  }
});

test('ANA-06 is and is not take several values and a second rule on one dimension gets a numbered key', () => {
  assert.deepEqual(
    filterQueryParams({ rules: [rule('country', 'eq', 'GB', 'US'), rule('country', 'neq', 'FR'), rule('browser', 'c', 'chrome')] }),
    { country: 'eq.GB,US', country1: 'neq.FR', browser: 'c.chrome' },
  );
  assert.throws(() => filterQueryParams({ rules: [rule('path', 'c', '/a', '/b')] }), /takes a single value/);
  assert.throws(() => filterQueryParams({ rules: [rule('path', 'eq', '/a,b')] }), /commas/);
  assert.throws(() => filterQueryParams({ rules: [rule('path', 'eq', ' ')] }), /Enter a value/);
});

test('ANA-06 OR matching sends match=any, segments and cohorts send their ids', () => {
  const encoded = filterQueryParams({
    rules: [rule('country', 'eq', 'GB'), rule('browser', 'eq', 'safari')],
    match: 'any',
    segment: segmentId,
    cohort: cohortId,
  });
  assert.equal(encoded.match, 'any');
  assert.equal(encoded.segment, segmentId);
  assert.equal(encoded.cohort, cohortId);
  assert.equal('match' in filterQueryParams({ rules: [rule('country', 'eq', 'GB')], match: 'all' }), false);
  assert.throws(() => filterQueryParams({ segment: 'not-an-id' }), /saved segment/);
  assert.deepEqual(parse(`match=any&segment=${segmentId}&cohort=${cohortId}`), { match: 'any', segment: segmentId, cohort: cohortId });
});

test('ANA-06 request parameters are read back the way Umami reads them', () => {
  const filters = parse('startAt=1&path=c./blog&path1=neq./blog/draft,/blog/old&country=GB,US&browser=re.^(chrome|edge)$&limit=5');
  assert.deepEqual(filters?.rules, [
    rule('path', 'c', '/blog'),
    rule('path', 'neq', '/blog/draft', '/blog/old'),
    rule('country', 'eq', 'GB', 'US'),
    rule('browser', 're', '^(chrome|edge)$'),
  ]);
  assert.equal(parse('startAt=1&limit=5&page=2'), undefined);
  assert.equal(parse('path=&country=%20'), undefined);
});

test('ANA-06 operators Umami cannot apply to a dimension are refused, not sent', () => {
  assert.throws(() => parse('path=gt.5'), /cannot be used on Path filters/);
  assert.throws(() => parse('country=s.x'), /is set/);
  assert.throws(() => filterQueryParams({ rules: [{ dimension: 'path', operator: 'gt' as 'eq', values: ['1'] }] }), /greater than/);
  assert.throws(() => parse('channel=email'), /cannot filter by channel/);
  assert.throws(() => parse('screen1=eq.1920x1080'), /cannot filter by screen/);
  assert.throws(() => filterQueryParams({ rules: [rule('path', 're', '(')] }), /regular expression/);
});

test('ANA-06 clicking a report row makes an is filter that Umami reads as an exact match', () => {
  assert.deepEqual(equalityRule('path', '/pricing'), rule('path', 'eq', '/pricing'));
  assert.deepEqual(filterQueryParams({ rules: [equalityRule('path', 'c.foo')] }), { path: 'eq.c.foo' });
  const withComma = equalityRule('title', 'Tea, coffee (hot)');
  assert.equal(withComma.operator, 're');
  assert.equal(new RegExp(withComma.values[0], 'i').test('Tea, coffee (hot)'), true);
  assert.equal(new RegExp(withComma.values[0], 'i').test('Tea, coffee (hot) and more'), false);
  assert.doesNotThrow(() => filterQueryParams({ rules: [withComma] }));
});

test('ANA-06 filters read as plain sentences', () => {
  assert.equal(describeFilterRule(rule('path', 'c', '/blog')), 'Path contains /blog');
  assert.equal(describeFilterRule(rule('country', 'eq', 'GB', 'US')), 'Country is GB or US');
  assert.equal(describeFilterRule(rule('utmSource', 'nre', '^ads')), 'UTM source does not match regex ^ads');
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ segment: segmentId }), true);
});

test('ANA-06 the adapter sends operators, several values, OR and saved ids on every report call', async () => {
  const filters: ReportFilters = {
    rules: [rule('path', 'c', '/blog'), rule('country', 'eq', 'GB', 'US')],
    match: 'any',
    segment: segmentId,
  };
  const { api, calls } = harness(url => {
    if (url.pathname.endsWith('/sessions')) return { data: [], count: 0 };
    if (url.pathname.endsWith('/sessions/stats')) return { pageviews: 0, visitors: 0, visits: 0, countries: 0, events: 0 };
    if (url.pathname.endsWith('/retention')) return [];
    return [];
  });
  await api.sessions(siteId, range, { filters });
  await api.sessionStats(siteId, range, filters);
  await api.retention(siteId, range, filters);
  await api.journeys(siteId, range, { filters });
  assert.equal(calls.length, 4);
  for (const { url } of calls) {
    assert.equal(url.searchParams.get('path'), 'c./blog');
    assert.equal(url.searchParams.get('country'), 'eq.GB,US');
    assert.equal(url.searchParams.get('match'), 'any');
    assert.equal(url.searchParams.get('segment'), segmentId);
  }
});

test('ANA-06 session and event property filters use the spf and epf parameters', () => {
  const encoded = filterQueryParams({
    properties: [
      { scope: 'session', name: 'plan', dataType: 'string', operator: 'eq', value: 'pro' },
      { scope: 'session', name: 'seats', dataType: 'number', operator: 'gte', value: '5' },
      { scope: 'event', name: 'order.total', dataType: 'number', operator: 'gt', value: '99.5' },
    ],
  });
  assert.deepEqual(encoded, {
    spf0: '1.eq.plan.pro',
    spf1: '2.gte.seats.5',
    epf0: '2.gt.order%2Etotal.99.5',
  });
  const back = parse(new URLSearchParams(encoded).toString());
  assert.deepEqual(back?.properties?.map(item => [item.scope, item.name, item.dataType, item.operator, item.value]), [
    ['session', 'plan', 'string', 'eq', 'pro'],
    ['session', 'seats', 'number', 'gte', '5'],
    ['event', 'order.total', 'number', 'gt', '99.5'],
  ]);
  assert.equal(describePropertyFilter(back!.properties![0]), 'Session property plan is pro');
});

test('ANA-06 property operators and values are checked against the data type', () => {
  assert.deepEqual(PROPERTY_OPERATORS.number, ['eq', 'neq', 'gt', 'lt', 'gte', 'lte']);
  const base = { scope: 'session' as const, name: 'x' };
  assert.throws(() => filterQueryParams({ properties: [{ ...base, dataType: 'string', operator: 'gt', value: '1' }] }), /greater than/);
  assert.throws(() => filterQueryParams({ properties: [{ ...base, dataType: 'number', operator: 'eq', value: 'abc' }] }), /number/);
  assert.throws(() => filterQueryParams({ properties: [{ ...base, dataType: 'boolean', operator: 'eq', value: 'yes' }] }), /true or false/);
  assert.throws(() => filterQueryParams({ properties: [{ ...base, dataType: 'date', operator: 'bf', value: '1 May' }] }), /YYYY-MM-DD/);
  assert.deepEqual(filterQueryParams({ properties: [{ ...base, dataType: 'date', operator: 'af', value: '2026-01-01' }] }), { spf0: '4.af.x.2026-01-01' });
  assert.deepEqual(filterQueryParams({ properties: [{ ...base, dataType: 'array', operator: 'c', value: 'beta' }] }), { spf0: '5.c.x.beta' });
  assert.throws(() => parse('spf0=9.eq.x.1'), /property filter/);
});

test('ANA-06 segments save session property filters and refuse names Umami would ignore', async () => {
  const { api, calls } = harness((url, init) => init?.method === 'POST'
    ? { id: segmentId, name: 'Pro', type: 'segment', parameters: JSON.parse(String(init.body)).parameters, createdAt: null }
    : { data: [], count: 0 });
  const created = await api.createSegment(siteId, {
    name: 'Pro',
    type: 'segment',
    filters: [{ name: 'country', operator: 'eq', value: 'GB,US' }],
    sessionPropertyFilters: [{ scope: 'session', name: 'plan', dataType: 'string', operator: 'eq', value: 'pro' }],
  });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).parameters.sessionPropertyFilters, [
    { propertyName: 'plan', dataType: 1, operator: 'eq', value: 'pro' },
  ]);
  assert.deepEqual(created.sessionPropertyFilters, [{ scope: 'session', name: 'plan', dataType: 'string', operator: 'eq', value: 'pro' }]);
  await assert.rejects(() => api.createSegment(siteId, { name: 'Bad', type: 'segment', filters: [{ name: 'timezone', operator: 'eq', value: 'x' }] }), /Unknown filter/);
  await assert.rejects(() => api.createSegment(siteId, {
    name: 'Bad', type: 'segment',
    sessionPropertyFilters: [{ scope: 'session', name: 'plan', dataType: 'number', operator: 'c', value: '1' }],
  }));
  assert.equal(calls.length, 1);
});

test('ANA-09 a session lists its custom properties with their types', async () => {
  const { api, calls } = harness(() => [
    { dataKey: 'plan', dataType: 1, stringValue: 'pro', numberValue: null, dateValue: null },
    { dataKey: 'seats', dataType: 2, stringValue: null, numberValue: '12', dateValue: null },
    { dataKey: 'beta', dataType: 3, stringValue: 'true', numberValue: null, dateValue: null },
  ]);
  assert.deepEqual(await api.singleSessionProperties(siteId, sessionId), [
    { propertyName: 'plan', value: 'pro', dataType: 1 },
    { propertyName: 'seats', value: '12', dataType: 2 },
    { propertyName: 'beta', value: 'true', dataType: 3 },
  ]);
  assert.equal(calls[0].url.pathname, `${path}/sessions/${sessionId}/properties`);
});

test('ANA-09 the website lists property keys and values, respecting the active filters', async () => {
  const { api, calls } = harness(url => url.pathname.endsWith('/properties')
    ? [{ propertyName: 'plan', dataType: 1, total: 8 }, { propertyName: 'tags', dataType: 5, total: 3 }]
    : [{ value: 'pro', total: 5 }, { value: 'free', total: 3 }]);
  const filters = { rules: [rule('country', 'eq', 'GB')] };
  assert.deepEqual(await api.sessionProperties(siteId, range, filters), [
    { propertyName: 'plan', dataType: 1, total: 8 },
    { propertyName: 'tags', dataType: 5, total: 3 },
  ]);
  assert.equal(calls[0].url.pathname, `${path}/session-data/properties`);
  assert.equal(calls[0].url.searchParams.get('country'), 'eq.GB');
  assert.deepEqual(await api.sessionPropertyValues(siteId, range, 'tags', filters, 5), [
    { value: 'pro', total: 5 },
    { value: 'free', total: 3 },
  ]);
  const values = calls[1].url;
  assert.equal(values.pathname, `${path}/session-data/values`);
  assert.equal(values.searchParams.get('propertyName'), 'tags');
  assert.equal(values.searchParams.get('dataType'), '5');
  assert.equal(values.searchParams.get('country'), 'eq.GB');
});

test('ANA-09 reports can be filtered by a session property', async () => {
  const { api, calls } = harness(() => ({ pageviews: 0, visitors: 0, visits: 0, countries: 0, events: 0 }));
  await api.sessionStats(siteId, range, {
    properties: [{ scope: 'session', name: 'plan', dataType: 'string', operator: 'eq', value: 'pro' }],
  });
  assert.equal(calls[0].url.searchParams.get('spf0'), '1.eq.plan.pro');
});

test('ANA-11 goals match exact values or wildcards and report a conversion rate', async () => {
  assert.equal(goalMatchKind('/thanks'), 'exact');
  assert.equal(goalMatchKind('/blog/*'), 'wildcard');
  const { api, calls } = harness((url, init) => {
    if (url.pathname.endsWith('/stats')) return { num: 3, total: 12 };
    return { id: goalId, name: 'Blog reader', parameters: JSON.parse(String(init?.body)).parameters };
  });
  const goal = await api.createGoal(siteId, { name: 'Blog reader', type: 'path', value: '/blog/*' });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: 'Blog reader', parameters: { type: 'path', value: '/blog/*' } });
  assert.deepEqual(goal, { id: goalId, name: 'Blog reader', type: 'path', value: '/blog/*' });
  assert.deepEqual(await api.goalStats(siteId, goalId, range), { unique: 3, total: 12, rate: 0.25 });
  const { api: empty } = harness(() => ({ num: 0, total: 0 }));
  assert.deepEqual(await empty.goalStats(siteId, goalId, range), { unique: 0, total: 0, rate: 0 });
});

test('ANA-11 link and pixel hit counts follow the selected range', async () => {
  const linkId = 'a2df2563-f492-4be2-9fd8-2a7eb6a58e12';
  const pixelId = 'b41f79ad-2735-48c4-9ad2-9c3cc6a7f131';
  const { api, calls } = harness(url => ({
    data: { [url.pathname.includes('links') ? linkId : pixelId]: [{ x: '2026-01-01', y: 4 }, { x: '2026-01-02', y: 6 }] },
  }));
  const links = await api.linkCharts([linkId, linkId], range);
  const pixels = await api.pixelCharts([pixelId], range);
  assert.deepEqual(links[linkId], [{ label: '2026-01-01', value: 4 }, { label: '2026-01-02', value: 6 }]);
  assert.deepEqual(Object.keys(pixels), [pixelId]);
  assert.equal(calls[0].url.pathname, '/api/links/charts');
  assert.equal(calls[0].url.searchParams.get('ids'), linkId);
  assert.equal(calls[0].url.searchParams.get('startAt'), String(range.startAt));
  assert.equal(calls[0].url.searchParams.get('endAt'), String(range.endAt));
  assert.equal(calls[1].url.pathname, '/api/pixels/charts');
});
