import { expect, isPreviewRun, settle, test } from './fixtures';

test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

test('UX-03 Ctrl+K opens the command palette, finds a page and Escape closes it', async ({ page, guard }) => {
  await page.goto('/overview');
  await settle(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search records, pages and actions' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('companies');
  await expect(palette.getByRole('option', { name: /Companies/ }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  expect(guard.problems()).toEqual([]);
});

test('UX-04 the Create menu opens and is navigable from the keyboard', async ({ page, guard }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The Create menu lives in the desktop top bar.');
  await page.goto('/overview');
  await settle(page);
  // Tab from the top of the page until the Create button has focus.
  const create = page.getByRole('button', { name: 'Create', exact: true });
  await expect(create).toBeVisible();
  let reached = false;
  for (let step = 0; step < 40 && !reached; step++) {
    await page.keyboard.press('Tab');
    reached = await create.evaluate(element => element === document.activeElement);
  }
  expect(reached, 'Create is reachable with Tab').toBe(true);
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Contact' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('menuitem');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(create).toBeFocused();
  expect(guard.problems()).toEqual([]);
});

test('UX-05 skip link and landmarks', async ({ page, guard }) => {
  await page.goto('/overview');
  await settle(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /skip to (main )?content/i });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('main, [role="main"]')))).toBe(true);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('banner')).toHaveCount(1);
  expect(await page.getByRole('navigation').count()).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(guard.problems()).toEqual([]);
});
