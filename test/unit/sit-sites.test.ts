import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { pageTemplates, pageTemplate } = await import('../../src/templates/pages');
const { pageTemplateCategories } = await import('../../src/contracts/sites');
const { sanitizePageHtml, sanitizePageCss } = await import('../../src/server/sites/sanitize');
const pages = await import('../../src/server/sites/pages');
const forms = await import('../../src/server/sites/forms');
const funnels = await import('../../src/server/sites/funnels');
const pub = await import('../../src/server/sites/public');
const { verifyDomain, addDomain } = await import('../../src/server/sites/domains');
const { findContactByEmail } = await import('../../src/server/directory');
const { listEvents } = await import('../../src/server/events');
const { sitesModule } = await import('../../src/server/sites/module');

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@ovelio.test', name: 'Developer Test', role: 'admin' as const, disabled: false };
const meta = { ip: '203.0.113.7', cookieVisitorId: null, referer: 'http://localhost/s/test' };

after(async () => { await db.close(); });

test('SIT-01 at least 15 templates cover every category, parse cleanly and contain no script', () => {
  assert.ok(pageTemplates.length >= 15, `found ${pageTemplates.length}`);
  for (const category of pageTemplateCategories) {
    assert.ok(pageTemplates.filter(item => item.category === category).length >= 2, `two or more ${category} templates`);
  }
  assert.equal(new Set(pageTemplates.map(item => item.key)).size, pageTemplates.length, 'keys are unique');
  for (const template of pageTemplates) {
    assert.doesNotMatch(template.html + template.css, /<script|javascript:|on[a-z]+=/i, `${template.key} has no script`);
    assert.doesNotMatch(template.html + template.css, /https?:\/\/(?!www\.w3\.org)/, `${template.key} loads nothing external`);
    assert.equal(sanitizePageHtml(template.html).length > template.html.length * 0.9, true, `${template.key} survives sanitising`);
    assert.match(template.css, /@media \(max-width: 480px\)/, `${template.key} is responsive`);
    if (template.hasForm) {
      assert.match(template.html, /data-ovelio-form=""/, `${template.key} has a form block`);
      assert.ok(template.form?.fields.some(field => field.mapsTo === 'email'), `${template.key} form maps an email`);
    }
    for (const svg of template.html.match(/<svg[^>]*>/g) ?? []) assert.match(svg, /aria-label|aria-hidden/, `${template.key} svg is labelled`);
  }
});

test('SIT-02 publishing sanitises scripts, handlers and unsafe URLs but keeps form bindings and video embeds', () => {
  const dirty = '<body id="x"><div onclick="alert(1)" class="a"><script>alert(1)</script><a href="javascript:alert(1)">x</a>'
    + '<div data-ovelio-form="5b0c3a59-0d3b-4f0e-9c55-1f3f5b2b1a10" class="ovp-form-slot"></div><iframe src="https://evil.example/x"></iframe>'
    + '<div class="ovp-video"><iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe></div><img src="x" onerror="alert(1)"></div></body>';
  const clean = sanitizePageHtml(dirty);
  assert.doesNotMatch(clean, /script|onclick|onerror|javascript:|evil\.example/);
  assert.match(clean, /data-ovelio-form="5b0c3a59-0d3b-4f0e-9c55-1f3f5b2b1a10"/);
  assert.match(clean, /youtube-nocookie\.com\/embed\/abc/);
  assert.doesNotMatch(sanitizePageCss('a{color:red}</style><script>alert(1)</script>'), /<\/style|<script/);
});

test('SIT-03 creating a page from a template creates a page design, a bound form and a first version; autosave rejects stale versions', async () => {
  const created = await pages.createPage({ name: 'SIT webinar', templateKey: 'live-webinar' }, user);
  assert.ok(created.formId);
  const page = await pages.getPage(created.id);
  assert.equal(page.status, 'draft');
  assert.equal(page.slug, 'sit-webinar');
  const design = (await db.query<{ kind: string; source: string }>('SELECT kind, source FROM designs WHERE id = $1', [page.designId])).rows[0];
  assert.equal(design.kind, 'page');
  assert.match(design.source, new RegExp(`data-ovelio-form="${created.formId}"`));
  const loaded = await pages.loadDesign(page.designId);
  const saved = await pages.saveDesign(page.designId, { version: loaded.version, document: { pages: [] }, html: loaded.html.replace('Scaling outbound', 'Scaling outbound safely'), css: loaded.css }, user);
  assert.equal(saved.version, loaded.version + 1);
  await assert.rejects(pages.saveDesign(page.designId, { version: loaded.version, document: {}, html: loaded.html, css: loaded.css }, user), /saved elsewhere/);
  await pages.saveNamedVersion(page.designId, 'Before launch', user);
  const versions = await pages.listVersions(page.designId);
  assert.ok(versions.some(item => item.label === 'Before launch'));
  const restored = await pages.restoreVersion(page.designId, 1, user);
  assert.doesNotMatch(restored.html, /Scaling outbound safely/);
  await assert.rejects(pages.createPage({ name: 'Clash', templateKey: 'blank', slug: 'sit-webinar' }, user), /already uses/);
});

