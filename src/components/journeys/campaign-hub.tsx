'use client';

import { ChevronLeft, ChevronRight, Copy, ExternalLink, Link2, Plus, Rocket, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Campaign as Newsletter, Page } from '@/contracts';
import type {
  CampaignAsset, CampaignAssetType, CampaignDetail, CampaignInput, CampaignPerformance, CampaignStatus, FlowDetail, MarketingCampaign,
} from '@/contracts/journeys';
import { campaignAssetLabels, campaignAssetTypes, campaignStatuses, objectiveChoices, slugify } from '@/contracts/journeys';
import type { PlatformEvent } from '@/contracts/platform';
import { api, date, number, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Empty, FormActions, Metric, Modal, PageHeader, Panel, StatusBadge } from '../ui';
import type { Tone } from '../ui';
import type { TeamMember } from './shared';
import { lookupHint, useLookup } from './shared';

const statusTone: Record<CampaignStatus, Tone> = { planned: 'neutral', active: 'success', paused: 'warning', completed: 'info', archived: 'neutral' };
const statusLabel = (status: CampaignStatus) => status[0].toUpperCase() + status.slice(1);
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <StatusBadge label={statusLabel(status)} tone={statusTone[status]} />;
}

const money = (amount: number | null | undefined, currency: string) => amount == null ? '—'
  : new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
const dayLabel = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : null;
function dateRange(campaign: Pick<MarketingCampaign, 'startsOn' | 'endsOn'>) {
  if (!campaign.startsOn && !campaign.endsOn) return 'No dates';
  return `${dayLabel(campaign.startsOn) ?? 'Open start'} – ${dayLabel(campaign.endsOn) ?? 'ongoing'}`;
}

type IsoDay = NonNullable<Parameters<typeof DateInput>[0]["value"]>;

/* ── Create / edit ────────────────────────────────────────────────────────────────────────────────────── */

function CampaignForm({ campaign, onClose, onSaved }: { campaign?: CampaignDetail; onClose: () => void; onSaved: (campaign: CampaignDetail) => void }) {
  const team = useLookup<TeamMember>(['/platform/users']);
  const action = useAction();
  const [form, setForm] = useState({
    name: campaign?.name ?? '', objective: campaign?.objective ?? '', description: campaign?.description ?? '', ownerId: campaign?.ownerId ?? null as string | null,
    startsOn: campaign?.startsOn ?? '', endsOn: campaign?.endsOn ?? '', budget: campaign?.budget ?? null as number | null, currency: campaign?.currency ?? 'GBP',
    utmCampaign: campaign?.utmCampaign ?? '', utmSource: campaign?.utmSource ?? '', utmMedium: campaign?.utmMedium ?? '',
  });
  const [slugTouched, setSlugTouched] = useState(Boolean(campaign));
  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  const slug = slugTouched ? form.utmCampaign : slugify(form.name);
  return <Modal title={campaign ? 'Edit campaign' : 'New campaign'} size="large" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        const input: CampaignInput = { ...form, utmCampaign: (slugTouched || campaign) && slug ? slug : undefined, startsOn: form.startsOn || null, endsOn: form.endsOn || null, currency: form.currency.toUpperCase() };
        onSaved(campaign ? await api<CampaignDetail>(`/journeys/campaigns/${campaign.id}`, 'PATCH', input) : await api<CampaignDetail>('/journeys/campaigns', 'POST', input));
      });
    }}>
      <TextInput label="Campaign name" isRequired value={form.name} onChange={name => set({ name })} placeholder="e.g. Spring webinar series" />
      <div className="ov-form-grid">
        <Selector label="Objective" hasClear value={form.objective || null} placeholder="Choose an objective" options={objectiveChoices.map(item => ({ value: item, label: item }))} onChange={value => set({ objective: value ?? '' })} />
        <Selector label="Owner" value={form.ownerId ?? 'none'} isLoading={team.status === 'loading'} description={lookupHint(team, 'Team members', '')}
          options={[{ value: 'none', label: 'No owner' }, ...team.items.map(member => ({ value: member.id, label: member.name }))]} onChange={value => set({ ownerId: !value || value === 'none' ? null : value })} />
      </div>
      <TextArea label="Description" isOptional value={form.description} onChange={description => set({ description })} />
      <div className="ov-form-grid">
        <DateInput label="Starts" value={(form.startsOn || undefined) as IsoDay | undefined} onChange={value => set({ startsOn: value ?? '' })} />
        <DateInput label="Ends" value={(form.endsOn || undefined) as IsoDay | undefined} onChange={value => set({ endsOn: value ?? '' })} />
      </div>
      <div className="ov-form-grid">
        <NumberInput label="Budget" isOptional hasClear min={0} value={form.budget} onChange={budget => set({ budget })} description="Needed for cost per lead and ROI." />
        <TextInput label="Currency" value={form.currency} onChange={currency => set({ currency: currency.toUpperCase().slice(0, 3) })} />
      </div>
      <div className="ov-form-grid--three ov-form-grid">
        <TextInput label="UTM campaign" value={slug} onChange={value => { setSlugTouched(true); set({ utmCampaign: slugify(value) }); }} description={slugTouched ? "Links visits and form leads to this campaign." : "Suggested from the name; made unique when you save."} />
        <TextInput label="Default UTM source" isOptional value={form.utmSource} onChange={utmSource => set({ utmSource })} placeholder="newsletter" />
        <TextInput label="Default UTM medium" isOptional value={form.utmMedium} onChange={utmMedium => set({ utmMedium })} placeholder="email" />
      </div>
      {action.error ? <Banner status="error" title={action.error} /> : null}
      <FormActions>
        <Button label="Cancel" onClick={onClose} />
        <Button type="submit" variant="primary" label={campaign ? 'Save changes' : 'Create campaign'} isLoading={action.busy} isDisabled={!form.name.trim()} />
      </FormActions>
    </form>
  </Modal>;
}

