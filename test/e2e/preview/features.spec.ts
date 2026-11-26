import { expect, horizontalOverflow, isPreviewRun, json, settle, test, unique } from './fixtures';

// Wave one workspace features (Product Engineering). Runs in the 'journeys' project, after the evidence sweep.
test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

const dev = '00000000-0000-4000-8000-000000000001';

test('UX-20 a compact environment badge replaces the preview banner and explains itself', async ({ page, guard }) => {
  await page.goto('/crm');
  await settle(page);
  await expect(page.getByText('Every record here is demonstration data')).toHaveCount(0);
  const badge = page.getByRole('button', { name: /Preview environment with sample data/ });
  await expect(badge).toBeVisible();
  await badge.focus();
  await page.keyboard.press('Enter');
  const about = page.getByRole('dialog', { name: 'About this environment' });
  await expect(about).toContainText('embedded database');
  await expect(about).toContainText('resets when the preview restarts');
  await page.keyboard.press('Escape');
  expect(guard.problems()).toEqual([]);
});

test('UX-21 a won deal notifies its owner through the bell, and Mark all read clears the count', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  type Pipeline = { isDefault: boolean; id: string; stages: { id: string; outcome: string }[] };
  const pipeline = (await json<{ items: Pipeline[] }>(await page.request.get('/api/console/sales/pipelines'))).items.find(item => item.isDefault)!;
  const name = 'UX bell ' + unique();
  const deal = await json<{ id: string }>(await page.request.post('/api/console/sales/deals', { headers: { origin }, data: { name, amount: 900, pipelineId: pipeline.id, ownerId: dev } }));
  const won = pipeline.stages.find(stage => stage.outcome === 'won')!;
  await json(await page.request.post(`/api/console/sales/deals/${deal.id}/move`, { headers: { origin }, data: { stageId: won.id } }));

  await page.goto('/sales/tasks');
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole('link', { name: `Deal won: ${name}` })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  expect(guard.problems()).toEqual([]);
  await page.request.post(`/api/console/sales/deals/${deal.id}/archive`, { headers: { origin }, data: {} });
});

test('UX-22 a starred deal is offered in search before typing, and recents follow record pages', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const deal = (await json<{ items: { id: string; name: string }[] }>(await page.request.get('/api/console/sales/deals'))).items[0];
  await page.goto('/sales/deals/' + deal.id);
  await settle(page);
  await page.getByRole('button', { name: 'Star this deal' }).click();
  await expect(page.getByRole('button', { name: 'Remove this deal from starred' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search records, pages and actions' });
  await expect(palette.getByRole('option', { name: new RegExp(deal.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  const marks = await json<{ starred: { recordId: string }[]; recent: { recordId: string }[] }>(await page.request.get('/api/console/platform/marks'));
  expect(marks.starred.some(item => item.recordId === deal.id)).toBe(true);
  expect(marks.recent.some(item => item.recordId === deal.id)).toBe(true);
  await page.goto('/overview');
  await expect(page.locator('[data-widget="starred"]')).toContainText(deal.name);
  expect(guard.problems()).toEqual([]);
  await page.request.delete(`/api/console/platform/marks/star/deal/${deal.id}`, { headers: { origin } });
});

test('UX-23 a hidden Overview widget stays hidden after reload, and presets apply', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
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
  await expect(page.locator('[data-widget="kpis"]')).toBeVisible();
  await expect(page.locator('[data-widget="website"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Customise' }).click();
  const applied = page.waitForResponse(response => response.url().endsWith('/api/console/platform/preferences') && response.request().method() === 'PATCH');
  await page.getByRole('dialog', { name: 'Customise Overview' }).getByRole('button', { name: 'Sales', exact: true }).click();
  expect((await applied).ok()).toBe(true);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-widget="tasks"]')).toBeVisible();
  await expect(page.locator('[data-widget="campaigns"]')).toHaveCount(0);
  expect(guard.problems()).toEqual([]);
  await page.request.patch('/api/console/platform/preferences', { headers: { origin }, data: { overview: null } });
});

test('UX-24 compact table density persists and stays readable at 390 px', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  await page.goto('/crm');
  await settle(page);
  await page.getByRole('button', { name: /display settings$/ }).click();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/console/platform/preferences') && response.request().method() === 'PATCH');
  await page.getByRole('menuitem', { name: 'Compact' }).click();
  expect((await saved).ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await settle(page);
  await expect(page.locator('[data-ov-density="compact"]')).toHaveCount(1);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(guard.problems()).toEqual([]);
  await page.request.patch('/api/console/platform/preferences', { headers: { origin }, data: { density: 'comfortable' } });
});