test('SIT-04 publish snapshots the design; the public page renders SEO tags, the live form and the tracker', async () => {
  const created = await pages.createPage({ name: 'SIT demo page', templateKey: 'saas-demo', slug: 'sit-demo' }, user);
  await pages.updatePageSettings(created.id, { seoTitle: 'Book a demo | Northwind', seoDescription: 'See it live.', noindex: true }, user);
  const published = await pages.publishPage(created.id, user);
  assert.equal(published.status, 'published');
  const response = await pub.servePage(new Request('http://localhost:3203/s/sit-demo'), 'sit-demo');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Book a demo \| Northwind<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /rel="canonical" href="http:\/\/localhost:3203\/s\/sit-demo"/);
  assert.match(html, new RegExp(`<form class="ovf"[^>]*action="/api/public/forms/${created.formId}/submit"`));
  assert.match(html, /\/api\/public\/track/);
  const blank = await pages.createPage({ name: 'Unbound', templateKey: 'saas-demo', createForm: false }, user);
  await assert.rejects(pages.publishPage(blank.id, user), /not linked to a form/);
  assert.equal((await pub.servePage(new Request('http://localhost/s/unbound'), 'unbound')).status, 404, 'drafts are not public');
});

test('SIT-05 a published form submission creates the CRM contact, links the visitor and emits the platform events', async () => {
  const created = await pages.createPage({ name: 'SIT ebook', templateKey: 'ebook-download', slug: 'sit-ebook' }, user);
  await pages.publishPage(created.id, user);
  const formId = created.formId!;
  const invalid = await pub.submitForm(formId, { first_name: 'Ada', email: 'not-an-email' }, meta);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.result.ok, false);
  assert.ok(!invalid.result.ok && invalid.result.fieldErrors.email);
  const visitorId = 'sit05-visitor-0001';
  const ok = await pub.submitForm(formId, {
    first_name: 'Ada', email: 'Ada.Sit05@Example.com', company: 'Analytical Engines', _consent: 'yes',
    _page: created.id, _variant: 'a', _vid: visitorId, _utm_source: 'linkedin', _utm_campaign: 'spring', _url: 'http://localhost/s/sit-ebook',
  }, meta);
  assert.equal(ok.status, 200);
  assert.ok(ok.result.ok);
  const contact = await findContactByEmail('ada.sit05@example.com');
  assert.ok(contact, 'contact exists in the directory');
  assert.equal(contact.firstName, 'Ada');
  assert.equal(contact.consent, 'opted_in');
  assert.ok(contact.tags.includes('ebook-email-playbook'));
  const link = await db.query<{ contact_id: string }>(`SELECT contact_id FROM identity_links WHERE kind = 'analytics_visitor' AND value = $1`, [visitorId]);
  assert.equal(Number(link.rows[0].contact_id), contact.id);
  const submission = (await db.query<{ status: string; consent_given: boolean; utm: { source: string } }>('SELECT status, consent_given, utm FROM form_submissions WHERE form_id = $1 AND contact_id = $2', [formId, contact.id])).rows[0];
  assert.equal(submission.status, 'accepted');
  assert.equal(submission.consent_given, true);
  assert.equal(submission.utm.source, 'linkedin');
  const events = await listEvents({ contactId: contact.id });
  const submitted = events.find(event => event.type === 'form.submitted');
  assert.equal(submitted?.entityId, formId);
  assert.equal(submitted?.visitorId, visitorId);
  assert.equal((submitted?.properties as { pageId: string }).pageId, created.id);
  assert.ok(events.some(event => event.type === 'page.converted' && event.entityId === created.id));

  const noConsent = await pub.submitForm(formId, { first_name: 'Bo', email: 'bo.sit05@example.com', _page: created.id }, meta);
  assert.ok(noConsent.result.ok);
  assert.notEqual((await findContactByEmail('bo.sit05@example.com'))?.consent, 'opted_in', 'consent only when ticked');

  const spam = await pub.submitForm(formId, { email: 'bot@example.com', _website: 'http://spam' }, meta);
  assert.ok(spam.result.ok, 'bots get a neutral answer');
  assert.equal(await findContactByEmail('bot@example.com'), null, 'honeypot submissions never create contacts');
});

