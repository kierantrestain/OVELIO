import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReportDimension } from '../../src/contracts';
import { createUmami } from '../../src/server/umami';
import { UpstreamError } from '../../src/server/upstream';

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
  assert.deepEqual(await api.goalStats(website.id, goal.id, range), { unique: 2, total: 6 });
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

    assert.equal(url.searchParams.get('country'), 'GB');
    assert.equal(url.searchParams.get('utmMedium'), 'email');
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

  const report = await api.report(website.id, range, allDimensions, {
    country: ' GB ',
    utmMedium: 'email',
    entry: '/ignored',
    city: '   ',
  });

  assert.deepEqual(report.filters, { country: 'GB', utmMedium: 'email' });
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
  const degraded = await api.report(website.id, range, [], { country: 'GB', utmMedium: 'email' });
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
      assert.equal(url.searchParams.get('country'), 'US');
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
      assert.equal(url.searchParams.get('device'), 'desktop');
      return Response.json(badMatrix ? [[1, 2, 3]] : matrix);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  const page = await api.sessions(website.id, range, {
    page: 2,
    pageSize: 25,
    search: ' chrome ',
    filters: { country: 'US' },
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

  const weekly = await api.weeklyTraffic(website.id, range, { device: 'desktop' });
  assert.equal(weekly.length, 7);
  assert.equal(weekly[0]?.length, 24);
  assert.deepEqual(weekly, matrix);

  badMatrix = true;
  await assert.rejects(() => api.weeklyTraffic(website.id, range, { device: 'desktop' }), (error: unknown) =>
    error instanceof UpstreamError && error.status === 502);
});

test('reads event data properties and property values', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === `${path}/event-data/properties`) {
      assert.equal(url.searchParams.get('event'), 'checkout');
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
  assert.deepEqual(await api.eventProperties(website.id, range, { event: 'checkout' }), [
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
      assert.equal(url.searchParams.get('country'), 'FR');
      return Response.json([
        { date: '2026-01-01', day: 0, visitors: 20, returnVisitors: 20, percentage: 100 },
        { date: '2026-01-01', day: 1, visitors: 20, returnVisitors: 5, percentage: 25.5 },
      ]);
    }
    if (url.pathname === `${path}/journeys`) {
      assert.equal(url.searchParams.get('steps'), '4');
      assert.equal(url.searchParams.get('startStep'), '/');
      assert.equal(url.searchParams.get('endStep'), '/signup');
      assert.equal(url.searchParams.get('browser'), 'safari');
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
      assert.equal(url.searchParams.get('device'), 'mobile');
      return Response.json([
        { country: 'US', browser: 'chrome', views: 30, visitors: 12, visits: 14, bounces: 3, totaltime: 400 },
      ]);
    }
    assert.fail(`Unexpected endpoint ${url.pathname}`);
  };

  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });

  assert.deepEqual(await api.retention(website.id, range, { country: 'FR' }), [
    { date: '2026-01-01', day: 0, visitors: 20, returnVisitors: 20, percentage: 100 },
    { date: '2026-01-01', day: 1, visitors: 20, returnVisitors: 5, percentage: 25.5 },
  ]);

  assert.deepEqual(
    await api.journeys(website.id, range, { steps: 4, startStep: '/', endStep: '/signup', filters: { browser: 'safari' } }),
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
    },
  );

  assert.deepEqual(
    await api.breakdown(website.id, range, ['country', 'browser', 'country'], { device: 'mobile' }),
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
