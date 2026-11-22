'use client';

import { ArrowLeft, Eye, MailCheck, Plus, Send, Timer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Campaign, CampaignInput, MailingList, Page, Template } from '@/contracts';
import { api, date, number, useAction, useResource } from './client';
import { EmailMetrics } from './overview';
import { AsyncState, Badge, Button, Dialog, Empty, Feedback, Field, PageHeader, Pager, Panel } from './ui';

const path = '/campaigns';
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
type CampaignDialog = 'edit' | 'preview' | 'test' | 'schedule' | 'send' | 'pause';

function Status({ status }: { status: string }) {
  const tone = status === 'finished' || status === 'running' ? 'green' : status === 'scheduled' ? 'blue'
    : status === 'paused' ? 'amber' : status === 'cancelled' ? 'red' : 'neutral';
  const label = status === 'running' ? 'Sending' : status ? status[0].toUpperCase() + status.slice(1) : 'Unknown';
  return <Badge tone={tone}>{label}</Badge>;
}

function CampaignForm({ campaign, onClose, onDone }: { campaign?: Campaign; onClose: () => void; onDone: (value: Campaign) => void }) {
  const lists = useResource<MailingList[]>('/lists');
  const templates = useResource<Template[]>('/templates');
  const action = useAction();
  const [body, setBody] = useState(campaign?.body || '');
  const hasLists = !!lists.data?.length;
  return <Dialog title={campaign ? 'Edit newsletter' : 'Create newsletter'} onClose={onClose} size="large">
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const listIds = values.getAll('listIds').map(Number);
      const templateId = Number(values.get('templateId')) || undefined;
      void action.run(async () => {
        if (!listIds.length) throw new Error('Choose at least one mailing list.');
        const input: CampaignInput = { name: String(values.get('name')).trim(), subject: String(values.get('subject')).trim(),
          body: String(values.get('body')), listIds, templateId };
        onDone(await api<Campaign>(campaign ? `${path}/${campaign.id}` : path, campaign ? 'PATCH' : 'POST', input));
      });
    }}>
      <div className="form-grid">
        <Field label="Newsletter name"><input name="name" required maxLength={120} defaultValue={campaign?.name} /></Field>
        <Field label="Subject"><input name="subject" required maxLength={160} defaultValue={campaign?.subject} /></Field>
      </div>
      {hasLists ? <fieldset className="check-list"><legend>Mailing lists</legend>
        {lists.data?.map(list => <label key={list.id} className="check-line"><input type="checkbox" name="listIds" value={list.id} defaultChecked={campaign?.listIds.includes(list.id)} /> {list.name}
          {list.subscriberCount == null ? null : <small>· {number(list.subscriberCount)} subscribers</small>}</label>)}
      </fieldset> : lists.data ? <p className="caption">Create or sync a mailing list in <Link href="/audience" className="text-link">Audience</Link> before composing a newsletter.</p>
        : <AsyncState loading={lists.loading} error={lists.error} retry={lists.refresh} />}
      <Field label="Email template">
        <select name="templateId" key={templates.data ? 'ready' : 'loading'} defaultValue={campaign?.templateId ?? ''}>
          <option value="">Default template</option>
          {templates.data?.map(template => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </Field>
      <Feedback error={templates.error} />
      <div className="actions actions--between"><span className="caption">Use responsive HTML for your message.</span>
        {!body ? <Button onClick={() => setBody(layoutStarter)}>Use starter layout</Button> : null}</div>
      <Field label="Email content (HTML)"><textarea name="body" className="code-input" required maxLength={160000} rows={9}
        value={body} onChange={event => setBody(event.target.value)} placeholder="<h1>News from your team</h1>" /></Field>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy || !hasLists}>
        {campaign ? 'Save changes' : 'Save draft'}
      </Button></div>
    </form>
  </Dialog>;
}

function TemplateForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const action = useAction();
  return <Dialog title="Create email template" onClose={onClose} size="large">
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void action.run(async () => {
        await api('/templates', 'POST', { name: String(data.get('name')).trim(), body: String(data.get('body')) });
        onDone();
      });
    }}>
      <Field label="Template name"><input name="name" required maxLength={120} /></Field>
      <Field label="Template HTML" help="Place the content slot where the newsletter body should appear.">
        <textarea className="code-input" name="body" required defaultValue={templateStarter} maxLength={160000} rows={7} />
      </Field>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>Save template</Button></div>
    </form>
  </Dialog>;
}

