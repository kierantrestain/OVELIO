import { anonymous, expect, isPreviewRun, json, settle, test, unique } from './fixtures';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

// Acceptance journeys (docs/rebuild/TRACKER.md §5) through the browser, against the developer preview.
// They create their own records, so they run once (desktop project) and stay independent of each other.
test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Journeys run once, on the desktop project.'); });

type Stage = { id: string; name: string; outcome: string };
type Pipeline = { id: string; isDefault: boolean; stages: Stage[] };
type Contact = { id: number; email: string; consent?: string };
type Send = { status: string; reason?: string; messageId?: string | null };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const post = (api: APIRequestContext, origin: string, url: string, data: unknown) => api.post(url, { headers: { origin }, data });

/** Fills and submits a published page's form as a signed-out visitor; returns once the thank-you message shows. */
async function submitPublicForm(browser: Browser, baseURL: string, url: string, email: string) {
  const visitor = await browser.newContext({ baseURL });
  try {
    const page = await visitor.newPage();
    await page.goto(url);
    const form = page.locator('form.ovf').first();
    await form.locator('input[name="first_name"]').fill('Journey');
    const last = form.locator('input[name="last_name"]');
    if (await last.count()) await last.fill('Tester');
    await form.locator('input[type="email"]').fill(email);
    const consent = form.locator('input[name="_consent"]');
    if (await consent.count()) await consent.check();
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole('status')).toBeVisible();
  } finally {
    await visitor.close();
  }
}

async function findContact(api: APIRequestContext, email: string) {
  return (await json<Contact[]>(await api.get('/api/console/crm/lookup/contacts?q=' + encodeURIComponent(email)))).find(item => item.email === email);
}

test('UX-10 J2 a deal dragged to another stage is still there after reload', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const pipelines = await json<{ items: Pipeline[] }>(await page.request.get('/api/console/sales/pipelines'));
  const pipeline = pipelines.items.find(item => item.isDefault) ?? pipelines.items[0];
  const [from, to] = pipeline.stages.filter(stage => stage.outcome === 'open');
  const name = 'UX drag ' + unique();
  const deal = await json<{ id: string }>(await post(page.request, origin, '/api/console/sales/deals', { name, amount: 1200, pipelineId: pipeline.id, stageId: from.id }));

  await page.goto('/sales');
  const card = page.getByRole('button', { name: new RegExp('^' + escapeRegExp(name)) });
  const column = page.locator(`section[aria-label^="${to.name}:"]`);
  await expect(card).toBeVisible();
  const source = (await card.boundingBox())!;
  const target = (await column.boundingBox())!;
  const moved = page.waitForResponse(response => response.url().includes(`/sales/deals/${deal.id}/move`));
  await page.mouse.move(source.x + source.width / 2, source.y + source.height - 8);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + 90, { steps: 20 });
  await page.mouse.up();
  expect((await moved).ok()).toBe(true);

  await page.reload();
  await expect(column.getByRole('button', { name: new RegExp('^' + escapeRegExp(name)) })).toBeVisible();
  const saved = await json<{ stageId?: string; deal?: { stageId: string } }>(await page.request.get('/api/console/sales/deals/' + deal.id));
  expect(saved.stageId ?? saved.deal?.stageId).toBe(to.id);
  expect(guard.problems()).toEqual([]);
});

test('UX-11 J4 a template email keeps a visual text edit after reload', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const design = await json<{ id: string }>(await post(page.request, origin, '/api/console/studio/designs', { kind: 'email', name: 'UX studio ' + unique(), templateKey: 'newsletter-digest' }));
  const text = 'Edited in the UX journey ' + unique();
  await page.goto('/studio/email/' + design.id);
  const canvas = page.frameLocator('iframe.gjs-frame');
  await canvas.getByText('This month at OVELIO').dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text);
  await canvas.getByText('What we launched').click();
  await expect(page.locator('.ov-studio-status')).toHaveText(/^Saved/, { timeout: 15_000 });

  await page.reload();
  await expect(page.frameLocator('iframe.gjs-frame').getByText(text)).toBeVisible({ timeout: 20_000 });
  const saved = await json<{ html: string }>(await page.request.get('/api/console/studio/designs/' + design.id));
  expect(saved.html).toContain(text);
  expect(guard.problems()).toEqual([]);
});

test('UX-12 J6/J7 a page published from a template captures a signed-out form submission as a contact', async ({ page, baseURL, browser }) => {
  const origin = new URL(baseURL!).origin;
  const slug = 'ux-' + unique();
  const created = await json<{ id: string }>(await post(page.request, origin, '/api/console/sites/pages', { name: 'UX journey page ' + slug, templateKey: 'live-webinar', slug, createForm: true }));
  const published = await json<{ url?: string; page?: { url: string } }>(await post(page.request, origin, `/api/console/sites/pages/${created.id}/publish`, {}));
  const url = published.url ?? published.page?.url ?? '/s/' + slug;

  const email = `ux-${unique()}@example.test`;
  await submitPublicForm(browser, baseURL!, url, email);
  await expect.poll(async () => (await findContact(page.request, email))?.email ?? null).toBe(email);
});

