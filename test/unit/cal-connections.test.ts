import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { User } from '../../src/contracts';
import type { CalendarConnection } from '../../src/contracts/calendar';

process.env.OVELIO_DEV_PREVIEW = 'true';
process.env.OVELIO_EMBEDDED_DB = 'true';
process.env.APP_ORIGIN = 'http://localhost:3206';
process.env.GOOGLE_CLIENT_ID = 'synthetic-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'synthetic-google-secret';
process.env.MICROSOFT_CLIENT_ID = 'synthetic-microsoft-client';
process.env.MICROSOFT_CLIENT_SECRET = 'synthetic-microsoft-secret';
process.env.MICROSOFT_TENANT_ID = 'common';
process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 18).toString('base64');
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { devPreviewTeam } = await import('../../src/server/dev-preview');
const { calendarModule } = await import('../../src/server/calendar/module');
const { book, changeBooking, manageBooking, publicBooking } = await import('../../src/server/calendar/booking');
const { decryptToken, encryptToken } = await import('../../src/server/crm/mailboxes');
const [owner, teammate] = devPreviewTeam();

after(() => db.close());

async function session(user: User) {
  const value = randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,now() + interval '1 hour')",
    [createHash('sha256').update(value).digest('hex'), user.id]);
  return `ovelio_session=${value}`;
}

async function consoleEndpoint<T>(user: User, method: string, path: string, options: { cookie?: string; body?: object; search?: string } = {}) {
  const route = calendarModule.endpoints.find(entry => entry.method === method && entry.path.test(path));
  assert.ok(route);
  const request = new Request(`${process.env.APP_ORIGIN}/api/console/${path}${options.search ?? ''}`, {
    method,
    headers: { ...(options.cookie ? { Cookie: options.cookie } : {}), 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return await route.handler({ request, user, params: route.path.exec(path)!.slice(1), query: new URL(request.url).searchParams }) as T;
}

const connectionPath = 'calendar/connections';
const availability = { timeZone: 'UTC', windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00' })) };

test('CAL-07 only the initiating login can complete a calendar connection and disconnect remains owner-scoped', async t => {
  const cookie = await session(teammate);
  const otherCookie = await session(teammate);
  const adminCookie = await session(owner);
  const mock = t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = request.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.ok(body.get('code_verifier'));
      return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 });
    }
    if (url === 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token') {
      const body = request.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.ok(body.get('code_verifier'));
      return Response.json({ access_token: 'graph-access', refresh_token: 'graph-refresh', expires_in: 3600 });
    }
    if (url === 'https://graph.microsoft.com/v1.0/me/calendar?$select=owner') {
      return Response.json({ owner: { address: 'team@example.test' } });
    }
    if (url === 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule') {
      assert.deepEqual(JSON.parse(request.body as string).schedules, ['team@example.test']);
      return Response.json({ value: [{ scheduleId: 'team@example.test', scheduleItems: [] }] });
    }
    assert.equal(url, 'https://www.googleapis.com/calendar/v3/freeBusy');
    return Response.json({ calendars: { primary: { busy: [] } } });
  });
  await assert.rejects(consoleEndpoint(teammate, 'POST', connectionPath + '/google', { cookie }), /unavailable/);
  delete process.env.OVELIO_DEV_PREVIEW;
  try {
    const microsoft = new URL((await consoleEndpoint<{ url: string }>(teammate, 'POST', connectionPath + '/microsoft', { cookie })).url);
    assert.equal(microsoft.pathname, '/organizations/oauth2/v2.0/authorize');
    assert.equal(microsoft.searchParams.get('scope'), 'offline_access https://graph.microsoft.com/Calendars.ReadBasic');

    const start = await consoleEndpoint<{ url: string }>(teammate, 'POST', connectionPath + '/google', { cookie });
    const authorize = new URL(start.url);
    const state = authorize.searchParams.get('state')!;
    assert.equal(authorize.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.freebusy');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('redirect_uri'), process.env.APP_ORIGIN + '/api/console/calendar/connections/google/callback');
    const search = `?code=synthetic-authorization&state=${state}`;
    const finish = async (user: User, login: string) => {
      const response = await consoleEndpoint<Response>(user, 'GET', connectionPath + '/google/callback', { cookie: login, search });
      return new URL(response.headers.get('location')!).searchParams.get('calendarConnection');
    };
    assert.equal(await finish(teammate, otherCookie), 'failed');
    assert.equal(await finish(owner, adminCookie), 'failed');
    assert.equal(mock.mock.callCount(), 0);
    assert.equal(await finish(teammate, cookie), 'connected');
    assert.equal(await finish(teammate, cookie), 'failed');
    assert.equal(mock.mock.callCount(), 2);
    const msResponse = await consoleEndpoint<Response>(teammate, 'GET', connectionPath + '/microsoft/callback', {
      cookie, search: '?code=synthetic-graph&state=' + microsoft.searchParams.get('state'),
    });
    assert.equal(new URL(msResponse.headers.get('location')!).searchParams.get('calendarConnection'), 'connected');
    assert.equal(mock.mock.callCount(), 5);
    const stored = (await db.query<{ access_token_enc: string }>(
      "SELECT access_token_enc FROM calendar_connections WHERE user_id = $1 AND provider = 'google'", [teammate.id])).rows[0];
    assert.notEqual(stored.access_token_enc, 'fixture-access');
    assert.equal(decryptToken(stored.access_token_enc), 'fixture-access');

    await consoleEndpoint(owner, 'DELETE', connectionPath + '/google', { cookie: adminCookie });
    const ownConnections = await consoleEndpoint<CalendarConnection[]>(teammate, 'GET', connectionPath);
    const adminConnections = await consoleEndpoint<CalendarConnection[]>(owner, 'GET', connectionPath);
    assert.equal(ownConnections.find(connection => connection.provider === 'google')?.status, 'connected');
    assert.equal(adminConnections.find(connection => connection.provider === 'google')?.status, 'disconnected');
    assert.ok(!JSON.stringify(ownConnections).includes('fixture-access'));
    await consoleEndpoint(teammate, 'DELETE', connectionPath + '/google', { cookie });
    await consoleEndpoint(teammate, 'DELETE', connectionPath + '/microsoft', { cookie });
    assert.equal((await db.query('SELECT 1 FROM calendar_connections')).rowCount, 0);
  } finally {
    process.env.OVELIO_DEV_PREVIEW = 'true';
  }
});

