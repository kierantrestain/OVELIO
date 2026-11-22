'use client';

import { Activity, ArrowUpRight, Globe, Mail, RefreshCw, UserRoundPlus, UsersRound, Workflow } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import type { CampaignMetrics, Dashboard } from '@/contracts';
import { useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Bars, Empty, Metric, PageHeader, Panel, Rows } from './ui';

export function EmailMetrics({ metrics }: { metrics: CampaignMetrics }) {
  const reporting = metrics.sent != null;
  const untracked = (value: number | null) => reporting && value == null ? 'Untracked' : undefined;
  return <div className="ov-metrics">
    <Metric flat label="Sent" value={metrics.sent} />
    <Metric flat label="Delivered" value={metrics.delivered} hint={untracked(metrics.delivered)} />
    <Metric flat label="Opens" value={metrics.opens} />
    <Metric flat label="Clicks" value={metrics.clicks} />
    <Metric flat label="Bounces" value={metrics.bounces} hint={untracked(metrics.bounces)} />
    <Metric flat label="Unsubscribes" value={metrics.unsubscribes} hint={untracked(metrics.unsubscribes)} />
  </div>;
}

export function Overview() {
  const user = useUser();
  const { data, loading, error, refresh } = useResource<Dashboard>('/overview');
  return <>
    <PageHeader title="Overview" description="Audience, email and website activity for this workspace."
      actions={<Button label="Refresh" icon={<RefreshCw size={15} />} onClick={refresh} isLoading={loading && !!data} />} />
    {!data ? <Panel><AsyncState loading={loading} error={error} retry={refresh} /></Panel> : <div className="ov-stack">
      <div className="ov-metrics">
        <Metric label="Total contacts" value={data.contacts} icon={<UsersRound size={16} />} />
        <Metric label="Active campaigns" value={data.activeCampaigns} icon={<Mail size={16} />} />
        <Metric label="Active automations" value={data.activeWorkflows} icon={<Workflow size={16} />} />
        <Metric label="Website visitors" value={data.visitors} hint={data.visitors == null ? undefined : data.websiteName} icon={<Globe size={16} />} />
        <Metric label="Lead form submissions" value={data.leads} icon={<UserRoundPlus size={16} />} />
        <Metric label="Website conversions" value={data.conversions} hint={data.conversions == null ? undefined : data.conversionGoal} icon={<ArrowUpRight size={16} />} />
      </div>
      {data.alerts.length ? <Panel title="Needs attention">
        <Rows>{data.alerts.map(alert => <li key={alert.href + alert.label}>
          {alert.href === '/settings' && user.role !== 'admin' ? <Text>{alert.label} · Contact an administrator</Text>
            : <Link href={alert.href === '/settings' ? '/settings?view=connections' : alert.href}>{alert.label}</Link>}
        </li>)}</Rows>
      </Panel> : null}
      <div className="ov-grid ov-grid--lead">
        <Panel title="Website traffic" description="Recorded page views over time"><Bars points={data.traffic} label="Website traffic over time" /></Panel>
        <Panel title="Recent activity" action={<Activity size={17} aria-hidden="true" />}>
          {data.recent.length ? <Rows>{data.recent.map(item => <li key={item.id}>
            {item.href ? <Link href={item.href}>{item.description}</Link> : <Text>{item.description}</Text>}
            <Timestamp value={item.at} format="relative_short" />
          </li>)}</Rows> : <Empty title="No recent activity" />}
        </Panel>
      </div>
      <Panel title="Email performance" description="Newsletter activity recorded by your delivery service"><EmailMetrics metrics={data.email} /></Panel>
      <div className="ov-grid">
        <Panel title="Contact growth" description="New contacts over time"><Bars points={data.contactGrowth} label="Contact growth over time" /></Panel>
        <Panel title="Campaign performance" description="Tracked newsletter opens over time"><Bars points={data.emailTrend} label="Tracked newsletter opens over time" /></Panel>
      </div>
    </div>}
  </>;
}
