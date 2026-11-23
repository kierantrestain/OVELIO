import assert from 'node:assert/strict';
import test from 'node:test';
import type { FilterDimension, ReportDimension, ReportFilters } from '../../src/contracts';
import { createUmami } from '../../src/server/umami';
import { UpstreamError } from '../../src/server/upstream';

/** An `is` filter on one dimension, the shape the console sends when a report row is clicked. */
const is = (dimension: FilterDimension, value: string): ReportFilters => ({
  rules: [{ dimension, operator: 'eq', values: [value] }],
});

const website = { id: '22b3bfe1-b34f-4472-bc18-123994f2ef31', name: 'Example', domain: 'example.test' };
const goalId = '61048d54-4909-4b06-a9b4-5b1e54e44b60';
const funnelId = '0e3a2187-7a8e-4eb8-b2b8-15db8bb06740';
const sessionId = '9c3a7e1f-44db-4f8b-94aa-22cc0f91a010';
const shareId = 'a2df2563-f492-4be2-9fd8-2a7eb6a58e12';
const annotationId = 'b41f79ad-2735-48c4-9ad2-9c3cc6a7f131';
const linkId = 'c81a44de-7f95-47ea-8812-3f9b2e74c045';
const pixelId = 'd92b55ef-8a06-48fb-9923-4a0c3f85d156';
const range = { startAt: 1767225600000, endAt: 1767311999999 };
const path = `/api/websites/${website.id}`;

test('reads the pinned statistics contract and distinguishes zero from unavailable', async () => {
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-key');
    if (url.pathname === path) return Response.json(website);
    if (url.pathname === `${path}/active`) return Response.json({ visitors: 3 });
    assert.equal(url.searchParams.get('startAt'), String(range.startAt));
    assert.equal(url.searchParams.get('endAt'), String(range.endAt));
    assert.equal(url.searchParams.get('timezone'), 'UTC');

    switch (url.pathname) {
      case `${path}/stats`:
        return Response.json({
          pageviews: 18, visitors: 9, visits: 11, bounces: 0, totaltime: 30,
          comparison: { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 },
        });
      case `${path}/pageviews`:
        return Response.json({
          pageviews: [{ x: '2026-01-01T12:00:00Z', y: 18 }],
          sessions: [{ x: '2026-01-01T12:00:00Z', y: 9 }],
        });
      case `${path}/events/series`:
        return Response.json([{ x: 'signup', t: '2026-01-01T12:00:00Z', y: 4 }]);
      case `${path}/utm/metrics`:
        assert.equal(url.searchParams.get('type'), 'utm_campaign');
        return Response.json([{ utm: 'launch', views: 5 }]);
      case `${path}/metrics`:
        assert.equal(url.searchParams.get('limit'), '20');
        if (url.searchParams.get('type') === 'country') return new Response(null, { status: 503 });
        return Response.json([]);
      default:
        assert.fail(`Unexpected endpoint ${url.pathname}`);
    }
  };
  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });
  const report = await api.report(website.id, range, ['country', 'event', 'utmCampaign']);

  assert.deepEqual(report.current, { pageviews: 18, visitors: 9, visits: 11, bounces: 0, totaltime: 30 });
  assert.deepEqual(report.previous, { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 });
  assert.equal(report.activeVisitors, 3);
  assert.deepEqual(report.pageviews, [{ label: '2026-01-01T12:00:00Z', value: 18 }]);
  assert.deepEqual(report.visitors, [{ label: '2026-01-01T12:00:00Z', value: 9 }]);
  assert.deepEqual(report.eventsSeries, [{ label: '2026-01-01T12:00:00Z', value: 4 }]);
  assert.deepEqual(report.dimensions, { country: null, event: [], utmCampaign: [{ label: 'launch', value: 5 }] });
});

test('shares a single login and refreshes an invalidated session', async () => {
  let logins = 0;
  let invalidateFirst = false;
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/auth/login') {
      assert.deepEqual(JSON.parse(String(options?.body)), { username: 'operator', password: 'protected' });
      return Response.json({ token: `session-${++logins}` });
    }
    const authorization = new Headers(options?.headers).get('authorization');
    if (invalidateFirst && authorization === 'Bearer session-1') return new Response(null, { status: 401 });
    assert.equal(authorization, `Bearer session-${logins}`);
    return Response.json({ data: [website], count: 1, page: 1 });
  };
  const api = createUmami({ url: 'http://tracking.test', username: 'operator', password: 'protected', fetch: fetcher });
  assert.deepEqual(await Promise.all([api.websites(), api.health()]), [[website], { status: 'ready' }]);
  assert.equal(logins, 1);

  invalidateFirst = true;
  assert.deepEqual(await Promise.all([api.websites(), api.health()]), [[website], { status: 'ready' }]);
  assert.equal(logins, 2);
});

test('creates native websites and goals and reads goal and funnel results', async () => {
  const steps = [{ type: 'path', value: '/pricing' }, { type: 'event', value: 'signup & purchase' }] as const;
  let created = false;
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));

    if (url.pathname === '/api/websites') {
      assert.equal(options?.method, 'POST');
      assert.deepEqual(JSON.parse(String(options.body)), { name: 'Demo', domain: 'localhost:3001' });
      return Response.json({ ...website, name: 'Demo', domain: 'localhost:3001' });
    }
    if (url.pathname === `${path}/goals`) {
      const goal = { id: goalId, name: 'Signup', parameters: { ...steps[1] } };
      if (options?.method === 'POST') {
        assert.deepEqual(JSON.parse(String(options.body)), { name: goal.name, parameters: goal.parameters });
        created = true;
        return Response.json(goal);
      }
      assert.equal(created, true);
      return Response.json({ data: [goal], count: 1 });
    }
    if (url.pathname === `${path}/goals/${goalId}/stats`) {
      assert.equal(url.searchParams.get('endAt'), String(range.endAt));
      return Response.json({ num: 2, total: 6 });
    }
    if (url.pathname === `${path}/funnels/stats`) {
      assert.deepEqual(JSON.parse(url.searchParams.get('steps') ?? ''), steps);
      assert.equal(url.searchParams.get('window'), '45');
      return Response.json([{ ...steps[0], visitors: 6 }, { ...steps[1], visitors: 2 }]);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });
  const registered = await api.createWebsite({ name: ' Demo ', domain: 'LOCALHOST:3001' });
  assert.equal(registered.domain, 'localhost:3001');
  const goal = await api.createGoal(website.id, { name: 'Signup', ...steps[1] });
  assert.deepEqual(await api.goals(website.id), [goal]);
  assert.deepEqual(await api.goalStats(website.id, goal.id, range), { unique: 2, total: 6, rate: 2 / 6 });
  assert.deepEqual(await api.funnel(website.id, range, [...steps], 45), [
    { label: '/pricing', visitors: 6 }, { label: 'signup & purchase', visitors: 2 },
  ]);
});

