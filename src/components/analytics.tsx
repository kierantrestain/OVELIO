'use client';

import { CalendarDays, CodeXml, Copy, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Dashboard, DateRange, FunnelResult, FunnelStep, Goal, GoalInput, GoalStats, Point, ReportDimension, Website, WebsiteReport } from '@/contracts';
import { api, number, useAction, useResource } from './client';
import { EmailMetrics } from './overview';
import { useUser } from './shell';
import { AsyncState, Bars, Button, Dialog, Empty, Feedback, Field, Metric, PageHeader, Panel } from './ui';

const websitesPath = '/websites';
const day = 86_400_000;
const defaultSteps: FunnelStep[] = [{ type: 'path', value: '/' }, { type: 'event', value: '' }];
const groups = [
  [['path', 'Pages'], ['referrer', 'Referrers'], ['event', 'Events']],
  [['utmSource', 'UTM source'], ['utmMedium', 'UTM medium'], ['utmCampaign', 'UTM campaign']],
  [['device', 'Devices'], ['browser', 'Browsers'], ['country', 'Countries']],
] as const satisfies ReadonlyArray<ReadonlyArray<readonly [ReportDimension, string]>>;

function recent(days: number): DateRange {
  const endAt = Date.now();
  return { startAt: endAt - day * days, endAt };
}

function query(range: DateRange) {
  return new URLSearchParams({ startAt: String(range.startAt), endAt: String(range.endAt) });
}

function comparison(current: number | undefined, previous: number | undefined) {
  if (current == null || previous == null) return undefined;
  if (!previous) return current ? 'Previously 0' : 'No change';
  const value = (current - previous) / previous;
  const formatted = Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value);
  return `${formatted} vs previous period`;
}

function Distribution({ points }: { points?: Point[] | null }) {
  if (points == null) return <Empty title="Metric unavailable" />;
  if (!points.length) return <Empty title="No recorded activity" />;
  const max = Math.max(1, ...points.map(point => point.value));
  return <div className="distribution">
    {points.slice(0, 10).map((point, index) => <div key={`${point.label}-${index}`} className="distribution-row">
      <div><span>{point.label || 'Unknown'}</span><strong>{number(point.value)}</strong></div>
      <div className="distribution-track" aria-hidden="true"><span style={{ width: `${point.value / max * 100}%` }} /></div>
    </div>)}
  </div>;
}

function WebsiteForm({ onClose, onDone }: { onClose: () => void; onDone: (website: Website) => void }) {
  const action = useAction();
  return <Dialog title="Add website" onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void action.run(async () => {
        onDone(await api<Website>(websitesPath, 'POST', { name: String(data.get('name')).trim(), domain: String(data.get('domain')).trim() }));
      });
    }}>
      <Field label="Website name"><input name="name" required maxLength={100} /></Field>
      <Field label="Website domain" help="Enter a hostname such as www.example.com."><input name="domain" required placeholder="www.example.com" maxLength={253} /></Field>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>Add website</Button></div>
    </form>
  </Dialog>;
}

function CustomRange({ range, onClose, onDone }: { range: DateRange; onClose: () => void; onDone: (value: DateRange) => void }) {
  const [error, setError] = useState('');
  const start = new Date(range.startAt).toISOString().slice(0, 10);
  const end = new Date(range.endAt).toISOString().slice(0, 10);
  return <Dialog title="Date range" onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const startAt = Date.parse(String(data.get('start')));
      const endAt = Math.min(Date.parse(String(data.get('end'))) + day - 1, Date.now());
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
        setError('Choose an end date on or after the start date.');
        return;
      }
      onDone({ startAt, endAt });
    }}>
      <div className="form-grid">
        <Field label="Start date"><input name="start" type="date" defaultValue={start} required /></Field>
        <Field label="End date"><input name="end" type="date" defaultValue={end} required /></Field>
      </div>
      <p className="caption">Dates use UTC. The comparison covers the immediately preceding period.</p>
      <Feedback error={error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit">Apply dates</Button></div>
    </form>
  </Dialog>;
}

