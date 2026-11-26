import { createHmac } from 'node:crypto';
import type { BookingType, CalendarOverview } from '../../../src/contracts/calendar';
import type { ContactProfile, InboxThread, InboxThreadSummary } from '../../../src/contracts/crm';
import type { FlowDetail, InboundHook } from '../../../src/contracts/journeys';
import type { InboxTeam } from '../../../src/contracts/mailbox-team';
import type { PageDesign } from '../../../src/contracts/sites';
import { anonymous, evidence, expect, horizontalOverflow, isPreviewRun, json, test, unique } from './fixtures';

// Wave two independent acceptance (Intelligence & Quality): the connected revenue journey and outcome-based
// experiments, driven through the browser. Runs in the 'journeys' project because it creates records.
test.skip(!isPreviewRun, 'Preview harness only: npm run build && npm run test:e2e:preview');

type Quote = { id: string; status: string; publicUrl: string | null; totals: { total: number }; invoices: { id: string; kind: string; total: number; status: string }[] };

test('IQ-26 inbox reading, saved replies and team handling fit on desktop and mobile', async ({ page, baseURL, guard }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const mailboxId = '4a20b788-a9c1-452b-a615-b9a513abcdf1';
  const summary: InboxThreadSummary = {
    mailboxId, threadId: 'preview-thread', mailboxEmail: 'sales@example.test', id: 'sample-message', subject: 'Website discovery call',
    snippet: 'Could we meet next Tuesday?', direction: 'inbound', contactId: 1, fromEmail: 'casey@example.test',
    toEmails: 'sales@example.test', at: new Date().toISOString(), count: 1, unread: true, status: 'open', assigneeName: null,
  };
  const snapshot: InboxThread = { mailboxId, threadId: summary.threadId, readVersion: '42', unread: true, canReply: true, messages: [summary] };
  const team: InboxTeam = { status: 'open', assignee: null, canAssign: true, canChangeStatus: true, assignmentOptions: [], notes: [] };
  let bodyRequests = 0;
  let fileRequests = 0;
  await page.route(/\/api\/console\/sales\/inbox\/threads(?:\?|$)/, route => route.fulfill({ json: [summary] }));
  await page.route(/\/api\/console\/sales\/inbox\/thread\?/, route => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: snapshot });
    expect(route.request().postDataJSON()).toEqual({ read: true, through: '42' });
    snapshot.unread = summary.unread = false;
    return route.fulfill({ json: { unread: false } });
  });
  await page.route(/\/api\/console\/sales\/inbox\/message\?/, route => {
    bodyRequests += 1;
    return route.fulfill({ json: {
      body: 'Could we meet next Tuesday?\n\nI’ve attached the brief for the discovery call.',
      attachments: [{ id: 'brief', name: 'Discovery brief.pdf', size: 1424, downloadable: true }],
    } });
  });
  await page.route(/\/api\/console\/sales\/inbox\/attachment\?/, route => {
    fileRequests += 1;
    expect(new URL(route.request().url()).searchParams.get('attachmentId')).toBe('brief');
    return route.fulfill({
      body: 'Synthetic discovery brief', contentType: 'application/octet-stream',
      headers: { 'content-disposition': 'attachment; filename="Discovery brief.pdf"' },
    });
  });
  await page.route(/\/api\/console\/sales\/inbox\/team\?/, route => {
    if (route.request().method() === 'PATCH') team.status = summary.status = route.request().postDataJSON().status;
    return route.fulfill({ json: team });
  });
  await page.route(/\/api\/console\/sales\/inbox\/notes\?/, route => {
    team.notes.push({ id: 'team-note', authorName: 'Developer Test', body: route.request().postDataJSON().body, createdAt: summary.at });
    return route.fulfill({ status: 201, json: team.notes[0] });
  });
  await page.route(/\/api\/console\/sales\/inbox\/response-report\?/, route => route.fulfill({ json: {
    from: new Date(Date.now() - 30 * 86_400_000).toISOString(), through: summary.at, conversations: 24, replied: 17,
    awaitingFirstReply: 5, resolvedWithoutReply: 2, averageSeconds: 5820, medianSeconds: 2700, sampleLimited: false, messageLimit: 5000,
  } }));

  await page.goto('/sales/inbox');
  await page.getByRole('button', { name: /Open conversation Website discovery call/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Conversation' });
  await expect(drawer.getByText(summary.subject)).toBeVisible();
  expect(bodyRequests).toBe(0);
  await drawer.getByRole('button', { name: 'View full message from casey@example.test' }).click();
  await expect(drawer.getByText(/attached the brief/)).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Download Discovery brief.pdf' })).toHaveAttribute('href', /attachmentId=brief/);
  await expect(drawer.locator('[role="progressbar"]')).toHaveCount(0);
  await evidence(page, testInfo, '/sales/inbox-team-desktop');
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: /Open conversation Website discovery call/ }).click();
  await drawer.getByRole('button', { name: 'View full message from casey@example.test' }).click();
  await expect(drawer.getByText(/attached the brief/)).toBeVisible();
  await expect(drawer.locator('[role="progressbar"]')).toHaveCount(0);
  await expect.poll(() => horizontalOverflow(page)).toEqual([]);
  expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await evidence(page, testInfo, '/sales/inbox-team-mobile');
  expect(fileRequests).toBe(0);
  const download = page.waitForEvent('download');
  await drawer.getByRole('link', { name: 'Download Discovery brief.pdf' }).click();
  expect((await download).suggestedFilename()).toBe('Discovery brief.pdf');
  expect(fileRequests).toBe(1);
  await drawer.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();

  await drawer.getByRole('button', { name: 'New saved reply' }).click();
  const editor = page.getByRole('dialog', { name: 'New saved reply' });
  await editor.getByLabel('Reply name').fill('Discovery follow-up ' + unique());
  await editor.getByLabel('Reply text').fill('Yes, let’s schedule a call.');
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/sales/inbox/saved-replies'));
  await editor.getByRole('button', { name: 'Save reply' }).click();
  const reply = await (await saved).json() as { id: string };
  await drawer.getByRole('button', { name: 'Insert reply' }).click();
  await expect(drawer.getByLabel('Reply', { exact: true })).toHaveValue('Yes, let’s schedule a call.');
  expect((await page.request.delete('/api/console/sales/inbox/saved-replies/' + reply.id, { headers: { origin } })).status()).toBe(204);

  await drawer.getByLabel('Internal note').fill('Confirm the scope with the delivery team.');
  await drawer.getByRole('button', { name: 'Add note' }).click();
  await expect(drawer.getByText('Confirm the scope with the delivery team.')).toBeVisible();
  const status = drawer.getByRole('combobox', { name: 'Conversation status' })
    .or(drawer.getByRole('button', { name: /Conversation status/ }));
  await status.click();
  await page.getByRole('option', { name: 'Pending' }).click();
  await expect(status).toHaveText(/Pending/);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await page.reload();
  await page.getByText('Response', { exact: true }).click();
  await expect(page.getByText('Median first reply')).toBeVisible();
  await evidence(page, testInfo, '/sales/inbox-response-mobile');
  expect(guard.problems()).toEqual([]);
});

