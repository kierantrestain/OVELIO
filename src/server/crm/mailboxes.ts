// Connected Gmail (Google OAuth 2 + Gmail API) and Outlook (Microsoft identity platform + Graph) mailboxes. Each user
// connects their own with state + PKCE; refresh and access tokens are AES-256-GCM encrypted with MAILBOX_ENCRYPTION_KEY.
// Sales email can be sent through the provider; the 'crm.mailbox_sync' job logs recent conversations with known
// contacts as activities and emits email.replied when a contact answers a thread sent from OVELIO's side.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { User } from '@/contracts';
import type { Mailbox, MailboxOverview, MailboxProvider, ProviderStatus, SalesEmailResult } from '@/contracts/crm';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { requestOrigin } from '../dev-preview';
import { canEmail, findContactByEmail } from '../directory';
import { audit, emitEvent } from '../events';
import { readBody } from '../http';
import { activeMailboxUser, canReadMailbox } from '../mailbox-access';
import { htmlToText } from '../mailer';
import { schedulePlatformJob } from '../platform/jobs';
import { logActivity } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { inboxEndpoints } from './inbox';
import { inboxTeamEndpoints } from './mailbox-team';
import { textToHtml } from './people';
import { uuid } from './shared';

export const MAILBOX_SYNC_JOB = 'crm.mailbox_sync';
const syncEveryMs = 15 * 60_000;

/** One job key per slot: a running sync cannot reschedule its own key (it would re-run at once). */
async function scheduleSync(mailboxId: string, runAt: Date, cadence = syncEveryMs) {
  const slot = Math.floor(runAt.getTime() / cadence);
  const key = cadence === syncEveryMs ? `${mailboxId}:${slot}` : `${mailboxId}:backfill:${slot}`;
  await schedulePlatformJob(MAILBOX_SYNC_JOB, key, { mailboxId }, { runAt });
}

/* ── Token encryption ─────────────────────────────────────────────────── */

