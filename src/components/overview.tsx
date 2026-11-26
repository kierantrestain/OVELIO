'use client';

// The OVELIO home screen (/overview): today's numbers, my tasks, pipeline snapshot, recent leads, campaigns in flight,
// email and website pulse, and a first-use checklist built from the workspace's real state.
import { ArrowDown, ArrowUp, Check, CircleAlert, SlidersHorizontal, Star } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Switch } from '@astryxdesign/core/Switch';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import type { CampaignMetrics } from '@/contracts';
import type { HomeData, HomeTask, OnboardingStep } from '@/contracts/insights';
import { useResource } from './client';
import { BarList } from './insights/charts';
import { ProvenanceBadge } from './insights/controls';
import { newsletterTotals, useNewsletters, useWebsite } from './insights/engines';
import { formatCount, formatMoney, formatPercent } from './insights/format';
import { usePreview, useUser } from './shell';
import { AsyncState, Empty, Metric, Modal, PageHeader, Panel, Rows } from './ui';
import { useWorkspace } from './workspace';
import type { OverviewLayout } from '@/contracts/workspace';
import '@/styles/insights.css';

function rate(part: number | null, total: number | null) {
  if (part == null || total == null || total <= 0) return undefined;
  return `${((part / total) * 100).toFixed(1)}% of sent`;
}

/** Newsletter metrics row (also used by the website analytics and newsletter screens). */
export function EmailMetrics({ metrics }: { metrics: CampaignMetrics }) {
  const reporting = metrics.sent != null;
  const untracked = (value: number | null) => reporting && value == null ? 'Untracked' : undefined;
  return <div className="ov-metrics">
    <Metric flat label="Sent" value={metrics.sent} />
    <Metric flat label="Delivered" value={metrics.delivered} hint={untracked(metrics.delivered)}
      info="Requires authenticated SMTP provider delivery feedback to POST /api/delivery/suppress." />
    <Metric flat label="Opens" value={metrics.opens} hint={rate(metrics.opens, metrics.sent)} />
    <Metric flat label="Clicks" value={metrics.clicks} hint={rate(metrics.clicks, metrics.sent)} />
    <Metric flat label="Bounces" value={metrics.bounces} hint={untracked(metrics.bounces)} />
    <Metric flat label="Unsubscribes" value={metrics.unsubscribes} hint={untracked(metrics.unsubscribes)} />
  </div>;
}

const DAY = 86_400_000;
const noSubscription = () => () => {};
const greetingNow = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};
const todayNow = () => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function readDismissed() {
  try { return localStorage.getItem('ov-onboarding-dismissed') === '1'; } catch { return false; }
}

function Checklist({ steps, onDismiss }: { steps: OnboardingStep[]; onDismiss: () => void }) {
  const done = steps.filter(step => step.done).length;
  return <Panel title="Get OVELIO set up" description={`${done} of ${steps.length} done. Each step unlocks more of your reporting.`}
    action={<Button size="sm" variant="ghost" label="Hide checklist" onClick={onDismiss} />}>
    <div className="ov-insights-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
      <span style={{ width: `${(done / steps.length) * 100}%` }} />
    </div>
    <ul className="ov-insights-checklist">
      {steps.map(step => <li key={step.key} data-done={step.done === true}>
        <span className="ov-insights-check" data-done={step.done === true} aria-hidden="true">
          {step.done ? <Check size={14} /> : step.done === null ? <CircleAlert size={14} /> : null}
        </span>
        <span className="ov-stack-sm" style={{ gap: 4 }}>
          <Text weight="semibold">{step.label}{step.done ? <span className="ov-insights-muted"> · done</span> : ''}</Text>
          <Text type="supporting" color="secondary">{step.done === null ? 'Could not check this right now. ' : ''}{step.description}</Text>
          {step.done ? null : <span><Button size="sm" label={step.action} href={step.href} /></span>}
        </span>
      </li>)}
    </ul>
  </Panel>;
}