test('manages websites, shares, resets, and exports', async () => {
  const calls: string[] = [];
  const share = { id: shareId, name: 'Public Board', slug: 'pub1234567890abc' };
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);

    if (url.pathname === path && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), { name: 'Updated Site', domain: 'updated.test' });
      return Response.json({ ...website, name: 'Updated Site', domain: 'updated.test' });
    }
    if (url.pathname === path && method === 'DELETE') {
      return Response.json({ ok: true });
    }
    if (url.pathname === `${path}/reset` && method === 'POST') {
      return Response.json({ ok: true });
    }
    if (url.pathname === `${path}/shares` && method === 'GET') {
      return Response.json({ data: [{ ...share, entityId: website.id }], count: 1 });
    }
    if (url.pathname === `${path}/shares` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), { name: 'Public Board' });
      return Response.json(share);
    }
    if (url.pathname === `/api/share/id/${shareId}` && method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `${path}/export` && method === 'GET') {
      assert.equal(url.searchParams.get('startAt'), String(range.startAt));
      assert.equal(url.searchParams.get('endAt'), String(range.endAt));
      assert.equal(url.searchParams.get('timezone'), 'UTC');
      return Response.json({ zip: 'UEsDBAo=' });
    }
    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });
  const updated = await api.updateWebsite(website.id, { name: ' Updated Site ', domain: 'UPDATED.TEST' });
  assert.deepEqual(updated, { ...website, name: 'Updated Site', domain: 'updated.test' });
  await api.resetWebsite(website.id);
  const createdShare = await api.createShare(website.id, ' Public Board ');
  assert.deepEqual(createdShare, share);
  assert.deepEqual(await api.shares(website.id), [share]);
  await api.deleteShare(shareId);
  assert.deepEqual(await api.exportWebsite(website.id, range), { zip: 'UEsDBAo=' });
  await api.deleteWebsite(website.id);

  assert.deepEqual(calls, [
    `POST ${path}`,
    `POST ${path}/reset`,
    `POST ${path}/shares`,
    `GET ${path}/shares`,
    `DELETE /api/share/id/${shareId}`,
    `GET ${path}/export`,
    `DELETE ${path}`,
  ]);
});

test('supports all 22 dimensions, report filters, activeVisitors, eventsSeries aggregation, and optional totaltime', async () => {
  const allDimensions: ReportDimension[] = [
    'path', 'entry', 'exit', 'title', 'query', 'hostname',
    'referrer', 'channel', 'device', 'browser', 'os', 'screen',
    'country', 'region', 'city', 'language', 'event',
    'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
  ];
  const seenStandard = new Set<string>();
  const seenUtm = new Set<string>();
  let failOptional = false;

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === path) return Response.json(website);
    if (url.pathname === `${path}/active`) {
      return failOptional ? new Response(null, { status: 503 }) : Response.json({ visitors: 12 });
    }

    assert.equal(url.searchParams.get('country'), 'eq.GB');
    assert.equal(url.searchParams.get('utmMedium'), 'eq.email');
    assert.equal(url.searchParams.get('entry'), null);

    if (url.pathname === `${path}/stats`) {
      return Response.json({
        pageviews: 42, visitors: 20, visits: 24, bounces: 5,
        comparison: { pageviews: 30, visitors: 15, visits: 18, bounces: 4 },
      });
    }
    if (url.pathname === `${path}/pageviews`) {
      return Response.json({
        pageviews: [{ x: '2026-01-01T12:00:00Z', y: 42 }],
        sessions: [{ x: '2026-01-01T12:00:00Z', y: 20 }],
      });
    }
    if (url.pathname === `${path}/events/series`) {
      if (failOptional) return new Response(null, { status: 503 });
      return Response.json([
        { x: 'signup', t: '2026-01-01T12:00:00Z', y: 3 },
        { x: 'upgrade', t: '2026-01-01T12:00:00Z', y: 2 },
        { x: 'signup', t: '2026-01-01T13:00:00Z', y: 4 },
      ]);
    }
    if (url.pathname === `${path}/utm/metrics`) {
      const type = url.searchParams.get('type') ?? '';
      seenUtm.add(type);
      return Response.json([{ utm: `val-${type}`, views: 7 }]);
    }
    if (url.pathname === `${path}/metrics`) {
      assert.equal(url.searchParams.get('limit'), '20');
      const type = url.searchParams.get('type') ?? '';
      seenStandard.add(type);
      if (type === 'referrer') return Response.json([{ x: null, y: 8 }]);
      return Response.json([{ x: `metric-${type}`, y: 4 }]);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });
  assert.equal(await api.activeVisitors(website.id), 12);

  const filters: ReportFilters = {
    rules: [
      { dimension: 'country', operator: 'eq', values: [' GB '] },
      { dimension: 'utmMedium', operator: 'eq', values: ['email'] },
    ],
  };
  const report = await api.report(website.id, range, allDimensions, filters);

  assert.deepEqual(report.filters, filters);
  assert.deepEqual(report.current, { pageviews: 42, visitors: 20, visits: 24, bounces: 5 });
  assert.equal('totaltime' in (report.current ?? {}), false);
  assert.equal(report.activeVisitors, 12);
  assert.deepEqual(report.eventsSeries, [
    { label: '2026-01-01T12:00:00Z', value: 5 },
    { label: '2026-01-01T13:00:00Z', value: 4 },
  ]);
  assert.equal(seenStandard.size, 17);
  assert.deepEqual(seenUtm, new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']));
  assert.deepEqual(report.dimensions.referrer, [{ label: 'Direct', value: 8 }]);
  assert.deepEqual(report.dimensions.channel, [{ label: 'metric-channel', value: 4 }]);
  assert.deepEqual(report.dimensions.utmContent, [{ label: 'val-utm_content', value: 7 }]);
  assert.deepEqual(report.dimensions.utmTerm, [{ label: 'val-utm_term', value: 7 }]);

  failOptional = true;
  const degraded = await api.report(website.id, range, [], { rules: [{ dimension: 'country', operator: 'eq', values: ['GB'] }, { dimension: 'utmMedium', operator: 'eq', values: ['email'] }] });
  assert.equal(degraded.activeVisitors, null);
  assert.equal(degraded.eventsSeries, null);
});

