import { z } from 'zod';
import type { Appointment, BookingConfirmation, ManagedBooking, PublicBooking } from '@/contracts/calendar';
import { AppError, emailKey, secretsEqual } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { upsertContact } from '../directory';
import { emitEvent } from '../events';
import { schedulePlatformJob } from '../platform/jobs';
import { hostSchedule, minute, slotInterval, slotRange, timeZone } from './availability';
import { checkCalendars, currentCalendarRevisions } from './connections';
import type { CalendarAvailabilityCheck } from './connections';
import { queueAppointmentMirror } from './mirror';
import type { Availability } from '@/contracts/calendar';

export const bookingSlug = z.string().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens.');
const appointmentTime = z.iso.datetime({ offset: true });
export const bookingInput = z.object({
  startsAt: appointmentTime, timeZone, requestId: z.uuid(), email: z.email().max(254),
  firstName: z.string().trim().min(1).max(120), lastName: z.string().trim().max(120).optional(),
});
export const manageInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('reschedule'), startsAt: appointmentTime, timeZone }),
]);

export type BookingRow = {
  id: string; owner_id: string; name: string; slug: string; duration_minutes: number; buffer_minutes: number; active: boolean;
  last_host_id: string | null;
};

export type AppointmentRow = {
  id: string; booking_type_id: string; contact_id: string; deal_id: string | null; status: Appointment['status']; title: string;
  host_id: string; starts_at: Date; ends_at: Date; guest_name: string; guest_email: string; time_zone: string; origin: string;
  revision: number;
};

type HostRow = { user_id: string; time_zone: string; weekly_windows: Availability['windows'] };

export function toAppointment(row: AppointmentRow): Appointment {
  return { id: row.id, status: row.status, title: row.title, startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(), timeZone: row.time_zone };
}

function notFound(): never { throw new AppError(404, 'This booking link is unavailable.'); }
function unavailable(): never { throw new AppError(409, 'This time is no longer available. Pick another time.'); }

async function typeFor(slug: string) {
  if (!bookingSlug.safeParse(slug).success) notFound();
  const { rows: [type] } = await db.query<BookingRow>(`SELECT * FROM calendar_booking_types WHERE slug = $1 AND active`, [slug]);
  return type ?? notFound();
}

async function loadSchedules(client: Sql, type: BookingRow, options: { lock?: boolean; ignore?: string } = {}) {
  const hosts = await client.query<HostRow>(
    `SELECT h.* FROM calendar_hosts h JOIN calendar_type_hosts t ON t.host_id = h.user_id
     JOIN users u ON u.id = h.user_id
     WHERE t.booking_type_id = $1 AND u.disabled_at IS NULL AND u.role IN ('marketer', 'admin') AND h.weekly_windows <> '[]'::jsonb
     ORDER BY h.user_id ${options.lock ? 'FOR UPDATE OF h' : ''}`, [type.id],
  );
  if (!hosts.rows.length) return [];
  const range = slotRange(Date.now());
  const busy = await client.query<{ host_id: string; starts_at: Date; blocked_until: Date }>(
    `SELECT host_id, starts_at, blocked_until FROM calendar_appointments
     WHERE host_id = ANY($1::uuid[]) AND status <> 'cancelled' AND starts_at <= $2 AND blocked_until > $3
       AND ($4::uuid IS NULL OR id <> $4)`,
    [hosts.rows.map(host => host.user_id), new Date(range.last + (type.duration_minutes + type.buffer_minutes) * minute),
      new Date(range.first), options.ignore ?? null],
  );
  const schedules = hosts.rows.map(host => ({
    id: host.user_id,
    fits: hostSchedule({ timeZone: host.time_zone, windows: host.weekly_windows },
      busy.rows.filter(row => row.host_id === host.user_id)
        .map(row => ({ startsAt: row.starts_at.getTime(), blockedUntil: row.blocked_until.getTime() })),
      type.duration_minutes, type.buffer_minutes),
  }));
  const next = schedules.findIndex(host => host.id === type.last_host_id) + 1;
  return [...schedules.slice(next), ...schedules.slice(0, next)];
}

