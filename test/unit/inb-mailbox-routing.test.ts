import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { User } from '../../src/contracts';
import type { MailboxRoutingSettings } from '../../src/contracts/mailbox-routing';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;
const { db, transaction } = await import('../../src/server/db');
const { mailboxRoutingEndpoints, routeNewMailboxThread } = await import('../../src/server/crm/mailbox-routing');
after(async () => db.close());

async function addUser(name: string, role: User['role'] = 'marketer'): Promise<User> {
  const { rows: [user] } = await db.query<User>(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
    [`${name}@example.test`, name, role, 'synthetic'],
  );
  return user;
}

test('INB-17 default routing applies once and rechecks mailbox ownership and active membership', async () => {
  const owner = await addUser('routing-owner');
  const member = await addUser('routing-member');
  const admin = await addUser('routing-admin', 'admin');
  const { rows: [mailbox] } = await db.query<{ id: string }>(
    "INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc) VALUES ($1, 'google', $2, 'synthetic') RETURNING id",
    [owner.id, 'routing-mailbox@example.test'],
  );
  const path = `mailboxes/${mailbox.id}/routing`;
  async function settings(viewer: User, assigneeId?: string | null): Promise<MailboxRoutingSettings> {
    const method = assigneeId === undefined ? 'GET' : 'PATCH';
    const entry = mailboxRoutingEndpoints.find(item => item.method === method && item.path.test(path));
    assert.ok(entry);
    assert.equal(entry.role, 'marketer');
    const request = new Request(`http://localhost/api/console/${path}`, {
      method, body: method === 'PATCH' ? JSON.stringify({ assigneeId }) : undefined,
    });
    return await entry.handler({ request, user: viewer, query: new URLSearchParams(), params: entry.path.exec(path)!.slice(1) }) as MailboxRoutingSettings;
  }
  const ingest = async (threadId: string, messageId: string, direction = 'inbound') => transaction(async client => {
    await client.query('SELECT id FROM crm_mailboxes WHERE id = $1 FOR UPDATE', [mailbox.id]);
    await client.query(`INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, direction)
      VALUES ($1, $2, $3, $4)`, [mailbox.id, messageId, threadId, direction]);
    return routeNewMailboxThread(client, mailbox.id, threadId || messageId);
  });

  await db.query('INSERT INTO crm_mailbox_members (mailbox_id, user_id) VALUES ($1, $2)', [mailbox.id, member.id]);
  assert.deepEqual(new Set((await settings(owner)).assignmentOptions.map(item => item.id)), new Set([owner.id, member.id]));
  await assert.rejects(settings(member, member.id), { status: 404 });
  await assert.rejects(settings(admin), { status: 404 });
  await assert.rejects(settings(owner, admin.id), { status: 400 });
  assert.equal(await ingest('existing', 'historical-first'), null);

  assert.equal((await settings(owner, member.id)).assigneeId, member.id);
  assert.equal(await ingest('existing', 'historical-later'), null, 'a previously ingested conversation stays unassigned');
  assert.equal(await ingest('new-thread', 'prior-outbound', 'outbound'), null);
  assert.equal(await ingest('new-thread', 'new-inbound'), member.id);
  assert.equal(await ingest('', 'standalone'), member.id, 'a legacy message uses its provider ID as the thread key');

  await db.query("UPDATE crm_mailbox_thread_team SET assignee_id = NULL WHERE mailbox_id = $1 AND thread_key = 'new-thread'", [mailbox.id]);
  assert.equal(await ingest('new-thread', 'later-inbound'), null);
  const retained = await db.query<{ assignee_id: string | null }>(
    "SELECT assignee_id FROM crm_mailbox_thread_team WHERE mailbox_id = $1 AND thread_key = 'new-thread'", [mailbox.id],
  );
  assert.equal(retained.rows[0].assignee_id, null, 'explicit unassignment is preserved');
  await db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [member.id]);
  assert.equal(await ingest('disabled-target', 'disabled-inbound'), null);
  assert.equal((await settings(owner)).assigneeId, null);
  await db.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [member.id]);
  await db.query('DELETE FROM crm_mailbox_members WHERE mailbox_id = $1 AND user_id = $2', [mailbox.id, member.id]);
  assert.equal(await ingest('revoked-target', 'revoked-inbound'), null);
  assert.equal((await settings(owner)).assigneeId, null);
  assert.equal((await settings(owner, owner.id)).assigneeId, owner.id, 'the owner can opt in as assignee');
  assert.equal((await settings(owner, null)).assigneeId, null);
  assert.equal(await ingest('unset-target', 'unset-inbound'), null);
});
