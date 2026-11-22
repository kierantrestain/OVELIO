'use client';

import { CalendarDays, CodeXml, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import type { ISODateString } from '@astryxdesign/core/Calendar';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Dashboard, DateRange, FunnelResult, FunnelStep, Goal, GoalStats, ReportDimension, Website, WebsiteReport } from '@/contracts';
import { api, useAction, useFields, useResource } from './client';
import { EmailMetrics } from './overview';
import { useUser } from './shell';
import { AsyncState, Bars, Distribution, Empty, Feedback, FormActions, Metric, Modal, PageHeader, Panel, Snippet, Tabs } from './ui';

const websitesPath = '/websites';
const day = 86_400_000;
const viewTabs = ['Website analytics', 'Email reports'] as const;
const breakdowns = ['Content and sources', 'UTM campaigns', 'Technology and location'] as const;
const groups = [
  [['path', 'Pages'], ['referrer', 'Referrers'], ['event', 'Events']],
  [['utmSource', 'UTM source'], ['utmMedium', 'UTM medium'], ['utmCampaign', 'UTM campaign']],
  [['device', 'Devices'], ['browser', 'Browsers'], ['country', 'Countries']],
] as const satisfies ReadonlyArray<ReadonlyArray<readonly [ReportDimension, string]>>;
const stepTypes = [{ value: 'path', label: 'Page path' }, { value: 'event', label: 'Custom event' }];

const recent = (days: number): DateRange => ({ startAt: Date.now() - day * days, endAt: Date.now() });
const query = (range: DateRange) => new URLSearchParams({ startAt: String(range.startAt), endAt: String(range.endAt) });
const isoDay = (value: number) => new Date(value).toISOString().slice(0, 10) as ISODateString;

function comparison(current: number | undefined, previous: number | undefined) {
  if (current == null || previous == null) return undefined;
  if (!previous) return current ? 'Previously 0' : 'No change';
  const formatted = Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format((current - previous) / previous);
  return `${formatted} vs previous period`;
}

function WebsiteForm({ onClose, onDone }: { onClose: () => void; onDone: (website: Website) => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', domain: '' });
  return <Modal title="Add website" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { onDone(await api<Website>(websitesPath, 'POST', { name: values.name.trim(), domain: values.domain.trim() })); });
    }}>
      <TextInput label="Website name" isRequired {...field('name')} />
      <TextInput label="Website domain" description="Enter a hostname such as www.example.com." placeholder="www.example.com" isRequired {...field('domain')} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Add website" isLoading={action.busy} /></FormActions>
    </form>
  </Modal>;
}

function CustomRange({ range, onClose, onDone }: { range: DateRange; onClose: () => void; onDone: (value: DateRange) => void }) {
  const [start, setStart] = useState(isoDay(range.startAt));
  const [end, setEnd] = useState(isoDay(range.endAt));
  const [today] = useState(() => isoDay(Date.now()));
  const [error, setError] = useState('');
  return <Modal title="Date range" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      const startAt = Date.parse(start);
      const endAt = Math.min(Date.parse(end) + day - 1, Date.now());
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) return setError('Choose an end date on or after the start date.');
      onDone({ startAt, endAt });
    }}>
      <div className="ov-form-grid">
        <DateInput label="Start date" value={start} max={today} onChange={value => value && setStart(value)} />
        <DateInput label="End date" value={end} max={today} onChange={value => value && setEnd(value)} />
      </div>
      <Text type="supporting" color="secondary">Dates use UTC. The comparison covers the immediately preceding period of equal length.</Text>
      <Feedback error={error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button variant="primary" type="submit" label="Apply dates" /></FormActions>
    </form>
  </Modal>;
}