async function openSlots(type: BookingRow, ignore?: string): Promise<string[]> {
  const schedules = await loadSchedules(db, type, { ignore });
  if (!schedules.length) return [];
  const { first, last } = slotRange(Date.now());
  const blockedDuration = occupiedDuration(type);
  const checked = await checkCalendars(schedules.map(host => host.id), first, last + blockedDuration);
  const slots: string[] = [];
  for (let at = first; at <= last; at += slotInterval) {
    if (schedules.some(host => checked.isFree(host.id, at, at + blockedDuration) && host.fits(at))) {
      slots.push(new Date(at).toISOString());
    }
  }
  return slots;
}

function occupiedDuration(type: BookingRow) {
  return (type.duration_minutes + type.buffer_minutes) * minute;
}

function requireSlotTime(startsAt: number) {
  const { first, last } = slotRange(Date.now());
  if (startsAt < first || startsAt > last || startsAt % slotInterval !== 0) unavailable();
}

async function checkSlot(type: BookingRow, startsAt: number, ignore?: string) {
  requireSlotTime(startsAt);
  const hostIds = (await loadSchedules(db, type, { ignore })).filter(host => host.fits(startsAt)).map(host => host.id);
  if (!hostIds.length) unavailable();
  const end = startsAt + occupiedDuration(type);
  const checked = await checkCalendars(hostIds, startsAt, end);
  if (!hostIds.some(host => checked.isFree(host, startsAt, end))) unavailable();
  return checked;
}

async function selectHost(client: Sql, type: BookingRow, startsAt: number, checked: CalendarAvailabilityCheck, ignore?: string) {
  requireSlotTime(startsAt);
  const schedules = await loadSchedules(client, type, { lock: true, ignore });
  const revisions = await currentCalendarRevisions(client, schedules.map(host => host.id));
  const host = schedules.find(host => host.fits(startsAt) && checked.isFree(host.id, startsAt, startsAt + occupiedDuration(type), revisions));
  if (!host) unavailable();
  return host.id;
}

export async function publicBooking(slug: string): Promise<PublicBooking> {
  const type = await typeFor(slug);
  return { name: type.name, slug: type.slug, durationMinutes: type.duration_minutes, slots: await openSlots(type) };
}

function startLabel(row: AppointmentRow) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: row.time_zone }).format(row.starts_at);
}

function manageUrl(row: AppointmentRow) {
  const token = `${row.id}.${emailKey('calendar-management:' + row.id)}`;
  return `${row.origin}/book/manage/${token}`;
}

async function byToken(token: string) {
  const [id, signature, ...rest] = token.split('.');
  if (rest.length || !z.uuid().safeParse(id).success || !/^[a-f0-9]{64}$/.test(signature ?? '')) notFound();
  // Prime the embedded preview and confirm the appointment exists before using its signing key.
  const { rows: [row] } = await db.query<AppointmentRow>('SELECT * FROM calendar_appointments WHERE id = $1', [id]);
  if (!row || !secretsEqual(emailKey('calendar-management:' + id), signature)) notFound();
  return row;
}

function confirmation(row: AppointmentRow): BookingConfirmation {
  return { ...toAppointment(row), manageUrl: manageUrl(row) };
}

export const APPOINTMENT_MAIL = 'calendar.appointment_mail';

async function notify(client: Sql, row: AppointmentRow, kind: 'confirmed' | 'rescheduled' | 'cancelled') {
  const input = { id: row.id, revision: row.revision, kind };
  await schedulePlatformJob(APPOINTMENT_MAIL, `${row.id}:${row.revision}:${kind}`, input, { client });
  if (kind !== 'cancelled' && row.starts_at.getTime() - Date.now() > 24 * 60 * minute) {
    await schedulePlatformJob(APPOINTMENT_MAIL, `${row.id}:${row.revision}:reminder`, { ...input, kind: 'reminder' },
      { client, runAt: new Date(row.starts_at.getTime() - 24 * 60 * minute) });
  }
}