test('JRN-14 version history rolls back the active workflow and preserves the draft', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const graph = (delta: number) => ({
    nodes: [{ id: 'start', type: 'start', config: {}, position: { x: 0, y: 0 } },
      { id: 'score', type: 'adjust_score', config: { delta }, position: { x: 0, y: 160 } }],
    edges: [{ id: 'next', source: 'start', target: 'score', sourceHandle: 'next' }],
  });
  const api = page.request;
  const created = await json<FlowDetail>(await api.post('/api/console/journeys/flows', { headers: { origin }, data: {
    name: 'Rollback browser ' + unique(), graph: graph(1),
  } }));
  const path = '/api/console/journeys/flows/' + created.id;
  await json(await api.post(path + '/publish', { headers: { origin } }));
  await json(await api.patch(path, { headers: { origin }, data: { graph: graph(2) } }));
  await json(await api.post(path + '/publish', { headers: { origin } }));
  await json(await api.patch(path, { headers: { origin }, data: { graph: graph(3) } }));
  await page.goto('/automations/flows/' + created.id);
  await page.getByRole('navigation', { name: 'Workflow view' }).getByRole('button', { name: /^Versions/ }).click();
  await page.getByRole('row').filter({ hasText: 'Version 1' }).getByRole('button', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Roll back to this version' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Roll back workflow' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Version 3' })).toContainText('Live');
  const draft = await json<FlowDetail>(await api.get(path));
  const live = await json<{ graph: unknown }>(await api.get(path + '/versions/3'));
  expect(draft.graph).toEqual(graph(3));
  expect(live.graph).toEqual(graph(1));
  expect(guard.problems()).toEqual([]);
  await json(await api.post(path + '/archive', { headers: { origin } }));
});