function TrackingCode({ website, origin, onClose }: { website: Website; origin: string; onClose: () => void }) {
  const action = useAction();
  const snippet = `<script defer src="${origin.replace(/\/$/, '')}/script.js" data-website-id="${website.id}"></script>`;
  return <Dialog title="Tracking code" size="large" onClose={onClose}>
    <div className="form-stack">
      <p>Place this script in the <code>&lt;head&gt;</code> of each page on <strong>{website.domain}</strong> you want to measure.</p>
      <pre className="snippet">{snippet}</pre>
      <details><summary>Track a custom event</summary><code className="snippet">{'<button data-umami-event="signed_up">Sign up</button>'}</code></details>
      <Feedback error={action.error} notice={action.notice} />
      <div className="form-actions"><Button onClick={() => void action.run(async () => navigator.clipboard.writeText(snippet), 'Tracking code copied.')}><Copy size={15} /> Copy tracking code</Button></div>
    </div>
  </Dialog>;
}

function GoalForm({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: (goal: Goal) => void }) {
  const action = useAction();
  return <Dialog title="Create conversion goal" onClose={onClose}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const input: GoalInput = { name: String(data.get('name')).trim(), type: data.get('type') === 'event' ? 'event' : 'path', value: String(data.get('value')).trim() };
      void action.run(async () => { onDone(await api<Goal>(path, 'POST', input)); });
    }}>
      <Field label="Goal name"><input name="name" required maxLength={100} /></Field>
      <Field label="Goal type"><select name="type"><option value="event">Custom event</option><option value="path">Page path</option></select></Field>
      <Field label="Matching value" help="Enter the exact event name or page path."><input name="value" required maxLength={200} placeholder="signed_up or /thank-you" /></Field>
      <Feedback error={action.error} />
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={action.busy}>Create goal</Button></div>
    </form>
  </Dialog>;
}

function ConversionPanel({ website, range, canEdit }: { website: Website; range: DateRange; canEdit: boolean }) {
  const path = `${websitesPath}/${website.id}/goals`;
  const goals = useResource<Goal[]>(path);
  const [selection, setSelection] = useState('');
  const [showForm, setShowForm] = useState(false);
  const goal = goals.data?.find(item => item.id === selection) || goals.data?.[0];
  const stats = useResource<GoalStats>(goal ? `${path}/${goal.id}?${query(range)}` : null);
  return <Panel title="Conversion goals" action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> Create goal</Button> : undefined}>
    <div className="panel-body stack-small">
      {!goals.data ? <AsyncState loading={goals.loading} error={goals.error} retry={goals.refresh} />
        : goal ? <>
          <Field label="Conversion goal"><select value={goal.id} onChange={event => setSelection(event.target.value)}>
            {goals.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></Field>
          <p className="caption">{goal.type === 'event' ? 'Event' : 'Path'} <code>{goal.value}</code></p>
          {!stats.data ? <AsyncState loading={stats.loading} error={stats.error} retry={stats.refresh} /> : <div className="metric-grid metric-grid--pair">
            <Metric label="Matching sessions" value={stats.data.unique} /><Metric label="All sessions" value={stats.data.total} />
          </div>}
        </> : <Empty title="No conversion goals yet" />}
    </div>
    {showForm ? <GoalForm path={path} onClose={() => setShowForm(false)} onDone={goal => {
      setSelection(goal.id);
      setShowForm(false);
      goals.refresh();
    }} /> : null}
  </Panel>;
}

