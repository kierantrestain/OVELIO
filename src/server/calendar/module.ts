import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { User } from '@/contracts';
import type { BookingType, CalendarOverview, ConsoleAppointment } from '@/contracts/calendar';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { json, readBody } from '../http';
import { route } from '../routes/shared';
import type { LaneModule } from '../platform/types';
import { availabilityInput } from './availability';
import { calendarConnectionEndpoints } from './connections';
import { APPOINTMENT_MAIL, bookingSlug, runAppointmentMail, setStatus, toAppointment } from './booking';
import type { AppointmentRow, BookingRow } from './booking';

const uuid = z.uuid();
const typeInput = z.object({
  name: z.string().trim().min(1).max(120), slug: bookingSlug,
  durationMinutes: z.number().int().min(15).max(240).multipleOf(15),
  bufferMinutes: z.number().int().min(0).max(120).multipleOf(5),
  hostIds: z.array(uuid).min(1).max(20), active: z.boolean(),
});

type BookingTypeRow = BookingRow & { host_ids: string[] };
type MeetingRow = AppointmentRow & { host_name: string };
const activeHost = "u.disabled_at IS NULL AND u.role IN ('admin', 'marketer')";
const typesSelect = `SELECT t.*, ARRAY(SELECT th.host_id FROM calendar_type_hosts th WHERE th.booking_type_id = t.id ORDER BY th.host_id) AS host_ids
  FROM calendar_booking_types t`;

function toType(row: BookingTypeRow, user: User): BookingType {
  return { id: row.id, slug: row.slug, name: row.name, durationMinutes: row.duration_minutes, bufferMinutes: row.buffer_minutes,
    hostIds: row.host_ids, active: row.active, canEdit: row.owner_id === user.id || user.role === 'admin' };
}

function toMeeting(row: MeetingRow): ConsoleAppointment {
  return { ...toAppointment(row), hostId: row.host_id, hostName: row.host_name, guestName: row.guest_name, guestEmail: row.guest_email,
    contactId: Number(row.contact_id), dealId: row.deal_id, hasStarted: row.starts_at.getTime() <= Date.now() };
}

async function overview(user: User): Promise<CalendarOverview> {
  const admin = user.role === 'admin';
  const [type, availability, meetings, hosts, feed] = await Promise.all([
    db.query<BookingTypeRow>(`${typesSelect} WHERE $2 OR t.owner_id = $1 OR
      EXISTS (SELECT 1 FROM calendar_type_hosts th WHERE th.booking_type_id = t.id AND th.host_id = $1) ORDER BY lower(t.name)`, [user.id, admin]),
    db.query<{ time_zone: string; weekly_windows: CalendarOverview['availability']['windows'] }>('SELECT * FROM calendar_hosts WHERE user_id = $1', [user.id]),
    db.query<MeetingRow>(
      `SELECT a.*, u.name AS host_name FROM calendar_appointments a JOIN users u ON u.id = a.host_id
       JOIN calendar_booking_types t ON t.id = a.booking_type_id
       WHERE ($2 OR a.host_id = $1 OR t.owner_id = $1) AND a.starts_at >= now() - interval '30 days'
       ORDER BY CASE WHEN a.starts_at >= now() THEN 0 ELSE 1 END, abs(extract(epoch FROM (a.starts_at - now()))) LIMIT 200`, [user.id, admin]),
    db.query<{ id: string; name: string }>(`SELECT u.id, u.name FROM users u WHERE ${activeHost} AND ($2 OR u.id = $1) ORDER BY u.name`, [user.id, admin]),
    db.query('SELECT 1 FROM calendar_feeds WHERE owner_id = $1', [user.id]),
  ]);
  const profile = availability.rows[0];
  return { types: type.rows.map(row => toType(row, user)), meetings: meetings.rows.map(toMeeting), hosts: hosts.rows,
    availability: profile ? { timeZone: profile.time_zone, windows: profile.weekly_windows } : { timeZone: 'UTC', windows: [] },
    canManageTeam: admin, hasFeed: Boolean(feed.rowCount) };
}

