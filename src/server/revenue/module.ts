// Lane module: Revenue (wave two, CRM & Revenue specialist). docs/rebuild/TRACKER.md §7.
import type { SearchResult } from '@/contracts/platform';
import { priceLine, totals } from '@/contracts/revenue';
import { db } from '../db';
import type { Sql } from '../db';
import { notify } from '../platform/notifications';
import type { LaneModule } from '../platform/types';
import { RENEW_JOB, runRenewal } from './overview';
import { revenueEndpoints } from './routes';
import { formatMoney } from './shared';

async function searchRevenue(query: string): Promise<SearchResult[]> {
  const like = `%${query.trim().replace(/[%_\\]/g, '\\$&')}%`;
  const [quotes, invoices] = await Promise.all([
    db.query<{ id: string; number: string; title: string; status: string; total: string; currency: string }>(
      `SELECT id, number, title, status, total, currency FROM rev_quotes WHERE number ILIKE $1 OR title ILIKE $1 OR company_name ILIKE $1 OR contact_name ILIKE $1 ORDER BY updated_at DESC LIMIT 3`, [like]),
    db.query<{ id: string; number: string; status: string; total: string; currency: string; company_name: string; contact_name: string }>(
      `SELECT id, number, status, total, currency, company_name, contact_name FROM rev_invoices WHERE number ILIKE $1 OR company_name ILIKE $1 OR contact_name ILIKE $1 ORDER BY issued_at DESC LIMIT 2`, [like]),
  ]);
  return [
    ...quotes.rows.map(row => ({ id: 'quote:' + row.id, kind: 'quote' as const, title: `${row.number} · ${row.title}`, subtitle: `${formatMoney(Number(row.total), row.currency)} · ${row.status}`, href: `/sales/proposals/${row.id}` })),
    ...invoices.rows.map(row => ({ id: 'invoice:' + row.id, kind: 'invoice' as const, title: `Invoice ${row.number}`, subtitle: [formatMoney(Number(row.total), row.currency), row.status, row.company_name || row.contact_name].filter(Boolean).join(' · '), href: `/sales/invoices?invoice=${row.id}` })),
  ].slice(0, 5);
}

/** Owner (deal owner, else proposal author) of the record an event is about. */
async function ownerOf(entityType: string | null, entityId: string | null) {
  if (!entityId) return null;
  const table = entityType === 'invoice' ? 'rev_invoices' : entityType === 'quote' ? 'rev_quotes' : null;
  if (!table) return null;
  const row = (await db.query<{ owner: string | null; number: string; quote_id: string | null }>(
    `SELECT coalesce(d.owner_id, x.created_by) AS owner, x.number, ${table === 'rev_invoices' ? 'x.quote_id' : 'x.id'} AS quote_id FROM ${table} x LEFT JOIN deals d ON d.id = x.deal_id WHERE x.id = $1`, [entityId])).rows[0];
  return row ?? null;
}

async function seedRevenuePreview(sql: Sql) {
  if ((await sql.query(`SELECT 1 FROM rev_products LIMIT 1`)).rows.length) return;
  const vat = (await sql.query<{ id: string }>(`INSERT INTO rev_tax_rates (name, rate, is_default) VALUES ('UK VAT (standard)', 20, true) RETURNING id`)).rows[0].id;
  await sql.query(`INSERT INTO rev_tax_rates (name, rate) VALUES ('Zero rated', 0)`);
  const products: [string, string, string, number, string, string][] = [
    ['Growth strategy workshop (sample)', 'WS-01', 'service', 2400, 'one_time', 'Two half-day sessions with your leadership team.'],
    ['Website build: 10 pages (sample)', 'WEB-10', 'service', 6500, 'one_time', 'Design, build and launch on your domain.'],
    ['Marketing automation retainer (sample)', 'RET-M', 'service', 1800, 'monthly', 'Campaigns, workflows and monthly reporting.'],
    ['Analytics dashboard licence (sample)', 'LIC-Y', 'product', 1200, 'yearly', 'Annual licence for up to 10 users.'],
  ];
  const ids = new Map<string, string>();
  for (const [name, sku, kind, price, billing, description] of products) {
    const row = (await sql.query<{ id: string }>(
      `INSERT INTO rev_products (name, sku, kind, unit_price, currency, billing, tax_rate_id, description) VALUES ($1, $2, $3, $4, 'GBP', $5, $6, $7) RETURNING id`,
      [name, sku, kind, price, billing, vat, description])).rows[0];
    ids.set(sku, row.id);
  }
  await sql.query(`INSERT INTO rev_product_prices (product_id, currency, unit_price) VALUES ($1, 'EUR', 2800), ($1, 'USD', 3000)`, [ids.get('WS-01')]);
  // Line items on one open sample deal, so the deal page shows products and a draft proposal can be made from them.
  const deal = (await sql.query<{ id: string }>(`SELECT id FROM deals WHERE source = 'preview-seed' AND status = 'open' ORDER BY amount DESC LIMIT 1`)).rows[0];
  if (!deal) return;
  const lines = [
    priceLine({ productId: ids.get('WS-01'), name: 'Growth strategy workshop (sample)', quantity: 1, unitPrice: 2400, taxRate: 20 }),
    priceLine({ productId: ids.get('RET-M'), name: 'Marketing automation retainer (sample)', quantity: 1, unitPrice: 1800, discountPercent: 10, taxRate: 20, billing: 'monthly' }),
  ];
  for (const [position, line] of lines.entries()) {
    await sql.query(
      `INSERT INTO deal_line_items (deal_id, product_id, position, name, quantity, unit_price, discount_percent, tax_rate, billing) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [deal.id, line.productId, position, line.name, line.quantity, line.unitPrice, line.discountPercent, line.taxRate, line.billing]);
  }
  const sum = totals(lines);
  await sql.query(`UPDATE deals SET amount = $2 WHERE id = $1`, [deal.id, sum.oneTimeNet + sum.recurringNet]);
}

export const revenueModule: LaneModule = {
  name: 'revenue',
  endpoints: revenueEndpoints,
  jobHandlers: { [RENEW_JOB]: runRenewal },
  async onPlatformEvent(event) {
    const notices: Partial<Record<typeof event.type, (number: string) => { title: string; body: string }>> = {
      'quote.viewed': number => ({ title: `Proposal ${number} opened`, body: 'Your client is reading the proposal now: a good moment to follow up.' }),
      'quote.accepted': number => ({ title: `Proposal ${number} accepted`, body: 'Signed electronically. The first invoice has been issued.' }),
      'quote.declined': number => ({ title: `Proposal ${number} declined`, body: String(event.properties.reason || 'No reason given.') }),
      'payment.succeeded': number => ({ title: `Payment received for ${number}`, body: event.amount != null && event.currency ? formatMoney(event.amount, event.currency) : '' }),
      'payment.failed': number => ({ title: `Payment failed for ${number}`, body: String(event.properties.reason || '') }),
    };
    const make = notices[event.type];
    if (!make) return;
    const owner = await ownerOf(event.entityType, event.entityId);
    if (!owner?.owner) return;
    const href = owner.quote_id ? `/sales/proposals/${owner.quote_id}` : '/sales/invoices';
    await notify({ userIds: [owner.owner], kind: event.type, ...make(owner.number), href, dedupeKey: `${event.type}:${event.id}` });
  },
  search: searchRevenue,
  seedPreview: seedRevenuePreview,
};
