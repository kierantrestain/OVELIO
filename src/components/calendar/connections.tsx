'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import type { CalendarConnection } from '@/contracts/calendar';
import { api, useAction, useResource } from '../client';
import { AsyncState, ConfirmDialog, Feedback, Panel, StatusBadge } from '../ui';

export function CalendarConnections({ failed }: { failed: boolean }) {
  const connections = useResource<CalendarConnection[]>('/calendar/connections');
  const [pending, setPending] = useState<{ item: CalendarConnection; action: 'disconnect' | 'mirror' | 'stop' }>();
  const action = useAction();
  const start = (item: CalendarConnection, mirror = false) => void action.run(async () => {
    const { url } = await api<{ url: string }>(`/calendar/connections/${item.provider}${mirror ? '/mirror' : ''}`, 'POST');
    window.location.assign(url);
  });
  const confirm = () => {
    if (!pending) return;
    if (pending.action === 'mirror') {
      start(pending.item, true);
      return;
    }
    const stop = pending.action === 'stop';
    void action.run(async () => {
      await api(`/calendar/connections/${pending.item.provider}${stop ? '/mirror' : ''}`, 'DELETE');
      setPending(undefined);
      connections.refresh();
    }, stop ? 'Appointment mirroring stopped.' : 'Calendar disconnected.');
  };
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
            {item.mirrorEnabled ? <Text type="supporting" color="secondary">Appointment mirroring enabled</Text> : null}
          </span>
          <span className="ov-actions">
            {item.configured ? <Button label={active ? `Reconnect ${item.label}` : `Connect ${item.label}`} size="sm"
              isDisabled={action.busy} onClick={() => {
                if (item.mirrorEnabled) setPending({ item, action: 'mirror' });
                else start(item);
              }} /> : null}
            {item.mirrorEnabled || (active && item.configured) ? <Button
              label={item.mirrorEnabled ? `Stop mirroring to ${item.label}` : `Mirror to ${item.label}`}
              size="sm" variant="ghost" isDisabled={action.busy}
              onClick={() => setPending({ item, action: item.mirrorEnabled ? 'stop' : 'mirror' })} /> : null}
            {active ? <Button label={`Disconnect ${item.label}`} size="sm" variant="ghost" isDisabled={action.busy}
              onClick={() => setPending({ item, action: 'disconnect' })} /> : null}
          </span>
        </li>;
      })}</ul>
      {connections.data.some(item => !item.configured) ? <Text type="supporting" color="secondary">
        Ask your administrator to configure OAuth for each provider you want to use.
      </Text> : null}
    </> : <AsyncState loading={connections.loading} error={connections.error} retry={connections.refresh} />}
    {pending ? <ConfirmDialog
      title={pending.action === 'mirror' ? `Mirror appointments to ${pending.item.label}`
        : pending.action === 'stop' ? `Stop mirroring to ${pending.item.label}` : `Disconnect ${pending.item.label}`}
      description={pending.action === 'mirror'
        ? 'Allow OVELIO to create busy events for new bookings and reschedules. Copies contain a generic title and their start and end times. OVELIO removes its copies when appointments are cancelled.'
        : pending.action === 'stop' ? 'OVELIO will stop updating copies. Manage earlier copies directly in your provider calendar.'
          : 'Booking links will use your OVELIO availability and any other connected calendar. Manage any earlier copies in your provider calendar.'}
      actionLabel={pending.action === 'mirror' ? 'Authorize mirroring' : pending.action === 'stop' ? 'Stop mirroring' : 'Disconnect calendar'}
      destructive={pending.action !== 'mirror'} busy={action.busy} onClose={() => setPending(undefined)} onConfirm={confirm} /> : null}
  </Panel>;
}
