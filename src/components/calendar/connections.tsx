'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import type { CalendarConnection } from '@/contracts/calendar';
import { api, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Feedback, Panel, StatusBadge } from '../ui';

export function CalendarConnections({ failed }: { failed: boolean }) {
  const connections = useResource<CalendarConnection[]>('/calendar/connections');
  const [disconnecting, setDisconnecting] = useState<CalendarConnection>();
  const action = useAction();
  return <Panel title="My calendar connections"
    description="Booking links check the primary Google calendar and default Microsoft work or school calendar for conflicts.">
    <Feedback error={action.error || (failed ? 'The calendar could not be connected. Try again or ask your administrator to check its OAuth setup.' : undefined)} />
    {connections.data ? <>
      <ul className="ov-rows">{connections.data.map(item => {
        const active = item.status !== 'disconnected';
        return <li key={item.provider}>
          <span className="ov-stack-sm">
            <Text weight="semibold">{item.label}</Text>
            <StatusBadge label={item.status === 'connected' ? 'Connected' : item.status === 'unavailable' ? 'Needs attention'
              : item.configured ? 'Disconnected' : 'Setup required'}
              tone={item.status === 'connected' ? 'success' : item.status === 'unavailable' ? 'warning' : 'neutral'} />
          </span>
          <span className="ov-actions">
            {item.configured ? <Button label={active ? `Reconnect ${item.label}` : `Connect ${item.label}`} size="sm"
              isDisabled={action.busy} onClick={() => void action.run(async () => {
                const { url } = await api<{ url: string }>(`/calendar/connections/${item.provider}`, 'POST');
                window.location.assign(url);
              })} /> : null}
            {active ? <Button label={`Disconnect ${item.label}`} size="sm" variant="ghost" isDisabled={action.busy}
              onClick={() => setDisconnecting(item)} /> : null}
          </span>
        </li>;
      })}</ul>
      {connections.data.some(item => !item.configured) ? <Text type="supporting" color="secondary">
        Ask your administrator to configure OAuth for each provider you want to use.
      </Text> : null}
    </> : <AsyncState loading={connections.loading} error={connections.error} retry={connections.refresh} />}
    {disconnecting ? <ConfirmDialog title={`Disconnect ${disconnecting.label}`}
      description="Booking links will use your OVELIO availability and any other connected calendar."
      actionLabel="Disconnect calendar" busy={action.busy} onClose={() => setDisconnecting(undefined)}
      onConfirm={() => void action.run(async () => {
        await api(`/calendar/connections/${disconnecting.provider}`, 'DELETE');
        setDisconnecting(undefined);
        connections.refresh();
      }, 'Calendar disconnected.')} /> : null}
  </Panel>;
}
