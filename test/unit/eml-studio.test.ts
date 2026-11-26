import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { compileMjml, htmlToMjml } = await import('../../src/server/studio/compile');
const { sanitizeEmailHtml, studioNewsletterBody } = await import('../../src/server/studio/sanitize');
const { toListmonkHtml, toMauticHtml, fromListmonkHtml } = await import('../../src/server/studio/convert');
const { applyBrand, defaultBrand } = await import('../../src/server/studio/brand');
const { emailTemplates } = await import('../../src/templates/email');
const { templateCategories } = await import('../../src/contracts/studio');
const { studioModule } = await import('../../src/server/studio/module');
const { upsertContact } = await import('../../src/server/directory');
const { setMailTransport } = await import('../../src/server/mailer');

after(async () => { await db.close(); });

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@ovelio.test', name: 'Dev', role: 'admin' as const };

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const [pathname, search = ''] = path.split('?');
  for (const entry of studioModule.endpoints) {
    if (entry.method !== method) continue;
    const match = entry.path.exec(pathname);
    if (!match) continue;
    const request = new Request('http://localhost/api/console/' + path, {
      method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      const result = await entry.handler({ request, user, params: match.slice(1), query: new URLSearchParams(search) });
      if (result instanceof Response) return { status: result.status, data: await result.json() as T };
      return { status: 200, data: result as T };
    } catch (error) {
      return { status: (error as { status?: number }).status ?? 500, data: { error: (error as Error).message } as T };
    }
  }
  throw new Error('No endpoint for ' + method + ' ' + path);
}

const sample = `<mjml><mj-body><mj-section><mj-column><mj-text>Hi {{contact.first_name | there}}</mj-text><mj-button href="{{unsubscribe_url}}">Bye</mj-button><mj-raw><p onclick="steal()">x</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a></mj-raw></mj-column></mj-section></mj-body></mjml>`;

test('EML-01 MJML compiles deterministically, keeps merge tags and strips scripts and handlers', async () => {
  const first = await compileMjml(sample, { preheader: 'Preview {{contact.first_name}}', title: 'Subject' });
  const second = await compileMjml(sample, { preheader: 'Preview {{contact.first_name}}', title: 'Subject' });
  assert.equal(first.html, second.html, 'identical input gives identical output');
  assert.deepEqual(first.errors, []);
  assert.match(first.html, /Hi \{\{contact\.first_name \| there\}\}/);
  assert.match(first.html, /href="\{\{unsubscribe_url\}\}"/);
  assert.match(first.html, /Preview \{\{contact\.first_name\}\}/);
  assert.doesNotMatch(first.html, /<script|onclick|javascript:/i);
  assert.match(first.html, /<!--\[if mso \| IE\]>/, 'Outlook conditional comments survive');
  assert.match(first.html, /@media only screen/, 'responsive styles survive');
  const broken = await compileMjml('<mjml><mj-body><mj-section><mj-column><mj-nope></mj-nope></mj-column></mj-section></mj-body></mjml>');
  assert.equal(broken.errors.length, 1);
  assert.match(broken.errors[0].message, /mj-nope/);
  assert.equal((await compileMjml('<p>not mjml</p>')).html, '');
});

test('EML-02 the sanitiser drops comments that could close early and unsafe styles', () => {
  const html = sanitizeEmailHtml('<!doctype html><html><body><!--[if mso]>--><script>x()</script><!--<![endif]--><div style="background:url(javascript:x)">a</div><img src="data:text/html,x" alt="y"><!--[if mso]><table><tr><td><![endif]--></body></html>');
  assert.doesNotMatch(html, /script|javascript|data:text/);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<!--\[if mso\]><table><tr><td><!\[endif\]-->/);
});

test('EML-03 merge tags convert to Listmonk and Mautic syntax with fallbacks; unknown tags are reported', () => {
  const workspace = { name: 'Acme & Co', address: '1 Example St', website: 'https://acme.example', year: '2026' };
  const html = '<p>Hi {{contact.first_name | there}} {{contact.full_name}} {{contact.company}} © {{current_year}} {{workspace.name}}</p><a href="{{unsubscribe_url}}">u</a> {{contact.nope}}';
  const listmonk = toListmonkHtml(html, workspace);
  assert.equal(listmonk.html, '<p>Hi {{ .Subscriber.FirstName | default "there" }} {{ .Subscriber.Name }} {{ .Subscriber.Attribs.company }} © 2026 Acme &amp; Co</p><a href="{{ UnsubscribeURL }}">u</a> {{contact.nope}}');
  assert.deepEqual(listmonk.unknownTags, ['contact.nope']);
  assert.equal(listmonk.notes.length, 1);
  const mautic = toMauticHtml(html, workspace);
  assert.equal(mautic.html, '<p>Hi {contactfield=firstname|there} {contactfield=firstname} {contactfield=lastname} {contactfield=company} © 2026 Acme &amp; Co</p><a href="{unsubscribe_url}">u</a> {{contact.nope}}');
  assert.equal(fromListmonkHtml('<a href="https://x.example@TrackLink">{{ .Subscriber.FirstName }}</a> {{ UnsubscribeURL }}'), '<a href="https://x.example">{{contact.first_name}}</a> {{unsubscribe_url}}');
});

