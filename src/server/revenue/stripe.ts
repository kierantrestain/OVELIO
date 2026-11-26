// Stripe: hosted Checkout for invoice payments, refunds, and the signed webhook that confirms them. No Stripe SDK:
// three REST calls and the documented signature scheme (HMAC-SHA256 over "<timestamp>.<raw body>").
// Card details never reach OVELIO; the payer enters them on Stripe's page.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fromMinorUnits, toMinorUnits } from '@/contracts/revenue';
import { AppError, logError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { emitEvent } from '../events';
import { recordPayment, recordRefund } from './invoices';
import { origin, stripeConfig } from './shared';
import type { InvoiceRow } from './shared';

const api = 'https://api.stripe.com/v1/';

/** Stripe's form encoding: nested objects as a[b][c]=value. */
export function formEncode(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, index) => typeof item === 'object' ? formEncode(item as Record<string, unknown>, `${name}[${index}]`, out) : out.append(`${name}[${index}]`, String(item)));
    else if (typeof value === 'object') formEncode(value as Record<string, unknown>, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function stripePost<T>(path: string, params: Record<string, unknown>, idempotencyKey: string): Promise<T> {
  const config = stripeConfig();
  if (!config.configured) throw new AppError(409, 'Card payments are not set up: add STRIPE_SECRET_KEY (a test key starts sk_test_).');
  const response = await fetch(api + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': idempotencyKey },
    body: formEncode(params),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new AppError(502, `Stripe refused the request: ${data.error?.message ?? `HTTP ${response.status}`}`);
  return data;
}

/** Creates a Checkout Session for an invoice's outstanding balance and returns its hosted payment page. */
export async function createCheckout(invoice: InvoiceRow): Promise<string> {
  const balance = Math.round((Number(invoice.total) - Number(invoice.amount_paid)) * 100) / 100;
  if (invoice.status !== 'open' || balance <= 0) throw new AppError(409, `${invoice.number} has nothing left to pay.`);
  const minor = toMinorUnits(balance, invoice.currency);
  const page = `${origin()}/pay/${invoice.token}`;
  // Same invoice, balance and hour → Stripe returns the same session instead of a duplicate.
  const key = `checkout:${invoice.id}:${minor}:${new Date().toISOString().slice(0, 13)}`;
  const session = await stripePost<{ id: string; url: string }>('checkout/sessions', {
    mode: 'payment',
    success_url: `${page}?paid=1`,
    cancel_url: page,
    client_reference_id: invoice.id,
    customer_email: invoice.contact_email || undefined,
    metadata: { invoice_id: invoice.id, invoice_number: invoice.number },
    payment_intent_data: { metadata: { invoice_id: invoice.id, invoice_number: invoice.number }, description: `Invoice ${invoice.number}` },
    line_items: [{ quantity: 1, price_data: { currency: invoice.currency.toLowerCase(), unit_amount: minor, product_data: { name: `Invoice ${invoice.number}${invoice.description ? ` · ${invoice.description}` : ''}`.slice(0, 250) } } }],
  }, key);
  await db.query('UPDATE rev_invoices SET stripe_session_id = $2, payment_url = $3, updated_at = now() WHERE id = $1', [invoice.id, session.id, session.url]);
  return session.url;
}

/** Refunds part or all of a Stripe payment through the API; the refund is recorded straight away. */
export async function refundStripePayment(payment: { id: string; provider_ref: string; currency: string }, amount: number, reason: string, actorId: string) {
  const refund = await stripePost<{ id: string; status: string }>('refunds', {
    payment_intent: payment.provider_ref, amount: toMinorUnits(amount, payment.currency), metadata: { reason: reason.slice(0, 200) },
  }, `refund:${payment.id}:${toMinorUnits(amount, payment.currency)}:${Date.now()}`);
  return recordRefund({ paymentId: payment.id, providerRef: refund.id, amount, reason, actorId });
}

/* ── Webhook ─────────────────────────────────────────────────────────── */

/** Verifies a Stripe-Signature header. Accepts any v1 signature that matches and a timestamp within the tolerance. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSeconds = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'));
  return signatures.some(signature => {
    const supplied = Buffer.from(signature);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

const str = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : '';

async function invoiceFor(object: Record<string, unknown>, client: Sql) {
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const id = metadata.invoice_id || str(object.client_reference_id);
  const rows = await client.query<InvoiceRow>(
    `SELECT *, NULL::text AS quote_number FROM rev_invoices WHERE id::text = $1 OR (stripe_session_id IS NOT NULL AND stripe_session_id = $2) OR (stripe_payment_intent IS NOT NULL AND stripe_payment_intent = $3) LIMIT 1`,
    [id || '', str(object.id), str(object.payment_intent) || str(object.id)]);
  return rows.rows[0] ?? null;
}

/** Applies one verified webhook event. Each Stripe event id is processed once; a failure rolls back so Stripe retries. */
export async function handleStripeEvent(event: StripeEvent): Promise<string> {
  return transaction(async client => {
    const fresh = await client.query('INSERT INTO rev_stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [event.id, event.type]);
    if (!fresh.rows[0]) return 'duplicate';
    const object = event.data?.object ?? {};
    let outcome = 'ignored';
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (object.payment_status !== 'paid') { outcome = 'awaiting payment'; break; }
        const invoice = await invoiceFor(object, client);
        if (!invoice) { outcome = 'no matching invoice'; break; }
        const intent = str(object.payment_intent);
        if (intent) await client.query('UPDATE rev_invoices SET stripe_payment_intent = $2 WHERE id = $1', [invoice.id, intent]);
        const currency = String(object.currency ?? invoice.currency).toUpperCase();
        const result = await recordPayment({
          invoiceId: invoice.id, provider: 'stripe', providerRef: intent || str(object.id), amount: fromMinorUnits(Number(object.amount_total ?? 0), currency),
          method: 'Stripe Checkout', note: `Stripe ${str(object.id)}`,
        }, client);
        outcome = result ? `payment recorded for ${invoice.number}` : 'payment already recorded';
        break;
      }
      case 'checkout.session.async_payment_failed':
      case 'payment_intent.payment_failed': {
        const invoice = await invoiceFor(object, client);
        if (!invoice) { outcome = 'no matching invoice'; break; }
        const error = (object.last_payment_error ?? {}) as { message?: string };
        await emitEvent({
          type: 'payment.failed', contactId: invoice.contact_id ? Number(invoice.contact_id) : null, dealId: invoice.deal_id, entityType: 'invoice',
          entityId: invoice.id, currency: invoice.currency, source: 'revenue:stripe', properties: { number: invoice.number, reason: error.message ?? 'The payment did not complete.' },
          idempotencyKey: 'payment.failed:' + event.id,
        }, client);
        outcome = `failure noted for ${invoice.number}`;
        break;
      }
      case 'charge.refunded': {
        const intent = str(object.payment_intent);
        const payment = (await client.query<{ id: string; refunded: string; currency: string }>(
          `SELECT id, refunded, currency FROM rev_payments WHERE provider = 'stripe' AND provider_ref = $1`, [intent])).rows[0];
        if (!payment) { outcome = 'no matching payment'; break; }
        // amount_refunded is Stripe's running total; record only what OVELIO has not yet seen (refunds made here are already in).
        const total = fromMinorUnits(Number(object.amount_refunded ?? 0), payment.currency);
        const delta = Math.round((total - Number(payment.refunded)) * 100) / 100;
        if (delta <= 0) { outcome = 'refund already recorded'; break; }
        await recordRefund({ paymentId: payment.id, providerRef: `${str(object.id)}:${object.amount_refunded}`, amount: delta, reason: 'Refunded in Stripe' }, client);
        outcome = 'refund recorded';
        break;
      }
      default: break;
    }
    await client.query('UPDATE rev_stripe_events SET processed_at = now(), outcome = $2 WHERE id = $1', [event.id, outcome]);
    return outcome;
  });
}

export async function receiveStripeWebhook(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  if (!secret) return Response.json({ error: 'STRIPE_WEBHOOK_SECRET is not configured.' }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 512 * 1024) return Response.json({ error: 'Payload too large.' }, { status: 413 });
  if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)) return Response.json({ error: 'Invalid signature.' }, { status: 400 });
  let event: StripeEvent;
  try { event = JSON.parse(raw) as StripeEvent; } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!event?.id || !event.type) return Response.json({ error: 'Not a Stripe event.' }, { status: 400 });
  try {
    return Response.json({ received: true, outcome: await handleStripeEvent(event) });
  } catch (error) {
    logError('stripe-webhook', error);
    return Response.json({ error: 'Processing failed; Stripe will retry.' }, { status: 500 });
  }
}
