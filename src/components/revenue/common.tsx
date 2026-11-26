'use client';

// Shared pieces of the revenue screens: money formatting, status badges and the line-item editor used on deals and
// proposals. Totals are computed with the same functions as the server (src/contracts/revenue.ts).
import '@/styles/revenue.css';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Billing, InvoiceSummary, LineInput, Product, QuoteSummary, TaxRate } from '@/contracts/revenue';
import { billingCycles, billingLabels, priceLine, totals } from '@/contracts/revenue';
import { useResource } from '../client';
import { StatusBadge } from '../ui';
import type { Tone } from '../ui';

export function cash(amount: number | null | undefined, currency = 'GBP') {
  if (amount == null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const quoteTone: Record<QuoteSummary['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, sent: { label: 'Sent', tone: 'info' }, accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'error' }, void: { label: 'Withdrawn', tone: 'warning' },
};
export function QuoteBadge({ quote }: { quote: Pick<QuoteSummary, 'status' | 'expired' | 'viewCount'> }) {
  if (quote.expired) return <StatusBadge label="Expired" tone="warning" />;
  const item = quoteTone[quote.status];
  return <StatusBadge label={quote.status === 'sent' && quote.viewCount ? 'Viewed' : item.label} tone={item.tone} />;
}

const invoiceTone: Record<InvoiceSummary['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, open: { label: 'Open', tone: 'info' }, paid: { label: 'Paid', tone: 'success' }, void: { label: 'Void', tone: 'warning' },
};
export function InvoiceBadge({ invoice }: { invoice: Pick<InvoiceSummary, 'status' | 'overdue' | 'amountPaid' | 'amountRefunded' | 'total'> }) {
  if (invoice.overdue) return <StatusBadge label="Overdue" tone="error" />;
  if (invoice.status === 'open' && invoice.amountPaid > 0) return <StatusBadge label="Part paid" tone="info" />;
  if (invoice.status === 'paid' && invoice.amountRefunded > 0) return <StatusBadge label={invoice.amountRefunded >= invoice.total ? 'Refunded' : 'Part refunded'} tone="warning" />;
  const item = invoiceTone[invoice.status];
  return <StatusBadge label={item.label} tone={item.tone} />;
}

export function useCatalogue() {
  const products = useResource<{ items: Product[] }>('/revenue/products');
  const taxes = useResource<{ items: TaxRate[] }>('/revenue/tax-rates');
  return { products: products.data?.items ?? [], taxes: taxes.data?.items ?? [], loading: products.loading || taxes.loading };
}

export function priceIn(product: Product, currency: string) {
  if (product.currency === currency) return product.unitPrice;
  return product.prices.find(price => price.currency === currency)?.unitPrice ?? null;
}

export type EditableLine = LineInput & { key: string };
let nextKey = 0;
export const keyed = (line: LineInput): EditableLine => ({ ...line, key: `line-${nextKey++}` });

/** Editable line items with catalogue picking; calls onChange with the full list on every edit. */
export function LinesEditor({ lines, currency, onChange, readOnly, onError }: {
  lines: EditableLine[]; currency: string; onChange: (lines: EditableLine[]) => void; readOnly?: boolean; onError?: (message: string) => void;
}) {
  const { products, taxes, loading } = useCatalogue();
  const defaultTax = taxes.find(tax => tax.isDefault)?.rate ?? 0;
  const priced = useMemo(() => lines.map(line => priceLine(line)), [lines]);
  const update = (key: string, patch: Partial<LineInput>) => onChange(lines.map(line => line.key === key ? { ...line, ...patch } : line));
  const add = (productId: string | null) => {
    if (!productId) return onChange([...lines, keyed({ name: '', quantity: 1, unitPrice: 0, taxRate: defaultTax })]);
    const product = products.find(item => item.id === productId);
    if (!product) return;
    const price = priceIn(product, currency);
    if (price == null) return onError?.(`${product.name} has no ${currency} price. Add one to its price list in Products.`);
    onChange([...lines, keyed({ productId: product.id, name: product.name, description: product.description, quantity: 1, unitPrice: price, taxRate: product.taxRate, billing: product.billing })]);
  };
  return <div className="ov-revenue-lines">
    {lines.map((line, index) => <div key={line.key} className="ov-revenue-line" role="group" aria-label={`Line ${index + 1}${line.name ? `: ${line.name}` : ''}`}>
      <TextInput label="Item" value={line.name} isReadOnly={readOnly} placeholder="What you are selling" onChange={value => update(line.key, { name: value })} />
      <NumberInput label="Qty" min={0.01} value={line.quantity} isReadOnly={readOnly} onChange={value => update(line.key, { quantity: value ?? 1 })} />
      <NumberInput label={`Price (${currency})`} min={0} value={line.unitPrice} isReadOnly={readOnly} onChange={value => update(line.key, { unitPrice: value ?? 0 })} />
      <NumberInput label="Discount %" min={0} max={100} value={line.discountPercent ?? 0} isReadOnly={readOnly} onChange={value => update(line.key, { discountPercent: value ?? 0 })} />
      <NumberInput label="Tax %" min={0} max={100} value={line.taxRate ?? 0} isReadOnly={readOnly} onChange={value => update(line.key, { taxRate: value ?? 0 })} />
      <Selector label="Billing" value={line.billing ?? 'one_time'} isReadOnly={readOnly} options={billingCycles.map(cycle => ({ value: cycle, label: billingLabels[cycle] }))}
        onChange={value => update(line.key, { billing: (value ?? 'one_time') as Billing })} />
      <span className="ov-revenue-line-total" aria-label="Line amount before tax">{cash(priced[index].net, currency)}</span>
      {!readOnly ? <IconButton label={`Remove ${line.name || 'line'}`} icon={<Trash2 size={16} />} variant="ghost" onClick={() => onChange(lines.filter(item => item.key !== line.key))} /> : <span />}
    </div>)}
    {!lines.length ? <Text color="secondary">No line items yet. Add products from your catalogue or a custom line.</Text> : null}
    {!readOnly ? <div className="ov-actions">
      <Selector label="Add from catalogue" isLabelHidden hasClear placeholder={loading ? 'Loading products…' : 'Add a product or service'} value={null} width={300}
        options={products.map(product => {
          const price = priceIn(product, currency);
          return { value: product.id, label: product.name, description: price == null ? `No ${currency} price` : `${cash(price, currency)} · ${billingLabels[product.billing]}` };
        })}
        emptyText="No products yet. Create them in Sales › Products." onChange={value => add(value ?? null)} />
      <Button label="Custom line" icon={<Plus size={15} />} onClick={() => add(null)} />
    </div> : null}
  </div>;
}

export function TotalsBox({ lines, currency }: { lines: LineInput[]; currency: string }) {
  const sum = totals(lines.map(line => priceLine(line)));
  return <div className="ov-revenue-totals" aria-label="Totals">
    <div><span>Subtotal</span><span>{cash(sum.subtotal, currency)}</span></div>
    {sum.discountTotal ? <div><span>Discounts</span><span>−{cash(sum.discountTotal, currency)}</span></div> : null}
    <div><span>Tax</span><span>{cash(sum.taxTotal, currency)}</span></div>
    <div className="ov-revenue-grand"><span>Total</span><span>{cash(sum.total, currency)}</span></div>
    {sum.monthlyRecurring ? <Text type="supporting" color="secondary">Includes {cash(sum.monthlyRecurring, currency)}/month recurring (net)</Text> : null}
  </div>;
}

export function toLineInput(line: EditableLine): LineInput {
  const { key, ...input } = line;
  void key;
  return input;
}