async function saveType(user: User, input: z.infer<typeof typeInput>, id?: string) {
  const admin = user.role === 'admin';
  const hostIds = [...new Set(input.hostIds.map(value => value.toLowerCase()))].sort();
  if (!admin && (hostIds.length !== 1 || hostIds[0] !== user.id)) throw new AppError(403, 'Only administrators can configure team booking types.');
  try {
    return await transaction(async client => {
      const eligible = await client.query<{ id: string }>(`SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) AND ${activeHost}`, [hostIds]);
      if (eligible.rows.length !== hostIds.length) throw new AppError(400, 'Choose active team members with sales access.');
      const fields = [input.slug, input.name, input.durationMinutes, input.bufferMinutes, input.active, user.id];
      const { rows: [type] } = id
        ? await client.query<BookingRow>(
          `UPDATE calendar_booking_types SET slug = $1, name = $2, duration_minutes = $3, buffer_minutes = $4, active = $5
           WHERE id = $7 AND ($8 OR owner_id = $6) RETURNING *`, [...fields, id, admin])
        : await client.query<BookingRow>(
          `INSERT INTO calendar_booking_types (slug, name, duration_minutes, buffer_minutes, active, owner_id)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, fields);
      if (!type) throw new AppError(404, 'That booking type was not found.');
      await client.query(`INSERT INTO calendar_hosts (user_id) SELECT unnest($1::uuid[]) ON CONFLICT DO NOTHING`, [hostIds]);
      await client.query(`DELETE FROM calendar_type_hosts WHERE booking_type_id = $1 AND NOT (host_id = ANY($2::uuid[]))`, [type.id, hostIds]);
      await client.query(`INSERT INTO calendar_type_hosts (booking_type_id, host_id)
        SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [type.id, hostIds]);
      return toType({ ...type, host_ids: hostIds }, user);
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'That public booking address is already in use.');
    throw error;
  }
}

const meetingInput = z.object({ status: z.enum(['cancelled', 'completed', 'no_show']).optional(), dealId: uuid.nullable().optional() })
  .refine(input => input.status !== undefined || input.dealId !== undefined, 'Choose what to update.');

async function updateMeeting(user: User, id: string, input: z.infer<typeof meetingInput>) {
  return transaction(async client => {
    const { rows: [current] } = await client.query<AppointmentRow>(
      `SELECT a.* FROM calendar_appointments a JOIN calendar_booking_types t ON t.id = a.booking_type_id
       WHERE a.id = $1 AND ($3 OR a.host_id = $2 OR t.owner_id = $2) FOR UPDATE OF a`, [id, user.id, user.role === 'admin']);
    if (!current) throw new AppError(404, 'That appointment was not found.');
    if (input.dealId) {
      const { rowCount } = await client.query(`SELECT 1 FROM deals d WHERE d.id = $1 AND d.archived_at IS NULL AND
        (d.contact_id = $2 OR EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.contact_id = $2))`, [input.dealId, current.contact_id]);
      if (!rowCount) throw new AppError(400, 'Choose an active deal associated with this guest.');
    }
    if (input.dealId !== undefined) {
      await client.query('UPDATE calendar_appointments SET deal_id = $2 WHERE id = $1', [id, input.dealId]);
      current.deal_id = input.dealId;
    }
    return toAppointment(input.status ? await setStatus(client, current, input.status, user.id) : current);
  });
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const icsDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');
const icsEscape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/([,;])/g, '\\$1');

// RFC 5545 measures folded lines in octets rather than characters.
function fold(line: string) {
  let content = '';
  let length = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (length + size > 75) { content += '\r\n '; length = 1; }
    content += char;
    length += size;
  }
  return content;
}