function TaskRow({ task }: { task: HomeTask }) {
  return <li>
    <span>
      <Link href={task.related?.href ?? '/sales/tasks'}>{task.title}</Link>
      <Text type="supporting" color="secondary">{[task.type.replace('_', ' '), task.related?.label].filter(Boolean).join(' · ')}</Text>
    </span>
    <span className="ov-actions">
      {task.priority === 'high' ? <Badge label="High" variant="warning" /> : null}
      {task.overdue ? <Badge label="Overdue" variant="error" /> : null}
      {task.dueAt ? <Timestamp value={task.dueAt} format="relative_short" /> : null}
    </span>
  </li>;
}

function EmailPulse({ data }: { data: HomeData }) {
  const newsletters = useNewsletters();
  const [range] = useState(() => ({ startAt: Date.now() - 30 * DAY, endAt: Date.now() + 1 }));
  const latest = newsletters.items ? newsletterTotals(newsletters.items, range).items
    .sort((a, b) => Date.parse(b.sendAt ?? b.createdAt ?? '') - Date.parse(a.sendAt ?? a.createdAt ?? ''))[0] : undefined;
  const sent = data.ovelioEmails;
  return <div className="ov-stack-sm">
    <div className="ov-insights-mini ov-insights-mini--labelled">
      <div><span className="ov-insights-mini-label">Sent by OVELIO, 7 days</span><strong>{formatCount(sent.sent7d)}</strong>
        <small>{formatCount(sent.sentPrevious7d)} the week before</small></div>
      <div><span className="ov-insights-mini-label">Not delivered, 7 days</span><strong>{formatCount(sent.notSent7d)}</strong>
        <small>Blocked by consent, failed, or no mail gateway</small></div>
    </div>
    {newsletters.error ? <Text type="supporting" color="secondary">Newsletter statistics are unavailable: {newsletters.error}</Text>
      : latest ? <div className="ov-stack-sm" style={{ gap: 4 }}>
        <Text type="label" color="secondary">Latest newsletter</Text>
        <Link href={`/campaigns/${latest.id}`}>{latest.name}</Link>
        <Text type="supporting" color="secondary">
          {formatCount(latest.metrics.sent)} sent · {latest.metrics.opens == null ? 'opens not tracked' : `${formatPercent(latest.metrics.opens / Math.max(1, latest.metrics.sent ?? 0))} opened`} · {latest.metrics.clicks == null ? 'clicks not tracked' : `${formatPercent(latest.metrics.clicks / Math.max(1, latest.metrics.sent ?? 0))} clicked`}
        </Text>
      </div> : newsletters.loading ? null : <Text type="supporting" color="secondary">No newsletter sent in the last 30 days.</Text>}
  </div>;
}

function WebsitePulse() {
  const [range] = useState(() => ({ startAt: Math.floor(Date.now() / DAY) * DAY - 6 * DAY, endAt: Date.now() }));
  const { websites, site, report } = useWebsite(range);
  if (websites.error) return <Empty title="Website statistics are unavailable" description={websites.error} />;
  if (!websites.data) return <AsyncState loading error={undefined} />;
  if (!site) return <Empty title="No website is tracked yet" action={<Button size="sm" label="Add website" href="/analytics/website" />} />;
  const current = report.data?.current;
  const previous = report.data?.previous;
  const change = current && previous && previous.visitors ? (current.visitors - previous.visitors) / previous.visitors : null;
  return <div className="ov-insights-mini ov-insights-mini--labelled">
    <div><span className="ov-insights-mini-label">Visitors, 7 days</span><strong>{formatCount(current?.visitors)}</strong>
      <small>{change == null ? site.name : `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(0)}% vs previous 7 days`}</small></div>
    <div><span className="ov-insights-mini-label">Visits</span><strong>{formatCount(current?.visits)}</strong><small>{formatCount(current?.pageviews)} page views</small></div>
    <div><span className="ov-insights-mini-label">Active now</span><strong>{formatCount(report.data?.activeVisitors ?? null)}</strong><small>{site.name}</small></div>
  </div>;
}

