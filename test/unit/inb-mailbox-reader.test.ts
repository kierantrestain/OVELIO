import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { User } from '../../src/contracts';
import type { InboxMessageContent, InboxThread, InboxThreadSummary, MailboxProvider, SalesEmailResult } from '../../src/contracts/crm';

process.env.OVELIO_DEV_PREVIEW = 'true';
process.env.MAILBOX_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { crmModule } = await import('../../src/server/crm/module');
const { devPreviewTeam } = await import('../../src/server/dev-preview');
const { upsertContact } = await import('../../src/server/directory');
const { encryptToken, ingestMessages } = await import('../../src/server/crm/mailboxes');
const { listEvents } = await import('../../src/server/events');

const [owner, member] = devPreviewTeam();
const outsider: User = { id: randomUUID(), email: 'other-admin@example.test', name: 'Unrelated administrator', role: 'admin' };
const recipient = 'reader-contact@example.test';
const threadId = 'reader-thread';
let contactId: number;

before(async () => {
  await db.query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, 'admin', 'test-only')",
    [outsider.id, outsider.email, outsider.name]);
  const { contact } = await upsertContact({ email: recipient, consent: 'opted_in', evidence: 'Synthetic mailbox test', source: 'test' });
  contactId = contact.id;
});

after(async () => { await db.close(); });

async function mailbox(provider: MailboxProvider = 'google') {
  const email = randomUUID() + '@example.test';
  const { rows: [row] } = await db.query<{ id: string }>(
    "INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc, access_token_enc, access_expires_at) "
      + "VALUES ($1, $2, $3, $4, $4, now() + interval '30 minutes') RETURNING id", [owner.id, provider, email, encryptToken('fixture-token')]);
  await db.query('INSERT INTO crm_mailbox_members (mailbox_id, user_id) VALUES ($1, $2)', [row.id, member.id]);
  return { id: row.id, email };
}

async function message(mailboxId: string, id = 'first', at = '2026-10-01T09:00:00Z') {
  await db.query(
    "INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, contact_id, direction, subject, from_email, occurred_at) "
      + "VALUES ($1, $2, $3, $4, 'inbound', 'Quarterly review', $5, $6)", [mailboxId, id, threadId, contactId, recipient, at]);
}

async function call<T>(user: User, method: string, path: string, params: Record<string, string>, body?: unknown): Promise<T> {
  const route = crmModule.endpoints.find(item => item.method === method && item.path.test('sales/inbox/' + path));
  assert.ok(route);
  const url = new URL('/api/console/sales/inbox/' + path + '?' + new URLSearchParams(params), 'http://localhost');
  const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return await route.handler({ request, user, params: [], query: url.searchParams }) as T;
}

test('INB-06 Gmail body and download follow the current membership and exact message', async t => {
  const { id: mailboxId } = await mailbox();
  await message(mailboxId);
  const params = { mailboxId, messageId: 'first' };
  const parts = [
    { mimeType: 'text/plain', body: { data: Buffer.from('A complete synthetic message').toString('base64url') } },
    { mimeType: 'application/octet-stream', filename: 'fee\r\ns.pdf', body: { attachmentId: 'fixture-file', size: 4 } },
  ];
  let revoke = false;
  const calls = t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-token');
    const url = new URL(input);
    assert.equal(url.origin, 'https://gmail.googleapis.com');
    if (url.pathname.endsWith('/first/attachments/fixture-file')) {
      return Response.json({ data: Buffer.from([0, 1, 2, 3]).toString('base64url') });
    }
    assert.ok(url.pathname.endsWith('/first'));
    assert.equal(url.searchParams.get('format'), 'full');
    if (revoke) await db.query('DELETE FROM crm_mailbox_members WHERE mailbox_id = $1 AND user_id = $2', [mailboxId, member.id]);
    return Response.json({ payload: { mimeType: 'multipart/mixed', parts } });
  });

  await assert.rejects(call(outsider, 'GET', 'message', params), { status: 404 });
  await assert.rejects(call(member, 'GET', 'message', { ...params, messageId: 'not-synced' }), { status: 404 });
  assert.equal(calls.mock.callCount(), 0);
  const view = await call<InboxMessageContent>(member, 'GET', 'message', params);
  assert.equal(view.body, 'A complete synthetic message');
  assert.deepEqual(view.attachments, [{ id: '0.1', name: 'fee__s.pdf', size: 4, downloadable: true }]);
  await assert.rejects(call(member, 'GET', 'attachment', { ...params, attachmentId: 'unrelated' }), { status: 404 });
  const download = await call<Response>(member, 'GET', 'attachment', { ...params, attachmentId: '0.1' });
  assert.match(download.headers.get('content-disposition') ?? '', /^attachment; filename="fee__s\.pdf"/);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from([0, 1, 2, 3]));

  revoke = true;
  await assert.rejects(call(member, 'GET', 'message', params), { status: 404 }, 'revocation during the provider read takes effect before disclosure');
  await assert.rejects(call(member, 'GET', 'attachment', { ...params, attachmentId: '0.1' }), { status: 404 });
  assert.equal(calls.mock.callCount(), 5);
});