export async function appointmentEvent(client: Sql, row: AppointmentRow, type: 'booked' | 'rescheduled' | 'cancelled' | 'completed' | 'no_show', actorId?: string) {
  await emitEvent({
    type: `appointment.${type}`, contactId: Number(row.contact_id), dealId: row.deal_id, actorId, entityType: 'appointment', entityId: row.id,
    properties: { title: row.title, startsAt: row.starts_at.toISOString(), startsAtLabel: startLabel(row), timeZone: row.time_zone, hostId: row.host_id },
    idempotencyKey: `appointment.${type}:${row.id}:${row.revision}`,
  }, client);
  if (type === 'booked' || type === 'rescheduled' || type === 'cancelled') {
    await notify(client, row, type === 'booked' ? 'confirmed' : type);
    await queueAppointmentMirror(client, row.id, row.host_id);
  }
}

async function alreadyBooked(client: Sql, typeId: string, input: z.infer<typeof bookingInput>) {
  const row = (await client.query<AppointmentRow>(`SELECT * FROM calendar_appointments WHERE booking_type_id = $1 AND request_id = $2`,
    [typeId, input.requestId])).rows[0];
  if (row && row.guest_email !== input.email.trim().toLowerCase()) throw new AppError(409, 'Start a new booking request.');
  return row;
}

