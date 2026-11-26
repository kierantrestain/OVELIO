'use client';

// Sales › Invoices, Sales › Products and Sales › Revenue.
import { Download, Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Billing, Invoice, InvoiceSummary, Product, RevenueOverview, RevenueSettings, Subscription, TaxRate } from '@/contracts/revenue';
import { billingCycles, billingLabels } from '@/contracts/revenue';
import { api, date, saveFile, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, KpiTile, PageHeader, Panel, SlideDrawer, StatusBadge, Tabs } from '../ui';
import { InvoiceBadge, cash } from './common';

/* ── Invoices ─────────────────────────────────────────────────────────── */

const invoiceViews = ['All', 'Open', 'Overdue', 'Paid', 'Void'] as const;

export function InvoiceList({ initialInvoice }: { initialInvoice?: string }) {
  const router = useRouter();
  const [view, setView] = useState<(typeof invoiceViews)[number]>('All');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialInvoice ?? null);
  const action = useAction();
  const params = new URLSearchParams();
  if (view !== 'All') params.set('status', view.toLowerCase());
  if (search) params.set('q', search);
  const invoices = useResource<{ items: InvoiceSummary[] }>(`/revenue/invoices?${params}`);
  const exportCsv = () => void action.run(async () => {
    const response = await fetch('/api/console/revenue/invoices/export?from=2000-01-01', { cache: 'no-store' });
    if (!response.ok) throw new Error('The export could not be created.');
    saveFile(await response.text(), 'ovelio-invoices.csv', 'text/csv');
  }, 'Export downloaded.');
  return <div className="ov-stack">
    <PageHeader title="Invoices" description="Deposits, full and recurring invoices. Card payments are confirmed by Stripe; bank payments are recorded by your team."
      actions={<Button label="Export for accounting" icon={<Download size={15} />} isLoading={action.busy} onClick={exportCsv} />} />
    <Tabs label="Invoice views" value={view} items={invoiceViews} onChange={setView} />
    <Feedback error={action.error} />
    <Panel>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
          <TextInput label="Search invoices" isLabelHidden type="search" startIcon="search" placeholder="Number or client" width={260} value={query} onChange={setQuery} />
        </form>
      </div>
      {!invoices.data ? <AsyncState loading={invoices.loading} error={invoices.error} retry={invoices.refresh} />
        : !invoices.data.items.length ? <Empty title={search || view !== 'All' ? 'No invoices match' : 'No invoices yet'} description="Invoices are issued when a client accepts a proposal, and each period for subscriptions." />
          : <Table data={invoices.data.items} idKey="id" hasHover columns={[
            { key: 'number', header: 'Invoice', renderCell: item => <span className="ov-cell"><button type="button" className="ov-revenue-row-link" onClick={() => setOpenId(item.id)}>{item.number}</button>
              <Text type="supporting" color="secondary">{item.description || item.kind}</Text></span> },
            { key: 'companyName', header: 'Client', renderCell: item => item.companyName || item.contactName || item.contactEmail || '—' },
            { key: 'total', header: 'Total', renderCell: item => <span className="ov-cell ov-cell--nowrap">{cash(item.total, item.currency)}{item.status === 'open' && item.amountPaid ? <Text type="supporting" color="secondary">{cash(item.balance, item.currency)} due</Text> : null}</span> },
            { key: 'status', header: 'Status', renderCell: item => <InvoiceBadge invoice={item} /> },
            { key: 'dueDate', header: 'Due', renderCell: item => item.status === 'paid' ? `Paid ${date(item.paidAt)}` : item.dueDate ? date(item.dueDate) : '—' },
          ]} />}
    </Panel>
    {openId ? <InvoiceDrawer id={openId} onClose={() => { setOpenId(null); if (initialInvoice) router.replace('/sales/invoices'); }} onChanged={invoices.refresh} /> : null}
  </div>;
}

function InvoiceDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const invoice = useResource<Invoice>(`/revenue/invoices/${id}`);
  const action = useAction();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState('Bank transfer');
  const [received, setReceived] = useState<string | undefined>();
  const [refund, setRefund] = useState<{ paymentId: string; max: number; currency: string } | null>(null);
  const [refundAmount, setRefundAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const data = invoice.data;
  const changed = () => { invoice.refresh(); onChanged(); };
  return <SlideDrawer title={data ? `Invoice ${data.number}` : 'Invoice'} subtitle={data ? [data.companyName || data.contactName, cash(data.total, data.currency)].filter(Boolean).join(' · ') : undefined} onClose={onClose} width={600}>
    {!data ? <AsyncState loading={invoice.loading} error={invoice.error} retry={invoice.refresh} /> : <div className="ov-stack">
      <div className="ov-actions"><InvoiceBadge invoice={data} />{data.quoteNumber ? <NextLink href={`/sales/proposals/${data.quoteId}`}>From {data.quoteNumber}</NextLink> : null}
        {data.dealId ? <NextLink href={`/sales/deals/${data.dealId}`}>Open deal</NextLink> : null}</div>
      <Feedback error={action.error} notice={action.notice} />
      {data.publicUrl ? <TextInput label="Client payment page" value={data.publicUrl} isReadOnly onChange={() => undefined} /> : null}
      <Table data={data.lines.map((line, index) => ({ ...line, id: String(index) }))} idKey="id" columns={[
        { key: 'name', header: 'Item', renderCell: line => <span className="ov-cell">{line.name}<Text type="supporting" color="secondary">{line.quantity} × {cash(line.unitPrice, data.currency)}{line.discountPercent ? ` −${line.discountPercent}%` : ''}{line.taxRate ? ` · tax ${line.taxRate}%` : ''}</Text></span> },
        { key: 'total', header: 'Amount', renderCell: line => cash(line.total, data.currency) },
      ]} />
      <div className="ov-revenue-totals">
        <div><span>Net</span><span>{cash(data.subtotal, data.currency)}</span></div>
        <div><span>Tax</span><span>{cash(data.taxTotal, data.currency)}</span></div>
        <div className="ov-revenue-grand"><span>Total</span><span>{cash(data.total, data.currency)}</span></div>
        <div><span>Paid</span><span>{cash(data.amountPaid, data.currency)}</span></div>
        {data.amountRefunded ? <div><span>Refunded</span><span>{cash(data.amountRefunded, data.currency)}</span></div> : null}
        <div><strong>Balance</strong><strong>{cash(data.balance, data.currency)}</strong></div>
      </div>
      <Panel title="Payments">
        {data.payments.length ? <ul className="ov-rows">{data.payments.map(payment => <li key={payment.id}>
          <span className="ov-cell">{cash(payment.amount, payment.currency)} · {payment.provider === 'stripe' ? 'Stripe' : payment.method || 'Recorded by hand'}
            <Text type="supporting" color="secondary">{date(payment.receivedAt)}{payment.refunded ? ` · ${cash(payment.refunded, payment.currency)} refunded` : ''}{payment.note ? ` · ${payment.note}` : ''}</Text></span>
          {payment.refunded < payment.amount ? <Button size="sm" variant="ghost" label="Refund" onClick={() => { setRefund({ paymentId: payment.id, max: payment.amount - payment.refunded, currency: payment.currency }); setRefundAmount(payment.amount - payment.refunded); }} /> : null}
        </li>)}</ul> : <Text color="secondary">No payments yet.</Text>}
      </Panel>
      {data.status === 'open' ? paying ? <Panel title="Record a payment">
        <div className="ov-stack-sm">
          <NumberInput label={`Amount (${data.currency})`} min={0.01} value={amount ?? data.balance} onChange={setAmount} />
          <TextInput label="Method" value={method} onChange={setMethod} />
          <DateInput label="Received on" hasClear value={received as never} onChange={value => setReceived(value as string | undefined)} />
          <FormActions>
            <Button label="Cancel" variant="ghost" onClick={() => setPaying(false)} />
            <Button label="Record payment" variant="primary" isLoading={action.busy} onClick={() => void action.run(async () => {
              await api(`/revenue/invoices/${id}/payments`, 'POST', { amount: amount ?? data.balance, method, receivedAt: received || undefined }); setPaying(false); changed();
            }, 'Payment recorded.')} />
          </FormActions>
        </div>
      </Panel> : <FormActions>
        {!data.amountPaid ? <Button label="Void invoice" variant="ghost" onClick={() => setVoiding(true)} /> : null}
        <Button label="Record a payment" variant="primary" onClick={() => setPaying(true)} />
      </FormActions> : null}
      {refund ? <Panel title="Refund">
        <div className="ov-stack-sm">
          <NumberInput label={`Amount (${refund.currency})`} min={0.01} max={refund.max} value={refundAmount} onChange={setRefundAmount} />
          <TextInput label="Reason" value={reason} onChange={setReason} />
          <Text type="supporting" color="secondary">Stripe payments are refunded through Stripe; others are recorded here (return the money yourself).</Text>
          <FormActions>
            <Button label="Cancel" variant="ghost" onClick={() => setRefund(null)} />
            <Button label="Refund" variant="destructive" isLoading={action.busy} onClick={() => void action.run(async () => {
              await api(`/revenue/payments/${refund.paymentId}/refund`, 'POST', { amount: refundAmount, reason }); setRefund(null); changed();
            }, 'Refund recorded.')} />
          </FormActions>
        </div>
      </Panel> : null}
      {voiding ? <ConfirmDialog title={`Void ${data.number}?`} description="The client will no longer be able to pay it. This cannot be undone." actionLabel="Void invoice" busy={action.busy}
        onClose={() => setVoiding(false)} onConfirm={() => void action.run(async () => { await api(`/revenue/invoices/${id}/void`, 'POST'); setVoiding(false); changed(); }, 'Invoice voided.')} /> : null}
    </div>}
  </SlideDrawer>;
}

