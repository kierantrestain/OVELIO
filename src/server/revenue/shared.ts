// Revenue lane helpers: row mappers, public link tokens, workspace branding, settings and Stripe configuration.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { CompanySettings } from '@/contracts';
import type { Invoice, InvoiceSummary, Line, Payment, Product, Quote, QuoteSummary, RevenueSettings, Subscription, TaxRate } from '@/contracts/revenue';
import { billingCycles, defaultRevenueSettings, priceLine, totals } from '@/contracts/revenue';
import { appOrigin } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { devPreviewCompany, isDevPreviewMode } from '../dev-preview';

export const uuid = z.uuid();
export const currency = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code.').transform(value => value.toUpperCase());
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
export const money = z.number().min(0).max(1e10);

export const lineSchema = z.object({
  productId: uuid.nullable().optional(),
  name: z.string().trim().min(1, 'Name each line.').max(200),
  description: z.string().trim().max(1000).optional(),
  quantity: z.number().positive('Quantities must be above zero.').max(1e6),
  unitPrice: money,
  discountPercent: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  billing: z.enum(billingCycles).optional(),
});

const iso = (value: Date | string | null | undefined) => value == null ? null : new Date(value).toISOString();
const day = (value: Date | string | null | undefined) => value == null ? null : typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
const num = (value: unknown) => value == null ? 0 : Number(value);

export const newToken = () => randomBytes(24).toString('base64url');
export const tokenPattern = /^[A-Za-z0-9_-]{32}$/;

/** Absolute address for proposal and invoice links: APP_ORIGIN, else the Vercel deployment's address. */
export function origin() {
  try { return appOrigin(); } catch { /* not configured */ }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : 'http://localhost:3000';
}

export async function workspace(): Promise<CompanySettings> {
  if (isDevPreviewMode()) return devPreviewCompany();
  const { company } = await import('../reporting');
  return company();
}

/* ── Settings ─────────────────────────────────────────────────────────── */

export const settingsSchema = z.object({
  defaultTerms: z.string().trim().max(4000),
  paymentInstructions: z.string().trim().max(2000),
  quoteValidityDays: z.number().int().min(1).max(365),
  invoiceDueDays: z.number().int().min(0).max(365),
  onboardingTasks: z.array(z.string().trim().min(1).max(200)).max(12),
});

export async function revenueSettings(client: Sql = db): Promise<RevenueSettings> {
  const row = (await client.query<{ value: Partial<RevenueSettings> }>(`SELECT value FROM settings WHERE key = 'revenue'`)).rows[0];
  return { ...defaultRevenueSettings, ...row?.value };
}