/* ── Hub: list and calendar ───────────────────────────────────────────────────────────────────────────── */

function monthGrid(month: Date) {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86_400_000);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * 86_400_000));
}
const iso = (day: Date) => day.toISOString().slice(0, 10);

function CampaignCalendar({ campaigns, newsletters, newsletterError }: { campaigns: MarketingCampaign[]; newsletters: Newsletter[]; newsletterError?: string }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); });
  const days = monthGrid(month);
  const today = iso(new Date());
  const shift = (delta: number) => setMonth(current => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + delta, 1)));
  const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month);
  const dated = campaigns.filter(campaign => campaign.startsOn || campaign.endsOn);
  return <div className="ov-stack-sm">
    <div className="ov-actions ov-actions--between">
      <div className="ov-actions">
        <IconButton size="sm" variant="ghost" label="Previous month" icon={<ChevronLeft size={16} />} onClick={() => shift(-1)} />
        <Heading level={2}>{label}</Heading>
        <IconButton size="sm" variant="ghost" label="Next month" icon={<ChevronRight size={16} />} onClick={() => shift(1)} />
        <Button size="sm" variant="ghost" label="Today" onClick={() => { const now = new Date(); setMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))); }} />
      </div>
      <div className="ov-journeys-legend"><span>Active campaign</span><span data-kind="planned">Planned</span><span data-kind="newsletter">Scheduled newsletter</span></div>
    </div>
    {newsletterError ? <Text type="supporting" color="secondary">Scheduled newsletters are not shown: {newsletterError}</Text> : null}
    <div className="ov-journeys-calendar" role="grid" aria-label={`Campaign calendar for ${label}`}>
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <div key={day} className="ov-journeys-calendar-dow" role="columnheader">{day}</div>)}
      {days.map(day => {
        const key = iso(day);
        const running = dated.filter(campaign => (!campaign.startsOn || campaign.startsOn <= key) && (!campaign.endsOn || campaign.endsOn >= key) && (campaign.startsOn || campaign.endsOn));
        const sends = newsletters.filter(item => item.sendAt && item.sendAt.slice(0, 10) === key);
        return <div key={key} className="ov-journeys-day" role="gridcell" data-outside={day.getUTCMonth() !== month.getUTCMonth() ? 'true' : 'false'} data-today={key === today ? 'true' : 'false'}>
          <span className="ov-journeys-day-number">{day.getUTCDate()}</span>
          {running.slice(0, 3).map(campaign => <NextLink key={campaign.id} href={`/marketing/campaigns/${campaign.id}`} className="ov-journeys-chip" data-status={campaign.status} title={`${campaign.name} · ${dateRange(campaign)}`}>
            {campaign.startsOn === key || day.getUTCDay() === 1 || key.endsWith('-01') ? campaign.name : ' '}
          </NextLink>)}
          {running.length > 3 ? <Text type="supporting" color="secondary">+{running.length - 3} more</Text> : null}
          {sends.map(item => <NextLink key={item.id} href={`/marketing/emails/${item.id}`} className="ov-journeys-chip" data-kind="newsletter" title={`Newsletter: ${item.name} · ${item.status}`}>{item.name}</NextLink>)}
        </div>;
      })}
    </div>
  </div>;
}

