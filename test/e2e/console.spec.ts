import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { Dashboard, Goal, GoalStats, Website, WebsiteReport } from '../../src/contracts/index';
import { testEnv } from '../integration/client';

const environment = testEnv();

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(environment.email);
  await page.getByLabel('Password').fill(environment.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
});

test('console navigation and an interactive CSV import', async ({ page }) => {
  // The Overview home greets the signed-in user, so check the route and its page heading.
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  // OVELIO 2.0 workspaces: each side-navigation entry opens its workspace with a page heading. CRM last, for the import.
  for (const [section, path] of [['Sales', '/sales'], ['Marketing', '/marketing'], ['Automations', '/automations'], ['Analytics', '/analytics'], ['Settings', '/settings'], ['CRM', '/crm']]) {
    await page.getByRole('link', { name: section, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/') + '$'));
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
  const address = 'browser-' + Date.now().toString(36) + '@example.test';
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('CSV file').setInputFiles({
    name: 'browser-contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('email,first_name,last_name\n' + address + ',Browser,Fixture\n'),
  });
  // AUD-10: upload, check the suggested mapping, then run the import in the background and wait for it to finish.
  await form.getByRole('button', { name: 'Continue', exact: true }).click();
  const started = page.waitForResponse(response => /\/api\/console\/contacts\/imports\/[0-9a-f-]{36}\/start$/.test(response.url()));
  await form.getByRole('button', { name: 'Import contacts', exact: true }).click();
  expect((await started).ok()).toBe(true);
  await expect(form.getByText('Import finished')).toBeVisible({ timeout: 60_000 });
  await expect(form.getByText('Created 1')).toBeVisible();
  // The footer button, not the dialog's corner close icon (which only has an aria-label).
  await form.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: 'Close' }).click();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
});

test('the tracking snippet records a real browser visit and event', async ({ page, browser }) => {
  let snippet = '';
  let website: Website;
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!DOCTYPE html><html><head><title>OVELIO Tracker QA</title>' + snippet
      + '</head><body><h1>Tracker QA</h1><button data-umami-event="signup-confirmed">Confirm signup</button></body></html>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Tracker test site did not bind a port.');
    await page.goto('/analytics/website');
    await page.getByRole('button', { name: 'Add website', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Website name').fill('Tracker QA ' + Date.now().toString(36));
    await dialog.getByLabel('Website domain').fill('localhost:' + address.port);
    const created = page.waitForResponse(response => response.url().endsWith('/api/console/websites') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Add website', exact: true }).click();
    const result = await created;
    expect(result.ok()).toBe(true);
    website = await result.json();

    await page.getByRole('button', { name: 'Tracking code', exact: true }).click();
    const code = page.getByRole('dialog').locator('pre');
    await expect(code).toContainText(website.id);
    snippet = await code.textContent() ?? '';
    expect(snippet).toContain(environment.origin + '/script.js');

    const guest = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    });
    try {
      const visitor = await guest.newPage();
      const visit = visitor.waitForResponse(response => response.url() === environment.origin + '/api/send' && response.request().method() === 'POST');
      await visitor.goto('http://localhost:' + address.port + '/qa-conversion');
      expect((await visit).ok()).toBe(true);
      const event = visitor.waitForResponse(response => response.url() === environment.origin + '/api/send' && response.request().method() === 'POST');
      await visitor.getByRole('button', { name: 'Confirm signup' }).click();
      expect((await event).ok()).toBe(true);
    } finally {
      await guest.close();
    }

    const api = (suffix: string) => environment.origin + '/api/console/websites/' + website.id + suffix;
    const window = () => 'startAt=' + (Date.now() - 86400000) + '&endAt=' + Date.now();
    await expect.poll(async () => {
      const report = await page.request.get(api('/report?' + window()));
      if (!report.ok()) return false;
      const data = await report.json() as WebsiteReport;
      return (data.current?.pageviews ?? 0) > 0 &&
        Boolean(data.dimensions.event?.some(entry => entry.label === 'signup-confirmed' && entry.value > 0));
    }, { timeout: 20000 }).toBe(true);

    const goal = await page.request.post(api('/goals'), {
      headers: { origin: environment.origin },
      data: { name: 'Confirmed Signup', type: 'event', value: 'signup-confirmed' },
    });
    expect(goal.ok()).toBe(true);
    const { id } = await goal.json() as Goal;
    const conversions = await page.request.get(api('/goals/' + id + '?' + window()));
    expect(conversions.ok()).toBe(true);
    expect((await conversions.json() as GoalStats).unique).toBeGreaterThan(0);
    const overview = await page.request.get(environment.origin + '/api/console/overview');
    expect(overview.ok()).toBe(true);
    const dashboard = await overview.json() as Dashboard;
    if (dashboard.websiteName === website.name) {
      expect(dashboard.visitors).toBeGreaterThan(0);
      expect(dashboard.conversions).toBeGreaterThan(0);
    }
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/analytics-receipt.json', JSON.stringify({ website, goalId: id }), { mode: 0o600 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('deep-linked workspace tools, command palette, and dark theme render cleanly', async ({ page }) => {
  const failures: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') failures.push(`console: ${msg.text()}`); });
  page.on('pageerror', err => failures.push(`pageerror: ${err.message}`));
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('favicon')) failures.push(`HTTP ${res.status()} ${res.url()}`);
  });

  // Exercise global CommandPalette shortcut
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search records, pages and actions' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Links from before OVELIO 2.0 redirect to each section's new home. A null heading is a page a lane rebuilt.
  const routes: Array<[string, string, string | null]> = [
    ['/audience?tab=Segments', '/crm/segments', 'Segments'],
    ['/audience?tab=Lead+scoring', '/crm/scoring', 'Lead scoring'],
    ['/audience?tab=Custom+fields', '/crm/fields', 'Custom fields'],
    ['/audience?tab=Suppressions', '/crm/consent', 'Consent & suppressions'],
    ['/campaigns?tab=Templates', '/marketing/templates', null],
    ['/campaigns?tab=Media', '/marketing/media', null],
    ['/automations?tab=Lead+forms', '/sites/classic-forms', 'Classic forms'],
    ['/automations?tab=Assets', '/sites/assets', 'Downloads'],
    ['/automations?tab=Landing+pages', '/sites/classic-pages', 'Classic pages'],
    ['/automations?tab=Dynamic+content', '/sites/dynamic-content', 'Dynamic content'],
    ['/automations?tab=Popups+%26+bars', '/sites/popups', 'Popups & bars'],
    ['/automations?tab=Categories', '/automations/categories', 'Categories'],
    ['/analytics?tab=Realtime', '/analytics/website', 'Website analytics'],
    ['/analytics?tab=Sessions', '/analytics/website', 'Website analytics'],
    ['/analytics?tab=Goals+%26+Funnels', '/analytics/website', 'Website analytics'],
    ['/analytics?tab=Insights', '/analytics/website', 'Website analytics'],
    ['/analytics?tab=Links+%26+Pixels', '/analytics/website', 'Website analytics'],
    ['/analytics?tab=Marketing+reports', '/analytics/website', 'Website analytics'],
    ['/settings?view=team', '/settings/team', 'Team'],
    ['/settings?view=connections', '/settings/connections', 'Connections'],
    ['/settings?view=data+%26+privacy', '/settings/privacy', 'Data & privacy'],
  ];
  for (const [route, path, heading] of routes) {
    await page.goto(route, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(heading
      ? page.getByRole('heading', { name: heading, level: 1, exact: true })
      : page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }

  // Toggle dark mode and back to light mode
  await page.getByRole('button', { name: /Use dark theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /Use light theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  expect(failures).toEqual([]);
});
