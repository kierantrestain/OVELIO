// Invoices, payments and refunds. Payments and refunds are keyed by the provider's reference, so a Stripe webhook
// redelivered ten times is counted once. A refund is recorded as the change in the provider's refunded total.
import { randomUUID } from 'node:crypto';
import type { Invoice, InvoiceKind, Line } from '@/contracts/revenue';
import { priceLine, round2, totals } from '@/contracts/revenue';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { emitEvent } from '../events';
import { createTask } from '../records';
import { invoiceSelect, newToken, paymentSelect, readLines, revenueSettings, toInvoiceSummary, toPayment } from './shared';
import type { InvoiceRow, PaymentRow } from './shared';

export type IssueInput = {
  kind: InvoiceKind; description: string; currency: string; lines: Line[]; dueDate?: string | null;
  quoteId?: string | null; dealId?: string | null; subscriptionId?: string | null; contactId?: number | null;
  contactName?: string; contactEmail?: string; companyName?: string; actorId?: string | null;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (days: number, from = new Date()) => isoDay(new Date(from.getTime() + days * 86_400_000));

export async function issueInvoice(input: IssueInput, client: Sql = db): Promise<InvoiceRow> {
  if (!input.lines.length) throw new AppError(400, 'An invoice needs at least one line.');
  const lines = input.lines.map(line => priceLine(line));
  const sum = totals(lines);
  if (sum.total <= 0) throw new AppError(400, 'The invoice total must be above zero.');
  const settings = await revenueSettings(client);
  const number = 'INV-' + (await client.query<{ n: string }>(`SELECT nextval('rev_invoice_number') AS n`)).rows[0].n;
  const row = (await client.query<InvoiceRow>(
    `INSERT INTO rev_invoices (number, quote_id, deal_id, subscription_id, contact_id, contact_name, contact_email, company_name, kind, description,
       currency, lines, subtotal, tax_total, total, due_date, token, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *, NULL::text AS quote_number`,
    [number, input.quoteId ?? null, input.dealId ?? null, input.subscriptionId ?? null, input.contactId ?? null, input.contactName ?? '',
      input.contactEmail ?? '', input.companyName ?? '', input.kind, input.description, input.currency, JSON.stringify(lines),
      round2(sum.subtotal - sum.discountTotal), sum.taxTotal, sum.total, input.dueDate === undefined ? addDays(settings.invoiceDueDays) : input.dueDate,
      newToken(), input.actorId ?? null],
  )).rows[0];
  await emitEvent({
    type: 'invoice.issued', contactId: input.contactId ?? null, dealId: input.dealId ?? null, entityType: 'invoice', entityId: row.id,
    amount: sum.total, currency: input.currency, actorId: input.actorId ?? null, source: 'revenue',
    properties: { number, kind: input.kind, quoteId: input.quoteId ?? null }, idempotencyKey: 'invoice.issued:' + row.id,
  }, client);
  return row;
}

export async function loadInvoice(id: string, client: Sql = db): Promise<Invoice> {
  const row = (await client.query<InvoiceRow>(`${invoiceSelect} WHERE i.id = $1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'That invoice was not found.');
  const payments = await client.query<PaymentRow>(`${paymentSelect} WHERE p.invoice_id = $1 ORDER BY p.received_at`, [id]);
  const lines = readLines(row.lines);
  return { ...toInvoiceSummary(row), lines, subtotal: Number(row.subtotal), taxTotal: Number(row.tax_total), payments: payments.rows.map(toPayment) };
}

/** Starts onboarding for an accepted proposal once (tasks for the deal owner, due over the next week). */
export async function startOnboarding(quoteId: string, client: Sql = db) {
  const quote = (await client.query<{ id: string; number: string; deal_id: string | null; contact_id: string | null; owner_id: string | null }>(
    `SELECT q.id, q.number, q.deal_id, q.contact_id, coalesce(d.owner_id, q.created_by) AS owner_id FROM rev_quotes q LEFT JOIN deals d ON d.id = q.deal_id WHERE q.id = $1`, [quoteId])).rows[0];
  if (!quote) return 0;
  const source = 'onboarding:' + quote.id;
  if ((await client.query('SELECT 1 FROM tasks WHERE source = $1 LIMIT 1', [source])).rows[0]) return 0;
  const { onboardingTasks } = await revenueSettings(client);
  for (const [index, title] of onboardingTasks.entries()) {
    await createTask({
      title: `${title} (${quote.number})`, type: index === 0 ? 'call' : 'todo', dueAt: new Date(Date.now() + (index + 1) * 2 * 86_400_000),
      assigneeId: quote.owner_id, contactId: quote.contact_id ? Number(quote.contact_id) : null, dealId: quote.deal_id, source,
    }, client);
  }
  return onboardingTasks.length;
}

export type PaymentInput = {
  invoiceId: string; provider: 'stripe' | 'manual'; providerRef?: string; amount: number; method?: string; note?: string;
  receivedAt?: Date | string; actorId?: string | null;
};

/** Records a payment against an invoice. Returns null when this provider reference was already recorded. */
export async function recordPayment(input: PaymentInput, client: Sql = db) {
  const invoice = (await client.query<InvoiceRow>('SELECT *, NULL::text AS quote_number FROM rev_invoices WHERE id = $1 FOR UPDATE', [input.invoiceId])).rows[0];
  if (!invoice) throw new AppError(404, 'That invoice was not found.');
  if (invoice.status === 'void') throw new AppError(409, `${invoice.number} is void; payments cannot be recorded against it.`);
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new AppError(400, 'Enter an amount above zero.');
  const payment = (await client.query<{ id: string }>(
    `INSERT INTO rev_payments (invoice_id, provider, provider_ref, method, amount, currency, note, received_at, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9) ON CONFLICT (provider_ref) DO NOTHING RETURNING id`,
    [invoice.id, input.provider, input.providerRef ?? 'manual:' + randomUUID(), input.method ?? '', amount, invoice.currency, input.note ?? '',
      input.receivedAt ? new Date(input.receivedAt).toISOString() : null, input.actorId ?? null],
  )).rows[0];
  if (!payment) return null;
  const paid = round2(Number(invoice.amount_paid) + amount);
  const settled = paid >= Number(invoice.total) - 0.005;
  await client.query(
    `UPDATE rev_invoices SET amount_paid = $2, status = CASE WHEN $3 THEN 'paid' ELSE status END, paid_at = CASE WHEN $3 THEN coalesce(paid_at, now()) END,
       updated_at = now() WHERE id = $1`, [invoice.id, paid, settled]);
  await emitEvent({
    type: 'payment.succeeded', contactId: invoice.contact_id ? Number(invoice.contact_id) : null, dealId: invoice.deal_id, entityType: 'invoice',
    entityId: invoice.id, amount, currency: invoice.currency, actorId: input.actorId ?? null, source: 'revenue:' + input.provider,
    properties: { number: invoice.number, paymentId: payment.id, provider: input.provider, settled, kind: invoice.kind },
    idempotencyKey: 'payment.succeeded:' + payment.id,
  }, client);
  // A required deposit (or full prepayment) being paid is what starts onboarding.
  if (settled && invoice.quote_id && (invoice.kind === 'deposit' || invoice.kind === 'full')) await startOnboarding(invoice.quote_id, client);
  return { paymentId: payment.id, settled };
}

/** Records a refund of `amount` against a payment. Returns null when this refund reference was already recorded. */
export async function recordRefund(input: { paymentId: string; providerRef: string; amount: number; reason?: string; actorId?: string | null }, client: Sql = db) {
  const payment = (await client.query<{ id: string; invoice_id: string; amount: string; refunded: string; currency: string }>(
    'SELECT id, invoice_id, amount, refunded, currency FROM rev_payments WHERE id = $1 FOR UPDATE', [input.paymentId])).rows[0];
  if (!payment) throw new AppError(404, 'That payment was not found.');
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new AppError(400, 'Enter a refund amount above zero.');
  if (Number(payment.refunded) + amount > Number(payment.amount) + 0.005) throw new AppError(400, 'A refund cannot exceed what was paid.');
  const refund = (await client.query<{ id: string }>(
    `INSERT INTO rev_refunds (payment_id, provider_ref, amount, reason, recorded_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider_ref) DO NOTHING RETURNING id`,
    [payment.id, input.providerRef, amount, input.reason ?? '', input.actorId ?? null])).rows[0];
  if (!refund) return null;
  await client.query('UPDATE rev_payments SET refunded = refunded + $2 WHERE id = $1', [payment.id, amount]);
  const invoice = (await client.query<{ id: string; number: string; contact_id: string | null; deal_id: string | null }>(
    'UPDATE rev_invoices SET amount_refunded = amount_refunded + $2, updated_at = now() WHERE id = $1 RETURNING id, number, contact_id, deal_id', [payment.invoice_id, amount])).rows[0];
  await emitEvent({
    type: 'payment.refunded', contactId: invoice.contact_id ? Number(invoice.contact_id) : null, dealId: invoice.deal_id, entityType: 'invoice',
    entityId: invoice.id, amount, currency: payment.currency, actorId: input.actorId ?? null, source: 'revenue',
    properties: { number: invoice.number, paymentId: payment.id, reason: input.reason ?? '' }, idempotencyKey: 'payment.refunded:' + refund.id,
  }, client);
  return { refundId: refund.id };
}

export async function voidInvoice(id: string, actorId: string) {
  return transaction(async client => {
    const invoice = (await client.query<{ status: string; amount_paid: string; number: string }>('SELECT status, amount_paid, number FROM rev_invoices WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!invoice) throw new AppError(404, 'That invoice was not found.');
    if (Number(invoice.amount_paid) > 0) throw new AppError(409, `${invoice.number} has payments; refund them instead of voiding the invoice.`);
    await client.query(`UPDATE rev_invoices SET status = 'void', updated_at = now() WHERE id = $1`, [id]);
    await client.query('INSERT INTO audit_log (actor_id, action, entity_type, entity_id, summary) VALUES ($1, $2, $3, $4, $5)', [actorId, 'void', 'invoice', id, invoice.number]);
    return loadInvoice(id, client);
  });
}