export async function saveRevenueSettings(input: RevenueSettings) {
  await db.query(`INSERT INTO settings (key, value) VALUES ('revenue', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(input)]);
  return revenueSettings();
}

/* ── Stripe configuration ─────────────────────────────────────────────── */

export function stripeConfig() {
  const key = process.env.STRIPE_SECRET_KEY?.trim() || '';
  const mode = /^(sk|rk)_live_/.test(key) ? 'live' as const : /^(sk|rk)_test_/.test(key) ? 'test' as const : null;
  return { key, configured: Boolean(key && mode), webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()), mode };
}

/* ── Mappers ──────────────────────────────────────────────────────────── */

type TaxRow = { id: string; name: string; rate: string; is_default: boolean; archived_at: Date | null };
export const toTaxRate = (row: TaxRow): TaxRate => ({ id: row.id, name: row.name, rate: num(row.rate), isDefault: row.is_default, archived: Boolean(row.archived_at) });

export type ProductRow = {
  id: string; name: string; sku: string; description: string; kind: Product['kind']; unit_price: string; currency: string; billing: Product['billing'];
  tax_rate_id: string | null; tax_rate: string | null; prices: { currency: string; unit_price: string }[] | null; archived_at: Date | null; updated_at: Date;
};
export const productSelect = `SELECT p.id, p.name, p.sku, p.description, p.kind, p.unit_price, p.currency, p.billing, p.tax_rate_id, t.rate AS tax_rate,
  (SELECT json_agg(json_build_object('currency', pp.currency, 'unit_price', pp.unit_price) ORDER BY pp.currency) FROM rev_product_prices pp WHERE pp.product_id = p.id) AS prices,
  p.archived_at, p.updated_at
  FROM rev_products p LEFT JOIN rev_tax_rates t ON t.id = p.tax_rate_id`;
export const toProduct = (row: ProductRow): Product => ({
  id: row.id, name: row.name, sku: row.sku, description: row.description, kind: row.kind, unitPrice: num(row.unit_price), currency: row.currency,
  billing: row.billing, taxRateId: row.tax_rate_id, taxRate: num(row.tax_rate),
  prices: (row.prices ?? []).map(price => ({ currency: price.currency, unitPrice: num(price.unit_price) })),
  archived: Boolean(row.archived_at), updatedAt: iso(row.updated_at)!,
});

/** Lines stored as JSON (quotes, invoices, subscriptions) are re-priced on read so totals always match the lines. */
export const readLines = (raw: unknown): Line[] => (Array.isArray(raw) ? raw : []).map(line => priceLine(line as Line));

export type QuoteRow = {
  id: string; number: string; deal_id: string | null; deal_name: string | null; contact_id: string | null; contact_name: string; contact_email: string;
  company_name: string; title: string; intro: string; terms: string; currency: string; lines: unknown; total: string; monthly_recurring: string;
  deposit_percent: string; valid_until: Date | string | null; status: Quote['status']; token: string | null; sent_at: Date | null;
  first_viewed_at: Date | null; last_viewed_at: Date | null; view_count: number; accepted_at: Date | null; declined_at: Date | null;
  decline_reason: string; signer_name: string; signer_email: string; document_hash: string; updated_at: Date;
};
export const quoteSelect = `SELECT q.*, d.name AS deal_name FROM rev_quotes q LEFT JOIN deals d ON d.id = q.deal_id`;

export function toQuoteSummary(row: QuoteRow, today = new Date().toISOString().slice(0, 10)): QuoteSummary {
  const validUntil = day(row.valid_until);
  return {
    id: row.id, number: row.number, title: row.title, status: row.status, expired: row.status === 'sent' && Boolean(validUntil && validUntil < today),
    dealId: row.deal_id, dealName: row.deal_name, contactId: row.contact_id == null ? null : Number(row.contact_id), contactName: row.contact_name,
    contactEmail: row.contact_email, companyName: row.company_name, currency: row.currency, total: num(row.total), monthlyRecurring: num(row.monthly_recurring),
    validUntil, sentAt: iso(row.sent_at), viewCount: row.view_count, lastViewedAt: iso(row.last_viewed_at), acceptedAt: iso(row.accepted_at),
    declinedAt: iso(row.declined_at), updatedAt: iso(row.updated_at)!,
  };
}

export function toQuote(row: QuoteRow, invoices: InvoiceSummary[]): Quote {
  const lines = readLines(row.lines);
  return {
    ...toQuoteSummary(row), intro: row.intro, terms: row.terms, lines, totals: totals(lines), depositPercent: num(row.deposit_percent),
    publicUrl: row.token && row.status !== 'draft' ? `${origin()}/proposal/${row.token}` : null, declineReason: row.decline_reason,
    signerName: row.signer_name, signerEmail: row.signer_email, documentHash: row.document_hash, firstViewedAt: iso(row.first_viewed_at), invoices,
  };
}

export type InvoiceRow = {
  id: string; number: string; quote_id: string | null; quote_number: string | null; deal_id: string | null; contact_id: string | null; contact_name: string;
  contact_email: string; company_name: string; kind: Invoice['kind']; description: string; currency: string; lines: unknown; subtotal: string;
  tax_total: string; total: string; amount_paid: string; amount_refunded: string; status: Invoice['status']; issued_at: Date;
  due_date: Date | string | null; paid_at: Date | null; token: string | null; payment_url: string; subscription_id: string | null;
  stripe_session_id: string | null; stripe_payment_intent: string | null;
};
export const invoiceSelect = `SELECT i.*, q.number AS quote_number FROM rev_invoices i LEFT JOIN rev_quotes q ON q.id = i.quote_id`;

export function toInvoiceSummary(row: InvoiceRow, today = new Date().toISOString().slice(0, 10)): InvoiceSummary {
  const total = num(row.total);
  const paid = num(row.amount_paid);
  const dueDate = day(row.due_date);
  return {
    id: row.id, number: row.number, kind: row.kind, status: row.status, overdue: row.status === 'open' && Boolean(dueDate && dueDate < today),
    description: row.description, currency: row.currency, total, amountPaid: paid, amountRefunded: num(row.amount_refunded),
    balance: row.status === 'void' ? 0 : Math.max(0, Math.round((total - paid) * 100) / 100), issuedAt: iso(row.issued_at)!, dueDate,
    paidAt: iso(row.paid_at), contactId: row.contact_id == null ? null : Number(row.contact_id), contactName: row.contact_name,
    contactEmail: row.contact_email, companyName: row.company_name, dealId: row.deal_id, quoteId: row.quote_id, quoteNumber: row.quote_number,
    publicUrl: row.token ? `${origin()}/pay/${row.token}` : null, paymentUrl: row.payment_url,
  };
}

export type PaymentRow = {
  id: string; invoice_id: string; invoice_number: string; provider: Payment['provider']; method: string; amount: string; refunded: string;
  currency: string; note: string; received_at: Date; contact_name: string;
};
export const paymentSelect = `SELECT p.id, p.invoice_id, i.number AS invoice_number, p.provider, p.method, p.amount, p.refunded, p.currency, p.note,
  p.received_at, i.contact_name FROM rev_payments p JOIN rev_invoices i ON i.id = p.invoice_id`;
export const toPayment = (row: PaymentRow): Payment => ({
  id: row.id, invoiceId: row.invoice_id, invoiceNumber: row.invoice_number, provider: row.provider, method: row.method, amount: num(row.amount),
  refunded: num(row.refunded), currency: row.currency, note: row.note, receivedAt: iso(row.received_at)!, contactName: row.contact_name,
});

export type SubscriptionRow = {
  id: string; name: string; status: Subscription['status']; interval: Subscription['interval']; currency: string; amount: string; monthly_value: string;
  contact_id: string | null; contact_name: string; contact_email: string; company_name: string; deal_id: string | null; quote_id: string | null;
  lines: unknown; started_at: Date; next_invoice_at: Date; cancelled_at: Date | null; cancel_reason: string;
};
export const toSubscription = (row: SubscriptionRow): Subscription => ({
  id: row.id, name: row.name, status: row.status, interval: row.interval, currency: row.currency, amount: num(row.amount), monthlyValue: num(row.monthly_value),
  contactId: row.contact_id == null ? null : Number(row.contact_id), contactName: row.contact_name, companyName: row.company_name, dealId: row.deal_id,
  quoteId: row.quote_id, startedAt: iso(row.started_at)!, nextInvoiceAt: iso(row.next_invoice_at)!, cancelledAt: iso(row.cancelled_at), cancelReason: row.cancel_reason,
});

export const formatMoney = (amount: number, code: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).format(amount);
