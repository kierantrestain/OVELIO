// Catalogue (products, services, price lists, tax rates) and deal line items. A deal with line items takes its value
// from their net total (one-time lines plus one period of each recurring line), so the board and forecast stay true.
import { z } from 'zod';
import type { Line, Product, TaxRate } from '@/contracts/revenue';
import { billingCycles, priceLine, totals } from '@/contracts/revenue';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { audit, emitEvent } from '../events';
import { json, readBody } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { currency, lineSchema, money, productSelect, toProduct, toTaxRate, uuid } from './shared';
import type { ProductRow } from './shared';

const productInput = z.object({
  name: z.string().trim().min(1, 'Name the product.').max(200),
  sku: z.string().trim().max(60).default(''),
  description: z.string().trim().max(2000).default(''),
  kind: z.enum(['product', 'service']).default('service'),
  unitPrice: money,
  currency,
  billing: z.enum(billingCycles).default('one_time'),
  taxRateId: uuid.nullable().default(null),
  prices: z.array(z.object({ currency, unitPrice: money })).max(20).default([]),
});

export async function listTaxRates(includeArchived = false): Promise<TaxRate[]> {
  const rows = await db.query<Parameters<typeof toTaxRate>[0]>(
    `SELECT id, name, rate, is_default, archived_at FROM rev_tax_rates ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY is_default DESC, rate DESC, name`);
  return rows.rows.map(toTaxRate);
}

export async function listProducts(options: { q?: string; includeArchived?: boolean } = {}): Promise<Product[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (!options.includeArchived) where.push('p.archived_at IS NULL');
  if (options.q) {
    values.push(`%${options.q.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(p.name ILIKE $1 OR p.sku ILIKE $1 OR p.description ILIKE $1)`);
  }
  const rows = await db.query<ProductRow>(`${productSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.archived_at IS NOT NULL, lower(p.name) LIMIT 500`, values);
  return rows.rows.map(toProduct);
}

export async function loadProduct(id: string, client: Sql = db): Promise<Product> {
  const row = (await client.query<ProductRow>(`${productSelect} WHERE p.id = $1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'That product was not found.');
  return toProduct(row);
}

async function saveProduct(id: string | null, input: z.infer<typeof productInput>, actorId: string) {
  return transaction(async client => {
    if (input.taxRateId) {
      const found = await client.query('SELECT 1 FROM rev_tax_rates WHERE id = $1 AND archived_at IS NULL', [input.taxRateId]);
      if (!found.rows[0]) throw new AppError(400, 'Choose an active tax rate.');
    }
    if (input.sku) {
      const clash = await client.query('SELECT 1 FROM rev_products WHERE lower(sku) = lower($1) AND archived_at IS NULL AND id IS DISTINCT FROM $2', [input.sku, id]);
      if (clash.rows[0]) throw new AppError(409, `Another product already uses the SKU “${input.sku}”.`);
    }
    const values = [input.name, input.sku, input.description, input.kind, input.unitPrice, input.currency, input.billing, input.taxRateId];
    const saved = id
      ? (await client.query<{ id: string }>(`UPDATE rev_products SET name = $2, sku = $3, description = $4, kind = $5, unit_price = $6, currency = $7,
           billing = $8, tax_rate_id = $9, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...values])).rows[0]
      : (await client.query<{ id: string }>(`INSERT INTO rev_products (name, sku, description, kind, unit_price, currency, billing, tax_rate_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [...values, actorId])).rows[0];
    if (!saved) throw new AppError(404, 'That product was not found.');
    await client.query('DELETE FROM rev_product_prices WHERE product_id = $1', [saved.id]);
    const seen = new Set([input.currency]);
    for (const price of input.prices) {
      if (seen.has(price.currency)) continue;
      seen.add(price.currency);
      await client.query('INSERT INTO rev_product_prices (product_id, currency, unit_price) VALUES ($1, $2, $3)', [saved.id, price.currency, price.unitPrice]);
    }
    await audit(actorId, id ? 'update' : 'create', 'product', saved.id, input.name, client);
    return loadProduct(saved.id, client);
  });
}

/** The product's price in a currency: its own price, or its price list entry. */
export function priceIn(product: Product, code: string): number | null {
  if (product.currency === code) return product.unitPrice;
  return product.prices.find(price => price.currency === code)?.unitPrice ?? null;
}

/* ── Deal line items ──────────────────────────────────────────────────── */

type LineRow = { id: string; product_id: string | null; name: string; description: string; quantity: string; unit_price: string; discount_percent: string; tax_rate: string; billing: Line['billing'] };

export async function dealLines(dealId: string, client: Sql = db): Promise<Line[]> {
  const rows = await client.query<LineRow>(
    'SELECT id, product_id, name, description, quantity, unit_price, discount_percent, tax_rate, billing FROM deal_line_items WHERE deal_id = $1 ORDER BY position, created_at', [dealId]);
  return rows.rows.map(row => priceLine({
    id: row.id, productId: row.product_id, name: row.name, description: row.description, quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
    discountPercent: Number(row.discount_percent), taxRate: Number(row.tax_rate), billing: row.billing,
  }));
}

/** Net value a deal takes from its lines: one-time lines plus one period of each recurring line. */
export const dealValue = (lines: Line[]) => {
  const sum = totals(lines);
  return Math.round((sum.oneTimeNet + sum.recurringNet) * 100) / 100;
};

/** Replaces a deal's line items and sets the deal's value from them. */
export async function saveDealLines(dealId: string, input: z.infer<typeof lineSchema>[], actorId: string | null) {
  return transaction(async client => {
    const deal = (await client.query<{ id: string; currency: string; amount: string; contact_id: string | null; company_id: string | null; name: string }>(
      'SELECT id, currency, amount, contact_id, company_id, name FROM deals WHERE id = $1 FOR UPDATE', [dealId])).rows[0];
    if (!deal) throw new AppError(404, 'That deal was not found.');
    await client.query('DELETE FROM deal_line_items WHERE deal_id = $1', [dealId]);
    for (const [position, raw] of input.entries()) {
      const line = priceLine(raw);
      await client.query(
        `INSERT INTO deal_line_items (deal_id, product_id, position, name, description, quantity, unit_price, discount_percent, tax_rate, billing)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [dealId, line.productId, position, line.name, line.description, line.quantity, line.unitPrice, line.discountPercent, line.taxRate, line.billing]);
    }
    const lines = await dealLines(dealId, client);
    const value = lines.length ? dealValue(lines) : Number(deal.amount);
    if (lines.length && value !== Number(deal.amount)) {
      await client.query('UPDATE deals SET amount = $2, updated_at = now() WHERE id = $1', [dealId, value]);
      await emitEvent({
        type: 'deal.updated', dealId, contactId: deal.contact_id ? Number(deal.contact_id) : null, companyId: deal.company_id ? Number(deal.company_id) : null,
        actorId, source: 'revenue', properties: { name: deal.name, changes: ['value'], reason: 'line items' },
      }, client);
    }
    return { lines, totals: totals(lines), currency: deal.currency, dealValue: lines.length ? value : Number(deal.amount) };
  });
}

