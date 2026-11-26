import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { BookingConfirmation, BookingType, CalendarOverview, PublicBooking } from '../../src/contracts/calendar';
import type { Deal, DealDetail, Pipeline } from '../../src/contracts/crm';
import type { PlatformEvent } from '../../src/contracts/platform';
import type { Invoice, InvoiceSummary, Quote, RevenueSettings, Subscription } from '../../src/contracts/revenue';
import type { FormDetail, FormSubmissionRow } from '../../src/contracts/sites';
import { apiClient, eventually, testEnv } from './client';
import { fixtureSql } from './database';

async function publicJson<T>(origin: string, path: string, data?: unknown, status = 200): Promise<T> {
  const response = await fetch(origin + path, data === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  const body = await response.text();
  assert.equal(response.status, status, path + ': ' + (response.status === status ? '' : body));
  return JSON.parse(body) as T;
}

test('IQ-25 one captured lead becomes a paid client and renews once per period', { timeout: 120_000 }, async t => {
  const env = testEnv();
  const admin = await apiClient(env);
  const tag = randomUUID().slice(0, 8);
  const email = 'lifecycle-lead-' + tag + '@example.test';
  const credentials = { email: 'lifecycle-seller-' + tag + '@example.test', password: 'Lifecycle fixture password ' + tag };
  await admin.get('/settings/team', 'POST', { ...credentials, name: 'Lifecycle seller', role: 'marketer' });
  const seller = await apiClient({ ...env, ...credentials });

  const form = await seller.get<FormDetail>('/sites/forms', 'POST', {
    name: 'Lifecycle capture ' + tag, status: 'published',
    fields: [
      { key: 'email', label: 'Work email', type: 'email', mapsTo: 'email', required: true },
      { key: 'first_name', label: 'First name', type: 'text', mapsTo: 'firstName', required: true },
    ],
  });
  const captured = await publicJson<{ ok: boolean; submissionId: string }>(env.origin, '/api/public/forms/' + form.id + '/submit', { email, first_name: 'Alex' });
  assert.equal(captured.ok, true);
  const submissions = await seller.get<{ items: FormSubmissionRow[] }>('/sites/forms/' + form.id + '/submissions');
  const submission = submissions.items.find(item => item.id === captured.submissionId);
  assert.ok(submission?.contactId);
  assert.equal(submission.status, 'accepted');
  assert.equal(submission.email, email);
  const contactId = submission.contactId;

  const pipeline = await seller.get<Pipeline>('/sales/pipelines', 'POST', { name: 'Lifecycle ' + tag, currency: 'GBP' });
  const qualified = pipeline.stages.find(stage => stage.name === 'Qualified');
  assert.ok(qualified);
  const deal = await seller.get<Deal>('/sales/deals', 'POST', { name: 'Lifecycle deal ' + tag, pipelineId: pipeline.id, contactId });
  const dealPath = '/sales/deals/' + deal.id;
  const moved = await seller.get<Deal>(dealPath + '/move', 'POST', { stageId: qualified.id });
  assert.equal(moved.stageId, qualified.id);
  assert.equal(moved.contactId, contactId);
  assert.equal(moved.contactEmail, email);

  await seller.get('/calendar/availability', 'PATCH', { timeZone: 'UTC',
    windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00' })),
  });
  const type = await seller.get<BookingType>('/calendar/types', 'POST', {
    name: 'Lifecycle discovery ' + tag, slug: 'lifecycle-' + tag, durationMinutes: 30, bufferMinutes: 15, hostIds: [seller.user.id], active: true,
  });
  const bookingPath = '/api/public/booking/' + type.slug;
  const { slots } = await publicJson<PublicBooking>(env.origin, bookingPath);
  assert.ok(slots[0], 'discovery appointments are available');
  const appointment = await publicJson<BookingConfirmation>(env.origin, bookingPath, {
    email, firstName: 'Alex', lastName: 'Acceptance', timeZone: 'UTC', startsAt: slots[0], requestId: randomUUID(),
  }, 201);
  const getMeeting = async () => (await seller.get<CalendarOverview>('/calendar')).meetings.find(item => item.id === appointment.id);
  const meeting = await getMeeting();
  assert.equal(meeting?.contactId, contactId, 'booking reused the form contact');
  await seller.get('/calendar/appointments/' + appointment.id, 'PATCH', { dealId: deal.id });
  const linked = await getMeeting();
  assert.equal(linked?.dealId, deal.id);
  assert.equal(linked?.status, 'booked');

  await seller.get('/revenue/deals/' + deal.id + '/lines', 'POST', { lines: [
    { name: 'Implementation', quantity: 1, unitPrice: 900 },
    { name: 'Monthly support', quantity: 1, unitPrice: 300, billing: 'monthly' },
  ] });
  const draft = await seller.get<Quote>('/revenue/quotes', 'POST', { dealId: deal.id });
  const quotePath = '/revenue/quotes/' + draft.id;
  await seller.get<Quote>(quotePath, 'PATCH', { depositPercent: 25 });
  const { quote } = await seller.get<{ quote: Quote }>(quotePath + '/send', 'POST', { email: false });
  assert.ok(quote.publicUrl);
  const proposal = new URL(new URL(quote.publicUrl).pathname, env.origin);
  assert.match(proposal.pathname, /^\/proposal\//);
  const opened = await fetch(proposal);
  assert.equal(opened.status, 200);
  assert.match(await opened.text(), /Accept and sign/);
  const sign = () => fetch(proposal, { method: 'POST', body: new URLSearchParams({
    action: 'accept', signerName: 'Alex Acceptance', signerEmail: email, agree: 'true',
  }) });
  const signed = await sign();
  assert.equal(signed.status, 200);
  assert.match(await signed.text(), /Accepted\. Thank you!/);
  assert.match(await (await sign()).text(), /already accepted/);
  const accepted = await seller.get<Quote>(quotePath);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.contactId, contactId);
  assert.equal(accepted.signerEmail, email);
  assert.match(accepted.documentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(accepted.invoices.map(invoice => [invoice.kind, invoice.status, invoice.total]), [['deposit', 'open', 300]]);
  const [deposit] = accepted.invoices;
  assert.equal(deposit.contactId, contactId);
  assert.equal(deposit.dealId, deal.id);
  const getDeal = () => seller.get<DealDetail>(dealPath);
  const won = await getDeal();
  assert.equal(won.deal.status, 'won');
  assert.ok(!won.tasks.some(task => task.source === 'onboarding:' + quote.id), 'onboarding waits for the deposit');

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  const signedFixture = secret.startsWith('whsec_ovelio_acceptance_');
  t.diagnostic(signedFixture ? 'Payment confirmation uses a signed Stripe fixture.' : 'Payment confirmation uses the local manual settlement path.');

  async function settle(invoice: InvoiceSummary) {
    const resource = '/revenue/invoices/' + invoice.id;
    if (signedFixture) {
      const intent = 'pi_test_lifecycle_' + invoice.id;
      const sendEvent = async (id: string, type: string) => {
        const body = JSON.stringify({ id, type, data: { object: {
          id: 'cs_test_lifecycle_' + invoice.id, payment_status: 'paid', amount_total: 30000, currency: 'gbp',
          payment_intent: intent, client_reference_id: invoice.id, metadata: { invoice_id: invoice.id },
        } } });
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
        const response = await fetch(env.origin + '/api/public/stripe/webhook', { method: 'POST', body,
          headers: { 'content-type': 'application/json', 'stripe-signature': 't=' + timestamp + ',v1=' + signature },
        });
        assert.equal(response.status, 200, response.ok ? '' : await response.text());
        return (await response.json() as { outcome: string }).outcome;
      };
      const eventId = 'evt_test_lifecycle_' + invoice.id;
      assert.match(await sendEvent(eventId, 'checkout.session.completed'), /^payment recorded/);
      assert.equal(await sendEvent(eventId, 'checkout.session.completed'), 'duplicate');
      assert.equal(await sendEvent(eventId + '_async', 'checkout.session.async_payment_succeeded'), 'payment already recorded');
    } else {
      await seller.get(resource + '/payments', 'POST', { amount: invoice.total, method: 'Fixture bank transfer' });
    }
    const paid = await seller.get<Invoice>(resource);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.balance, 0);
    assert.equal(paid.amountPaid, invoice.total);
    assert.deepEqual(paid.payments.map(payment => [payment.provider, payment.amount]), [[signedFixture ? 'stripe' : 'manual', invoice.total]]);
  }

  assert.ok(deposit.publicUrl);
  const payPath = new URL(deposit.publicUrl).pathname;
  assert.match(payPath, /^\/pay\//);
  await settle(deposit);
  const receipt = await fetch(env.origin + payPath);
  assert.equal(receipt.status, 200);
  assert.match(await receipt.text(), />Paid<\/span>/);
  const { onboardingTasks } = await seller.get<RevenueSettings>('/revenue/settings');
  assert.ok(onboardingTasks.length, 'the acceptance stack has an onboarding checklist');
  const onboarding = (await getDeal()).tasks.filter(task => task.source === 'onboarding:' + quote.id);
  assert.deepEqual(onboarding.map(task => task.title).sort(), onboardingTasks.map(title => title + ' (' + quote.number + ')').sort());
  assert.ok(onboarding.every(task => task.assigneeId === seller.user.id && task.contactId === contactId && task.dealId === deal.id));

  const subscriptions = async () => (await seller.get<{ items: Subscription[] }>('/revenue/subscriptions')).items.filter(item => item.quoteId === quote.id);
  const active = await subscriptions();
  assert.deepEqual(active.map(item => [item.contactId, item.dealId, item.interval, item.amount]), [[contactId, deal.id, 'monthly', 300]]);
  const [subscription] = active;

  // Advance only the synthetic subscription's clock. The normal worker issues the invoice and handles the repeated job.
  const jobs = await fixtureSql(`
    WITH due AS (
      UPDATE rev_subscriptions SET next_invoice_at = now() - interval '5 seconds' WHERE id = :'subscription' RETURNING id, next_invoice_at
    ), original AS (
      UPDATE jobs SET run_at = due.next_invoice_at,
        dedupe_key = 'platform:revenue.renew:' || due.id::text || ':' || to_char(due.next_invoice_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      FROM due
      WHERE jobs.kind = 'platform' AND jobs.status = 'pending' AND jobs.payload->>'handler' = 'revenue.renew'
        AND jobs.payload#>>'{data,subscriptionId}' = due.id::text RETURNING jobs.id, jobs.payload
    ), replay AS (
      INSERT INTO jobs (kind, dedupe_key, payload, run_at)
      SELECT 'platform', 'platform:revenue.renew:iq-replay:' || :'subscription', payload, now() FROM original RETURNING id
    )
    SELECT original.id || ',' || replay.id FROM original, replay;
  `, { subscription: subscription.id });
  assert.match(jobs, /^\d+,\d+$/, 'acceptance queued the original renewal job and a duplicate');
  await eventually('both copies of the renewal job finished', () => fixtureSql(
    "SELECT status FROM jobs WHERE id = ANY(string_to_array(:'jobs', ',')::bigint[]) ORDER BY id;", { jobs },
  ), statuses => statuses === 'done\ndone');

  const invoices = (await seller.get<{ items: InvoiceSummary[] }>('/revenue/invoices?dealId=' + deal.id)).items;
  const renewals = invoices.filter(invoice => invoice.kind === 'recurring');
  assert.deepEqual(renewals.map(invoice => [invoice.contactId, invoice.quoteId, invoice.status, invoice.total]), [[contactId, quote.id, 'open', 300]]);
  assert.ok(Date.parse((await subscriptions())[0].nextInvoiceAt) > Date.now() + 25 * 86_400_000);
  await settle(renewals[0]);
  assert.deepEqual((await getDeal()).tasks.filter(task => task.source === 'onboarding:' + quote.id).map(task => task.id).sort(),
    onboarding.map(task => task.id).sort(), 'renewal settlement does not duplicate onboarding');

  const events = await seller.get<PlatformEvent[]>('/platform/events?contactId=' + contactId);
  assert.equal(events.filter(event => event.type === 'deal.stage_changed'
    && event.dealId === deal.id && event.properties.toStageId === qualified.id).length, 1, 'the captured lead was qualified once');
  for (const [type, entityId] of [
    ['form.submitted', form.id], ['appointment.booked', appointment.id],
    ['quote.accepted', quote.id], ['payment.succeeded', deposit.id], ['subscription.renewed', subscription.id],
    ['invoice.issued', renewals[0].id], ['payment.succeeded', renewals[0].id],
  ]) {
    assert.equal(events.filter(event => event.type === type && event.entityId === entityId).length, 1, type);
  }
});