test('SIT-18 insert and publish a booking button that opens the native scheduler on a phone', async ({ page, browser, baseURL, guard }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const marker = unique();
  const bookingName = `Page consultation ${marker}`;
  const bookingSlug = `page-consultation-${marker}`;
  const landingSlug = `booking-button-${marker}`;
  const calendar = await json<CalendarOverview>(await page.request.get('/api/console/calendar'));
  const hostId = calendar.hosts[0].id;
  let bookingType: BookingType | undefined;
  try {
    await json(await page.request.patch('/api/console/calendar/availability', { headers: { origin }, data: {
      timeZone: 'Europe/London', windows: [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' })),
    } }));
    bookingType = await json<BookingType>(await page.request.post('/api/console/calendar/types', { headers: { origin }, data: {
      hostIds: [hostId], name: bookingName, slug: bookingSlug, active: true, bufferMinutes: 0, durationMinutes: 30,
    } }));
    const landing = await json<{ id: string }>(await page.request.post('/api/console/sites/pages', { headers: { origin }, data: {
      name: 'Book a consultation', slug: landingSlug, templateKey: 'blank',
    } }));
    const designPath = `/api/console/sites/pages/${landing.id}/design`;
    const design = await json<PageDesign>(await page.request.get(designPath));
    await json(await page.request.patch(designPath, { headers: { origin }, data: {
      version: design.version, document: design.document, css: design.css,
      html: design.html.replace('Your headline', 'Book a consultation')
        .replace('Drag sections from the left panel to build your page.', 'Bring your questions to a 30-minute call. We’ll talk through your goals and agree the next step.'),
    } }));

    const studio = `/studio/page/${landing.id}`;
    const label = 'Choose a consultation time';
    await page.goto(studio);
    const addBooking = page.getByRole('button', { name: 'Add booking button' });
    await expect(addBooking).toBeEnabled();
    await addBooking.press('Enter');
    const select = page.getByRole('combobox', { name: 'Booking type' })
      .or(page.getByRole('button', { name: /^Booking type(?: Choose a booking type)?$/ }));
    await select.click();
    await page.getByRole('option', { name: bookingName }).click();
    await page.getByLabel('Button text').fill(label);
    const canvasBooking = page.frameLocator('iframe.gjs-frame').locator('a[data-ovelio-booking]');
    await expect(canvasBooking).toHaveText(label);
    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 20_000 });
    await evidence(page, testInfo, '/studio/booking-button');
    await page.reload();
    await expect(canvasBooking).toHaveText(label);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const publish = page.getByRole('dialog', { name: 'Publish and settings' });
    await publish.getByRole('button', { name: 'Publish now' }).click();
    await expect(publish.getByText(/Published\. Live at/)).toBeVisible({ timeout: 20_000 });
    expect(guard.problems()).toEqual([]);

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const visitor = await phone.newPage();
      await visitor.goto(`${origin}/s/${landingSlug}`);
      const link = visitor.getByRole('link', { name: label });
      await expect(link).toHaveAttribute('href', `/book/${bookingSlug}`);
      expect(await horizontalOverflow(visitor)).toEqual([]);
      await evidence(visitor, testInfo, '/s/booking-button-mobile');
      await link.click();
      await expect(visitor).toHaveURL(`${origin}/book/${bookingSlug}`);
      await expect(visitor.getByRole('heading', { name: bookingName })).toBeVisible();
      await expect(visitor.getByRole('button', { name: 'Confirm booking' })).toBeVisible();
    } finally {
      await phone.close();
    }
  } finally {
    await json(await page.request.patch('/api/console/calendar/availability', { headers: { origin }, data: calendar.availability }));
    if (bookingType) {
      await json(await page.request.patch('/api/console/calendar/types/' + bookingType.id, {
        headers: { origin }, data: { ...bookingType, active: false },
      }));
    }
  }
});

