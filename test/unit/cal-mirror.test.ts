import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
process.env.OVELIO_EMBEDDED_DB = 'true';
process.env.APP_ORIGIN = 'http://localhost:3206';
process.env.GOOGLE_CLIENT_ID = 'synthetic-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'synthetic-google-secret';
process.env.MICROSOFT_CLIENT_ID = 'synthetic-microsoft-client';
process.env.MICROSOFT_CLIENT_SECRET = 'synthetic-microsoft-secret';
process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString('base64');
delete process.env.DATABASE_URL;
const { db } = await import('../../src/server/db');
const { devPreviewTeam } = await import('../../src/server/dev-preview');
const { encryptToken } = await import('../../src/server/crm/mailboxes');
const { book, changeBooking, publicBooking } = await import('../../src/server/calendar/booking');
const { APPOINTMENT_MIRROR } = await import('../../src/server/calendar/mirror');
const { runPlatformJob } = await import('../../src/server/platform/jobs');
const [owner] = devPreviewTeam();
after(() => db.close());

const title = 'Private booking-type title';
const guest = (startsAt: string) => ({
  startsAt, timeZone: 'UTC', requestId: randomUUID(), email: 'guest@example.test', firstName: 'Guest association',
});
type Copy = { id: string; marker: string; start: string; end: string; attendees: unknown[] };
const graphProperty = 'String {06d33fb5-f86d-4854-89bd-5e3a16139e62} Name OvelioAppointmentMirror';

