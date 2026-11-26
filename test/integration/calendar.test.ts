import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { apiClient, testEnv } from './client';

test('CAL-05 PostgreSQL serializes overlapping public bookings across booking types', async t => {
  const env = testEnv();
  const admin = await apiClient(env);
  const current = await admin.get<{ availability: object }>('/calendar');
  const actor = await fetch(env.origin + '/api/auth/login', {
    method: 'POST', headers: { origin: env.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.email, password: env.password }),
  });
  assert.equal(actor.status, 200);
  const { id: hostId } = await actor.json() as { id: string };
  t.after(() => admin.get('/calendar/availability', 'PATCH', current.availability).then(() => undefined));
  await admin.get('/calendar/availability', 'PATCH', { timeZone: 'UTC',
    windows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, start: '08:00', end: '18:00' })) });
  const suffix = randomUUID().slice(0, 8);
  const create = (name: string) => admin.get<{ id: string; slug: string }>('/calendar/types', 'POST', {
    name, slug: name, durationMinutes: 30, bufferMinutes: 15, hostIds: [hostId], active: true,
  });
  const [a, b] = await Promise.all([create(`calendar-a-${suffix}`), create(`calendar-b-${suffix}`)]);
  const endpoint = (slug: string) => env.origin + '/api/public/booking/' + slug;
  const options = await fetch(endpoint(a.slug));
  assert.equal(options.status, 200);
  const [startsAt] = (await options.json() as { slots: string[] }).slots;
  assert.ok(startsAt);
  const submit = (slug: string, label: string) => fetch(endpoint(slug), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      startsAt, timeZone: 'UTC', requestId: randomUUID(), email: `calendar-${label}-${suffix}@example.test`, firstName: 'Calendar test',
    }),
  });
  const responses = await Promise.all([submit(a.slug, 'a'), submit(b.slug, 'b')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const winner = await responses.find(response => response.status === 201)!.json() as { manageUrl: string };
  const cancelUrl = env.origin + '/api/public/booking/manage/' + winner.manageUrl.split('/').pop();
  const canceled = await fetch(cancelUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
  });
  assert.equal(canceled.status, 200);
  assert.equal((await canceled.json()).status, 'cancelled');
});
