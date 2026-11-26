'use client';

import '@/styles/calendar.css';
import { Plus, Trash2 } from 'lucide-react';
import NextLink from 'next/link';
import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Availability, BookingType, BookingTypeInput, CalendarOverview, ConsoleAppointment, WeeklyWindow } from '@/contracts/calendar';
import { appointmentStatusLabels } from '@/contracts/calendar';
import type { DealPage } from '@/contracts/crm';
import { api, useAction, useResource } from '../client';
import { useUser } from '../shell';
import { AsyncState, ConfirmDialog, Empty, Feedback, FormActions, Modal, PageHeader, Panel, Snippet, StatusBadge } from '../ui';
import { appointmentTimeLabel, TimeZoneSelector } from './time';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdays = [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: '09:00', end: '17:00' }));
const times = Array.from({ length: 96 }, (_, index) => {
  const value = `${String(Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 15).padStart(2, '0')}`;
  return { value, label: value };
});
const endTimes = [...times, { value: '24:00', label: '24:00' }];

function WorkingHours({ initial, saved }: { initial: Availability; saved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const { busy, error, run } = useAction();
  const windows = draft.windows;
  const setWindows = (next: WeeklyWindow[]) => setDraft(current => ({ ...current, windows: next }));
  const changeWindow = (at: number, patch: Partial<WeeklyWindow>) =>
    setWindows(windows.map((window, index) => index === at ? { ...window, ...patch } : window));
  return <Panel title="My availability" description="Booking links offer times during these hours for this host.">
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void run(async () => { await api('/calendar/availability', 'PATCH', draft); saved(); }, 'Availability saved.');
    }}>
      <TimeZoneSelector value={draft.timeZone} onChange={timeZone => setDraft(current => ({ ...current, timeZone }))} />
      {!windows.length ? <Text type="supporting" color="secondary">Add working hours to accept bookings.</Text> : null}
      {windows.map((window, index) => <div key={index} className="ov-calendar-window">
        <Selector label={`Day ${index + 1}`} value={String(window.weekday)} onChange={value => changeWindow(index, { weekday: Number(value ?? 1) })}
          options={days.map((label, value) => ({ value: String(value), label }))} />
        <Selector label={`From ${index + 1}`} value={window.start} onChange={value => changeWindow(index, { start: value ?? '09:00' })} options={times} />
        <Selector label={`Until ${index + 1}`} value={window.end} onChange={value => changeWindow(index, { end: value ?? '17:00' })} options={endTimes} />
        <IconButton label={`Remove hours ${index + 1}`} variant="ghost" icon={<Trash2 size={15} />} onClick={() => setWindows(windows.filter((_, at) => at !== index))} />
      </div>)}
      <Feedback error={error} />
      <div className="ov-actions">
        {windows.length < 21 ? <Button label="Add hours" size="sm" icon={<Plus size={14} />} onClick={() => setWindows([...windows, { ...weekdays[0] }])} /> : null}
        {!windows.length ? <Button label="Use weekday hours" size="sm" onClick={() => setWindows(weekdays)} /> : null}
        <Button label="Save availability" type="submit" variant="primary" size="sm" isLoading={busy} />
      </div>
    </form>
  </Panel>;
}

function TypeEditor({ initial, overview, close, saved }: { initial?: BookingType; overview: CalendarOverview; close: () => void; saved: () => void }) {
  const user = useUser();
  const [draft, setDraft] = useState<BookingTypeInput>(initial ?? {
    name: '', slug: '', durationMinutes: 30, bufferMinutes: 0, hostIds: [user.id], active: true,
  });
  const action = useAction();
  return <Modal title={initial ? 'Edit booking type' : 'New booking type'} onClose={close}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(initial ? `/calendar/types/${initial.id}` : '/calendar/types', initial ? 'PATCH' : 'POST', draft);
        saved();
      }, 'Booking type saved.');
    }}>
      <TextInput label="Booking name" isRequired value={draft.name} onChange={name => setDraft(current => ({ ...current, name }))} />
      <TextInput label="Booking address" description="Use lowercase words joined by hyphens." placeholder="intro-call"
        isRequired value={draft.slug} onChange={slug => setDraft(current => ({ ...current, slug }))} />
      <div className="ov-form-grid">
        <NumberInput label="Duration (minutes)" value={draft.durationMinutes}
          onChange={value => setDraft(current => ({ ...current, durationMinutes: value ?? 30 }))} />
        <NumberInput label="Buffer (minutes)" value={draft.bufferMinutes}
          onChange={value => setDraft(current => ({ ...current, bufferMinutes: value ?? 0 }))} />
      </div>
      {overview.canManageTeam ? <MultiSelector label="Hosts" value={draft.hostIds} options={overview.hosts.map(host => ({ label: host.name, value: host.id }))}
        description="Bookings rotate among available hosts." onChange={hostIds => setDraft(current => ({ ...current, hostIds }))} /> : null}
      <Switch label="Accept new bookings" value={draft.active} onChange={active => setDraft(current => ({ ...current, active }))} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={close} /><Button label="Save booking type" type="submit" variant="primary"
        isLoading={action.busy} isDisabled={!draft.name.trim() || !draft.slug.trim() || !draft.hostIds.length} /></FormActions>
    </form>
  </Modal>;
}