test('INB-07 Outlook reads plain text and downloads a file through its parent message', async t => {
  const { id: mailboxId } = await mailbox('microsoft');
  await message(mailboxId);
  const params = { mailboxId, messageId: 'first' };
  const file = { id: 'report', name: 'Report.csv', size: 6, '@odata.type': '#microsoft.graph.fileAttachment' };
  const linked = { id: 'link', name: 'External document', size: 0, '@odata.type': '#microsoft.graph.referenceAttachment' };
  const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://graph.microsoft.com');
    if (url.pathname.endsWith('/first')) {
      assert.equal(new Headers(init?.headers).get('prefer'), 'outlook.body-content-type="text"');
      return Response.json({ body: { contentType: 'text', content: 'Monthly figures' }, hasAttachments: true });
    }
    if (url.pathname.endsWith('/first/attachments')) return Response.json({ value: [file, linked] });
    if (url.pathname.endsWith('/first/attachments/link')) return Response.json(linked);
    if (url.pathname.endsWith('/first/attachments/report')) return Response.json(file);
    assert.ok(url.pathname.endsWith('/first/attachments/report/$value'));
    return new Response('a,b,c\n');
  });
  const view = await call<InboxMessageContent>(owner, 'GET', 'message', params);
  assert.equal(view.body, 'Monthly figures');
  assert.deepEqual(view.attachments.map(item => [item.id, item.downloadable]), [['report', true], ['link', false]]);
  await assert.rejects(call(owner, 'GET', 'attachment', { ...params, attachmentId: 'link' }), { status: 415 });
  const download = await call<Response>(owner, 'GET', 'attachment', { ...params, attachmentId: 'report' });
  assert.equal(await download.text(), 'a,b,c\n');
  assert.equal(fetch.mock.callCount(), 5);
});

test('INB-08 marking a conversation read is per viewer and preserves a late-arriving inbound message', async () => {
  const { id: mailboxId } = await mailbox();
  await message(mailboxId);
  const params = { mailboxId, threadId };
  const snapshot = await call<InboxThread>(owner, 'GET', 'thread', params);
  assert.equal(snapshot.unread, true);
  await message(mailboxId, 'late-arrival', '2026-10-01T08:00:00Z');
  assert.equal((await call<InboxThread>(owner, 'PATCH', 'thread', params, { read: true, through: snapshot.readVersion })).unread, true);
  const latest = await call<InboxThread>(owner, 'GET', 'thread', params);
  assert.equal((await call<InboxThread>(owner, 'PATCH', 'thread', params, { read: true, through: latest.readVersion })).unread, false);
  const unread = async (user: User) => (await call<InboxThreadSummary[]>(user, 'GET', 'threads', { unread: 'true' }))
    .some(thread => thread.mailboxId === mailboxId);
  assert.equal(await unread(owner), false);
  assert.equal(await unread(member), true);
  await assert.rejects(call(outsider, 'PATCH', 'thread', params, { read: true }), { status: 404 });
  assert.equal((await call<InboxThread>(owner, 'PATCH', 'thread', params, { read: false })).unread, true);
});

