'use client';

// Sales › Proposals: the list, the proposal editor (draft → send → accepted/declined with the signature record), and
// the deal page's Products & proposals panel.
import { Copy, ExternalLink, FileSignature, Plus, Send } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import type { InvoiceSummary, Line, LineInput, Quote, QuoteSummary, Totals } from '@/contracts/revenue';
import { api, date, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, PageHeader, Panel, Tabs } from '../ui';
import { ContactPicker, contactOption } from '../crm/common';
import { InvoiceBadge, LinesEditor, QuoteBadge, TotalsBox, cash, keyed, toLineInput } from './common';
import type { EditableLine } from './common';

const statusViews = ['All', 'Drafts', 'Sent', 'Accepted', 'Declined', 'Expired'] as const;
const statusQuery: Record<(typeof statusViews)[number], string> = { All: '', Drafts: 'draft', Sent: 'sent', Accepted: 'accepted', Declined: 'declined', Expired: 'expired' };

export function ProposalList() {
  const [view, setView] = useState<(typeof statusViews)[number]>('All');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const params = new URLSearchParams();
  if (statusQuery[view]) params.set('status', statusQuery[view]);
  if (search) params.set('q', search);
  const quotes = useResource<{ items: QuoteSummary[] }>(`/revenue/quotes?${params}`);
  return <div className="ov-stack">
    <PageHeader title="Proposals" description="Quotes and proposals your clients review, sign and pay online. Create one from a deal." />
    <Tabs label="Proposal views" value={view} items={statusViews} onChange={setView} />
    <Panel>
      <div className="ov-toolbar">
        <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}>
          <TextInput label="Search proposals" isLabelHidden type="search" startIcon="search" placeholder="Number, title, client" width={260} value={query} onChange={setQuery} />
        </form>
      </div>
      {!quotes.data ? <AsyncState loading={quotes.loading} error={quotes.error} retry={quotes.refresh} />
        : !quotes.data.items.length ? <Empty title={search || view !== 'All' ? 'No proposals match' : 'No proposals yet'} description="Open a deal, add its products, then choose Create proposal." action={<Button label="Go to deals" href="/sales" />} />
          : <Table data={quotes.data.items} idKey="id" hasHover columns={[
            { key: 'title', header: 'Proposal', renderCell: item => <span className="ov-cell"><NextLink href={`/sales/proposals/${item.id}`}>{item.title}</NextLink>
              <Text type="supporting" color="secondary">{item.number}{item.dealName ? ` · ${item.dealName}` : ''}</Text></span> },
            { key: 'contactName', header: 'Client', renderCell: item => <span className="ov-cell">{item.companyName || item.contactName || '—'}<Text type="supporting" color="secondary">{item.companyName ? item.contactName : item.contactEmail}</Text></span> },
            { key: 'total', header: 'Total', renderCell: item => <span className="ov-cell ov-cell--nowrap">{cash(item.total, item.currency)}{item.monthlyRecurring ? <Text type="supporting" color="secondary">{cash(item.monthlyRecurring, item.currency)}/mo</Text> : null}</span> },
            { key: 'status', header: 'Status', renderCell: item => <QuoteBadge quote={item} /> },
            { key: 'updatedAt', header: 'Activity', renderCell: item => <Text type="supporting" color="secondary">{item.acceptedAt ? `Accepted ${date(item.acceptedAt)}` : item.declinedAt ? `Declined ${date(item.declinedAt)}` : item.lastViewedAt ? `Viewed ${item.viewCount}× · last ${date(item.lastViewedAt)}` : item.sentAt ? `Sent ${date(item.sentAt)}` : `Edited ${date(item.updatedAt)}`}</Text> },
          ]} />}
    </Panel>
  </div>;
}

function CopyLink({ url }: { url: string }) {
  const toast = useToast();
  return <div className="ov-revenue-link">
    <TextInput label="Client link" value={url} isReadOnly onChange={() => undefined} />
    <Button label="Copy link" icon={<Copy size={15} />} onClick={() => void navigator.clipboard.writeText(url).then(() => toast({ body: 'Link copied.', type: 'info' }))} />
    <Button label="Open" icon={<ExternalLink size={15} />} href={`${url}?preview=1`} target="_blank" />
  </div>;
}

function InvoiceRows({ items }: { items: InvoiceSummary[] }) {
  if (!items.length) return <Text color="secondary">No invoices yet.</Text>;
  return <ul className="ov-rows">{items.map(invoice => <li key={invoice.id}>
    <span className="ov-cell"><NextLink href={`/sales/invoices?invoice=${invoice.id}`}>{invoice.number}</NextLink>
      <Text type="supporting" color="secondary">{invoice.description || invoice.kind} · {cash(invoice.total, invoice.currency)}{invoice.balance && invoice.status === 'open' ? ` · ${cash(invoice.balance, invoice.currency)} due` : ''}</Text></span>
    <InvoiceBadge invoice={invoice} />
  </li>)}</ul>;
}

