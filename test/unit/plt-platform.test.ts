import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.OVELIO_EMBEDDED_DB = 'true';
delete process.env.DATABASE_URL;

const { db, transaction } = await import('../../src/server/db');
const { emitEvent, listEvents } = await import('../../src/server/events');
const { drainPlatformJobs, schedulePlatformJob } = await import('../../src/server/platform/jobs');

before(async () => { await db.query('SELECT 1'); });
after(async () => { await db.close(); });

test('PLT-20 embedded database applies every migration', async () => {
  const applied = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  const names = applied.rows.map(row => row.name);
  assert.ok(names.includes('001_core.sql'));
  assert.ok(names.includes('007_platform_spine.sql'));
  const types = await db.query<{ a: string; d: string }>(`SELECT 9007199254740993::bigint AS a, DATE '2026-11-25' AS d`);
  assert.equal(types.rows[0].a, '9007199254740993', 'bigint stays a string like node-pg');
  assert.equal(types.rows[0].d, '2026-11-25', 'dates stay calendar strings');
});

test('PLT-21 transactions roll back and nested queries join the open transaction', async () => {
  await assert.rejects(transaction(async client => {
    await client.query(`INSERT INTO settings (key, value) VALUES ('plt21', '1')`);
    const inside = await db.query(`SELECT 1 FROM settings WHERE key = 'plt21'`);
    assert.equal(inside.rows.length, 1, 'db.query inside the transaction sees its writes instead of deadlocking');
    throw new Error('stop');
  }), /stop/);
  const outside = await db.query(`SELECT 1 FROM settings WHERE key = 'plt21'`);
  assert.equal(outside.rows.length, 0);
});

test('PLT-22 emitEvent is idempotent and dispatches to every lane', async () => {
  const first = await emitEvent({ type: 'form.submitted', contactId: 42, entityType: 'form', entityId: 'f1', utm: { campaign: 'spring' }, idempotencyKey: 'plt22' });
  const repeat = await emitEvent({ type: 'form.submitted', contactId: 42, idempotencyKey: 'plt22' });
  assert.ok(first);
  assert.equal(repeat, null);
  const events = await listEvents({ contactId: 42 });
  assert.equal(events.length, 1);
  assert.equal(events[0].utm.campaign, 'spring');
  const ran = await drainPlatformJobs({ maxJobs: 50 });
  assert.ok(ran >= 6, 'one dispatch plus one delivery per lane');
  const pending = await db.query(`SELECT 1 FROM jobs WHERE kind = 'platform' AND status <> 'done'`);
  assert.equal(pending.rows.length, 0);
});

test('PLT-23 delayed platform jobs wait for their run time', async () => {
  await schedulePlatformJob('event.dispatch', 'later', { eventId: '0' }, { runAt: new Date(Date.now() + 60_000) });
  assert.equal(await drainPlatformJobs(), 0);
  const row = await db.query<{ status: string }>(`SELECT status FROM jobs WHERE dedupe_key = 'platform:event.dispatch:later'`);
  assert.equal(row.rows[0].status, 'pending');
});