/* ── Products ─────────────────────────────────────────────────────────── */

type ProductForm = { name: string; sku: string; description: string; kind: Product['kind']; unitPrice: number; currency: string; billing: Billing; taxRateId: string | null; prices: { currency: string; unitPrice: number }[] };
const emptyProduct: ProductForm = { name: '', sku: '', description: '', kind: 'service', unitPrice: 0, currency: 'GBP', billing: 'one_time', taxRateId: null, prices: [] };

export function ProductCatalogue() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const products = useResource<{ items: Product[] }>(`/revenue/products?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(archived ? { archived: 'true' } : {}) })}`);
  const taxes = useResource<{ items: TaxRate[] }>('/revenue/tax-rates');
  return <div className="ov-stack">
    <PageHeader title="Products" description="Products and services you sell, with prices per currency and tax. Add them to deals and proposals."
      actions={<Button label="New product" variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')} />} />
    <Panel>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
          <TextInput label="Search products" isLabelHidden type="search" startIcon="search" placeholder="Name or SKU" width={260} value={query} onChange={setQuery} />
        </form>
        <Button size="sm" variant="ghost" label={archived ? 'Hide archived' : 'Show archived'} onClick={() => setArchived(!archived)} />
      </div>
      {!products.data ? <AsyncState loading={products.loading} error={products.error} retry={products.refresh} />
        : !products.data.items.length ? <Empty title={search ? 'No products match' : 'No products yet'} description="Add what you sell once, then pick it on any deal or proposal." action={<Button label="New product" onClick={() => setEditing('new')} />} />
          : <Table data={products.data.items} idKey="id" hasHover columns={[
            { key: 'name', header: 'Product', renderCell: item => <span className="ov-cell"><button type="button" className="ov-revenue-row-link" onClick={() => setEditing(item)}>{item.name}</button>
              <Text type="supporting" color="secondary">{[item.sku, item.kind === 'service' ? 'Service' : 'Product'].filter(Boolean).join(' · ')}</Text></span> },
            { key: 'unitPrice', header: 'Price', renderCell: item => <span className="ov-cell ov-cell--nowrap">{cash(item.unitPrice, item.currency)}{item.prices.length ? <Text type="supporting" color="secondary">{item.prices.map(price => cash(price.unitPrice, price.currency)).join(' · ')}</Text> : null}</span> },
            { key: 'billing', header: 'Billing', renderCell: item => billingLabels[item.billing] },
            { key: 'taxRate', header: 'Tax', renderCell: item => item.taxRateId ? `${item.taxRate}%` : 'None' },
            { key: 'archived', header: '', renderCell: item => item.archived ? <StatusBadge label="Archived" tone="warning" /> : null },
          ]} />}
    </Panel>
    <TaxRates rates={taxes.data?.items} loading={taxes.loading} error={taxes.error} onChanged={taxes.refresh} />
    {editing ? <ProductDrawer product={editing === 'new' ? null : editing} taxes={taxes.data?.items ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); products.refresh(); }} /> : null}
  </div>;
}

