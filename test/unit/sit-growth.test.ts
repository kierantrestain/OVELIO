import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { ruleMatches, visibleFieldKeys } = await import('../../src/contracts/sites');
const forms = await import('../../src/server/sites/forms');
const pages = await import('../../src/server/sites/pages');
const pub = await import('../../src/server/sites/public');
const { renderFormHtml } = await import('../../src/server/sites/render');
const { findContactByEmail } = await import('../../src/server/directory');

type Field = import('../../src/contracts/sites').FormField;
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@ovelio.test', name: 'Developer Test', role: 'admin' as const, disabled: false };
const meta = { ip: '203.0.113.9', cookieVisitorId: null, referer: null };

after(async () => { await db.close(); });

const qualifying: Field[] = [
  { key: 'email', label: 'Email', type: 'email', required: true, mapsTo: 'email', step: 0 },
  { key: 'company', label: 'Company', type: 'text', required: true, mapsTo: 'company', step: 0, skipIfKnown: true },
  { key: 'buyer', label: 'Are you buying for a team?', type: 'radio', required: true, options: ['Yes', 'No'], mapsTo: 'none', step: 1 },
  { key: 'team_size', label: 'Team size', type: 'select', required: true, options: ['2-10', '11-50', '51+'], mapsTo: 'none', step: 1, showIf: [{ field: 'buyer', operator: 'equals', value: 'Yes' }] },
  { key: 'enterprise', label: 'Need SSO?', type: 'checkbox', required: false, mapsTo: 'none', step: 1, showIf: [{ field: 'team_size', operator: 'equals', value: '51+' }] },
  { key: 'sso_provider', label: 'SSO provider', type: 'text', required: true, mapsTo: 'none', step: 1, showIf: [{ field: 'enterprise', operator: 'checked' }] },
];

test('SIT-11 show-if rules: equals, contains, ticked, and hidden fields count as empty for the fields after them', () => {
  assert.equal(ruleMatches({ field: 'a', operator: 'equals', value: 'Yes' }, { a: ' yes ' }), true);
  assert.equal(ruleMatches({ field: 'a', operator: 'not_equals', value: 'Yes' }, { a: 'No' }), true);
  assert.equal(ruleMatches({ field: 'a', operator: 'contains', value: 'corp' }, { a: 'Acme Corporation' }), true);
  assert.equal(ruleMatches({ field: 'a', operator: 'contains', value: '' }, { a: 'x' }), false, 'an empty contains rule never matches');
  assert.equal(ruleMatches({ field: 'a', operator: 'checked' }, { a: 'yes' }), true);
  assert.equal(ruleMatches({ field: 'a', operator: 'checked' }, { a: 'no' }), false);
  assert.equal(ruleMatches({ field: 'a', operator: 'checked', value: 'SSO' }, { a: ['Audit log', 'SSO'] }), true, 'a ticked option of a multiple choice');
  assert.equal(ruleMatches({ field: 'a', operator: 'not_empty' }, { a: '' }), false);
  const all = visibleFieldKeys(qualifying, { buyer: 'Yes', team_size: '51+', enterprise: 'yes' });
  assert.deepEqual([...all], ['email', 'company', 'buyer', 'team_size', 'enterprise', 'sso_provider']);
  const chained = visibleFieldKeys(qualifying, { buyer: 'No', team_size: '51+', enterprise: 'yes' });
  assert.deepEqual([...chained], ['email', 'company', 'buyer'], 'hiding team size hides everything that depends on it');
  assert.equal(visibleFieldKeys(qualifying, {}, new Set(['company'])).has('company'), false, 'known fields are skipped');
});