export function CampaignHub() {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(params.get('create') === 'campaign');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const list = useResource<{ items: MarketingCampaign[] }>(`/journeys/campaigns${status !== 'all' ? `?status=${status}` : ''}`);
  const newsletters = useResource<Page<Newsletter>>(view === 'calendar' ? '/campaigns?status=all' : null);
  const term = q.trim().toLowerCase();
  const items = (list.data?.items ?? []).filter(item => !term || `${item.name} ${item.objective} ${item.utmCampaign}`.toLowerCase().includes(term));
  return <div className="ov-wide ov-journeys-page">
    <PageHeader title="Campaigns" description="Plan initiatives, group their emails, pages, forms and workflows, and see the leads and revenue they bring."
      actions={<Button variant="primary" icon={<Plus size={16} />} label="New campaign" onClick={() => setCreating(true)} />} />
    <Panel>
      <div className="ov-stack-sm">
        <div className="ov-journeys-toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="ov-journeys-toolbar">
            <div className="ov-journeys-filter--wide ov-journeys-filter"><TextInput label="Search" value={q} onChange={setQ} placeholder="Name, objective or UTM slug" /></div>
            <div className="ov-journeys-filter"><Selector label="Status" value={status} onChange={value => setStatus(value ?? 'all')}
              options={[{ value: 'all', label: 'All but archived' }, ...campaignStatuses.map(item => ({ value: item, label: statusLabel(item) }))]} /></div>
          </div>
          <SegmentedControl label="View" value={view} onChange={value => setView(value === 'calendar' ? 'calendar' : 'list')}>
            <SegmentedControlItem value="list" label="List" />
            <SegmentedControlItem value="calendar" label="Calendar" />
          </SegmentedControl>
        </div>
        {!list.data ? <AsyncState loading={list.loading} error={list.error} retry={list.refresh} />
          : view === 'calendar' ? <CampaignCalendar campaigns={items} newsletters={newsletters.data?.items ?? []} newsletterError={newsletters.error} />
            : items.length ? <Table data={items} idKey="id" hasHover columns={[
              { key: 'name', header: 'Campaign', renderCell: item => <span className="ov-cell">
                <NextLink href={`/marketing/campaigns/${item.id}`} className="ov-journeys-row-link">{item.name}</NextLink>
                <Text type="supporting" color="secondary">{item.objective || 'No objective'} · utm_campaign={item.utmCampaign}</Text>
              </span> },
              { key: 'status', header: 'Status', renderCell: item => <CampaignStatusBadge status={item.status} /> },
              { key: 'startsOn', header: 'Dates', renderCell: item => dateRange(item) },
              { key: 'budget', header: 'Budget', renderCell: item => money(item.budget, item.currency) },
              { key: 'ownerName', header: 'Owner', renderCell: item => item.ownerName ?? '—' },
              { key: 'assetCount', header: 'Assets', renderCell: item => number(item.assetCount) },
            ]} /> : <Empty title={term || status !== 'all' ? 'No campaigns match' : 'No campaigns yet'}
              description="A campaign groups everything for one initiative so leads, deals and revenue are attributed to it."
              action={<Button label="New campaign" onClick={() => setCreating(true)} />} />}
      </div>
    </Panel>
    {creating ? <CampaignForm onClose={() => { setCreating(false); if (params.get('create')) router.replace('/marketing'); }}
      onSaved={campaign => router.push(`/marketing/campaigns/${campaign.id}`)} /> : null}
  </div>;
}

