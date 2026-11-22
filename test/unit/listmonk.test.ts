import assert from 'node:assert/strict';
import test from 'node:test';
import { createListmonk } from '../../src/server/listmonk';
import { UpstreamError } from '../../src/server/upstream';

function fakeListmonk(handler: (url: URL, method: string, body: unknown, init?: RequestInit) => Response | Promise<Response>) {
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://listmonk.example');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Basic ' + Buffer.from('service:secret').toString('base64'));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    return handler(url, init?.method ?? 'GET', body, init);
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

test('install sample cleanup deletes only the untouched seeded draft', async () => {
  const deleted: string[] = [];
  const adapter = fakeListmonk((url, method) => {
    if (method === 'DELETE') {
      deleted.push(url.pathname);
      return reply(true);
    }
    assert.equal(url.searchParams.get('status'), 'draft');
    return reply({ total: 2, results: [
      { ...campaign, id: 1, name: 'Test campaign', subject: 'Welcome to listmonk' },
      { ...campaign, id: 9, name: 'Test campaign', subject: 'Our real launch' },
    ] });
  });
  assert.equal(await adapter.removeInstallSample(), true);
  assert.deepEqual(deleted, ['/api/campaigns/1']);

  const untouched = fakeListmonk((_url, method) => {
    assert.equal(method, 'GET');
    return reply({ total: 1, results: [{ ...campaign, name: 'Welcome series', subject: 'Welcome to listmonk' }] });
  });
  assert.equal(await untouched.removeInstallSample(), false);
});

test('mailing lists support full CRUD with enriched fields and opt-in resend', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const adapter = fakeListmonk((url, method, body) => {
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === '/api/lists' && method === 'GET') {
      return reply({
        total: 1,
        results: [{
          id: 7, name: 'VIP', description: 'Top readers', type: 'public', optin: 'single',
          subscriber_count: 42, tags: ['vip'],
        }],
      });
    }
    if (url.pathname === '/api/lists' && method === 'POST') {
      const payload = body as Record<string, unknown>;
      return reply({ id: 8, ...payload, subscriber_count: 0 });
    }
    if (url.pathname === '/api/lists/8' && method === 'PUT') {
      const payload = body as Record<string, unknown>;
      return reply({ id: 8, ...payload, subscriber_count: 5 });
    }
    if (url.pathname === '/api/lists/8' && method === 'DELETE') return reply(true);
    if (url.pathname === '/api/subscribers/15/optin' && method === 'POST') return reply(true);
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  const lists = await adapter.lists();
  assert.deepEqual(lists, [{
    id: 7, name: 'VIP', description: 'Top readers', type: 'public', optin: 'single', tags: ['vip'], subscriberCount: 42,
  }]);

  const created = await adapter.createList({ name: 'Editorial' });
  assert.deepEqual(calls[1].body, {
    name: 'Editorial', description: '', type: 'private', optin: 'double', tags: [],
  });
  assert.equal(created.type, 'private');
  assert.equal(created.optin, 'double');
  assert.equal(created.description, '');

  const updated = await adapter.updateList(8, {
    name: 'Editorial Digest', description: 'Weekly news', type: 'public', optin: 'single', tags: ['weekly'],
  });
  assert.deepEqual(updated, {
    id: 8, name: 'Editorial Digest', description: 'Weekly news', type: 'public', optin: 'single',
    tags: ['weekly'], subscriberCount: 5,
  });

  await adapter.deleteList(8);
  await adapter.resendOptin(15);
  assert.equal(calls.at(-2)?.method, 'DELETE');
  assert.equal(calls.at(-1)?.path, '/api/subscribers/15/optin');
  await assert.rejects(adapter.deleteList(0), (error) => error instanceof UpstreamError && error.status === 400);
});

test('campaigns support search query, content types, altBody, tags, archive, delete, cancel, and clone', async () => {
  const seenPayloads: Array<{ method: string; path: string; body: unknown }> = [];
  const adapter = fakeListmonk((url, method, body) => {
    seenPayloads.push({ method, path: url.pathname + url.search, body });
    if (url.pathname === '/api/templates') return reply([]);
    if (url.pathname === '/api/settings') return reply({ 'privacy.disable_tracking': false, 'bounce.enabled': true });
    if (url.pathname === '/api/campaigns' && method === 'GET') {
      assert.equal(url.searchParams.get('query'), 'launch');
      assert.deepEqual(url.searchParams.getAll('status'), ['draft']);
      return reply({
        total: 1,
        results: [{
          ...campaign,
          altbody: 'Plain fallback',
          content_type: 'html',
          tags: ['q4', 'product'],
          to_send: 250,
          archive: true,
        }],
      });
    }
    if (url.pathname === '/api/campaigns' && method === 'POST') {
      const payload = body as Record<string, unknown>;
      return reply({
        ...campaign,
        id: 21,
        name: payload.name,
        subject: payload.subject,
        body: payload.body,
        altbody: payload.altbody,
        content_type: payload.content_type,
        tags: payload.tags,
        archive: payload.archive,
        lists: [{ id: 2, name: 'Subscribers' }],
      });
    }
    if (url.pathname === '/api/campaigns/21' && method === 'GET') {
      return reply({
        ...campaign,
        id: 21,
        name: 'Launch',
        subject: 'Big Launch',
        body: '<p>Hello</p>',
        altbody: 'Hello plain',
        content_type: 'richtext',
        from_email: 'news@example.com',
        template_id: 4,
        tags: ['release'],
        archive: true,
        lists: [{ id: 2, name: 'Subscribers' }, { id: 0, name: 'Deleted' }],
      });
    }
    if (url.pathname === '/api/campaigns/21/status' && method === 'PUT') {
      assert.deepEqual(body, { status: 'cancelled' });
      return reply({ ...campaign, id: 21, status: 'cancelled' });
    }
    if (url.pathname === '/api/campaigns/21' && method === 'DELETE') return reply(true);
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  const page = await adapter.campaigns({ status: ['draft'], query: ' launch ' });
  assert.equal(page.items[0].altBody, 'Plain fallback');
  assert.equal(page.items[0].contentType, 'html');
  assert.deepEqual(page.items[0].tags, ['q4', 'product']);
  assert.equal(page.items[0].toSend, 250);
  assert.equal(page.items[0].archive, true);

  const plain = await adapter.createCampaign({
    name: 'Plain note',
    subject: 'Quick note',
    body: 'Read https://example.com/news',
    contentType: 'plain',
    tags: ['plain'],
    archive: true,
    listIds: [2],
  });
  const plainSent = seenPayloads.find((call) => call.method === 'POST' && call.path === '/api/campaigns')?.body as Record<string, unknown>;
  assert.equal(plainSent.content_type, 'plain');
  assert.equal(plainSent.body, 'Read https://example.com/news\n\nUnsubscribe: {{ UnsubscribeURL }}');
  assert.deepEqual(plainSent.tags, ['plain']);
  assert.equal(plainSent.archive, true);
  assert.equal(plain.body, 'Read https://example.com/news');

  await adapter.createCampaign({
    name: 'Plain with unsub',
    subject: 'Plain',
    body: 'Hello\nLeave: {{ UnsubscribeURL }}',
    contentType: 'plain',
    listIds: [2],
  });
  const plainExistingUnsub = seenPayloads.at(-1)?.body as Record<string, unknown>;
  assert.equal(plainExistingUnsub.body, 'Hello\nLeave: {{ UnsubscribeURL }}');

  await adapter.createCampaign({
    name: 'Rich note',
    subject: 'Rich',
    body: '<p><a href="https://example.com/rich">Rich</a></p>',
    contentType: 'richtext',
    listIds: [2],
  });
  const richSent = seenPayloads.at(-1)?.body as Record<string, unknown>;
  assert.equal(richSent.content_type, 'richtext');
  assert.match(String(richSent.body), /https:\/\/example\.com\/rich@TrackLink/);
  assert.match(String(richSent.body), /href="{{ UnsubscribeURL }}"/);
  assert.match(String(richSent.body), /{{ TrackView }}/);

  const markdown = await adapter.createCampaign({
    name: 'MD note',
    subject: 'Markdown',
    body: '# Heading\n[Site](https://example.com)',
    altBody: 'Heading',
    contentType: 'markdown',
    listIds: [2],
  });
  const mdSent = seenPayloads.at(-1)?.body as Record<string, unknown>;
  assert.equal(mdSent.content_type, 'markdown');
  assert.equal(mdSent.body, '# Heading\n[Site](https://example.com)');
  assert.equal(mdSent.altbody, 'Heading');
  assert.equal(markdown.contentType, 'markdown');

  const cloned = await adapter.cloneCampaign(21);
  const cloneSent = seenPayloads.at(-1)?.body as Record<string, unknown>;
  assert.equal(cloneSent.name, 'Launch (Copy)');
  assert.equal(cloneSent.subject, 'Big Launch');
  assert.equal(cloneSent.altbody, 'Hello plain');
  assert.deepEqual(cloneSent.lists, [2]);
  assert.equal(cloneSent.from_email, 'news@example.com');
  assert.equal(cloneSent.template_id, 4);
  assert.equal(cloneSent.content_type, 'richtext');
  assert.deepEqual(cloneSent.tags, ['release']);
  assert.equal(cloneSent.archive, true);
  assert.equal(cloned.name, 'Launch (Copy)');

  const customCloned = await adapter.cloneCampaign(21, 'Launch v2');
  assert.equal(customCloned.name, 'Launch v2');

  const cancelled = await adapter.cancelCampaign(21);
  assert.equal(cancelled.status, 'cancelled');
  await adapter.deleteCampaign(21);
});

test('running campaign stats, link analytics, and analytics CSV export work cleanly', async () => {
  const range = { startAt: Date.parse('2026-01-01T00:00:00.000Z'), endAt: Date.parse('2026-01-31T00:00:00.000Z') };
  let trackingDisabled = false;
  let emptyRunning = false;
  let linkCalls = 0;

  const adapter = fakeListmonk((url, method, _body, init) => {
    assert.equal(method, 'GET');
    if (url.pathname === '/api/campaigns/running/stats') {
      return reply(emptyRunning ? null : [{
        id: 12, status: 'running', to_send: 500, sent: 125, rate: 40, net_rate: 38.5, started_at: '2026-01-15T10:00:00Z',
      }]);
    }
    if (url.pathname === '/api/settings') {
      return reply({ 'privacy.disable_tracking': trackingDisabled });
    }
    if (url.pathname === '/api/campaigns/analytics/links') {
      linkCalls++;
      assert.equal(url.searchParams.get('from'), '2026-01-01T00:00:00.000Z');
      assert.equal(url.searchParams.get('to'), '2026-01-31T00:00:00.000Z');
      assert.deepEqual(url.searchParams.getAll('id'), ['3', '4']);
      return reply([
        { url: 'https://example.com/b', count: 5 },
        { url: 'https://example.com/a', count: 14 },
        { url: 'https://example.com/b', count: 4 },
      ]);
    }
    if (url.pathname === '/api/maintenance/analytics/clicks/export') {
      assert.equal(new Headers(init?.headers).get('Accept'), 'text/csv, text/plain');
      assert.equal(url.searchParams.get('since'), '2026-01-01T00:00:00.000Z');
      return new Response('campaign_id,timestamp\n3,2026-01-15T10:00:00Z\n', {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
    throw new Error(`Unexpected ${url.pathname}`);
  });

  const stats = await adapter.runningCampaignStats();
  assert.deepEqual(stats, [{
    id: 12, status: 'running', toSend: 500, sent: 125, rate: 40, netRate: 38.5, startedAt: '2026-01-15T10:00:00Z',
  }]);
  emptyRunning = true;
  assert.deepEqual(await adapter.runningCampaignStats(), []);

  const links = await adapter.campaignLinks([3, 4], range);
  assert.deepEqual(links, [
    { url: 'https://example.com/a', count: 14 },
    { url: 'https://example.com/b', count: 9 },
  ]);
  assert.equal(linkCalls, 1);

  assert.deepEqual(await adapter.campaignLinks([], range), []);
  trackingDisabled = true;
  assert.deepEqual(await adapter.campaignLinks([3], range), []);
  assert.equal(linkCalls, 1);

  const csv = await adapter.exportCampaignAnalytics('clicks', [3], range);
  assert.match(csv, /^campaign_id,timestamp/);
});

test('templates support campaign and transactional CRUD, default selection, and HTML previews', async () => {
  const native = [
    { id: 1, name: 'Default Campaign', type: 'campaign', body: '<main>{{ template "content" . }}</main>', is_default: true },
    { id: 2, name: 'Receipt', type: 'tx', subject: 'Your receipt', body: '<p>Hi {{ .Subscriber.Name }}</p>', is_default: false },
  ];
  const adapter = fakeListmonk((url, method, body, init) => {
    if (url.pathname === '/api/templates' && method === 'GET') return reply(native);
    if (url.pathname === '/api/templates' && method === 'POST') {
      const payload = body as Record<string, unknown>;
      return reply({ id: 3, is_default: false, ...payload });
    }
    if (url.pathname === '/api/templates/3' && method === 'PUT') {
      const payload = body as Record<string, unknown>;
      return reply({ id: 3, is_default: false, ...payload });
    }
    if (url.pathname === '/api/templates/3/default' && method === 'PUT') return reply(true);
    if (url.pathname === '/api/templates/3' && method === 'DELETE') return reply(true);
    if (url.pathname === '/api/templates/3/preview' && method === 'GET') {
      assert.equal(new Headers(init?.headers).get('Accept'), 'text/html, text/plain');
      return new Response('<html><body>Preview 3</body></html>', { headers: { 'Content-Type': 'text/html' } });
    }
    if (url.pathname === '/api/templates/preview' && method === 'POST') {
      assert.deepEqual(body, { body: '<p>Draft</p>', template_type: 'tx' });
      assert.equal(new Headers(init?.headers).get('Accept'), 'text/html, text/plain');
      return new Response('<html><body>Draft</body></html>', { headers: { 'Content-Type': 'text/html' } });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  const campaignOnly = await adapter.templates();
  assert.equal(campaignOnly.length, 1);
  assert.equal(campaignOnly[0].type, 'campaign');
  assert.equal(campaignOnly[0].isDefault, true);

  const all = await adapter.templates({ type: 'all' });
  assert.equal(all.length, 2);
  assert.equal((await adapter.allTemplates()).length, 2);
  assert.equal((await adapter.templates({ type: 'tx' }))[0].subject, 'Your receipt');

  const txCreated = await adapter.createTemplate({
    name: 'Password Reset',
    type: 'tx',
    subject: 'Reset your password',
    body: '<p>Code: {{ .Tx.Data.code }}</p>',
  });
  assert.equal(txCreated.type, 'tx');
  assert.equal(txCreated.subject, 'Reset your password');
  assert.equal(txCreated.body, '<p>Code: {{ .Tx.Data.code }}</p>');
  assert.doesNotMatch(txCreated.body, /template "content"/);

  const updated = await adapter.updateTemplate(3, {
    name: 'Editorial v2',
    type: 'campaign',
    body: '<header>Top</header>',
  });
  assert.match(updated.body, /{{ template "content" \. }}/);

  await adapter.setDefaultTemplate(3);
  assert.equal(await adapter.previewTemplate(3), '<html><body>Preview 3</body></html>');
  assert.equal(await adapter.previewTemplateBody('<p>Draft</p>', 'tx'), '<html><body>Draft</body></html>');
  await adapter.deleteTemplate(3);
});

test('media library lists array or paginated payloads, uploads multipart FormData, and deletes items', async () => {
  const sample = {
    id: 9, uuid: 'u-1', filename: 'hero.png', content_type: 'image/png',
    url: '/uploads/hero.png', thumb_url: '/uploads/hero_thumb.png', created_at: '2026-01-10T00:00:00Z',
  };
  let listMode: 'array' | 'paged' = 'array';
  const adapter = fakeListmonk(async (url, method, body, init) => {
    if (url.pathname === '/api/media' && method === 'GET') {
      return reply(listMode === 'array' ? [sample] : { results: [sample], total: 1 });
    }
    if (url.pathname === '/api/media' && method === 'POST') {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Content-Type'), null);
      assert.ok(body instanceof FormData);
      const file = body.get('file');
      assert.ok(file instanceof File);
      assert.equal(file.name, 'hero.png');
      assert.equal(file.type, 'image/png');
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([137, 80, 78, 71]));
      return reply(sample);
    }
    if (url.pathname === '/api/media/9' && method === 'DELETE') return reply(true);
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  const fromArray = await adapter.media();
  assert.deepEqual(fromArray, [{
    id: 9, uuid: 'u-1', filename: 'hero.png', contentType: 'image/png',
    url: '/uploads/hero.png', thumbUrl: '/uploads/hero_thumb.png', createdAt: '2026-01-10T00:00:00Z',
  }]);
  listMode = 'paged';
  assert.equal((await adapter.media()).length, 1);

  const uploaded = await adapter.uploadMedia('hero.png', 'image/png', new Uint8Array([137, 80, 78, 71]));
  assert.equal(uploaded.uuid, 'u-1');
  await adapter.deleteMedia(9);
});

test('bounces support campaign filtering, safe campaign name mapping, delete, and blocklist', async () => {
  let blocklistCalls = 0;
  const adapter = fakeListmonk((url, method, body) => {
    if (url.pathname === '/api/bounces' && method === 'GET') {
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('per_page'), '10');
      assert.equal(url.searchParams.get('campaign_id'), '3');
      return reply({
        total: 2,
        page: 2,
        per_page: 10,
        results: [
          {
            id: 101, email: 'a@example.com', subscriber_id: 50, type: 'hard', source: 'postmark',
            campaign: { id: 3, name: 'Launch' }, created_at: '2026-01-12T00:00:00Z',
          },
          {
            id: 102, email: 'b@example.com', subscriber_id: 51, type: 'soft', source: 'smtp',
            campaign: null, created_at: null,
          },
        ],
      });
    }
    if (url.pathname === '/api/bounces/101' && method === 'DELETE') return reply(true);
    if (url.pathname === '/api/bounces/blocklist' && method === 'PUT') {
      blocklistCalls++;
      assert.deepEqual(body, { ids: [101, 102] });
      return reply(true);
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  const page = await adapter.bounces({ page: 2, limit: 10, campaignId: 3 });
  assert.deepEqual(page.items, [
    {
      id: 101, email: 'a@example.com', subscriberId: 50, type: 'hard', source: 'postmark',
      campaignName: 'Launch', createdAt: '2026-01-12T00:00:00Z',
    },
    {
      id: 102, email: 'b@example.com', subscriberId: 51, type: 'soft', source: 'smtp',
      campaignName: null, createdAt: null,
    },
  ]);

  await adapter.deleteBounce(101);
  await adapter.blocklistBounced([]);
  assert.equal(blocklistCalls, 0);
  await adapter.blocklistBounced([101, 102]);
  assert.equal(blocklistCalls, 1);
});

test('transactional email sends normalized payload to /api/tx', async () => {
  const adapter = fakeListmonk((url, method, body) => {
    assert.equal(url.pathname, '/api/tx');
    assert.equal(method, 'POST');
    assert.deepEqual(body, {
      subscriber_email: 'reader@example.com',
      template_id: 4,
      subject: 'Invoice #10',
      from_email: 'billing@example.com',
      data: { total: '$49' },
      content_type: 'html',
      messenger: 'email',
    });
    return reply(true);
  });

  await adapter.sendTransactional({
    email: ' Reader@Example.com ',
    templateId: 4,
    subject: 'Invoice #10',
    fromEmail: 'billing@example.com',
    data: { total: '$49' },
  });
});

test('SMTP diagnostic test clears masked password bullets and maintenance endpoints delete cleanly', async () => {
  let smtpEntries: Array<Record<string, unknown>> = [{
    uuid: 'smtp-1', name: 'email-ovelio', enabled: true, host: 'smtp.example', port: 587,
    username: 'mailer', password: '••••••', auth_protocol: 'plain', tls_type: 'STARTTLS',
  }];
  const tested: Array<Record<string, unknown>> = [];

  const adapter = fakeListmonk((url, method, body) => {
    if (url.pathname === '/api/settings' && method === 'GET') return reply({ smtp: smtpEntries });
    if (url.pathname === '/api/settings/smtp/test' && method === 'POST') {
      tested.push(body as Record<string, unknown>);
      return reply(true);
    }
    if (url.pathname === '/api/maintenance/subscribers/orphan' && method === 'DELETE') return reply({ count: 7 });
    if (url.pathname === '/api/maintenance/subscribers/blocklisted' && method === 'DELETE') return reply({ count: 3 });
    if (url.pathname === '/api/maintenance/subscriptions/unconfirmed' && method === 'DELETE') {
      assert.ok(url.searchParams.get('before_date')?.endsWith('Z'));
      return reply({ count: 11 });
    }
    if (url.pathname === '/api/maintenance/analytics/views' && method === 'DELETE') {
      assert.equal(url.searchParams.get('before_date'), '2025-12-31T00:00:00.000Z');
      return reply(true);
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  await adapter.testSmtp(' Ops@Example.com ');
  assert.deepEqual(tested[0], {
    uuid: 'smtp-1', name: 'email-ovelio', enabled: true, host: 'smtp.example', port: 587,
    username: 'mailer', password: '', auth_protocol: 'plain', tls_type: 'STARTTLS',
    email: 'ops@example.com',
  });

  smtpEntries = [
    { uuid: 'smtp-disabled', name: 'other', enabled: false, host: 'old.example', port: 25 },
    { uuid: 'smtp-fallback', name: 'relay', enabled: true, host: 'relay.example', port: 587, password: '••••' },
  ];
  await adapter.testSmtp('ops@example.com');
  assert.equal(tested[1].uuid, 'smtp-fallback');
  assert.equal(tested[1].password, '');

  smtpEntries = [];
  await assert.rejects(adapter.testSmtp('ops@example.com'), (error) =>
    error instanceof UpstreamError && error.status === 400);

  assert.deepEqual(await adapter.cleanupSubscribers('orphan'), { count: 7 });
  assert.deepEqual(await adapter.cleanupSubscribers('blocklisted'), { count: 3 });
  assert.deepEqual(await adapter.cleanupUnconfirmed(), { count: 11 });
  await adapter.cleanupAnalytics('views', '2025-12-31T00:00:00Z');
  await assert.rejects(adapter.cleanupAnalytics('views', 'not-a-date'), (error) =>
    error instanceof UpstreamError && error.status === 400);
});

test('campaign archive mapping normalizes archiveSlug and updateCampaignArchive toggles and refreshes campaign', async () => {
  let state: { archive: boolean; archive_slug?: string | null } = { archive: false, archive_slug: '   ' };
  const calls: Array<{ method: string; path: string; body: unknown }> = [];

  const adapter = fakeListmonk((url, method, body) => {
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === '/api/settings' && method === 'GET') {
      return reply({ 'privacy.disable_tracking': false, 'bounce.enabled': true });
    }
    if (url.pathname === '/api/campaigns/3/archive' && method === 'PUT') {
      const payload = body as { archive: boolean; archive_slug?: string };
      state = {
        archive: payload.archive,
        archive_slug: payload.archive_slug !== undefined ? payload.archive_slug : null,
      };
      return reply(true);
    }
    if (url.pathname === '/api/campaigns/3' && method === 'GET') {
      return reply({ ...campaign, archive: state.archive, archive_slug: state.archive_slug });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  const initial = await adapter.campaign(3);
  assert.equal(initial.archive, false);
  assert.equal(initial.archiveSlug, undefined);

  const archived = await adapter.updateCampaignArchive(3, { archive: true, archiveSlug: 'spring-issue' });
  assert.deepEqual(
    calls.find((c) => c.method === 'PUT' && c.path === '/api/campaigns/3/archive')?.body,
    { archive: true, archive_slug: 'spring-issue' },
  );
  assert.equal(archived.archive, true);
  assert.equal(archived.archiveSlug, 'spring-issue');
  assert.equal(archived.metrics.opens, 3);

  const unarchived = await adapter.updateCampaignArchive(3, { archive: false });
  const disableCall = calls.filter((c) => c.method === 'PUT' && c.path === '/api/campaigns/3/archive').at(-1);
  assert.deepEqual(disableCall?.body, { archive: false });
  assert.equal(Object.hasOwn(disableCall?.body as Record<string, unknown>, 'archive_slug'), false);
  assert.equal(unarchived.archive, false);
  assert.equal(unarchived.archiveSlug, undefined);

  const clearedSlug = await adapter.updateCampaignArchive(3, { archive: true, archiveSlug: '' });
  const emptySlugCall = calls.filter((c) => c.method === 'PUT' && c.path === '/api/campaigns/3/archive').at(-1);
  assert.deepEqual(emptySlugCall?.body, { archive: true, archive_slug: '' });
  assert.equal(clearedSlug.archive, true);
  assert.equal(clearedSlug.archiveSlug, undefined);

  await assert.rejects(adapter.updateCampaignArchive(0, { archive: true }), (error) =>
    error instanceof UpstreamError && error.status === 400);
});

test('subscriberActivity fetches and defensively normalizes newsletter views and link clicks', async () => {
  let mode: 'full' | 'null' | 'empty' | 'partial' = 'full';
  let requests = 0;

  const adapter = fakeListmonk((url, method) => {
    requests++;
    assert.equal(method, 'GET');
    assert.equal(url.pathname, '/api/subscribers/42/activity');
    if (mode === 'null') return reply(null);
    if (mode === 'empty') return reply({ campaign_views: null, link_clicks: null });
    if (mode === 'partial') {
      return reply({
        campaign_views: [
          null,
          { campaign_id: '15', campaign_name: '  March Issue  ', created_at: null },
        ],
        link_clicks: [
          { campaign_id: 15, campaign_name: null, url: 'https://example.com/docs', created_at: '2026-03-05T08:00:00Z' },
          null,
        ],
      });
    }
    return reply({
      campaign_views: [
        { campaign_id: 10, campaign_name: 'Welcome', created_at: '2026-03-01T09:00:00Z' },
      ],
      link_clicks: [
        { campaign_id: 10, campaign_name: 'Welcome', url: 'https://example.com/start', created_at: '2026-03-01T09:05:00Z' },
      ],
    });
  });

  assert.deepEqual(await adapter.subscriberActivity(42), {
    views: [{ campaignId: 10, campaignName: 'Welcome', at: '2026-03-01T09:00:00Z' }],
    clicks: [{ campaignId: 10, campaignName: 'Welcome', url: 'https://example.com/start', at: '2026-03-01T09:05:00Z' }],
  });

  mode = 'null';
  assert.deepEqual(await adapter.subscriberActivity(42), { views: [], clicks: [] });

  mode = 'empty';
  assert.deepEqual(await adapter.subscriberActivity(42), { views: [], clicks: [] });

  mode = 'partial';
  assert.deepEqual(await adapter.subscriberActivity(42), {
    views: [{ campaignId: 15, campaignName: 'March Issue', at: '' }],
    clicks: [{ campaignId: 15, campaignName: '', url: 'https://example.com/docs', at: '2026-03-05T08:00:00Z' }],
  });

  const beforeInvalid = requests;
  await assert.rejects(adapter.subscriberActivity(0), (error) =>
    error instanceof UpstreamError && error.status === 400);
  assert.equal(requests, beforeInvalid);
});

test('subscriberBounces normalizes bounce records and deleteSubscriberBounces clears them while ignoring 404', async () => {
  let bounceMode: 'list' | 'null' = 'list';
  let deleteStatus = 200;
  let requests = 0;

  const adapter = fakeListmonk((url, method) => {
    requests++;
    assert.equal(url.pathname, '/api/subscribers/42/bounces');
    if (method === 'GET') {
      if (bounceMode === 'null') return reply(null);
      return reply([
        {
          id: 201,
          type: 'hard',
          source: 'postmark',
          campaign: { id: 7, name: 'Launch' },
          created_at: '2026-02-10T11:30:00Z',
        },
        {
          id: 202,
          type: 'soft',
          source: 'smtp',
          campaign: { id: 0, name: '' },
          created_at: null,
        },
        {
          id: 203,
          type: null,
          source: null,
          campaign: null,
        },
      ]);
    }
    if (method === 'DELETE') {
      if (deleteStatus === 200) return reply(true);
      return Response.json({ message: 'error' }, { status: deleteStatus });
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });

  assert.deepEqual(await adapter.subscriberBounces(42), [
    {
      id: 201,
      type: 'hard',
      source: 'postmark',
      campaignId: 7,
      campaignName: 'Launch',
      createdAt: '2026-02-10T11:30:00Z',
    },
    {
      id: 202,
      type: 'soft',
      source: 'smtp',
      campaignId: null,
      campaignName: null,
      createdAt: null,
    },
    {
      id: 203,
      type: 'hard',
      source: '',
      campaignId: null,
      campaignName: null,
      createdAt: null,
    },
  ]);

  bounceMode = 'null';
  assert.deepEqual(await adapter.subscriberBounces(42), []);

  await adapter.deleteSubscriberBounces(42);

  deleteStatus = 404;
  await adapter.deleteSubscriberBounces(42);

  deleteStatus = 500;
  await assert.rejects(adapter.deleteSubscriberBounces(42), (error) =>
    error instanceof UpstreamError && error.status === 500);

  const beforeInvalid = requests;
  await assert.rejects(adapter.subscriberBounces(-1), (error) =>
    error instanceof UpstreamError && error.status === 400);
  await assert.rejects(adapter.deleteSubscriberBounces(0), (error) =>
    error instanceof UpstreamError && error.status === 400);
  assert.equal(requests, beforeInvalid);
});