function ProductDrawer({ product, taxes, onClose, onSaved }: { product: Product | null; taxes: TaxRate[]; onClose: () => void; onSaved: () => void }) {
  const action = useAction();
  const [form, setForm] = useState<ProductForm>(product ? { name: product.name, sku: product.sku, description: product.description, kind: product.kind, unitPrice: product.unitPrice, currency: product.currency, billing: product.billing, taxRateId: product.taxRateId, prices: product.prices }
    : { ...emptyProduct, taxRateId: taxes.find(tax => tax.isDefault)?.id ?? null });
  const set = (patch: Partial<ProductForm>) => setForm(current => ({ ...current, ...patch }));
  return <SlideDrawer title={product ? product.name : 'New product'} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { await api(product ? `/revenue/products/${product.id}` : '/revenue/products', product ? 'PATCH' : 'POST', form); onSaved(); }, product ? 'Product saved.' : 'Product created.');
    }}>
      <TextInput label="Name" isRequired value={form.name} onChange={name => set({ name })} />
      <div className="ov-form-grid">
        <TextInput label="SKU" isOptional value={form.sku} onChange={sku => set({ sku })} />
        <Selector label="Type" value={form.kind} options={[{ value: 'service', label: 'Service' }, { value: 'product', label: 'Product' }]} onChange={value => set({ kind: (value ?? 'service') as Product['kind'] })} />
        <NumberInput label="Price" min={0} value={form.unitPrice} onChange={value => set({ unitPrice: value ?? 0 })} />
        <TextInput label="Currency" value={form.currency} onChange={value => set({ currency: value.toUpperCase().slice(0, 3) })} />
        <Selector label="Billing" value={form.billing} options={billingCycles.map(cycle => ({ value: cycle, label: billingLabels[cycle] }))} onChange={value => set({ billing: (value ?? 'one_time') as Billing })} />
        <Selector label="Tax rate" hasClear placeholder="No tax" value={form.taxRateId} options={taxes.map(tax => ({ value: tax.id, label: `${tax.name} (${tax.rate}%)` }))} onChange={value => set({ taxRateId: value ?? null })} emptyText="Add tax rates below the product list." />
      </div>
      <TextArea label="Description" description="Shown under the item on proposals and invoices." rows={3} value={form.description} onChange={description => set({ description })} />
      <Text weight="semibold">Price list</Text>
      <Text type="supporting" color="secondary">Prices in other currencies, used when the deal is in that currency.</Text>
      {form.prices.map((price, index) => <div key={index} className="ov-actions" style={{ alignItems: 'end' }}>
        <TextInput label="Currency" width={110} value={price.currency} onChange={value => set({ prices: form.prices.map((item, i) => i === index ? { ...item, currency: value.toUpperCase().slice(0, 3) } : item) })} />
        <NumberInput label="Price" min={0} width={160} value={price.unitPrice} onChange={value => set({ prices: form.prices.map((item, i) => i === index ? { ...item, unitPrice: value ?? 0 } : item) })} />
        <Button variant="ghost" label="Remove" onClick={() => set({ prices: form.prices.filter((_, i) => i !== index) })} />
      </div>)}
      <div><Button size="sm" label="Add a currency" icon={<Plus size={14} />} onClick={() => set({ prices: [...form.prices, { currency: form.currency === 'EUR' ? 'USD' : 'EUR', unitPrice: form.unitPrice }] })} /></div>
      <Feedback error={action.error} />
      <FormActions>
        {product ? <Button variant="ghost" label={product.archived ? 'Restore' : 'Archive'} onClick={() => void action.run(async () => { await api(`/revenue/products/${product.id}/archive`, 'POST', { archived: !product.archived }); onSaved(); })} /> : null}
        <Button type="submit" variant="primary" label={product ? 'Save' : 'Create product'} isLoading={action.busy} />
      </FormActions>
    </form>
  </SlideDrawer>;
}

function TaxRates({ rates, loading, error, onChanged }: { rates?: TaxRate[]; loading: boolean; error?: string; onChanged: () => void }) {
  const action = useAction();
  const [name, setName] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  return <Panel title="Tax rates" description="Applied per line. Archiving a rate keeps it on existing proposals and invoices.">
    {!rates ? <AsyncState loading={loading} error={error} retry={onChanged} /> : <div className="ov-stack-sm">
      {rates.length ? <ul className="ov-rows">{rates.map(tax => <li key={tax.id}>
        <span className="ov-cell">{tax.name}<Text type="supporting" color="secondary">{tax.rate}%{tax.isDefault ? ' · default' : ''}</Text></span>
        <Button size="sm" variant="ghost" label="Archive" onClick={() => void action.run(async () => { await api(`/revenue/tax-rates/${tax.id}/archive`, 'POST'); onChanged(); }, 'Tax rate archived.')} />
      </li>)}</ul> : <Text color="secondary">No tax rates yet.</Text>}
      <form className="ov-actions" style={{ alignItems: 'end' }} onSubmit={event => {
        event.preventDefault();
        void action.run(async () => { await api('/revenue/tax-rates', 'POST', { name, rate: rate ?? 0, isDefault: !rates.length }); setName(''); setRate(null); onChanged(); }, 'Tax rate added.');
      }}>
        <TextInput label="Name" width={220} value={name} placeholder="e.g. UK VAT" onChange={setName} />
        <NumberInput label="Rate %" width={120} min={0} max={100} value={rate} onChange={setRate} />
        <Button type="submit" label="Add rate" isDisabled={!name.trim() || rate == null} isLoading={action.busy} />
      </form>
      <Feedback error={action.error} />
    </div>}
  </Panel>;
}