/* ── Workspace ────────────────────────────────────────────────────────────────────────────────────────── */

const assetSources: Partial<Record<CampaignAssetType, string[]>> = {
  design: ['/studio/designs?kind=email', '/journeys/lookups/designs'], newsletter: ['/campaigns?status=all'], journey_email: ['/journey-emails'],
  page: ['/sites/pages'], funnel: ['/sites/funnels'], form: ['/sites/forms'], flow: ['/journeys/flows'], journey: ['/workflows'],
  segment: ['/segments'], list: ['/lists'],
};

function assetHref(asset: CampaignAsset): string | null {
  switch (asset.type) {
    case 'design': return `/studio/email/${asset.id}`;
    case 'newsletter': return `/marketing/emails/${asset.id}`;
    case 'journey_email': return '/automations/emails';
    case 'page': return `/studio/page/${asset.id}`;
    case 'funnel': return '/sites/funnels';
    case 'form': return '/sites/forms';
    case 'flow': return `/automations/flows/${asset.id}`;
    case 'journey': return `/automations/journeys/${asset.id}`;
    case 'segment': return '/crm/segments';
    case 'list': return '/marketing/lists';
    case 'link': return typeof asset.meta.url === 'string' ? asset.meta.url : null;
  }
}

type AnyItem = { id: string | number; name?: string; title?: string };

function LinkAssetModal({ campaign, onClose, onSaved }: { campaign: CampaignDetail; onClose: () => void; onSaved: (campaign: CampaignDetail) => void }) {
  const [type, setType] = useState<CampaignAssetType>('design');
  const [picked, setPicked] = useState<string | null>(null);
  const source = useLookup<AnyItem>(assetSources[type] ?? []);
  const linked = new Set(campaign.assets.filter(asset => asset.type === type).map(asset => asset.id));
  const options = source.items.filter(item => !linked.has(String(item.id))).map(item => ({ value: String(item.id), label: item.name ?? item.title ?? `#${item.id}` }));
  const action = useAction();
  return <Modal title="Link an existing asset" onClose={onClose}>
    <Selector label="Type" value={type} options={campaignAssetTypes.filter(item => item !== 'link').map(item => ({ value: item, label: campaignAssetLabels[item] }))}
      onChange={value => { setType((value ?? 'design') as CampaignAssetType); setPicked(null); }} />
    <Selector label={campaignAssetLabels[type]} hasClear value={picked} placeholder="Choose one" isLoading={source.status === 'loading'} options={options}
      description={lookupHint(source as never, campaignAssetLabels[type], 'Create one first with Create new.') ?? (source.status === 'ready' && !options.length ? 'Everything of this type is already linked.' : undefined)}
      onChange={setPicked} />
    {action.error ? <Banner status="error" title={action.error} /> : null}
    <FormActions>
      <Button label="Cancel" onClick={onClose} />
      <Button variant="primary" label="Link to campaign" isDisabled={!picked} isLoading={action.busy}
        onClick={() => void action.run(async () => onSaved(await api<CampaignDetail>(`/journeys/campaigns/${campaign.id}/assets`, 'POST', { type, id: picked, label: options.find(item => item.value === picked)?.label ?? picked })))} />
    </FormActions>
  </Modal>;
}