export async function book(slug: string, input: z.infer<typeof bookingInput>, origin: string) {
  const type = await typeFor(slug);
  const existing = await alreadyBooked(db, type.id, input);
  if (existing) return confirmation(existing);
  const startsAt = new Date(input.startsAt);
  const checked = await checkSlot(type, startsAt.getTime());
  const { contact } = await upsertContact({ email: input.email, firstName: input.firstName, lastName: input.lastName, source: 'Calendar booking' });
  return transaction(async client => {
    const { rows: [locked] } = await client.query<BookingRow>('SELECT * FROM calendar_booking_types WHERE id = $1 AND active FOR UPDATE', [type.id]);
    if (!locked) notFound();
    const duplicate = await alreadyBooked(client, type.id, input);
    if (duplicate) return confirmation(duplicate);
    const host = await selectHost(client, locked, startsAt.getTime(), checked);
    const endsAt = new Date(startsAt.getTime() + locked.duration_minutes * minute);
    const { rows: [row] } = await client.query<AppointmentRow>(
      `INSERT INTO calendar_appointments (booking_type_id, request_id, contact_id, title, host_id, guest_name, guest_email,
       time_zone, starts_at, ends_at, blocked_until, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [type.id, input.requestId, contact.id, locked.name, host, [input.firstName, input.lastName].filter(Boolean).join(' '),
        input.email.trim().toLowerCase(), input.timeZone, startsAt, endsAt, new Date(endsAt.getTime() + locked.buffer_minutes * minute), origin],
    );
    await client.query('UPDATE calendar_booking_types SET last_host_id = $2 WHERE id = $1', [type.id, host]);
    await appointmentEvent(client, row, 'booked');
    return confirmation(row);
  });
}

export async function manageBooking(token: string): Promise<ManagedBooking> {
  const row = await byToken(token);
  const canChange = row.status === 'booked' && row.starts_at.getTime() > Date.now();
  let slots: string[] = [];
  if (canChange) {
    const type = (await db.query<BookingRow>('SELECT * FROM calendar_booking_types WHERE id = $1 AND active', [row.booking_type_id])).rows[0];
    if (type) slots = await openSlots(type, row.id);
  }
  return { ...toAppointment(row), slots, canChange };
}

export async function changeBooking(token: string, input: z.infer<typeof manageInput>) {
  const saved = await byToken(token);
  const { id, booking_type_id } = saved;
  let checked: CalendarAvailabilityCheck | undefined;
  if (input.action === 'reschedule') {
    if (saved.status !== 'booked' || saved.starts_at.getTime() <= Date.now()) throw new AppError(409, 'This appointment can no longer be changed online.');
    const at = Date.parse(input.startsAt);
    if (at !== saved.starts_at.getTime() || input.timeZone !== saved.time_zone) {
      const { rows: [type] } = await db.query<BookingRow>('SELECT * FROM calendar_booking_types WHERE id = $1', [booking_type_id]);
      if (!type?.active) throw new AppError(409, 'This booking link is paused. Contact the organiser to reschedule.');
      checked = await checkSlot(type, at, id);
    }
  }
  return transaction(async client => {
    const { rows: [type] } = await client.query<BookingRow>('SELECT * FROM calendar_booking_types WHERE id = $1 FOR UPDATE', [booking_type_id]);
    const { rows: [current] } = await client.query<AppointmentRow>('SELECT * FROM calendar_appointments WHERE id = $1 FOR UPDATE', [id]);
    if (!current || !type) notFound();
    if (input.action === 'cancel' && current.status === 'cancelled') return toAppointment(current);
    if (current.status !== 'booked' || current.starts_at.getTime() <= Date.now()) throw new AppError(409, 'This appointment can no longer be changed online.');
    if (input.action === 'cancel') return toAppointment(await setStatus(client, current, 'cancelled'));
    if (!type.active) throw new AppError(409, 'This booking link is paused. Contact the organiser to reschedule.');
    const at = Date.parse(input.startsAt);
    if (at === current.starts_at.getTime() && input.timeZone === current.time_zone) return toAppointment(current);
    if (!checked) unavailable();
    const host = await selectHost(client, type, at, checked, id);
    const endsAt = new Date(at + type.duration_minutes * minute);
    const { rows: [row] } = await client.query<AppointmentRow>(
      `UPDATE calendar_appointments SET starts_at = $2, ends_at = $3, blocked_until = $4, time_zone = $5,
       host_id = $6, revision = revision + 1 WHERE id = $1 RETURNING *`,
      [id, new Date(at), endsAt, new Date(endsAt.getTime() + type.buffer_minutes * minute), input.timeZone, host],
    );
    await client.query('UPDATE calendar_booking_types SET last_host_id = $2 WHERE id = $1', [type.id, host]);
    await appointmentEvent(client, row, 'rescheduled');
    return toAppointment(row);
  });
}

export async function setStatus(client: Sql, row: AppointmentRow, status: Exclude<Appointment['status'], 'booked'>, actorId?: string) {
  if (row.status === status) return row;
  if (row.status !== 'booked') throw new AppError(409, 'Only a booked appointment can be updated.');
  if (status !== 'cancelled' && row.starts_at.getTime() > Date.now()) throw new AppError(409, 'Wait until the appointment has started.');
  const { rows: [updated] } = await client.query<AppointmentRow>(
    'UPDATE calendar_appointments SET status = $2, revision = revision + 1 WHERE id = $1 RETURNING *', [row.id, status]);
  await appointmentEvent(client, updated, status, actorId);
  return updated;
}

export async function runAppointmentMail(data: { id: string; revision: number; kind: 'confirmed' | 'reminder' | 'rescheduled' | 'cancelled' }) {
  const { rows: [row] } = await db.query<AppointmentRow>('SELECT * FROM calendar_appointments WHERE id = $1 AND revision = $2', [data.id, data.revision]);
  if (!row || (data.kind === 'reminder' && row.starts_at.getTime() <= Date.now())) return;
  const { sendEmail } = await import('../mailer');
  const { textToHtml } = await import('../crm/people');
  const label = data.kind === 'reminder' ? 'Reminder' : `Appointment ${data.kind}`;
  const text = `${label}: ${row.title}\n\n${startLabel(row)} (${row.time_zone})\n\nManage your booking: ${manageUrl(row)}`;
  await sendEmail({
    to: row.guest_email, subject: `${label}: ${row.title}`, text, html: textToHtml(text), category: 'transactional',
    source: `calendar:${row.id}`, contactId: Number(row.contact_id), idempotencyKey: `calendar:${row.id}:${row.revision}:${data.kind}`,
  });
}
