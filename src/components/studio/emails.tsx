'use client';

// Marketing › Emails: newsletters on Listmonk, with a guided "Create email campaign" flow built on studio designs.
// The flow uses the existing campaign, template and list endpoints; the design's compiled HTML is converted to
// Listmonk syntax (toListmonkHtml) on the server first.
import { Copy, MailCheck, PenLine, Plus, Search, Send, Timer, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateTimeInput } from '@astryxdesign/core/DateTimeInput';
import type { ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Campaign, MailingList, Page, Template } from '@/contracts';
import type { AudienceEstimate, Design, DesignSummary, EngineExport, RenderedPreview, SampleContact, TestSendResult } from '@/contracts/studio';
import { api, date, number, useAction, useResource } from '../client';
import { usePreview, useUser } from '../shell';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, PageHeader, Pager, Panel, StatusBadge } from '../ui';
import type { Tone } from '../ui';
import { ContactPicker, DeviceToggle, EmailFrame, SendStatus } from './common';
import { Thumb } from './gallery';
import '@/styles/studio.css';

const statusTone: Record<string, Tone> = { finished: 'success', running: 'success', scheduled: 'info', paused: 'warning', cancelled: 'error' };
const statusOptions = [
  { value: 'all', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Sending' }, { value: 'paused', label: 'Paused' }, { value: 'finished', label: 'Sent' }, { value: 'cancelled', label: 'Cancelled' },
];
const passthroughName = 'OVELIO studio · full design';

function Status({ status }: { status: string }) {
  const label = status === 'running' ? 'Sending' : status === 'finished' ? 'Sent' : status ? status[0].toUpperCase() + status.slice(1) : 'Unknown';
  return <StatusBadge label={label} tone={statusTone[status] ?? 'neutral'} />;
}

const rate = (part: number | null, whole: number | null) => part == null || !whole ? '—' : `${Math.round((part / whole) * 1000) / 10}%`;

export function EmailsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = useUser().role !== 'analyst';
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(params.get('create') === '1');
  const [deleting, setDeleting] = useState<Campaign>();
  const action = useAction();
  const query = new URLSearchParams({ page: String(page) });
  if (status !== 'all') query.set('status', status);
  if (search) query.set('q', search);
  const campaigns = useResource<Page<Campaign>>(`/campaigns?${query}`);

  return <div className="ov-stack">
    <PageHeader title="Emails" description="Newsletters and broadcasts: design, test, schedule and report."
      actions={canEdit ? <Button variant="primary" icon={<Plus size={16} />} label="Create email campaign" onClick={() => setCreating(true)} /> : undefined} />
    <Feedback error={action.error} notice={action.notice} />
    <Panel>
      <div className="ov-studio-toolbar">
        <form className="ov-actions" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(draft.trim()); }}>
          <TextInput label="Search emails" isLabelHidden type="search" placeholder="Search by name or subject…" value={draft} onChange={setDraft} startIcon={<Search size={14} />} width={280} />
          <Button type="submit" label="Search" />
        </form>
        <Selector label="Status" isLabelHidden value={status} onChange={value => { setStatus(value ?? 'all'); setPage(1); }} options={statusOptions} width={180} />
      </div>
      {!campaigns.data ? <AsyncState loading={campaigns.loading} error={campaigns.error} retry={campaigns.refresh} /> : <>
        <Table data={campaigns.data.items} idKey="id" hasHover
          emptyState={<Empty title={search || status !== 'all' ? 'No matching emails' : 'No emails yet'} description="Create an email campaign from a template or one of your designs."
            action={canEdit ? <Button variant="primary" label="Create email campaign" onClick={() => setCreating(true)} /> : undefined} />}
          columns={[
            { key: 'name', header: 'Email', renderCell: item => <span className="ov-cell"><NextLink href={`/marketing/emails/${item.id}`}><strong>{item.name}</strong></NextLink><Text type="supporting" color="secondary">{item.subject}</Text></span> },
            { key: 'status', header: 'Status', width: { type: 'pixel', value: 120 } as const, renderCell: item => <Status status={item.status} /> },
            { key: 'sendAt', header: 'Send date', width: { type: 'pixel', value: 170 } as const, renderCell: item => <span className="ov-cell--nowrap">{item.sendAt ? date(item.sendAt) : item.status === 'draft' ? 'Not scheduled' : '—'}</span> },
            { key: 'toSend', header: 'Recipients', width: { type: 'pixel', value: 110 } as const, align: 'end', renderCell: item => <span className="ov-studio-count">{number(item.metrics.sent || item.toSend || null)}</span> },
            { key: 'metrics', header: 'Opens', width: { type: 'pixel', value: 90 } as const, align: 'end', renderCell: item => <span className="ov-studio-count">{rate(item.metrics.opens, item.metrics.sent)}</span> },
            { key: 'tags', header: 'Clicks', width: { type: 'pixel', value: 90 } as const, align: 'end', renderCell: item => <span className="ov-studio-count">{rate(item.metrics.clicks, item.metrics.sent)}</span> },
            ...(canEdit ? [{
              key: 'id' as const, header: '', width: { type: 'pixel', value: 96 } as const, align: 'end' as const, renderCell: (item: Campaign) => <span className="ov-actions ov-actions--end">
                <IconButton size="sm" variant="ghost" label={`Duplicate ${item.name}`} tooltip="Duplicate" icon={<Copy size={15} />} isDisabled={action.busy}
                  onClick={() => void action.run(async () => { await api(`/campaigns/${item.id}/clone`, 'POST'); campaigns.refresh(); }, 'Email duplicated as a new draft.')} />
                {['draft', 'cancelled', 'finished'].includes(item.status) ? <IconButton size="sm" variant="ghost" label={`Delete ${item.name}`} tooltip="Delete" icon={<Trash2 size={15} />} onClick={() => setDeleting(item)} /> : null}
              </span>,
            }] : []),
          ]} />
        <Pager {...campaigns.data} onPage={setPage} />
      </>}
    </Panel>
    {creating ? <CreateCampaign initialDesign={params.get('design')} onClose={() => setCreating(false)} onCreated={id => router.push(`/marketing/emails/${id}`)} /> : null}
    {deleting ? <ConfirmDialog title="Delete email" description={`Delete “${deleting.name}” permanently? This cannot be undone.`} actionLabel="Delete" busy={action.busy}
      onClose={() => setDeleting(undefined)} onConfirm={() => void action.run(async () => { await api(`/campaigns/${deleting.id}`, 'DELETE'); setDeleting(undefined); campaigns.refresh(); }, 'Email deleted.')} /> : null}
  </div>;
}

