import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateEmailMetrics, allCampaigns, mailContent } from '../../src/server/delivery';
import { bounceOptionsFromEnv, bounceSettingsPatch, createListmonk } from '../../src/server/listmonk';

function fakeListmonk(handler: (url: URL, method: string, body: unknown) => Response | Promise<Response>) {
  const transport: typeof fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    return handler(new URL(String(input)), init?.method ?? 'GET', body);
  };
  return createListmonk({ url: 'https://listmonk.example', username: 'service', password: 'secret', fetch: transport });
}
const reply = (data: unknown) => Response.json({ data });

test('DEL-02 allow-listed merge tags survive sanitising', () => {
  const out = mailContent('<p>Hi {{ .Subscriber.FirstName }} {{ .Subscriber.LastName }} ({{ .Subscriber.Email }}) re {{ .Campaign.Subject }}</p>', false, true);
  assert.equal(out, '<p>Hi {{ .Subscriber.FirstName }} {{ .Subscriber.LastName }} ({{ .Subscriber.Email }}) re {{ .Campaign.Subject }}</p>');
});

test('DEL-02 whitespace variants become one canonical form', () => {
  const out = mailContent('<p>{{.Subscriber.Name}} and {{   .Campaign.Name   }}</p>', false, true);
  assert.equal(out, '<p>{{ .Subscriber.Name }} and {{ .Campaign.Name }}</p>');
});

test('DEL-02 Attribs keys are allowed only with safe characters', () => {
  assert.equal(mailContent('<p>{{ .Subscriber.Attribs.city_2 }}</p>', false, true), '<p>{{ .Subscriber.Attribs.city_2 }}</p>');
  const bad = mailContent('<p>{{ .Subscriber.Attribs.a-b }}{{ .Subscriber.Attribs.x.y }}</p>', false, true);
  assert.ok(!bad.includes('{{'));
});

test('DEL-02 tags inside href survive scheme filtering', () => {
  const out = mailContent('<a href="{{ UnsubscribeURL }}">Unsub</a><a href="{{ManageURL}}">M</a><a href="javascript:alert(1)">x</a>', false, true);
  assert.ok(out.includes('<a href="{{ UnsubscribeURL }}">Unsub</a>'));
  assert.ok(out.includes('<a href="{{ ManageURL }}">M</a>'));
  assert.ok(!out.includes('javascript'));
});

test('DEL-02 tracked link suffix passes through untouched', () => {
  assert.ok(mailContent('<a href="https://example.test/a@TrackLink">go</a>', false, true).includes('href="https://example.test/a@TrackLink"'));
});

test('DEL-02 disallowed template actions stay escaped', () => {
  const out = mailContent('<p>{{ Safe "x" }}{{ template "y" . }}{{ .Subscriber.Attribs }}{{ UnsubscribeURL | printf "%s" }}</p>', false, true);
  assert.ok(!out.includes('{{'));
  assert.ok(out.includes('&#123;&#123; Safe'));
});

test('DEL-02 default calls (Mautic and landing pages) still escape every tag', () => {
  const out = mailContent('<p>{{ .Subscriber.FirstName }} {{ UnsubscribeURL }}</p>');
  assert.ok(!out.includes('{{'));
});

test('DEL-02 templates keep the content slot and merge tags', () => {
  const out = mailContent('<main>{{ template "content" . }}<a href="{{ UnsubscribeURL }}">u</a>{{ other }}</main>', true, true);
  assert.ok(out.includes('{{ template "content" . }}'));
  assert.ok(out.includes('href="{{ UnsubscribeURL }}"'));
  assert.ok(!out.includes('{{ other }}'));
});

test('DEL-01 blocklisting bounces only blocks the subscribers of the given bounce ids', async () => {
  const blocked: string[] = [];
  const adapter = fakeListmonk((url, method) => {
    if (method === 'GET' && url.pathname === '/api/bounces/101') return reply({ id: 101, subscriber_id: 50 });
    if (method === 'GET' && url.pathname === '/api/bounces/102') return reply({ id: 102, subscriber_id: 50 });
    if (method === 'GET' && url.pathname === '/api/bounces/103') return Response.json({ message: 'not found' }, { status: 400 });
    if (method === 'PUT' && /^\/api\/subscribers\/\d+\/blocklist$/.test(url.pathname)) {
      blocked.push(url.pathname);
      return reply(true);
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  assert.equal(await adapter.blocklistBounceSubscribers([101, 102, 103]), 1);
  assert.deepEqual(blocked, ['/api/subscribers/50/blocklist']);
  assert.equal(await adapter.blocklistBounceSubscribers([]), 0);
});

test('DEL-04 bounce lists page through every record', async () => {
  const adapter = fakeListmonk((url) => {
    const page = Number(url.searchParams.get('page'));
    const results = page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, email: `a${i}@example.com`, subscriber_id: i + 1 }))
      : [{ id: 101, email: 'z@example.com', subscriber_id: 101 }];
    return reply({ total: 101, page, per_page: 100, results });
  });
  assert.equal((await adapter.allBounces(3)).length, 101);
});