export function Campaigns() {
  const router = useRouter();
  const [tab, setTab] = useState<'Newsletters' | 'Templates'>('Newsletters');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const campaigns = useResource<Page<Campaign>>(tab === 'Newsletters' ? `${path}?page=${page}` : null);
  const templates = useResource<Template[]>(tab === 'Templates' ? '/templates' : null);
  return <>
    <PageHeader title="Campaigns" description="Compose newsletters, schedule delivery and review email performance."
      actions={<Button variant="primary" onClick={() => { setCreate(true); setNotice(''); }}><Plus size={16} /> {tab === 'Newsletters' ? 'Create newsletter' : 'Create template'}</Button>} />
    <nav className="tabs" aria-label="Campaign view">
      {(['Newsletters', 'Templates'] as const).map(value => <button key={value} aria-pressed={value === tab} onClick={() => { setTab(value); setNotice(''); }}>{value}</button>)}
    </nav>
    <div className="stack-small">
      <Feedback notice={notice} />
      {tab === 'Newsletters' ? <Panel title="Newsletters">
        {!campaigns.data ? <AsyncState loading={campaigns.loading} error={campaigns.error} retry={campaigns.refresh} />
          : campaigns.data.items.length ? <><div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">Newsletter</th><th scope="col">Status</th><th scope="col">Send time</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Opens</th><th scope="col" className="num">Clicks</th></tr></thead>
            <tbody>{campaigns.data.items.map(item => <tr key={item.id}>
              <td><Link className="text-link" href={`/campaigns/${item.id}`}>{item.name}</Link><small>{item.subject}</small></td>
              <td><Status status={item.status} /></td><td className="no-wrap">{date(item.sendAt)}</td><td className="num">{number(item.metrics.sent)}</td>
              <td className="num">{number(item.metrics.opens)}</td><td className="num">{number(item.metrics.clicks)}</td>
            </tr>)}</tbody>
          </table></div><Pager {...campaigns.data} onPage={setPage} /></> : <Empty title="No newsletters yet" />}
      </Panel> : <Panel title="Email templates" description="Choose a saved layout when composing a newsletter.">
        {!templates.data ? <AsyncState loading={templates.loading} error={templates.error} retry={templates.refresh} />
          : templates.data.length ? <div className="panel-body"><ul className="line-list">
            {templates.data.map(template => <li key={template.id}><span>{template.name}</span></li>)}
          </ul></div> : <Empty title="No templates yet" />}
      </Panel>}
    </div>
    {create && tab === 'Newsletters' ? <CampaignForm onClose={() => setCreate(false)} onDone={campaign => router.push(`/campaigns/${campaign.id}`)} /> : null}
    {create && tab === 'Templates' ? <TemplateForm onClose={() => setCreate(false)} onDone={() => {
      setCreate(false);
      setNotice('Template saved.');
      templates.refresh();
    }} /> : null}
  </>;
}

