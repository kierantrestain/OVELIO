// Proposals and quotations: drafted from a deal's line items, sent as a branded public page, accepted with an
// electronic signature (typed name + explicit consent, with a SHA-256 of the exact commercial content, time, IP hash
// and browser recorded), or declined with a reason. Acceptance closes the deal as won, issues the first invoice,
// starts subscriptions for recurring lines and (when no deposit is required) the onboarding tasks.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Line, Quote, QuoteSummary } from '@/contracts/revenue';
import { intervalMonths, monthlyValue, priceLine, round2, totals } from '@/contracts/revenue';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { getContact } from '../directory';
import { audit, emitEvent } from '../events';
import { sendEmail } from '../mailer';
import type { SendResult } from '../mailer';
import { logActivity, moveDeal } from '../records';
import { dealLines } from './catalog';
import { addDays, issueInvoice, startOnboarding } from './invoices';
import {
  formatMoney, invoiceSelect, isoDate, lineSchema, newToken, quoteSelect, readLines, revenueSettings, toInvoiceSummary, toQuote, toQuoteSummary, uuid, workspace,
} from './shared';
import type { InvoiceRow, QuoteRow } from './shared';

export const quotePatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  intro: z.string().trim().max(8000).optional(),
  terms: z.string().trim().max(8000).optional(),
  validUntil: isoDate.nullable().optional(),
  depositPercent: z.number().min(0).max(100).optional(),
  contactId: z.number().int().positive().nullable().optional(),
  lines: z.array(lineSchema).max(100).optional(),
});

function computed(lines: Line[]) {
  const sum = totals(lines);
  return { lines, sum, values: [JSON.stringify(lines), round2(sum.subtotal), sum.discountTotal, sum.taxTotal, sum.total, sum.monthlyRecurring] as const };
}

