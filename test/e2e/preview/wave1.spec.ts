import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { ruleToClass } from '../../../src/contracts/studio';
import { expect, isPreviewRun, json, settle, test, unique } from './fixtures';

// Wave one independent acceptance (Intelligence & Quality). Each test checks one TRACKER §7 acceptance criterion through
// the browser; the console API is used only to set up records and to verify what the screen claims. Runs in the
// 'journeys' project, after the evidence sweep, because it creates records.
test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

const DEV = '00000000-0000-4000-8000-000000000001';
const MAYA = '00000000-0000-4000-8000-000000000002';
const LIAM = '00000000-0000-4000-8000-000000000003';

type Api = { get: <T>(path: string) => Promise<T>; send: <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown) => Promise<T> };

function api(request: APIRequestContext, baseURL: string): Api {
  const origin = new URL(baseURL).origin;
  return {
    get: async <T>(path: string) => json<T>(await request.get('/api/console/' + path)),
    send: async <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown) => {
      const response = await request.fetch('/api/console/' + path, { method, headers: { origin }, data: data ?? {} });
      if (response.status() === 204) return undefined as T;
      return json<T>(response);
    },
  };
}

async function choose(page: Page, label: string, option: string | RegExp, scope: Page | ReturnType<Page['locator']> = page) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option }).first().click();
}

type Pipeline = { id: string; isDefault: boolean; stages: { id: string; name: string; outcome: string }[] };
type PageDetail = { id: string; slug: string; formId: string | null; url: string; status: string };

