// Revenue states, subscriptions and renewals. Each state is reported per currency and never converted:
// pipeline (open deals, with a labelled weighted estimate), contracted (accepted proposals), invoiced, collected,
// refunded, outstanding and monthly recurring revenue.
import type { RevenueOverview, RevenueStates } from '@/contracts/revenue';
import { intervalMonths, round2 } from '@/contracts/revenue';
import { db, transaction } from '../db';
import { emitEvent } from '../events';
import { sendEmail } from '../mailer';
import { schedulePlatformJob } from '../platform/jobs';
import { issueInvoice } from './invoices';
import { formatMoney, origin, paymentSelect, readLines, stripeConfig, toPayment } from './shared';
import type { PaymentRow, SubscriptionRow } from './shared';

export const RENEW_JOB = 'revenue.renew';

export async function revenueOverview(range: { from: string; to: string }): Promise<RevenueOverview> {
  const period = [range.from, range.to];
  const [pipeline, contracted, invoiced, collected, refunded, outstanding, recurring, payments] = await Promise.all([
    db.query<{ currency: string; amount: string; weighted: string }>(
      `SELECT d.currency, sum(d.amount) AS amount, sum(d.amount * coalesce(d.probability, s.probability) / 100.0) AS weighted
       FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.status = 'open' AND d.archived_at IS NULL GROUP BY d.currency`),
    db.query<{ currency: string; amount: string }>(`SELECT currency, sum(total) AS amount FROM rev_quotes WHERE status = 'accepted' AND accepted_at >= $1::date AND accepted_at < $2::date + 1 GROUP BY currency`, period),
    db.query<{ currency: string; amount: string }>(`SELECT currency, sum(total) AS amount FROM rev_invoices WHERE status <> 'void' AND issued_at >= $1::date AND issued_at < $2::date + 1 GROUP BY currency`, period),
    db.query<{ currency: string; amount: string }>(`SELECT currency, sum(amount) AS amount FROM rev_payments WHERE received_at >= $1::date AND received_at < $2::date + 1 GROUP BY currency`, period),
    db.query<{ currency: string; amount: string }>(
      `SELECT p.currency, sum(r.amount) AS amount FROM rev_refunds r JOIN rev_payments p ON p.id = r.payment_id WHERE r.refunded_at >= $1::date AND r.refunded_at < $2::date + 1 GROUP BY p.currency`, period),
    db.query<{ currency: string; amount: string }>(`SELECT currency, sum(total - amount_paid) AS amount FROM rev_invoices WHERE status = 'open' GROUP BY currency`),
    db.query<{ currency: string; amount: string; count: string }>(`SELECT currency, sum(monthly_value) AS amount, count(*) AS count FROM rev_subscriptions WHERE status = 'active' GROUP BY currency`),
    db.query<PaymentRow>(`${paymentSelect} ORDER BY p.received_at DESC LIMIT 10`),
  ]);
  const states = new Map<string, RevenueStates>();
  const state = (currency: string) => {
    if (!states.has(currency)) states.set(currency, { currency, pipeline: 0, weightedPipeline: 0, contracted: 0, invoiced: 0, collected: 0, refunded: 0, outstanding: 0, monthlyRecurring: 0, activeSubscriptions: 0 });
    return states.get(currency)!;
  };
  for (const row of pipeline.rows) Object.assign(state(row.currency), { pipeline: round2(Number(row.amount)), weightedPipeline: round2(Number(row.weighted)) });
  for (const row of contracted.rows) state(row.currency).contracted = round2(Number(row.amount));
  for (const row of invoiced.rows) state(row.currency).invoiced = round2(Number(row.amount));
  for (const row of collected.rows) state(row.currency).collected = round2(Number(row.amount));
  for (const row of refunded.rows) state(row.currency).refunded = round2(Number(row.amount));
  for (const row of outstanding.rows) state(row.currency).outstanding = round2(Number(row.amount));
  for (const row of recurring.rows) Object.assign(state(row.currency), { monthlyRecurring: round2(Number(row.amount)), activeSubscriptions: Number(row.count) });
  const config = stripeConfig();
  return {
    from: range.from, to: range.to, states: [...states.values()].sort((a, b) => b.pipeline + b.collected - (a.pipeline + a.collected)),
    recentPayments: payments.rows.map(toPayment), stripe: { configured: config.configured, webhookConfigured: config.webhookConfigured, mode: config.mode },
  };
}