const steps = ['Design', 'Audience', 'Details', 'Preview & test', 'Send'] as const;

function CreateCampaign({ initialDesign, onClose, onCreated }: { initialDesign: string | null; onClose: () => void; onCreated: (id: number) => void }) {
  const preview = usePreview();
  const [step, setStep] = useState(0);
  const [designId, setDesignId] = useState<string | null>(initialDesign);
  const [listIds, setListIds] = useState<number[]>([]);
  const [fields, setFields] = useState<{ name: string; subject: string; preheader: string } | null>(null);
  const [contact, setContact] = useState<SampleContact | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [tests, setTests] = useState<TestSendResult[]>();
  const [when, setWhen] = useState<'now' | 'schedule' | 'draft'>('draft');
  const [sendAt, setSendAt] = useState<ISODateTimeString>();
  const designs = useResource<{ items: DesignSummary[] }>('/studio/designs?kind=email');
  const design = useResource<Design>(designId ? `/studio/designs/${designId}` : null);
  const lists = useResource<MailingList[]>('/lists');
  const audience = useResource<AudienceEstimate>(listIds.length ? `/studio/audience?listIds=${listIds.join(',')}` : null);
  const rendered = useResource<RenderedPreview>(step === 3 && designId ? `/studio/designs/${designId}/render${contact ? `?contactId=${contact.id}` : ''}` : null);
  const action = useAction();
  const tester = useAction();

  const values = fields ?? { name: design.data?.name ?? '', subject: design.data?.subject ?? '', preheader: design.data?.preheader ?? '' };
  const setValue = (key: 'name' | 'subject' | 'preheader', value: string) => setFields({ ...values, [key]: value });
  const canNext = step === 0 ? !!design.data : step === 1 ? listIds.length > 0 : step === 2 ? !!values.name.trim() && !!values.subject.trim() : true;

  /** Saves edited subject or preview text back to the design, so the studio, tests and newsletter all match. */
  async function syncDesign() {
    if (!design.data || !fields) return;
    if (fields.subject === design.data.subject && fields.preheader === design.data.preheader) return;
    await api(`/studio/designs/${design.data.id}`, 'PATCH', { version: design.data.version, subject: fields.subject, preheader: fields.preheader });
    design.refresh();
  }

  async function create() {
    if (!design.data) throw new Error('Choose a design first.');
    if (when === 'schedule' && !sendAt) throw new Error('Choose a send date and time.');
    await syncDesign();
    const templates = await api<Template[]>('/templates?type=campaign');
    const wrapper = templates.find(item => item.name === passthroughName)
      ?? await api<Template>('/templates', 'POST', { name: passthroughName, type: 'campaign', body: '{{ template "content" . }}' });
    const exported = await api<EngineExport>(`/studio/designs/${design.data.id}/export?engine=listmonk`);
    const campaign = await api<Campaign>('/campaigns', 'POST', {
      name: values.name.trim(), subject: exported.subject || values.subject.trim(), body: exported.html, listIds, contentType: 'html', templateId: wrapper.id, tags: ['studio'],
    });
    await api(`/studio/designs/${design.data.id}/links`, 'POST', { engine: 'listmonk_campaign', engineId: String(campaign.id), label: campaign.name });
    if (when === 'now') await api(`/campaigns/${campaign.id}/start`, 'POST');
    if (when === 'schedule') await api(`/campaigns/${campaign.id}/schedule`, 'POST', { sendAt: new Date(sendAt!).toISOString() });
    onCreated(campaign.id);
  }

  return <Modal title="Create email campaign" onClose={onClose} size="wide">
    <ol className="ov-studio-steps" aria-label="Steps">
      {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-done={index < step}>{index + 1}. {label}</li>)}
    </ol>

    {step === 0 ? <div className="ov-stack-sm">
      <Text color="secondary">Choose the design to send. Start from a <NextLink href="/marketing/templates?create=email">template</NextLink> if you have none yet.</Text>
      {!designs.data ? <AsyncState loading={designs.loading} error={designs.error} retry={designs.refresh} />
        : designs.data.items.length ? <div className="ov-studio-choice">
          {designs.data.items.map(item => <div key={item.id} role="button" tabIndex={0} className="ov-studio-choice-item" aria-pressed={designId === item.id}
            onClick={() => { setDesignId(item.id); setFields(null); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setDesignId(item.id); setFields(null); } }}>
            <Thumb path={`/studio/designs/${item.id}/html`} label={item.name} />
            <strong>{item.name}</strong><span className="ov-studio-card-meta">{item.subject || 'No subject yet'}</span>
          </div>)}
        </div> : <Empty title="No designs yet" description="Create one from a template first." action={<NextLink href="/marketing/templates?create=email">Browse templates</NextLink>} />}
    </div> : null}

    {step === 1 ? <div className="ov-stack-sm">
      <Text color="secondary">Choose the mailing lists to send to. Only subscribers with recorded consent who are not unsubscribed, bounced or suppressed receive the email.</Text>
      {!lists.data ? <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />
        : lists.data.length ? <div className="ov-form-grid">{lists.data.map(list => <CheckboxInput key={list.id} label={list.name}
          description={`${list.subscriberCount == null ? 'Size unknown' : `${number(list.subscriberCount)} subscribers`}${list.optin === 'double' ? ' · double opt-in' : ''}`}
          value={listIds.includes(list.id)} onChange={checked => setListIds(ids => checked ? [...ids, list.id] : ids.filter(id => id !== list.id))} />)}</div>
          : <Empty title="No mailing lists" description="Create a list in Marketing › Mailing lists first." />}
      {listIds.length ? (audience.data ? <Banner status={audience.data.eligible ? 'info' : 'warning'}
        title={`${number(audience.data.eligible)} ${audience.data.eligible === 1 ? 'person' : 'people'} will receive this email · ${number(audience.data.excluded)} excluded`}
        description={`${audience.data.lists.map(item => `${item.name}: ${number(item.eligible)} with consent, ${number(item.excluded)} excluded`).join(' · ')}. ${audience.data.note}`} />
        : <AsyncState loading={audience.loading} error={audience.error} retry={audience.refresh} />) : null}
    </div> : null}

    {step === 2 ? <div className="ov-stack-sm">
      <TextInput label="Campaign name" description="Only your team sees this." value={values.name} onChange={value => setValue('name', value)} isRequired />
      <TextInput label="Subject" value={values.subject} onChange={value => setValue('subject', value)} isRequired description="Personalise with {{contact.first_name | there}}." />
      <TextInput label="Preview text" value={values.preheader} onChange={value => setValue('preheader', value)} description="Shown after the subject in most inboxes." isOptional />
      <Text type="supporting" color="secondary">Sender: the workspace sender address and name configured in Settings › Connections. Changing the subject or preview text here also updates the design.</Text>
    </div> : null}

    {step === 3 && designId ? <div className="ov-stack-sm">
      <div className="ov-actions ov-actions--between"><ContactPicker value={contact} onChange={setContact} label="Preview as" /><DeviceToggle value={device} onChange={setDevice} /></div>
      {fields ? <Banner status="info" title="Subject and preview text changes are saved to the design when you continue." /> : null}
      {rendered.data ? <><div className="ov-studio-inbox"><strong>{rendered.data.subject}</strong><span>{rendered.data.preheader}</span></div>
        <EmailFrame html={rendered.data.html} title="Personalised preview" device={device} height={420} /></> : <AsyncState loading={rendered.loading} error={rendered.error} retry={rendered.refresh} />}
      <div className="ov-actions">
        <Button icon={<MailCheck size={15} />} label={contact ? `Send a test to ${contact.email}` : 'Choose a contact to send a test'} isDisabled={!contact} isLoading={tester.busy}
          onClick={() => void tester.run(async () => {
            await syncDesign();
            const sent = await api<{ results: TestSendResult[] }>(`/studio/designs/${designId}/test`, 'POST', { to: [contact!.email] });
            setTests(sent.results);
          })} />
      </div>
      {tests?.map(item => <div key={item.to} className="ov-actions"><SendStatus status={item.status} /><Text type="supporting">{item.to}: {item.reason}</Text></div>)}
      <Feedback error={tester.error} />
    </div> : null}

    {step === 4 ? <div className="ov-stack-sm">
      <div className="ov-studio-choice" role="radiogroup" aria-label="When to send">
        {([['draft', 'Save as draft', 'Create the newsletter and send it later.'], ['schedule', 'Schedule', 'Pick a date and time; recipients refresh shortly before.'], ['now', 'Send now', 'Start sending to everyone eligible straight away.']] as const)
          .map(([value, label, help]) => <button key={value} type="button" role="radio" aria-checked={when === value} className="ov-studio-choice-item" onClick={() => setWhen(value)}>
            <strong>{label}</strong><span className="ov-studio-card-meta">{help}</span>
          </button>)}
      </div>
      {when === 'schedule' ? <DateTimeInput label="Send date and time" description="Uses your device's time zone." value={sendAt} onChange={setSendAt} isRequired /> : null}
      <Banner status={when === 'now' ? 'warning' : 'info'} title={`${values.name || 'This email'} → ${listIds.length} ${listIds.length === 1 ? 'list' : 'lists'}${audience.data ? `, ${number(audience.data.eligible)} eligible recipients` : ''}`}
        description={preview ? 'Developer preview: the newsletter engine is simulated, so nothing is delivered.' : 'The newsletter engine sends with tracking and an unsubscribe link; suppressed addresses are skipped.'} />
    </div> : null}

    <Feedback error={action.error} />
    <FormActions>
      {step > 0 ? <Button label="Back" onClick={() => setStep(step - 1)} /> : <Button label="Cancel" onClick={onClose} />}
      {step < steps.length - 1
        ? <Button variant="primary" label="Continue" isDisabled={!canNext} isLoading={action.busy} onClick={() => void action.run(async () => { if (step === 2) await syncDesign(); setStep(step + 1); })} />
        : <Button variant="primary" icon={when === 'now' ? <Send size={15} /> : when === 'schedule' ? <Timer size={15} /> : undefined}
          label={when === 'now' ? 'Create and send' : when === 'schedule' ? 'Create and schedule' : 'Create draft'} isLoading={action.busy} onClick={() => void action.run(create)} />}
    </FormActions>
  </Modal>;
}

/** "Edit design" on a newsletter: opens its linked studio design, or imports the newsletter's HTML as one first. */
export function EditDesignButton({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const action = useAction();
  return <>
    <Button label="Edit design" icon={<PenLine size={15} />} isLoading={action.busy} onClick={() => void action.run(async () => {
      const found = await api<{ designId: string | null }>(`/studio/links?engine=listmonk_campaign&id=${campaign.id}`);
      if (found.designId) { router.push(`/studio/email/${found.designId}`); return; }
      const created = await api<{ id: string }>('/studio/designs', 'POST', {
        name: campaign.name, subject: campaign.subject, importHtml: campaign.body || '<p></p>', link: { engine: 'listmonk_campaign', engineId: String(campaign.id), label: campaign.name },
      });
      router.push(`/studio/email/${created.id}`);
    })} />
    {action.error ? <Text type="supporting" color="secondary">{action.error}</Text> : null}
  </>;
}