test('normalizes realtime responses in both map-style and array-style formats', async () => {
  let mode: 'map' | 'array' | 'invalid' = 'map';
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, `/api/realtime/${website.id}`);
    if (mode === 'map') {
      return Response.json({
        countries: { US: 2, GB: 5 },
        urls: { '/pricing': 3, '/': 7 },
        referrers: { 'google.com': 4, '': 1 },
        events: [{
          __type: 'event',
          urlPath: '/pricing',
          eventName: 'cta_click',
          country: 'GB',
          browser: 'chrome',
          device: 'desktop',
          createdAt: '2026-01-01T12:05:00Z',
        }],
        series: {
          views: [{ x: '2026-01-01T12:04:00Z', y: 4 }, { x: '2026-01-01T12:05:00Z', y: 6 }],
          visitors: [{ x: '2026-01-01T12:04:00Z', y: 3 }],
        },
        totals: { views: 10, visitors: 7, events: 2, countries: 2 },
      });
    }
    if (mode === 'array') {
      return Response.json({
        countries: [{ x: 'DE', y: 3 }],
        urls: [{ label: '/docs', value: 4 }],
        referrers: [{ x: null, y: 2 }],
        events: [{
          type: 'pageview',
          path: '/docs',
          createdAt: '2026-01-01T12:06:00Z',
        }],
        series: [{ x: '2026-01-01T12:06:00Z', y: 4 }],
        totals: { pageviews: 4, visitors: 3, events: 0 },
      });
    }
    return Response.json({ unexpected: true });
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const mapReport = await api.realtime(website.id);
  assert.deepEqual(mapReport, {
    visitors: 7,
    pageviews: 10,
    events: 2,
    countries: [{ label: 'GB', value: 5 }, { label: 'US', value: 2 }],
    urls: [{ label: '/', value: 7 }, { label: '/pricing', value: 3 }],
    referrers: [{ label: 'google.com', value: 4 }, { label: 'Direct', value: 1 }],
    series: [{ label: '2026-01-01T12:04:00Z', value: 4 }, { label: '2026-01-01T12:05:00Z', value: 6 }],
    recent: [{
      type: 'event',
      path: '/pricing',
      eventName: 'cta_click',
      country: 'GB',
      browser: 'chrome',
      device: 'desktop',
      createdAt: '2026-01-01T12:05:00Z',
    }],
  });

  mode = 'array';
  const arrayReport = await api.realtime(website.id);
  assert.deepEqual(arrayReport, {
    visitors: 3,
    pageviews: 4,
    events: 0,
    countries: [{ label: 'DE', value: 3 }],
    urls: [{ label: '/docs', value: 4 }],
    referrers: [{ label: 'Direct', value: 2 }],
    series: [{ label: '2026-01-01T12:06:00Z', value: 4 }],
    recent: [{
      type: 'pageview',
      path: '/docs',
      eventName: null,
      country: null,
      browser: null,
      device: null,
      createdAt: '2026-01-01T12:06:00Z',
    }],
  });

  mode = 'invalid';
  await assert.rejects(() => api.realtime(website.id), (error: unknown) =>
    error instanceof UpstreamError && error.status === 502);
});

test('reads sessions, session activity, and weekly traffic heatmap', async () => {
  const matrix = Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (__, hr) => day + hr));
  let badMatrix = false;

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('startAt'), String(range.startAt));
    assert.equal(url.searchParams.get('endAt'), String(range.endAt));

    if (url.pathname === `${path}/sessions`) {
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('pageSize'), '25');
      assert.equal(url.searchParams.get('search'), 'chrome');
      assert.equal(url.searchParams.get('country'), 'eq.US');
      return Response.json({
        data: [{
          id: sessionId,
          hostname: 'example.test',
          browser: 'chrome',
          os: 'macOS',
          device: 'desktop',
          screen: '1440x900',
          language: 'en-US',
          country: 'US',
          region: 'CA',
          city: 'San Francisco',
          firstAt: '2026-01-01T10:00:00Z',
          lastAt: '2026-01-01T10:15:00Z',
          visits: 2,
          views: 7,
          events: 1,
        }],
        count: 40,
        page: 2,
        pageSize: 25,
      });
    }
    if (url.pathname === `${path}/sessions/${sessionId}/activity`) {
      return Response.json([
        {
          eventId: 'evt-1',
          createdAt: '2026-01-01T10:00:00Z',
          urlPath: '/pricing',
          urlQuery: '?plan=pro',
          referrerDomain: 'google.com',
          eventName: null,
          eventType: 1,
        },
        {
          id: 'evt-2',
          createdAt: '2026-01-01T10:05:00Z',
          urlPath: '/pricing',
          urlQuery: null,
          referrerDomain: null,
          eventName: 'start_trial',
          eventType: 2,
          pageTitle: 'Pricing',
        },
      ]);
    }
    if (url.pathname === `${path}/sessions/weekly`) {
      assert.equal(url.searchParams.get('device'), 'eq.desktop');
      return Response.json(badMatrix ? [[1, 2, 3]] : matrix);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const page = await api.sessions(website.id, range, {
    page: 2,
    pageSize: 25,
    search: ' chrome ',
    filters: is('country', 'US'),
  });
  assert.equal(page.total, 40);
  assert.equal(page.page, 2);
  assert.equal(page.limit, 25);
  assert.equal(page.items[0]?.id, sessionId);
  assert.equal(page.items[0]?.views, 7);

  const activity = await api.sessionActivity(website.id, sessionId, range);
  assert.deepEqual(activity, [
    {
      id: 'evt-1',
      createdAt: '2026-01-01T10:00:00Z',
      urlPath: '/pricing',
      urlQuery: '?plan=pro',
      referrerDomain: 'google.com',
      eventName: null,
      eventType: 1,
      pageTitle: null,
    },
    {
      id: 'evt-2',
      createdAt: '2026-01-01T10:05:00Z',
      urlPath: '/pricing',
      urlQuery: null,
      referrerDomain: null,
      eventName: 'start_trial',
      eventType: 2,
      pageTitle: 'Pricing',
    },
  ]);

  const weekly = await api.weeklyTraffic(website.id, range, is('device', 'desktop'));
  assert.equal(weekly.length, 7);
  assert.equal(weekly[0]?.length, 24);
  assert.deepEqual(weekly, matrix);

  badMatrix = true;
  await assert.rejects(() => api.weeklyTraffic(website.id, range, is('device', 'desktop')), (error: unknown) =>
    error instanceof UpstreamError && error.status === 502);
});

