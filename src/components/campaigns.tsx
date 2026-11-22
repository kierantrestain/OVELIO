'use client';

import { Eye, MailCheck, Plus, RefreshCw, Send, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { DateTimeInput } from '@astryxdesign/core/DateTimeInput';
import type { ISODateTimeString } from '@astryxdesign/core/DateTimeInput';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Campaign, CampaignInput, MailingList, Page, Template } from '@/contracts';
import { api, date, number, useAction, useFields, useResource } from './client';
import { EmailMetrics } from './overview';
import { AsyncState, Empty, Feedback, FormActions, Modal, PageHeader, Pager, Panel, Rows, StatusBadge, Tabs } from './ui';
import type { Tone } from './ui';

const path = '/campaigns';
const tabs = ['Newsletters', 'Templates'] as const;
const layoutStarter = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="22" style="max-width:600px;font-family:Arial,sans-serif">
      <tr><td>
        <h1>Your newsletter heading</h1>
        <p>Write your first update here.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
const templateStarter = `<div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif">
  {{ template "content" . }}
</div>`;

const statusTone: Record<string, Tone> = { finished: 'success', running: 'success', scheduled: 'info', paused: 'warning', cancelled: 'error' };
function Status({ status }: { status: string }) {
  const label = status === 'running' ? 'Sending' : status ? status[0].toUpperCase() + status.slice(1) : 'Unknown';
  return <StatusBadge label={label} tone={statusTone[status] ?? 'neutral'} />;
}

function CampaignForm({ campaign, onClose, onDone }: { campaign?: Campaign; onClose: () => void; onDone: (value: Campaign) => void }) {
  const lists = useResource<MailingList[]>('/lists');
  const templates = useResource<Template[]>('/templates');
  const action = useAction();
  const { values, field, setValues } = useFields({ name: campaign?.name ?? '', subject: campaign?.subject ?? '', body: campaign?.body ?? '' });
  const [listIds, setListIds] = useState<number[]>(campaign?.listIds ?? []);
  const [templateId, setTemplateId] = useState(campaign?.templateId ? String(campaign.templateId) : 'default');
  const hasLists = !!lists.data?.length;
  return <Modal title={campaign ? 'Edit newsletter' : 'Create newsletter'} onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (!listIds.length) throw new Error('Choose at least one mailing list.');
        const input: CampaignInput = { name: values.name.trim(), subject: values.subject.trim(), body: values.body, listIds,
          templateId: templateId === 'default' ? undefined : Number(templateId) };
        onDone(await api<Campaign>(campaign ? `${path}/${campaign.id}` : path, campaign ? 'PATCH' : 'POST', input));
      });
    }}>
      <div className="ov-form-grid">
        <TextInput label="Newsletter name" isRequired {...field('name')} />
        <TextInput label="Subject" isRequired {...field('subject')} />
      </div>
      {hasLists ? <fieldset className="ov-stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <Text as="label" type="label">Mailing lists</Text>
        {lists.data?.map(list => <CheckboxInput key={list.id} label={list.name}
          description={list.subscriberCount == null ? undefined : `${number(list.subscriberCount)} subscribers`}
          value={listIds.includes(list.id)} onChange={checked => setListIds(ids => checked ? [...ids, list.id] : ids.filter(item => item !== list.id))} />)}
      </fieldset> : lists.data ? <Text color="secondary">Create or sync a mailing list in <Link href="/audience">Audience</Link> before composing a newsletter.</Text>
        : <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />}
      <Selector label="Email template" value={templateId} onChange={value => setTemplateId(value ?? 'default')} isLoading={templates.loading}
        options={[{ value: 'default', label: 'Default template' }, ...(templates.data ?? []).map(item => ({ value: String(item.id), label: item.name }))]} />
      <Feedback error={templates.error} />
      <div className="ov-actions ov-actions--between"><Text type="supporting" color="secondary">Use responsive HTML for your message.</Text>
        {!values.body ? <Button size="sm" label="Use starter layout" onClick={() => setValues(current => ({ ...current, body: layoutStarter }))} /> : null}</div>
      <TextArea label="Email content (HTML)" rows={10} isRequired placeholder="<h1>News from your team</h1>" hasSpellCheck={false} {...field('body')} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={campaign ? 'Save changes' : 'Save draft'} isLoading={action.busy} isDisabled={!hasLists || !values.body.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

function TemplateForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', body: templateStarter });
  return <Modal title="Create email template" onClose={onClose} size="large">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { await api('/templates', 'POST', { name: values.name.trim(), body: values.body }); onDone(); });
    }}>
      <TextInput label="Template name" isRequired {...field('name')} />
      <TextArea label="Template HTML" description="Place the content slot where the newsletter body should appear." rows={8} hasSpellCheck={false} isRequired {...field('body')} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Save template" isLoading={action.busy} isDisabled={!values.name.trim()} /></FormActions>
    </form>
  </Modal>;
}