test('IQ-24 public booking on a phone links to CRM and starts an appointment workflow', async ({ page, browser, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const id = unique();
  const slug = `discovery-${id}`;
  const name = 'Sample discovery call';
  const email = `calendar.${id}@example.test`;
  await page.goto('/sales/calendar');
  await page.getByRole('button', { name: 'Use weekday hours' }).click();
  await page.getByRole('button', { name: 'Save availability' }).click();
  await expect(page.getByText('Availability saved.').first()).toBeVisible();
  await page.getByRole('button', { name: 'New booking type' }).click();
  await page.getByLabel('Booking name').fill(name);
  await page.getByLabel('Booking address').fill(slug);
  await page.getByRole('button', { name: 'Save booking type' }).click();
  await expect(page.getByRole('link', { name: 'Open booking page' })).toHaveAttribute('href', `/book/${slug}`);
  expect(await horizontalOverflow(page)).toEqual([]);
  await evidence(page, testInfo, '/sales/calendar-desktop');

  const flow = await json<FlowDetail>(await page.request.post('/api/console/journeys/flows', { headers: { origin }, data: {
    name: `New appointment workflow ${id}`,
    triggers: [{ id: 'booked', type: 'appointment.booked', filters: {} }],
    graph: {
      nodes: [{ id: 'start', type: 'start', config: {}, position: { x: 0, y: 0 } },
        { id: 'finish', type: 'exit', config: {}, position: { x: 0, y: 160 } }],
      edges: [{ id: 'next', source: 'start', target: 'finish', sourceHandle: 'next' }],
    },
  } }));
  await json(await page.request.post(`/api/console/journeys/flows/${flow.id}/publish`, { headers: { origin } }));

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const client = await phone.newPage();
    await client.goto(`${origin}/book/${slug}`);
    await expect(client.getByRole('heading', { name })).toBeVisible();
    const time = client.getByRole('combobox', { name: 'Time', exact: true })
      .or(client.getByRole('button', { name: /^Time(?: Choose a time)?$/ }));
    await time.click();
    await client.getByRole('option').first().click();
    await client.getByLabel('First name').fill('Casey');
    await client.getByLabel('Last name').fill('Sample');
    await client.getByLabel('Email').fill(email, { timeout: 10_000 });
    expect(await horizontalOverflow(client)).toEqual([]);
    await evidence(client, testInfo, '/book/mobile');
    await client.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(client.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
    const calendar = await json<CalendarOverview>(await page.request.get('/api/console/calendar'));
    const appointment = calendar.meetings.find(item => item.guestEmail === email);
    expect(appointment?.status).toBe('booked');
    const profile = await json<ContactProfile>(await page.request.get(`/api/console/crm/contacts/${appointment!.contactId}/profile`));
    expect(profile.events.some(event => event.type === 'appointment.booked' && event.entityId === appointment?.id)).toBe(true);
    await expect.poll(async () => (await json<FlowDetail>(await page.request.get(`/api/console/journeys/flows/${flow.id}`))).counts.enrolled).toBe(1);

    const deal = await json<{ id: string }>(await page.request.post('/api/console/sales/deals', { headers: { origin },
      data: { name: `Discovery deal ${id}`, contactId: appointment!.contactId } }));
    await json(await page.request.patch(`/api/console/calendar/appointments/${appointment!.id}`, { headers: { origin }, data: { dealId: deal.id } }));
    await client.getByRole('link', { name: 'Manage your booking' }).click();
    await client.getByRole('button', { name: 'Cancel appointment' }).click();
    await client.getByRole('alertdialog').getByRole('button', { name: 'Cancel appointment' }).click({ timeout: 10_000 });
    await expect(client.getByText('Appointment cancelled.').first()).toBeVisible();
    const after = await json<CalendarOverview>(await page.request.get('/api/console/calendar'));
    expect(after.meetings.find(item => item.id === appointment?.id)).toMatchObject({ status: 'cancelled', dealId: deal.id });
  } finally {
    await phone.close();
  }
});

test('IQ-23 configure an inbound webhook, select it in a workflow and enrol a contact from a signed delivery', async ({ page, baseURL, guard }) => {
  const origin = new URL(baseURL!).origin;
  const id = unique();
  const name = `Incoming order ${id}`;
  await page.goto('/automations/webhooks');
  await page.getByRole('button', { name: 'New inbound webhook' }).click();
  await page.getByLabel('Webhook name').fill(name);
  await page.getByLabel('Email path').fill('buyer.email');
  const created = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/console/journeys/hooks');
  await page.getByRole('button', { name: 'Save webhook' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const hook = await response.json() as InboundHook;
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reveal secret' })).toBeVisible();

  const flow = await json<FlowDetail>(await page.request.post('/api/console/journeys/flows', { headers: { origin }, data: {
    name: `Order workflow ${id}`,
    triggers: [{ id: 'order', type: 'webhook.received', filters: {} }],
    graph: {
      nodes: [{ id: 'start', type: 'start', config: {}, position: { x: 0, y: 0 } },
        { id: 'finish', type: 'exit', config: {}, position: { x: 0, y: 160 } }],
      edges: [{ id: 'next', source: 'start', target: 'finish', sourceHandle: 'next' }],
    },
  } }));
  await page.goto(`/automations/flows/${flow.id}`);
  await page.locator('.ov-journeys-node').filter({ hasText: 'Any inbound webhook' }).click();
  const picker = page.getByRole('combobox', { name: 'Inbound webhook' }).or(page.getByRole('button', { name: /Inbound webhook.*Any inbound webhook/i }));
  await picker.click();
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(async () => (await json<FlowDetail>(await page.request.get(`/api/console/journeys/flows/${flow.id}`))).triggers[0]?.filters.hookId)
    .toBe(hook.id);
  await json(await page.request.post(`/api/console/journeys/flows/${flow.id}/publish`, { headers: { origin } }));
  const payload = JSON.stringify({ buyer: { email: `order.${id}@example.test` } });
  const signature = createHmac('sha256', hook.secret).update(payload).digest('hex');
  const delivery = await page.request.post(new URL(hook.url).pathname, { headers: { 'x-ovelio-signature': `sha256=${signature}` }, data: payload });
  expect(delivery.status()).toBe(202);
  await expect.poll(async () => (await json<FlowDetail>(await page.request.get(`/api/console/journeys/flows/${flow.id}`))).counts.enrolled).toBe(1);
  expect(guard.problems()).toEqual([]);
});

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
