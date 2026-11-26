import { workspaces } from '../../../src/components/nav';
import {
  anonymous, clippedControls, evidence, expect, horizontalOverflow, isPreviewRun, json, settle, test, unnamedControls,
} from './fixtures';
import type { Guard } from './fixtures';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

// Every workspace route in the navigation, at 1440×900 (desktop project) and 390×844 (mobile project).
const routes = [...new Set(workspaces.flatMap(space => [space.href, ...space.items.map(item => item.href)]))];

type Items<T> = { items: T[] };
type Id = { id: string };

// Detail pages and studios, resolved from the preview's seeded records.
const details: { name: string; studio?: boolean; resolve: (api: APIRequestContext) => Promise<string> }[] = [
  { name: 'deal', resolve: async api => '/sales/deals/' + (await json<Items<Id>>(await api.get('/api/console/sales/deals'))).items[0].id },
  { name: 'contact', resolve: async api => '/crm/contacts/' + (await json<{ id: number }[]>(await api.get('/api/console/crm/lookup/contacts')))[0].id },
  { name: 'campaign', resolve: async api => '/marketing/campaigns/' + (await json<Items<Id>>(await api.get('/api/console/journeys/campaigns'))).items[0].id },
  { name: 'flow', resolve: async api => '/automations/flows/' + (await json<Items<Id>>(await api.get('/api/console/journeys/flows'))).items[0].id },
  { name: 'email studio', studio: true, resolve: async api => '/studio/email/' + (await json<Items<Id>>(await api.get('/api/console/studio/designs?kind=email'))).items[0].id },
  { name: 'page studio', studio: true, resolve: async api => '/studio/page/' + (await json<Items<Id>>(await api.get('/api/console/sites/pages'))).items[0].id },
  {
    name: 'published page',
    resolve: async api => (await json<Items<{ url: string; status: string }>>(await api.get('/api/console/sites/pages?status=published'))).items[0].url,
  },
];

test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

async function audit(page: Page, guard: Guard, testInfo: TestInfo, route: string, file = route) {
  const problems = {
    errors: guard.problems(),
    overflow: [...await horizontalOverflow(page), ...await clippedControls(page)],
    unnamed: await unnamedControls(page),
  };
  await evidence(page, testInfo, file);
  expect.soft(problems.errors, `${route}: page errors, console errors or console API 5xx`).toEqual([]);
  expect.soft(problems.overflow, `${route}: horizontal overflow or clipped controls`).toEqual([]);
  expect.soft(problems.unnamed, `${route}: visible controls without an accessible name`).toEqual([]);
}

for (const route of routes) {
  test(`UX-01 ${route} renders without errors, overflow or unnamed controls`, async ({ page, guard }, testInfo) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await settle(page);
    if (await page.getByText('Not built yet', { exact: true }).isVisible()) {
      const owner = (await page.getByText(/^Owned by /).first().textContent().catch(() => null))?.trim().replace(/\.$/, '') ?? 'another lane';
      testInfo.annotations.push({ type: 'pending', description: `lane placeholder (${owner})` });
      await evidence(page, testInfo, route);
      return;
    }
    await audit(page, guard, testInfo, route);
  });
}

for (const detail of details) {
  test(`UX-01 ${detail.name} detail renders without errors, overflow or unnamed controls`, async ({ page, guard }, testInfo) => {
    const route = await detail.resolve(page.request);
    await page.goto(route);
    // Full-screen studios have no page title; their canvas is a labelled main region instead.
    await expect(detail.studio ? page.locator('main[aria-label]') : page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await settle(page);
    await audit(page, guard, testInfo, route, detail.name);
  });
}

anonymous.describe('signed out', () => {
  anonymous.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

  anonymous('UX-02 /login renders the sign-in form cleanly', async ({ page, guard }, testInfo) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in as test developer' })).toBeVisible();
    await settle(page);
    await audit(page, guard, testInfo, '/login');
  });

  anonymous('UX-02 developer sign-in from /login lands on Overview', async ({ page, guard }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in as test developer' }).click();
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(guard.problems()).toEqual([]);
  });
});
