import assert from 'node:assert/strict';
import test from 'node:test';
import { createListmonk } from '../../src/server/listmonk';
import { UpstreamError } from '../../src/server/upstream';

function fakeListmonk(handler: (url: URL, method: string, body: unknown) => Response) {
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://listmonk.example');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('service:secret').toString('base64'));
    return handler(url, init?.method ?? 'GET', typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
  };
  return createListmonk({ url: 'https://listmonk.example', username: 'service', password: 'secret', fetch: transport });
}

const reply = (data: unknown) => Response.json({ data });
const campaign = {
  id: 3,
  name: 'News',
  subject: 'First newsletter',
  body: '<p>Welcome.</p>',
  status: 'draft',
  lists: [{ id: 2, name: 'Subscribers' }],
  views: 3,
  sent: 10,
  clicks: 0,
  bounces: 0,
};

test('subscriber sync uses exact address matches and leaves native opt-outs intact', async () => {
  const adapter = fakeListmonk((url, method) => {
    assert.equal(method, 'GET');
    assert.equal(url.pathname, '/api/subscribers');
    assert.equal(url.searchParams.get('search'), 'reader@example.com');
    assert.equal(url.searchParams.has('query'), false);
    return reply({ total: 2, results: [{
      id: 1, email: 'reader@example.com.invalid', status: 'enabled',
    }, {
      id: 5, email: 'reader@example.com', status: 'enabled',
      lists: [{ id: 2, subscription_status: 'unsubscribed' }],
    }] });
  });
  const result = await adapter.upsertSubscriber({ email: ' Reader@example.com ', name: 'Reader', mauticId: 3, lists: [2, 4] });
  assert.equal(result.id, 5);
  assert.deepEqual(result.lists, [{ id: 2, status: 'unsubscribed' }]);
});

test('subscriber reconciliation preserves memberships and never sends an enabled status', async () => {
  const existing = {
    id: 5, name: 'Reader', email: 'reader@example.com', status: 'enabled',
    attribs: { mautic_id: 3, origin: 'form' }, lists: [{ id: 2, subscription_status: 'confirmed' }],
  };
  const adapter = fakeListmonk((url, method, body) => {
    assert.equal(url.pathname, '/api/subscribers/5');
    if (method === 'GET') return reply(existing);
    assert.equal(method, 'PUT');
    assert.deepEqual(body, {
      email: 'reader@example.com', name: 'Updated', preconfirm_subscriptions: true,
      attribs: { mautic_id: 3, origin: 'form' }, lists: [2, 4],
    });
    return reply({ ...existing, name: 'Updated', lists: [...existing.lists, { id: 4, subscription_status: 'confirmed' }] });
  });
  const result = await adapter.upsertSubscriber({
    email: 'reader@example.com', name: 'Updated', mauticId: 3, lists: [4, 4],
  }, 5);
  assert.deepEqual(result.lists.map(({ id }) => id), [2, 4]);
});

test('a raced subscriber creation adopts the existing mapped identity', async () => {
  let lookup = 0;
  const adapter = fakeListmonk((_url, method) => {
    if (method === 'POST') return Response.json({ message: 'duplicate!' }, { status: 409 });
    lookup++;
    return reply({ results: lookup === 1 ? [] : [{
      id: 8, email: 'reader@example.com', name: 'Reader', status: 'enabled', attribs: { mautic_id: 3 },
    }] });
  });
  const result = await adapter.upsertSubscriber({ email: 'reader@example.com', name: 'Reader', mauticId: 3, lists: [] });
  assert.equal(lookup, 2);
  assert.equal(result.id, 8);
});

test('campaign creation supplies tracked links, native unsubscribe, and an open pixel', async () => {
  const adapter = fakeListmonk((url, method, body) => {
    if (url.pathname === '/api/templates') return reply([]);
    assert.equal(url.pathname, '/api/campaigns');
    assert.equal(method, 'POST');
    assert.equal(typeof body, 'object');
    const payload = body as { body: string; lists: number[]; type: string; messenger: string };
    assert.deepEqual(payload.lists, [2]);
    assert.equal(payload.type, 'regular');
    assert.equal(payload.messenger, 'email');
    assert.match(payload.body, /https:\/\/example.com\/offer@TrackLink/);
    assert.match(payload.body, /href="{{ UnsubscribeURL }}"/);
    assert.match(payload.body, /{{ TrackView }}/);
    return reply({ ...campaign, body: payload.body });
  });
  const html = '<p><a href="https://example.com/offer">Offer</a></p>';
  const result = await adapter.createCampaign({ name: campaign.name, subject: campaign.subject, body: html, listIds: [2] });
  assert.equal(result.body, html);
});

test('campaign metrics distinguish historic data, tracking disabled, and unknown delivery', async () => {
  const adapter = fakeListmonk((url) => url.pathname === '/api/settings'
    ? reply({ 'privacy.disable_tracking': true, 'bounce.enabled': false })
    : reply(campaign));
  const result = await adapter.campaign(3);
  assert.deepEqual(result.metrics, { sent: 10, delivered: null, opens: 3, clicks: null, bounces: null, unsubscribes: null });
});

test('scheduling saves the native date before promoting the campaign state', async () => {
  const when = new Date(Date.now() + 3600_000).toISOString();
  const calls: string[] = [];
  const adapter = fakeListmonk((url, method, body) => {
    calls.push(`${method} ${url.pathname}`);
    if (method === 'GET') return reply(campaign);
    if (url.pathname.endsWith('/status')) {
      assert.deepEqual(body, { status: 'scheduled' });
      return reply({ ...campaign, status: 'scheduled', send_at: when });
    }
    assert.deepEqual(body, { lists: [2], send_at: when });
    return reply({ ...campaign, send_at: when });
  });
  assert.equal((await adapter.scheduleCampaign(3, when)).status, 'scheduled');
  assert.deepEqual(calls, ['GET /api/campaigns/3', 'PUT /api/campaigns/3', 'PUT /api/campaigns/3/status']);
});

test('test newsletters reject blocked subscribers before invoking the native send', async () => {
  const adapter = fakeListmonk((url, method) => {
    assert.equal(method, 'GET');
    return url.pathname === '/api/subscribers'
      ? reply({ results: [{ id: 5, status: 'blocklisted', email: 'reader@example.com' }] })
      : reply(campaign);
  });
  await assert.rejects(adapter.testCampaign(3, 'reader@example.com'), (error) =>
    error instanceof UpstreamError && error.status === 409);
});

test('delivery bootstrap preserves masked secrets and avoids rewriting applied settings', async () => {
  let config: Record<string, unknown> = { smtp: [], 'bounce.postmark': { password: '••••' } };
  let writes = 0;
  const adapter = fakeListmonk((url, method, body) => {
    assert.equal(url.pathname, '/api/settings');
    if (method === 'GET') return reply(config);
    writes++;
    config = body as Record<string, unknown>;
    assert.deepEqual(config['bounce.postmark'], { password: '' });
    return reply(true);
  });
  const input = { smtpHost: 'smtp', smtpPort: 2525, fromEmail: 'marketing@example.com', publicUrl: 'https://example.com/delivery/' };
  assert.deepEqual(await adapter.configureDelivery(input), { changed: true, needsRestart: false });
  assert.deepEqual(await adapter.configureDelivery(input), { changed: false, needsRestart: false });
  assert.equal(writes, 1);
});