function Preview({ id, onClose }: { id: number; onClose: () => void }) {
  const preview = useResource<string>(`${path}/${id}/preview`);
  const [mobile, setMobile] = useState(false);
  return <Dialog title="Preview newsletter" onClose={onClose} size="large">
    <div className="stack-small">
      <div className="actions"><Button aria-pressed={!mobile} onClick={() => setMobile(false)}>Desktop</Button>
        <Button aria-pressed={mobile} onClick={() => setMobile(true)}>Mobile</Button></div>
      {preview.data ? <iframe title="Newsletter preview" className={`preview-frame ${mobile ? 'preview-frame--mobile' : ''}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.data} />
        : <AsyncState loading={preview.loading} error={preview.error} retry={preview.refresh} />}
    </div>
  </Dialog>;
}

function DeliveryDialog({ mode, campaign, onClose, onDone }: {
  mode: 'test' | 'schedule' | 'send' | 'pause';
  campaign: Campaign;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const action = useAction();
  const copy = {
    test: { title: 'Send test email', endpoint: 'test', notice: 'Test email submitted to delivery.' },
    schedule: { title: 'Schedule newsletter', endpoint: 'schedule', notice: 'Newsletter scheduled.' },
    send: { title: campaign.status === 'paused' ? 'Resume sending' : 'Send newsletter', endpoint: 'start', notice: 'Delivery started.' },
    pause: { title: 'Pause sending', endpoint: 'pause', notice: 'Delivery paused.' },
  }[mode];
  return <Dialog title={copy.title} onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void action.run(async () => {
        const body = mode === 'test' ? { email: String(values.get('email')).trim() }
          : mode === 'schedule' ? { sendAt: new Date(String(values.get('sendAt'))).toISOString() } : undefined;
        await api(`${path}/${campaign.id}/${copy.endpoint}`, 'POST', body);
        onDone(copy.notice);
      });
    }}>
      {mode === 'test' ? <Field label="Recipient email" help="Use an audience contact with recorded marketing consent."><input name="email" type="email" required maxLength={254} /></Field> : null}
      {mode === 'schedule' ? <Field label="Send date and time" help="Enter the time in your device’s local timezone."><input name="sendAt" required type="datetime-local" /></Field> : null}
      {mode === 'send' ? <p>Start sending <strong>{campaign.name}</strong> to eligible subscribers on its selected lists?</p> : null}
      {mode === 'pause' ? <p>Pause delivery of <strong>{campaign.name}</strong>? Emails already submitted for delivery may still arrive.</p> : null}
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>{mode === 'send' && campaign.status !== 'paused' ? 'Send now' : copy.title}</Button></div>
    </form>
  </Dialog>;
}

export function CampaignView({ id }: { id: string }) {
  const resource = useResource<Campaign>(`${path}/${id}`);
  const lists = useResource<MailingList[]>('/lists');
  const [modal, setModal] = useState<CampaignDialog>();
  const [notice, setNotice] = useState('');
  const campaign = resource.data;

  function finish(value: string) {
    setModal(undefined);
    setNotice(value);
    resource.refresh();
  }

  return <>
    <Link className="text-link back-link" href="/campaigns"><ArrowLeft size={15} /> Campaigns</Link>
    <PageHeader title={campaign?.name || 'Newsletter'} description={campaign?.subject || 'Newsletter details and performance.'}
      actions={campaign ? <>
        <Button onClick={() => setModal('preview')}><Eye size={15} /> Preview</Button>
        <Button onClick={() => setModal('test')}><MailCheck size={15} /> Send test</Button>
        {['draft', 'paused', 'scheduled'].includes(campaign.status) ? <Button onClick={() => setModal('schedule')}><Timer size={15} /> Schedule</Button> : null}
        {['draft', 'paused'].includes(campaign.status) ? <Button variant="primary" onClick={() => setModal('send')}><Send size={15} /> {campaign.status === 'paused' ? 'Resume' : 'Send newsletter'}</Button> : null}
        {campaign.status === 'running' ? <Button onClick={() => setModal('pause')}>Pause</Button> : null}
      </> : undefined} />
    {!campaign ? <Panel><AsyncState loading={resource.loading} error={resource.error} retry={resource.refresh} /></Panel>
      : <div className="stack">
        <Feedback notice={notice} />
        <Panel title="Email performance" action={<Button onClick={resource.refresh} disabled={resource.loading}>Refresh metrics</Button>}>
          <div className="panel-body"><EmailMetrics metrics={campaign.metrics} /></div>
        </Panel>
        <Panel title="Newsletter details" action={campaign.status === 'draft' ? <Button onClick={() => setModal('edit')}>Edit newsletter</Button> : undefined}>
          <div className="panel-body"><dl className="definition-list">
            <dt>Status</dt><dd><Status status={campaign.status} /></dd>
            <dt>From</dt><dd>{campaign.fromEmail || 'Configured sender'}</dd>
            <dt>Mailing lists</dt><dd>{campaign.listIds.map(listId => lists.data?.find(list => list.id === listId)?.name || `List ${listId}`).join(', ') || '—'}</dd>
            <dt>Created</dt><dd>{date(campaign.createdAt)}</dd>
            <dt>Send time</dt><dd>{date(campaign.sendAt)}</dd>
          </dl></div>
        </Panel>
      </div>}
    {campaign && modal === 'edit' ? <CampaignForm campaign={campaign} onClose={() => setModal(undefined)} onDone={() => finish('Changes saved.')} /> : null}
    {campaign && modal === 'preview' ? <Preview id={campaign.id} onClose={() => setModal(undefined)} /> : null}
    {campaign && modal && modal !== 'preview' && modal !== 'edit'
      ? <DeliveryDialog mode={modal} campaign={campaign} onClose={() => setModal(undefined)} onDone={finish} /> : null}
  </>;
}
