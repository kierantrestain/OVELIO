'use client';

// Marketing › Deliverability: sender authentication, reputation, list hygiene and broken links in one view.
import { Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import type { DeliverabilityCheck, DesignSummary, LinkCheck } from '@/contracts/studio';
import { api, date, useAction, useResource } from '../client';
import { AsyncState, Empty, Feedback, PageHeader, Panel, StatusBadge } from '../ui';
import type { Tone } from '../ui';
import '@/styles/studio.css';

const tone: Record<string, Tone> = { pass: 'success', ok: 'success', warn: 'warning', redirect: 'info', fail: 'error', broken: 'error', info: 'info', unavailable: 'neutral', unreachable: 'warning', skipped: 'neutral' };
const label: Record<string, string> = { pass: 'Pass', warn: 'Check', fail: 'Problem', info: 'Measured', unavailable: 'Unavailable', ok: 'OK', redirect: 'Redirect', broken: 'Broken', unreachable: 'Not reachable', skipped: 'Skipped' };
const groups: DeliverabilityCheck['group'][] = ['Authentication', 'Reputation', 'List hygiene'];
const groupHelp: Record<DeliverabilityCheck['group'], string> = {
  Authentication: 'DNS records that prove your emails come from you.',
  Reputation: 'Measured from newsletters and OVELIO sends.',
  'List hygiene': 'Who is on your lists and whether they can be emailed.',
};

export function DeliverabilityPage() {
  const report = useResource<{ checks: DeliverabilityCheck[]; generatedAt: string }>('/studio/deliverability');
  const designs = useResource<{ items: DesignSummary[] }>('/studio/designs?kind=email');
  const [designId, setDesignId] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkCheck[]>();
  const action = useAction();
  const chosen = designId ?? designs.data?.items[0]?.id ?? null;

  return <div className="ov-stack">
    <PageHeader title="Deliverability" description="What OVELIO can measure about whether your email reaches people."
      actions={<Button icon={<RefreshCw size={15} />} label="Run checks again" onClick={report.refresh} isLoading={report.loading && !!report.data} />} />
    <Banner status="info" title="Measured values only" description="Each check shows a measured value or says why it is unavailable. A relay accepting an email does not mean it reached the inbox, so no inbox rate is shown." />
    {!report.data ? <Panel><AsyncState loading={report.loading} error={report.error} retry={report.refresh} /></Panel> : groups.map(group => <Panel key={group} title={group} description={groupHelp[group]}>
      <ul className="ov-studio-results">
        {report.data!.checks.filter(check => check.group === group).map(check => <li key={check.id}>
          <span><strong>{check.label}</strong><Text type="supporting" color="secondary">{check.detail}</Text></span>
          <span className="ov-actions ov-studio-check-value"><span className="ov-studio-count">{check.value}</span><StatusBadge label={label[check.status]} tone={tone[check.status]} /></span>
        </li>)}
      </ul>
    </Panel>)}
    {report.data ? <Text type="supporting" color="secondary">Checked {date(report.data.generatedAt)}.</Text> : null}

    <Panel title="Broken links in an email" description="Requests each http(s) link and image once (public addresses only, redirects not followed, 4-second timeout).">
      {!designs.data ? <AsyncState loading={designs.loading} error={designs.error} retry={designs.refresh} />
        : designs.data.items.length ? <div className="ov-actions">
          <Selector label="Email design" isLabelHidden width={320} value={chosen ?? ''} onChange={value => { setDesignId(value); setLinks(undefined); }}
            options={designs.data.items.map(item => ({ value: item.id, label: item.name }))} />
          <Button variant="primary" icon={<Link2 size={15} />} label="Check links" isLoading={action.busy} isDisabled={!chosen}
            onClick={() => void action.run(async () => setLinks((await api<{ links: LinkCheck[] }>('/studio/deliverability/links', 'POST', { designId: chosen })).links))} />
        </div> : <Empty title="No email designs yet" />}
      <Feedback error={action.error} />
      {links ? links.length ? <ul className="ov-studio-results">
        {links.map(item => <li key={item.url}>
          <span><strong className="ov-studio-url">{item.url}</strong><Text type="supporting" color="secondary">{item.code ? `HTTP ${item.code} · ` : ''}{item.detail}</Text></span>
          <StatusBadge label={label[item.status]} tone={tone[item.status]} />
        </li>)}
      </ul> : <Empty title="No web links to check" description="This email has no http(s) links or hosted images; merge-tag links such as the unsubscribe link are filled at send time." /> : null}
    </Panel>
  </div>;
}