export function ProposalEditor({ id }: { id: string }) {
  const router = useRouter();
  const quote = useResource<Quote>(`/revenue/quotes/${id}`);
  const action = useAction();
  const [draft, setDraft] = useState<{ title: string; intro: string; terms: string; validUntil: string | null; depositPercent: number; lines: EditableLine[] } | null>(null);
  const [synced, setSynced] = useState<Quote>();
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<'void' | 'delete' | null>(null);
  const [lineError, setLineError] = useState<string>();
  const data = quote.data;
  if (data && data !== synced) {
    setSynced(data);
    setDraft({ title: data.title, intro: data.intro, terms: data.terms, validUntil: data.validUntil, depositPercent: data.depositPercent, lines: data.lines.map(line => keyed(stripLine(line))) });
  }
  if (!data || !draft) return <div className="ov-stack"><PageHeader title="Proposal" back={{ href: '/sales/proposals', label: 'Proposals' }} />
    <Panel><AsyncState loading={quote.loading} error={quote.error} retry={quote.refresh} /></Panel></div>;
  const editable = data.status === 'draft';
  const payload = { title: draft.title, intro: draft.intro, terms: draft.terms, validUntil: draft.validUntil, depositPercent: draft.depositPercent, lines: draft.lines.map(toLineInput) };
  const dirty = editable && JSON.stringify(payload) !== JSON.stringify({ title: data.title, intro: data.intro, terms: data.terms, validUntil: data.validUntil, depositPercent: data.depositPercent, lines: data.lines.map(stripLine) });
  const save = async () => { await api(`/revenue/quotes/${id}`, 'PATCH', payload); quote.refresh(); };

  return <div className="ov-stack">
    <PageHeader back={{ href: '/sales/proposals', label: 'Proposals' }} title={data.title}
      description={[data.number, data.companyName || data.contactName, data.dealName ? `Deal: ${data.dealName}` : ''].filter(Boolean).join(' · ')}
      actions={<>
        <QuoteBadge quote={data} />
        {editable ? <>
          <Button label="Save draft" isDisabled={!dirty} isLoading={action.busy && dirty} onClick={() => void action.run(save, 'Draft saved.')} />
          <Button label="Send proposal" variant="primary" icon={<Send size={15} />} onClick={() => void action.run(async () => { if (dirty) await save(); setSending(true); })} />
        </> : null}
        {data.status !== 'draft' ? <Button label="Revise" icon={<FileSignature size={15} />} onClick={() => void action.run(async () => {
          const next = await api<Quote>(`/revenue/quotes/${id}/revise`, 'POST'); router.push(`/sales/proposals/${next.id}`);
        }, 'Revision created as a draft.')} /> : null}
        {data.status === 'accepted' && data.depositPercent > 0 && data.depositPercent < 100 && !data.invoices.some(invoice => invoice.kind === 'balance') ? <Button label="Invoice the balance"
          onClick={() => void action.run(async () => { await api('/revenue/invoices', 'POST', { quoteId: id, kind: 'balance' }); quote.refresh(); }, 'Balance invoice issued.')} /> : null}
        {data.status === 'draft' || data.status === 'sent' ? <DropdownMenu button={{ label: 'More', variant: 'ghost' }} items={[
          ...(data.status === 'sent' ? [{ label: 'Withdraw proposal', onClick: () => setConfirm('void') }] : []),
          ...(data.status === 'draft' ? [{ label: 'Delete draft', onClick: () => setConfirm('delete') }] : []),
        ]} /> : null}
      </>} />
    <Feedback error={action.error ?? lineError} />
    {data.publicUrl ? <Panel title="Share">
      <div className="ov-stack-sm">
        <CopyLink url={data.publicUrl} />
        <Text type="supporting" color="secondary">{data.viewCount ? `Opened ${data.viewCount} time${data.viewCount === 1 ? '' : 's'}, last ${date(data.lastViewedAt)}.` : 'Not opened yet.'}{data.validUntil ? ` Valid until ${date(data.validUntil)}.` : ''}</Text>
      </div>
    </Panel> : null}
    {data.status === 'accepted' ? <Panel title="Signature record" description="Kept with the proposal as evidence of acceptance.">
      <div className="ov-revenue-audit">
        <Text>Signed by <strong>{data.signerName}</strong> ({data.signerEmail}) on {date(data.acceptedAt)}.</Text>
        <Text type="supporting" color="secondary">SHA-256 of the accepted content: <code>{data.documentHash}</code></Text>
      </div>
    </Panel> : null}
    {data.status === 'declined' ? <Panel title="Declined"><Text>{data.declineReason || 'No reason given.'}</Text></Panel> : null}
    <div className="ov-crm-detail">
      <div className="ov-stack">
        <Panel title="Proposal">
          <div className="ov-stack-sm">
            <TextInput label="Title" value={draft.title} isReadOnly={!editable} onChange={value => setDraft({ ...draft, title: value })} />
            <TextArea label="Introduction" description="Shown at the top of the proposal. Blank lines start new paragraphs." rows={5} value={draft.intro} isReadOnly={!editable} onChange={value => setDraft({ ...draft, intro: value })} />
          </div>
        </Panel>
        <Panel title="Pricing" description={`Prices in ${data.currency}. Recurring lines start a subscription when the proposal is accepted.`}>
          <div className="ov-stack-sm">
            <LinesEditor lines={draft.lines} currency={data.currency} readOnly={!editable} onError={setLineError} onChange={lines => { setLineError(undefined); setDraft({ ...draft, lines }); }} />
            <TotalsBox lines={draft.lines} currency={data.currency} />
          </div>
        </Panel>
        <Panel title="Terms">
          <TextArea label="Terms" isLabelHidden rows={5} value={draft.terms} isReadOnly={!editable} onChange={value => setDraft({ ...draft, terms: value })} />
        </Panel>
      </div>
      <div className="ov-crm-side">
        <Panel title="Client">
          <div className="ov-stack-sm">
            <Text>{data.contactName || 'No contact chosen'}</Text>
            {data.contactEmail ? <Text type="supporting" color="secondary">{data.contactEmail}</Text> : null}
            {editable ? <ContactPicker label="Change contact" value={contactOption(data.contactId, data.contactName)}
              onChange={next => void action.run(async () => { await api(`/revenue/quotes/${id}`, 'PATCH', { contactId: next?.auxiliaryData?.id ?? null }); quote.refresh(); }, 'Contact updated.')} /> : null}
          </div>
        </Panel>
        <Panel title="Payment">
          <div className="ov-stack-sm">
            <NumberInput label="Due on acceptance (%)" description="0 invoices in full with normal terms; 100 asks for payment in full now." min={0} max={100}
              value={draft.depositPercent} isReadOnly={!editable} onChange={value => setDraft({ ...draft, depositPercent: value ?? 0 })} />
            <DateInput label="Valid until" hasClear value={(draft.validUntil ?? undefined) as never} isDisabled={!editable} onChange={value => setDraft({ ...draft, validUntil: (value as string | undefined) ?? null })} />
          </div>
        </Panel>
        <Panel title="Invoices"><InvoiceRows items={data.invoices} /></Panel>
      </div>
    </div>
    {sending ? <SendDialog quote={data} onClose={() => setSending(false)} onSent={() => { setSending(false); quote.refresh(); }} /> : null}
    {confirm ? <ConfirmDialog title={confirm === 'void' ? 'Withdraw this proposal?' : 'Delete this draft?'}
      description={confirm === 'void' ? 'The client link will show it as withdrawn. You can revise it to send a new version.' : 'The draft is removed permanently.'}
      actionLabel={confirm === 'void' ? 'Withdraw' : 'Delete'} busy={action.busy} onClose={() => setConfirm(null)}
      onConfirm={() => void action.run(async () => {
        if (confirm === 'void') { await api(`/revenue/quotes/${id}/void`, 'POST'); setConfirm(null); quote.refresh(); }
        else { await api(`/revenue/quotes/${id}`, 'DELETE'); router.push('/sales/proposals'); }
      })} /> : null}
  </div>;
}

