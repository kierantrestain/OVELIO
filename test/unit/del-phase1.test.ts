import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inlineSyncLimit, syncCampaignSegments, unsubscribe, unsubscribeRequest, withUnsubscribeCounts,
} from '../../src/server/delivery';
import type { SegmentSyncDeps } from '../../src/server/delivery';
import { createListmonk, deliverySettingsFromNative, deliverySettingsPatch } from '../../src/server/listmonk';

function fakeListmonk(handler: (url: URL, method: string, body: unknown) => Response | Promise<Response>) {
  const transport: typeof fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    return handler(new URL(String(input)), init?.method ?? 'GET', body);
  };
  return createListmonk({ url: 'https://listmonk.example', username: 'service', password: 'secret', fetch: transport });
}
const reply = (data: unknown) => Response.json({ data });
const campaignId = '11111111-1111-4111-8111-111111111111';
const subscriberId = '22222222-2222-4222-8222-222222222222';

/* ── DEL-05 ─────────────────────────────────────────────────────────────── */

test('DEL-05 throughput values outside Listmonk ranges are rejected', () => {
  assert.throws(() => deliverySettingsPatch({ concurrency: 0 }), /Concurrency must be a whole number from 1 to 10000/);
  assert.throws(() => deliverySettingsPatch({ messageRate: 100001 }), /Messages per second/);
  assert.throws(() => deliverySettingsPatch({ batchSize: 1.5 }), /Batch size/);
  assert.throws(() => deliverySettingsPatch({ maxSendErrors: -1 }), /Maximum send errors/);
  assert.throws(() => deliverySettingsPatch({ slidingWindowDuration: '1d' }), /sliding window length/);
  assert.throws(() => deliverySettingsPatch({ slidingWindowRate: 0 }), /Sliding window/);
  assert.equal(deliverySettingsPatch({ maxSendErrors: 0 })['app.max_send_errors'], 0);
});

test('DEL-05 settings read back with Listmonk defaults for missing keys', () => {
  const read = deliverySettingsFromNative({});
  assert.deepEqual(read, {
    concurrency: 10, messageRate: 10, batchSize: 1000, maxSendErrors: 1000, slidingWindow: false,
    slidingWindowDuration: '1h', slidingWindowRate: 10000, trackingMode: 'anonymous', recordOptinIp: false,
  });
});

test('DEL-05 saving throughput keeps every other setting and reports a pending restart', async () => {
  let put: Record<string, unknown> | undefined;
  const adapter = fakeListmonk((url, method, body) => {
    if (url.pathname !== '/api/settings') throw new Error(`Unexpected ${method} ${url.pathname}`);
    if (method === 'GET') return reply({ 'app.concurrency': 10, 'app.root_url': 'https://x.example', 'privacy.allow_blocklist': true, 'bounce.sendgrid_key': '••••' });
    put = body as Record<string, unknown>;
    return reply({ needs_restart: true });
  });
  const saved = await adapter.saveDeliverySettings({ concurrency: 20, slidingWindow: true, slidingWindowDuration: '30m', slidingWindowRate: 500 });
  assert.equal(put?.['app.concurrency'], 20);
  assert.equal(put?.['app.message_sliding_window'], true);
  assert.equal(put?.['app.message_sliding_window_duration'], '30m');
  assert.equal(put?.['app.root_url'], 'https://x.example');
  assert.equal(put?.['privacy.allow_blocklist'], true);
  assert.equal(put?.['bounce.sendgrid_key'], '');
  assert.equal(saved.needsRestart, true);
  assert.equal(saved.concurrency, 20);
});

test('DEL-05 an invalid value is rejected before anything is sent to Listmonk', async () => {
  const adapter = fakeListmonk(() => { throw new Error('Listmonk must not be called'); });
  await assert.rejects(adapter.saveDeliverySettings({ concurrency: 99999 }), /Concurrency/);
});

/* ── DEL-06 ─────────────────────────────────────────────────────────────── */

test('DEL-06 tracking modes map to Listmonk privacy flags', () => {
  assert.deepEqual(deliverySettingsPatch({ trackingMode: 'individual' }), { 'privacy.disable_tracking': false, 'privacy.individual_tracking': true });
  assert.deepEqual(deliverySettingsPatch({ trackingMode: 'anonymous' }), { 'privacy.disable_tracking': false, 'privacy.individual_tracking': false });
  assert.deepEqual(deliverySettingsPatch({ trackingMode: 'off' }), { 'privacy.disable_tracking': true, 'privacy.individual_tracking': false });
  assert.equal(deliverySettingsPatch({ recordOptinIp: true })['privacy.record_optin_ip'], true);
});