test('SIT-06 the confirmation email records the mailer status honestly', async () => {
  const design = (await db.query<{ id: string }>(`INSERT INTO designs (kind, name, subject, html) VALUES ('email', 'Thanks', 'Thanks {{contact.first_name}}', '<p>Hi</p>') RETURNING id`)).rows[0];
  const form = await forms.createForm({ name: 'SIT confirm', settings: { confirmationDesignId: design.id, consent: { enabled: true, text: 'Email me', required: false } } }, user);
  const blocked = await pub.submitForm(form.id, { email: 'noconsent.sit06@example.com' }, meta);
  assert.ok(blocked.result.ok);
  const row = (await db.query<{ email_status: string; email_detail: string }>('SELECT email_status, email_detail FROM form_submissions WHERE form_id = $1', [form.id])).rows[0];
  assert.equal(row.email_status, 'blocked');
  assert.match(row.email_detail, /consent/i);
  await pub.submitForm(form.id, { email: 'yes.sit06@example.com', _consent: 'yes' }, meta);
  const consented = (await db.query<{ email_status: string }>(`SELECT email_status FROM form_submissions WHERE form_id = $1 AND field_values->>'email' = 'yes.sit06@example.com'`, [form.id])).rows[0];
  assert.equal(consented.email_status, 'not_sent', 'the preview has no relay, and says so');
});

test('SIT-07 a three-step funnel counts unique visitors per step, drop-off and completion', async () => {
  const ids: string[] = [];
  for (const [index, key] of ['ebook-download', 'live-webinar', 'saas-demo'].entries()) {
    const created = await pages.createPage({ name: `SIT funnel ${index}`, templateKey: key, slug: `sit-funnel-${index}` }, user);
    await pages.publishPage(created.id, user);
    ids.push(created.id);
  }
  const funnel = await funnels.saveFunnel(null, { name: 'SIT funnel', status: 'active', steps: ids.map((pageId, index) => ({ name: `Step ${index + 1}`, pageId })) }, user);
  assert.equal(funnel.steps.length, 3);
  const first = await pub.servePage(new Request('http://localhost/s/sit-funnel-0'), 'sit-funnel-0');
  assert.match(await first.text(), new RegExp(`"funnelId":"${funnel.id}","stepIndex":0`));
  const view = (visitorId: string, step: number) => pub.recordView({ pageId: ids[step], visitorId, funnelId: funnel.id, stepIndex: step, utm: {} });
  for (const visitor of ['sit07-aaaa-1', 'sit07-aaaa-2', 'sit07-aaaa-3', 'sit07-aaaa-4']) await view(visitor, 0);
  await view('sit07-aaaa-1', 0);
  await view('sit07-aaaa-1', 1);
  await view('sit07-aaaa-2', 1);
  await view('sit07-aaaa-1', 2);
  await view('sit07-aaaa-1', 2);
  const stats = await funnels.funnelStats(funnel.id);
  assert.deepEqual(stats.steps.map(step => step.visitors), [4, 2, 1]);
  assert.equal(stats.steps[1].conversionFromPrevious, 50);
  assert.equal(stats.steps[1].dropOff, 2);
  assert.equal(stats.completed, 1);
  assert.equal(stats.completionRate, 25);
  const submitted = await pub.submitForm((await forms.listForms()).find(item => item.name === 'SIT funnel 0 form')!.id, { first_name: 'Cy', email: 'cy.sit07@example.com', _page: ids[0], _funnel: funnel.id, _step: '0', _vid: 'sit07-aaaa-5' }, meta);
  assert.ok(submitted.result.ok && submitted.result.redirect?.includes('/s/sit-funnel-1?fn='), 'a funnel form continues to the next step');
  const pageStats = await funnels.pageStats(ids[0]);
  assert.equal(pageStats.views, 5);
  assert.equal(pageStats.visitors, 4);
});

test('SIT-08 A/B variants are chosen by weight and stay sticky per visitor', () => {
  const page = { id: 'p', ab_enabled: true, control_weight: 50 };
  const variants = [{ key: 'b', weight: 50, published_version: 3 }];
  assert.equal(pub.chooseVariant(page, variants, null, 0.1), 'a');
  assert.equal(pub.chooseVariant(page, variants, null, 0.9), 'b');
  assert.equal(pub.chooseVariant(page, variants, 'b', 0.1), 'b', 'sticky cookie wins');
  assert.equal(pub.chooseVariant({ ...page, ab_enabled: false }, variants, 'b', 0.9), 'a');
  assert.equal(pub.chooseVariant(page, [{ key: 'b', weight: 50, published_version: null }], null, 0.9), 'a', 'unpublished variants are never served');
});