export function Campaigns() {
  const router = useRouter();
  const [tab, setTab] = useState<typeof tabs[number]>('Newsletters');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const campaigns = useResource<Page<Campaign>>(tab === 'Newsletters' ? `${path}?page=${page}` : null);
  const templates = useResource<Template[]>(tab === 'Templates' ? '/templates' : null);
  return <>
    <PageHeader title="Campaigns" description="Compose newsletters, schedule delivery and review email performance."
      actions={<Button variant="primary" icon={<Plus size={16} />} label={tab === 'Newsletters' ? 'Create newsletter' : 'Create template'}
        onClick={() => { setCreate(true); setNotice(''); }} />} />
    <Tabs label="Campaign view" items={tabs} value={tab} onChange={value => { setTab(value); setNotice(''); }} />
    <Feedback notice={notice} />
    {tab === 'Newsletters' ? <Panel title="Newsletters">
      {!campaigns.data ? <AsyncState loading={campaigns.loading} error={campaigns.error} retry={campaigns.refresh} /> : <>
        <Table data={campaigns.data.items} idKey="id" hasHover emptyState={<Empty title="No newsletters yet" description="Create a newsletter draft, preview it and send a test before delivery." />}
          columns={[
            { key: 'name', header: 'Newsletter', renderCell: item => <span className="ov-cell"><Link href={`/campaigns/${item.id}`}>{item.name}</Link>
              <Text type="supporting" color="secondary">{item.subject}</Text></span> },
            { key: 'status', header: 'Status', renderCell: item => <Status status={item.status} /> },
            { key: 'sendAt', header: 'Send time', renderCell: item => date(item.sendAt) },
            { key: 'sent', header: 'Sent', align: 'end', renderCell: item => number(item.metrics.sent) },
            { key: 'opens', header: 'Opens', align: 'end', renderCell: item => number(item.metrics.opens) },
            { key: 'clicks', header: 'Clicks', align: 'end', renderCell: item => number(item.metrics.clicks) },
          ]} />
        <Pager {...campaigns.data} onPage={setPage} />
      </>}
    </Panel> : <Panel title="Email templates" description="Choose a saved layout when composing a newsletter.">
      {!templates.data ? <AsyncState loading={templates.loading} error={templates.error} retry={templates.refresh} />
        : templates.data.length ? <Rows>{templates.data.map(template => <li key={template.id}><Text>{template.name}</Text></li>)}</Rows>
          : <Empty title="No templates yet" description="Save a reusable layout with a content slot." />}
    </Panel>}
    {create && tab === 'Newsletters' ? <CampaignForm onClose={() => setCreate(false)} onDone={campaign => router.push(`/campaigns/${campaign.id}`)} /> : null}
    {create && tab === 'Templates' ? <TemplateForm onClose={() => setCreate(false)} onDone={() => { setCreate(false); setNotice('Template saved.'); templates.refresh(); }} /> : null}
  </>;
}