test('DEL-06 the stored flags read back as one tracking mode', () => {
  assert.equal(deliverySettingsFromNative({ 'privacy.individual_tracking': true }).trackingMode, 'individual');
  assert.equal(deliverySettingsFromNative({ 'privacy.individual_tracking': true, 'privacy.disable_tracking': true }).trackingMode, 'off');
  assert.equal(deliverySettingsFromNative({ 'privacy.disable_tracking': false }).trackingMode, 'anonymous');
});

/* ── DEL-07 ─────────────────────────────────────────────────────────────── */

test('DEL-07 one-click POST unsubscribes from the campaign lists only', () => {
  const request = unsubscribeRequest(new URLSearchParams('List-Unsubscribe=One-Click'));
  assert.equal(request.scope, 'lists');
  assert.equal(request.body.toString(), '');
  assert.equal(unsubscribeRequest(new URLSearchParams()).scope, 'lists');
});

test('DEL-07 unsubscribing from everything is an explicit choice', () => {
  for (const field of ['blocklist=true', 'everything=true', 'blocklist=on']) {
    const request = unsubscribeRequest(new URLSearchParams(field));
    assert.equal(request.scope, 'everything');
    assert.equal(request.body.get('blocklist'), 'true');
  }
  assert.equal(unsubscribeRequest(new URLSearchParams('blocklist=false')).scope, 'lists');
});

test('DEL-07 the preferences form forwards only the name and list ids', () => {
  const list = '33333333-3333-4333-8333-333333333333';
  const request = unsubscribeRequest(new URLSearchParams(`manage=true&name=Sam&l=${list}&l=not-a-uuid&role=admin`));
  assert.equal(request.scope, 'preferences');
  assert.equal(request.body.get('manage'), 'true');
  assert.equal(request.body.get('name'), 'Sam');
  assert.deepEqual(request.body.getAll('l'), [list]);
  assert.equal(request.body.has('role'), false);
});