test('CAL-08 live provider availability protects listing, reservation and rescheduling within local contention rules', async t => {
  await consoleEndpoint(owner, 'PATCH', 'calendar/availability', { body: availability });
  const slug = 'provider-availability';
  await consoleEndpoint(owner, 'POST', 'calendar/types', { body: {
    name: 'Provider availability', slug, hostIds: [owner.id], durationMinutes: 30, bufferMinutes: 15, active: true,
  } });
  const { slots: initial } = await publicBooking(slug);
  const [googleSlot, microsoftSlot, openSlot, changedSlot] = [initial[0], initial[5], initial[10], initial[15]];
  const calendarEmail = 'owner@example.test';
  await db.query(
    `INSERT INTO calendar_connections (user_id, provider, calendar_ref, access_token_enc, refresh_token_enc, access_expires_at)
      VALUES ($1, 'google', 'primary', $2, $3, now() + interval '1 hour'),
      ($1, 'microsoft', $4, $2, $3, now() - interval '5 minutes')`,
    [owner.id, encryptToken('cached-access'), encryptToken('stored-refresh'), calendarEmail]);
  let googleFails = false;
  let changeRevision = false;
  const mock = t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    const hour = 3600_000;
    if (url.endsWith('/oauth2/v2.0/token')) {
      assert.equal((request.body as URLSearchParams).get('refresh_token'), 'stored-refresh');
      return Response.json({ access_token: 'graph-new-access', refresh_token: 'graph-new-refresh', expires_in: 3600 });
    }
    if (url.endsWith('/freeBusy')) {
      if (googleFails) return Response.json({ calendars: { primary: { errors: [{ reason: 'internalError' }] } } });
      if (changeRevision) {
        changeRevision = false;
        await db.query("UPDATE calendar_connections SET revision = gen_random_uuid() WHERE provider = 'google' AND user_id = $1", [owner.id]);
      }
      // The event overlaps only the requested appointment's buffer.
      const start = new Date(Date.parse(googleSlot) + 30 * 60_000).toISOString();
      const end = new Date(Date.parse(googleSlot) + hour).toISOString();
      return Response.json({ calendars: { primary: { busy: [{ start, end }] } } });
    }
    assert.equal(url, 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule');
    assert.equal(new Headers(request.headers).get('authorization'), 'Bearer graph-new-access');
    assert.deepEqual(JSON.parse(request.body as string).schedules, [calendarEmail]);
    const toGraph = (date: Date) => ({ dateTime: date.toISOString().slice(0, -1), timeZone: 'UTC' });
    return Response.json({ value: [{ scheduleId: calendarEmail, scheduleItems: [{
      status: 'tentative', subject: 'Private provider title', start: toGraph(new Date(microsoftSlot)),
      end: toGraph(new Date(Date.parse(microsoftSlot) + 45 * 60_000)),
    }] }] });
  });

  const booking = await publicBooking(slug);
  assert.ok(!booking.slots.includes(googleSlot));
  assert.ok(!booking.slots.includes(microsoftSlot));
  assert.ok(booking.slots.includes(openSlot));
  assert.ok(!JSON.stringify(booking).includes('Private provider title'));
  const guest = (startsAt: string) => ({ startsAt, timeZone: 'UTC', requestId: randomUUID(), email: 'guest@example.test', firstName: 'Guest' });
  await assert.rejects(book(slug, guest(googleSlot), process.env.APP_ORIGIN!), /no longer available/);
  const booked = await book(slug, guest(openSlot), process.env.APP_ORIGIN!);
  const token = booked.manageUrl.split('/').at(-1)!;
  await assert.rejects(changeBooking(token, { action: 'reschedule', startsAt: microsoftSlot, timeZone: 'UTC' }), /no longer available/);
  changeRevision = true;
  await assert.rejects(book(slug, guest(changedSlot), process.env.APP_ORIGIN!), /no longer available/);
  const rescheduled = await changeBooking(token, { action: 'reschedule', startsAt: changedSlot, timeZone: 'UTC' });
  assert.equal(rescheduled.startsAt, changedSlot);

  googleFails = true;
  assert.deepEqual((await publicBooking(slug)).slots, []);
  assert.deepEqual((await manageBooking(token)).slots, []);
  assert.equal((await changeBooking(token, { action: 'cancel' })).status, 'cancelled');
  const calls = mock.mock.calls.filter(call => String(call.arguments[0]).endsWith('/oauth2/v2.0/token'));
  assert.equal(calls.length, 1, 'persisted token refresh is reused');
  const connection = await consoleEndpoint<CalendarConnection[]>(owner, 'GET', connectionPath);
  assert.equal(connection.find(item => item.provider === 'google')?.status, 'unavailable');
});