/** MAILBOX_ENCRYPTION_KEY: 32 random bytes as 64 hex characters or base64 (`openssl rand -base64 32`). */
export function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.MAILBOX_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function encryptToken(plain: string, key = encryptionKey()): string {
  if (!key) throw new AppError(409, 'Set MAILBOX_ENCRYPTION_KEY (32 random bytes, base64) before connecting a mailbox.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptToken(sealed: string, key = encryptionKey()): string {
  if (!key) throw new AppError(409, 'MAILBOX_ENCRYPTION_KEY is not set, so stored mailbox tokens cannot be read.');
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new AppError(500, 'A stored mailbox token is malformed.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

/* ── Providers ────────────────────────────────────────────────────────── */

type ProviderConfig = { label: string; idVar: string; secretVar: string; auth: string; token: string; scopes: string[]; extra: Record<string, string> };

function providers(env: NodeJS.ProcessEnv = process.env): Record<MailboxProvider, ProviderConfig> {
  const tenant = env.MICROSOFT_TENANT_ID?.trim() || 'common';
  return {
    google: {
      label: 'Gmail', idVar: 'GOOGLE_CLIENT_ID', secretVar: 'GOOGLE_CLIENT_SECRET',
      auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
      extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    },
    microsoft: {
      label: 'Outlook', idVar: 'MICROSOFT_CLIENT_ID', secretVar: 'MICROSOFT_CLIENT_SECRET',
      auth: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`, token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scopes: ['offline_access', 'openid', 'email', 'User.Read', 'Mail.Send', 'Mail.ReadWrite'],
      extra: { response_mode: 'query' },
    },
  };
}

export function redirectUri(provider: MailboxProvider, origin: string) {
  const base = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : origin;
  return `${base}/api/console/mailboxes/oauth/${provider}/callback`;
}

export function providerStatus(provider: MailboxProvider, origin: string, env: NodeJS.ProcessEnv = process.env): ProviderStatus {
  const config = providers(env)[provider];
  const missing = [config.idVar, config.secretVar].filter(name => !env[name]?.trim());
  if (!encryptionKey(env)) missing.push('MAILBOX_ENCRYPTION_KEY');
  return { provider, label: config.label, configured: missing.length === 0, missing, redirectUri: redirectUri(provider, origin) };
}

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function buildAuthUrl(provider: MailboxProvider, input: { state: string; challenge: string; redirectUri: string }, env: NodeJS.ProcessEnv = process.env) {
  const config = providers(env)[provider];
  const url = new URL(config.auth);
  const params: Record<string, string> = {
    client_id: env[config.idVar] ?? '', redirect_uri: input.redirectUri, response_type: 'code', scope: config.scopes.join(' '),
    state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256', ...config.extra,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

class MailboxGrantRevoked extends AppError {
  constructor() { super(409, 'The mailbox provider revoked this connection. Reconnect the account to sync again.'); }
}

async function tokenRequest(provider: MailboxProvider, body: Record<string, string>): Promise<TokenResponse> {
  const config = providers()[provider];
  const response = await fetch(config.token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: process.env[config.idVar] ?? '', client_secret: process.env[config.secretVar] ?? '', ...body }),
  });
  const data = await response.json().catch(() => ({})) as TokenResponse;
  if (body.grant_type === 'refresh_token' && data.error === 'invalid_grant') throw new MailboxGrantRevoked();
  if (!response.ok || !data.access_token) throw new AppError(502, `${config.label} refused the sign-in: ${data.error_description || data.error || response.status}.`);
  return data;
}

const mailOrigins = new Set(['https://gmail.googleapis.com', 'https://graph.microsoft.com', 'https://openidconnect.googleapis.com']);

export async function mailProviderFetch(url: string | URL, token: string, init: RequestInit = {}) {
  const target = new URL(url);
  if (!mailOrigins.has(target.origin) || target.username || target.password) throw new AppError(502, 'Invalid mail provider address.');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(target.toString(), {
    ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
}

class MailProviderError extends AppError {
  constructor(readonly providerStatus: number) {
    super(502, `The mail provider answered ${providerStatus}.`);
  }
}

async function providerJson<T>(url: string | URL, token: string, init?: RequestInit): Promise<T> {
  const response = await mailProviderFetch(url, token, init);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new MailProviderError(response.status);
  }
  if (response.status === 202 || response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

/* ── Stored mailboxes ─────────────────────────────────────────────────── */

type MailboxRow = {
  id: string; user_id: string; user_name: string | null; provider: MailboxProvider; email: string; refresh_token_enc: string; access_token_enc: string | null;
  access_expires_at: Date | null; status: Mailbox['status']; last_error: string; last_synced_at: Date | null; created_at: Date;
};

const mailboxSelect = `SELECT m.*, u.name AS user_name FROM crm_mailboxes m LEFT JOIN users u ON u.id = m.user_id`;

const toMailbox = (row: MailboxRow, viewerId: string): Mailbox => ({
  id: row.id, provider: row.provider, email: row.email, userId: row.user_id, userName: row.user_name ?? '', status: row.status,
  lastError: row.user_id === viewerId ? row.last_error : '',
  lastSyncedAt: row.user_id === viewerId && row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),
});

async function ownedMailbox(id: string, userId: string, client: Sql = db): Promise<MailboxRow> {
  const row = (await client.query<MailboxRow>(`${mailboxSelect}
    WHERE m.id = $1 AND ${canReadMailbox('m.id', '$2', true)} ${client === db ? '' : 'FOR UPDATE OF m'}`, [id, userId])).rows[0];
  if (!row) throw new AppError(404, 'That mailbox was not found.');
  return row;
}

async function accessToken(row: MailboxRow, client: Sql = db): Promise<string> {
  if (row.status === 'revoked') throw new AppError(409, 'Reconnect this mailbox first.');
  if (row.access_token_enc && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now() + 60_000) return decryptToken(row.access_token_enc);
  try {
    const token = await tokenRequest(row.provider, { grant_type: 'refresh_token', refresh_token: decryptToken(row.refresh_token_enc) });
    await client.query(
      `UPDATE crm_mailboxes SET access_token_enc = $2, access_expires_at = now() + ($3 || ' seconds')::interval, status = 'connected', last_error = '',
         refresh_token_enc = coalesce($4, refresh_token_enc), updated_at = now() WHERE id = $1 AND status <> 'revoked'`,
      [row.id, encryptToken(token.access_token), String(token.expires_in ?? 3000), token.refresh_token ? encryptToken(token.refresh_token) : null],
    );
    return token.access_token;
  } catch (error) {
    const revoked = error instanceof MailboxGrantRevoked;
    await client.query(`UPDATE crm_mailboxes SET status = $3, last_error = $2, updated_at = now(),
        access_token_enc = CASE WHEN $3 = 'revoked' THEN NULL ELSE access_token_enc END
      WHERE id = $1 AND status <> 'revoked'`, [row.id, (error as Error).message.slice(0, 300), revoked ? 'revoked' : 'error']);
    throw error;
  }
}

async function readyAccessToken(row: MailboxRow, lock: (client: Sql) => Promise<MailboxRow>) {
  if (row.access_token_enc && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now() + 60_000) {
    return accessToken(row);
  }
  const refreshed = await transaction(async client => {
    const current = await lock(client);
    try { return { ok: true as const, token: await accessToken(current, client) }; }
    catch (error) { return { ok: false as const, error }; } // Commit a provider-reported revocation before returning it.
  });
  if (!refreshed.ok) throw refreshed.error;
  return refreshed.token;
}

/** Runs a provider read only for a locally synced message. Check access again before returning the provider data. */
export async function withReadableMailboxMessage<T>(viewerId: string, mailboxId: string, messageId: string,
  read: (provider: MailboxProvider, token: string) => Promise<T>) {
  const find = async (client: Sql) => {
    const { rows: [row] } = await client.query<MailboxRow>(
      `${mailboxSelect} JOIN crm_mailbox_messages mm ON mm.mailbox_id = m.id
       WHERE m.id = $1 AND mm.provider_message_id = $2 AND ${canReadMailbox('m.id', '$3')}
       ${client === db ? '' : 'FOR UPDATE OF m'}`, [mailboxId, messageId, viewerId],
    );
    if (!row) throw new AppError(404, 'That mailbox message was not found.');
    return row;
  };
  const row = await find(db);
  try {
    return await read(row.provider, await readyAccessToken(row, find));
  } finally {
    const visible = await db.query(`SELECT 1 FROM crm_mailbox_messages mm WHERE mm.mailbox_id = $1 AND mm.provider_message_id = $2
      AND ${canReadMailbox('mm.mailbox_id', '$3')}`, [mailboxId, messageId, viewerId]);
    if (!visible.rowCount) throw new AppError(404, 'That mailbox message was not found.');
  }
}

async function completeConnection(provider: MailboxProvider, code: string, state: string, origin: string, userId: string) {
  const stored = (await db.query<{ code_verifier: string }>(
    `DELETE FROM crm_mailbox_oauth_states WHERE state = $1 AND provider = $2 AND user_id = $3
     AND created_at > now() - interval '15 minutes' RETURNING code_verifier`, [state, provider, userId])).rows[0];
  if (!stored) throw new AppError(400, 'This sign-in link expired. Start the connection again.');
  const token = await tokenRequest(provider, { grant_type: 'authorization_code', code, code_verifier: stored.code_verifier, redirect_uri: redirectUri(provider, origin) });
  const refreshToken = token.refresh_token;
  if (!refreshToken) throw new AppError(502, 'The provider did not grant offline access. Remove OVELIO from the account’s connected apps and connect again.');
  const email = provider === 'google'
    ? (await providerJson<{ email?: string }>('https://openidconnect.googleapis.com/v1/userinfo', token.access_token)).email
    : await providerJson<{ mail?: string; userPrincipalName?: string }>('https://graph.microsoft.com/v1.0/me', token.access_token).then(me => me.mail || me.userPrincipalName);
  if (!email) throw new AppError(502, 'The provider did not return the mailbox address.');
  const normalized = email.trim().toLowerCase();
  const id = await transaction(async client => {
    const existing = (await client.query<{ status: Mailbox['status'] }>(
      'SELECT status FROM crm_mailboxes WHERE provider = $1 AND email = $2 FOR UPDATE', [provider, normalized])).rows[0];
    const saved = await client.query<{ id: string }>(
      `INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc, access_token_enc, access_expires_at, scope)
       SELECT u.id, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval, $7 FROM users u
       WHERE u.id = $1 AND ${activeMailboxUser('u')}
       ON CONFLICT (provider, email) DO UPDATE SET refresh_token_enc = EXCLUDED.refresh_token_enc,
         access_token_enc = EXCLUDED.access_token_enc, access_expires_at = EXCLUDED.access_expires_at, scope = EXCLUDED.scope,
         status = 'connected', last_error = '', updated_at = now()
       WHERE crm_mailboxes.user_id = EXCLUDED.user_id
       RETURNING id`,
      [userId, provider, normalized, encryptToken(refreshToken), encryptToken(token.access_token), String(token.expires_in ?? 3000), token.scope ?? ''],
    );
    const mailbox = saved.rows[0];
    if (!mailbox) throw new AppError(409, 'This address cannot be connected to your account.');
    if (existing?.status === 'revoked') {
      await client.query('DELETE FROM crm_mailbox_members WHERE mailbox_id = $1', [mailbox.id]);
      await client.query('DELETE FROM crm_mailbox_sync_state WHERE mailbox_id = $1', [mailbox.id]);
    }
    await audit(userId, 'connect', 'mailbox', mailbox.id, `${provider}: ${normalized}`, client);
    return mailbox.id;
  });
  await scheduleSync(id, new Date());
  return normalized;
}

/* ── Sending ──────────────────────────────────────────────────────────── */

const header = (value: string) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
const messageIdPattern = /^<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>$/;
type ProviderReply = { providerId: string; threadId: string };
type ReplyHeaders = { messageId: string; references: string[] };

export function mimeMessage(input: { from: string; to: string; subject: string; html: string; reply?: ReplyHeaders }) {
  const reply = [];
  if (input.reply && messageIdPattern.test(input.reply.messageId)) {
    const { messageId, references } = input.reply;
    const ids = references.filter(id => id !== messageId && messageIdPattern.test(id)).slice(-20);
    reply.push(`In-Reply-To: ${messageId}`, 'References: ' + [...ids, messageId].join('\r\n '));
  }
  return [
    `From: ${input.from}`, `To: ${input.to}`, `Subject: ${header(input.subject)}`, 'MIME-Version: 1.0',
    ...reply,
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(input.html).toString('base64'),
  ].join('\r\n');
}

export async function sendFromMailbox(mailboxId: string, input: {
  contactId: number; to: string; subject: string; body: string; dealId: string | null; reply?: ProviderReply; idempotencyKey?: string;
}, user: { id: string }): Promise<SalesEmailResult> {
  return transaction(async client => {
    const row = await ownedMailbox(uuid.parse(mailboxId), user.id, client);
    if (input.idempotencyKey) {
      const { rows: [saved] } = await client.query<{ id: string; status: SalesEmailResult['status']; status_reason: string }>(
        'SELECT id, status, status_reason FROM messages WHERE mailbox_id = $1 AND idempotency_key = $2', [row.id, input.idempotencyKey]);
      if (saved) return { status: saved.status, reason: saved.status_reason, messageId: saved.id, via: row.id };
    }
    const html = textToHtml(input.body);
    const record = async (status: SalesEmailResult['status'], reason: string, providerId: string | null) => (await client.query<{ id: string }>(
      `INSERT INTO messages (category, status, status_reason, to_email, contact_id, from_email, subject, html, text_body, source,
        provider_message_id, created_by, sent_at, mailbox_id, idempotency_key)
       VALUES ('sales', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $1 = 'sent' THEN now() END, $12, $13) RETURNING id`,
      [status, reason, input.to, input.contactId, row.email, input.subject, html, htmlToText(html), `mailbox:${row.id}`,
        providerId, user.id, row.id, input.idempotencyKey ?? null])).rows[0].id;
    const permission = await canEmail(input.to);
    if (!permission.allowed) {
      const reason = `Not sent: ${permission.reason ?? 'this address may not be emailed.'}`;
      return { status: 'blocked', reason, messageId: await record('blocked', reason, null), via: row.id };
    }
    let receipt: { providerId: string; threadId: string };
    try {
      receipt = await sendThroughProvider(row, input.to, input.subject, html, client, input.reply);
    } catch (error) {
      const reason = `Delivery failed: ${(error as Error).message.slice(0, 200)}`;
      return { status: 'failed', reason, messageId: await record('failed', reason, null), via: row.id };
    }
    const reason = `Sent from ${row.email}.`;
    const messageId = await record('sent', reason, receipt.providerId);
    const activityId = await logActivity({
      type: 'email', direction: 'outbound', subject: input.subject, body: input.body.slice(0, 5000), contactId: input.contactId,
      dealId: input.dealId, messageId, authorId: user.id, mailboxId: row.id,
    }, client);
    await client.query(
      `INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, contact_id, direction, subject, snippet, from_email, to_emails, activity_id)
       VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8, $9)
       ON CONFLICT (mailbox_id, provider_message_id) DO UPDATE SET activity_id = EXCLUDED.activity_id`,
      [row.id, receipt.providerId, receipt.threadId, input.contactId, input.subject, input.body.slice(0, 500), row.email, input.to, activityId],
    );
    return { status: 'sent', reason, messageId, via: row.id };
  });
}

const gmailMessages = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const graphMessages = 'https://graph.microsoft.com/v1.0/me/messages';

function replyMessagePath(base: string, id: string) {
  if (!id || id === '.' || id === '..') throw new AppError(409, 'The provider message is unavailable for replies.');
  return `${base}/${encodeURIComponent(id)}`;
}

async function gmailReplyHeaders(reply: ProviderReply, token: string): Promise<ReplyHeaders> {
  const url = new URL(replyMessagePath(gmailMessages, reply.providerId));
  url.searchParams.set('format', 'metadata');
  for (const header of ['Message-ID', 'References']) url.searchParams.append('metadataHeaders', header);
  const message = await providerJson<{ threadId: string; payload?: { headers?: { name: string; value: string }[] } }>(url, token);
  const headers = new Map((message.payload?.headers ?? []).map(item => [item.name.toLowerCase(), item.value]));
  const messageId = headers.get('message-id')?.trim();
  if (message.threadId !== reply.threadId || !messageId || !messageIdPattern.test(messageId)) {
    throw new AppError(409, 'The original Gmail message does not have a usable reply identifier.');
  }
  return { messageId, references: (headers.get('references') ?? '').match(/<[^<>\s]+>/g) ?? [] };
}

type Recipient = { emailAddress?: { address?: string } };

async function sendThroughProvider(row: MailboxRow, to: string, subject: string, html: string, client: Sql, reply?: ProviderReply) {
  const token = await accessToken(row, client);
  if (row.provider === 'google') {
    const headers = reply ? await gmailReplyHeaders(reply, token) : undefined;
    const raw = Buffer.from(mimeMessage({ from: row.email, to, subject, html, reply: headers })).toString('base64url');
    const sent = await providerJson<{ id: string; threadId: string }>(gmailMessages + '/send', token, {
      method: 'POST', body: JSON.stringify({ raw, threadId: reply?.threadId }),
    });
    return { providerId: sent.id, threadId: sent.threadId };
  }
  const message = { body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }],
    ccRecipients: [], bccRecipients: [] };
  const draft = await providerJson<{
    id: string; conversationId: string; toRecipients?: Recipient[]; ccRecipients?: Recipient[]; bccRecipients?: Recipient[];
  }>(reply ? replyMessagePath(graphMessages, reply.providerId) + '/createReply' : graphMessages, token, {
    method: 'POST', body: JSON.stringify(reply ? { message } : { ...message, subject }),
  }).catch(error => {
    if (error instanceof MailProviderError && error.providerStatus === 403) {
      throw new AppError(409, 'Reconnect Outlook and grant permission to create and send drafts.');
    }
    throw error;
  });
  // Outlook may default to the message's Reply-To address. Send only to the CRM address checked above.
  if (reply && (draft.conversationId !== reply.threadId || draft.toRecipients?.length !== 1
      || draft.toRecipients[0]?.emailAddress?.address?.toLowerCase() !== to.toLowerCase()
      || draft.ccRecipients?.length || draft.bccRecipients?.length)) {
    throw new AppError(409, 'Outlook did not confirm this conversation and its approved recipient.');
  }
  await providerJson(replyMessagePath(graphMessages, draft.id) + '/send', token, { method: 'POST' });
  return { providerId: draft.id, threadId: draft.conversationId };
}

/* ── Sync ─────────────────────────────────────────────────────────────── */

export type SyncedMessage = { providerId: string; threadId: string; from: string; to: string[]; subject: string; snippet: string; at: string };

const address = (value: string) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();

export function parseGmailMessage(message: { id: string; threadId: string; snippet?: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }): SyncedMessage {
  const headers = new Map((message.payload?.headers ?? []).map(item => [item.name.toLowerCase(), item.value]));
  return {
    providerId: message.id, threadId: message.threadId, from: address(headers.get('from') ?? ''),
    to: (headers.get('to') ?? '').split(',').map(address).filter(Boolean), subject: headers.get('subject') ?? '',
    snippet: message.snippet ?? '', at: new Date(Number(message.internalDate) || Date.parse(headers.get('date') ?? '') || Date.now()).toISOString(),
  };
}

export function parseGraphMessage(message: { id: string; conversationId: string; subject?: string; bodyPreview?: string; receivedDateTime?: string; sentDateTime?: string; from?: { emailAddress?: { address?: string } }; toRecipients?: { emailAddress?: { address?: string } }[] }): SyncedMessage {
  return {
    providerId: message.id, threadId: message.conversationId, from: (message.from?.emailAddress?.address ?? '').toLowerCase(),
    to: (message.toRecipients ?? []).map(item => (item.emailAddress?.address ?? '').toLowerCase()).filter(Boolean),
    subject: message.subject ?? '', snippet: message.bodyPreview ?? '', at: new Date(message.receivedDateTime ?? message.sentDateTime ?? Date.now()).toISOString(),
  };
}

async function recordReplies(client: Sql, mailboxId: string, message: SyncedMessage, outbound: boolean, contactId: number) {
  if (!message.threadId) return;
  // History pages can deliver the outbound message after its reply. Reconcile either arrival order.
  const rows = await client.query<{ provider_message_id: string; subject: string; occurred_at: Date }>(
    `SELECT i.provider_message_id, i.subject, i.occurred_at FROM crm_mailbox_messages i
     WHERE i.mailbox_id = $1 AND i.thread_id = $2 AND i.contact_id = $5 AND i.direction = 'inbound'
       AND (CASE WHEN $3 THEN i.occurred_at >= $4 ELSE i.provider_message_id = $6 END)
       AND EXISTS (SELECT 1 FROM crm_mailbox_messages o WHERE o.mailbox_id = i.mailbox_id AND o.thread_id = i.thread_id
         AND o.contact_id = i.contact_id AND o.direction = 'outbound' AND o.occurred_at <= i.occurred_at)
       AND NOT EXISTS (SELECT 1 FROM events e WHERE e.idempotency_key = 'email.replied:' || i.mailbox_id::text || ':' || i.provider_message_id)`,
    [mailboxId, message.threadId, outbound, message.at, contactId, message.providerId],
  );
  for (const row of rows.rows) {
    await emitEvent({
      type: 'email.replied', contactId, entityType: 'mailbox', entityId: mailboxId, occurredAt: row.occurred_at, mailboxId,
      properties: { threadId: message.threadId, messageId: row.provider_message_id, subject: row.subject },
      idempotencyKey: `email.replied:${mailboxId}:${row.provider_message_id}`,
    }, client);
  }
}

/** Logs messages with known contacts as activities; returns how many were new. Emits email.replied for answers to our threads. */
export async function ingestMessages(mailboxId: string, mailboxEmail: string, messages: SyncedMessage[]) {
  let added = 0;
  for (const message of [...messages].sort((left, right) => left.at.localeCompare(right.at))) {
    const outbound = message.from === mailboxEmail;
    const counterpart = outbound ? message.to[0] : message.from;
    if (!counterpart) continue;
    const exists = await db.query('SELECT 1 FROM crm_mailbox_messages WHERE mailbox_id = $1 AND provider_message_id = $2', [mailboxId, message.providerId]);
    if (exists.rows[0]) continue;
    const contact = await findContactByEmail(counterpart);
    if (!contact) continue;
    added += await transaction(async client => {
      const live = await client.query(`SELECT m.id FROM crm_mailboxes m JOIN users u ON m.user_id = u.id
        WHERE m.id = $1 AND m.status <> 'revoked' AND ${activeMailboxUser('u')} FOR UPDATE OF m`, [mailboxId]);
      if (!live.rowCount) return 0;
      const direction = outbound ? 'outbound' : 'inbound';
      const snippet = message.snippet.slice(0, 500);
      const inserted = await client.query(
        `INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, contact_id, direction, subject, snippet, from_email, to_emails, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
        [mailboxId, message.providerId, message.threadId, contact.id, direction, message.subject, snippet, message.from, message.to.join(', '), message.at],
      );
      if (!inserted.rowCount) return 0;
      const activityId = await logActivity({ type: 'email', direction, subject: message.subject, body: snippet,
        occurredAt: message.at, contactId: contact.id, mailboxId }, client);
      await client.query('UPDATE crm_mailbox_messages SET activity_id = $3 WHERE mailbox_id = $1 AND provider_message_id = $2',
        [mailboxId, message.providerId, activityId]);
      await recordReplies(client, mailboxId, message, outbound, contact.id);
      return 1;
    });
  }
  return added;
}

