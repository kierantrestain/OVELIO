import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { User } from '../../src/contracts';
import type { InboxTeam, InboxTeamNote, SavedReply } from '../../src/contracts/mailbox-team';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;
const { db } = await import('../../src/server/db');
const { inboxTeamEndpoints } = await import('../../src/server/crm/mailbox-team');

after(async () => db.close());

type Role = User['role'];
async function actor(handle: string, role: Role = 'marketer'): Promise<User> {
  const email = `${handle}@example.test`;
  const { rows: [user] } = await db.query<User>(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
    [email, handle, role, 'synthetic'],
  );
  return user;
}

async function mailbox(owner: User, reference: string, legacy = false) {
  const { rows: [item] } = await db.query<{ id: string }>(
    "INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc) VALUES ($1, 'google', $2, 'synthetic') RETURNING id",
    [owner.id, `${reference}@example.test`],
  );
  const threadId = 'shared-thread-id';
  const providerId = legacy ? threadId : 'provider-message-1';
  await db.query(`INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, direction, subject)
    VALUES ($1, $2, $3, 'inbound', 'Synthetic conversation')`, [item.id, providerId, legacy ? '' : threadId]);
  return { id: item.id, threadId, query: new URLSearchParams({ mailboxId: item.id, threadId }).toString() };
}

async function call<T>(user: User, method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(`http://localhost/api/console/${path}`);
  const relative = url.pathname.slice('/api/console/'.length);
  const endpoint = inboxTeamEndpoints.find(route => route.method === method && route.path.test(relative));
  assert.ok(endpoint, `${method} ${relative} is routed`);
  assert.equal(endpoint.role, 'marketer');
  const request = new Request(url, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await endpoint.handler({ request, user, params: endpoint.path.exec(relative)!.slice(1), query: url.searchParams });
  if (result instanceof Response) return (result.status === 204 ? undefined : await result.json()) as T;
  return result as T;
}

test('INB-14 assignments and status changes follow explicit thread membership and current assignment', async () => {
  const owner = await actor('thread-owner');
  const member = await actor('assigned-member');
  const reporter = await actor('additional-member');
  const outsider = await actor('workspace-admin', 'admin');
  const conversation = await mailbox(owner, 'shared-mailbox');
  await db.query('INSERT INTO crm_mailbox_members (mailbox_id, user_id) VALUES ($1, $2), ($1, $3)', [conversation.id, member.id, reporter.id]);
  const path = 'sales/inbox/team?' + conversation.query;
  const initial = await call<InboxTeam>(owner, 'GET', path);
  assert.equal(initial.status, 'open');
  assert.equal(initial.assignee, null);
  assert.equal(initial.canAssign, true);
  assert.deepEqual(new Set(initial.assignmentOptions.map(option => option.id)), new Set([owner.id, member.id, reporter.id]));
  await assert.rejects(call(outsider, 'GET', path), { status: 404 });
  await assert.rejects(call(outsider, 'PATCH', path, { status: 'resolved' }), { status: 404 });
  await assert.rejects(call(member, 'PATCH', path, { status: 'pending' }), { status: 403 });
  await assert.rejects(call(member, 'PATCH', path, { assigneeId: member.id }), { status: 403 });
  await assert.rejects(call(owner, 'PATCH', path, { assigneeId: outsider.id }), { status: 400 });
  const assigned = await call<InboxTeam>(owner, 'PATCH', path, { assigneeId: member.id });
  assert.deepEqual(assigned.assignee, { id: member.id, name: member.name });
  assert.equal(assigned.status, 'open');
  assert.equal((await call<InboxTeam>(member, 'GET', path)).canChangeStatus, true);
  assert.equal((await call<InboxTeam>(reporter, 'GET', path)).canChangeStatus, false);
  const resolved = await call<InboxTeam>(member, 'PATCH', path, { status: 'resolved' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.assignee?.id, member.id);

  await db.query('DELETE FROM crm_mailbox_members WHERE mailbox_id = $1 AND user_id = $2', [conversation.id, member.id]);
  await assert.rejects(call(member, 'GET', path), { status: 404 });
  await assert.rejects(call(member, 'PATCH', path, { status: 'open' }), { status: 404 });
  const reopened = await call<InboxTeam>(owner, 'PATCH', path, { status: 'open' });
  assert.equal(reopened.assignee, null, 'revoked member is not shown as assignee');
  assert.equal(reopened.status, 'open');
});

test('INB-15 internal notes use the composite thread key and access ends with revocation', async () => {
  const owner = await actor('notes-owner');
  const member = await actor('notes-member');
  const outsider = await actor('notes-admin', 'admin');
  const first = await mailbox(owner, 'notes-mailbox-one', true);
  const second = await mailbox(owner, 'notes-mailbox-two');
  await db.query('INSERT INTO crm_mailbox_members (mailbox_id, user_id) VALUES ($1, $2)', [first.id, member.id]);
  const message = { body: '<b>Private</b> handoff\nFollow up tomorrow.' };
  const path = (kind: 'notes' | 'team', query: string) => `sales/inbox/${kind}?${query}`;
  await assert.rejects(call(outsider, 'POST', path('notes', first.query), message), { status: 404 });
  await assert.rejects(call(member, 'POST', path('notes', second.query), message), { status: 404 });
  await assert.rejects(call(owner, 'POST', path('notes', first.query.replace(first.threadId, 'missing-thread')), message), { status: 404 });
  const note = await call<InboxTeamNote>(member, 'POST', path('notes', first.query), message);
  assert.equal(note.authorName, member.name);
  assert.equal(note.body, message.body);
  assert.deepEqual((await call<InboxTeam>(owner, 'GET', path('team', first.query))).notes, [note]);
  assert.deepEqual((await call<InboxTeam>(owner, 'GET', path('team', second.query))).notes, []);
  assert.equal((await db.query('SELECT 1 FROM crm_mailbox_messages WHERE mailbox_id = $1', [first.id])).rowCount, 1);
  await db.query("UPDATE crm_mailboxes SET status = 'revoked' WHERE id = $1", [first.id]);
  await assert.rejects(call(owner, 'GET', path('team', first.query)), { status: 404 });
  await assert.rejects(call(member, 'POST', path('notes', first.query), message), { status: 404 });
});

test('INB-16 personal saved replies are editable only by their author', async () => {
  const owner = await actor('reply-owner');
  const outsider = await actor('reply-admin', 'admin');
  const list = 'sales/inbox/saved-replies';
  const saved = await call<SavedReply>(owner, 'POST', list, { title: 'First response', body: 'Thanks for writing.' });
  const item = `${list}/${saved.id}`;
  const update = { title: 'Updated response', body: 'I will look into this.' };
  assert.deepEqual((await call<{ items: SavedReply[] }>(outsider, 'GET', list)).items, []);
  await assert.rejects(call(outsider, 'PATCH', item, update), { status: 404 });
  await assert.rejects(call(outsider, 'DELETE', item), { status: 404 });
  const edited = await call<SavedReply>(owner, 'PATCH', item, update);
  assert.equal(edited.id, saved.id);
  assert.equal(edited.body, update.body);
  assert.deepEqual((await call<{ items: SavedReply[] }>(owner, 'GET', list)).items, [edited]);
  await call(owner, 'DELETE', item);
  assert.deepEqual((await call<{ items: SavedReply[] }>(owner, 'GET', list)).items, []);
});