function TrackingCode({ website, origin, onClose }: { website: Website; origin: string; onClose: () => void }) {
  const action = useAction();
  const snippet = `<script defer src="${origin.replace(/\/$/, '')}/script.js" data-website-id="${website.id}"></script>`;
  return <Modal title="Tracking code" size="large" onClose={onClose}>
    <Text>Place this script in the &lt;head&gt; of each page on <strong>{website.domain}</strong> you want to measure.</Text>
    <Snippet code={snippet} />
    <Text type="supporting" color="secondary">Track a custom event by adding <Text type="code">{'data-umami-event="signed_up"'}</Text> to a button or link.</Text>
    <Text type="supporting" color="secondary">Website visitors are anonymous. OVELIO does not link visits to contacts unless an attribution has been established.</Text>
    <Feedback error={action.error} notice={action.notice} />
    <FormActions><Button label="Copy tracking code" icon={<Copy size={15} />} onClick={() => void action.run(async () => navigator.clipboard.writeText(snippet), 'Tracking code copied.')} /></FormActions>
  </Modal>;
}

function GoalForm({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: (goal: Goal) => void }) {
  const action = useAction();
  const { values, field } = useFields({ name: '', value: '' });
  const [type, setType] = useState<'event' | 'path'>('event');
  return <Modal title="Create conversion goal" onClose={onClose}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => { onDone(await api<Goal>(path, 'POST', { name: values.name.trim(), type, value: values.value.trim() })); });
    }}>
      <TextInput label="Goal name" isRequired {...field('name')} />
      <Selector label="Goal type" value={type} onChange={value => setType(value === 'path' ? 'path' : 'event')} options={[{ value: 'event', label: 'Custom event' }, { value: 'path', label: 'Page path' }]} />
      <TextInput label="Matching value" description="Enter the exact event name or page path." placeholder={type === 'event' ? 'signed_up' : '/thank-you'} isRequired {...field('value')} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={onClose} /><Button type="submit" variant="primary" label="Create goal" isLoading={action.busy} /></FormActions>
    </form>
  </Modal>;
}

function ConversionPanel({ website, range, canEdit }: { website: Website; range: DateRange; canEdit: boolean }) {
  const path = `${websitesPath}/${website.id}/goals`;
  const goals = useResource<Goal[]>(path);
  const [selection, setSelection] = useState('');
  const [showForm, setShowForm] = useState(false);
  const goal = goals.data?.find(item => item.id === selection) || goals.data?.[0];
  const stats = useResource<GoalStats>(goal ? `${path}/${goal.id}?${query(range)}` : null);
  return <Panel title="Conversion goals" action={canEdit ? <Button size="sm" label="Create goal" icon={<Plus size={14} />} onClick={() => setShowForm(true)} /> : undefined}>
    {!goals.data ? <AsyncState loading={goals.loading} error={goals.error} retry={goals.refresh} />
      : goal ? <>
        <Selector label="Conversion goal" value={goal.id} onChange={value => setSelection(value ?? '')} options={goals.data.map(item => ({ value: item.id, label: item.name, description: `${item.type === 'event' ? 'Event' : 'Path'} · ${item.value}` }))} />
        {!stats.data ? <AsyncState loading={stats.loading} error={stats.error} retry={stats.refresh} /> : <div className="ov-metrics">
          <Metric flat label="Converting sessions" value={stats.data.unique} /><Metric flat label="Total conversions" value={stats.data.total} />
        </div>}
      </> : <Empty title="No conversion goals yet" description="Track a page path or custom event as a goal." />}
    {showForm ? <GoalForm path={path} onClose={() => setShowForm(false)} onDone={created => { setSelection(created.id); setShowForm(false); goals.refresh(); }} /> : null}
  </Panel>;
}

