import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
process.env.CONTACT_HMAC_KEY ||= 'test-hmac-key-for-revenue-tests-000000';
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;

const { db } = await import('../../src/server/db');
const { revenueModule } = await import('../../src/server/revenue/module');
const { searchContacts } = await import('../../src/server/directory');
const { listEvents } = await import('../../src/server/events');
const { createDeal } = await import('../../src/server/records');
const { priceLine, round2, totals, toMinorUnits, fromMinorUnits, monthlyValue } = await import('../../src/contracts/revenue');
const { verifyStripeSignature, receiveStripeWebhook, formEncode } = await import('../../src/server/revenue/stripe');
const { serveQuote, postQuote, serveInvoice } = await import('../../src/server/revenue/public');
const { runRenewal } = await import('../../src/server/revenue/overview');
type Quote = import('../../src/contracts/revenue').Quote;
type Invoice = import('../../src/contracts/revenue').Invoice;
type Product = import('../../src/contracts/revenue').Product;
type Overview = import('../../src/contracts/revenue').RevenueOverview;

after(async () => { await db.close(); });

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'dev@ovelio.test', name: 'Developer Test', role: 'admin' as const };

async function call<T>(method: string, path: string, body?: unknown, query = ''): Promise<T> {
  const entry = revenueModule.endpoints.find(item => item.method === method && item.path.test(path));
  assert.ok(entry, `${method} ${path} is routed`);
  const match = entry.path.exec(path)!;
  const request = new Request('http://localhost/api/console/' + path + (query ? '?' + query : ''), {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await entry.handler({ request, user, params: match.slice(1), query: new URL(request.url).searchParams });
  if (result instanceof Response) {
    if (result.status === 204) return undefined as T;
    const type = result.headers.get('content-type') ?? '';
    return (type.includes('json') ? await result.json() : await result.text()) as T;
  }
  return result as T;
}

const form = (values: Record<string, string>) => new Request('http://localhost/q/x', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'test-browser', 'x-forwarded-for': '203.0.113.9' },
  body: new URLSearchParams(values),
});

function signed(payload: unknown, secret: string, at = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  return new Request('http://localhost/api/public/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${at},v1=${signature}` }, body });
}

test('REV-01 line maths: discounts, tax, rounding, monthly value and Stripe minor units', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-2.675), -2.68);
  const line = priceLine({ name: 'Retainer', quantity: 3, unitPrice: 333.335, discountPercent: 10, taxRate: 20, billing: 'quarterly' });
  assert.equal(line.unitPrice, 333.34, 'unit prices are kept to the cent');
  assert.equal(line.gross, 1000.02);
  assert.equal(line.discount, 100);
  assert.equal(line.net, 900.02);
  assert.equal(line.tax, 180);
  assert.equal(line.total, 1080.02);
  assert.equal(monthlyValue(900, 'quarterly'), 300);
  assert.equal(monthlyValue(1200, 'yearly'), 100);
  const sum = totals([line, priceLine({ name: 'Setup', quantity: 1, unitPrice: 500, taxRate: 20 })]);
  assert.equal(sum.total, 1680.02);
  assert.equal(sum.oneTimeNet, 500);
  assert.equal(sum.monthlyRecurring, 300.01, '900.02 a quarter');
  assert.equal(toMinorUnits(1680.01, 'GBP'), 168001);
  assert.equal(toMinorUnits(5000, 'JPY'), 5000);
  assert.equal(fromMinorUnits(168001, 'gbp'), 1680.01);
  assert.equal(formEncode({ a: { b: [{ c: 1 }] }, d: 'x' }).toString(), 'a%5Bb%5D%5B0%5D%5Bc%5D=1&d=x');
});

test('REV-02 catalogue price lists, unique SKUs, and deal line items set the deal value', async () => {
  const product = await call<Product>('POST', 'revenue/products', { name: 'Audit (test)', sku: 'AUD-T', unitPrice: 1000, currency: 'GBP', billing: 'one_time', prices: [{ currency: 'EUR', unitPrice: 1150 }] });
  assert.deepEqual(product.prices, [{ currency: 'EUR', unitPrice: 1150 }]);
  await assert.rejects(call('POST', 'revenue/products', { name: 'Clash', sku: 'aud-t', unitPrice: 1, currency: 'GBP' }), /already uses the SKU/);
  const deal = await createDeal({ name: 'Line item deal', amount: 50, source: 'test' });
  const saved = await call<{ dealValue: number; totals: { total: number } }>('POST', `revenue/deals/${deal.id}/lines`, { lines: [
    { productId: product.id, name: product.name, quantity: 2, unitPrice: 1000, discountPercent: 5, taxRate: 20 },
    { name: 'Support', quantity: 1, unitPrice: 200, taxRate: 20, billing: 'monthly' },
  ] });
  assert.equal(saved.dealValue, 2100, 'one-time net 1900 + one month of support 200');
  assert.equal(saved.totals.total, 2520);
  const amount = (await db.query<{ amount: string }>('SELECT amount FROM deals WHERE id = $1', [deal.id])).rows[0].amount;
  assert.equal(Number(amount), 2100);
});

