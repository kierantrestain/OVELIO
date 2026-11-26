import { anonymous, expect, horizontalOverflow, isPreviewRun, json, test, unique } from './fixtures';

// Wave two independent acceptance (Intelligence & Quality): the connected revenue journey and outcome-based
// experiments, driven through the browser. Runs in the 'journeys' project because it creates records.
test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

type Quote = { id: string; status: string; publicUrl: string | null; totals: { total: number }; invoices: { id: string; kind: string; total: number; status: string }[] };

test('IQ-20 revenue: line items → proposal → client signs on a phone → deposit invoice → payment → revenue states', async ({ page, browser, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const id = unique();
  const deal = await json<{ id: string }>(await page.request.post('/api/console/sales/deals', { headers: { origin }, data: { name: `IQ revenue ${id}`, amount: 0 } }));

  await page.goto(`/sales/deals/${deal.id}`);
  await expect(page.getByRole('heading', { name: 'Products & proposals' })).toBeVisible();
  await page.getByRole('button', { name: 'Custom line' }).click();
  await page.getByLabel('Item').last().fill('Implementation package');
  await page.getByLabel(/^Price \(/).last().fill('2000');
  await page.getByLabel('Tax %').last().fill('20');
  await page.getByRole('button', { name: 'Custom line' }).click();
  await page.getByLabel('Item').last().fill('Support plan');
  await page.getByLabel(/^Price \(/).last().fill('300');
  await page.getByLabel('Tax %').last().fill('20');
  await page.getByRole('combobox', { name: 'Billing', exact: true }).or(page.getByRole('button', { name: /^Billing / })).last().click();
  await page.getByRole('option', { name: 'Monthly' }).click();
  await page.getByRole('button', { name: 'Save line items' }).click();
  await expect(page.getByText('Line items saved; deal value updated.').first()).toBeVisible();
  await expect(page.getByText('£2,300', { exact: false }).first(), 'deal value follows the lines').toBeVisible();

  await page.getByRole('button', { name: 'Create proposal' }).click();
  await page.waitForURL(/\/sales\/proposals\/[0-9a-f-]{36}$/);
  const quoteId = page.url().split('/').pop()!;
  await page.getByLabel('Due on acceptance (%)').fill('50');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Send proposal' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create link' }).click();
  const link = await page.getByLabel('Client link').inputValue();
  expect(link).toMatch(/\/proposal\/[A-Za-z0-9_-]{32}$/);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const client = await phone.newPage();
  await client.goto(new URL(link).pathname);
  await expect(client.getByRole('heading', { name: 'Accept and sign' })).toBeVisible();
  expect(await horizontalOverflow(client), 'the proposal fits a phone').toEqual([]);
  await client.getByLabel('Full name').fill('Iris Quinn');
  await client.getByLabel('Email').fill(`iq.signer.${id}@example.test`);
  await client.getByRole('checkbox').check();
  await client.getByRole('button', { name: /Accept proposal/ }).click();
  await expect(client.getByText('Accepted. Thank you!')).toBeVisible();
  await client.getByRole('link', { name: /View and pay invoice/ }).click();
  await expect(client.getByText('Balance due')).toBeVisible();
  await phone.close();

  const accepted = await json<Quote>(await page.request.get(`/api/console/revenue/quotes/${quoteId}`));
  expect(accepted.status).toBe('accepted');
  expect(accepted.totals.total).toBe(2760);
  expect(accepted.invoices.map(invoice => [invoice.kind, invoice.total])).toEqual([['deposit', 1380]]);
  const dealAfter = await json<{ deal: { status: string } }>(await page.request.get(`/api/console/sales/deals/${deal.id}`));
  expect(dealAfter.deal.status, 'acceptance closes the deal as won').toBe('won');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Signature record' })).toBeVisible();
  await expect(page.getByText('Iris Quinn').first()).toBeVisible();
  await page.goto(`/sales/invoices?invoice=${accepted.invoices[0].id}`);
  await page.getByRole('button', { name: 'Record a payment' }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.').first()).toBeVisible();
  const paid = await json<{ status: string; amountPaid: number }>(await page.request.get(`/api/console/revenue/invoices/${accepted.invoices[0].id}`));
  expect([paid.status, paid.amountPaid]).toEqual(['paid', 1380]);

  await page.goto('/sales/revenue');
  await expect(page.getByText('Recurring (MRR)').first()).toBeVisible();
  await expect(page.getByText('Card payments are not connected')).toBeVisible();
  expect(guard.problems()).toEqual([]);
});

anonymous('IQ-21 public proposal links: an unknown or malformed token shows a not-found page, never another proposal', async ({ page }) => {
  for (const path of ['/proposal/' + 'A'.repeat(32), '/proposal/short', '/pay/' + 'B'.repeat(32)]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});

test('IQ-22 experiments: a workflow A/B split reports Collecting with the reason until both paths have enough contacts', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const flow = await json<{ id: string }>(await page.request.post('/api/console/journeys/flows', { headers: { origin }, data: {
    name: `IQ split ${unique()}`,
    graph: { nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      { id: 'ab', type: 'split', position: { x: 0, y: 140 }, config: { percentA: 50, metric: 'conversion', windowDays: 7 } },
    ], edges: [{ id: 'e1', source: 'start', target: 'ab', sourceHandle: 'next' }] },
  } }));
  await page.goto(`/automations/flows/${flow.id}`);
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(page.getByText('Collecting', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/each path needs at least 100 contacts/)).toBeVisible();
  await expect(page.getByText(/Converted within 7 days of the split/)).toBeVisible();
  expect(guard.problems()).toEqual([]);
});