function FunnelPanel({ website, range }: { website: Website; range: DateRange }) {
  const action = useAction();
  const [steps, setSteps] = useState<FunnelStep[]>([{ type: 'path', value: '/' }, { type: 'event', value: '' }]);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [result, setResult] = useState<FunnelResult>();
  function update(index: number, parts: Partial<FunnelStep>) {
    setSteps(values => values.map((step, position) => position === index ? { ...step, ...parts } : step));
    setResult(undefined);
  }
  return <Panel title="Conversion funnel" description="How many sessions progress through these steps within the window.">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        if (steps.some(step => !step.value.trim())) throw new Error('Enter a value for every funnel step.');
        setResult(await api<FunnelResult>(`${websitesPath}/${website.id}/funnel`, 'POST', { ...range, steps: steps.map(step => ({ ...step, value: step.value.trim() })), windowMinutes }));
      });
    }}>
      {steps.map((step, index) => <div className="ov-step" key={index}>
        <div className="ov-step-heading"><Text weight="semibold">Step {index + 1}</Text>
          {steps.length > 2 ? <IconButton variant="ghost" size="sm" label={`Remove step ${index + 1}`} icon={<Trash2 size={15} />}
            onClick={() => { setSteps(values => values.filter((_, position) => position !== index)); setResult(undefined); }} /> : null}</div>
        <div className="ov-form-grid">
          <Selector label={`Step ${index + 1} type`} value={step.type} options={stepTypes} onChange={value => update(index, { type: value === 'path' ? 'path' : 'event' })} />
          <TextInput label={`Step ${index + 1} value`} isRequired value={step.value} onChange={value => update(index, { value })} />
        </div>
      </div>)}
      <NumberInput label="Window" units="minutes" min={1} max={1440} isIntegerOnly value={windowMinutes} onChange={value => { setWindowMinutes(value); setResult(undefined); }} />
      <Feedback error={action.error} />
      <div className="ov-actions ov-actions--between">
        {steps.length < 8 ? <Button label="Add step" icon={<Plus size={15} />} onClick={() => { setSteps(values => [...values, { type: 'event', value: '' }]); setResult(undefined); }} /> : <span />}
        <Button type="submit" variant="primary" label="Run funnel" isLoading={action.busy} />
      </div>
    </form>
    {result ? <div className="ov-stack-sm"><Heading level={3}>Funnel results</Heading><Distribution points={result.map(item => ({ label: item.label, value: item.visitors }))} /></div> : null}
  </Panel>;
}

function SiteReport({ website, range, canEdit, refreshRange }: { website: Website; range: DateRange; canEdit: boolean; refreshRange?: () => void }) {
  const report = useResource<WebsiteReport>(`${websitesPath}/${website.id}/report?${query(range)}`);
  const [chart, setChart] = useState('pageviews');
  const [view, setView] = useState<typeof breakdowns[number]>(breakdowns[0]);
  const current = report.data?.current;
  const previous = report.data?.previous;
  return <div className="ov-stack">
    {!report.data ? <Panel><AsyncState loading={report.loading} error={report.error} retry={report.refresh} /></Panel> : <>
      <div className="ov-metrics">
        <Metric label="Page views" value={current?.pageviews} hint={comparison(current?.pageviews, previous?.pageviews)} />
        <Metric label="Unique visitors" value={current?.visitors} hint={comparison(current?.visitors, previous?.visitors)} />
        <Metric label="Visits" value={current?.visits} hint={comparison(current?.visits, previous?.visits)} />
        <Metric label="Bounces" value={current?.bounces} hint={comparison(current?.bounces, previous?.bounces)} />
      </div>
      <Panel title="Traffic" description="Website activity compared with the preceding period"
        action={<div className="ov-actions">
          <SegmentedControl label="Traffic measure" size="sm" value={chart} onChange={setChart}>
            <SegmentedControlItem value="pageviews" label="Page views" /><SegmentedControlItem value="visitors" label="Unique visitors" />
          </SegmentedControl>
          <IconButton size="sm" label="Refresh metrics" icon={<RefreshCw size={14} />} onClick={refreshRange || report.refresh} isLoading={report.loading} />
        </div>}>
        <Bars points={chart === 'pageviews' ? report.data.pageviews : report.data.visitors} label={chart === 'pageviews' ? 'Page views over time' : 'Unique visitors over time'} />
      </Panel>
      <Panel title="Traffic breakdown">
        <Tabs label="Traffic breakdown" items={breakdowns} value={view} onChange={setView} />
        <div className="ov-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {groups[breakdowns.indexOf(view)].map(([key, title]) => <section key={key} className="ov-stack-sm">
            <Heading level={3}>{title}</Heading><Distribution points={report.data?.dimensions[key]} />
          </section>)}
        </div>
      </Panel>
    </>}
    <div className="ov-grid">
      <ConversionPanel website={website} range={range} canEdit={canEdit} />
      <FunnelPanel key={range.endAt + ':' + range.startAt} website={website} range={range} />
    </div>
  </div>;
}