test('SIT-12 the server enforces rules: hidden fields are never required or stored, shown ones are validated', async () => {
  const blank = forms.validateAnswers(qualifying, { email: 'a@example.com', company: 'Acme', buyer: 'No', team_size: '51+', sso_provider: 'Okta' });
  assert.deepEqual(blank.errors, {});
  assert.deepEqual(Object.keys(blank.values).sort(), ['buyer', 'company', 'email'], 'values sent for hidden fields are dropped');
  assert.deepEqual(blank.hidden.sort(), ['enterprise', 'sso_provider', 'team_size']);
  const shown = forms.validateAnswers(qualifying, { email: 'a@example.com', company: 'Acme', buyer: 'Yes', team_size: '51+', enterprise: 'yes' });
  assert.equal(shown.errors.sso_provider, 'SSO provider is required.');
  const known = forms.validateAnswers(qualifying, { email: 'a@example.com', buyer: 'No' }, new Set(['company']));
  assert.deepEqual(known.errors, {}, 'a known field is not required');
  await assert.rejects(forms.createForm({ name: 'Bad rule', fields: [qualifying[0], { ...qualifying[2], step: 0, showIf: [{ field: 'later', operator: 'checked' }] }, { key: 'later', label: 'Later', type: 'checkbox', required: false, mapsTo: 'none' }] }, user), /field above it/);
  await assert.rejects(forms.createForm({ name: 'Conditional email', fields: [{ ...qualifying[2], step: 0 }, { ...qualifying[0], showIf: [{ field: 'buyer', operator: 'equals', value: 'Yes' }] }] }, user), /always shown/);
  await assert.rejects(forms.createForm({ name: 'Missing step', fields: qualifying, settings: { steps: [] } }, user), /step that no longer exists/);
});