test('REV-03 proposal journey: draft from a deal, send, view, sign, deal won, deposit invoice, subscription', async () => {
  const [contact] = await searchContacts('claire');
  const deal = await createDeal({ name: 'Northbridge growth programme', amount: 0, contactId: contact.id, source: 'test' });
  await call('POST', `revenue/deals/${deal.id}/lines`, { lines: [
    { name: 'Strategy workshop', quantity: 1, unitPrice: 3000, taxRate: 20 },
    { name: 'Automation retainer', quantity: 1, unitPrice: 1000, taxRate: 20, billing: 'monthly' },
  ] });
  const draft = await call<Quote>('POST', 'revenue/quotes', { dealId: deal.id });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.publicUrl, null, 'a draft has no public link');
  assert.equal(draft.totals.total, 4800);
  const edited = await call<Quote>('PATCH', `revenue/quotes/${draft.id}`, { depositPercent: 25, intro: 'Plan for <b>growth</b>' });
  assert.equal(edited.depositPercent, 25);
  const { quote, delivery } = await call<{ quote: Quote; delivery: { status: string; reason: string } }>('POST', `revenue/quotes/${draft.id}/send`, { email: true });
  assert.equal(quote.status, 'sent');
  assert.equal(delivery.status, 'not_sent', 'the preview stores the email instead of claiming delivery');
  assert.match(delivery.reason, /developer preview/);
  await assert.rejects(call('PATCH', `revenue/quotes/${draft.id}`, { title: 'Changed' }), /cannot change/);
  const token = quote.publicUrl!.split('/q/')[1];

  const page = await (await serveQuote(token, new Request('http://localhost/q/' + token))).text();
  assert.ok(page.includes('Plan for &lt;b&gt;growth&lt;/b&gt;'), 'proposal text is escaped');
  assert.ok(page.includes('Accept proposal'));
  const refused = await (await postQuote(token, form({ action: 'accept', signerName: 'Claire', signerEmail: contact.email }))).text();
  assert.ok(refused.includes('Tick the box'), 'acceptance needs explicit consent');

  const accepted = await (await postQuote(token, form({ action: 'accept', signerName: 'Claire Morgan', signerEmail: contact.email, agree: 'true' }))).text();
  assert.ok(accepted.includes('Accepted. Thank you'));
  const again = await (await postQuote(token, form({ action: 'accept', signerName: 'Claire Morgan', signerEmail: contact.email, agree: 'true' }))).text();
  assert.ok(!again.includes('Accept proposal ·'), 'no second acceptance form');

  const signedQuote = await call<Quote>('GET', `revenue/quotes/${draft.id}`);
  assert.equal(signedQuote.status, 'accepted');
  assert.equal(signedQuote.signerName, 'Claire Morgan');
  assert.match(signedQuote.documentHash, /^[0-9a-f]{64}$/);
  assert.equal(signedQuote.viewCount, 1);
  assert.equal(signedQuote.invoices.length, 1);
  assert.equal(signedQuote.invoices[0].kind, 'deposit');
  assert.equal(signedQuote.invoices[0].total, 1200, '25% of 4800');
  const status = (await db.query<{ status: string }>('SELECT status FROM deals WHERE id = $1', [deal.id])).rows[0].status;
  assert.equal(status, 'won', 'acceptance closes the deal as won');
  const subscriptions = await db.query<{ interval: string; monthly_value: string; amount: string }>('SELECT interval, monthly_value, amount FROM rev_subscriptions WHERE quote_id = $1', [draft.id]);
  assert.deepEqual(subscriptions.rows.map(row => [row.interval, Number(row.monthly_value), Number(row.amount)]), [['monthly', 1000, 1200]]);
  const onboarding = await db.query(`SELECT 1 FROM tasks WHERE source = $1`, ['onboarding:' + draft.id]);
  assert.equal(onboarding.rows.length, 0, 'onboarding waits for the deposit');
  const types = (await listEvents({ dealId: deal.id })).map(event => event.type);
  for (const type of ['quote.sent', 'quote.viewed', 'quote.accepted', 'invoice.issued', 'subscription.started', 'deal.won']) assert.ok(types.includes(type as never), `${type} emitted`);
  assert.equal(types.filter(type => type === 'quote.accepted').length, 1);
});