export async function runMailboxSync(data: { mailboxId: string }) {
  const live = `m.id = $1 AND m.status <> 'revoked' AND ${activeMailboxUser('u')}`;
  const row = (await db.query<MailboxRow>(`${mailboxSelect} WHERE ${live}`, [data.mailboxId])).rows[0];
  if (!row) return;
  let cadence = syncEveryMs;
  try {
    const token = await readyAccessToken(row, async client => {
      const { rows: [fresh] } = await client.query<MailboxRow>(`${mailboxSelect} WHERE ${live} FOR UPDATE OF m`, [row.id]);
      if (!fresh) throw new AppError(404, 'That mailbox is no longer active.');
      return fresh;
    });
    const { syncMailboxMessages } = await import('./mailbox-sync');
    const { pending } = await syncMailboxMessages(row, token, messages => ingestMessages(row.id, row.email, messages));
    if (pending) cadence = 30_000;
    else await db.query(`UPDATE crm_mailboxes SET last_synced_at = now(), status = 'connected', last_error = ''
      WHERE id = $1 AND status <> 'revoked'`, [row.id]);
  } catch (error) {
    const expired = (error as { status?: number }).status === 401;
    if (expired) cadence = 30_000;
    await db.query(`UPDATE crm_mailboxes SET status = 'error', last_error = $2,
      access_expires_at = CASE WHEN $3 THEN NULL ELSE access_expires_at END WHERE id = $1 AND status <> 'revoked'`,
    [row.id, (error as Error).message.slice(0, 300), expired]);
  } finally {
    const active = await db.query(`SELECT 1 FROM crm_mailboxes m JOIN users u ON u.id = m.user_id WHERE ${live}`, [row.id]);
    if (active.rowCount) await scheduleSync(row.id, new Date(Date.now() + cadence), cadence);
  }
}