test('SIT-13 multi-step forms render steps with progress, and progressive profiling skips what a recognised visitor already gave', async () => {
  const created = await forms.createForm({ name: 'SIT multi-step', fields: qualifying, settings: { steps: [{ title: 'About you' }, { title: 'Your team' }] } }, user);
  const row = (await db.query<import('../../src/server/sites/data').FormRow>('SELECT * FROM forms WHERE id = $1', [created.id])).rows[0];
  const html = renderFormHtml(row, { action: '/submit' });
  assert.match(html, /data-steps="2"/);
  assert.equal((html.match(/<fieldset class="ovf-step"/g) ?? []).length, 2);
  assert.match(html, /<legend class="ovf-step-title">Your team<\/legend>/);
  assert.match(html, /Step <span data-ovf-current>1<\/span> of 2/);
  assert.match(html, /data-field="team_size" data-show-if="\[\{&quot;field&quot;:&quot;buyer&quot;/);

  const first = await pub.submitForm(created.id, { email: 'sit13@example.com', company: 'Sit Corp', buyer: 'Yes', team_size: '11-50', _vid: 'sit13-visitor-01' }, meta);
  assert.ok(first.result.ok);
  const missing = await pub.submitForm(created.id, { email: 'sit13b@example.com', buyer: 'No', _vid: 'sit13-visitor-02' }, meta);
  assert.equal(missing.status, 422, 'an unknown visitor must give the company');
  assert.ok(!missing.result.ok && missing.result.fieldErrors.company);
  const again = await pub.submitForm(created.id, { email: 'sit13@example.com', buyer: 'No', _vid: 'sit13-visitor-01' }, meta);
  assert.ok(again.result.ok, 'the recognised visitor is not asked for the company again');
  assert.equal((await findContactByEmail('sit13@example.com'))?.company, 'Sit Corp', 'the known value is kept');
  const known = await pub.knownFields(row, 'sit13-visitor-01');
  assert.deepEqual([...known], ['company']);
  assert.doesNotMatch(renderFormHtml(row, { action: '/submit', known }), /name="company"/);

  const page = await pages.createPage({ name: 'SIT multi page', templateKey: 'saas-demo', formId: created.id, slug: 'sit-multi' }, user);
  await pages.publishPage(page.id, user);
  const served = await (await pub.servePage(new Request('http://localhost/s/sit-multi', { headers: { cookie: 'ov_vid=sit13-visitor-01' } }), 'sit-multi')).text();
  assert.doesNotMatch(served, /name="company"/);
  const stranger = await (await pub.servePage(new Request('http://localhost/s/sit-multi'), 'sit-multi')).text();
  assert.match(stranger, /name="company"/);
});

test('SIT-14 rollback republishes a past snapshot; a changed slug redirects with 301; sitemap and robots list live pages', async () => {
  const created = await pages.createPage({ name: 'SIT rollback', templateKey: 'blank', slug: 'sit-rollback' }, user);
  const design = await pages.loadDesign((await pages.getPage(created.id)).designId);
  await pages.saveDesign(design.designId, { version: design.version, document: {}, html: '<section><h1>First launch</h1></section>', css: design.css }, user);
  await pages.publishPage(created.id, user);
  const second = await pages.loadDesign(design.designId);
  await pages.saveDesign(design.designId, { version: second.version, document: {}, html: '<section><h1>Second launch</h1></section>', css: design.css }, user);
  await pages.publishPage(created.id, user);
  const history = await pages.listPublications(created.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].live, true);
  assert.match(await (await pub.servePage(new Request('http://localhost/s/sit-rollback'), 'sit-rollback')).text(), /Second launch/);
  await pages.restorePublication(created.id, history[1].id, user);
  assert.match(await (await pub.servePage(new Request('http://localhost/s/sit-rollback'), 'sit-rollback')).text(), /First launch/, 'the old snapshot is live again');
  assert.equal((await pages.listPublications(created.id))[0].label.startsWith('Restored'), true);

  const moved = await pages.updatePageSettings(created.id, { slug: 'sit-rollback-new' }, user);
  assert.equal(moved.redirects[0].from, '/s/sit-rollback');
  const redirect = await pub.servePage(new Request('http://localhost/s/sit-rollback?utm_source=mail'), 'sit-rollback');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/s/sit-rollback-new?utm_source=mail');
  assert.equal((await pages.getPage(created.id)).redirects[0].hits, 1);
  await pages.updatePageSettings(created.id, { slug: 'sit-rollback' }, user);
  assert.equal((await pub.servePage(new Request('http://localhost/s/sit-rollback'), 'sit-rollback')).status, 200, 'moving back removes the loop');

  const sitemap = await pub.sitemapXml('https://pages.example');
  assert.match(sitemap!, /<loc>https:\/\/pages\.example\/s\/sit-rollback<\/loc>/);
  await pages.updatePageSettings(created.id, { noindex: true }, user);
  assert.doesNotMatch((await pub.sitemapXml('https://pages.example'))!, /sit-rollback</, 'noindex pages stay out of the sitemap');
  assert.match(pub.robotsTxt('https://pages.example'), /Allow: \/s\/\nDisallow: \/\n\nSitemap: https:\/\/pages\.example\/sitemap\.xml/);
  assert.match(pub.robotsTxt('', 'go.example.com'), /Sitemap: https:\/\/go\.example\.com\/sitemap\.xml/);
});