/** Job: issues a subscription's next invoice, emails the payment link and schedules the following period. */
export async function runRenewal(data: { subscriptionId: string }) {
  const issued = await transaction(async client => {
    const sub = (await client.query<SubscriptionRow>(`SELECT * FROM rev_subscriptions WHERE id = $1 FOR UPDATE`, [data.subscriptionId])).rows[0];
    if (!sub || sub.status !== 'active' || new Date(sub.next_invoice_at).getTime() > Date.now() + 60_000) return null;
    const periodStart = new Date(sub.next_invoice_at);
    const next = new Date(periodStart);
    next.setUTCMonth(next.getUTCMonth() + intervalMonths(sub.interval));
    const invoice = await issueInvoice({
      kind: 'recurring', description: `${sub.name}, period from ${periodStart.toISOString().slice(0, 10)}`, currency: sub.currency, lines: readLines(sub.lines),
      quoteId: sub.quote_id, dealId: sub.deal_id, subscriptionId: sub.id, contactId: sub.contact_id ? Number(sub.contact_id) : null,
      contactName: sub.contact_name, contactEmail: sub.contact_email, companyName: sub.company_name,
    }, client);
    await client.query('UPDATE rev_subscriptions SET next_invoice_at = $2 WHERE id = $1', [sub.id, next.toISOString()]);
    await emitEvent({
      type: 'subscription.renewed', contactId: sub.contact_id ? Number(sub.contact_id) : null, dealId: sub.deal_id, entityType: 'subscription', entityId: sub.id,
      amount: Number(invoice.total), currency: sub.currency, source: 'revenue', properties: { name: sub.name, invoiceNumber: invoice.number },
      idempotencyKey: `subscription.renewed:${sub.id}:${periodStart.toISOString().slice(0, 10)}`,
    }, client);
    await schedulePlatformJob(RENEW_JOB, `${sub.id}:${next.toISOString().slice(0, 10)}`, { subscriptionId: sub.id }, { runAt: next, client });
    return { invoice, sub };
  });
  if (issued?.sub.contact_email) {
    const link = `${origin()}/pay/${issued.invoice.token}`;
    await sendEmail({
      to: issued.sub.contact_email, subject: `Invoice ${issued.invoice.number}`, category: 'transactional', source: `invoice:${issued.invoice.id}`,
      contactId: issued.sub.contact_id ? Number(issued.sub.contact_id) : null, idempotencyKey: `invoice.email:${issued.invoice.id}`,
      html: `<p>Hi {{contact.first_name | there}},</p><p>Your invoice ${issued.invoice.number} for ${escape(issued.sub.name)} is ready: ${formatMoney(Number(issued.invoice.total), issued.sub.currency)}.</p><p><a href="${link}">View and pay the invoice</a></p>`,
    });
  }
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Accounting export (one row per invoice line), in the column layout Xero and QuickBooks invoice imports accept. */
export async function accountingRows(range: { from: string; to: string }) {
  const rows = await db.query<{ number: string; contact_name: string; contact_email: string; company_name: string; issued_at: Date; due_date: string | null; currency: string; lines: unknown; status: string; amount_paid: string }>(
    `SELECT number, contact_name, contact_email, company_name, issued_at, due_date::text, currency, lines, status, amount_paid FROM rev_invoices
     WHERE status <> 'void' AND issued_at >= $1::date AND issued_at < $2::date + 1 ORDER BY issued_at`, [range.from, range.to]);
  return rows.rows.flatMap(row => readLines(row.lines).map(line => [
    row.company_name || row.contact_name, row.contact_email, row.number, new Date(row.issued_at).toISOString().slice(0, 10), row.due_date ?? '',
    line.name, line.quantity, line.unitPrice, line.discountPercent, line.taxRate, line.net, line.tax, line.total, row.currency, row.status, row.amount_paid,
  ]));
}
export const accountingFields = ['ContactName', 'EmailAddress', 'InvoiceNumber', 'InvoiceDate', 'DueDate', 'Description', 'Quantity', 'UnitAmount', 'Discount', 'TaxRate', 'LineNet', 'LineTax', 'LineTotal', 'Currency', 'Status', 'AmountPaid'];