test('UX-13 J10 a form submission enrols the contact in the published flow', async ({ page, baseURL, browser }) => {
  const flows = await json<{ items: { id: string; status: string; triggers: { type: string; filters: { formId?: string } }[] }[] }>(await page.request.get('/api/console/journeys/flows'));
  const flow = flows.items.find(item => item.status === 'published' && item.triggers.some(trigger => trigger.type === 'form.submitted' && trigger.filters.formId));
  expect(flow, 'a published flow triggered by a form').toBeTruthy();
  const formId = flow!.triggers.find(trigger => trigger.filters.formId)!.filters.formId!;
  const pages = await json<{ items: { url: string; status: string; id: string }[] }>(await page.request.get('/api/console/sites/pages?status=published'));
  const host = await (async () => {
    for (const candidate of pages.items) {
      const html = await (await page.request.get(candidate.url)).text();
      if (html.includes(`data-ovelio-form-id="${formId}"`)) return candidate.url;
    }
    return null;
  })();
  expect(host, 'a published page carrying the flow’s form').toBeTruthy();

  const email = `ux-flow-${unique()}@example.test`;
  await submitPublicForm(browser, baseURL!, host!, email);
  await expect.poll(async () => (await findContact(page.request, email))?.id ?? null).not.toBeNull();
  const contact = await findContact(page.request, email);
  await expect.poll(async () => {
    const enrolments = await json<{ items: { flowId: string }[] }>(await page.request.get(`/api/console/journeys/enrolments?contactId=${contact!.id}`));
    return enrolments.items.some(item => item.flowId === flow!.id);
  }, { timeout: 20_000 }).toBe(true);
});

test('UX-14 J11 an unsubscribe link from a sent message blocks later email', async ({ page, baseURL, browser }) => {
  const origin = new URL(baseURL!).origin;
  // A fresh opted-in contact, created through a public form so the run never depends on earlier runs.
  const pages = await json<{ items: { url: string }[] }>(await page.request.get('/api/console/sites/pages?status=published'));
  const email = `ux-unsub-${unique()}@example.test`;
  await submitPublicForm(browser, baseURL!, pages.items[0].url, email);
  await expect.poll(async () => (await findContact(page.request, email))?.id ?? null).not.toBeNull();
  const contact = (await findContact(page.request, email))!;

  const before = await json<Send>(await post(page.request, origin, `/api/console/crm/contacts/${contact.id}/email`, { subject: 'UX before', body: 'Hello before unsubscribing.' }));
  expect(before.status, before.reason).not.toBe('blocked');

  // A marketing design sent to the contact carries the signed one-click link.
  const designs = await json<{ items: { id: string; category?: string }[] }>(await page.request.get('/api/console/studio/designs?kind=email'));
  const design = designs.items.find(item => item.category !== 'Transactional') ?? designs.items[0];
  const test = await json<{ results: Send[] }>(await post(page.request, origin, `/api/console/studio/designs/${design.id}/test`, { to: [email] }));
  const message = await json<{ html: string }>(await page.request.get('/api/console/studio/messages/' + test.results[0].messageId));
  const link = /https?:\/\/[^"'\s)]+(\/u\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(message.html)?.[1];
  expect(link, 'unsubscribe link in the sent message').toBeTruthy();

  await unsubscribeAs(browser, baseURL!, link!);
  const after = await json<Send>(await post(page.request, origin, `/api/console/crm/contacts/${contact.id}/email`, { subject: 'UX after', body: 'This must not be delivered.' }));
  expect(after.status).toBe('blocked');
});

test('UX-16 J12 attribution credits plus unattributed revenue equal won revenue under every model', async ({ page, guard }) => {
  const endAt = Date.now();
  const startAt = endAt - 120 * 86_400_000;
  type Report = {
    totals: { wonRevenue: number; wonDeals: number };
    unattributed: { revenue: number };
    rows: { revenue: Record<string, number> }[];
  };
  const report = await json<Report>(await page.request.get(`/api/console/insights/attribution?startAt=${startAt}&endAt=${endAt}`));
  expect(report.totals.wonRevenue).toBeGreaterThan(0);
  for (const model of ['first_touch', 'last_touch', 'linear', 'position_based']) {
    const credited = report.rows.reduce((sum, row) => sum + (row.revenue[model] ?? 0), 0);
    expect(Math.abs(credited + report.unattributed.revenue - report.totals.wonRevenue), model).toBeLessThan(0.01 * Math.max(1, report.rows.length));
  }
  await page.goto('/analytics/attribution');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await settle(page);
  expect(guard.problems()).toEqual([]);
});

async function unsubscribeAs(browser: Browser, baseURL: string, path: string) {
  const visitor = await browser.newContext({ baseURL });
  try {
    const page: Page = await visitor.newPage();
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Unsubscribe?' })).toBeVisible();
    await page.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(page.getByRole('heading', { name: /unsubscribed/i })).toBeVisible();
  } finally {
    await visitor.close();
  }
}

anonymous('UX-15 signed-out visitors are sent to sign in', async ({ page }) => {
  anonymous.skip(!isPreviewRun, 'Preview harness only');
  await page.goto('/sales');
  await expect(page).toHaveURL(/\/login$/);
  await settle(page);
});