export const catalogEndpoints: Entry[] = [
  route('GET', /^revenue\/products$/, async ({ query }) => ({ items: await listProducts({ q: query.get('q')?.trim().slice(0, 120) || undefined, includeArchived: query.get('archived') === 'true' }) }), 'marketer'),
  route('POST', /^revenue\/products$/, async ({ request, user }) => json(await saveProduct(null, await readBody(request, productInput), user.id), 201), 'marketer'),
  route('PATCH', /^revenue\/products\/([0-9a-f-]{36})$/, async ({ request, params, user }) => saveProduct(uuid.parse(params[0]), await readBody(request, productInput), user.id), 'marketer'),
  route('POST', /^revenue\/products\/([0-9a-f-]{36})\/archive$/, async ({ request, params, user }) => {
    const { archived } = await readBody(request, z.object({ archived: z.boolean() }));
    const id = uuid.parse(params[0]);
    const product = await loadProduct(id);
    await db.query('UPDATE rev_products SET archived_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1', [id, archived]);
    await audit(user.id, archived ? 'archive' : 'restore', 'product', id, product.name);
    return loadProduct(id);
  }, 'marketer'),
  route('GET', /^revenue\/tax-rates$/, async () => ({ items: await listTaxRates() }), 'marketer'),
  route('POST', /^revenue\/tax-rates$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({ name: z.string().trim().min(1).max(80), rate: z.number().min(0).max(100), isDefault: z.boolean().default(false) }));
    const created = await transaction(async client => {
      if (input.isDefault) await client.query('UPDATE rev_tax_rates SET is_default = false');
      return (await client.query<{ id: string }>('INSERT INTO rev_tax_rates (name, rate, is_default) VALUES ($1, $2, $3) RETURNING id', [input.name, input.rate, input.isDefault])).rows[0];
    });
    await audit(user.id, 'create', 'tax_rate', created.id, input.name);
    return json({ items: await listTaxRates() }, 201);
  }, 'admin'),
  route('POST', /^revenue\/tax-rates\/([0-9a-f-]{36})\/archive$/, async ({ params, user }) => {
    const id = uuid.parse(params[0]);
    await db.query('UPDATE rev_tax_rates SET archived_at = now(), is_default = false WHERE id = $1', [id]);
    await audit(user.id, 'archive', 'tax_rate', id, id);
    return { items: await listTaxRates() };
  }, 'admin'),
  route('GET', /^revenue\/deals\/([0-9a-f-]{36})\/lines$/, async ({ params }) => {
    const id = uuid.parse(params[0]);
    const deal = (await db.query<{ currency: string; amount: string }>('SELECT currency, amount FROM deals WHERE id = $1', [id])).rows[0];
    if (!deal) throw new AppError(404, 'That deal was not found.');
    const lines = await dealLines(id);
    return { lines, totals: totals(lines), currency: deal.currency, dealValue: Number(deal.amount) };
  }, 'marketer'),
  route('POST', /^revenue\/deals\/([0-9a-f-]{36})\/lines$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ lines: z.array(lineSchema).max(100) }));
    return saveDealLines(uuid.parse(params[0]), input.lines, user.id);
  }, 'marketer'),
];
