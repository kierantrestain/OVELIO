import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { MailboxProvider } from '../../src/contracts/crm';
import type { SyncedMessage } from '../../src/server/crm/mailboxes';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;
const { db } = await import('../../src/server/db');
const { syncMailboxMessages } = await import('../../src/server/crm/mailbox-sync');
const owner = '00000000-0000-4000-8000-000000000001';

after(async () => db.close());

async function addMailbox(provider: MailboxProvider, suffix: string) {
  const email = `${suffix}@example.test`;
  const { rows: [mailbox] } = await db.query<{ id: string }>(
    'INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc) VALUES ($1, $2, $3, $4) RETURNING id',
    [owner, provider, email, 'synthetic'],
  );
  return { id: mailbox.id, provider, email };
}

const gmailMessage = (id: string) => ({
  id, threadId: 'conversation', snippet: 'Synthetic Gmail message',
  internalDate: '1795593600000', payload: { headers: [{ name: 'From', value: 'contact@example.test' }] },
});
const graphMessage = (id: string) => ({
  id, conversationId: 'conversation', bodyPreview: 'Synthetic Outlook message',
  receivedDateTime: '2026-11-25T10:00:00Z', from: { emailAddress: { address: 'contact@example.test' } },
});

test('INB-10 Gmail resumes an interrupted backfill and handles paginated, repeated, or expired History', async t => {
  const mailbox = await addMailbox('google', 'gmail-sync');
  const calls: URL[] = [];
  let expire = false;
  let rejectToken = false;
  let profile = '100';
  const fetch = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.origin, 'https://gmail.googleapis.com');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-token');
    assert.equal(init.redirect, 'error');
    calls.push(url);
    if (rejectToken) return new Response(null, { status: 401 });
    if (url.pathname.endsWith('/profile')) return Response.json({ historyId: profile });
    if (url.pathname.endsWith('/messages')) {
      assert.match(url.searchParams.get('q') ?? '', /^after:\d+ -in:drafts$/);
      return url.searchParams.has('pageToken')
        ? Response.json({ messages: [{ id: 'page2' }] })
        : Response.json({ messages: [{ id: 'page1' }], nextPageToken: 'gmail-page-2' });
    }
    if (url.pathname.endsWith('/history')) {
      if (expire) return new Response(null, { status: 404 });
      if (url.searchParams.has('pageToken')) {
        assert.equal(url.searchParams.get('startHistoryId'), '100', 'keep anchor until last page');
        return Response.json({ historyId: '150', history: [{ messagesAdded: [{ message: { id: 'added2' } }] }] });
      }
      return Response.json({
        historyId: '140', nextPageToken: 'history-page-2',
        history: [{ messagesAdded: [{ message: { id: 'added1' } }, { message: { id: 'added1' } }, { message: { id: 'missing' } }] }],
      });
    }
    const id = url.pathname.split('/').at(-1)!;
    return id === 'missing' ? new Response(null, { status: 404 }) : Response.json(gmailMessage(id));
  });
  const stored = new Set<string>();
  let interrupt = true;
  const ingest = async (messages: SyncedMessage[]) => {
    for (const message of messages) stored.add(message.providerId);
    if (interrupt) throw new Error('synthetic interrupted write');
    return messages.length;
  };
  const sync = () => syncMailboxMessages(mailbox, 'synthetic-token', ingest);
  await assert.rejects(sync, /interrupted write/);
  interrupt = false;
  assert.deepEqual(await sync(), { pending: true });
  assert.deepEqual(await sync(), { pending: true }, 'backfill completion schedules anchored History');
  const list = calls.filter(url => url.pathname.endsWith('/messages'));
  assert.equal(list[0].searchParams.get('q'), list[2].searchParams.get('q'));
  assert.equal(list[1].searchParams.has('pageToken'), false, 'partial write retries its page');
  assert.equal(list[2].searchParams.get('pageToken'), 'gmail-page-2');
  assert.deepEqual(await sync(), { pending: true });
  assert.deepEqual(await sync(), { pending: false });
  assert.deepEqual([...stored], ['page1', 'page2', 'added1', 'added2']);
  assert.equal(calls.filter(url => url.pathname.endsWith('/added1')).length, 1);

  rejectToken = true;
  await assert.rejects(sync, { status: 401 });
  assert.equal(calls.at(-1)?.searchParams.get('startHistoryId'), '150');
  rejectToken = false;
  expire = true;
  assert.deepEqual(await sync(), { pending: true });
  assert.equal(calls.at(-1)?.searchParams.get('startHistoryId'), '150', 'authorization error kept its cursor');
  expire = false;
  profile = '175';
  assert.deepEqual(await sync(), { pending: true }, 'expired cursor begins a bounded re-anchor');
  assert.equal(calls.filter(url => url.pathname.endsWith('/profile')).length, 2);
  await db.query("UPDATE crm_mailboxes SET status = 'revoked' WHERE id = $1", [mailbox.id]);
  const callsBefore = fetch.mock.callCount();
  await sync();
  assert.equal(fetch.mock.callCount(), callsBefore, 'revoked mailbox never contacts the provider');
});