function TrackedLinks({ campaign, onSaved }: { campaign: CampaignDetail; onSaved: (campaign: CampaignDetail) => void }) {
  const [form, setForm] = useState({ name: '', destination: '', source: campaign.utmSource, medium: campaign.utmMedium, content: '' });
  const [copied, setCopied] = useState<string>();
  const action = useAction();
  const links = campaign.assets.filter(asset => asset.type === 'link');
  const set = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }));
  return <Panel title="Tracked links" description={`Every link carries utm_campaign=${campaign.utmCampaign}, so visits and form leads are attributed here.`}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        onSaved(await api<CampaignDetail>(`/journeys/campaigns/${campaign.id}/links`, 'POST', form));
        setForm(current => ({ ...current, name: '', destination: '', content: '' }));
      }, 'Tracked link created.');
    }}>
      <div className="ov-form-grid">
        <TextInput label="Destination URL" isRequired value={form.destination} onChange={destination => set({ destination: destination.trim() })} placeholder="https://example.com/webinar" />
        <TextInput label="Label" isOptional value={form.name} onChange={name => set({ name })} placeholder="e.g. Hero button" />
      </div>
      <div className="ov-form-grid--three ov-form-grid">
        <TextInput label="Source" value={form.source} onChange={source => set({ source })} placeholder="newsletter" />
        <TextInput label="Medium" value={form.medium} onChange={medium => set({ medium })} placeholder="email" />
        <TextInput label="Content" isOptional value={form.content} onChange={content => set({ content })} placeholder="hero-button" />
      </div>
      {action.error ? <Banner status="error" title={action.error} /> : null}
      <FormActions><Button type="submit" label="Create tracked link" icon={<Link2 size={16} />} isLoading={action.busy} isDisabled={!form.destination} /></FormActions>
    </form>
    {links.length ? <ul className="ov-rows">{links.map(link => <li key={link.id}>
      <span><Text weight="medium">{link.label}</Text><span className="ov-journeys-link-url">{String(link.meta.url ?? '')}</span></span>
      <span className="ov-actions">
        <Button size="sm" variant="ghost" icon={<Copy size={14} />} label={copied === link.id ? 'Copied' : 'Copy'}
          onClick={() => { void navigator.clipboard?.writeText(String(link.meta.url ?? '')).then(() => setCopied(link.id), () => setCopied(undefined)); }} />
        <IconButton size="sm" variant="ghost" label={`Remove ${link.label}`} icon={<Trash2 size={14} />}
          onClick={() => void action.run(async () => onSaved(await api<CampaignDetail>(`/journeys/campaigns/${campaign.id}/assets/link/${encodeURIComponent(link.id)}`, 'DELETE')))} />
      </span>
    </li>)}</ul> : <Text color="secondary">No tracked links yet.</Text>}
  </Panel>;
}

const eventLabels: Record<string, string> = {
  'form.submitted': 'Form submitted', 'page.converted': 'Page conversion', 'page.viewed': 'Page viewed', 'deal.created': 'Deal created',
  'deal.won': 'Deal won', 'deal.lost': 'Deal lost', 'deal.stage_changed': 'Deal moved', 'email.sent': 'Email sent', 'campaign.launched': 'Campaign launched',
  'flow.enrolled': 'Entered a workflow', 'flow.completed': 'Finished a workflow', 'flow.failed': 'Workflow failed', 'contact.tagged': 'Tagged',
};

function describeEvent(event: PlatformEvent) {
  const props = event.properties ?? {};
  const name = [props.formName, props.flowName, props.name, props.subject].find(value => typeof value === 'string') as string | undefined;
  return `${eventLabels[event.type] ?? event.type}${name ? `: ${name}` : ''}${event.amount ? ` · ${money(event.amount, event.currency ?? 'GBP')}` : ''}`;
}