function FunnelPanel({ website, range }: { website: Website; range: DateRange }) {
  const action = useAction();
  const [steps, setSteps] = useState<FunnelStep[]>(defaultSteps);
  const [result, setResult] = useState<FunnelResult>();

  function update(index: number, update: Partial<FunnelStep>) {
    setSteps(values => values.map((step, stepIndex) => stepIndex === index ? { ...step, ...update } : step));
    setResult(undefined);
  }

  return <Panel title="Conversion funnel" description="Measure how many website sessions progress through these steps.">
    <div className="panel-body">
      <form className="form-stack" onSubmit={event => {
        event.preventDefault();
        const windowMinutes = Number(new FormData(event.currentTarget).get('windowMinutes'));
        void action.run(async () => {
          setResult(await api<FunnelResult>(`${websitesPath}/${website.id}/funnel`, 'POST', {
            ...range, steps: steps.map(step => ({ ...step, value: step.value.trim() })), windowMinutes,
          }));
        });
      }}>
        {steps.map((step, index) => <div className="step" key={index}>
          <div className="step-heading"><span>Step {index + 1}</span>{steps.length > 2 ? <Button variant="quiet" className="icon-button" aria-label={`Remove step ${index + 1}`} onClick={() => {
            setSteps(values => values.filter((_, position) => position !== index));
            setResult(undefined);
          }}><Trash2 size={15} /></Button> : null}</div>
          <div className="form-grid">
            <Field label={`Step ${index + 1} type`}><select value={step.type} onChange={event => update(index, { type: event.target.value === 'path' ? 'path' : 'event' })}>
              <option value="path">Page path</option><option value="event">Custom event</option>
            </select></Field>
            <Field label={`Step ${index + 1} value`}><input value={step.value} required maxLength={200} onChange={event => update(index, { value: event.target.value })} /></Field>
          </div>
        </div>)}
        <Field label="Window (minutes)"><input name="windowMinutes" type="number" min="1" max="1440" defaultValue="60" required onChange={() => setResult(undefined)} /></Field>
        <Feedback error={action.error} />
        <div className="actions actions--between">
          {steps.length < 8 ? <Button onClick={() => { setSteps(values => [...values, { type: 'event', value: '' }]); setResult(undefined); }}><Plus size={15} /> Add step</Button> : <span />}
          <Button type="submit" variant="primary" disabled={action.busy}>{action.busy ? 'Running…' : 'Run funnel'}</Button>
        </div>
      </form>
      {result ? <div className="funnel-result"><h3>Funnel results</h3><Distribution points={result.map(item => ({ label: item.label, value: item.visitors }))} /></div> : null}
    </div>
  </Panel>;
}

function SiteReport({ website, range, canEdit, refreshRange }: { website: Website; range: DateRange; canEdit: boolean; refreshRange?: () => void }) {
  const report = useResource<WebsiteReport>(`${websitesPath}/${website.id}/report?${query(range)}`);
  const [chart, setChart] = useState<'pageviews' | 'visitors'>('pageviews');
  const [view, setView] = useState(0);
  const current = report.data?.current;
  const previous = report.data?.previous;
  return <div className="stack">
    <Panel title="Traffic" description="Website activity compared with the preceding period"
      action={<Button onClick={refreshRange || report.refresh} disabled={report.loading}><RefreshCw size={15} /> Refresh metrics</Button>}>
      {!report.data ? <AsyncState loading={report.loading} error={report.error} retry={report.refresh} /> : <div className="panel-body stack">
        <div className="metric-grid">
          <Metric label="Page views" value={current?.pageviews} hint={comparison(current?.pageviews, previous?.pageviews)} />
          <Metric label="Unique visitors" value={current?.visitors} hint={comparison(current?.visitors, previous?.visitors)} />
          <Metric label="Visits" value={current?.visits} hint={comparison(current?.visits, previous?.visits)} />
          <Metric label="Bounces" value={current?.bounces} hint={comparison(current?.bounces, previous?.bounces)} />
        </div>
        <div className="actions">
          <Button aria-pressed={chart === 'pageviews'} onClick={() => setChart('pageviews')}>Page views</Button>
          <Button aria-pressed={chart === 'visitors'} onClick={() => setChart('visitors')}>Unique visitors</Button>
        </div>
        <Bars points={report.data[chart]} label={chart === 'pageviews' ? 'Page views over time' : 'Unique visitors over time'} />
      </div>}
    </Panel>
    {report.data ? <Panel title="Traffic breakdown"><div className="panel-body">
      <nav className="tabs" aria-label="Traffic breakdown">
        {['Content and sources', 'UTM campaigns', 'Technology and location'].map((label, index) => <button key={label} aria-pressed={view === index} onClick={() => setView(index)}>{label}</button>)}
      </nav>
      <div className="report-columns">{groups[view].map(([key, title]) => <section key={key}><h3>{title}</h3>
        <Distribution points={report.data?.dimensions[key]} />
      </section>)}</div>
    </div></Panel> : null}
    <div className="columns">
      <ConversionPanel website={website} range={range} canEdit={canEdit} />
      <FunnelPanel key={range.endAt + ':' + range.startAt} website={website} range={range} />
    </div>
  </div>;
}