test('DEL-04 analytics export keeps only the requested campaign ids', async () => {
  const csv = 'campaign_id,campaign_name,email\n3,"News\nletter",a@example.com\n4,Other,b@example.com\n';
  const adapter = fakeListmonk(() => new Response(csv, { headers: { 'Content-Type': 'text/csv' } }));
  const out = await adapter.exportCampaignAnalytics('views', [3], { startAt: '2026-01-01T00:00:00Z', endAt: '2026-02-01T00:00:00Z' } as never);
  assert.equal(out, 'campaign_id,campaign_name,email\n3,"News\nletter",a@example.com\n');
});

test('DEL-04 metrics say why delivered and unsubscribes are unavailable', () => {
  const metrics = aggregateEmailMetrics([{ metrics: { sent: 5, delivered: null, opens: 1, clicks: 0, bounces: 0, unsubscribes: null } }]);
  assert.equal(metrics.delivered, null);
  assert.equal(metrics.sent, 5);
  assert.ok(metrics.unavailable?.delivered && metrics.unavailable.unsubscribes);
});

test('DEL-04 dashboard totals stay numeric past 100 campaigns', async () => {
  const campaign = (id: number) => ({ id, metrics: { sent: 2, delivered: null, opens: 1, clicks: 0, bounces: 0, unsubscribes: null } });
  const all = await allCampaigns(async ({ page, limit }) => {
    const items = Array.from({ length: Math.min(limit, 250 - (page - 1) * limit) }, (_, i) => campaign((page - 1) * limit + i + 1));
    return { items, total: 250, page, limit } as never;
  });
  assert.equal(all.items.length, 250);
  assert.equal(all.complete, true);
  assert.equal(aggregateEmailMetrics(all.items as never, all.complete).sent, 500);
});

test('DEL-03 bounce env vars map to provider and mailbox options', () => {
  const options = bounceOptionsFromEnv({
    BOUNCE_PROVIDERS: 'SES, sendgrid,bogus', BOUNCE_SENDGRID_KEY: 'key',
    BOUNCE_POP_HOST: 'pop.example.com', BOUNCE_POP_USERNAME: 'bounces', BOUNCE_POP_PASSWORD: 'pw',
  });
  assert.deepEqual(options.providers, ['ses', 'sendgrid']);
  assert.equal(options.pop?.port, 995);
  assert.equal(options.pop?.tls, true);
  assert.deepEqual(bounceOptionsFromEnv({}).providers, []);
  assert.equal(bounceOptionsFromEnv({}).pop, undefined);
});

test('DEL-03 settings patch enables listed providers and leaves operator settings alone', () => {
  const existing = {
    'bounce.ses_enabled': false, 'bounce.sendgrid_enabled': true, 'bounce.sendgrid_key': '••••',
    'bounce.postmark': { enabled: true, username: 'ops', password: '•••' },
    'bounce.mailboxes': [{ enabled: false, type: 'pop', host: 'old', uuid: 'u1', password: '•••' }],
  };
  const patch = bounceSettingsPatch(existing, {
    providers: ['ses', 'sendgrid'], sendgridKey: 'abcd',
    pop: { host: 'pop.example.com', port: 995, username: 'b', password: 'secret', scanInterval: '15m', tls: true, tlsSkipVerify: false },
  });
  assert.equal(patch['bounce.ses_enabled'], true);
  assert.equal('bounce.sendgrid_enabled' in patch, false);
  assert.equal('bounce.postmark' in patch, false);
  const box = (patch['bounce.mailboxes'] as Record<string, unknown>[])[0];
  assert.equal(box.uuid, 'u1');
  assert.equal(box.enabled, true);
  assert.equal(box.host, 'pop.example.com');
  assert.deepEqual(bounceSettingsPatch(existing, { providers: [] }), {});
  assert.deepEqual(bounceSettingsPatch(existing, undefined), {});
});

test('DEL-03 configureDelivery sends bounce settings once and then reports no change', async () => {
  let saved: Record<string, unknown> = { smtp: [] };
  const adapter = fakeListmonk((url, method, body) => {
    if (url.pathname === '/api/settings' && method === 'GET') return reply(saved);
    if (url.pathname === '/api/settings' && method === 'PUT') {
      saved = { ...(body as object), 'bounce.sendgrid_key': '••••' };
      return reply(true);
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  });
  const input = {
    smtpHost: 'smtp', smtpPort: 2525, fromEmail: 'a@example.com', publicUrl: 'https://app.example.com',
    bounce: { providers: ['sendgrid' as const], sendgridKey: 'abcd' },
  };
  assert.equal((await adapter.configureDelivery(input)).changed, true);
  assert.equal(saved['bounce.sendgrid_enabled'], true);
  assert.equal((await adapter.configureDelivery(input)).changed, false);
});