/* ── Endpoints ────────────────────────────────────────────────────────── */

async function overview(user: User, origin: string): Promise<MailboxOverview> {
  const all = user.role === 'admin';
  const rows = await db.query<MailboxRow>(`${mailboxSelect} ${all ? '' : 'WHERE m.user_id = $1'} ORDER BY m.created_at`, all ? [] : [user.id]);
  return {
    providers: (['google', 'microsoft'] as const).map(provider => providerStatus(provider, origin)),
    mailboxes: rows.rows.map(row => toMailbox(row, user.id)), canManageAll: all,
  };
}

type MailboxMember = { userId: string; name: string; email: string };
const memberUpdate = z.object({ userIds: z.array(uuid).max(100) });

async function listMembers(mailboxId: string, ownerId: string) {
  const { rows } = await db.query<{ userId: string | null; name: string | null; email: string | null }>(
    `SELECT u.id AS "userId", u.name, u.email
     FROM crm_mailboxes m LEFT JOIN crm_mailbox_members mm ON mm.mailbox_id = m.id
     LEFT JOIN users u ON u.id = mm.user_id AND ${activeMailboxUser('u')}
     WHERE m.id = $1 AND ${canReadMailbox('m.id', '$2', true)} ORDER BY u.name, u.id`, [mailboxId, ownerId]);
  if (!rows.length) throw new AppError(404, 'That mailbox was not found.');
  return { members: rows.filter((row): row is MailboxMember => row.userId !== null) };
}

