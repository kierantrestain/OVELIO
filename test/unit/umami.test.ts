import assert from 'node:assert/strict';
import test from 'node:test';
import { createUmami } from '../../src/server/umami';

const website = { id: '22b3bfe1-b34f-4472-bc18-123994f2ef31', name: 'Example', domain: 'example.test' };
const goalId = '61048d54-4909-4b06-a9b4-5b1e54e44b60';
const range = { startAt: 1767225600000, endAt: 1767311999999 };
const path = `/api/websites/${website.id}`;

test('reads the pinned statistics contract and distinguishes zero from unavailable', async () => {
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-key');
    if (url.pathname === path) return Response.json(website);
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
      case `${path}/utm/metrics`:
        assert.equal(url.searchParams.get('type'), 'utm_campaign');
        return Response.json([{ utm: 'launch', views: 5 }]);
      case `${path}/metrics`:
        assert.equal(url.searchParams.get('limit'), '10');
        if (url.searchParams.get('type') === 'country') return new Response(null, { status: 503 });
        return Response.json([]);
      default:
        assert.fail(`Unexpected endpoint ${url.pathname}`);
    }
  };
  const api = createUmami({ url: 'http://tracking.test', token: 'test-key', fetch: fetcher });
  const report = await api.report(website.id, range, ['country', 'event', 'utmCampaign']);

  assert.deepEqual(report.current, { pageviews: 18, visitors: 9, visits: 11, bounces: 0 });
  assert.deepEqual(report.previous, { pageviews: 0, visitors: 0, visits: 0, bounces: 0 });
  assert.deepEqual(report.pageviews, [{ label: '2026-01-01T12:00:00Z', value: 18 }]);
  assert.deepEqual(report.visitors, [{ label: '2026-01-01T12:00:00Z', value: 9 }]);
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
