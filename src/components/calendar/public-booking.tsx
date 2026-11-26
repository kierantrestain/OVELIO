'use client';

import '@/styles/calendar.css';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { Appointment, BookingConfirmation, ManagedBooking, PublicBooking } from '@/contracts/calendar';
import { appointmentStatusLabels } from '@/contracts/calendar';
import { request, useAction } from '../client';
import { ConfirmDialog, Empty, Feedback, PageHeader, Panel, StatusBadge } from '../ui';
import { appointmentTimeLabel, SlotPicker, TimeZoneSelector } from './time';

function BookingLayout({ name, description, children }: { name: string; description?: string; children: ReactNode }) {
  return <main className="ov-calendar-public ov-stack">
    <PageHeader title={name} description={description} />
    {children}
  </main>;
}

function submit<T>(path: string, body: object) {
  return request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export function PublicBookingScreen({ booking }: { booking: PublicBooking }) {
  const [slots, setSlots] = useState(booking.slots);
  const [timeZone, setTimeZone] = useState('UTC');
  const [startsAt, setStartsAt] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState<BookingConfirmation>();
  const requestId = useRef<string | undefined>(undefined);
  const action = useAction();
  const endpoint = '/api/public/booking/' + booking.slug;
  return <BookingLayout name={booking.name} description={`${booking.durationMinutes} minutes`}>
    {confirmed ? <Panel title="Booking confirmed">
      <Text>{appointmentTimeLabel(confirmed.startsAt, confirmed.timeZone)} ({confirmed.timeZone})</Text>
      <Link href={confirmed.manageUrl}>Manage your booking</Link>
    </Panel> : <Panel title="Book a time">
      <Feedback error={action.error} />
      {slots.length ? <form className="ov-stack-sm" onSubmit={event => {
        event.preventDefault();
        const key = requestId.current ??= crypto.randomUUID();
        void action.run(async () => {
          try { setConfirmed(await submit<BookingConfirmation>(endpoint, { startsAt, timeZone, firstName, lastName, email, requestId: key })); }
          catch (error) {
            const updated = await request<PublicBooking>(endpoint).catch(() => null);
            if (updated && !updated.slots.includes(startsAt)) { setSlots(updated.slots); setStartsAt(''); }
            throw error;
          }
        });
      }}>
        <TimeZoneSelector value={timeZone} onChange={setTimeZone} />
        <SlotPicker slots={slots} timeZone={timeZone} value={startsAt} onChange={setStartsAt} />
        <div className="ov-form-grid">
          <TextInput label="First name" autoComplete="given-name" isRequired value={firstName} onChange={setFirstName} />
          <TextInput label="Last name" autoComplete="family-name" value={lastName} onChange={setLastName} />
        </div>
        <TextInput label="Email" autoComplete="email" type="email" isRequired value={email} onChange={setEmail} />
        <div><Button type="submit" variant="primary" label="Confirm booking" isLoading={action.busy} isDisabled={!startsAt || !email.trim() || !firstName.trim()} /></div>
      </form> : <Empty title="No times currently available" description="Check back for more availability." />}
    </Panel>}
  </BookingLayout>;
}

export function ManageBookingScreen({ initial, token }: { initial: ManagedBooking; token: string }) {
  const [booking, setBooking] = useState<Appointment>(initial);
  const [slots, setSlots] = useState(initial.slots);
  const [startsAt, setStartsAt] = useState('');
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [cancelling, setCancelling] = useState(false);
  const action = useAction();
  const endpoint = '/api/public/booking/manage/' + encodeURIComponent(token);
  const changeable = initial.canChange && booking.status === 'booked';
  return <BookingLayout name={booking.title} description="Manage your booking">
    <Panel title="Appointment" action={<StatusBadge label={appointmentStatusLabels[booking.status]} tone={booking.status === 'booked' ? 'success' : 'neutral'} />}>
      <Text>{appointmentTimeLabel(booking.startsAt, booking.timeZone)} ({booking.timeZone})</Text>
      <Feedback error={action.error} notice={action.notice} />
      {changeable ? <div className="ov-stack-sm">
        {slots.length ? <form className="ov-stack-sm" onSubmit={event => {
          event.preventDefault();
          void action.run(async () => {
            try { setBooking(await submit<Appointment>(endpoint, { action: 'reschedule', startsAt, timeZone })); setStartsAt(''); }
            catch (error) {
              const current = await request<ManagedBooking>(endpoint).catch(() => undefined);
              if (current) { setSlots(current.slots); setStartsAt(''); }
              throw error;
            }
          }, 'Appointment rescheduled.');
        }}>
          <TimeZoneSelector value={timeZone} onChange={setTimeZone} />
          <SlotPicker slots={slots} timeZone={timeZone} value={startsAt} onChange={setStartsAt} />
          <div><Button type="submit" label="Reschedule appointment" variant="primary" isLoading={action.busy} isDisabled={!startsAt} /></div>
        </form> : null}
        <div><Button label="Cancel appointment" variant="ghost" onClick={() => setCancelling(true)} /></div>
      </div> : null}
    </Panel>
    {cancelling ? <ConfirmDialog title="Cancel appointment" description="The host will be able to offer this time to someone else."
      actionLabel="Cancel appointment" busy={action.busy} onClose={() => setCancelling(false)} onConfirm={() => void action.run(async () => {
        setBooking(await submit<Appointment>(endpoint, { action: 'cancel' }));
        setCancelling(false);
      }, 'Appointment cancelled.')} /> : null}
  </BookingLayout>;
}