test('INB-11 Outlook checkpoints each folder, ignores tombstones, and resets one expired folder', async t => {
  const mailbox = await addMailbox('microsoft', 'outlook-sync');
  const paths: URL[] = [];
  const link = (folder: string, token: string) => `https://graph.microsoft.com/v1.0/me/mailfolders('${folder}')/messages/delta?${token}`;
  let rejectInbox = true;
  let staleSent = false;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.origin, 'https://graph.microsoft.com');
    assert.equal(init.redirect, 'error');
    paths.push(url);
    if (url.pathname.endsWith('/sentitems')) return Response.json({ id: 'sent-folder' });
    if (url.pathname.endsWith('/inbox')) return Response.json({ id: 'inbox-folder' });
    assert.equal(new Headers(init.headers).get('prefer'), 'odata.maxpagesize=25');
    const folder = url.pathname.includes('sent-folder') ? 'sent-folder' : 'inbox-folder';
    if (url.searchParams.has('$filter')) {
      assert.match(url.searchParams.get('$filter')!, /^receivedDateTime ge \d{4}-\d\d-\d\dT/);
      if (folder === 'inbox-folder' && rejectInbox) return new Response(null, { status: 503 });
      return Response.json({ value: [graphMessage(folder)], '@odata.nextLink': link(folder, '$skiptoken=carry-page') });
    }
    if (folder === 'sent-folder' && staleSent) return new Response(null, { status: 410 });
    return Response.json({
      value: [graphMessage(folder + '-new'), graphMessage(folder + '-new'), { id: 'removed', '@removed': { reason: 'deleted' } }],
      '@odata.deltaLink': link(folder, '$deltatoken=current'),
    });
  });
  const ingested: string[] = [];
  const sync = () => syncMailboxMessages(mailbox, 'synthetic-token', async messages => ingested.push(...messages.map(message => message.providerId)));
  await assert.rejects(sync, { status: 503 });
  assert.deepEqual(ingested, ['sent-folder']);
  rejectInbox = false;
  assert.deepEqual(await sync(), { pending: true });
  assert.deepEqual(ingested, ['sent-folder', 'sent-folder-new', 'inbox-folder']);
  staleSent = true;
  assert.deepEqual(await sync(), { pending: true });
  assert.deepEqual(ingested.at(-1), 'inbox-folder-new');
  staleSent = false;
  assert.deepEqual(await sync(), { pending: true });
  assert.equal(paths.filter(url => url.searchParams.has('$filter') && url.pathname.includes('sent-folder')).length, 2);
  assert.equal(paths.filter(url => url.searchParams.has('$filter') && url.pathname.includes('inbox-folder')).length, 2);
});

test('INB-12 Outlook validates continuation host and folder before changing the checkpoint', async t => {
  const mailbox = await addMailbox('microsoft', 'outlook-continuation');
  let continuation = 'https://example.invalid/v1.0/me/mailFolders/sent-folder/messages/delta?$skiptoken=synthetic';
  const tracked = t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.origin, 'https://graph.microsoft.com');
    return url.pathname.endsWith('/sentitems')
      ? Response.json({ id: 'sent-folder' })
      : Response.json({ value: [graphMessage('first')], '@odata.nextLink': continuation });
  });
  let writes = 0;
  const sync = () => syncMailboxMessages(mailbox, 'synthetic-token', async () => ++writes);
  await assert.rejects(sync, /invalid mailbox continuation/);
  continuation = 'https://graph.microsoft.com/v1.0/me/mailFolders/different-folder/messages/delta?$skiptoken=synthetic';
  await assert.rejects(sync, /invalid mailbox continuation/);
  assert.equal(tracked.mock.callCount(), 3, 'only folder lookup and initial delta calls received authentication');
  assert.equal(writes, 0);
});

test('INB-13 a mailbox lease prevents overlapping worker and manual sync', async t => {
  const mailbox = await addMailbox('google', 'gmail-lease');
  const reachedProfile = Promise.withResolvers<void>();
  const releaseProfile = Promise.withResolvers<void>();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    requests++;
    if (url.pathname.endsWith('/profile')) {
      reachedProfile.resolve();
      await releaseProfile.promise;
      return Response.json({ historyId: '250' });
    }
    return Response.json({});
  });
  const sync = () => syncMailboxMessages(mailbox, 'synthetic-token', async () => 0);
  const active = sync();
  await reachedProfile.promise;
  try {
    assert.deepEqual(await sync(), { pending: true });
    assert.equal(requests, 1, 'the second sync does not fetch an in-flight batch');
  } finally {
    releaseProfile.resolve();
    await active;
  }
  const { rows: [state] } = await db.query<{ lease_token: string | null }>(
    'SELECT lease_token FROM crm_mailbox_sync_state WHERE mailbox_id = $1', [mailbox.id],
  );
  assert.equal(state.lease_token, null);
});