test('SIT-09 domains verify with a TXT record and explain what is missing', async () => {
  const domain = await addDomain({ hostname: 'go.sit-example.com' }, user);
  assert.equal(domain.kind, 'subdomain');
  assert.ok(domain.records.some(record => record.type === 'TXT' && record.value === `ovelio-verify=${domain.verificationToken}`));
  const missing = await verifyDomain(domain.id, user, {
    resolveTxt: async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); },
    resolveCname: async () => ['elsewhere.example.net'], resolve4: async () => [],
  });
  assert.equal(missing.status, 'failed');
  assert.match(missing.statusDetail, /No TXT record found at _ovelio-verify\.go\.sit-example\.com/);
  const ok = await verifyDomain(domain.id, user, {
    resolveTxt: async () => [[`ovelio-verify=${domain.verificationToken}`]], resolveCname: async () => ['localhost'], resolve4: async () => [],
  });
  assert.equal(ok.status, 'verified');
  await assert.rejects(addDomain({ hostname: 'https://bad domain' }, user), /Enter a domain/);
});

test('SIT-10 the preview seed has published pages, forms with submissions, a three-step funnel and recent events; search finds them', async () => {
  const list = await pages.listPages();
  const samples = list.filter(item => item.name.endsWith('(sample)'));
  assert.equal(samples.filter(item => item.status === 'published').length, 3);
  assert.ok(samples.every(item => item.views > 0 && item.conversionRate !== null));
  const sampleForms = (await forms.listForms()).filter(item => item.name.includes('(sample)'));
  assert.ok(sampleForms.filter(item => item.submissions > 0).length >= 2);
  const funnel = (await funnels.listFunnels()).find(item => item.name.includes('(sample)'));
  assert.equal(funnel?.stepCount, 3);
  assert.ok((funnel?.completions ?? 0) > 0);
  const results = await sitesModule.search('webinar', user);
  assert.ok(results.some(item => item.kind === 'page'));
  assert.ok(pageTemplate('blank'));
  const csv = await forms.submissionsCsv(sampleForms[0].id);
  assert.match(csv.split('\r\n')[0], /^Submitted at,Status,/);
});

test('SIT-17 published booking buttons resolve the active type on workspace and custom domains', async t => {
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://workspace.example.test';
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  });

  const { rows: [type] } = await db.query<{ id: string }>(
    "INSERT INTO calendar_booking_types (owner_id, slug, name, duration_minutes) VALUES ($1, 'sites-demo', 'Sites demo', 30) RETURNING id", [user.id],
  );
  const { id } = await pages.createPage({ name: 'SIT booking button', templateKey: 'blank', slug: 'sit-booking-button' }, user);
  const { designId } = await pages.getPage(id);
  const save = async (bookingId: string) => {
    const design = await pages.loadDesign(designId);
    return pages.saveDesign(designId, { version: design.version, document: {}, css: design.css,
      html: `<h1>Schedule a demo</h1><a class="ovp-btn" data-ovelio-booking="${bookingId}" href="https://unrelated.example.test" target="_blank">Book a demo &amp; Q&amp;A</a>`,
    }, user);
  };

  await save('unconfigured');
  await assert.rejects(pages.publishPage(id, user), /Choose a booking type/);
  await save('712cc650-b8c8-4cb7-a73a-b3bf41225486');
  await assert.rejects(pages.publishPage(id, user), /inactive or removed booking type/);
  await save(type.id);
  assert.match(await pages.draftPreview(id), /href="\/book\/sites-demo"/);
  await pages.publishPage(id, user);
  const workspace = await (await pub.servePage(new Request('https://workspace.example.test/s/sit-booking-button'), 'sit-booking-button')).text();
  assert.match(workspace, /<a href="\/book\/sites-demo" class="ovp-btn">Book a demo &amp; Q&amp;A<\/a>/);
  assert.doesNotMatch(workspace, /unrelated\.example\.test|data-ovelio-booking/);

  const domain = await addDomain({ hostname: 'sites-demo.example.test' }, user);
  await db.query("UPDATE site_domains SET status = 'verified' WHERE id = $1", [domain.id]);
  await pages.updatePageSettings(id, { domainId: domain.id }, user);
  await db.query("UPDATE calendar_booking_types SET slug = 'new-sites-demo' WHERE id = $1", [type.id]);
  const liveDomain = () => pub.servePage(new Request('https://sites-demo.example.test/sit-booking-button'), 'sit-booking-button', domain.hostname);
  const custom = await (await liveDomain()).text();
  assert.match(custom, /href="https:\/\/workspace\.example\.test\/book\/new-sites-demo"/);
  await db.query('UPDATE calendar_booking_types SET active = false WHERE id = $1', [type.id]);
  const hidden = await (await liveDomain()).text();
  assert.doesNotMatch(hidden, /Book a demo|\/book\/new-sites-demo/);
  await assert.rejects(pages.publishPage(id, user), /inactive or removed booking type/);
});