test('reads event data properties and property values', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === `${path}/event-data/properties`) {
      assert.equal(url.searchParams.get('event'), 'eq.checkout');
      return Response.json([
        { eventName: 'checkout', propertyName: 'plan', dataType: 1, total: 14 },
      ]);
    }
    if (url.pathname === `${path}/event-data/values`) {
      assert.equal(url.searchParams.get('event'), 'checkout');
      assert.equal(url.searchParams.get('propertyName'), 'plan');
      return Response.json([
        { value: 'pro', total: 10 },
        { value: 99, total: 4 },
      ]);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });
  assert.deepEqual(await api.eventProperties(website.id, range, is('event', 'checkout')), [
    { eventName: 'checkout', propertyName: 'plan', total: 14 },
  ]);
  assert.deepEqual(await api.eventPropertyValues(website.id, range, 'checkout', 'plan'), [
    { value: 'pro', total: 10 },
    { value: '99', total: 4 },
  ]);
});

test('manages full CRUD for goals and saved funnels plus saved funnel stats', async () => {
  const steps = [{ type: 'path' as const, value: '/pricing' }, { type: 'event' as const, value: 'subscribed' }];
  const savedFunnelRaw = {
    id: funnelId,
    name: 'Checkout Funnel',
    description: 'Pricing to signup',
    parameters: { window: 90, steps },
  };

  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';

    if (url.pathname === `${path}/goals/${goalId}` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        name: 'Updated Goal',
        parameters: { type: 'path', value: '/thanks' },
      });
      return Response.json({ id: goalId, name: 'Updated Goal', parameters: { type: 'path', value: '/thanks' } });
    }
    if (url.pathname === `${path}/goals/${goalId}` && method === 'DELETE') {
      return Response.json({ ok: true });
    }
    if (url.pathname === `${path}/funnels` && method === 'GET') {
      return Response.json({ data: [savedFunnelRaw], count: 1 });
    }
    if (url.pathname === `${path}/funnels` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        name: 'Checkout Funnel',
        description: 'Pricing to signup',
        parameters: { window: 90, steps },
      });
      return Response.json(savedFunnelRaw);
    }
    if (url.pathname === `${path}/funnels/${funnelId}` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        name: 'Checkout v2',
        parameters: { window: 120, steps },
      });
      return Response.json({
        id: funnelId,
        name: 'Checkout v2',
        description: '',
        parameters: { window: 120, steps },
      });
    }
    if (url.pathname === `${path}/funnels/${funnelId}` && method === 'DELETE') {
      return Response.json({ ok: true });
    }
    if (url.pathname === `${path}/funnels/${funnelId}/stats` && method === 'GET') {
      assert.equal(url.searchParams.get('startAt'), String(range.startAt));
      return Response.json([
        { type: 'path', value: '/pricing', visitors: 50 },
        { type: 'event', value: 'subscribed', visitors: 15 },
      ]);
    }
    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(
    await api.updateGoal(website.id, goalId, { name: ' Updated Goal ', type: 'path', value: '/thanks' }),
    { id: goalId, name: 'Updated Goal', type: 'path', value: '/thanks' },
  );
  await api.deleteGoal(website.id, goalId);

  const created = await api.createFunnel(website.id, {
    name: ' Checkout Funnel ',
    description: 'Pricing to signup',
    steps,
    windowMinutes: 90,
  });
  assert.deepEqual(created, {
    id: funnelId,
    name: 'Checkout Funnel',
    description: 'Pricing to signup',
    steps,
    windowMinutes: 90,
  });
  assert.deepEqual(await api.funnels(website.id), [created]);
  assert.deepEqual(
    await api.updateFunnel(website.id, funnelId, { name: 'Checkout v2', steps, windowMinutes: 120 }),
    { id: funnelId, name: 'Checkout v2', steps, windowMinutes: 120 },
  );
  assert.deepEqual(await api.funnelStats(website.id, funnelId, range), [
    { label: '/pricing', visitors: 50 },
    { label: 'subscribed', visitors: 15 },
  ]);
  await api.deleteFunnel(website.id, funnelId);
});

test('reads retention, journeys, attribution, and multi-dimensional breakdown', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === `${path}/retention`) {
      assert.equal(url.searchParams.get('country'), 'eq.FR');
      return Response.json([
        { date: '2026-01-01', day: 0, visitors: 20, returnVisitors: 20, percentage: 100 },
        { date: '2026-01-01', day: 1, visitors: 20, returnVisitors: 5, percentage: 25.5 },
      ]);
    }
    if (url.pathname === `${path}/journeys`) {
      assert.equal(url.searchParams.get('steps'), '4');
      assert.equal(url.searchParams.get('startStep'), '/');
      assert.equal(url.searchParams.get('endStep'), '/signup');
      assert.equal(url.searchParams.get('browser'), 'eq.safari');
      return Response.json([
        { items: ['/', '/pricing', '/signup', null], count: 14 },
      ]);
    }
    if (url.pathname === `${path}/attribution`) {
      assert.equal(url.searchParams.get('model'), 'first-click');
      assert.equal(url.searchParams.get('type'), 'event');
      assert.equal(url.searchParams.get('step'), 'purchase');
      return Response.json({
        referrer: [{ name: '', value: 3 }, { name: 'google.com', value: 7 }],
        paidAds: [{ name: 'Google Ads', value: 4 }],
        utm_source: [{ name: 'newsletter', value: 6 }],
        utm_medium: [{ name: 'email', value: 6 }],
        utm_campaign: [{ name: 'spring', value: 5 }],
        utm_content: [{ name: 'hero', value: 2 }],
        utm_term: [{ name: 'automation', value: 1 }],
        total: { pageviews: 25, visitors: 10, visits: 12 },
      });
    }
    if (url.pathname === `${path}/breakdown`) {
      assert.deepEqual(JSON.parse(url.searchParams.get('fields') ?? ''), ['country', 'browser']);
      assert.equal(url.searchParams.get('device'), 'eq.mobile');
      return Response.json([
        { country: 'US', browser: 'chrome', views: 30, visitors: 12, visits: 14, bounces: 3, totaltime: 400 },
      ]);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(await api.retention(website.id, range, is('country', 'FR')), [
    { date: '2026-01-01', day: 0, visitors: 20, returnVisitors: 20, percentage: 100 },
    { date: '2026-01-01', day: 1, visitors: 20, returnVisitors: 5, percentage: 25.5 },
  ]);

  assert.deepEqual(
    await api.journeys(website.id, range, { steps: 4, startStep: '/', endStep: '/signup', filters: is('browser', 'safari') }),
    [{ items: ['/', '/pricing', '/signup'], count: 14 }],
  );

  assert.deepEqual(
    await api.attribution(website.id, range, { model: 'first-click', type: 'event', step: 'purchase' }),
    {
      referrer: [{ label: 'Direct', value: 3 }, { label: 'google.com', value: 7 }],
      paidAds: [{ label: 'Google Ads', value: 4 }],
      utmSource: [{ label: 'newsletter', value: 6 }],
      utmMedium: [{ label: 'email', value: 6 }],
      utmCampaign: [{ label: 'spring', value: 5 }],
      utmContent: [{ label: 'hero', value: 2 }],
      utmTerm: [{ label: 'automation', value: 1 }],
      total: { pageviews: 25, visitors: 10, visits: 12 },
      revenue: null,
    },
  );

  assert.deepEqual(
    await api.breakdown(website.id, range, ['country', 'browser', 'country'], is('device', 'mobile')),
    [{ country: 'US', browser: 'chrome', views: 30, visitors: 12, visits: 14, bounces: 3, totaltime: 400 }],
  );

  await assert.rejects(() => api.breakdown(website.id, range, ['not_a_real_field']));
});