function EmailReport() {
  const report = useResource<Dashboard>('/overview');
  return <div className="ov-stack">
    <Panel title="Email performance" description="Newsletter activity measured by the delivery service"
      action={<Button size="sm" label="Refresh metrics" icon={<RefreshCw size={14} />} onClick={report.refresh} isLoading={report.loading} />}>
      {report.data ? <EmailMetrics metrics={report.data.email} /> : <AsyncState loading={report.loading} error={report.error} retry={report.refresh} />}
    </Panel>
    {report.data ? <Panel title="Campaign activity" description="Tracked newsletter opens over time"><Bars points={report.data.emailTrend} label="Tracked newsletter opens over time" /></Panel> : null}
    <Text type="supporting" color="secondary">Email engagement and website traffic are reported separately. Visits are not attributed to individual recipients unless a campaign UTM link establishes it.</Text>
  </div>;
}

export function Analytics({ trackingOrigin }: { trackingOrigin?: string }) {
  const user = useUser();
  const canEdit = user.role !== 'analyst';
  const [tab, setTab] = useState<typeof viewTabs[number]>('Website analytics');
  const [range, setRange] = useState(() => recent(30));
  const [period, setPeriod] = useState('30');
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<'website' | 'tracking' | 'dates'>();
  const websites = useResource<Website[]>(tab === 'Website analytics' ? websitesPath : null);
  const website = websites.data?.find(item => item.id === selected) || websites.data?.[0];
  return <>
    <PageHeader title="Analytics" description="Measure website activity, conversions and newsletter performance."
      actions={tab === 'Website analytics' && canEdit ? <Button variant="primary" icon={<Plus size={16} />} label="Add website" onClick={() => setModal('website')} /> : undefined} />
    <Tabs label="Analytics view" items={viewTabs} value={tab} onChange={setTab} />
    {tab === 'Email reports' ? <EmailReport /> : !websites.data ? <Panel><AsyncState loading={websites.loading} error={websites.error} retry={websites.refresh} /></Panel>
      : !website ? <Panel><Empty title="No websites connected"
        description={canEdit ? 'Add a website to view its activity and get a tracking snippet.' : 'Ask a marketer or administrator to connect a website.'} /></Panel>
        : <div className="ov-stack">
          <div className="ov-toolbar">
            <div className="ov-actions">
              <Selector label="Website" isLabelHidden width={280} value={website.id} onChange={value => setSelected(value ?? '')}
                options={websites.data.map(item => ({ value: item.id, label: item.name, description: item.domain }))} />
              <Selector label="Reporting period" isLabelHidden width={190} value={period} onChange={value => {
                if (value === 'custom') return setModal('dates');
                if (value) { setPeriod(value); setRange(recent(Number(value))); }
              }} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' },
                { value: 'custom', label: period === 'custom' ? `${isoDay(range.startAt)} – ${isoDay(range.endAt)}` : 'Custom dates' }]} />
              <Button label="Dates" icon={<CalendarDays size={15} />} onClick={() => setModal('dates')} />
            </div>
            {canEdit ? <Button label="Tracking code" icon={<CodeXml size={16} />} onClick={() => setModal('tracking')} /> : null}
          </div>
          <SiteReport key={website.id} website={website} range={range} canEdit={canEdit} refreshRange={period === 'custom' ? undefined : () => setRange(recent(Number(period)))} />
        </div>}
    {modal === 'website' && canEdit ? <WebsiteForm onClose={() => setModal(undefined)} onDone={value => { setSelected(value.id); websites.refresh(); setModal(undefined); }} /> : null}
    {modal === 'tracking' && website && canEdit ? <TrackingCode website={website} origin={trackingOrigin || location.origin} onClose={() => setModal(undefined)} /> : null}
    {modal === 'dates' ? <CustomRange range={range} onClose={() => setModal(undefined)} onDone={value => { setPeriod('custom'); setRange(value); setModal(undefined); }} /> : null}
  </>;
}
