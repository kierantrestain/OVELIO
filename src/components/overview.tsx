'use client';

import { Activity, ArrowDownRight, ArrowUpRight, Globe, Mail, RefreshCw, UserRoundPlus, UsersRound, Workflow } from 'lucide-react';
import Link from 'next/link';
import type { CampaignMetrics, Dashboard } from '@/contracts';
import { date, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Bars, Button, Empty, Metric, PageHeader, Panel } from './ui';

export function EmailMetrics({ metrics }: { metrics: CampaignMetrics }) {
  const reporting = metrics.sent != null;
  return <div className="metric-grid metric-grid--email">
    <Metric label="Sent" value={metrics.sent} />
    <Metric label="Delivered" value={metrics.delivered} hint={reporting && metrics.delivered == null ? 'Untracked' : undefined} />
    <Metric label="Opens" value={metrics.opens} />
    <Metric label="Clicks" value={metrics.clicks} />
    <Metric label="Bounces" value={metrics.bounces} hint={reporting && metrics.bounces == null ? 'Untracked' : undefined} />
    <Metric label="Unsubscribes" value={metrics.unsubscribes} hint={reporting && metrics.unsubscribes == null ? 'Untracked' : undefined} />
  </div>;
}

export function Overview() {
  const user = useUser();
  const { data, loading, error, refresh } = useResource<Dashboard>('/overview');
  return <>
    <PageHeader title="Overview" description="A live view of your audience, campaigns and website activity."
      actions={<Button onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</Button>} />
    {!data ? <Panel><AsyncState loading={loading} error={error} retry={refresh} /></Panel> : <div className="stack">
      <div className="metric-grid">
        <Metric label="Total contacts" value={data.contacts} icon={<UsersRound size={16} />} />
        <Metric label="Active campaigns" value={data.activeCampaigns} icon={<Mail size={16} />} />
        <Metric label="Active automations" value={data.activeWorkflows} icon={<Workflow size={16} />} />
        <Metric label="Website visitors" value={data.visitors} hint={data.visitors == null ? undefined : data.websiteName} icon={<Globe size={16} />} />
      </div>
      <div className="columns columns--lead">
        <Panel title="Website traffic" description="Recorded page views over time" action={<span className="chart-key">Page views</span>}>
          <div className="panel-body"><Bars points={data.traffic} label="Website traffic over time" /></div>
        </Panel>
        <Panel title="Recent activity" action={<Activity size={17} aria-hidden="true" />}>
          <div className="panel-body">
            {data.recent.length ? <ul className="line-list line-list--activity">
              {data.recent.map(item => <li key={item.id}>
                {item.href ? <Link className="text-link" href={item.href}>{item.description}</Link> : <span>{item.description}</span>}
                <time dateTime={item.at}>{date(item.at)}</time>
              </li>)}
            </ul> : <Empty title="No recent activity" />}
          </div>
        </Panel>
      </div>
      <Panel title="Email performance" description="Newsletter activity recorded by your delivery service">
        <div className="panel-body"><EmailMetrics metrics={data.email} /></div>
      </Panel>
      <div className="columns">
        <Panel title="Contact growth" description="New contacts over time">
          <div className="panel-body"><Bars points={data.contactGrowth} label="Contact growth over time" /></div>
        </Panel>
        <Panel title="Campaign performance" description="Tracked newsletter opens over time">
          <div className="panel-body"><Bars points={data.emailTrend} label="Tracked newsletter opens over time" /></div>
        </Panel>
      </div>
      <div className="columns">
        <Metric label="Lead form submissions" value={data.leads} icon={<UserRoundPlus size={16} />} />
        <Metric label="Website conversions" value={data.conversions} hint={data.conversions == null ? undefined : data.conversionGoal} icon={<ArrowUpRight size={16} />} />
      </div>
      {data.alerts.length ? <Panel title="Needs attention">
        <div className="panel-body"><ul className="line-list">{data.alerts.map(alert => <li key={alert.href + alert.label}>
          {alert.href === '/settings' && user.role !== 'admin' ? <span>{alert.label} · Contact an administrator</span>
            : <Link className="text-link inline-group" href={alert.href === '/settings' ? '/settings?view=connections' : alert.href}>{alert.label} <ArrowDownRight size={14} /></Link>}
        </li>)}</ul></div>
      </Panel> : null}
    </div>}
  </>;
}