/** Overview widgets, in their default order. Each can be hidden or moved from "Customise". */
const widgets = [
  { key: 'kpis', label: 'Today’s numbers' },
  { key: 'tasks', label: 'My tasks' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'starred', label: 'Starred' },
  { key: 'leads', label: 'Recent leads' },
  { key: 'campaigns', label: 'Campaigns in flight' },
  { key: 'email', label: 'Email pulse' },
  { key: 'website', label: 'Website pulse' },
] as const;
type WidgetKey = (typeof widgets)[number]['key'];
const allKeys = widgets.map(widget => widget.key) as string[];

const presets: { key: string; label: string; layout: OverviewLayout }[] = [
  { key: 'default', label: 'Everything', layout: { order: allKeys, hidden: [] } },
  { key: 'executive', label: 'Executive', layout: { order: ['kpis', 'pipeline', 'campaigns', 'leads', 'website', 'email', 'tasks', 'starred'], hidden: ['tasks', 'starred'] } },
  { key: 'sales', label: 'Sales', layout: { order: ['kpis', 'tasks', 'pipeline', 'starred', 'leads', 'campaigns', 'email', 'website'], hidden: ['campaigns', 'email', 'website'] } },
  { key: 'marketing', label: 'Marketing', layout: { order: ['kpis', 'leads', 'campaigns', 'email', 'website', 'pipeline', 'tasks', 'starred'], hidden: ['pipeline', 'tasks', 'starred'] } },
];

/** A saved layout, repaired so widgets added later still appear and unknown keys are dropped. */
function resolveLayout(saved: OverviewLayout | null): OverviewLayout {
  if (!saved) return presets[0].layout;
  const order = [...saved.order.filter(key => allKeys.includes(key)), ...allKeys.filter(key => !saved.order.includes(key))];
  return { order, hidden: saved.hidden.filter(key => allKeys.includes(key)) };
}

function Customise({ layout, onChange, onClose }: { layout: OverviewLayout; onChange: (layout: OverviewLayout) => void; onClose: () => void }) {
  const move = (index: number, by: number) => {
    const order = [...layout.order];
    const [item] = order.splice(index, 1);
    order.splice(index + by, 0, item);
    onChange({ ...layout, order });
  };
  return <Modal title="Customise Overview" onClose={onClose}>
    <Text type="supporting" color="secondary">Start from a preset, then show, hide or reorder widgets. Saved for you on every device.</Text>
    <div className="ov-actions" role="group" aria-label="Presets">
      {presets.map(preset => <Button key={preset.key} size="sm" label={preset.label} onClick={() => onChange(preset.layout)} />)}
    </div>
    <ul className="ov-dash-picker">
      {layout.order.map((key, index) => {
        const label = widgets.find(widget => widget.key === key)?.label ?? key;
        return <li key={key}>
          <Switch label={label} value={!layout.hidden.includes(key)}
            onChange={show => onChange({ ...layout, hidden: show ? layout.hidden.filter(item => item !== key) : [...layout.hidden, key] })} />
          <span className="ov-actions">
            <IconButton size="sm" variant="ghost" label={`Move ${label} up`} icon={<ArrowUp size={15} />} isDisabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton size="sm" variant="ghost" label={`Move ${label} down`} icon={<ArrowDown size={15} />} isDisabled={index === layout.order.length - 1} onClick={() => move(index, 1)} />
          </span>
        </li>;
      })}
    </ul>
    <div className="ov-actions ov-actions--end"><Button variant="primary" label="Done" onClick={onClose} /></div>
  </Modal>;
}

function Starred() {
  const { marks } = useWorkspace();
  if (!marks.starred.length) return <Empty title="Nothing starred yet" description="Star a deal, contact, company, campaign, page or workflow from its page to keep it here." />;
  return <Rows>{marks.starred.slice(0, 8).map(item => <li key={`${item.kind}:${item.recordId}`}>
    <span><Link href={item.href}>{item.label}</Link><Text type="supporting" color="secondary">{item.kind === 'flow' ? 'Workflow' : item.kind[0].toUpperCase() + item.kind.slice(1)}</Text></span>
    <Star size={14} className="ov-star-on" aria-hidden="true" />
  </li>)}</Rows>;
}