function DealPicker({ meeting, close, saved }: { meeting: ConsoleAppointment; close: () => void; saved: () => void }) {
  const deals = useResource<DealPage>(`/sales/deals?contactId=${meeting.contactId}`);
  const [value, setValue] = useState(meeting.dealId ?? 'none');
  const action = useAction();
  return <Modal title="Link a deal" onClose={close}>
    <form className="ov-stack-sm" onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        await api(`/calendar/appointments/${meeting.id}`, 'PATCH', { dealId: value === 'none' ? null : value });
        saved();
      }, 'Appointment updated.');
    }}>
      {deals.error ? <AsyncState loading={deals.loading} error={deals.error} retry={deals.refresh} /> : null}
      <Selector label="Deal for this contact" value={value} isLoading={deals.loading}
        options={[{ value: 'none', label: 'No linked deal' }, ...(deals.data?.items ?? []).map(deal => ({ label: deal.name, value: deal.id }))]}
        onChange={selected => setValue(selected ?? 'none')} />
      <Feedback error={action.error} />
      <FormActions><Button label="Cancel" onClick={close} /><Button label="Save deal link" type="submit" variant="primary" isLoading={action.busy} /></FormActions>
    </form>
  </Modal>;
}

function CalendarFeed({ active, saved }: { active: boolean; saved: () => void }) {
  const action = useAction();
  const [link, setLink] = useState('');
  const [confirmation, setConfirmation] = useState<'replace' | 'disable'>();
  const replace = () => void action.run(async () => {
    const { path } = await api<{ path: string }>('/calendar/feed', 'POST');
    setLink(new URL(path, window.location.origin).href);
    setConfirmation(undefined);
    saved();
  });
  return <Panel title="Calendar subscription" description="Subscribe to your booked appointments from any calendar that supports ICS. Keep the subscription link private.">
    {link ? <Snippet code={link} language="text" /> : null}
    <Feedback error={action.error} />
    <div className="ov-actions">
      <Button label={active ? 'Replace subscription link' : 'Create subscription link'} size="sm" isLoading={action.busy}
        onClick={() => { if (active) setConfirmation('replace'); else replace(); }} />
      {active ? <Button label="Disable subscription" size="sm" variant="ghost" onClick={() => setConfirmation('disable')} /> : null}
    </div>
    {confirmation ? <ConfirmDialog title={confirmation === 'replace' ? 'Replace subscription link' : 'Disable subscription'}
      description="Existing subscriptions using the current link will lose access." actionLabel={confirmation === 'replace' ? 'Replace link' : 'Disable'}
      busy={action.busy} onClose={() => setConfirmation(undefined)} onConfirm={() => {
        if (confirmation === 'replace') replace();
        else void action.run(async () => { await api('/calendar/feed', 'DELETE'); setLink(''); setConfirmation(undefined); saved(); });
      }} /> : null}
  </Panel>;
}