test('manages annotations, tracked links, and tracking pixels CRUD', async () => {
  let generatedLinkSlug = '';
  let generatedPixelSlug = '';

  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';

    if (url.pathname === `${path}/annotations` && method === 'GET') {
      return Response.json({
        data: [{ id: annotationId, date: '2026-01-01T00:00:00.000Z', allDay: true, note: 'Launch day' }],
        count: 1,
      });
    }
    if (url.pathname === `${path}/annotations` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        date: '2026-01-01',
        allDay: true,
        note: 'Launch day',
      });
      return Response.json({ id: annotationId, date: '2026-01-01T00:00:00.000Z', allDay: true, note: 'Launch day' });
    }
    if (url.pathname === `${path}/annotations/${annotationId}` && method === 'DELETE') {
      return Response.json({ ok: true });
    }
    if (url.pathname === '/api/links' && method === 'GET') {
      return Response.json({
        data: [{ id: linkId, name: 'Promo', url: 'https://example.test/promo', slug: generatedLinkSlug, createdAt: '2026-01-01T00:00:00Z' }],
        count: 1,
      });
    }
    if (url.pathname === '/api/links' && method === 'POST') {
      const body = JSON.parse(String(options?.body)) as { name: string; url: string; slug: string };
      assert.equal(body.name, 'Promo');
      assert.equal(body.url, 'https://example.test/promo');
      assert.match(body.slug, /^[a-z0-9_-]{8,100}$/i);
      generatedLinkSlug = body.slug;
      return Response.json({ id: linkId, ...body, createdAt: '2026-01-01T00:00:00Z' });
    }
    if (url.pathname === `/api/links/${linkId}` && method === 'DELETE') {
      return Response.json({ ok: true });
    }
    if (url.pathname === '/api/pixels' && method === 'GET') {
      return Response.json({
        data: [{ id: pixelId, name: 'Newsletter Open', slug: generatedPixelSlug, createdAt: null }],
        count: 1,
      });
    }
    if (url.pathname === '/api/pixels' && method === 'POST') {
      const body = JSON.parse(String(options?.body)) as { name: string; slug: string };
      assert.equal(body.name, 'Newsletter Open');
      assert.match(body.slug, /^[a-z0-9_-]{8,100}$/i);
      generatedPixelSlug = body.slug;
      return Response.json({ id: pixelId, ...body, createdAt: null });
    }
    if (url.pathname === `/api/pixels/${pixelId}` && method === 'DELETE') {
      return Response.json({ ok: true });
    }
    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const note = await api.createAnnotation(website.id, { date: '2026-01-01', note: ' Launch day ' });
  assert.deepEqual(note, { id: annotationId, date: '2026-01-01T00:00:00.000Z', allDay: true, note: 'Launch day' });
  assert.deepEqual(await api.annotations(website.id, range), [note]);
  assert.deepEqual(await api.annotations(website.id), [note]);
  await api.deleteAnnotation(website.id, annotationId);

  const autoLink = await api.createLink({ name: ' Promo ', url: 'https://example.test/promo' });
  assert.equal(autoLink.slug.length, 10);
  const customLink = await api.createLink({ name: 'Promo', url: 'https://example.test/promo', slug: 'promo-2026' });
  assert.equal(customLink.slug, 'promo-2026');
  assert.deepEqual(await api.links(), [customLink]);
  await api.deleteLink(linkId);
  await assert.rejects(() => api.createLink({ name: 'Bad', url: 'javascript:alert(1)' }));
  await assert.rejects(() => api.createLink({ name: 'Short', url: 'https://example.test', slug: 'short' }));

  const autoPixel = await api.createPixel({ name: ' Newsletter Open ' });
  assert.equal(autoPixel.slug.length, 10);
  const customPixel = await api.createPixel({ name: 'Newsletter Open', slug: 'pixel-2026' });
  assert.equal(customPixel.slug, 'pixel-2026');
  assert.deepEqual(await api.pixels(), [customPixel]);
  await api.deletePixel(pixelId);
});