function stripLine(line: Line): LineInput {
  return { productId: line.productId, name: line.name, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, discountPercent: line.discountPercent, taxRate: line.taxRate, billing: line.billing };
}

function SendDialog({ quote, onClose, onSent }: { quote: Quote; onClose: () => void; onSent: () => void }) {
  const action = useAction();
  const [email, setEmail] = useState(Boolean(quote.contactEmail));
  const [note, setNote] = useState(`Here is our proposal “${quote.title}”. You can review it, ask questions and accept it online.`);
  const [result, setResult] = useState<{ status: string; reason: string } | null>(null);
  return <Modal title="Send proposal" onClose={result ? onSent : onClose}>
    {result ? <div className="ov-stack-sm">
      <Feedback notice={result.status === 'sent' ? 'Sent to the client.' : undefined} error={result.status === 'sent' ? undefined : `The proposal is live, but the email was not delivered: ${result.reason}`} />
      <Text>Copy the client link from the Share panel to send it yourself.</Text>
      <FormActions><Button label="Done" variant="primary" onClick={onSent} /></FormActions>
    </div> : <div className="ov-stack-sm">
      <Text>Sending freezes the content and creates the client link. Changes after that need a revision.</Text>
      <CheckboxInput label={quote.contactEmail ? `Email it to ${quote.contactEmail}` : 'Email it (choose a contact first)'} value={email} isDisabled={!quote.contactEmail} onChange={value => setEmail(Boolean(value))} />
      {email ? <TextArea label="Message" rows={4} value={note} onChange={setNote} /> : null}
      <Feedback error={action.error} />
      <FormActions>
        <Button label="Cancel" variant="ghost" onClick={onClose} />
        <Button label={email ? 'Send' : 'Create link'} variant="primary" isLoading={action.busy} onClick={() => void action.run(async () => {
          const sent = await api<{ delivery: { status: string; reason: string } | null }>(`/revenue/quotes/${quote.id}/send`, 'POST', { email, message: note });
          if (sent.delivery) setResult(sent.delivery);
          else onSent();
        })} />
      </FormActions>
    </div>}
  </Modal>;
}