function Preview({ id, onClose }: { id: number; onClose: () => void }) {
  const preview = useResource<string>(`${path}/${id}/preview`);
  const [device, setDevice] = useState('desktop');
  return <Modal title="Preview newsletter" onClose={onClose} size="large">
    <SegmentedControl label="Preview width" value={device} onChange={setDevice}>
      <SegmentedControlItem value="desktop" label="Desktop" /><SegmentedControlItem value="mobile" label="Mobile" />
    </SegmentedControl>
    {preview.data ? <iframe title="Newsletter preview" className={`ov-preview ${device === 'mobile' ? 'ov-preview--mobile' : ''}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.data} />
      : <AsyncState loading={preview.loading} error={preview.error} retry={preview.refresh} />}
  </Modal>;
}

type DeliveryMode = 'test' | 'schedule' | 'send' | 'pause';

function DeliveryDialog({ mode, campaign, onClose, onDone }: { mode: DeliveryMode; campaign: Campaign; onClose: () => void; onDone: (notice: string) => void }) {
  const action = useAction();
  const [email, setEmail] = useState('');
  const [sendAt, setSendAt] = useState<ISODateTimeString>();
  const scheduled = campaign.status === 'scheduled';
  const copy = {
    test: { title: 'Send test email', endpoint: 'test', notice: 'Test email submitted to delivery.' },
    schedule: { title: 'Schedule newsletter', endpoint: 'schedule', notice: 'Newsletter scheduled.' },
    send: { title: campaign.status === 'paused' ? 'Resume sending' : 'Send newsletter', endpoint: 'start', notice: 'Delivery started.' },
    pause: scheduled ? { title: 'Cancel schedule', endpoint: 'pause', notice: 'Schedule cancelled. The newsletter is now a draft.' }
      : { title: 'Pause sending', endpoint: 'pause', notice: 'Delivery paused.' },
  }[mode];
  return <Modal title={copy.title} onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (mode === 'schedule' && !sendAt) throw new Error('Choose a send date and time.');
        const body = mode === 'test' ? { email: email.trim() } : mode === 'schedule' ? { sendAt: new Date(sendAt!).toISOString() } : undefined;
        await api(`${path}/${campaign.id}/${copy.endpoint}`, 'POST', body);
        onDone(copy.notice);
      });
    }}>
      {mode === 'test' ? <TextInput label="Recipient email" type="email" description="Use an audience contact with recorded marketing consent." isRequired value={email} onChange={setEmail} /> : null}
      {mode === 'schedule' ? <DateTimeInput label="Send date and time" description="Uses your device's local timezone." isRequired value={sendAt} onChange={setSendAt} /> : null}
      {mode === 'send' ? <Text>Start sending <strong>{campaign.name}</strong> to eligible subscribers on its selected lists? Suppressed and unsubscribed addresses are excluded.</Text> : null}
      {mode === 'pause' ? <Text>{scheduled ? <>Return <strong>{campaign.name}</strong> to draft and cancel its scheduled send?</>
        : <>Pause delivery of <strong>{campaign.name}</strong>? Emails already submitted for delivery may still arrive.</>}</Text> : null}
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={mode === 'send' && campaign.status !== 'paused' ? 'Send now' : copy.title} isLoading={action.busy} />
      </FormActions>
    </form>
  </Modal>;
}

export function CampaignView({ id }: { id: string }) {
  const resource = useResource<Campaign>(`${path}/${id}`);
  const lists = useResource<MailingList[]>('/lists');
  const [modal, setModal] = useState<DeliveryMode | 'edit' | 'preview'>();
  const [notice, setNotice] = useState('');
  const campaign = resource.data;
  function finish(value: string) { setModal(undefined); setNotice(value); resource.refresh(); }

  return <>
    <PageHeader back={{ href: '/campaigns', label: 'Campaigns' }} title={campaign?.name || 'Newsletter'} description={campaign?.subject || 'Newsletter details and performance.'}
      actions={campaign ? <>
        <Button label="Preview" icon={<Eye size={15} />} onClick={() => setModal('preview')} />
        <Button label="Send test" icon={<MailCheck size={15} />} onClick={() => setModal('test')} />
        {['draft', 'paused', 'scheduled'].includes(campaign.status) ? <Button label="Schedule" icon={<Timer size={15} />} onClick={() => setModal('schedule')} /> : null}
        {['draft', 'paused'].includes(campaign.status) ? <Button variant="primary" icon={<Send size={15} />} label={campaign.status === 'paused' ? 'Resume' : 'Send newsletter'} onClick={() => setModal('send')} /> : null}
        {campaign.status === 'running' || campaign.status === 'scheduled'
          ? <Button label={campaign.status === 'scheduled' ? 'Cancel schedule' : 'Pause'} onClick={() => setModal('pause')} /> : null}
      </> : undefined} />
    {!campaign ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel> : <div className="ov-stack">
      <Feedback notice={notice} />
      <Panel title="Email performance" action={<Button size="sm" label="Refresh metrics" icon={<RefreshCw size={14} />} onClick={resource.refresh} isLoading={resource.loading} />}>
        <EmailMetrics metrics={campaign.metrics} />
      </Panel>
      <Panel title="Newsletter details" action={campaign.status === 'draft' ? <Button size="sm" label="Edit newsletter" onClick={() => setModal('edit')} /> : undefined}>
        <MetadataList>
          <MetadataListItem label="Status"><Status status={campaign.status} /></MetadataListItem>
          <MetadataListItem label="From">{campaign.fromEmail || 'Configured sender'}</MetadataListItem>
          <MetadataListItem label="Mailing lists">{campaign.listIds.map(listId => lists.data?.find(list => list.id === listId)?.name || `List ${listId}`).join(', ') || '—'}</MetadataListItem>
          <MetadataListItem label="Created">{date(campaign.createdAt)}</MetadataListItem>
          <MetadataListItem label="Send time">{date(campaign.sendAt)}</MetadataListItem>
        </MetadataList>
      </Panel>
    </div>}
    {campaign && modal === 'edit' ? <CampaignForm campaign={campaign} onClose={() => setModal(undefined)} onDone={() => finish('Changes saved.')} /> : null}
    {campaign && modal === 'preview' ? <Preview id={campaign.id} onClose={() => setModal(undefined)} /> : null}
    {campaign && modal && modal !== 'preview' && modal !== 'edit' ? <DeliveryDialog mode={modal} campaign={campaign} onClose={() => setModal(undefined)} onDone={finish} /> : null}
  </>;
}