function EmailReport() {
  const report = useResource<Dashboard>('/overview');
  return <div className="stack">
    <Panel title="Email performance" description="Newsletter activity measured by the delivery service"
      action={<Button onClick={report.refresh} disabled={report.loading}><RefreshCw size={15} /> Refresh metrics</Button>}>
      {report.data ? <div className="panel-body"><EmailMetrics metrics={report.data.email} /></div>
        : <AsyncState loading={report.loading} error={report.error} retry={report.refresh} />}
    </Panel>
    {report.data ? <Panel title="Campaign activity" description="Tracked newsletter opens over time"><div className="panel-body"><Bars points={report.data.emailTrend} label="Tracked newsletter opens over time" /></div></Panel> : null}
  </div>;
}

export function Analytics({ trackingOrigin }: { trackingOrigin?: string }) {
  const user = useUser();
  const canEdit = user.role !== 'analyst';
  const [tab, setTab] = useState<'website' | 'email'>('website');
  const [range, setRange] = useState(() => recent(30));
  const [period, setPeriod] = useState<number | 'custom'>(30);
  const [selected, setSelected] = useState('');
  const [modal, setModal] = useState<'website' | 'tracking' | 'dates'>();
  const websites = useResource<Website[]>(tab === 'website' ? websitesPath : null);
  const website = websites.data?.find(item => item.id === selected) || websites.data?.[0];
  return <>
    <PageHeader title="Analytics" description="Measure website activity, conversions and newsletter performance."
      actions={tab === 'website' && canEdit ? <Button variant="primary" onClick={() => setModal('website')}><Plus size={16} /> Add website</Button> : undefined} />
    <nav className="tabs" aria-label="Analytics view"><button aria-pressed={tab === 'website'} onClick={() => setTab('website')}><Globe size={15} /> Website analytics</button>
      <button aria-pressed={tab === 'email'} onClick={() => setTab('email')}>Email reports</button>
    </nav>
    {tab === 'email' ? <EmailReport /> : <>
      {!websites.data ? <Panel><AsyncState loading={websites.loading} error={websites.error} retry={websites.refresh} /></Panel>
        : !website ? <Panel><Empty title="No websites connected">
          {canEdit ? 'Add a website to view its activity and get a tracking snippet.' : 'Ask a marketer or administrator to connect a website.'}
        </Empty></Panel> : <div className="stack">
          <Panel><div className="report-controls">
            <Field label="Website"><select value={website.id} onChange={event => setSelected(event.target.value)}>
              {websites.data.map(item => <option key={item.id} value={item.id}>{item.name} · {item.domain}</option>)}
            </select></Field>
            <Field label="Reporting period"><select value={period} onChange={event => {
              if (event.target.value === 'custom') setModal('dates');
              else { const count = Number(event.target.value); setPeriod(count); setRange(recent(count)); }
            }}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value="custom">Custom dates</option></select></Field>
            <Button onClick={() => setModal('dates')}><CalendarDays size={15} /> Dates</Button>
            {canEdit ? <Button onClick={() => setModal('tracking')}><CodeXml size={16} /> Tracking code</Button> : null}
          </div></Panel>
          <SiteReport key={website.id} website={website} range={range} canEdit={canEdit} refreshRange={period === 'custom' ? undefined : () => setRange(recent(period))} />
        </div>}
    </>}
    {modal === 'website' && canEdit ? <WebsiteForm onClose={() => setModal(undefined)} onDone={value => {
      setSelected(value.id);
      websites.refresh();
      setModal(undefined);
    }} /> : null}
    {modal === 'tracking' && website && canEdit
      ? <TrackingCode website={website} origin={trackingOrigin || location.origin} onClose={() => setModal(undefined)} /> : null}
    {modal === 'dates' ? <CustomRange range={range} onClose={() => setModal(undefined)} onDone={value => { setPeriod('custom'); setRange(value); setModal(undefined); }} /> : null}
  </>;
}