test('INB-09 owner replies in the same Gmail thread and a retried request sends once', async t => {
  const { id: mailboxId } = await mailbox();
  await message(mailboxId);
  const params = { mailboxId, threadId };
  const input = { body: 'Thanks for the update.', requestId: randomUUID() };
  let sent: { raw: string; threadId: string } | undefined;
  const calls = t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/messages/send')) {
      sent = JSON.parse(String(init?.body)) as typeof sent;
      return Response.json({ id: 'new-reply', threadId });
    }
    return Response.json({ threadId, payload: { headers: [{ name: 'Message-ID', value: '<original@example.test>' }] } });
  });
  await assert.rejects(call(member, 'POST', 'reply', params, input), { status: 404 });
  assert.equal(calls.mock.callCount(), 0);
  const result = await call<SalesEmailResult>(owner, 'POST', 'reply', params, input);
  assert.equal(result.status, 'sent', result.reason);
  assert.deepEqual(await call(owner, 'POST', 'reply', params, input), result);
  assert.equal(calls.mock.callCount(), 2);
  assert.equal(sent?.threadId, threadId);
  const raw = Buffer.from(sent?.raw ?? '', 'base64url').toString('utf8');
  assert.match(raw, /^To: reader-contact@example\.test\r$/m);
  assert.match(raw, /^In-Reply-To: <original@example\.test>\r$/m);
  const view = await call<InboxMessageContent>(member, 'GET', 'message', { mailboxId, messageId: 'new-reply' });
  assert.equal(view.body, input.body);
  assert.equal(calls.mock.callCount(), 2, 'local copy of the sent reply');
});

test('INB-17 a reply arriving before its historical outbound message is reconciled once', async () => {
  const { id, email } = await mailbox();
  const inbound = { providerId: 'backfill-reply', threadId, from: recipient, to: [email], subject: 'Re: Review', snippet: '', at: '2026-10-01T09:20:00.000Z' };
  const outbound = { providerId: 'backfill-send', threadId, from: email, to: [recipient], subject: 'Review', snippet: '', at: '2026-10-01T09:00:00.000Z' };
  const replies = async () => (await listEvents({ contactId, types: ['email.replied'] }, owner.id))
    .filter(event => event.properties.messageId === inbound.providerId);
  assert.equal(await ingestMessages(id, email, [inbound]), 1);
  assert.equal((await replies()).length, 0);
  assert.equal(await ingestMessages(id, email, [outbound]), 1);
  assert.equal(await ingestMessages(id, email, [outbound, inbound]), 0);
  assert.equal((await replies()).length, 1);
});

test('INB-18 Outlook sends a reply only after Graph confirms the exact CRM recipient and conversation', async t => {
  const { id: mailboxId } = await mailbox('microsoft');
  await message(mailboxId);
  let confirmedAddress = 'different-address@example.test';
  const fetched = t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://graph.microsoft.com');
    assert.equal(init?.method, 'POST');
    if (url.pathname.endsWith('/first/createReply')) {
      const draft = JSON.parse(String(init?.body));
      assert.deepEqual(draft.message.toRecipients, [{ emailAddress: { address: recipient } }]);
      return Response.json({ id: 'draft', conversationId: threadId, toRecipients: [{ emailAddress: { address: confirmedAddress } }] });
    }
    assert.ok(url.pathname.endsWith('/draft/send'));
    return new Response(null, { status: 202 });
  });
  const params = { mailboxId, threadId };
  const failed = await call<SalesEmailResult>(owner, 'POST', 'reply', params, { body: 'Thank you.' });
  assert.equal(failed.status, 'failed');
  assert.match(failed.reason, /approved recipient/);
  assert.equal(fetched.mock.callCount(), 1);
  confirmedAddress = recipient;
  const sent = await call<SalesEmailResult>(owner, 'POST', 'reply', params, { body: 'Thank you.' });
  assert.equal(sent.status, 'sent', sent.reason);
  assert.equal(fetched.mock.callCount(), 3);
});