/* ── Revenue ──────────────────────────────────────────────────────────── */

const ranges = ['Last 30 days', 'Last 90 days', 'This year', 'All time'] as const;
const rangeFrom = (range: (typeof ranges)[number]) => {
  const now = new Date();
  if (range === 'Last 30 days') return new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  if (range === 'Last 90 days') return new Date(now.getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
  if (range === 'This year') return `${now.getUTCFullYear()}-01-01`;
  return '2000-01-01';
};

export function RevenueDashboard() {
  const [range, setRange] = useState<(typeof ranges)[number]>('Last 90 days');
  const overview = useResource<RevenueOverview>(`/revenue/overview?from=${rangeFrom(range)}`);
  const subscriptions = useResource<{ items: Subscription[] }>('/revenue/subscriptions');
  const action = useAction();
  const [cancel, setCancel] = useState<Subscription | null>(null);
  const data = overview.data;
  return <div className="ov-stack">
    <PageHeader title="Revenue" description="From pipeline to cash: each stage is measured separately, per currency, with no exchange-rate conversion." />
    <Tabs label="Revenue period" value={range} items={ranges} onChange={setRange} />
    <Feedback error={action.error} />
    {!data ? <Panel><AsyncState loading={overview.loading} error={overview.error} retry={overview.refresh} /></Panel> : <>
      {!data.stripe.configured ? <Panel title="Card payments are not connected">
        <Text>Invoices can be paid by bank transfer and recorded here. To take card payments, set <code>STRIPE_SECRET_KEY</code> (a test key starts <code>sk_test_</code>) and point a Stripe webhook at <code>/api/public/stripe/webhook</code> with <code>STRIPE_WEBHOOK_SECRET</code>.</Text>
      </Panel> : !data.stripe.webhookConfigured ? <Panel title="Stripe webhook missing"><Text>Card payments open, but they are only confirmed when <code>STRIPE_WEBHOOK_SECRET</code> is set and the webhook is registered.</Text></Panel> : null}
      {!data.states.length ? <Panel><Empty title="No revenue yet" description="Add products to a deal, send a proposal and record its payment to see each stage here." /></Panel>
        : data.states.map(state => <Panel key={state.currency} title={state.currency} description={`${data.from} to ${data.to}. Pipeline, outstanding and recurring are as of today.`}>
          <div className="ov-stack-sm">
            <div className="ov-revenue-states">
              <KpiTile flat label="Open pipeline" value={cash(state.pipeline, state.currency)} hint={`≈ ${cash(state.weightedPipeline, state.currency)} weighted`} info="Value of open deals. The weighted figure multiplies each deal by its win probability: an estimate." />
              <KpiTile flat label="Contracted" value={cash(state.contracted, state.currency)} info="Proposals accepted in the period." />
              <KpiTile flat label="Invoiced" value={cash(state.invoiced, state.currency)} info="Invoices issued in the period (void excluded)." />
              <KpiTile flat label="Collected" value={cash(state.collected, state.currency)} info="Payments received in the period, before refunds." />
              <KpiTile flat label="Refunded" value={cash(state.refunded, state.currency)} info="Refunds made in the period." />
              <KpiTile flat label="Outstanding" value={cash(state.outstanding, state.currency)} info="Unpaid balance of open invoices today." />
              <KpiTile flat label="Recurring (MRR)" value={cash(state.monthlyRecurring, state.currency)} hint={`${state.activeSubscriptions} active subscription${state.activeSubscriptions === 1 ? '' : 's'}`} info="Net monthly value of active subscriptions; quarterly and yearly ones are divided into months." />
            </div>
            <div className="ov-revenue-flow" aria-label="Collected after refunds">Net collected: <strong>{cash(state.collected - state.refunded, state.currency)}</strong></div>
          </div>
        </Panel>)}
      <Panel title="Recent payments">
        {data.recentPayments.length ? <ul className="ov-rows">{data.recentPayments.map(payment => <li key={payment.id}>
          <span className="ov-cell"><NextLink href={`/sales/invoices?invoice=${payment.invoiceId}`}>{payment.invoiceNumber}</NextLink><Text type="supporting" color="secondary">{payment.contactName} · {payment.provider === 'stripe' ? 'Stripe' : payment.method}</Text></span>
          <span className="ov-cell ov-cell--nowrap">{cash(payment.amount, payment.currency)}<Text type="supporting" color="secondary">{date(payment.receivedAt)}</Text></span>
        </li>)}</ul> : <Text color="secondary">No payments yet.</Text>}
      </Panel>
    </>}
    <Panel title="Subscriptions" description="Started when a proposal with recurring lines is accepted. Each period’s invoice is issued and emailed automatically.">
      {!subscriptions.data ? <AsyncState loading={subscriptions.loading} error={subscriptions.error} retry={subscriptions.refresh} />
        : !subscriptions.data.items.length ? <Text color="secondary">No active subscriptions.</Text>
          : <Table data={subscriptions.data.items} idKey="id" columns={[
            { key: 'name', header: 'Subscription', renderCell: item => <span className="ov-cell">{item.name}<Text type="supporting" color="secondary">{item.companyName || item.contactName}</Text></span> },
            { key: 'amount', header: 'Amount', renderCell: item => `${cash(item.amount, item.currency)} ${billingLabels[item.interval].toLowerCase()}` },
            { key: 'nextInvoiceAt', header: 'Next invoice', renderCell: item => date(item.nextInvoiceAt.slice(0, 10)) },
            { key: 'id', header: '', renderCell: item => <Button size="sm" variant="ghost" label="Cancel" onClick={() => setCancel(item)} /> },
          ]} />}
    </Panel>
    <RevenueSettingsPanel />
    {cancel ? <ConfirmDialog title={`Cancel ${cancel.name}?`} description="No further invoices will be issued. Invoices already issued stay open." actionLabel="Cancel subscription" busy={action.busy}
      onClose={() => setCancel(null)} onConfirm={() => void action.run(async () => { await api(`/revenue/subscriptions/${cancel.id}/cancel`, 'POST', {}); setCancel(null); subscriptions.refresh(); overview.refresh(); }, 'Subscription cancelled.')} /> : null}
  </div>;
}

function RevenueSettingsPanel() {
  const settings = useResource<RevenueSettings>('/revenue/settings');
  const action = useAction();
  const [form, setForm] = useState<RevenueSettings | null>(null);
  const [synced, setSynced] = useState<RevenueSettings>();
  if (settings.data && settings.data !== synced) { setSynced(settings.data); setForm(settings.data); }
  return <Panel title="Proposal and invoice settings">
    {!form ? <AsyncState loading={settings.loading} error={settings.error} retry={settings.refresh} /> : <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { await api('/revenue/settings', 'PATCH', form); settings.refresh(); }, 'Settings saved.');
    }}>
      <div className="ov-form-grid">
        <NumberInput label="Proposals valid for (days)" min={1} max={365} isIntegerOnly value={form.quoteValidityDays} onChange={value => setForm({ ...form, quoteValidityDays: value ?? 30 })} />
        <NumberInput label="Invoices due after (days)" min={0} max={365} isIntegerOnly value={form.invoiceDueDays} onChange={value => setForm({ ...form, invoiceDueDays: value ?? 14 })} />
      </div>
      <TextArea label="Default terms" rows={4} value={form.defaultTerms} onChange={value => setForm({ ...form, defaultTerms: value })} />
      <TextArea label="Bank transfer instructions" description="Shown on invoices. Leave empty if you only take card payments." rows={3} value={form.paymentInstructions} onChange={value => setForm({ ...form, paymentInstructions: value })} />
      <TextArea label="Onboarding tasks" description="One per line. Created for the deal owner when a proposal is accepted (or when its deposit is paid)." rows={4}
        value={form.onboardingTasks.join('\n')} onChange={value => setForm({ ...form, onboardingTasks: value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12) })} />
      <Feedback error={action.error} />
      <FormActions><Button type="submit" variant="primary" label="Save settings" isLoading={action.busy} /></FormActions>
    </form>}
  </Panel>;
}
