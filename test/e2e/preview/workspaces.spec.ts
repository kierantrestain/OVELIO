import { workspaces } from '../../../src/components/nav';
import { anonymous, evidence, expect, horizontalOverflow, isPreviewRun, settle, test, unnamedControls } from './fixtures';
import type { Guard } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

// Every workspace route in the navigation, at 1440×900 (desktop project) and 390×844 (mobile project).
const routes = [...new Set(workspaces.flatMap(space => [space.href, ...space.items.map(item => item.href)]))];

test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

async function audit(page: Page, guard: Guard, testInfo: TestInfo, route: string) {
  const problems = {
    errors: guard.problems(),
    overflow: await horizontalOverflow(page),
    unnamed: await unnamedControls(page),
  };
  await evidence(page, testInfo, route);
  expect.soft(problems.errors, `${route}: page errors, console errors or console API 5xx`).toEqual([]);
  expect.soft(problems.overflow, `${route}: horizontal page overflow`).toEqual([]);
  expect.soft(problems.unnamed, `${route}: visible controls without an accessible name`).toEqual([]);
}

for (const route of routes) {
  test(`UX-01 ${route} renders without errors, overflow or unnamed controls`, async ({ page, guard }, testInfo) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await settle(page);
    if (await page.getByText('Not built yet', { exact: true }).isVisible()) {
      const owner = (await page.getByText(/^Owned by /).first().textContent().catch(() => null))?.trim() ?? 'another lane';
      testInfo.annotations.push({ type: 'pending', description: `lane placeholder (${owner})` });
      await evidence(page, testInfo, route);
      return;
    }
    await audit(page, guard, testInfo, route);
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