async function replaceMembers(mailboxId: string, ownerId: string, userIds: string[]) {
  return transaction(async client => {
    await ownedMailbox(mailboxId, ownerId, client);
    const ids = [...new Set(userIds.map(id => id.toLowerCase()))];
    const { rows } = await client.query<MailboxMember>(
      `SELECT u.id AS "userId", u.name, u.email FROM users u
       WHERE u.id = ANY($1::uuid[]) AND u.id <> $2 AND ${activeMailboxUser('u')} ORDER BY u.name, u.id FOR SHARE`, [ids, ownerId]);
    if (rows.length !== ids.length) throw new AppError(400, 'Choose active teammates with marketer or admin access.');
    const removed = await client.query('DELETE FROM crm_mailbox_members WHERE mailbox_id = $1 AND NOT (user_id = ANY($2::uuid[]))', [mailboxId, ids]);
    const added = await client.query(`INSERT INTO crm_mailbox_members (mailbox_id, user_id)
      SELECT $1, id FROM unnest($2::uuid[]) AS ids(id) ON CONFLICT DO NOTHING`, [mailboxId, ids]);
    if (removed.rowCount || added.rowCount) await audit(ownerId, 'update_members', 'mailbox', mailboxId,
      `${added.rowCount} granted, ${removed.rowCount} removed`, client);
    return { members: rows };
  });
}

