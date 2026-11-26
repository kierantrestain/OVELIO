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
  const row = (await db.query('SELECT * FROM forms WHERE id = $1', [created.id])).rows[0];
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