test('manages saved website segments and cohorts with parameter normalization and 404-tolerant delete', async () => {
  const segmentId = 'e11a66f0-9b17-49ac-aa34-5b1d4f96e267';
  const cohortId = 'f22b77a1-0c28-4abd-bb45-6c2e5a07f378';
  let deleteStatus = 204;

  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';

    if (url.pathname === `${path}/segments` && method === 'GET') {
      const type = url.searchParams.get('type');
      if (type === 'segment') {
        return Response.json({
          data: [{
            id: segmentId,
            name: 'US Mobile',
            type: 'segment',
            parameters: {
              filters: [{ name: 'country', operator: 'eq', value: 'US' }, { name: 'views', operator: 'gt', value: 2 }],
              match: 'all',
            },
            createdAt: '2026-01-01T00:00:00Z',
          }],
        });
      }
      if (type === 'cohort') {
        return Response.json([
          {
            id: cohortId,
            name: 'Recent Signups',
            type: 'cohort',
            parameters: {
              dateRange: { value: '30day' },
              action: { type: 'event', value: 'signup' },
            },
            createdAt: null,
          },
        ]);
      }
      assert.fail(`Unexpected segment type ${type}`);
    }

    if (url.pathname === `${path}/segments` && method === 'POST') {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      if (body.type === 'segment') {
        assert.deepEqual(body, {
          type: 'segment',
          name: 'US Mobile',
          parameters: {
            filters: [{ name: 'country', operator: 'eq', value: 'US' }],
            match: 'any',
          },
        });
        return Response.json({
          id: segmentId,
          name: 'US Mobile',
          type: 'segment',
          parameters: body.parameters,
          createdAt: '2026-01-01T00:00:00Z',
        });
      }
      assert.deepEqual(body, {
        type: 'cohort',
        name: 'Recent Signups',
        parameters: {
          dateRange: '30day',
          action: { type: 'event', value: 'signup' },
        },
      });
      return Response.json({
        id: cohortId,
        name: 'Recent Signups',
        type: 'cohort',
        parameters: body.parameters,
        createdAt: null,
      });
    }

    if (url.pathname === `${path}/segments/${segmentId}` && method === 'DELETE') {
      return new Response(null, { status: deleteStatus });
    }

    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(await api.segments(website.id), [{
    id: segmentId,
    name: 'US Mobile',
    type: 'segment',
    filters: [
      { name: 'country', operator: 'eq', value: 'US' },
      { name: 'views', operator: 'gt', value: '2' },
    ],
    match: 'all',
    createdAt: '2026-01-01T00:00:00Z',
  }]);

  assert.deepEqual(await api.segments(website.id, 'cohort'), [{
    id: cohortId,
    name: 'Recent Signups',
    type: 'cohort',
    filters: [],
    dateRange: '30day',
    action: { type: 'event', value: 'signup' },
    createdAt: null,
  }]);

  const createdSegment = await api.createSegment(website.id, {
    name: ' US Mobile ',
    type: 'segment',
    filters: [{ name: ' country ', operator: 'eq', value: 'US' }],
    match: 'any',
  });
  assert.deepEqual(createdSegment, {
    id: segmentId,
    name: 'US Mobile',
    type: 'segment',
    filters: [{ name: 'country', operator: 'eq', value: 'US' }],
    match: 'any',
    createdAt: '2026-01-01T00:00:00Z',
  });

  const createdCohort = await api.createSegment(website.id, {
    name: 'Recent Signups',
    type: 'cohort',
    filters: [],
    dateRange: '30day',
    action: { type: 'event', value: 'signup' },
  });
  assert.deepEqual(createdCohort, {
    id: cohortId,
    name: 'Recent Signups',
    type: 'cohort',
    filters: [],
    dateRange: '30day',
    action: { type: 'event', value: 'signup' },
    createdAt: null,
  });

  await api.deleteSegment(website.id, segmentId);
  deleteStatus = 404;
  await api.deleteSegment(website.id, segmentId);
  deleteStatus = 500;
  await assert.rejects(() => api.deleteSegment(website.id, segmentId), (error: unknown) =>
    error instanceof UpstreamError && error.status === 500);
});

test('reads revenue report in parallel across stats, chart, and metrics', async () => {
  const multiDayRange = { startAt: 1767225600000, endAt: 1767225600000 + 5 * 24 * 60 * 60 * 1000 };
  let chartStyle: 'wrapped' | 'array' = 'wrapped';

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('timezone'), 'UTC');

    if (url.pathname === `${path}/revenue/stats`) {
      if (url.searchParams.get('currency') === 'EUR') {
        assert.equal(url.searchParams.get('country'), 'eq.DE');
        return Response.json({
          sum: null,
          count: 0,
          unique_count: 0,
          total_sessions: 10,
          average: null,
          arpu: null,
          comparison: null,
        });
      }
      assert.equal(url.searchParams.get('currency'), 'USD');
      return Response.json({
        sum: '1249.50',
        count: '5',
        unique_count: '4',
        total_sessions: '25',
        average: '249.9',
        arpu: '49.98',
        comparison: {
          sum: 1000,
          count: 4,
          unique_count: 3,
          total_sessions: 20,
          average: 250,
          arpu: 50,
        },
      });
    }

    if (url.pathname === `${path}/revenue/chart`) {
      if (chartStyle === 'wrapped') {
        assert.equal(url.searchParams.get('unit'), 'hour');
        return Response.json({
          chart: [
            { x: '2026-01-01T10:00:00Z', y: '499.5' },
            { x: '2026-01-01T11:00:00Z', y: 750 },
          ],
        });
      }
      assert.equal(url.searchParams.get('unit'), 'day');
      return Response.json([
        { x: 'EUR', t: '2026-01-01T00:00:00Z', y: 120 },
      ]);
    }

    if (url.pathname === `${path}/revenue/metrics`) {
      const type = url.searchParams.get('type');
      if (type === 'country') {
        return Response.json([
          { name: 'US', sum: '849.5', count: '3' },
          { x: 'GB', sum: 400, count: 2 },
        ]);
      }
      if (type === 'referrer') {
        return Response.json([
          { x: null, y: 120, count: 1 },
        ]);
      }
      assert.fail(`Unexpected revenue metric type ${type}`);
    }

    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const usd = await api.revenueReport(website.id, range);
  assert.deepEqual(usd, {
    currency: 'USD',
    stats: {
      sum: 1249.5,
      count: 5,
      uniqueCount: 4,
      totalSessions: 25,
      average: 249.9,
      arpu: 49.98,
    },
    comparison: {
      sum: 1000,
      count: 4,
      uniqueCount: 3,
      totalSessions: 20,
      average: 250,
      arpu: 50,
    },
    chart: [
      { label: '2026-01-01T10:00:00Z', value: 499.5 },
      { label: '2026-01-01T11:00:00Z', value: 750 },
    ],
    metrics: [
      { name: 'US', sum: 849.5, count: 3 },
      { name: 'GB', sum: 400, count: 2 },
    ],
  });

  chartStyle = 'array';
  const eur = await api.revenueReport(website.id, multiDayRange, ' eur ', 'referrer', is('country', 'DE'));
  assert.deepEqual(eur, {
    currency: 'EUR',
    stats: {
      sum: 0,
      count: 0,
      uniqueCount: 0,
      totalSessions: 10,
      average: 0,
      arpu: 0,
    },
    comparison: null,
    chart: [{ label: '2026-01-01T00:00:00Z', value: 120 }],
    metrics: [{ name: 'Direct', sum: 120, count: 1 }],
  });

  await assert.rejects(() => api.revenueReport(website.id, range, 'US'));
  await assert.rejects(() => api.revenueReport(website.id, range, 'USD', 'path' as never));
});