export const mailboxEndpoints: Entry[] = [
  route('GET', /^mailboxes$/, async ({ request, user }) => overview(user, requestOrigin(request)), 'marketer'),
  route('GET', /^mailboxes\/mine$/, async ({ user }) => (await db.query<MailboxRow>(
    `${mailboxSelect} WHERE m.user_id = $1 AND m.status <> 'revoked' AND ${activeMailboxUser('u')}`, [user.id])).rows.map(row => toMailbox(row, user.id)), 'marketer'),
  route('POST', /^mailboxes\/connect\/(google|microsoft)$/, async ({ request, params, user }) => {
    const provider = params[0] as MailboxProvider;
    const status = providerStatus(provider, requestOrigin(request));
    if (!status.configured) throw new AppError(409, `${status.label} cannot connect yet. Set ${status.missing.join(', ')} on the server and restart OVELIO.`);
    const state = randomBytes(24).toString('base64url');
    const pkce = pkcePair();
    await db.query(`DELETE FROM crm_mailbox_oauth_states WHERE created_at < now() - interval '15 minutes'`);
    await db.query('INSERT INTO crm_mailbox_oauth_states (state, provider, user_id, code_verifier) VALUES ($1, $2, $3, $4)', [state, provider, user.id, pkce.verifier]);
    return { url: buildAuthUrl(provider, { state, challenge: pkce.challenge, redirectUri: status.redirectUri }) };
  }, 'marketer'),
  route('GET', /^mailboxes\/oauth\/(google|microsoft)\/callback$/, async ({ request, params, query, user }) => {
    const origin = requestOrigin(request);
    const back = new URL('/settings/mailboxes', process.env.APP_ORIGIN || origin);
    try {
      if (query.get('error')) throw new AppError(400, `The provider returned: ${query.get('error_description') || query.get('error')}`);
      const email = await completeConnection(params[0] as MailboxProvider, z.string().min(1).parse(query.get('code')), z.string().min(1).parse(query.get('state')), origin, user.id);
      back.searchParams.set('connected', email);
    } catch (error) {
      back.searchParams.set('error', (error as Error).message.slice(0, 300));
    }
    return Response.redirect(back.toString(), 302);
  }, 'marketer'),
  route('GET', /^mailboxes\/([0-9a-f-]{36})\/members$/, async ({ params, user }) => listMembers(uuid.parse(params[0]), user.id), 'marketer'),
  route('PATCH', /^mailboxes\/([0-9a-f-]{36})\/members$/, async ({ request, params, user }) => {
    const { userIds } = await readBody(request, memberUpdate, 8 * 1024);
    return replaceMembers(uuid.parse(params[0]), user.id, userIds);
  }, 'marketer'),
  route('POST', /^mailboxes\/([0-9a-f-]{36})\/sync$/, async ({ params, user }) => {
    const row = await ownedMailbox(uuid.parse(params[0]), user.id);
    await runMailboxSync({ mailboxId: row.id });
    const { rows: [current] } = await db.query<MailboxRow>(`${mailboxSelect} WHERE m.id = $1 AND m.user_id = $2`, [row.id, user.id]);
    if (!current) throw new AppError(404, 'That mailbox was not found.');
    return toMailbox(current, user.id);
  }, 'marketer'),
  route('DELETE', /^mailboxes\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const id = uuid.parse(params[0]);
    await transaction(async client => {
      const { rows: [account] } = await client.query<{ email: string }>(
        `DELETE FROM crm_mailboxes WHERE id = $1 AND (user_id = $2 OR $3 = 'admin') RETURNING email`, [id, user.id, user.role]);
      if (!account) throw new AppError(404, 'That mailbox was not found.');
      await audit(user.id, 'disconnect', 'mailbox', id, account.email, client);
    });
    return new Response(null, { status: 204 });
  }, 'marketer'),
  ...inboxEndpoints,
  ...inboxTeamEndpoints,
];
