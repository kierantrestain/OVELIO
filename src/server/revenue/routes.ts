// Console endpoints for revenue under /api/console/revenue/ (products and line items are in catalog.ts).
import { z } from 'zod';
import type { User } from '@/contracts';
import { csvResponse } from '../crm/shared';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { audit, emitEvent } from '../events';
import { json, readBody } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { catalogEndpoints } from './catalog';
import { addDays, issueInvoice, loadInvoice, recordPayment, recordRefund, voidInvoice } from './invoices';
import { accountingFields, accountingRows, revenueOverview } from './overview';
import { createQuoteFromDeal, listQuotes, loadQuote, quotePatch, reviseQuote, sendQuote, updateQuote } from './quotes';
import { invoiceSelect, isoDate, lineSchema, money, revenueSettings, saveRevenueSettings, settingsSchema, toInvoiceSummary, toSubscription, uuid } from './shared';
import type { InvoiceRow, SubscriptionRow } from './shared';
import { refundStripePayment } from './stripe';
import { priceLine, round2 } from '@/contracts/revenue';

const id = (value: string) => uuid.parse(value);

function range(query: URLSearchParams) {
  const to = query.get('to') ? isoDate.parse(query.get('to')) : new Date().toISOString().slice(0, 10);
  const from = query.get('from') ? isoDate.parse(query.get('from')) : addDays(-89, new Date(to + 'T12:00:00Z'));
  if (from > to) throw new AppError(400, 'The start date must be before the end date.');
  return { from, to };
}

async function listInvoices(query: URLSearchParams) {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll('?', '$' + values.length)); };
  const status = query.get('status');
  if (status === 'overdue') where.push(`i.status = 'open' AND i.due_date < current_date`);
  else if (status && ['draft', 'open', 'paid', 'void'].includes(status)) add('i.status = ?', status);
  if (query.get('dealId')) add('i.deal_id = ?', id(query.get('dealId')!));
  if (query.get('q')) add('(i.number ILIKE ? OR i.contact_name ILIKE ? OR i.company_name ILIKE ? OR i.contact_email ILIKE ?)', `%${query.get('q')!.trim().slice(0, 120).replace(/[%_\\]/g, '\\$&')}%`);
  const rows = await db.query<InvoiceRow>(`${invoiceSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.issued_at DESC LIMIT 300`, values);
  return { items: rows.rows.map(row => toInvoiceSummary(row)) };
}

const actor = (user: User) => ({ id: user.id, name: user.name, email: user.email });