async function publishedPage(a: Api, templateKey: string, name: string): Promise<PageDetail> {
  const page = await a.send<PageDetail>('POST', 'sites/pages', { name, templateKey, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
  return a.send<PageDetail>('POST', `sites/pages/${page.id}/publish`);
}

/** Opens a signed-out visitor browser, as a real lead would arrive. */
async function visitor<T>(browser: Browser, baseURL: string, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

async function fillSaasForm(page: Page, values: { firstName: string; email: string; company: string; teamSize: string }) {
  const form = page.locator('form.ovf-form, form[data-ovf], form').filter({ has: page.locator('input[name="email"]') }).first();
  await form.locator('input[name="first_name"]').fill(values.firstName);
  await form.locator('input[name="email"]').fill(values.email);
  await form.locator('input[name="company"]').fill(values.company);
  await form.locator('select[name="team_size"]').selectOption(values.teamSize);
  await form.locator('button.ovf-final').click();
}

test('IQ-01 environment: a compact badge is in the top bar on every page and the large banner is gone', async ({ page, guard }) => {
  for (const route of ['/overview', '/crm', '/sales', '/marketing/templates', '/sites', '/analytics', '/settings']) {
    await page.goto(route);
    await settle(page);
    await expect(page.getByRole('button', { name: /Preview environment with sample data/ }), route).toBeVisible();
    await expect(page.getByText('Every record here is demonstration data'), route).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('button', { name: /Preview environment/ }), `${route}: badge sits in the top bar`).toHaveCount(1);
  }
  expect(guard.problems()).toEqual([]);
});

test('IQ-02 notifications: a form lead creates a notification that appears in the bell', async ({ page, browser, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const id = unique();
  const landing = await publishedPage(a, 'saas-demo', `IQ lead page ${id}`);
  const form = await a.get<{ name: string }>(`sites/forms/${landing.formId}`);
  const before = await a.get<{ items: { title: string }[] }>('platform/notifications');
  const title = `New lead from ${form.name}`;
  const earlier = before.items.filter(item => item.title === title).length;
  await visitor(browser, baseURL!, async lead => {
    await lead.goto(new URL(landing.url, baseURL).pathname);
    await fillSaasForm(lead, { firstName: 'Iq', email: `iq.lead.${id}@example.test`, company: 'IQ Labs', teamSize: '11–50' });
    await expect(lead.locator('.ovf-status')).toContainText(/thank|received|sent/i);
  });
  await expect.poll(async () => (await a.get<{ items: { title: string }[] }>('platform/notifications')).items.filter(item => item.title === title).length, { timeout: 15_000 }).toBeGreaterThan(earlier);
  await page.goto('/overview');
  await page.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click();
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible();
  expect(guard.problems()).toEqual([]);
});

test('IQ-03 favourites: a starred deal is found in the search palette', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const deal = await a.send<{ id: string; name: string }>('POST', 'sales/deals', { name: `IQ starred ${unique()}`, amount: 1200 });
  await page.goto('/sales/deals/' + deal.id);
  await settle(page);
  await page.getByRole('button', { name: 'Star this deal' }).click();
  await expect(page.getByRole('button', { name: 'Remove this deal from starred' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search records, pages and actions' });
  await expect(palette.getByRole('option', { name: new RegExp(deal.name) }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  expect(guard.problems()).toEqual([]);
  await a.send('DELETE', `platform/marks/star/deal/${deal.id}`);
});

test('IQ-04 dashboards: a hidden Overview widget is still hidden after a reload', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  await page.goto('/overview');
  await settle(page);
  await expect(page.locator('[data-widget="website"]')).toBeVisible();
  await page.getByRole('button', { name: 'Customise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customise Overview' });
  const saved = page.waitForResponse(response => response.url().endsWith('/api/console/platform/preferences') && response.request().method() === 'PATCH');
  await dialog.getByRole('switch', { name: 'Website pulse' }).click();
  expect((await saved).ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await settle(page);
  await expect(page.locator('[data-widget="kpis"]')).toBeVisible();
  await expect(page.locator('[data-widget="website"]')).toHaveCount(0);
  expect(guard.problems()).toEqual([]);
  await a.send('PATCH', 'platform/preferences', { overview: null });
});

test('IQ-05 density: the toggle changes table row height, and both densities stay readable', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  await a.send('PATCH', 'platform/preferences', { density: 'comfortable' });
  await page.goto('/crm');
  await settle(page);
  const row = page.locator('table tbody tr').first();
  await expect(row).toBeVisible();
  const comfortable = (await row.boundingBox())!.height;
  await page.getByRole('button', { name: /display settings$/ }).click();
  await page.getByRole('menuitem', { name: 'Compact' }).click();
  await expect(page.locator('[data-ov-density="compact"]')).toHaveCount(1);
  await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(comfortable - 2);
  const fontSize = await row.locator('td').nth(1).evaluate(cell => parseFloat(getComputedStyle(cell).fontSize));
  expect(fontSize, 'compact rows keep readable text').toBeGreaterThanOrEqual(12);
  expect(guard.problems()).toEqual([]);
  await a.send('PATCH', 'platform/preferences', { density: 'comfortable' });
});

test('IQ-06 CRM lists: filter contacts by owner and stage, then save the view', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  type Contacts = { items: { email: string; ownerId: string | null; stageName: string | null }[] };
  const expected = await a.get<Contacts>(`crm/contacts?ownerId=${DEV}&stage=Marketing+Qualified&limit=50`);
  expect(expected.items.length, 'seeded data has a match').toBeGreaterThan(0);
  await page.goto('/crm');
  await settle(page);
  await choose(page, 'Owner', 'Developer Test');
  await choose(page, 'Lifecycle stage', 'Marketing Qualified');
  await expect(page.getByRole('region', { name: 'Active filters' })).toContainText('Owner: Developer Test');
  await expect(page.getByRole('region', { name: 'Active filters' })).toContainText('Stage: Marketing Qualified');
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(expected.items.length);
  for (const item of expected.items) await expect(page.locator('table tbody')).toContainText(item.email);
  const name = `IQ owner and stage ${unique()}`;
  await page.getByRole('textbox', { name: 'View name' }).fill(name);
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByText('View saved for the team.')).toBeVisible();
  type View = { id: string; name: string; filters: { field: string; value: string }[] };
  const view = (await a.get<View[]>('platform/views?object=contacts')).find(item => item.name === name);
  expect(view?.filters).toEqual(expect.arrayContaining([{ field: 'ownerId', operator: 'eq', value: DEV }, { field: 'stage', operator: 'eq', value: 'Marketing Qualified' }]));
  await page.reload();
  await settle(page);
  await choose(page, 'Saved views', name);
  await expect(page.getByRole('region', { name: 'Active filters' })).toContainText('Stage: Marketing Qualified');
  await expect(rows).toHaveCount(expected.items.length);
  expect(guard.problems()).toEqual([]);
  await a.send('DELETE', `platform/views/${view!.id}`);
});

test('IQ-07 duplicates: merging two contacts moves their deal to the survivor', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const id = unique();
  const keep = await a.send<{ id: number }>('POST', 'contacts', { email: `iq.keep.${id}@example.test`, firstName: 'Quinn', lastName: `Merge${id}`, company: 'IQ Duplicates Ltd' });
  const dup = await a.send<{ id: number }>('POST', 'contacts', { email: `iq.dup.${id}@example.test`, firstName: 'Quinn', lastName: `Merge${id}`, company: 'IQ Duplicates Ltd' });
  const deal = await a.send<{ id: string }>('POST', 'sales/deals', { name: `IQ merge deal ${id}`, amount: 700, contactId: dup.id });
  await page.goto('/crm');
  await settle(page);
  await page.getByRole('button', { name: 'Duplicates' }).click();
  const drawer = page.getByRole('dialog', { name: 'Duplicate contacts' });
  const group = drawer.locator('.ov-crm-step').filter({ hasText: `iq.dup.${id}@example.test` });
  await expect(group).toBeVisible();
  await group.getByRole('radio', { name: new RegExp(`iq\\.keep\\.${id}`) }).check();
  await group.getByRole('button', { name: 'Merge into the kept contact' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Merge contacts' }).click();
  await expect(drawer.getByText(/Merged 1 contact into Quinn/)).toBeVisible();
  const moved = await a.get<{ contactId: number | null }>(`sales/deals/${deal.id}`);
  expect(moved.contactId).toBe(keep.id);
  const left = await page.request.get(`/api/console/crm/contacts/${dup.id}/profile`);
  expect(left.status(), 'the duplicate is gone').toBe(404);
  expect(guard.problems()).toEqual([]);
});

test('IQ-08 lead routing: each new form lead is assigned to the next rep in rotation', async ({ page, browser, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const id = unique();
  const landing = await publishedPage(a, 'saas-demo', `IQ routing page ${id}`);
  const form = await a.get<{ name: string }>(`sites/forms/${landing.formId}`);
  const rule = await a.send<{ id: string }>('POST', 'crm/routing', { name: `IQ rotation ${id}`, matchField: 'form', matchValue: form.name, userIds: [MAYA, LIAM] });
  const rules = (await a.get<{ rules: { id: string }[] }>('crm/routing')).rules;
  await a.send('POST', 'crm/routing/order', { ids: [rule.id, ...rules.filter(item => item.id !== rule.id).map(item => item.id)] });
  const emails = [`iq.route1.${id}@example.test`, `iq.route2.${id}@example.test`];
  for (const email of emails) {
    await visitor(browser, baseURL!, async lead => {
      await lead.goto(new URL(landing.url, baseURL).pathname);
      await fillSaasForm(lead, { firstName: 'Route', email, company: 'IQ Routing', teamSize: '2–10' });
      await expect(lead.locator('.ovf-status')).toContainText(/thank|received|sent/i);
    });
  }
  type Contacts = { items: { id: number; email: string; ownerId: string | null }[] };
  const owner = async (email: string) => (await a.get<Contacts>(`crm/contacts?q=${encodeURIComponent(email)}`)).items.find(item => item.email === email)?.ownerId ?? null;
  await expect.poll(() => owner(emails[0]), { timeout: 15_000 }).toBe(MAYA);
  await expect.poll(() => owner(emails[1]), { timeout: 15_000 }).toBe(LIAM);
  await page.goto('/sales/pipelines');
  await settle(page);
  const panel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Lead routing' }) }).last();
  await expect(panel).toContainText(`Maya Chen · IQ rotation ${id}`);
  await expect(panel).toContainText(`Liam Brooks · IQ rotation ${id}`);
  expect(guard.problems()).toEqual([]);
  await a.send('DELETE', `crm/routing/${rule.id}`);
});

test('IQ-09 stage rules: moving a deal into a stage with a missing required field is refused with the reason', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const pipeline = (await a.get<{ items: Pipeline[] }>('sales/pipelines')).items.find(item => item.isDefault)!;
  const proposal = pipeline.stages.find(stage => stage.name === 'Proposal')!;
  await a.send('PATCH', `sales/stages/${proposal.id}`, { requiredFields: ['expected_close_date'] });
  try {
    const name = `IQ bare deal ${unique()}`;
    const deal = await a.send<{ id: string; stageName: string }>('POST', 'sales/deals', { name, amount: 300, pipelineId: pipeline.id });
    await page.goto('/sales/deals/' + deal.id);
    await settle(page);
    await page.getByRole('navigation', { name: 'Pipeline stage' }).getByRole('button', { name: 'Proposal' }).click();
    await expect(page.getByText(new RegExp(`Add an expected close date before moving “${name}” to Proposal`))).toBeVisible();
    expect((await a.get<{ stageName: string }>(`sales/deals/${deal.id}`)).stageName).not.toBe('Proposal');
    expect(guard.problems()).toEqual([]);
  } finally {
    await a.send('PATCH', `sales/stages/${proposal.id}`, { requiredFields: [] });
  }
});

test('IQ-10 sequence safety: an email step outside the recipient’s send window waits for the next window', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const londonHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date()));
  const start = (londonHour + 12) % 24;
  const name = `IQ window ${unique()}`;
  const sequence = await a.send<{ id: string }>('POST', 'sales/sequences', {
    name, sendWindow: { start, end: start + 1, days: [0, 1, 2, 3, 4, 5, 6] },
    steps: [{ kind: 'email', delayDays: 0, businessHours: true, subject: 'Hello {{contact.first_name}}', body: 'A short note.' }],
  });
  const hannah = (await a.get<{ items: { id: number; email: string }[] }>('crm/contacts?q=hannah')).items[0];
  await a.send('POST', `sales/sequences/${sequence.id}/enrol`, { contactIds: [hannah.id] });
  type Enrolment = { runs: unknown[]; waitReason: string; nextRunAt: string | null; status: string };
  await expect.poll(async () => (await a.get<Enrolment[]>(`sales/sequences/${sequence.id}/enrolments`))[0]?.waitReason ?? '', { timeout: 15_000 })
    .toMatch(/Waiting for the recipient's send window/);
  const [enrolment] = await a.get<Enrolment[]>(`sales/sequences/${sequence.id}/enrolments`);
  expect(enrolment.runs).toHaveLength(0);
  expect(Date.parse(enrolment.nextRunAt!)).toBeGreaterThan(Date.now() + 60 * 60_000);
  await page.goto('/sales/sequences');
  await settle(page);
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByText(/Waiting for the recipient's send window/)).toBeVisible();
  expect(guard.problems()).toEqual([]);
  await a.send('POST', `sales/sequences/${sequence.id}/status`, { status: 'archived' }).catch(() => undefined);
});

test('IQ-11 email studio: a conditional block renders differently for two contacts in the preview', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const vip = ruleToClass({ kind: 'tag', negate: false, value: 'vip' });
  const notVip = ruleToClass({ kind: 'tag', negate: true, value: 'vip' });
  const section = (cls: string, text: string) => `<mj-section css-class="${cls}"><mj-column><mj-text>${text}</mj-text></mj-column></mj-section>`;
  const design = await a.send<{ id: string }>('POST', 'studio/designs', {
    name: `IQ conditional ${unique()}`, subject: 'Conditional preview',
    source: `<mjml><mj-body>${section(vip, 'VIP-ONLY-BLOCK')}${section(notVip, 'EVERYONE-ELSE-BLOCK')}<mj-section><mj-column><mj-text>SHARED-BLOCK</mj-text></mj-column></mj-section></mj-body></mjml>`,
  });
  await page.goto('/studio/email/' + design.id);
  await expect(page.getByRole('textbox', { name: 'Email name' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview' });
  const frame = dialog.frameLocator('iframe[title="Personalised email preview"]');
  await choose(page, 'Sample contact', /Claire Bennett/, dialog);
  await expect(frame.getByText('VIP-ONLY-BLOCK')).toBeVisible();
  await expect(frame.getByText('EVERYONE-ELSE-BLOCK')).toHaveCount(0);
  await choose(page, 'Sample contact', /Daniel Patel/, dialog);
  await expect(frame.getByText('EVERYONE-ELSE-BLOCK')).toBeVisible();
  await expect(frame.getByText('VIP-ONLY-BLOCK')).toHaveCount(0);
  await expect(frame.getByText('SHARED-BLOCK')).toBeVisible();
  expect(guard.problems()).toEqual([]);
});

test('IQ-12 deliverability: the report lists each check with a measured value or “Unavailable”', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const report = await a.get<{ checks: { id: string; label: string; status: string; value: string }[] }>('studio/deliverability');
  for (const id of ['spf', 'dkim', 'dmarc', 'bounce', 'complaint']) expect(report.checks.map(check => check.id)).toContain(id);
  await page.goto('/marketing/deliverability');
  await settle(page);
  for (const check of report.checks) {
    const row = page.locator('li, tr').filter({ hasText: check.label }).first();
    await expect(row, check.id).toBeVisible();
    expect(check.value.trim(), `${check.id} has a value`).not.toBe('');
    if (check.status === 'unavailable') expect(check.value).toBe('Unavailable');
    await expect(row, check.id).toContainText(check.value);
  }
  expect(guard.problems()).toEqual([]);
});

test('IQ-13 template factory: a generated email template opens in the studio and saves', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const templates = await a.get<{ items: { key: string; name: string; source: string }[] }>('studio/templates');
  const factory = templates.items.find(item => item.source === 'factory')!;
  await page.goto('/marketing/templates');
  await settle(page);
  await page.getByRole('searchbox', { name: 'Search' }).fill(factory.name);
  await page.locator('.ov-studio-card').filter({ hasText: factory.name }).first().getByRole('button', { name: 'Use template' }).click();
  await expect(page).toHaveURL(/\/studio\/email\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const designId = /\/studio\/email\/([0-9a-f-]{36})/.exec(page.url())![1];
  const nameBox = page.getByRole('textbox', { name: 'Email name' });
  await expect(nameBox).toBeVisible({ timeout: 30_000 });
  const name = `IQ factory ${unique()}`;
  await nameBox.fill(name);
  await expect(page.locator('.ov-studio-status')).toHaveText(/^Saved/, { timeout: 20_000 });
  await expect(page.getByText(/MJML (warning|warnings)/)).toHaveCount(0);
  const saved = await a.get<{ name: string; html: string }>(`studio/designs/${designId}`);
  expect(saved.name).toBe(name);
  expect(saved.html).toMatch(/<html/i);
  expect(guard.problems()).toEqual([]);
});

test('IQ-14 forms: a multi-step form hides a conditional field, and the server ignores or refuses it accordingly', async ({ page, browser, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const form = await a.send<{ id: string }>('POST', 'sites/forms', {
    name: `IQ multi-step ${unique()}`,
    fields: [
      { key: 'email', label: 'Email', type: 'email', required: true, mapsTo: 'email', step: 0 },
      { key: 'buyer', label: 'Buying for a team?', type: 'radio', required: true, options: ['Yes', 'No'], mapsTo: 'none', step: 1 },
      { key: 'team_size', label: 'Team size', type: 'select', required: true, options: ['2-10', '11-50', '51+'], mapsTo: 'none', step: 1, showIf: [{ field: 'buyer', operator: 'equals', value: 'Yes' }] },
    ],
    settings: { steps: [{ title: 'About you' }, { title: 'Your team' }] },
  });
  await visitor(browser, baseURL!, async lead => {
    await lead.goto(`/f/${form.id}`);
    await expect(lead.getByText('Step 1 of 2')).toBeVisible();
    await lead.locator('input[name="email"]').fill(`iq.steps.${unique()}@example.test`);
    await lead.getByRole('button', { name: 'Next' }).click();
    await expect(lead.getByText('Step 2 of 2')).toBeVisible();
    const teamSize = lead.locator('[data-field="team_size"]');
    await expect(teamSize).toBeHidden();
    await lead.getByRole('radio', { name: 'Yes' }).check();
    await expect(teamSize).toBeVisible();
    await lead.getByRole('radio', { name: 'No' }).check();
    await expect(teamSize).toBeHidden();
  });
  const submit = (data: Record<string, string>) => page.request.post(`/api/public/forms/${form.id}/submit`, { headers: { accept: 'application/json' }, data });
  const ignored = await submit({ email: `iq.hidden.${unique()}@example.test`, buyer: 'No', team_size: '51+' });
  expect(ignored.status()).toBe(200);
  const refused = await submit({ email: `iq.shown.${unique()}@example.test`, buyer: 'Yes' });
  expect(refused.status()).toBe(422);
  expect(((await refused.json()) as { fieldErrors: Record<string, string> }).fieldErrors.team_size).toBeTruthy();
  const stored = await a.get<{ items: { values: Record<string, unknown> }[] }>(`sites/forms/${form.id}/submissions`);
  expect(stored.items).toHaveLength(1);
  expect(stored.items[0].values).not.toHaveProperty('team_size');
  expect(guard.problems()).toEqual([]);
});

test('IQ-15 rollback: restoring an older publication republishes it to visitors', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const slug = `iq-rollback-${unique()}`;
  const created = await a.send<PageDetail>('POST', 'sites/pages', { name: `IQ rollback ${slug}`, templateKey: 'blank', slug });
  for (const heading of ['IQ first launch', 'IQ second launch']) {
    const design = await a.get<{ version: number; css: string }>(`sites/pages/${created.id}/design`);
    await a.send('PATCH', `sites/pages/${created.id}/design`, { version: design.version, document: {}, html: `<section><h1>${heading}</h1></section>`, css: design.css });
    await a.send('POST', `sites/pages/${created.id}/publish`);
  }
  expect(await (await page.request.get('/s/' + slug)).text()).toContain('IQ second launch');
  await page.goto('/studio/page/' + created.id);
  await page.getByRole('button', { name: 'Settings' }).click();
  const drawer = page.getByRole('dialog', { name: 'Publish and settings' });
  await drawer.getByRole('button', { name: 'Restore this version' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Republish' }).click();
  await expect(drawer.getByText('Live').first()).toBeVisible();
  await expect.poll(async () => (await page.request.get('/s/' + slug)).text()).toContain('IQ first launch');
  expect(guard.problems()).toEqual([]);
});

test('IQ-16 redirects: a page’s old address answers 301 with the new one after the slug changes', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const slug = `iq-slug-${unique()}`;
  const landing = await publishedPage(a, 'blank', slug);
  expect(landing.slug).toBe(slug);
  await page.goto('/studio/page/' + landing.id);
  await page.getByRole('button', { name: 'Settings' }).click();
  const drawer = page.getByRole('dialog', { name: 'Publish and settings' });
  await drawer.getByRole('textbox', { name: 'Page address' }).fill(slug + '-new');
  await drawer.getByRole('button', { name: 'Save settings' }).click();
  await expect(drawer.getByText(`/s/${slug}`, { exact: true })).toBeVisible();
  const old = await page.request.get(`/s/${slug}?utm_source=iq`, { maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers().location).toBe(`/s/${slug}-new?utm_source=iq`);
  expect((await page.request.get(`/s/${slug}-new`)).status()).toBe(200);
  expect(guard.problems()).toEqual([]);
});

test('IQ-17 funnels: a branch routes the visitor by their form answer', async ({ page, browser, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const id = unique();
  const qualify = await publishedPage(a, 'saas-demo', `IQ qualify ${id}`);
  const small = await publishedPage(a, 'ebook-download', `IQ small ${id}`);
  const enterprise = await publishedPage(a, 'live-webinar', `IQ enterprise ${id}`);
  const funnel = await a.send<{ id: string }>('POST', 'sites/funnels', { name: `IQ branching ${id}`, status: 'active', steps: [
    { name: 'Qualify', pageId: qualify.id, routes: [{ field: 'team_size', operator: 'equals', value: '1,000+', toPosition: 2 }] },
    { name: 'Small teams', pageId: small.id }, { name: 'Enterprise', pageId: enterprise.id },
  ] });
  for (const [size, target] of [['1,000+', enterprise.slug], ['11–50', small.slug]] as const) {
    await visitor(browser, baseURL!, async lead => {
      await lead.goto(`/s/${qualify.slug}?fn=${funnel.id}`);
      await fillSaasForm(lead, { firstName: 'Branch', email: `iq.branch.${unique()}@example.test`, company: 'IQ Funnels', teamSize: size });
      await expect(lead, `team size ${size}`).toHaveURL(new RegExp(`/s/${target}\\?fn=`), { timeout: 15_000 });
    });
  }
  expect(guard.problems()).toEqual([]);
});

test('IQ-18 media: an uploaded SVG with a script is served sanitised with a CSP sandbox', async ({ page, baseURL, guard }) => {
  const a = api(page.request, baseURL!);
  const filename = `iq-logo-${unique()}.svg`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="alert(1)"><script>alert(2)</script><circle cx="20" cy="20" r="18" fill="#2457d6"/><a href="javascript:alert(3)"><rect width="4" height="4"/></a></svg>';
  await page.goto('/marketing/media');
  await settle(page);
  await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.getByRole('button', { name: 'Upload file' }).click();
  await expect(page.getByText('Media file uploaded.')).toBeVisible();
  const items = await a.get<{ filename: string; url: string; contentType: string }[]>('media');
  const item = items.find(entry => entry.filename.startsWith(filename.replace(/\.svg$/, '')));
  expect(item, 'the upload is listed').toBeTruthy();
  const served = await page.request.get(new URL(item!.url, baseURL).pathname);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('image/svg+xml');
  expect(served.headers()['content-security-policy']).toMatch(/sandbox/);
  const body = await served.text();
  expect(body).toContain('<circle');
  expect(body).not.toMatch(/<script|onload|javascript:/i);
  expect(guard.problems()).toEqual([]);
});

test('IQ-19 page factory: a generated page template is created in the builder and publishes', async ({ page, baseURL, guard }) => {
  const name = `IQ factory page ${unique()}`;
  await page.goto('/sites?create=page');
  const gallery = page.getByRole('dialog', { name: 'Choose a template' });
  await gallery.getByRole('textbox', { name: 'Search templates' }).fill('Event registration · Events');
  await gallery.getByRole('button', { name: /Event registration · Events/ }).first().click();
  const create = page.getByRole('dialog', { name: /New page from “Event registration · Events”/ });
  await create.getByRole('textbox', { name: 'Page name' }).fill(name);
  await create.getByRole('button', { name: 'Create and open the builder' }).click();
  await expect(page).toHaveURL(/\/studio\/page\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Publish and settings' });
  await drawer.getByRole('button', { name: 'Publish now' }).click();
  await expect(drawer.getByText(/Published\. Live at/)).toBeVisible({ timeout: 20_000 });
  const pageId = /\/studio\/page\/([0-9a-f-]{36})/.exec(page.url())![1];
  const detail = await api(page.request, baseURL!).get<PageDetail>(`sites/pages/${pageId}`);
  expect(detail.status).toBe('published');
  const live = await page.request.get(new URL(detail.url, baseURL).pathname);
  expect(live.status()).toBe(200);
  const html = await live.text();
  expect(html).toContain('Momentum Summit 2027');
  expect(html).toMatch(/name="ticket"/);
  expect(guard.problems()).toEqual([]);
});