/* ── Deal page panel ──────────────────────────────────────────────────── */

type DealLines = { lines: Line[]; totals: Totals; currency: string; dealValue: number };

export function DealRevenuePanel({ dealId, onChanged }: { dealId: string; onChanged: () => void }) {
  const router = useRouter();
  const lines = useResource<DealLines>(`/revenue/deals/${dealId}/lines`);
  const summary = useResource<{ quotes: QuoteSummary[]; invoices: InvoiceSummary[] }>(`/revenue/deals/${dealId}/summary`);
  const action = useAction();
  const [draft, setDraft] = useState<EditableLine[] | null>(null);
  const [synced, setSynced] = useState<DealLines>();
  const [lineError, setLineError] = useState<string>();
  if (lines.data && lines.data !== synced) { setSynced(lines.data); setDraft(lines.data.lines.map(line => keyed(stripLine(line)))); }
  if (!lines.data || !draft) return <Panel title="Products & proposals"><AsyncState loading={lines.loading} error={lines.error} retry={lines.refresh} /></Panel>;
  const currency = lines.data.currency;
  const dirty = JSON.stringify(draft.map(toLineInput)) !== JSON.stringify(lines.data.lines.map(stripLine));
  return <Panel title="Products & proposals" description="Line items set the deal’s value (one-time lines plus one period of each recurring line)."
    action={<Button size="sm" label="Create proposal" icon={<Plus size={14} />} isLoading={action.busy && !dirty} onClick={() => void action.run(async () => {
      if (dirty) await api(`/revenue/deals/${dealId}/lines`, 'POST', { lines: draft.map(toLineInput) });
      const quote = await api<Quote>('/revenue/quotes', 'POST', { dealId });
      router.push(`/sales/proposals/${quote.id}`);
    })} />}>
    <div className="ov-stack-sm">
      <Feedback error={action.error ?? lineError} />
      <LinesEditor lines={draft} currency={currency} onError={setLineError} onChange={next => { setLineError(undefined); setDraft(next); }} />
      {draft.length ? <TotalsBox lines={draft} currency={currency} /> : null}
      {dirty ? <FormActions>
        <Button label="Discard" variant="ghost" onClick={() => setDraft(lines.data!.lines.map(line => keyed(stripLine(line))))} />
        <Button label="Save line items" variant="primary" isLoading={action.busy} onClick={() => void action.run(async () => {
          await api(`/revenue/deals/${dealId}/lines`, 'POST', { lines: draft.map(toLineInput) }); lines.refresh(); onChanged();
        }, 'Line items saved; deal value updated.')} />
      </FormActions> : null}
      {summary.data?.quotes.length ? <ul className="ov-rows">{summary.data.quotes.map(item => <li key={item.id}>
        <span className="ov-cell"><NextLink href={`/sales/proposals/${item.id}`}>{item.number} · {item.title}</NextLink>
          <Text type="supporting" color="secondary">{cash(item.total, item.currency)}{item.lastViewedAt ? ` · viewed ${item.viewCount}×` : ''}</Text></span>
        <QuoteBadge quote={item} />
      </li>)}</ul> : null}
      {summary.data?.invoices.length ? <InvoiceRows items={summary.data.invoices} /> : null}
    </div>
  </Panel>;
}
