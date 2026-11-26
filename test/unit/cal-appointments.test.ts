import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { User } from '../../src/contracts';
import type { CalendarOverview, BookingType } from '../../src/contracts/calendar';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;
const { devPreviewTeam } = await import('../../src/server/dev-preview');
const { db } = await import('../../src/server/db');
const { hostSchedule } = await import('../../src/server/calendar/availability');
const { calendarFeed, calendarModule } = await import('../../src/server/calendar/module');
const { book, changeBooking, manageBooking, publicBooking } = await import('../../src/server/calendar/booking');
const { listEvents } = await import('../../src/server/events');
const { findContactByEmail } = await import('../../src/server/directory');

const [owner, teammate] = devPreviewTeam();
const hours = { timeZone: 'UTC', windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00' })) };
const origin = 'http://localhost:3206';

after(() => db.close());

async function consoleEndpoint<T>(user: User, method: string, path: string, data?: object) {
  const route = calendarModule.endpoints.find(entry => entry.method === method && entry.path.test(path));
  assert.ok(route);
  const request = new Request(`${origin}/api/console/${path}`, { method, body: data ? JSON.stringify(data) : undefined });
  const result = await route.handler({ request, user, params: route.path.exec(path)!.slice(1), query: new URLSearchParams() });
  return (result instanceof Response && result.status !== 204 ? await result.json() : result) as T;
}

const bookingType = (slug: string, hostIds: string[]) => consoleEndpoint<BookingType>(owner, 'POST', 'calendar/types', {
  name: slug, slug, hostIds, durationMinutes: 30, bufferMinutes: 15, active: true,
});
const guest = (startsAt: string, label: string) => ({
  startsAt, timeZone: 'Europe/London', requestId: randomUUID(), email: `${label}@example.test`, firstName: 'Booking', lastName: 'Test',
});
const tokenOf = (url: string) => url.split('/').pop()!;

test('CAL-01 DST gaps produce no slots and durations respect buffers', () => {
  const springGap = hostSchedule({ timeZone: 'America/New_York', windows: [{ weekday: 0, start: '02:00', end: '03:00' }] }, [], 15, 0);
  assert.equal(springGap(Date.parse('2026-03-08T06:45:00Z')), false);
  assert.equal(springGap(Date.parse('2026-03-08T07:00:00Z')), false);
  assert.equal(springGap(Date.parse('2026-03-15T06:00:00Z')), true);
  const afternoon = Date.parse('2026-11-26T14:00:00Z');
  const fits = hostSchedule(hours, [{ startsAt: afternoon, blockedUntil: afternoon + 45 * 60_000 }], 30, 15);
  assert.equal(fits(afternoon - 30 * 60_000), false);
  assert.equal(fits(afternoon + 45 * 60_000), true);
});

test('CAL-02 concurrent booking types sharing a host reserve only one overlapping slot', async () => {
  await consoleEndpoint(owner, 'PATCH', 'calendar/availability', hours);
  const [a, b] = await Promise.all([bookingType('cal-overlap-a', [owner.id]), bookingType('cal-overlap-b', [owner.id])]);
  const [slot] = (await publicBooking(a.slug)).slots;
  const results = await Promise.allSettled([book(a.slug, guest(slot, 'cal-overlap-a'), origin), book(b.slug, guest(slot, 'cal-overlap-b'), origin)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find(item => item.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' && (rejected.reason as { status: number }).status, 409);
  const overview = await consoleEndpoint<CalendarOverview>(owner, 'GET', 'calendar');
  assert.equal(overview.meetings.filter(item => item.startsAt === slot).length, 1);
});

test('CAL-03 team bookings rotate hosts, retries are idempotent and public management preserves CRM links', async () => {
  await consoleEndpoint(teammate, 'PATCH', 'calendar/availability', hours);
  await assert.rejects(consoleEndpoint(teammate, 'POST', 'calendar/types', {
    name: 'Restricted', slug: 'cal-restricted', hostIds: [owner.id, teammate.id], durationMinutes: 30, bufferMinutes: 0, active: true,
  }), /Only administrators/);
  const team = await bookingType('cal-round-robin', [owner.id, teammate.id]);
  const { slots } = await publicBooking(team.slug);
  const startsAt = slots[Math.floor(slots.length / 3)];
  const submission = guest(startsAt, 'cal-team-one');
  const first = await book(team.slug, submission, origin);
  const second = await book(team.slug, guest(startsAt, 'cal-team-two'), origin);
  assert.equal((await book(team.slug, submission, origin)).id, first.id);
  const overview = await consoleEndpoint<CalendarOverview>(owner, 'GET', 'calendar');
  assert.notEqual(overview.meetings.find(item => item.id === first.id)?.hostId, overview.meetings.find(item => item.id === second.id)?.hostId);
  const token = tokenOf(first.manageUrl);
  await assert.rejects(manageBooking(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), /unavailable/);
  const rescheduled = await changeBooking(token, { action: 'reschedule', startsAt: slots.at(-1)!, timeZone: 'Europe/Paris' });
  assert.equal(rescheduled.timeZone, 'Europe/Paris');
  assert.equal((await changeBooking(token, { action: 'cancel' })).status, 'cancelled');
  const contact = await findContactByEmail(submission.email);
  assert.ok(contact);
  assert.notEqual(contact.consent, 'opted_in');
  const events = await listEvents({ contactId: contact.id, entityId: first.id });
  assert.deepEqual(events.map(event => event.type).sort(), ['appointment.booked', 'appointment.cancelled', 'appointment.rescheduled']);
});

test('CAL-04 calendar subscriptions are host-scoped and can be revoked', async () => {
  const { path } = await consoleEndpoint<{ path: string }>(owner, 'POST', 'calendar/feed');
  const token = tokenOf(path);
  const result = await calendarFeed(token);
  assert.equal(result.headers.get('content-type'), 'text/calendar; charset=utf-8');
  const body = await result.text();
  assert.match(body, /BEGIN:VCALENDAR\r\n/);
  assert.match(body, /BEGIN:VEVENT\r\n/);
  assert.ok(!body.includes('@example.test'));
  await consoleEndpoint(owner, 'DELETE', 'calendar/feed');
  await assert.rejects(calendarFeed(token), /not found/);
});