export async function calendarFeed(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new AppError(404, 'Calendar feed not found.');
  const { rows: [feed] } = await db.query<{ owner_id: string }>(
    `SELECT f.owner_id FROM calendar_feeds f JOIN users u ON u.id = f.owner_id WHERE f.token_hash = $1 AND ${activeHost}`, [hash(token)]);
  if (!feed) throw new AppError(404, 'Calendar feed not found.');
  const { rows } = await db.query<AppointmentRow>(`SELECT * FROM calendar_appointments WHERE host_id = $1
    AND starts_at >= now() - interval '90 days' AND status = 'booked' ORDER BY starts_at LIMIT 1000`, [feed.owner_id]);
  const stamp = icsDate(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OVELIO//Appointments//EN', 'CALSCALE:GREGORIAN',
    ...rows.flatMap(row => ['BEGIN:VEVENT', `UID:${row.id}@ovelio`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(row.starts_at)}`,
      `DTEND:${icsDate(row.ends_at)}`, `SUMMARY:${icsEscape(row.title)}`, `SEQUENCE:${row.revision}`, 'END:VEVENT']), 'END:VCALENDAR'];
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export const calendarModule: LaneModule = {
  name: 'calendar',
  endpoints: [
    ...calendarConnectionEndpoints,
    route('GET', /^calendar$/, async ({ user }) => overview(user), 'marketer'),
    route('PATCH', /^calendar\/availability$/, async ({ request, user }) => {
      const input = await readBody(request, availabilityInput, 16_384);
      await db.query(`INSERT INTO calendar_hosts (user_id, time_zone, weekly_windows) VALUES ($1,$2,$3)
        ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone, weekly_windows = EXCLUDED.weekly_windows`,
      [user.id, input.timeZone, JSON.stringify(input.windows)]);
      return input;
    }, 'marketer'),
    route('POST', /^calendar\/types$/, async ({ request, user }) => json(await saveType(user, await readBody(request, typeInput)), 201), 'marketer'),
    route('PATCH', /^calendar\/types\/([a-f0-9-]{36})$/, async ({ request, params, user }) =>
      saveType(user, await readBody(request, typeInput), uuid.parse(params[0])), 'marketer'),
    route('PATCH', /^calendar\/appointments\/([a-f0-9-]{36})$/, async ({ request, params, user }) =>
      updateMeeting(user, uuid.parse(params[0]), await readBody(request, meetingInput)), 'marketer'),
    route('POST', /^calendar\/feed$/, async ({ user }) => {
      const token = randomBytes(24).toString('base64url');
      await db.query(`INSERT INTO calendar_feeds (owner_id, token_hash) VALUES ($1,$2)
        ON CONFLICT (owner_id) DO UPDATE SET token_hash = EXCLUDED.token_hash`, [user.id, hash(token)]);
      return { path: '/api/public/booking/feed/' + token };
    }, 'marketer'),
    route('DELETE', /^calendar\/feed$/, async ({ user }) => {
      await db.query('DELETE FROM calendar_feeds WHERE owner_id = $1', [user.id]);
      return new Response(null, { status: 204 });
    }, 'marketer'),
  ],
  jobHandlers: { [APPOINTMENT_MAIL]: runAppointmentMail },
  async onPlatformEvent() {},
  async search(query, user) {
    if (user.role === 'analyst') return [];
    const { rows } = await db.query<{ id: string; title: string; starts_at: Date }>(
      `SELECT a.id, a.title, a.starts_at FROM calendar_appointments a JOIN calendar_booking_types t ON t.id = a.booking_type_id
       WHERE a.status = 'booked' AND a.starts_at >= now() AND ($3 OR a.host_id = $2 OR t.owner_id = $2)
        AND strpos(lower(concat_ws(' ', a.title, a.guest_name)), lower($1)) > 0 ORDER BY a.starts_at LIMIT 5`, [query, user.id, user.role === 'admin']);
    return rows.map(row => ({ kind: 'appointment', id: 'appointment:' + row.id, title: row.title,
      subtitle: row.starts_at.toISOString().slice(0, 10), href: '/sales/calendar#meeting-' + row.id }));
  },
  async seedPreview() {},
};