test('DEL-07 the POST sent to Listmonk has no blocklist field for a one-click unsubscribe', async () => {
  let sent = '';
  let url = '';
  const transport: typeof fetch = async (input, init) => {
    url = String(input);
    sent = String(init?.body);
    return new Response('Unsubscribed', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const result = await unsubscribe({ campaign: campaignId, subscriber: subscriberId }, new URLSearchParams('List-Unsubscribe=One-Click'),
    { base: 'https://listmonk.example', transport, record: async () => undefined });
  assert.equal(url, `https://listmonk.example/subscription/${campaignId}/${subscriberId}`);
  assert.equal(sent, '');
  assert.equal(result.status, 200);
});

test('DEL-07 a failed Listmonk response is reported and not counted', async () => {
  let recorded = 0;
  const result = await unsubscribe({ campaign: campaignId, subscriber: subscriberId }, new URLSearchParams(), {
    base: 'https://listmonk.example', transport: async () => new Response('no', { status: 500 }), record: async () => { recorded++; },
  });
  assert.equal(result.status, 502);
  assert.equal(recorded, 0);
});

/* ── DEL-21 ─────────────────────────────────────────────────────────────── */

test('DEL-21 a successful unsubscribe is recorded with its scope', async () => {
  const rows: string[][] = [];
  const options = {
    base: 'https://listmonk.example', transport: (async () => new Response('ok')) as typeof fetch,
    record: async (campaign: string, subscriber: string, scope: string) => { rows.push([campaign, subscriber, scope]); },
  };
  await unsubscribe({ campaign: campaignId, subscriber: subscriberId }, new URLSearchParams(), options);
  await unsubscribe({ campaign: campaignId, subscriber: subscriberId }, new URLSearchParams('blocklist=true'), options);
  await unsubscribe({ campaign: campaignId, subscriber: subscriberId }, new URLSearchParams('manage=true&name=Sam'), options);
  assert.deepEqual(rows, [[campaignId, subscriberId, 'lists'], [campaignId, subscriberId, 'everything']]);
});

test('DEL-21 a counting failure does not undo the unsubscribe', async () => {
  const result = await unsubscribe({ campaign: campaignId, subscriber: subscriberId }, new URLSearchParams(), {
    base: 'https://listmonk.example', transport: async () => new Response('ok'), record: async () => { throw new Error('db down'); },
  });
  assert.equal(result.status, 200);
});

test('DEL-21 campaign metrics carry the recorded unsubscribe count', async () => {
  const metrics = { sent: 5, delivered: null, opens: 1, clicks: 0, bounces: 0, unsubscribes: null, unavailable: { delivered: 'x', unsubscribes: 'later' } };
  const campaigns = [{ id: 1, uuid: campaignId, metrics }, { id: 2, uuid: 'b', metrics }, { id: 3, metrics }] as never[];
  const out = await withUnsubscribeCounts(campaigns, async () => new Map([[campaignId, 3]])) as { metrics: typeof metrics }[];
  assert.equal(out[0].metrics.unsubscribes, 3);
  assert.equal('unsubscribes' in out[0].metrics.unavailable, false);
  assert.equal(out[1].metrics.unsubscribes, 0);
  assert.equal(out[2].metrics.unsubscribes, null);
});

test('DEL-21 when counts cannot be read the reason stays visible', async () => {
  const metrics = { sent: 1, delivered: null, opens: 0, clicks: 0, bounces: 0, unsubscribes: null, unavailable: { unsubscribes: 'later' } };
  const out = await withUnsubscribeCounts([{ id: 1, uuid: campaignId, metrics }] as never[], async () => { throw new Error('db'); }) as { metrics: typeof metrics }[];
  assert.equal(out[0].metrics.unsubscribes, null);
  assert.equal(out[0].metrics.unavailable.unsubscribes, 'later');
});

/* ── DEL-08 ─────────────────────────────────────────────────────────────── */

function syncDeps(overrides: Partial<SegmentSyncDeps> = {}) {
  const synced: number[] = [];
  const deps: SegmentSyncDeps = {
    mappings: async ids => ids.filter(id => id === 20).map(listId => ({ segmentId: 5, listId })),
    segments: async () => [{ id: 5, name: 'VIPs', published: true }],
    members: async (_segment, page) => ({ ids: page === 1 ? [1, 2] : [3], total: 3, limit: 2 }),
    listSubscribers: async () => ({ items: [{ id: 90, email: 'a@example.com', mauticId: 1 }, { id: 91, email: 'gone@example.com', mauticId: 9 }, { id: 92, email: 'manual@example.com', mauticId: null }], total: 3, page: 1, limit: 100 }),
    syncContact: async id => { synced.push(id); },
    deferSync: async () => {},
    ...overrides,
  };
  return { deps, synced };
}

test('DEL-08 every segment member is synced and contacts who left are removed before sending', async () => {
  const { deps, synced } = syncDeps();
  const report = await syncCampaignSegments([7, 20], deps);
  assert.deepEqual(synced.sort(), [1, 2, 3, 9]);
  assert.deepEqual(report.segments, [{ segmentId: 5, name: 'VIPs', members: 3, removed: 1 }]);
});

test('DEL-08 a campaign on ordinary lists needs no sync', async () => {
  const { deps, synced } = syncDeps();
  assert.deepEqual((await syncCampaignSegments([7], deps)).segments, []);
  assert.deepEqual(synced, []);
});

test('DEL-08 a failed contact sync refuses the start with a clear message', async () => {
  const { deps } = syncDeps({ syncContact: async id => { if (id === 2) throw new Error('boom'); } });
  await assert.rejects(syncCampaignSegments([20], deps), /Could not refresh the segment "VIPs": 1 of 3 contacts could not be updated\. The newsletter was not started\./);
});

test('DEL-08 an unpublished segment refuses the start', async () => {
  const { deps } = syncDeps({ segments: async () => [{ id: 5, name: 'VIPs', published: false }] });
  await assert.rejects(syncCampaignSegments([20], deps), /no longer published/);
});

test('DEL-08 an unreachable audience service refuses the start', async () => {
  const { deps } = syncDeps({ members: async () => { throw new Error('down'); } });
  await assert.rejects(syncCampaignSegments([20], deps), /did not respond\. The newsletter was not started/);
});

test('DEL-08 segments over the inline limit start from their last sync and refresh in the background', async () => {
  const deferred: number[] = [];
  const { deps, synced } = syncDeps({
    members: async () => ({ ids: [1, 2], total: inlineSyncLimit + 1, limit: 2 }),
    deferSync: async segmentId => { deferred.push(segmentId); },
  });
  const report = await syncCampaignSegments([20], deps);
  assert.deepEqual(report.segments, [{ segmentId: 5, name: 'VIPs', members: inlineSyncLimit + 1, removed: 0, deferred: true }]);
  assert.deepEqual(deferred, [5]);
  assert.deepEqual(synced, []);
});