export async function loadQuote(id: string, client: Sql = db): Promise<Quote> {
  const row = (await client.query<QuoteRow>(`${quoteSelect} WHERE q.id = $1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'That proposal was not found.');
  const invoices = await client.query<InvoiceRow>(`${invoiceSelect} WHERE i.quote_id = $1 ORDER BY i.issued_at`, [id]);
  return toQuote(row, invoices.rows.map(item => toInvoiceSummary(item)));
}

export async function listQuotes(filters: { status?: string; dealId?: string; q?: string }): Promise<QuoteSummary[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll('?', '$' + values.length)); };
  if (filters.status === 'expired') where.push(`q.status = 'sent' AND q.valid_until < current_date`);
  else if (filters.status) add('q.status = ?', filters.status);
  if (filters.dealId) add('q.deal_id = ?', filters.dealId);
  if (filters.q) add('(q.title ILIKE ? OR q.number ILIKE ? OR q.contact_name ILIKE ? OR q.company_name ILIKE ?)', `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`);
  const rows = await db.query<QuoteRow>(`${quoteSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.updated_at DESC LIMIT 300`, values);
  return rows.rows.map(row => toQuoteSummary(row));
}

/** A new draft from a deal: its line items, people and currency, with the workspace's default terms. */
export async function createQuoteFromDeal(dealId: string, actorId: string) {
  const deal = (await db.query<{ id: string; name: string; currency: string; contact_id: string | null; contact_name: string; contact_email: string; company_name: string; amount: string }>(
    'SELECT id, name, currency, contact_id, contact_name, contact_email, company_name, amount FROM deals WHERE id = $1', [dealId])).rows[0];
  if (!deal) throw new AppError(404, 'That deal was not found.');
  const settings = await revenueSettings();
  let lines = await dealLines(dealId);
  if (!lines.length && Number(deal.amount) > 0) lines = [priceLine({ name: deal.name, quantity: 1, unitPrice: Number(deal.amount) })];
  const { values } = computed(lines.map(line => ({ ...line, id: undefined })));
  const number = 'Q-' + (await db.query<{ n: string }>(`SELECT nextval('rev_quote_number') AS n`)).rows[0].n;
  const row = (await db.query<{ id: string }>(
    `INSERT INTO rev_quotes (number, deal_id, contact_id, contact_name, contact_email, company_name, title, terms, currency, valid_until,
       lines, subtotal, discount_total, tax_total, total, monthly_recurring, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
    [number, deal.id, deal.contact_id, deal.contact_name, deal.contact_email, deal.company_name, `Proposal: ${deal.name}`, settings.defaultTerms,
      deal.currency, addDays(settings.quoteValidityDays), ...values, actorId],
  )).rows[0];
  await audit(actorId, 'create', 'quote', row.id, number);
  return loadQuote(row.id);
}

export async function updateQuote(id: string, input: z.infer<typeof quotePatch>, actorId: string) {
  return transaction(async client => {
    const current = (await client.query<{ status: string }>('SELECT status FROM rev_quotes WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!current) throw new AppError(404, 'That proposal was not found.');
    if (current.status !== 'draft') throw new AppError(409, 'Sent proposals cannot change. Create a revision instead.');
    const sets: string[] = [];
    const values: unknown[] = [id];
    const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    if (input.title !== undefined) set('title', input.title);
    if (input.intro !== undefined) set('intro', input.intro);
    if (input.terms !== undefined) set('terms', input.terms);
    if (input.validUntil !== undefined) set('valid_until', input.validUntil);
    if (input.depositPercent !== undefined) set('deposit_percent', input.depositPercent);
    if (input.contactId !== undefined) {
      const contact = input.contactId ? await getContact(input.contactId) : null;
      if (input.contactId && !contact) throw new AppError(404, 'That contact was not found.');
      set('contact_id', contact?.id ?? null);
      set('contact_name', contact?.name ?? '');
      set('contact_email', contact?.email ?? '');
      if (contact?.company) set('company_name', contact.company);
    }
    if (input.lines) {
      const { values: priced } = computed(input.lines.map(line => priceLine(line)));
      ['lines', 'subtotal', 'discount_total', 'tax_total', 'total', 'monthly_recurring'].forEach((column, index) => set(column, priced[index]));
    }
    if (sets.length) await client.query(`UPDATE rev_quotes SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    await audit(actorId, 'update', 'quote', id, '', client);
    return loadQuote(id, client);
  });
}

/** Freezes a draft and gives it its public link; emails the contact when asked. */
export async function sendQuote(id: string, input: { email: boolean; message?: string }, actor: { id: string; name: string; email: string }) {
  const quote = await loadQuote(id);
  if (quote.status !== 'draft') throw new AppError(409, `${quote.number} has already been sent.`);
  if (!quote.lines.length || quote.totals.total <= 0) throw new AppError(400, 'Add at least one priced line before sending.');
  if (input.email && !quote.contactEmail) throw new AppError(400, 'Choose who the proposal is for before emailing it.');
  const token = newToken();
  await db.query(`UPDATE rev_quotes SET status = 'sent', token = $2, sent_at = now(), updated_at = now() WHERE id = $1 AND status = 'draft'`, [id, token]);
  const sent = await loadQuote(id);
  let delivery: SendResult | null = null;
  if (input.email) {
    const company = await workspace();
    const intro = input.message?.trim() || `Here is our proposal “${sent.title}”.`;
    const html = `<p>Hi {{contact.first_name | there}},</p><p>${escapeHtml(intro).replace(/\n/g, '<br>')}</p>`
      + `<p><a href="${sent.publicUrl}" style="display:inline-block;padding:12px 20px;background:${company.accent || '#2457d6'};color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Review and accept</a></p>`
      + `<p>Total ${formatMoney(sent.totals.total, sent.currency)}${sent.validUntil ? `, valid until ${sent.validUntil}` : ''}.</p><p>${escapeHtml(actor.name)}</p>`;
    delivery = await sendEmail({
      to: sent.contactEmail, subject: `${sent.title} (${sent.number})`, html, category: 'sales', source: `quote:${id}`, contactId: sent.contactId,
      replyTo: actor.email, fromName: actor.name, createdBy: actor.id, idempotencyKey: `quote.send:${id}`,
    });
  }
  await emitEvent({
    type: 'quote.sent', contactId: sent.contactId, dealId: sent.dealId, entityType: 'quote', entityId: id, amount: sent.totals.total, currency: sent.currency,
    actorId: actor.id, source: 'revenue', properties: { number: sent.number, title: sent.title, emailed: Boolean(input.email), delivery: delivery?.status ?? null },
    idempotencyKey: 'quote.sent:' + id,
  });
  return { quote: sent, delivery };
}

/** A new draft copying a sent, declined or expired proposal; the original is voided unless it was accepted. */
export async function reviseQuote(id: string, actorId: string) {
  const source = await loadQuote(id);
  const number = 'Q-' + (await db.query<{ n: string }>(`SELECT nextval('rev_quote_number') AS n`)).rows[0].n;
  const settings = await revenueSettings();
  const { values } = computed(source.lines.map(line => priceLine({ ...line, id: undefined })));
  const row = (await db.query<{ id: string }>(
    `INSERT INTO rev_quotes (number, deal_id, contact_id, contact_name, contact_email, company_name, title, intro, terms, currency, valid_until,
       deposit_percent, lines, subtotal, discount_total, tax_total, total, monthly_recurring, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
    [number, source.dealId, source.contactId, source.contactName, source.contactEmail, source.companyName, source.title, source.intro, source.terms,
      source.currency, addDays(settings.quoteValidityDays), source.depositPercent, ...values, actorId],
  )).rows[0];
  if (source.status === 'sent' || source.status === 'declined') await db.query(`UPDATE rev_quotes SET status = 'void', updated_at = now() WHERE id = $1`, [id]);
  await audit(actorId, 'revise', 'quote', row.id, `${number} revises ${source.number}`);
  return loadQuote(row.id);
}

/* ── Public side ──────────────────────────────────────────────────────── */

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function quoteByToken(token: string, client: Sql = db) {
  const row = (await client.query<QuoteRow>(`${quoteSelect} WHERE q.token = $1 AND q.status <> 'draft'`, [token])).rows[0];
  return row ?? null;
}

/** The exact commercial content the signer agrees to. */
export function documentHash(row: Pick<QuoteRow, 'number' | 'title' | 'currency' | 'lines' | 'terms' | 'valid_until' | 'deposit_percent' | 'total'>) {
  const content = {
    number: row.number, title: row.title, currency: row.currency, lines: readLines(row.lines).map(line => ({ ...line, id: undefined })), terms: row.terms,
    validUntil: row.valid_until ? String(row.valid_until instanceof Date ? row.valid_until.toISOString() : row.valid_until).slice(0, 10) : null,
    depositPercent: Number(row.deposit_percent), total: Number(row.total),
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export async function recordQuoteView(row: QuoteRow) {
  await db.query(`UPDATE rev_quotes SET view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now() WHERE id = $1`, [row.id]);
  await emitEvent({
    type: 'quote.viewed', contactId: row.contact_id ? Number(row.contact_id) : null, dealId: row.deal_id, entityType: 'quote', entityId: row.id, source: 'revenue',
    properties: { number: row.number, title: row.title }, idempotencyKey: `quote.viewed:${row.id}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export const acceptInput = z.object({
  signerName: z.string().trim().min(2, 'Type your full name to sign.').max(120),
  signerEmail: z.email('Enter your email address.').max(254),
  agree: z.literal(true, { message: 'Tick the box to confirm you agree and that this is your signature.' }),
});

export async function acceptQuote(token: string, input: z.infer<typeof acceptInput>, meta: { ipHash: string; agent: string }) {
  const accepted = await transaction(async client => {
    const row = (await client.query<QuoteRow>(`SELECT q.*, NULL::text AS deal_name FROM rev_quotes q WHERE q.token = $1 FOR UPDATE`, [token])).rows[0];
    if (!row || row.status === 'draft') throw new AppError(404, 'This proposal is not available.');
    if (row.status === 'accepted') return { row, already: true };
    if (row.status !== 'sent') throw new AppError(409, row.status === 'declined' ? 'This proposal was declined. Ask for a new one.' : 'This proposal has been withdrawn.');
    const validUntil = row.valid_until ? String(row.valid_until instanceof Date ? row.valid_until.toISOString() : row.valid_until).slice(0, 10) : null;
    if (validUntil && validUntil < new Date().toISOString().slice(0, 10)) throw new AppError(409, `This proposal expired on ${validUntil}. Ask for an updated one.`);
    const hash = documentHash(row);
    const updated = (await client.query<QuoteRow>(
      `UPDATE rev_quotes SET status = 'accepted', accepted_at = now(), signer_name = $2, signer_email = $3, signer_ip_hash = $4, signer_agent = $5,
         document_hash = $6, updated_at = now() WHERE id = $1 RETURNING *, NULL::text AS deal_name`,
      [row.id, input.signerName, input.signerEmail.toLowerCase(), meta.ipHash, meta.agent.slice(0, 300), hash])).rows[0];
    const contactId = row.contact_id ? Number(row.contact_id) : null;
    await emitEvent({
      type: 'quote.accepted', contactId, dealId: row.deal_id, entityType: 'quote', entityId: row.id, amount: Number(row.total), currency: row.currency, source: 'revenue',
      properties: { number: row.number, title: row.title, signerName: input.signerName, documentHash: hash }, idempotencyKey: 'quote.accepted:' + row.id,
    }, client);
    if (row.deal_id || contactId) {
      await logActivity({
        type: 'note', subject: `Proposal ${row.number} accepted`, contactId, dealId: row.deal_id,
        body: `Signed electronically by ${input.signerName} <${input.signerEmail}>. Document SHA-256 ${hash}.`,
      }, client);
    }
    // First invoice: the deposit, or everything due now (one-time lines plus the first period of recurring ones).
    const lines = readLines(row.lines);
    const deposit = Number(row.deposit_percent);
    const party = { quoteId: row.id, dealId: row.deal_id, contactId, contactName: row.contact_name, contactEmail: row.contact_email, companyName: row.company_name, currency: row.currency };
    if (deposit > 0 && deposit < 100) {
      const amount = round2(Number(row.total) * deposit / 100);
      await issueInvoice({ ...party, kind: 'deposit', description: `${deposit}% deposit for ${row.number}`, dueDate: addDays(0),
        lines: [priceLine({ name: `Deposit (${deposit}%) for ${row.title}`, quantity: 1, unitPrice: amount })] }, client);
    } else {
      await issueInvoice({ ...party, kind: 'full', description: row.title, dueDate: deposit >= 100 ? addDays(0) : undefined, lines }, client);
    }
    // Recurring lines become subscriptions (one per billing cycle); their next invoices come from the renewal job.
    const cycles = [...new Set(lines.filter(line => line.billing !== 'one_time').map(line => line.billing))] as ('monthly' | 'quarterly' | 'yearly')[];
    for (const cycle of cycles) {
      const recurring = lines.filter(line => line.billing === cycle);
      const sum = totals(recurring);
      const next = new Date();
      next.setUTCMonth(next.getUTCMonth() + intervalMonths(cycle));
      const subscription = (await client.query<{ id: string }>(
        `INSERT INTO rev_subscriptions (quote_id, deal_id, contact_id, contact_name, contact_email, company_name, name, currency, interval, lines, amount, monthly_value, next_invoice_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [row.id, row.deal_id, contactId, row.contact_name, row.contact_email, row.company_name, `${row.title} (${cycle})`, row.currency, cycle,
          JSON.stringify(recurring), sum.total, recurring.reduce((acc, line) => acc + monthlyValue(line.net, line.billing), 0), next.toISOString()])).rows[0];
      await emitEvent({
        type: 'subscription.started', contactId, dealId: row.deal_id, entityType: 'subscription', entityId: subscription.id, amount: sum.total, currency: row.currency,
        source: 'revenue', properties: { name: row.title, interval: cycle, quoteId: row.id }, idempotencyKey: 'subscription.started:' + subscription.id,
      }, client);
      const { schedulePlatformJob } = await import('../platform/jobs');
      await schedulePlatformJob('revenue.renew', `${subscription.id}:${next.toISOString().slice(0, 10)}`, { subscriptionId: subscription.id }, { runAt: next, client });
    }
    if (deposit === 0) await startOnboarding(row.id, client);
    return { row: updated, already: false };
  });
  // Closing the deal runs after the acceptance is committed (moveDeal uses its own transaction).
  if (!accepted.already && accepted.row.deal_id) {
    const deal = (await db.query<{ status: string; pipeline_id: string }>('SELECT status, pipeline_id FROM deals WHERE id = $1', [accepted.row.deal_id])).rows[0];
    const won = deal?.status === 'open'
      ? (await db.query<{ id: string }>(`SELECT id FROM pipeline_stages WHERE pipeline_id = $1 AND outcome = 'won' ORDER BY position LIMIT 1`, [deal.pipeline_id])).rows[0]
      : undefined;
    if (won) await moveDeal(accepted.row.deal_id, { stageId: won.id, source: 'revenue' });
  }
  return accepted;
}

export const declineInput = z.object({ reason: z.string().trim().max(1000).default('') });

export async function declineQuote(token: string, reason: string) {
  const row = (await db.query<QuoteRow>(
    `UPDATE rev_quotes SET status = 'declined', declined_at = now(), decline_reason = $2, updated_at = now() WHERE token = $1 AND status = 'sent' RETURNING *, NULL::text AS deal_name`,
    [token, reason])).rows[0];
  if (!row) throw new AppError(409, 'This proposal can no longer be declined.');
  await emitEvent({
    type: 'quote.declined', contactId: row.contact_id ? Number(row.contact_id) : null, dealId: row.deal_id, entityType: 'quote', entityId: row.id, source: 'revenue',
    properties: { number: row.number, title: row.title, reason }, idempotencyKey: 'quote.declined:' + row.id,
  });
  return row;
}

export const quoteId = (value: string) => uuid.parse(value);