export function CampaignWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const campaign = useResource<CampaignDetail>(`/journeys/campaigns/${id}`);
  const performance = useResource<CampaignPerformance>(`/journeys/campaigns/${id}/performance`);
  const timeline = useResource<{ items: PlatformEvent[] }>(`/journeys/campaigns/${id}/timeline`);
  const [local, setLocal] = useState<CampaignDetail>();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirm, setConfirm] = useState<'launch' | 'delete'>();
  const action = useAction();
  const data = local && local.updatedAt >= (campaign.data?.updatedAt ?? '') ? local : campaign.data;
  const hasNewsletters = Boolean(data?.assets.some(asset => asset.type === 'newsletter'));
  const newsletters = useResource<Page<Newsletter>>(hasNewsletters ? '/campaigns?status=all' : null);
  if (!data) return <div className="ov-wide ov-journeys-page"><AsyncState loading={campaign.loading} error={campaign.error} retry={campaign.refresh} /></div>;

  const saved = (next: CampaignDetail) => { setLocal(next); performance.refresh(); timeline.refresh(); };
  const move = (path: string, notice: string) => void action.run(async () => saved(await api<CampaignDetail>(`/journeys/campaigns/${id}/${path}`, 'POST')), notice);
  const newsletterIds = new Set(data.assets.filter(asset => asset.type === 'newsletter').map(asset => asset.id));
  const newsletterSent = (newsletters.data?.items ?? []).filter(item => newsletterIds.has(String(item.id))).reduce((sum, item) => sum + (item.metrics?.sent ?? 0), 0);
  const p = performance.data;
  const groups = campaignAssetTypes.filter(type => type !== 'link').map(type => [type, data.assets.filter(asset => asset.type === type)] as const).filter(([, assets]) => assets.length);
  const createItems = [
    { label: 'Workflow from a template', href: `/automations/templates?campaign=${id}` },
    { label: 'Blank workflow', onClick: () => void action.run(async () => { const flow = await api<FlowDetail>('/journeys/flows', 'POST', { name: `${data.name} workflow`, campaignId: id }); router.push(`/automations/flows/${flow.id}`); }) },
    { label: 'Email design', href: `/marketing/templates?create=email&campaign=${id}` },
    { label: 'Newsletter', href: '/marketing/emails' },
    { label: 'Landing page', href: `/sites?create=page&campaign=${id}` },
    { label: 'Form', href: `/sites/forms?create=form&campaign=${id}` },
    { label: 'Funnel', href: `/sites/funnels?create=funnel&campaign=${id}` },
    { label: 'Segment journey (Mautic)', href: '/automations/journeys/new' },
    { label: 'Segment', href: '/crm/segments' },
    { label: 'Mailing list', href: '/marketing/lists' },
  ];

  return <div className="ov-wide ov-journeys-page">
    <PageHeader title={data.name} back={{ href: '/marketing', label: 'Campaigns' }}
      description={[data.objective, dateRange(data), data.ownerName ? `Owner: ${data.ownerName}` : null, `utm_campaign=${data.utmCampaign}`].filter(Boolean).join(' · ')}
      actions={<>
        <CampaignStatusBadge status={data.status} />
        {data.status === 'planned' ? <Button variant="primary" icon={<Rocket size={16} />} label="Launch" onClick={() => setConfirm('launch')} /> : null}
        {data.status === 'active' ? <Button label="Pause" onClick={() => move('pause', 'Campaign paused.')} /> : null}
        {data.status === 'paused' ? <Button label="Resume" onClick={() => move('resume', 'Campaign resumed.')} /> : null}
        {data.status === 'active' || data.status === 'paused' ? <Button label="Mark completed" onClick={() => move('complete', 'Campaign completed.')} /> : null}
        <Button label="Edit" onClick={() => setEditing(true)} />
        <MoreMenu label="More campaign actions" items={[
          data.status === 'archived' ? { label: 'Restore', onClick: () => move('restore', 'Campaign restored as planned.') } : { label: 'Archive', onClick: () => move('archive', 'Campaign archived.') },
          { label: 'Delete', variant: 'destructive', onClick: () => setConfirm('delete') },
        ]} />
      </>} />
    {action.error ? <Banner status="error" title={action.error} /> : null}
    {data.description ? <Text color="secondary">{data.description}</Text> : null}

    {!p ? <AsyncState loading={performance.loading} error={performance.error} retry={performance.refresh} /> : <div className="ov-metrics ov-journeys-metrics">
      <Metric label="Leads" value={p.leads} hint={`${number(p.formSubmissions)} form submissions`} info="Distinct contacts who submitted a form attributed to this campaign." />
      <Metric label="Conversions" value={p.conversions} info="Landing page conversions attributed to this campaign." />
      <Metric label="Emails sent" value={p.emails.sent + newsletterSent}
        hint={[hasNewsletters ? `${number(newsletterSent)} in newsletters` : null, `${number(p.emails.sent)} by workflows`, p.emails.notSent + p.emails.blocked ? `${number(p.emails.notSent + p.emails.blocked)} not sent` : null, newsletters.error ? 'newsletter stats unavailable' : null].filter(Boolean).join(' · ')} />
      <Metric label="Deals" value={p.deals.created} hint={`${number(p.deals.open)} open · ${number(p.deals.won)} won`} />
      <Metric label="Won revenue" formatted={p.deals.wonRevenue.length ? p.deals.wonRevenue.map(item => money(item.amount, item.currency)).join(' + ') : money(0, data.currency)} />
      <Metric label="Cost per lead" formatted={p.costPerLead != null ? money(p.costPerLead, data.currency) : '—'} hint={p.notes.costPerLead} />
      <Metric label="ROI" formatted={p.roi != null ? `${p.roi}%` : '—'} hint={p.notes.roi} info="(Won revenue − budget) ÷ budget, in the campaign currency." />
    </div>}

    <div className="ov-grid">
      <Panel title="Assets" description="Everything that belongs to this campaign. Forms, pages and emails linked here attribute their leads to it."
        action={<div className="ov-actions">
          <Button size="sm" label="Link existing" onClick={() => setLinking(true)} />
          <DropdownMenu button={{ label: 'Create new', size: 'sm', icon: <Plus size={14} aria-hidden="true" /> }} items={createItems} />
        </div>}>
        {groups.length ? <div className="ov-stack-sm">{groups.map(([type, assets]) => <div key={type} className="ov-journeys-asset-group">
          <Text type="label" color="secondary">{campaignAssetLabels[type]} ({assets.length})</Text>
          <ul className="ov-rows">{assets.map(asset => {
            const href = assetHref(asset);
            return <li key={asset.type + asset.id}>
              <span>{href ? <NextLink href={href}>{asset.label}</NextLink> : <Text>{asset.label}</Text>}<Text type="supporting" color="secondary">Added {date(asset.addedAt)}</Text></span>
              <span className="ov-actions">
                {href ? <NextLink href={href} aria-label={`Open ${asset.label}`}><ExternalLink size={14} /></NextLink> : null}
                <IconButton size="sm" variant="ghost" label={`Unlink ${asset.label}`} icon={<Trash2 size={14} />}
                  onClick={() => void action.run(async () => saved(await api<CampaignDetail>(`/journeys/campaigns/${id}/assets/${asset.type}/${encodeURIComponent(asset.id)}`, 'DELETE')))} />
              </span>
            </li>;
          })}</ul>
        </div>)}</div> : <Empty title="No assets yet" description="Link the emails, pages, forms and workflows for this campaign, or create them from here." />}
      </Panel>
      <TrackedLinks campaign={data} onSaved={saved} />
    </div>

    <Panel title="Timeline" description="Measured activity attributed to this campaign, newest first.">
      {!timeline.data ? <AsyncState loading={timeline.loading} error={timeline.error} retry={timeline.refresh} />
        : timeline.data.items.length ? <ul className="ov-journeys-timeline">{timeline.data.items.map(event => <li key={event.id}>
          <span className="ov-cell"><Text weight="medium">{describeEvent(event)}</Text>
            {event.contactId ? <NextLink href={`/crm/contacts/${event.contactId}`}>Contact #{event.contactId}</NextLink> : null}</span>
          <Text type="supporting" color="secondary">{date(event.occurredAt)}</Text>
        </li>)}</ul> : <Empty title="No activity yet" description="Launch the campaign and share its tracked links; submissions, deals and sends appear here." />}
    </Panel>

    {editing ? <CampaignForm campaign={data} onClose={() => setEditing(false)} onSaved={next => { saved(next); setEditing(false); }} /> : null}
    {linking ? <LinkAssetModal campaign={data} onClose={() => setLinking(false)} onSaved={next => { saved(next); setLinking(false); }} /> : null}
    {confirm === 'launch' ? <ConfirmDialog destructive={false} title={`Launch “${data.name}”`} busy={action.busy}
      description="The campaign becomes active and workflows that start on “Campaign launched” run once. Launching cannot be repeated."
      actionLabel="Launch campaign" onClose={() => setConfirm(undefined)}
      onConfirm={() => void action.run(async () => { saved(await api<CampaignDetail>(`/journeys/campaigns/${id}/launch`, 'POST')); setConfirm(undefined); }, 'Campaign launched.')} /> : null}
    {confirm === 'delete' ? <ConfirmDialog title={`Delete “${data.name}”`} busy={action.busy}
      description="This deletes the campaign and its asset links. Deals, emails and workflows stay, without the campaign attribution."
      actionLabel="Delete campaign" onClose={() => setConfirm(undefined)}
      onConfirm={() => void action.run(async () => { await api(`/journeys/campaigns/${id}`, 'DELETE'); router.push('/marketing'); })} /> : null}
  </div>;
}