export function CalendarWorkspace() {
  const calendar = useResource<CalendarOverview>('/calendar');
  const [host, setHost] = useState('all');
  const [editing, setEditing] = useState<BookingType | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<ConsoleAppointment | null>(null);
  const [linking, setLinking] = useState<ConsoleAppointment | null>(null);
  const action = useAction();
  const data = calendar.data;
  const update = (id: string, status: string) => void action.run(async () => {
    await api(`/calendar/appointments/${id}`, 'PATCH', { status });
    setCancelling(null);
    calendar.refresh();
  }, 'Appointment updated.');
  const meetings = data?.meetings.filter(item => host === 'all' || item.hostId === host) ?? [];
  return <div className="ov-stack ov-wide">
    <PageHeader title="Calendar" description="Share booking links, set your hours and manage appointments." />
    <Feedback error={action.error} />
    {data ? <>
      <Panel title="Appointments" action={data.canManageTeam ? <Selector label="Hosts" value={host}
        options={[{ value: 'all', label: 'All hosts' }, ...data.hosts.map(member => ({ value: member.id, label: member.name }))]}
        onChange={value => setHost(value ?? 'all')} /> : undefined}>
        {meetings.length ? <ul className="ov-rows">
          {meetings.map(item => <li key={item.id} id={`meeting-${item.id}`}>
            <span className="ov-stack-sm">
              <span className="ov-actions"><Text weight="semibold">{item.title}</Text>
                <StatusBadge label={appointmentStatusLabels[item.status]} tone={item.status === 'booked' ? 'success' : 'neutral'} /></span>
              <Text type="supporting">{appointmentTimeLabel(item.startsAt, data.availability.timeZone)} · {item.hostName}</Text>
              <span className="ov-actions"><NextLink href={`/crm/contacts/${item.contactId}`}>{item.guestName}</NextLink>
                {item.dealId ? <NextLink href={`/sales/deals/${item.dealId}`}>Linked deal</NextLink> : null}</span>
            </span>
            <span className="ov-actions">
              <Button label={item.dealId ? 'Change deal' : 'Link deal'} size="sm" variant="ghost" onClick={() => setLinking(item)} />
              {item.status === 'booked' ? <>
                <Button label="Mark held" size="sm" variant="ghost" isDisabled={action.busy || !item.hasStarted} onClick={() => update(item.id, 'completed')} />
                <Button label="No-show" size="sm" variant="ghost" isDisabled={action.busy || !item.hasStarted} onClick={() => update(item.id, 'no_show')} />
                <Button label="Cancel appointment" size="sm" variant="ghost" onClick={() => setCancelling(item)} />
              </> : null}
            </span>
          </li>)}
        </ul> : <Empty title="No appointments" description="Upcoming bookings and recent appointments appear here." />}
      </Panel>
      <Panel title="Booking types" action={<Button label="New booking type" size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')} />}>
        {data.types.length ? <ul className="ov-rows">{data.types.map(item => <li key={item.id}>
          <span className="ov-stack-sm">
            <span className="ov-actions"><Text weight="semibold">{item.name}</Text>
              <StatusBadge label={item.active ? 'Active' : 'Paused'} tone={item.active ? 'success' : 'neutral'} /></span>
            <Text type="supporting">{item.durationMinutes} minutes · {item.bufferMinutes} min buffer · {item.hostIds.length} {item.hostIds.length === 1 ? 'host' : 'hosts'}</Text>
          </span>
          <span className="ov-actions">
            {item.active ? <NextLink href={`/book/${item.slug}`}>Open booking page</NextLink> : null}
            {item.canEdit ? <Button label="Edit booking type" size="sm" variant="ghost" onClick={() => setEditing(item)} /> : null}
          </span>
        </li>)}</ul> : <Empty title="No booking types" description="Create a booking type to share a public link." />}
      </Panel>
      <WorkingHours initial={data.availability} saved={calendar.refresh} />
      <CalendarFeed active={data.hasFeed} saved={calendar.refresh} />
      {editing ? <TypeEditor initial={editing === 'new' ? undefined : editing} overview={data} close={() => setEditing(null)}
        saved={() => { setEditing(null); calendar.refresh(); }} /> : null}
      {linking ? <DealPicker meeting={linking} close={() => setLinking(null)} saved={() => { setLinking(null); calendar.refresh(); }} /> : null}
      {cancelling ? <ConfirmDialog title="Cancel appointment" description="This time will become available for another booking."
        actionLabel="Cancel appointment" busy={action.busy} onClose={() => setCancelling(null)} onConfirm={() => update(cancelling.id, 'cancelled')} /> : null}
    </> : <Panel><AsyncState loading={calendar.loading} error={calendar.error} retry={calendar.refresh} /></Panel>}
  </div>;
}
