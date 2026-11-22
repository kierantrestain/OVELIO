'use client';

import { Activity, ArrowUpRight, Globe, Mail, Plus, RefreshCw, Upload, UserRoundPlus, UsersRound, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import type { CampaignMetrics, Dashboard } from '@/contracts';
import { number, useResource } from './client';
import { useUser } from './shell';
import { AsyncState, Bars, Empty, Metric, PageHeader, Panel, Rows, SendProgress } from './ui';

function rate(part: number | null, total: number | null) {
  if (part == null || total == null || total <= 0) return undefined;
  return `${((part / total) * 100).toFixed(1)}% of sent`;
}

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

export function Overview() {
  const user = useUser();
  const { data, loading, error, refresh } = useResource<Dashboard>('/overview');
  const [emailMetric, setEmailMetric] = useState('opens');
  const canEdit = user.role !== 'analyst';
  const emailSeries = emailMetric === 'clicks' ? data?.emailClicksTrend
    : emailMetric === 'bounces' ? data?.emailBouncesTrend
      : data?.emailTrend;

  return <>
    <PageHeader title="Overview" description="Audience, email and website activity for this workspace."
      actions={<>
        {canEdit ? <>
          <Button label="Import CSV" icon={<Upload size={15} />} href="/audience" />
          <Button label="New newsletter" icon={<Plus size={15} />} href="/campaigns" />
        </> : null}
        <Button label="Refresh" icon={<RefreshCw size={15} />} onClick={refresh} isLoading={loading && !!data} />
      </>} />
    {!data ? <Panel><AsyncState loading={loading} error={error} retry={refresh} /></Panel> : <div className="ov-stack">
      <div className="ov-metrics">
        <Metric label="Total contacts" value={data.contacts} icon={<UsersRound size={16} />} />
        <Metric label="Active campaigns" value={data.activeCampaigns} icon={<Mail size={16} />} />
        <Metric label="Active automations" value={data.activeWorkflows} icon={<Workflow size={16} />} />
        <Metric label="Website visitors" value={data.visitors}
          hint={data.activeVisitors != null && data.activeVisitors > 0
            ? `${number(data.activeVisitors)} active right now${data.websiteName ? ` · ${data.websiteName}` : ''}`
            : data.visitors == null ? undefined : data.websiteName}
          icon={data.activeVisitors ? <StatusDot variant="success" label="Active visitors" /> : <Globe size={16} />} />
        <Metric label="Lead form submissions" value={data.leads} icon={<UserRoundPlus size={16} />} />
        <Metric label="Website conversions" value={data.conversions} hint={data.conversions == null ? undefined : data.conversionGoal} icon={<ArrowUpRight size={16} />} />
      </div>

      {data.runningCampaigns?.length ? <Panel title="Sending in progress" description="Live delivery progress reported by the newsletter engine">
        <div className="ov-stack-sm">
          {data.runningCampaigns.map(item => <SendProgress
            key={item.id}
            label={`Campaign #${item.id}`}
            sent={item.sent}
            total={item.toSend}
            rate={item.rate || item.netRate}
          />)}
        </div>
      </Panel> : null}

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
        <Panel title="Campaign performance" description="Tracked newsletter activity over time"
          action={<SegmentedControl label="Email trend metric" size="sm" value={emailMetric} onChange={setEmailMetric}>
            <SegmentedControlItem value="opens" label="Opens" />
            <SegmentedControlItem value="clicks" label="Clicks" />
            <SegmentedControlItem value="bounces" label="Bounces" />
          </SegmentedControl>}>
          <Bars points={emailSeries} label={`Tracked newsletter ${emailMetric} over time`} />
        </Panel>
      </div>
    </div>}
  </>;
}