test('CAL-10 busy appointment copies reconcile both providers and survive a lost create response', async t => {
  const windows = Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00' }));
  await db.query("INSERT INTO calendar_hosts (user_id, weekly_windows) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET weekly_windows = EXCLUDED.weekly_windows",
    [owner.id, JSON.stringify(windows)]);
  const slug = 'mirror-fixture';
  const { rows: [type] } = await db.query<{ id: string }>(
    'INSERT INTO calendar_booking_types (owner_id, slug, name, duration_minutes) VALUES ($1,$2,$3,30) RETURNING id', [owner.id, slug, title]);
  await db.query('INSERT INTO calendar_type_hosts (booking_type_id, host_id) VALUES ($1,$2)', [type.id, owner.id]);
  const { slots } = await publicBooking(slug);
  const google = new Map<string, Copy>();
  const microsoft = new Map<string, Copy>();
  const writes: { method: string; provider: string; body: string }[] = [];
  const lostResponses = new Set(['google', 'microsoft']);
  t.mock.method(globalThis, 'fetch', async (raw: string, init: RequestInit) => {
    const url = new URL(raw);
    const method = init.method ?? 'GET';
    const isGoogle = url.hostname === 'www.googleapis.com';
    const copies = isGoogle ? google : microsoft;
    const provider = isGoogle ? 'google' : 'microsoft';
    if (url.pathname.endsWith('/freeBusy')) {
      return Response.json({ calendars: { primary: { busy: [...google.values()].map(copy => ({ start: copy.start, end: copy.end })) } } });
    }
    if (url.pathname.endsWith('/getSchedule')) {
      return Response.json({ value: [{ scheduleId: 'calendar@example.test', scheduleItems: [...microsoft.values()].map(copy => ({
        status: 'busy', start: { dateTime: copy.start.slice(0, -1), timeZone: 'UTC' }, end: { dateTime: copy.end.slice(0, -1), timeZone: 'UTC' },
      })) }] });
    }
    const path = url.pathname.split('/');
    const id = decodeURIComponent(path.at(-1)!);
    const input = init.body ? JSON.parse(init.body as string) : null;
    if (method === 'GET' && id === 'events') {
      const marker = url.searchParams.get('$filter')?.match(/ep\/value eq '([^']+)'/)?.[1];
      assert.ok(marker);
      return Response.json({ value: [...copies.values()].filter(copy => copy.marker === marker).map(copy => ({ id: copy.id })) });
    }
    let copy = copies.get(id);
    if (method === 'GET') {
      if (!copy) return new Response(null, { status: 404 });
      return Response.json(isGoogle ? {
        id: copy.id, etag: '"calendar-fixture"', attendees: copy.attendees, extendedProperties: { private: { ovelioMirror: copy.marker } },
      } : {
        id: copy.id, '@odata.etag': 'W/"calendar-fixture"', attendees: copy.attendees,
        singleValueExtendedProperties: [{ id: graphProperty, value: copy.marker }],
      });
    }
    writes.push({ method, provider, body: JSON.stringify(input) });
    if (isGoogle) assert.equal(url.searchParams.get('sendUpdates'), 'none');
    else assert.equal(new Headers(init.headers).get('prefer'), 'IdType="ImmutableId"');
    if (method !== 'POST') assert.match(new Headers(init.headers).get('if-match') || '', /calendar-fixture/);
    if (method === 'DELETE') {
      copies.delete(id);
      return new Response(null, { status: 204 });
    }
    const asIso = (value: string) => value.endsWith('Z') ? value : value + 'Z';
    if (method === 'PATCH') {
      assert.ok(copy);
      copy.start = asIso(input.start.dateTime);
      copy.end = asIso(input.end.dateTime);
      return Response.json({ id });
    }
    assert.equal(method, 'POST');
    const marker = isGoogle ? input.extendedProperties.private.ovelioMirror : input.transactionId;
    assert.equal(isGoogle ? input.transparency : input.showAs, isGoogle ? 'opaque' : 'busy');
    assert.equal(isGoogle ? input.visibility : input.sensitivity, 'private');
    assert.equal(isGoogle ? input.summary : input.subject, 'OVELIO appointment');
    assert.equal(input.attendees, undefined);
    if (isGoogle) assert.equal(input.id, 'ov' + marker.replaceAll('-', ''));
    else assert.deepEqual(input.singleValueExtendedProperties, [{ id: graphProperty, value: marker }]);
    copy = { id: isGoogle ? input.id : 'graph-' + marker, marker, start: asIso(input.start.dateTime),
      end: asIso(input.end.dateTime), attendees: [] };
    assert.equal(copies.has(copy.id), false);
    copies.set(copy.id, copy);
    if (lostResponses.delete(provider)) {
      throw new Error('Synthetic dropped response after successful creation');
    }
    return Response.json({ id: copy.id }, { status: 201 });
  });
  const access = encryptToken('synthetic-access');
  await db.query(`INSERT INTO calendar_connections (user_id, provider, calendar_ref, access_token_enc, refresh_token_enc, access_expires_at)
    VALUES ($1,'google','primary',$2,$2,now()+interval '1 hour'),
           ($1,'microsoft','calendar@example.test',$2,$2,now()+interval '1 hour')`, [owner.id, access]);

  const run = async (appointmentId: string) => {
    const { rows: [job] } = await db.query<{ payload: { handler: string; data: unknown } }>(
      'SELECT payload FROM jobs WHERE dedupe_key = $1', ['platform:' + APPOINTMENT_MIRROR + ':' + appointmentId]);
    assert.ok(job);
    await runPlatformJob(job.payload);
  };
  const readOnly = await book(slug, guest(slots[0]), process.env.APP_ORIGIN!);
  assert.equal((await db.query('SELECT 1 FROM jobs WHERE dedupe_key = $1', ['platform:' + APPOINTMENT_MIRROR + ':' + readOnly.id])).rowCount, 0);
  assert.equal(writes.length, 0);
  await db.query("UPDATE calendar_connections SET mirror_target = 'fixture-' || provider WHERE user_id = $1", [owner.id]);

  const booked = await book(slug, guest(slots[8]), process.env.APP_ORIGIN!);
  const token = booked.manageUrl.split('/').at(-1)!;
  await assert.rejects(run(booked.id), /Synthetic dropped response/);
  await run(booked.id);
  await run(booked.id);
  assert.equal(writes.filter(write => write.method === 'POST').length, 2);
  assert.equal(google.size, 1);
  assert.equal(microsoft.size, 1);
  assert.ok(writes.every(write => !write.body.includes(title) && !write.body.includes('@example.test') && !write.body.includes('Guest association')));
  await assert.rejects(changeBooking(token, { action: 'reschedule', startsAt: slots[9], timeZone: 'UTC' }), /no longer available/);

  const copy = [...microsoft.values()][0];
  copy.attendees.push({ fixture: 'manual recipient' });
  await changeBooking(token, { action: 'reschedule', startsAt: slots[15], timeZone: 'UTC' });
  await assert.rejects(run(booked.id), /modified Microsoft Calendar appointment copy/);
  assert.equal(copy.start, slots[8]);
  copy.attendees.length = 0;
  await run(booked.id);
  assert.equal(copy.start, slots[15]);
  assert.equal([...google.values()][0].start, slots[15]);

  await changeBooking(token, { action: 'cancel' });
  await run(booked.id);
  assert.equal(google.size + microsoft.size, 0);
  assert.equal((await db.query('SELECT 1 FROM calendar_event_mirrors WHERE appointment_id = $1', [booked.id])).rowCount, 0);

  const stop = await book(slug, guest(slots[20]), process.env.APP_ORIGIN!);
  const beforeStop = writes.length;
  await db.query('UPDATE calendar_connections SET mirror_target = NULL WHERE user_id = $1', [owner.id]);
  await run(stop.id);
  assert.equal(writes.length, beforeStop, 'queued jobs verify current write consent before calling either provider');
});