test('reads web performance report in parallel for Core Web Vitals', async () => {
  let chartMode: 'xy' | 'percentiles' = 'xy';

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('startAt'), String(range.startAt));
    assert.equal(url.searchParams.get('endAt'), String(range.endAt));
    assert.equal(url.searchParams.get('timezone'), 'UTC');

    if (url.pathname === `${path}/performance/stats`) {
      return Response.json({
        lcp: { p50: 1200, p75: '1850.5', p95: 2900 },
        inp: null,
        cls: { p50: 0.02, p75: '4.5e-2', p95: 0.12 },
        fcp: { p50: 800, p75: 1100, p95: 1800 },
        ttfb: { p50: 180, p75: 260, p95: 520 },
        count: '42',
      });
    }

    if (url.pathname === `${path}/performance/chart`) {
      assert.equal(url.searchParams.get('unit'), 'hour');
      if (chartMode === 'xy') {
        assert.equal(url.searchParams.get('metric'), 'lcp');
        return Response.json({
          chart: [
            { x: '2026-01-01T10:00:00Z', y: 1600 },
            { x: '2026-01-01T11:00:00Z', y: 1850.5 },
          ],
        });
      }
      assert.equal(url.searchParams.get('metric'), 'cls');
      assert.equal(url.searchParams.get('device'), 'eq.mobile');
      return Response.json([
        { t: '2026-01-01T10:00:00Z', p50: 0.02, p75: 0.045, p95: 0.11 },
      ]);
    }

    if (url.pathname === `${path}/performance/metrics`) {
      if (chartMode === 'xy') {
        assert.equal(url.searchParams.get('metric'), 'lcp');
        assert.equal(url.searchParams.get('type'), 'path');
        return Response.json([
          { name: '/pricing', count: '18', p50: 1100, p75: 1700, p95: 2600 },
        ]);
      }
      assert.equal(url.searchParams.get('metric'), 'cls');
      assert.equal(url.searchParams.get('type'), 'browser');
      return Response.json({
        data: [
          { x: 'chrome', count: 20, p50: 0.02, p75: 0.045, p95: 0.1 },
        ],
      });
    }

    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const lcp = await api.performanceReport(website.id, range);
  assert.deepEqual(lcp, {
    metric: 'lcp',
    stats: {
      lcp: { p50: 1200, p75: 1850.5, p95: 2900 },
      inp: { p50: 0, p75: 0, p95: 0 },
      cls: { p50: 0.02, p75: 0.045, p95: 0.12 },
      fcp: { p50: 800, p75: 1100, p95: 1800 },
      ttfb: { p50: 180, p75: 260, p95: 520 },
      count: 42,
    },
    chart: [
      { label: '2026-01-01T10:00:00Z', value: 1600 },
      { label: '2026-01-01T11:00:00Z', value: 1850.5 },
    ],
    metrics: [
      { name: '/pricing', count: 18, p50: 1100, p75: 1700, p95: 2600 },
    ],
  });

  chartMode = 'percentiles';
  const cls = await api.performanceReport(website.id, range, 'cls', 'browser', is('device', 'mobile'));
  assert.equal(cls.metric, 'cls');
  assert.deepEqual(cls.chart, [{ label: '2026-01-01T10:00:00Z', value: 0.045 }]);
  assert.deepEqual(cls.metrics, [{ name: 'chrome', count: 20, p50: 0.02, p75: 0.045, p95: 0.1 }]);

  await assert.rejects(() => api.performanceReport(website.id, range, 'fid' as never));
  await assert.rejects(() => api.performanceReport(website.id, range, 'lcp', 'country' as never));
});

test('reads expanded metrics and coerces numeric strings to numbers', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, `${path}/metrics/expanded`);
    assert.equal(url.searchParams.get('startAt'), String(range.startAt));
    assert.equal(url.searchParams.get('endAt'), String(range.endAt));

    if (url.searchParams.get('type') === 'path') {
      assert.equal(url.searchParams.get('limit'), '25');
      return Response.json([
        { name: '/pricing', pageviews: '1', visitors: '1', visits: '1', bounces: '0', totaltime: '45' },
        { name: '/docs', pageviews: 12, visitors: '8', visits: 9, bounces: null, totaltime: 'not-a-num' },
      ]);
    }
    assert.equal(url.searchParams.get('type'), 'referrer');
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('country'), 'eq.US');
    return Response.json([
      { name: null, pageviews: '5', visitors: '3', visits: '4', bounces: '1', totaltime: '90' },
    ]);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(await api.expandedMetrics(website.id, range, 'path'), [
    { name: '/pricing', pageviews: 1, visitors: 1, visits: 1, bounces: 0, totaltime: 45 },
    { name: '/docs', pageviews: 12, visitors: 8, visits: 9, bounces: 0, totaltime: 0 },
  ]);

  assert.deepEqual(await api.expandedMetrics(website.id, range, 'referrer', is('country', 'US'), 10), [
    { name: 'Direct', pageviews: 5, visitors: 3, visits: 4, bounces: 1, totaltime: 90 },
  ]);

  await assert.rejects(() => api.expandedMetrics(website.id, range, 'path', undefined, 0));
});

test('reads paginated raw events feed with search and filters', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, `${path}/events`);
    assert.equal(url.searchParams.get('startAt'), String(range.startAt));
    assert.equal(url.searchParams.get('endAt'), String(range.endAt));
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('pageSize'), '15');
    assert.equal(url.searchParams.get('search'), 'checkout');
    assert.equal(url.searchParams.get('country'), 'eq.GB');

    return Response.json({
      data: [
        {
          id: 'evt-101',
          sessionId,
          urlPath: '/checkout',
          pageTitle: 'Checkout',
          eventName: 'purchase',
          eventType: '2',
          referrerDomain: 'google.com',
          country: 'GB',
          device: 'desktop',
          browser: 'chrome',
          createdAt: '2026-01-01T12:00:00Z',
        },
        {
          id: 'evt-102',
          sessionId,
          urlPath: null,
          eventType: 1,
          createdAt: '2026-01-01T12:01:00Z',
        },
      ],
      count: 42,
      page: 2,
      pageSize: 15,
    });
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const feed = await api.eventsFeed(website.id, range, {
    page: 2,
    pageSize: 15,
    search: ' checkout ',
    filters: is('country', 'GB'),
  });

  assert.deepEqual(feed, {
    items: [
      {
        id: 'evt-101',
        sessionId,
        urlPath: '/checkout',
        pageTitle: 'Checkout',
        eventName: 'purchase',
        eventType: 2,
        referrerDomain: 'google.com',
        country: 'GB',
        device: 'desktop',
        browser: 'chrome',
        createdAt: '2026-01-01T12:00:00Z',
      },
      {
        id: 'evt-102',
        sessionId,
        urlPath: '',
        pageTitle: null,
        eventName: null,
        eventType: 1,
        referrerDomain: null,
        country: null,
        device: null,
        browser: null,
        createdAt: '2026-01-01T12:01:00Z',
      },
    ],
    total: 42,
    page: 2,
    limit: 15,
  });
});