export const revenueEndpoints: Entry[] = [
  ...catalogEndpoints,
  /* Proposals */
  route('GET', /^revenue\/quotes$/, async ({ query }) => ({
    items: await listQuotes({ status: query.get('status') || undefined, dealId: query.get('dealId') ? id(query.get('dealId')!) : undefined, q: query.get('q')?.trim().slice(0, 120) || undefined }),
  }), 'marketer'),
  route('POST', /^revenue\/quotes$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({ dealId: uuid }));
    return json(await createQuoteFromDeal(input.dealId, user.id), 201);
  }, 'marketer'),
  route('GET', /^revenue\/quotes\/([0-9a-f-]{36})$/, async ({ params }) => loadQuote(id(params[0])), 'marketer'),
  route('PATCH', /^revenue\/quotes\/([0-9a-f-]{36})$/, async ({ request, params, user }) => updateQuote(id(params[0]), await readBody(request, quotePatch), user.id), 'marketer'),
  route('POST', /^revenue\/quotes\/([0-9a-f-]{36})\/send$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ email: z.boolean().default(true), message: z.string().trim().max(2000).optional() }));
    return sendQuote(id(params[0]), input, actor(user));
  }, 'marketer'),
  route('POST', /^revenue\/quotes\/([0-9a-f-]{36})\/revise$/, async ({ params, user }) => json(await reviseQuote(id(params[0]), user.id), 201), 'marketer'),
  route('POST', /^revenue\/quotes\/([0-9a-f-]{36})\/void$/, async ({ params, user }) => {
    const quoteId = id(params[0]);
    const done = await db.query(`UPDATE rev_quotes SET status = 'void', updated_at = now() WHERE id = $1 AND status IN ('draft', 'sent') RETURNING id`, [quoteId]);
    if (!done.rows[0]) throw new AppError(409, 'Only draft or sent proposals can be withdrawn.');
    await audit(user.id, 'void', 'quote', quoteId, '');
    return loadQuote(quoteId);
  }, 'marketer'),
  route('DELETE', /^revenue\/quotes\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const quoteId = id(params[0]);
    const done = await db.query(`DELETE FROM rev_quotes WHERE id = $1 AND status = 'draft' RETURNING number`, [quoteId]);
    if (!done.rows[0]) throw new AppError(409, 'Only drafts can be deleted; withdraw a sent proposal instead.');
    await audit(user.id, 'delete', 'quote', quoteId, String((done.rows[0] as { number: string }).number));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  /* Invoices */
  route('GET', /^revenue\/invoices$/, async ({ query }) => listInvoices(query), 'marketer'),
  route('GET', /^revenue\/invoices\/export$/, async ({ query }) => csvResponse(await accountingRows(range(query)), accountingFields, 'ovelio-invoices.csv'), 'marketer'),
  route('GET', /^revenue\/invoices\/([0-9a-f-]{36})$/, async ({ params }) => loadInvoice(id(params[0])), 'marketer'),
  route('POST', /^revenue\/invoices$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({
      dealId: uuid.nullable().optional(), quoteId: uuid.nullable().optional(), kind: z.enum(['manual', 'balance']).default('manual'),
      description: z.string().trim().max(300).default(''), currency: z.string().regex(/^[A-Z]{3}$/).optional(), dueDate: isoDate.nullable().optional(),
      lines: z.array(lineSchema).max(100).optional(),
    }));
    return json(await transaction(async client => {
      let party = { contactId: null as number | null, contactName: '', contactEmail: '', companyName: '', currency: input.currency ?? 'GBP', dealId: input.dealId ?? null };
      let lines = (input.lines ?? []).map(line => priceLine(line));
      if (input.quoteId) {
        const quote = (await client.query<{ id: string; status: string; number: string; title: string; total: string; deal_id: string | null; contact_id: string | null; contact_name: string; contact_email: string; company_name: string; currency: string }>(
          'SELECT id, status, number, title, total, deal_id, contact_id, contact_name, contact_email, company_name, currency FROM rev_quotes WHERE id = $1', [input.quoteId])).rows[0];
        if (!quote) throw new AppError(404, 'That proposal was not found.');
        party = { contactId: quote.contact_id ? Number(quote.contact_id) : null, contactName: quote.contact_name, contactEmail: quote.contact_email, companyName: quote.company_name, currency: quote.currency, dealId: quote.deal_id };
        if (input.kind === 'balance') {
          if (quote.status !== 'accepted') throw new AppError(409, 'Issue the balance once the proposal is accepted.');
          const billed = Number((await client.query<{ sum: string }>(`SELECT coalesce(sum(total), 0) AS sum FROM rev_invoices WHERE quote_id = $1 AND status <> 'void' AND kind IN ('deposit', 'full', 'balance')`, [quote.id])).rows[0].sum);
          const remaining = round2(Number(quote.total) - billed);
          if (remaining <= 0) throw new AppError(409, `${quote.number} has been invoiced in full.`);
          lines = [priceLine({ name: `Balance for ${quote.title}`, quantity: 1, unitPrice: remaining })];
        }
      } else if (input.dealId) {
        const deal = (await client.query<{ contact_id: string | null; contact_name: string; contact_email: string; company_name: string; currency: string }>(
          'SELECT contact_id, contact_name, contact_email, company_name, currency FROM deals WHERE id = $1', [input.dealId])).rows[0];
        if (!deal) throw new AppError(404, 'That deal was not found.');
        party = { ...party, contactId: deal.contact_id ? Number(deal.contact_id) : null, contactName: deal.contact_name, contactEmail: deal.contact_email, companyName: deal.company_name, currency: deal.currency };
      }
      const invoice = await issueInvoice({ ...party, kind: input.kind, description: input.description, dueDate: input.dueDate, lines, quoteId: input.quoteId ?? null, actorId: user.id }, client);
      return loadInvoice(invoice.id, client);
    }), 201);
  }, 'marketer'),
  route('POST', /^revenue\/invoices\/([0-9a-f-]{36})\/payments$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ amount: money, method: z.string().trim().max(60).default('Bank transfer'), note: z.string().trim().max(300).default(''), receivedAt: isoDate.optional() }));
    const invoiceId = id(params[0]);
    await transaction(client => recordPayment({ invoiceId, provider: 'manual', amount: input.amount, method: input.method, note: input.note, receivedAt: input.receivedAt, actorId: user.id }, client));
    return loadInvoice(invoiceId);
  }, 'marketer'),
  route('POST', /^revenue\/payments\/([0-9a-f-]{36})\/refund$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ amount: money, reason: z.string().trim().max(300).default('') }));
    const payment = (await db.query<{ id: string; provider: string; provider_ref: string; currency: string; invoice_id: string }>(
      'SELECT id, provider, provider_ref, currency, invoice_id FROM rev_payments WHERE id = $1', [id(params[0])])).rows[0];
    if (!payment) throw new AppError(404, 'That payment was not found.');
    if (payment.provider === 'stripe') await refundStripePayment(payment, input.amount, input.reason, user.id);
    else await transaction(client => recordRefund({ paymentId: payment.id, providerRef: `manual-refund:${payment.id}:${Date.now()}`, amount: input.amount, reason: input.reason, actorId: user.id }, client));
    return loadInvoice(payment.invoice_id);
  }, 'admin'),
  route('POST', /^revenue\/invoices\/([0-9a-f-]{36})\/void$/, async ({ params, user }) => voidInvoice(id(params[0]), user.id), 'marketer'),
  /* Subscriptions */
  route('GET', /^revenue\/subscriptions$/, async ({ query }) => {
    const status = query.get('status') === 'cancelled' ? 'cancelled' : query.get('status') === 'all' ? null : 'active';
    const rows = await db.query<SubscriptionRow>(`SELECT * FROM rev_subscriptions ${status ? 'WHERE status = $1' : ''} ORDER BY next_invoice_at LIMIT 300`, status ? [status] : []);
    return { items: rows.rows.map(toSubscription) };
  }, 'marketer'),
  route('POST', /^revenue\/subscriptions\/([0-9a-f-]{36})\/cancel$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ reason: z.string().trim().max(300).default('') }));
    const row = (await db.query<SubscriptionRow>(
      `UPDATE rev_subscriptions SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1 AND status = 'active' RETURNING *`, [id(params[0]), input.reason])).rows[0];
    if (!row) throw new AppError(409, 'That subscription is not active.');
    await emitEvent({
      type: 'subscription.cancelled', contactId: row.contact_id ? Number(row.contact_id) : null, dealId: row.deal_id, entityType: 'subscription', entityId: row.id,
      currency: row.currency, actorId: user.id, source: 'revenue', properties: { name: row.name, reason: input.reason }, idempotencyKey: 'subscription.cancelled:' + row.id,
    });
    return toSubscription(row);
  }, 'marketer'),
  /* Overview and settings */
  route('GET', /^revenue\/overview$/, async ({ query }) => revenueOverview(range(query)), 'analyst'),
  route('GET', /^revenue\/deals\/([0-9a-f-]{36})\/summary$/, async ({ params }) => {
    const dealId = id(params[0]);
    const [quotes, invoices] = await Promise.all([listQuotes({ dealId }), listInvoices(new URLSearchParams({ dealId }))]);
    return { quotes, invoices: invoices.items };
  }, 'marketer'),
  route('GET', /^revenue\/settings$/, async () => revenueSettings(), 'marketer'),
  route('PATCH', /^revenue\/settings$/, async ({ request, user }) => {
    const saved = await saveRevenueSettings(await readBody(request, settingsSchema));
    await audit(user.id, 'update', 'settings', 'revenue', 'Revenue settings');
    return saved;
  }, 'admin'),
];

