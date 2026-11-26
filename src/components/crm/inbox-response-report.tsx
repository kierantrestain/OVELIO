'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { inboxResponseWindows } from '@/contracts/inbox-response-report';
import type { InboxResponseReport, InboxResponseWindow } from '@/contracts/inbox-response-report';
import { date, duration, number, useResource } from '../client';
import { AsyncState, Empty, Metric, Panel } from '../ui';

const windows = inboxResponseWindows.map(value => ({ value, label: 'Last ' + value + ' days' }));

export function InboxResponseReportPanel() {
  const [days, setDays] = useState<InboxResponseWindow>('30');
  const report = useResource<InboxResponseReport>('/sales/inbox/response-report?days=' + days);
  const data = report.loading || report.error ? undefined : report.data;

  return <Panel title="Response times" action={<div className="ov-actions">
    <Selector label="Report period" isLabelHidden value={days} options={windows} onChange={value => {
      const interval = inboxResponseWindows.find(item => item === value);
      if (interval) setDays(interval);
    }} />
    <Button label="Refresh" size="sm" onClick={report.refresh} isDisabled={report.loading} />
  </div>}>
    <AsyncState loading={report.loading} error={report.error} retry={report.refresh} />
    {data ? <>
      <Text type="supporting" color="secondary">{date(data.from)} to {date(data.through)}</Text>
      {data.conversations ? <div className="ov-metrics">
        <Metric flat label="Average first reply" formatted={duration(data.averageSeconds)} hint={data.replied ? number(data.replied) + ' measured' : 'No replies recorded'} />
        <Metric flat label="Median first reply" formatted={duration(data.medianSeconds)} />
        <Metric flat label="Awaiting first reply" value={data.awaitingFirstReply} hint={number(data.conversations) + ' conversations'} />
      </div> : <Empty title={data.sampleLimited ? 'No new conversations in this sample' : 'No new conversations in this period'} />}
      <Text type="supporting" color="secondary">
        Includes synced CRM mailbox conversations whose first recorded incoming message falls in this period.
        Reply time runs from that message to the first outgoing message on the same thread.
      </Text>
      {data.resolvedWithoutReply ? <Text type="supporting" color="secondary">
        Resolved without a recorded reply · {number(data.resolvedWithoutReply)}
      </Text> : null}
      {data.sampleLimited ? <Text type="supporting" color="secondary">
        Sample based on the newest {number(data.messageLimit)} incoming messages in mailboxes you can access.
      </Text> : null}
    </> : null}
  </Panel>;
}