test('EML-04 newsletter bodies keep allow-listed Listmonk tags and escape every other template action', () => {
  const body = studioNewsletterBody('<html><body><p>{{ .Subscriber.FirstName | default "there" }} {{ template "x" }} {{ UnsubscribeURL }}</p><script>x</script></body></html>');
  assert.match(body, /\{\{ \.Subscriber\.FirstName \| default "there" \}\}/);
  assert.match(body, /&#123;&#123; template/);
  assert.match(body, /\{\{ UnsubscribeURL \}\}/);
  assert.doesNotMatch(body, /<script/);
  assert.match(body, /ovelio-studio/);
});

test('EML-05 every gallery template compiles with zero MJML errors, three per category', async () => {
  assert.ok(emailTemplates.length >= 24);
  for (const category of templateCategories) assert.equal(emailTemplates.filter(item => item.category === category).length, 3, category);
  assert.equal(new Set(emailTemplates.map(item => item.key)).size, emailTemplates.length, 'keys are unique');
  const brand = await defaultBrand();
  brand.social = [{ network: 'linkedin', url: 'https://linkedin.example/acme' }];
  for (const template of emailTemplates) {
    const source = applyBrand(template.mjml, brand);
    assert.doesNotMatch(source, /\[\[brand\./, `${template.key} has no unfilled brand placeholders`);
    assert.doesNotMatch(source, /src="https?:/, `${template.key} hotlinks no images`);
    const compiled = await compileMjml(source);
    assert.deepEqual(compiled.errors, [], template.key);
    assert.ok(compiled.html.length > 2000, template.key);
    if (template.marketing) {
      assert.match(source, /\{\{unsubscribe_url\}\}/, `${template.key} has an unsubscribe link`);
      assert.match(source, /\{\{workspace\.address\}\}/, `${template.key} shows the postal address`);
    }
    for (const match of source.matchAll(/<mj-image[^>]*>/g)) assert.match(match[0], /alt="[^"]+"/, `${template.key} images have alt text`);
  }
});

test('EML-06 designs: create from template, autosave with version check, versions, restore, duplicate, archive', async () => {
  const created = await call<{ id: string; version: number; html: string; source: string }>('POST', 'studio/designs', { templateKey: 'announce-update', name: 'EML-06 update' });
  assert.equal(created.status, 201);
  assert.match(created.data.html, /We are growing/);
  const id = created.data.id;
  const listed = await call<{ items: { id: string; name: string; subject: string; kind: string; status: string; updatedAt: string }[] }>('GET', 'studio/designs?kind=email');
  const row = listed.data.items.find(item => item.id === id)!;
  assert.deepEqual(Object.keys(row).filter(key => ['id', 'name', 'subject', 'kind', 'status', 'updatedAt'].includes(key)).sort(), ['id', 'kind', 'name', 'status', 'subject', 'updatedAt']);

  const edited = created.data.source.replace('We are growing', 'We are expanding');
  const saved = await call<{ design: { version: number }; html: string }>('PATCH', `studio/designs/${id}`, { version: 1, source: edited, document: { pages: [1] } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.design.version, 2);
  assert.match(saved.data.html, /We are expanding/);
  const stale = await call<{ error: string }>('PATCH', `studio/designs/${id}`, { version: 1, name: 'Other tab' });
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /changed somewhere else/);

  const version = await call<{ version: number }>('POST', `studio/designs/${id}/versions`, { label: 'Approved copy' });
  assert.equal(version.status, 201);
  await call('PATCH', `studio/designs/${id}`, { version: 2, source: edited.replace('We are expanding', 'Draft three') });
  const restored = await call<{ html: string; version: number; document: Record<string, unknown> }>('POST', `studio/designs/${id}/versions/1/restore`, { version: 3 });
  assert.match(restored.data.html, /We are growing/);
  assert.equal(restored.data.version, 4);
  const versions = await call<{ items: { label: string }[] }>('GET', `studio/designs/${id}/versions`);
  assert.ok(versions.data.items.some(item => item.label === 'Approved copy'));
  assert.ok(versions.data.items.some(item => item.label === 'Before restore'));

  const copy = await call<{ id: string; name: string }>('POST', `studio/designs/${id}/duplicate`);
  assert.equal(copy.data.name, 'EML-06 update (copy)');
  await call('POST', `studio/designs/${copy.data.id}/archive`);
  const active = await call<{ items: { id: string }[] }>('GET', 'studio/designs?kind=email');
  assert.ok(!active.data.items.some(item => item.id === copy.data.id), 'archived designs leave the default list');
});

test('EML-07 test sends go through the mailer: consented contacts get the stored rendered message, others are blocked', async () => {
  setMailTransport(undefined);
  await upsertContact({ email: 'eml07.reader@example.com', firstName: 'Grace', consent: 'opted_in', evidence: 'Unit test', source: 'test' });
  const design = await call<{ id: string }>('POST', 'studio/designs', { templateKey: 'welcome-hello' });
  const sent = await call<{ results: { to: string; status: string; reason: string; messageId: string }[] }>('POST', `studio/designs/${design.data.id}/test`, { to: ['eml07.reader@example.com', 'stranger@example.com'] });
  const [ok, blocked] = sent.data.results;
  assert.equal(ok.status, 'not_sent', 'the preview has no relay, so it never claims delivery');
  assert.match(ok.reason, /developer preview/);
  assert.equal(blocked.status, 'blocked');
  const messages = await call<{ items: { id: string; status: string }[] }>('GET', `studio/designs/${design.data.id}/messages`);
  assert.equal(messages.data.items.length, 2);
  const stored = await call<{ html: string; subject: string }>('GET', `studio/messages/${ok.messageId}`);
  assert.match(stored.data.html, /Welcome aboard, Grace!/);
  assert.match(stored.data.subject, /Grace/);
  const preview = await call<{ html: string }>('GET', `studio/designs/${design.data.id}/render`);
  assert.match(preview.data.html, /Welcome aboard, friend!/, 'fallbacks fill the preview without a sample contact');
});

test('EML-08 imported HTML keeps its body and styles, and exports convert tags for Listmonk', async () => {
  const mjml = htmlToMjml('<html><head><style>.x{color:red}</style></head><body><h1 class="x">Hello {{ .Subscriber.FirstName }}</h1></body></html>');
  assert.match(mjml, /<mj-style>\.x\{color:red\}<\/mj-style>/);
  assert.match(mjml, /<mj-raw><h1 class="x">Hello \{\{ \.Subscriber\.FirstName \}\}<\/h1><\/mj-raw>/);
  const imported = await call<{ id: string; html: string }>('POST', 'studio/designs', { importHtml: '<body><h1>Hello {{ .Subscriber.FirstName }}</h1><a href="{{ UnsubscribeURL }}">u</a></body>', name: 'Imported', link: { engine: 'listmonk_campaign', engineId: '99', label: 'Old newsletter' } });
  assert.match(imported.data.html, /Hello \{\{contact\.first_name\}\}/);
  const link = await call<{ designId: string }>('GET', 'studio/links?engine=listmonk_campaign&id=99');
  assert.equal(link.data.designId, imported.data.id);
  const exported = await call<{ html: string }>('GET', `studio/designs/${imported.data.id}/export?engine=listmonk`);
  assert.match(exported.data.html, /Hello \{\{ \.Subscriber\.FirstName \}\}/);
  assert.match(exported.data.html, /\{\{ UnsubscribeURL \}\}/);
});

test('EML-09 the template factory: every industry × use case compiles with zero errors, passes the sanitiser and is byte-identical across runs', async () => {
  const { factoryTemplates, generateTemplate, factoryIndustries, factoryUseCases } = await import('../../src/templates/email/factory');
  assert.equal(factoryTemplates.length, factoryIndustries.length * factoryUseCases.length);
  assert.ok(factoryIndustries.length >= 5);
  const brand = await defaultBrand();
  for (const template of factoryTemplates) {
    const again = generateTemplate(template.industry!, template.useCase!);
    assert.equal(again.mjml, template.mjml, `${template.key} MJML is deterministic`);
    const source = applyBrand(template.mjml, brand);
    assert.doesNotMatch(source, /\[\[brand\./, `${template.key} fills every brand token`);
    const first = await compileMjml(source, { preheader: template.preheader });
    const second = await compileMjml(source, { preheader: template.preheader });
    assert.deepEqual(first.errors, [], template.key);
    assert.equal(first.html, second.html, `${template.key} HTML is byte-identical`);
    assert.equal(sanitizeEmailHtml(first.html), first.html, `${template.key} passes the sanitiser unchanged`);
  }
  assert.throws(() => generateTemplate('saas', 'nope'), /No factory template/);
  const list = await call<{ items: { key: string; source: string; industry?: string }[]; industries: unknown[] }>('GET', 'studio/templates');
  assert.ok(list.data.items.some(item => item.source === 'factory' && item.industry === 'ecommerce'));
  assert.equal(list.data.items.filter(item => item.source === 'curated').length, 24);
});