test('SIT-15 funnel branching routes by form answer and reports conversion per branch', async () => {
  const funnels = await import('../../src/server/sites/funnels');
  const ids: string[] = [];
  let formId = '';
  for (const [index, key] of ['saas-demo', 'ebook-download', 'live-webinar'].entries()) {
    const created = await pages.createPage({ name: `SIT branch ${index}`, templateKey: key, slug: `sit-branch-${index}` }, user);
    await pages.publishPage(created.id, user);
    ids.push(created.id);
    if (index === 0) formId = created.formId!;
  }
  const funnel = await funnels.saveFunnel(null, { name: 'SIT branching', status: 'active', steps: [
    { name: 'Qualify', pageId: ids[0], routes: [{ field: 'team_size', operator: 'equals', value: '1,000+', toPosition: 2 }] },
    { name: 'Small teams', pageId: ids[1] }, { name: 'Enterprise', pageId: ids[2] },
  ] }, user);
  assert.equal(funnel.steps[0].routes[0].toPosition, 2);
  assert.ok(funnel.steps[0].fields.some(field => field.key === 'team_size' && field.options?.includes('1,000+')), 'routes can pick from the page form fields');
  await assert.rejects(funnels.saveFunnel(funnel.id, { steps: [{ name: 'A', pageId: ids[0], routes: [{ field: 'team_size', operator: 'checked', toPosition: 0 }] }, { name: 'B', pageId: ids[1] }] }, user), /does not exist/);
  const answer = (visitor: string, size: string, email: string) => pub.submitForm(formId, {
    first_name: 'Branch', email, company: 'Acme', team_size: size, _page: ids[0], _funnel: funnel.id, _step: '0', _vid: visitor,
  }, meta);
  const big = await answer('sit15-visitor-big', '1,000+', 'big.sit15@example.com');
  assert.ok(big.result.ok && big.result.redirect?.startsWith('/s/sit-branch-2?fn='), 'large teams skip to the enterprise step');
  const small = await answer('sit15-visitor-small', '11–50', 'small.sit15@example.com');
  assert.ok(small.result.ok && small.result.redirect?.startsWith('/s/sit-branch-1?fn='), 'everyone else continues to the next step');
  await pub.recordView({ pageId: ids[2], visitorId: 'sit15-visitor-big', funnelId: funnel.id, stepIndex: 2, utm: {} });
  const stats = await funnels.funnelStats(funnel.id);
  const [route, otherwise] = stats.steps[0].branches;
  assert.equal(route.label, 'If Team size is “1,000+”');
  assert.equal(route.toName, 'Enterprise');
  assert.deepEqual([route.visitors, route.reached, route.conversion], [1, 1, 100]);
  assert.equal(otherwise.label, 'Otherwise');
  assert.deepEqual([otherwise.visitors, otherwise.reached, otherwise.conversion], [1, 0, 0]);
  assert.equal(stats.completed, 1, 'reaching the last step completes the funnel');
});

test('SIT-16 the page template factory is deterministic, covers every industry and layout, and every output validates and survives sanitising', async () => {
  const { buildFactoryTemplates, layouts } = await import('../../src/templates/pages/factory');
  const { templateIndustries } = await import('../../src/contracts/sites');
  const { validatePageTemplate, templateCatalog, catalogSummaries } = await import('../../src/server/sites/templates');
  const first = buildFactoryTemplates();
  assert.deepEqual(buildFactoryTemplates(), first, 'same kits, same templates');
  assert.equal(first.length, templateIndustries.length * layouts.length);
  assert.equal(new Set(first.map(item => item.key)).size, first.length);
  for (const industry of templateIndustries) assert.equal(first.filter(item => item.industry === industry).length, layouts.length, `${industry} has every layout`);
  assert.ok(new Set(first.map(item => item.palette[0])).size >= 5, 'brand tokens vary across the set');
  for (const template of first) assert.deepEqual(validatePageTemplate(template), [], template.key);
  const bad = { ...first[0], html: first[0].html.replace('<section', '<section onclick="alert(1)"') + '<script>alert(1)</script>' };
  assert.ok(validatePageTemplate(bad).includes('contains script'));
  assert.ok(validatePageTemplate({ ...first[0], html: first[0].html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '') }).includes('needs exactly one h1'));
  assert.equal(templateCatalog().length, first.length + 16, 'curated and factory templates all pass');
  assert.ok(catalogSummaries().some(item => item.source === 'factory' && item.industry === 'E-commerce'));
  const created = await pages.createPage({ name: 'SIT factory page', templateKey: 'f-events-event-registration', slug: 'sit-factory' }, user);
  await pages.publishPage(created.id, user);
  const html = await (await pub.servePage(new Request('http://localhost/s/sit-factory'), 'sit-factory')).text();
  assert.match(html, /Momentum Summit 2027/);
  assert.match(html, /name="ticket"/, 'the generated form is live on the page');
});
