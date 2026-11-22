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
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  for (const section of ['Campaigns', 'Automations', 'Analytics', 'Settings', 'Audience']) {
    await page.getByRole('link', { name: section, exact: true }).click();
    await expect(page.getByRole('heading', { name: section, level: 1, exact: true })).toBeVisible();
  }
  const address = 'browser-' + Date.now().toString(36) + '@example.test';
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('CSV file').setInputFiles({
    name: 'browser-contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('email,first_name,last_name\n' + address + ',Browser,Fixture\n'),
  });
  const imported = page.waitForResponse(response => response.url().endsWith('/api/console/contacts/import'));
  await form.getByRole('button', { name: 'Import contacts', exact: true }).click();
  const response = await imported;
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ imported: 1, failed: [] });
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
    await page.getByRole('link', { name: 'Analytics', exact: true }).click();
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
  await expect(page.getByRole('dialog', { name: 'Jump to section or tool' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Visit deep-linked tabs across all expanded sections
  const routes: Array<[string, string]> = [
    ['/audience?tab=Segments', 'Audience'],
    ['/audience?tab=Lead+scoring', 'Audience'],
    ['/audience?tab=Suppressions', 'Audience'],
    ['/campaigns?tab=Templates', 'Campaigns'],
    ['/campaigns?tab=Media', 'Campaigns'],
    ['/automations?tab=Lead+forms', 'Automations'],
    ['/automations?tab=Assets', 'Automations'],
    ['/automations?tab=Landing+pages', 'Automations'],
    ['/analytics?tab=Realtime', 'Analytics'],
    ['/analytics?tab=Sessions', 'Analytics'],
    ['/analytics?tab=Goals+%26+Funnels', 'Analytics'],
    ['/analytics?tab=Insights', 'Analytics'],
    ['/analytics?tab=Links+%26+Pixels', 'Analytics'],
    ['/settings?view=connections', 'Settings'],
  ];
  for (const [route, heading] of routes) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
  }

  // Toggle dark mode and back to light mode
  await page.getByRole('button', { name: /Use dark theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /Use light theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  expect(failures).toEqual([]);
});
