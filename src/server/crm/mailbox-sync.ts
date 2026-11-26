import { randomUUID } from 'node:crypto';
import type { MailboxProvider } from '@/contracts/crm';
import { db } from '../db';
import { activeMailboxUser } from '../mailbox-access';
import { parseGmailMessage, parseGraphMessage } from './mailboxes';
import type { SyncedMessage } from './mailboxes';

const gmail = 'https://gmail.googleapis.com/gmail/v1/users/me';
const graph = 'https://graph.microsoft.com';
const backfillMs = 30 * 24 * 60 * 60_000;
const pageSize = 25;
const graphFields = 'id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime';
const graphFolders = ['sentitems', 'inbox'] as const;

type Folder = typeof graphFolders[number];
type GmailCursor = { historyId: string; after?: number; pageToken?: string; offset?: number };
type GraphCursor = { folderId: string; since: string; link?: string; offset?: number };
type Cursor = { gmail?: GmailCursor; outlook?: Partial<Record<Folder, GraphCursor>> };
type Ingest = (messages: SyncedMessage[]) => Promise<number>;
type Save = (cursor: Cursor) => Promise<void>;
type ProviderMessage = { id: string };
type GmailList = { messages?: ProviderMessage[]; nextPageToken?: string };
type GmailHistory = {
  history?: { messagesAdded?: { message: ProviderMessage }[] }[];
  historyId: string;
  nextPageToken?: string;
};
type GraphMessage = Parameters<typeof parseGraphMessage>[0] & { '@removed'?: unknown };
type GraphDelta = { value: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string };