test('REV-04 Stripe signatures: valid, wrong secret, stale timestamp, rotated secrets', () => {
  const body = '{"id":"evt_1"}';
  const at = 1_800_000_000;
  const sig = (secret: string) => createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${at},v1=${sig('whsec_a')}`, 'whsec_a', 300, at * 1000), true);
  assert.equal(verifyStripeSignature(body, `t=${at},v1=${sig('whsec_b')}`, 'whsec_a', 300, at * 1000), false);
  assert.equal(verifyStripeSignature(body, `t=${at},v1=${sig('whsec_a')}`, 'whsec_a', 300, (at + 301) * 1000), false, 'replay outside tolerance');
  assert.equal(verifyStripeSignature(body + ' ', `t=${at},v1=${sig('whsec_a')}`, 'whsec_a', 300, at * 1000), false, 'tampered body');
  assert.equal(verifyStripeSignature(body, `t=${at},v1=deadbeef,v1=${sig('whsec_a')}`, 'whsec_a', 300, at * 1000), true);
  assert.equal(verifyStripeSignature(body, null, 'whsec_a'), false);
});

test('REV-05 webhook payment is recorded once, settles the deposit, starts onboarding; refunds count by delta', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  const quote = (await db.query<{ id: string }>(`SELECT id FROM rev_quotes WHERE status = 'accepted' ORDER BY accepted_at DESC LIMIT 1`)).rows[0];
  const invoice = (await call<Quote>('GET', `revenue/quotes/${quote.id}`)).invoices[0];
  const event = { id: 'evt_test_paid_1', type: 'checkout.session.completed', data: { object: {
    id: 'cs_test_1', payment_status: 'paid', amount_total: 120000, currency: 'gbp', payment_intent: 'pi_test_1', client_reference_id: invoice.id, metadata: { invoice_id: invoice.id },
  } } };
  const bad = await receiveStripeWebhook(signed(event, 'whsec_wrong'));
  assert.equal(bad.status, 400);
  const first = await (await receiveStripeWebhook(signed(event, 'whsec_test_secret'))).json() as { outcome: string };
  assert.match(first.outcome, /payment recorded/);
  const redelivered = await (await receiveStripeWebhook(signed(event, 'whsec_test_secret'))).json() as { outcome: string };
  assert.equal(redelivered.outcome, 'duplicate');
  const sameIntent = await (await receiveStripeWebhook(signed({ ...event, id: 'evt_test_paid_2' }, 'whsec_test_secret'))).json() as { outcome: string };
  assert.equal(sameIntent.outcome, 'payment already recorded');
  const paid = await call<Invoice>('GET', `revenue/invoices/${invoice.id}`);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.amountPaid, 1200);
  assert.equal(paid.payments.length, 1);
  const onboarding = await db.query(`SELECT title FROM tasks WHERE source = $1`, ['onboarding:' + quote.id]);
  assert.equal(onboarding.rows.length, 3, 'paid deposit starts the onboarding tasks');

  const refund = (amount: number, id: string) => ({ id, type: 'charge.refunded', data: { object: { id: 'ch_test_1', payment_intent: 'pi_test_1', amount_refunded: amount } } });
  await receiveStripeWebhook(signed(refund(20000, 'evt_refund_1'), 'whsec_test_secret'));
  await receiveStripeWebhook(signed(refund(20000, 'evt_refund_1b'), 'whsec_test_secret'));
  await receiveStripeWebhook(signed(refund(50000, 'evt_refund_2'), 'whsec_test_secret'));
  const refunded = await call<Invoice>('GET', `revenue/invoices/${invoice.id}`);
  assert.equal(refunded.amountRefunded, 500, '200 then a further 300; the repeated total adds nothing');
  const page = await (await serveInvoice(paid.publicUrl!.split('/i/')[1], new Request('http://localhost/i/x'))).text();
  assert.ok(page.includes('Paid'));
});

test('REV-06 revenue states keep pipeline, contracted, invoiced, collected, refunded and recurring apart', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const overview = await call<Overview>('GET', 'revenue/overview', undefined, `from=2020-01-01&to=${today}`);
  const gbp = overview.states.find(state => state.currency === 'GBP')!;
  assert.ok(gbp);
  assert.equal(gbp.contracted, 4800);
  assert.equal(gbp.invoiced, 1200);
  assert.equal(gbp.collected, 1200);
  assert.equal(gbp.refunded, 500);
  assert.equal(gbp.monthlyRecurring, 1000);
  assert.ok(gbp.pipeline > 0 && gbp.weightedPipeline <= gbp.pipeline);
  assert.equal(overview.stripe.configured, false);
});

test('REV-07 renewals issue the next invoice once per period and advance the subscription', async () => {
  const sub = (await db.query<{ id: string }>(`SELECT id FROM rev_subscriptions ORDER BY created_at DESC LIMIT 1`)).rows[0];
  await db.query(`UPDATE rev_subscriptions SET next_invoice_at = now() - interval '1 minute' WHERE id = $1`, [sub.id]);
  await runRenewal({ subscriptionId: sub.id });
  await runRenewal({ subscriptionId: sub.id });
  const invoices = await db.query<{ kind: string; total: string }>(`SELECT kind, total FROM rev_invoices WHERE subscription_id = $1`, [sub.id]);
  assert.deepEqual(invoices.rows.map(row => [row.kind, Number(row.total)]), [['recurring', 1200]]);
  const next = (await db.query<{ next_invoice_at: Date }>(`SELECT next_invoice_at FROM rev_subscriptions WHERE id = $1`, [sub.id])).rows[0].next_invoice_at;
  assert.ok(new Date(next).getTime() > Date.now() + 25 * 86_400_000);
});

test('REV-08 manual payments, balance invoices, declines and the void guard', async () => {
  const deal = await createDeal({ name: 'Decline and balance', amount: 1000, source: 'test' });
  const draft = await call<Quote>('POST', 'revenue/quotes', { dealId: deal.id });
  const { quote } = await call<{ quote: Quote }>('POST', `revenue/quotes/${draft.id}/send`, { email: false });
  const token = quote.publicUrl!.split('/q/')[1];
  const declined = await (await postQuote(token, form({ action: 'decline', reason: 'Budget moved to Q3' }))).text();
  assert.ok(declined.includes('marked as declined'));
  assert.equal((await call<Quote>('GET', `revenue/quotes/${draft.id}`)).declineReason, 'Budget moved to Q3');
  const revision = await call<Quote>('POST', `revenue/quotes/${draft.id}/revise`);
  assert.equal(revision.status, 'draft');
  assert.notEqual(revision.number, draft.number);
  await call('PATCH', `revenue/quotes/${revision.id}`, { depositPercent: 40 });
  const sent = (await call<{ quote: Quote }>('POST', `revenue/quotes/${revision.id}/send`, { email: false })).quote;
  await postQuote(sent.publicUrl!.split('/q/')[1], form({ action: 'accept', signerName: 'Test Signer', signerEmail: 'signer@example.com', agree: 'true' }));
  const balance = await call<Invoice>('POST', 'revenue/invoices', { quoteId: revision.id, kind: 'balance' });
  assert.equal(balance.total, 600, '1000 minus the 40% deposit');
  await assert.rejects(call('POST', 'revenue/invoices', { quoteId: revision.id, kind: 'balance' }), /invoiced in full/);
  const part = await call<Invoice>('POST', `revenue/invoices/${balance.id}/payments`, { amount: 250, method: 'Bank transfer' });
  assert.equal(part.status, 'open');
  assert.equal(part.balance, 350);
  await assert.rejects(call('POST', `revenue/invoices/${balance.id}/void`), /refund them instead/);
  const settled = await call<Invoice>('POST', `revenue/invoices/${balance.id}/payments`, { amount: 350 });
  assert.equal(settled.status, 'paid');
});

test('REV-09 a workflow triggered by an accepted proposal enrols the signer and creates the onboarding task', async () => {
  const flows = await import('../../src/server/journeys/flows');
  const { drainPlatformJobs } = await import('../../src/server/platform/jobs');
  const [contact] = await searchContacts('daniel');
  const flow = await flows.createFlow({
    name: 'REV welcome new client',
    triggers: [{ id: 't1', type: 'quote.accepted', filters: {} }],
    graph: { nodes: [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      { id: 'task', type: 'create_task', position: { x: 0, y: 120 }, config: { title: 'Welcome pack for {{contact.first_name}}', dueInDays: 1, assignee: 'owner' } },
    ], edges: [{ id: 'e1', source: 'start', target: 'task', sourceHandle: 'next' }] },
  }, user.id);
  await flows.publishFlow(flow.id, user.id);
  const deal = await createDeal({ name: 'Harbourline retainer', amount: 900, contactId: contact.id, source: 'test' });
  const draft = await call<Quote>('POST', 'revenue/quotes', { dealId: deal.id });
  const { quote } = await call<{ quote: Quote }>('POST', `revenue/quotes/${draft.id}/send`, { email: false });
  await postQuote(quote.publicUrl!.split('/q/')[1], form({ action: 'accept', signerName: 'Daniel Price', signerEmail: contact.email, agree: 'true' }));
  for (let i = 0; i < 30 && await drainPlatformJobs({ maxJobs: 50, budgetMs: 10_000 }); i += 1) { /* drain */ }
  const enrolments = await db.query<{ status: string }>('SELECT status FROM journey_enrolments WHERE flow_id = $1 AND contact_id = $2', [flow.id, contact.id]);
  assert.equal(enrolments.rows.length, 1);
  assert.equal(enrolments.rows[0].status, 'completed');
  const task = await db.query(`SELECT 1 FROM tasks WHERE contact_id = $1 AND title LIKE 'Welcome pack for %'`, [contact.id]);
  assert.equal(task.rows.length, 1);
});