export function Overview() {
  const user = useUser();
  const preview = usePreview();
  const home = useResource<HomeData>('/insights/home');
  const websites = useResource<unknown[]>('/websites');
  const greeting = useSyncExternalStore(noSubscription, greetingNow, () => 'Welcome back');
  const today = useSyncExternalStore(noSubscription, todayNow, () => '');
  const dismissedStored = useSyncExternalStore(noSubscription, readDismissed, () => false);
  const [dismissed, setDismissed] = useState(false);
  const data = home.data;
  const firstName = user.name.split(' ')[0] || user.name;
  const steps = data?.onboarding.map(step => step.key === 'website'
    ? { ...step, done: websites.data ? websites.data.length > 0 : websites.error ? null : false } : step) ?? [];
  const showChecklist = steps.length > 0 && steps.some(step => !step.done) && !dismissed && !dismissedStored;
  const cur = data?.currency ?? 'GBP';
  const { preferences, savePreferences } = useWorkspace();
  const layout = resolveLayout(preferences.overview);
  const [customising, setCustomising] = useState(false);

  return <div className="ov-insights-root">
    <PageHeader title={`${greeting}, ${firstName}`} description={`${today ? today + ' · ' : ''}Today across sales, marketing and your websites.`}
      actions={<>
        {preview ? <Badge label="Sample data" variant="info" /> : null}
        <Button label="Customise" icon={<SlidersHorizontal size={15} />} onClick={() => setCustomising(true)} />
        <Button label="Executive analytics" href="/analytics" />
      </>} />
    {!data ? <Panel><AsyncState loading={home.loading} error={home.error} retry={home.refresh} /></Panel> : <>
      {showChecklist ? <Checklist steps={steps} onDismiss={() => {
        setDismissed(true);
        try { localStorage.setItem('ov-onboarding-dismissed', '1'); } catch { /* storage unavailable */ }
      }} /> : null}
      <div className="ov-dash">
        {layout.order.filter(key => !layout.hidden.includes(key)).map(key => {
          const widget = (() => {
            switch (key as WidgetKey) {
              case 'kpis': return <div className="ov-insights-kpis ov-insights-kpis--four">
        <Metric label="Leads today" value={data.today.leads} info="Distinct contacts with a form submission or new-contact event since midnight UTC."
          hint={`${formatCount(data.today.leadsYesterday)} yesterday`} />
        <Metric label="Deals created today" value={data.today.newDeals} hint={`${formatMoney(data.today.newDealValue, cur)} in value`} />
        <Metric label="Won today" formatted={formatMoney(data.today.wonRevenue, cur)} hint={`${formatCount(data.today.wonDeals)} deal${data.today.wonDeals === 1 ? '' : 's'} closed won`} />
        <Metric label="My tasks due today" value={data.today.tasksDue} hint={data.today.tasksOverdue ? `${formatCount(data.today.tasksOverdue)} overdue` : 'Nothing overdue'} />
      </div>;
              case 'tasks': return <Panel title="My tasks" description="Overdue and due today, assigned to you" action={<Link href="/sales/tasks" type="supporting">All tasks</Link>}>
          {data.myTasks.overdue.length || data.myTasks.today.length ? <Rows>
            {[...data.myTasks.overdue, ...data.myTasks.today].map(task => <TaskRow key={task.id} task={task} />)}
          </Rows> : <Empty title="You are all caught up" description="No tasks are overdue or due today." action={<Button size="sm" label="Add a task" href="/sales/tasks?create=task" />} />}
          {data.myTasks.overdueTotal + data.myTasks.todayTotal > data.myTasks.overdue.length + data.myTasks.today.length
            ? <Text type="supporting" color="secondary">Showing the first {data.myTasks.overdue.length + data.myTasks.today.length} of {data.myTasks.overdueTotal + data.myTasks.todayTotal}.</Text> : null}
        </Panel>;
              case 'pipeline': return <Panel title="Pipeline" description={data.pipeline.name ? `${data.pipeline.name} · open deals now` : 'Open deals now'}
          action={<Link href="/analytics/sales" type="supporting">Sales report</Link>}>
          {data.pipeline.openDeals ? <div className="ov-stack-sm">
            <div className="ov-insights-mini">
              <div><Text type="label" color="secondary">Open value</Text><strong>{formatMoney(data.pipeline.openValue, cur)}</strong><small>{formatCount(data.pipeline.openDeals)} open deals</small></div>
              <div><span className="ov-actions"><Text type="label" color="secondary">Weighted</Text><ProvenanceBadge provenance="estimate" /></span><strong>{formatMoney(data.pipeline.weighted, cur)}</strong><small>Value × stage probability</small></div>
            </div>
            <BarList rows={data.pipeline.stages.map(stage => ({ key: stage.name, label: stage.name, value: stage.value, display: `${formatCount(stage.count)} · ${formatMoney(stage.value, cur, true)}` }))} />
          </div> : <Empty title="No open deals yet" description="Add deals to see your pipeline and forecast." action={<Button size="sm" label="Create a deal" href="/sales?create=deal" />} />}
        </Panel>;
              case 'starred': return <Panel title="Starred" description="Records you starred" action={<Text type="supporting" color="secondary">Ctrl+K to search</Text>}><Starred /></Panel>;
              case 'leads': return <Panel title="Recent leads" description="Latest form submissions" action={<Link href="/analytics/marketing" type="supporting">Marketing report</Link>}>
          {data.recentLeads.length ? <Rows>{data.recentLeads.map(lead => <li key={`${lead.contactId}-${lead.at}`}>
            <span>
              <Link href={lead.href}>{lead.name}</Link>
              <Text type="supporting" color="secondary">{[lead.source, lead.campaign?.name].filter(Boolean).join(' · ')}</Text>
            </span>
            <Timestamp value={lead.at} format="relative_short" />
          </li>)}</Rows> : <Empty title="No leads yet" description="Publish a page with a form to start capturing leads." action={<Button size="sm" label="Build a page" href="/sites?create=page" />} />}
        </Panel>;
              case 'campaigns': return <Panel title="Campaigns in flight" description="Active campaigns · leads and won revenue in the last 30 days" action={<Link href="/marketing" type="supporting">Campaigns</Link>}>
          {data.campaignsInFlight.length ? <Rows>{data.campaignsInFlight.map(campaign => <li key={campaign.id}>
            <span>
              <Link href={campaign.href}>{campaign.name}</Link>
              <Text type="supporting" color="secondary">{campaign.endsOn ? `Ends ${new Date(campaign.endsOn + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : 'No end date'}</Text>
            </span>
            <span className="ov-insights-drill-meta">
              <strong>{formatMoney(campaign.wonRevenue, cur)}</strong>
              <Text type="supporting" color="secondary">{formatCount(campaign.leads)} lead{campaign.leads === 1 ? '' : 's'}</Text>
            </span>
          </li>)}</Rows> : <Empty title="No active campaigns" description="Group emails, pages and forms in a campaign to see its leads and revenue." action={<Button size="sm" label="Plan a campaign" href="/marketing?create=campaign" />} />}
        </Panel>;
              case 'email': return <Panel title="Email pulse" action={<Link href="/marketing/emails" type="supporting">Emails</Link>}><EmailPulse data={data} /></Panel>;
              case 'website': return <Panel title="Website pulse" action={<Link href="/analytics/website" type="supporting">Website analytics</Link>}><WebsitePulse /></Panel>;
              default: return null;
            }
          })();
          return widget ? <section key={key} className={`ov-dash-item ov-dash-item--${key}`} data-widget={key} aria-label={widgets.find(item => item.key === key)?.label}>{widget}</section> : null;
        })}
      </div>
      {customising ? <Customise layout={layout} onChange={next => void savePreferences({ overview: next })} onClose={() => setCustomising(false)} /> : null}
    </>}
  </div>;
}