class ProviderSyncError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Mailbox provider returned HTTP ${status}.`);
  }
}

async function providerGet<T>(url: URL, token: string, prefer?: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(prefer ? { prefer } : {}) },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = url.origin === graph && [400, 404].includes(response.status)
      ? await response.json().catch(() => null) as { error?: { code?: string } } | null
      : null;
    if (!body) await response.body?.cancel().catch(() => {});
    throw new ProviderSyncError(response.status, body?.error?.code);
  }
  return response.json() as Promise<T>;
}

function gmailUrl(path: string, entries: Record<string, string>) {
  const url = new URL(gmail + path);
  url.search = new URLSearchParams(entries).toString();
  return url;
}

function historyId(value: string) {
  if (typeof value !== 'string' || !/^\d{1,32}$/.test(value)) throw new Error('Gmail returned an invalid history cursor.');
  return value;
}

async function gmailMessage(id: string, token: string): Promise<SyncedMessage | null> {
  const url = gmailUrl(`/messages/${encodeURIComponent(id)}`, {
    format: 'metadata', fields: 'id,threadId,snippet,internalDate,payload(headers),labelIds',
  });
  for (const name of ['From', 'To', 'Subject', 'Date']) url.searchParams.append('metadataHeaders', name);
  try {
    const message = await providerGet<Parameters<typeof parseGmailMessage>[0] & { labelIds?: string[] }>(url, token);
    if (message.id !== id || !message.threadId) throw new Error('Gmail returned an unexpected message.');
    if (message.labelIds?.some(label => ['DRAFT', 'SPAM', 'TRASH'].includes(label))) return null;
    return parseGmailMessage(message);
  } catch (error) {
    // Mail may disappear between a history record and its metadata request.
    if (error instanceof ProviderSyncError && error.status === 404) return null;
    throw error;
  }
}

async function syncGmail(cursor: Cursor, token: string, ingest: Ingest, save: Save): Promise<boolean> {
  let current = cursor.gmail;
  if (!current) {
    const profile = await providerGet<{ historyId: string }>(gmailUrl('/profile', { fields: 'historyId' }), token);
    // Anchor before backfill so messages received during its pagination are picked up by History.
    current = { historyId: historyId(profile.historyId), after: Math.floor((Date.now() - backfillMs) / 1000) };
    await save({ ...cursor, gmail: current });
  }

  const paging: Record<string, string> = current.pageToken ? { pageToken: current.pageToken } : {};
  let ids: string[];
  let nextPage: string | undefined;
  let nextHistory = current.historyId;
  try {
    if (current.after !== undefined) {
      const result = await providerGet<GmailList>(gmailUrl('/messages', {
        maxResults: String(pageSize), q: `after:${current.after} -in:drafts`, fields: 'messages(id),nextPageToken', ...paging,
      }), token);
      ids = (result.messages ?? []).map(message => message.id);
      nextPage = result.nextPageToken;
    } else {
      const result = await providerGet<GmailHistory>(gmailUrl('/history', {
        startHistoryId: current.historyId, historyTypes: 'messageAdded', maxResults: String(pageSize),
        fields: 'historyId,nextPageToken,history(messagesAdded(message(id)))', ...paging,
      }), token);
      ids = (result.history ?? []).flatMap(record => (record.messagesAdded ?? []).map(item => item.message.id));
      nextPage = result.nextPageToken;
      nextHistory = historyId(result.historyId);
    }
  } catch (error) {
    if (!(error instanceof ProviderSyncError)) throw error;
    if (error.status === 404 && current.after === undefined) {
      await save({ ...cursor, gmail: undefined });
      return true;
    }
    if (error.status === 400 && current.pageToken) {
      await save({ ...cursor, gmail: { historyId: current.historyId, after: current.after } });
      return true;
    }
    throw error;
  }

  // A history record can reference many messages even when the history page size is small.
  ids = [...new Set(ids)];
  if (ids.some(id => typeof id !== 'string' || !/^[a-z0-9_-]{1,512}$/i.test(id))) {
    throw new Error('Gmail returned an invalid message identifier.');
  }
  const start = current.offset ?? 0;
  const end = start + pageSize;
  const messages: SyncedMessage[] = [];
  const batch = ids.slice(start, end);
  for (let offset = 0; offset < batch.length; offset += 5) {
    const results = await Promise.all(batch.slice(offset, offset + 5).map(id => gmailMessage(id, token)));
    messages.push(...results.filter((message): message is SyncedMessage => message !== null));
  }
  if (messages.length) await ingest(messages);

  if (end < ids.length) {
    await save({ ...cursor, gmail: { ...current, offset: end } });
    return true;
  }
  if (nextPage) {
    await save({ ...cursor, gmail: { historyId: current.historyId, after: current.after, pageToken: nextPage } });
    return true;
  }
  await save({ ...cursor, gmail: { historyId: nextHistory } });
  // Backfill finished. Run the anchored History query next rather than waiting for normal polling.
  return current.after !== undefined;
}

function graphDeltaStart(folderId: string, since: string) {
  const url = new URL(`/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta`, graph);
  url.searchParams.set('$select', graphFields);
  url.searchParams.set('$filter', `receivedDateTime ge ${since}`);
  return url;
}

const outlookBackfill = (folderId: string): GraphCursor => ({ folderId, since: new Date(Date.now() - backfillMs).toISOString() });

/** Only follow HTTPS continuations for the exact authenticated mailbox folder and delta resource. */
function graphDeltaLink(link: string, folderId: string) {
  const url = new URL(link);
  const match = /^\/v1\.0\/me\/mailfolders(?:\/([^/]+)|\('([^']+)'\))\/messages\/delta$/i.exec(url.pathname);
  const selected = match && decodeURIComponent(match[1] ?? match[2]);
  const hasToken = url.searchParams.has('$skiptoken') || url.searchParams.has('$deltatoken');
  if (link.length > 16_384 || url.origin !== graph || url.username || url.password || url.hash || selected !== folderId || !hasToken) {
    throw new Error('Outlook returned an invalid mailbox continuation.');
  }
  return url;
}

function graphNeedsReset(error: unknown) {
  return error instanceof ProviderSyncError
    && (error.status === 410 || ([400, 404].includes(error.status) && error.code?.toLowerCase() === 'syncstatenotfound'));
}

async function syncOutlook(cursor: Cursor, token: string, ingest: Ingest, save: Save): Promise<boolean> {
  const outlook = { ...cursor.outlook };
  const checkpoint = () => save({ ...cursor, outlook });
  let pending = false;
  for (const folder of graphFolders) {
    let current = outlook[folder];
    if (!current) {
      const url = new URL(`/v1.0/me/mailFolders/${folder}`, graph);
      url.searchParams.set('$select', 'id');
      const { id } = await providerGet<{ id: string }>(url, token);
      if (typeof id !== 'string' || !/^[a-z0-9_+\/=-]{1,512}$/i.test(id)) throw new Error('Outlook returned an invalid folder identifier.');
      outlook[folder] = current = outlookBackfill(id);
      await checkpoint();
    }

    const url = current.link ? graphDeltaLink(current.link, current.folderId) : graphDeltaStart(current.folderId, current.since);
    let result: GraphDelta;
    try {
      result = await providerGet<GraphDelta>(url, token, `odata.maxpagesize=${pageSize}`);
    } catch (error) {
      if (!current.link || !graphNeedsReset(error)) throw error;
      outlook[folder] = outlookBackfill(current.folderId);
      await checkpoint();
      pending = true;
      continue;
    }
    const next = result['@odata.nextLink'];
    const link = next ?? result['@odata.deltaLink'];
    if (!link || !Array.isArray(result.value)) throw new Error('Outlook returned an incomplete delta page.');
    graphDeltaLink(link, current.folderId);
    // The same message can appear more than once in delta data. Retain the existing Graph REST IDs.
    const messages = new Map<string, SyncedMessage>();
    const start = current.offset ?? 0;
    const end = start + pageSize;
    for (const item of result.value.slice(start, end)) {
      if (item['@removed']) continue;
      if (typeof item.id !== 'string' || !item.id) throw new Error('Outlook returned an invalid message identifier.');
      messages.set(item.id, parseGraphMessage({ ...item, conversationId: item.conversationId || item.id }));
    }
    if (messages.size) await ingest([...messages.values()]);
    const pagePending = end < result.value.length;
    outlook[folder] = pagePending ? { ...current, offset: end } : { folderId: current.folderId, since: current.since, link };
    await checkpoint();
    pending ||= pagePending || Boolean(next);
  }
  return pending;
}

/**
 * Process one Gmail batch or one Outlook page per folder. A per-mailbox lease serializes worker and manual sync.
 * A checkpoint written after ingestion permits an interrupted page to retry using the original message IDs.
 */
export async function syncMailboxMessages(
  mailbox: { id: string; provider: MailboxProvider; email: string },
  token: string,
  ingest: Ingest,
): Promise<{ pending: boolean }> {
  const leaseToken = randomUUID();
  const { rows: [claimed] } = await db.query<{ cursor: Cursor }>(
    `INSERT INTO crm_mailbox_sync_state (mailbox_id, lease_token, lease_until)
     SELECT m.id, $2, now() + interval '5 minutes'
     FROM crm_mailboxes m JOIN users u ON u.id = m.user_id
     WHERE m.id = $1 AND m.status <> 'revoked' AND ${activeMailboxUser('u')}
     ON CONFLICT (mailbox_id) DO UPDATE SET lease_token = $2, lease_until = now() + interval '5 minutes'
     WHERE crm_mailbox_sync_state.lease_until IS NULL OR crm_mailbox_sync_state.lease_until < now()
     RETURNING cursor`, [mailbox.id, leaseToken],
  );
  if (!claimed) return { pending: true };

  try {
    const save: Save = async cursor => {
      const { rowCount } = await db.query(
        `UPDATE crm_mailbox_sync_state SET cursor = $3, lease_until = now() + interval '5 minutes'
         WHERE mailbox_id = $1 AND lease_token = $2
         AND EXISTS (SELECT 1 FROM crm_mailboxes m JOIN users u ON u.id = m.user_id
           WHERE m.id = $1 AND m.status <> 'revoked' AND ${activeMailboxUser('u')})`,
        [mailbox.id, leaseToken, JSON.stringify(cursor)],
      );
      if (!rowCount) throw new Error('Mailbox sync paused after the connection changed.');
    };
    const pending = mailbox.provider === 'google'
      ? await syncGmail(claimed.cursor, token, ingest, save)
      : await syncOutlook(claimed.cursor, token, ingest, save);
    return { pending };
  } finally {
    await db.query(`UPDATE crm_mailbox_sync_state SET lease_token = NULL, lease_until = NULL
      WHERE mailbox_id = $1 AND lease_token = $2`, [mailbox.id, leaseToken]);
  }
}