test('reads session stats and session data properties', async () => {
  let wrappedStats = false;

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === `${path}/sessions/stats`) {
      assert.equal(url.searchParams.get('device'), 'eq.desktop');
      if (wrappedStats) {
        return Response.json({
          pageviews: { value: '120' },
          visitors: { value: 45 },
          visits: { value: 52 },
          countries: { value: 8 },
          events: { value: null },
        });
      }
      return Response.json({
        pageviews: 120,
        visitors: 45,
        visits: 52,
        countries: 8,
        events: 15,
      });
    }

    if (url.pathname === `${path}/session-data/properties`) {
      return Response.json([
        { propertyName: 'plan', total: '24' },
        { propertyName: 'role', total: 10 },
      ]);
    }

    if (url.pathname === `${path}/session-data/values`) {
      assert.equal(url.searchParams.get('propertyName'), 'plan');
      return Response.json([
        { value: 'pro', total: 18 },
        { value: true, total: 6 },
      ]);
    }

    if (url.pathname === `${path}/sessions/${sessionId}/properties`) {
      return Response.json([
        { propertyName: 'plan', value: 'pro', dataType: 1 },
        { dataKey: 'seats', stringValue: '', numberValue: 12, dateValue: null, dataType: 2 },
        { dataKey: 'joinedAt', stringValue: null, numberValue: null, dateValue: '2026-01-01T00:00:00Z', dataType: 4 },
      ]);
    }

    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(await api.sessionStats(website.id, range, is('device', 'desktop')), {
    pageviews: 120,
    visitors: 45,
    visits: 52,
    countries: 8,
    events: 15,
  });

  wrappedStats = true;
  assert.deepEqual(await api.sessionStats(website.id, range, is('device', 'desktop')), {
    pageviews: 120,
    visitors: 45,
    visits: 52,
    countries: 8,
    events: 0,
  });

  assert.deepEqual(await api.sessionProperties(website.id, range), [
    { propertyName: 'plan', total: 24 },
    { propertyName: 'role', total: 10 },
  ]);

  assert.deepEqual(await api.sessionPropertyValues(website.id, range, ' plan '), [
    { value: 'pro', total: 18 },
    { value: 'true', total: 6 },
  ]);

  assert.deepEqual(await api.singleSessionProperties(website.id, sessionId), [
    { propertyName: 'plan', value: 'pro', dataType: 1 },
    { propertyName: 'seats', value: '12', dataType: 2 },
    { propertyName: 'joinedAt', value: '2026-01-01T00:00:00Z', dataType: 4 },
  ]);
});

test('updates tracked links and pixels and fetches entity chart series', async () => {
  const linkId2 = 'c91a44de-7f95-47ea-8812-3f9b2e74c099';
  let calls = 0;

  const fetcher: typeof fetch = async (input, options) => {
    calls++;
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';

    if (url.pathname === `/api/links/${linkId}` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        name: 'Updated Promo',
        url: 'https://example.test/updated',
      });
      return Response.json({
        id: linkId,
        name: 'Updated Promo',
        url: 'https://example.test/updated',
        slug: 'promo-2026',
        createdAt: '2026-01-01T00:00:00Z',
      });
    }

    if (url.pathname === '/api/links/charts' && method === 'GET') {
      if (url.searchParams.has('startAt')) {
        assert.equal(url.searchParams.get('ids'), `${linkId},${linkId2}`);
        assert.equal(url.searchParams.get('startAt'), String(range.startAt));
        assert.equal(url.searchParams.get('endAt'), String(range.endAt));
        assert.equal(url.searchParams.get('timezone'), 'UTC');
        return Response.json({
          data: {
            [linkId]: [{ x: '2026-01-01', y: 12 }],
            [linkId2]: [{ x: '2026-01-01', y: '3' }],
          },
        });
      }
      assert.equal(url.searchParams.get('ids'), linkId);
      assert.equal(url.searchParams.get('timezone'), null);
      return Response.json({
        data: {
          [linkId]: { values: [0, 3, 4], total: 7 },
        },
      });
    }

    if (url.pathname === `/api/pixels/${pixelId}` && method === 'POST') {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        name: 'Updated Pixel',
        slug: 'pixel-updated-1',
      });
      return Response.json({
        id: pixelId,
        name: 'Updated Pixel',
        slug: 'pixel-updated-1',
        createdAt: null,
      });
    }

    if (url.pathname === '/api/pixels/charts' && method === 'GET') {
      assert.equal(url.searchParams.get('ids'), pixelId);
      assert.equal(url.searchParams.get('startAt'), String(range.startAt));
      assert.equal(url.searchParams.get('endAt'), String(range.endAt));
      assert.equal(url.searchParams.get('timezone'), 'UTC');
      return Response.json({
        [pixelId]: [{ x: '2026-01-01', y: 22 }],
      });
    }

    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(await api.updateLink(linkId, { name: ' Updated Promo ', url: 'https://example.test/updated' }), {
    id: linkId,
    name: 'Updated Promo',
    url: 'https://example.test/updated',
    slug: 'promo-2026',
    createdAt: '2026-01-01T00:00:00Z',
  });
  await assert.rejects(() => api.updateLink(linkId, {}));
  await assert.rejects(() => api.updateLink(linkId, { url: 'javascript:alert(1)' }));

  assert.deepEqual(await api.linkCharts([linkId, linkId2, linkId], range), {
    [linkId]: [{ label: '2026-01-01', value: 12 }],
    [linkId2]: [{ label: '2026-01-01', value: 3 }],
  });
  assert.deepEqual(await api.linkCharts([linkId]), {
    [linkId]: [
      { label: '#1', value: 0 },
      { label: '#2', value: 3 },
      { label: '#3', value: 4 },
    ],
  });
  const callsBeforeEmpty = calls;
  assert.deepEqual(await api.linkCharts([]), {});
  assert.equal(calls, callsBeforeEmpty);

  assert.deepEqual(await api.updatePixel(pixelId, { name: ' Updated Pixel ', slug: 'pixel-updated-1' }), {
    id: pixelId,
    name: 'Updated Pixel',
    slug: 'pixel-updated-1',
    createdAt: null,
  });
  await assert.rejects(() => api.updatePixel(pixelId, {}));
  await assert.rejects(() => api.updatePixel(pixelId, { slug: 'short' }));

  assert.deepEqual(await api.pixelCharts([pixelId], range), {
    [pixelId]: [{ label: '2026-01-01', value: 22 }],
  });
});

