// Connected Gmail (Google OAuth 2 + Gmail API) and Outlook (Microsoft identity platform + Graph) mailboxes. Each user
// connects their own with state + PKCE; refresh and access tokens are AES-256-GCM encrypted with MAILBOX_ENCRYPTION_KEY.
// Sales email can be sent through the provider; the 'crm.mailbox_sync' job logs recent conversations with known
// contacts as activities and emits email.replied when a contact answers a thread sent from OVELIO's side.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { User } from '@/contracts';
import type { InboxConversation, Mailbox, MailboxOverview, MailboxProvider, ProviderStatus, SalesEmailResult } from '@/contracts/crm';
import { AppError } from '../config';
import { db } from '../db';
import { requestOrigin } from '../dev-preview';
import { canEmail, findContactByEmail } from '../directory';
import { audit, emitEvent } from '../events';
import { htmlToText } from '../mailer';
import { schedulePlatformJob } from '../platform/jobs';
import { logActivity } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { textToHtml } from './people';
import { uuid } from './shared';

export const MAILBOX_SYNC_JOB = 'crm.mailbox_sync';
const syncEveryMs = 15 * 60_000;

/** One job key per slot: a running sync cannot reschedule its own key (it would re-run at once). */
async function scheduleSync(mailboxId: string, runAt: Date) {
  await schedulePlatformJob(MAILBOX_SYNC_JOB, `${mailboxId}:${Math.floor(runAt.getTime() / syncEveryMs)}`, { mailboxId }, { runAt });
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
      scopes: ['offline_access', 'openid', 'email', 'User.Read', 'Mail.Send', 'Mail.Read'],
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

async function tokenRequest(provider: MailboxProvider, body: Record<string, string>): Promise<TokenResponse> {
  const config = providers()[provider];
  const response = await fetch(config.token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env[config.idVar] ?? '', client_secret: process.env[config.secretVar] ?? '', ...body }),
  });
  const data = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !data.access_token) throw new AppError(502, `${config.label} refused the sign-in: ${data.error_description || data.error || response.status}.`);
  return data;
}

async function providerJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AppError(502, `The mail provider answered ${response.status}: ${text.slice(0, 160)}`);
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

const toMailbox = (row: MailboxRow): Mailbox => ({
  id: row.id, provider: row.provider, email: row.email, userId: row.user_id, userName: row.user_name ?? '', status: row.status,
  lastError: row.last_error, lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString(),
});

async function mailboxRow(id: string): Promise<MailboxRow> {
  const row = (await db.query<MailboxRow>(`${mailboxSelect} WHERE m.id = $1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'That mailbox was not found.');
  return row;
}

async function accessToken(row: MailboxRow): Promise<string> {
  if (row.access_token_enc && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now() + 60_000) return decryptToken(row.access_token_enc);
  try {
    const token = await tokenRequest(row.provider, { grant_type: 'refresh_token', refresh_token: decryptToken(row.refresh_token_enc) });
    await db.query(
      `UPDATE crm_mailboxes SET access_token_enc = $2, access_expires_at = now() + ($3 || ' seconds')::interval, status = 'connected', last_error = '',
         refresh_token_enc = coalesce($4, refresh_token_enc), updated_at = now() WHERE id = $1`,
      [row.id, encryptToken(token.access_token), String(token.expires_in ?? 3000), token.refresh_token ? encryptToken(token.refresh_token) : null],
    );
    return token.access_token;
  } catch (error) {
    await db.query(`UPDATE crm_mailboxes SET status = 'error', last_error = $2, updated_at = now() WHERE id = $1`, [row.id, (error as Error).message.slice(0, 300)]);
    throw error;
  }
}

async function completeConnection(provider: MailboxProvider, code: string, state: string, origin: string) {
  const stored = (await db.query<{ user_id: string; code_verifier: string; provider: string }>(
    `DELETE FROM crm_mailbox_oauth_states WHERE state = $1 AND created_at > now() - interval '15 minutes' RETURNING user_id, code_verifier, provider`, [state])).rows[0];
  if (!stored || stored.provider !== provider) throw new AppError(400, 'This sign-in link expired. Start the connection again.');
  const token = await tokenRequest(provider, { grant_type: 'authorization_code', code, code_verifier: stored.code_verifier, redirect_uri: redirectUri(provider, origin) });
  if (!token.refresh_token) throw new AppError(502, 'The provider did not grant offline access. Remove OVELIO from the account’s connected apps and connect again.');
  const email = provider === 'google'
    ? (await providerJson<{ email?: string }>('https://openidconnect.googleapis.com/v1/userinfo', token.access_token)).email
    : await providerJson<{ mail?: string; userPrincipalName?: string }>('https://graph.microsoft.com/v1.0/me', token.access_token).then(me => me.mail || me.userPrincipalName);
  if (!email) throw new AppError(502, 'The provider did not return the mailbox address.');
  const saved = await db.query<{ id: string }>(
    `INSERT INTO crm_mailboxes (user_id, provider, email, refresh_token_enc, access_token_enc, access_expires_at, scope)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval, $7)
     ON CONFLICT (provider, email) DO UPDATE SET user_id = EXCLUDED.user_id, refresh_token_enc = EXCLUDED.refresh_token_enc,
       access_token_enc = EXCLUDED.access_token_enc, access_expires_at = EXCLUDED.access_expires_at, scope = EXCLUDED.scope,
       status = 'connected', last_error = '', updated_at = now()
     RETURNING id`,
    [stored.user_id, provider, email.toLowerCase(), encryptToken(token.refresh_token), encryptToken(token.access_token), String(token.expires_in ?? 3000), token.scope ?? ''],
  );
  await audit(stored.user_id, 'connect', 'mailbox', saved.rows[0].id, `${provider}: ${email}`);
  await scheduleSync(saved.rows[0].id, new Date());
  return email.toLowerCase();
}

/* ── Sending ──────────────────────────────────────────────────────────── */

const header = (value: string) => /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

export function mimeMessage(input: { from: string; to: string; subject: string; html: string }) {
  return [
    `From: ${input.from}`, `To: ${input.to}`, `Subject: ${header(input.subject)}`, 'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(input.html).toString('base64'),
  ].join('\r\n');
}

export async function sendFromMailbox(mailboxId: string, input: { contactId: number; to: string; subject: string; body: string; dealId: string | null }, user: { id: string }): Promise<SalesEmailResult> {
  const row = await mailboxRow(uuid.parse(mailboxId));
  if (row.user_id !== user.id) throw new AppError(403, 'Send from your own connected mailbox.');
  const html = textToHtml(input.body);
  const record = async (status: SalesEmailResult['status'], reason: string, providerId: string | null) => (await db.query<{ id: string }>(
    `INSERT INTO messages (category, status, status_reason, to_email, contact_id, from_email, subject, html, text_body, source, provider_message_id, created_by, sent_at)
     VALUES ('sales', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $1 = 'sent' THEN now() END) RETURNING id`,
    [status, reason, input.to, input.contactId, row.email, input.subject, html, htmlToText(html), `mailbox:${row.id}`, providerId, user.id])).rows[0].id;
  const permission = await canEmail(input.to);
  if (!permission.allowed) {
    const reason = `Not sent: ${permission.reason ?? 'this address may not be emailed.'}`;
    return { status: 'blocked', reason, messageId: await record('blocked', reason, null), via: row.id };
  }
  try {
    const token = await accessToken(row);
    let providerId: string;
    let threadId: string;
    if (row.provider === 'google') {
      const sent = await providerJson<{ id: string; threadId: string }>('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', token, {
        method: 'POST', body: JSON.stringify({ raw: Buffer.from(mimeMessage({ from: row.email, to: input.to, subject: input.subject, html })).toString('base64url') }),
      });
      providerId = sent.id;
      threadId = sent.threadId;
    } else {
      const draft = await providerJson<{ id: string; conversationId: string }>('https://graph.microsoft.com/v1.0/me/messages', token, {
        method: 'POST', body: JSON.stringify({ subject: input.subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: input.to } }] }),
      });
      await providerJson(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draft.id)}/send`, token, { method: 'POST' });
      providerId = draft.id;
      threadId = draft.conversationId;
    }
    const messageId = await record('sent', `Sent from ${row.email}.`, providerId);
    const activityId = await logActivity({ type: 'email', direction: 'outbound', subject: input.subject, body: input.body.slice(0, 5000), contactId: input.contactId, dealId: input.dealId, messageId, authorId: user.id });
    await db.query(
      `INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, contact_id, direction, subject, from_email, to_emails, activity_id)
       VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [row.id, providerId, threadId, input.contactId, input.subject, row.email, input.to, activityId],
    );
    return { status: 'sent', reason: `Sent from ${row.email}.`, messageId, via: row.id };
  } catch (error) {
    const reason = `Delivery failed: ${(error as Error).message.slice(0, 200)}`;
    return { status: 'failed', reason, messageId: await record('failed', reason, null), via: row.id };
  }
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

async function fetchRecent(row: MailboxRow, token: string): Promise<SyncedMessage[]> {
  if (row.provider === 'google') {
    const list = await providerJson<{ messages?: { id: string }[] }>('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=40&q=newer_than%3A3d', token);
    const out: SyncedMessage[] = [];
    for (const item of list.messages ?? []) {
      out.push(parseGmailMessage(await providerJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, token)));
    }
    return out;
  }
  const list = await providerJson<{ value?: Parameters<typeof parseGraphMessage>[0][] }>(
    'https://graph.microsoft.com/v1.0/me/messages?$top=40&$orderby=receivedDateTime%20desc&$select=id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime', token);
  return (list.value ?? []).map(parseGraphMessage);
}

/** Logs messages with known contacts as activities; returns how many were new. Emits email.replied for answers to our threads. */
export async function ingestMessages(mailboxId: string, mailboxEmail: string, messages: SyncedMessage[]) {
  let added = 0;
  for (const message of messages) {
    const outbound = message.from === mailboxEmail;
    const counterpart = outbound ? message.to[0] : message.from;
    if (!counterpart) continue;
    const exists = await db.query('SELECT 1 FROM crm_mailbox_messages WHERE mailbox_id = $1 AND provider_message_id = $2', [mailboxId, message.providerId]);
    if (exists.rows[0]) continue;
    const contact = await findContactByEmail(counterpart);
    if (!contact) continue;
    const ourThread = await db.query(`SELECT 1 FROM crm_mailbox_messages WHERE mailbox_id = $1 AND thread_id = $2 AND direction = 'outbound' LIMIT 1`, [mailboxId, message.threadId]);
    const activityId = await logActivity({ type: 'email', direction: outbound ? 'outbound' : 'inbound', subject: message.subject, body: message.snippet, occurredAt: message.at, contactId: contact.id });
    await db.query(
      `INSERT INTO crm_mailbox_messages (mailbox_id, provider_message_id, thread_id, contact_id, direction, subject, snippet, from_email, to_emails, occurred_at, activity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
      [mailboxId, message.providerId, message.threadId, contact.id, outbound ? 'outbound' : 'inbound', message.subject, message.snippet.slice(0, 500), message.from, message.to.join(', '), message.at, activityId],
    );
    if (!outbound && ourThread.rows[0]) {
      await emitEvent({
        type: 'email.replied', contactId: contact.id, entityType: 'mailbox', entityId: mailboxId, occurredAt: message.at,
        properties: { threadId: message.threadId, messageId: message.providerId, subject: message.subject }, idempotencyKey: `email.replied:${mailboxId}:${message.providerId}`,
      });
    }
    added++;
  }
  return added;
}

export async function runMailboxSync(data: { mailboxId: string }) {
  const row = (await db.query<MailboxRow>(`${mailboxSelect} WHERE m.id = $1`, [data.mailboxId])).rows[0];
  if (!row || row.status === 'revoked') return;
  try {
    const token = await accessToken(row);
    await ingestMessages(row.id, row.email, await fetchRecent(row, token));
    await db.query(`UPDATE crm_mailboxes SET last_synced_at = now(), status = 'connected', last_error = '' WHERE id = $1`, [row.id]);
  } catch (error) {
    await db.query(`UPDATE crm_mailboxes SET status = 'error', last_error = $2 WHERE id = $1`, [row.id, (error as Error).message.slice(0, 300)]);
  } finally {
    await scheduleSync(row.id, new Date(Date.now() + syncEveryMs));
  }
}

/* ── Inbox ────────────────────────────────────────────────────────────── */

export async function inbox(): Promise<InboxConversation[]> {
  const rows = await db.query<{ contact_id: string | null; subject: string; body: string; direction: 'inbound' | 'outbound' | null; at: Date; count: string; source: string; email: string | null }>(
    `WITH items AS (
       SELECT a.contact_id, a.subject, a.body, a.direction, a.occurred_at AS at, CASE WHEN mm.activity_id IS NOT NULL THEN 'mailbox' ELSE 'logged' END AS source, NULL::text AS email
       FROM activities a LEFT JOIN crm_mailbox_messages mm ON mm.activity_id = a.id WHERE a.type = 'email' AND a.contact_id IS NOT NULL
       UNION ALL
       SELECT m.contact_id, m.subject, m.status_reason, 'outbound', m.created_at, 'sent', m.to_email FROM messages m
       WHERE m.category = 'sales' AND m.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.message_id = m.id)
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY contact_id ORDER BY at DESC) AS n, count(*) OVER (PARTITION BY contact_id) AS count FROM items
     )
     SELECT contact_id, subject, body, direction, at, count, source, email FROM ranked WHERE n = 1 ORDER BY at DESC LIMIT 100`,
  );
  const { getContacts } = await import('../directory');
  const contacts = await getContacts(rows.rows.flatMap(row => row.contact_id ? [Number(row.contact_id)] : []));
  return rows.rows.map(row => {
    const contact = row.contact_id ? contacts.get(Number(row.contact_id)) : undefined;
    return {
      contactId: row.contact_id ? Number(row.contact_id) : null, contactName: contact?.name ?? row.email ?? 'Unknown contact',
      contactEmail: contact?.email ?? row.email ?? '', subject: row.subject, snippet: row.body.slice(0, 200), direction: row.direction,
      at: new Date(row.at).toISOString(), count: Number(row.count), source: row.source as InboxConversation['source'],
    };
  });
}

/* ── Endpoints ────────────────────────────────────────────────────────── */

async function overview(user: User, origin: string): Promise<MailboxOverview> {
  const all = user.role === 'admin';
  const rows = await db.query<MailboxRow>(`${mailboxSelect} ${all ? '' : 'WHERE m.user_id = $1'} ORDER BY m.created_at`, all ? [] : [user.id]);
  return { providers: (['google', 'microsoft'] as const).map(provider => providerStatus(provider, origin)), mailboxes: rows.rows.map(toMailbox), canManageAll: all };
}

export const mailboxEndpoints: Entry[] = [
  route('GET', /^mailboxes$/, async ({ request, user }) => overview(user, requestOrigin(request)), 'marketer'),
  route('GET', /^mailboxes\/mine$/, async ({ user }) => (await db.query<MailboxRow>(`${mailboxSelect} WHERE m.user_id = $1 AND m.status <> 'revoked'`, [user.id])).rows.map(toMailbox), 'marketer'),
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
  route('GET', /^mailboxes\/oauth\/(google|microsoft)\/callback$/, async ({ request, params, query }) => {
    const origin = requestOrigin(request);
    const back = new URL('/settings/mailboxes', process.env.APP_ORIGIN || origin);
    try {
      if (query.get('error')) throw new AppError(400, `The provider returned: ${query.get('error_description') || query.get('error')}`);
      const email = await completeConnection(params[0] as MailboxProvider, z.string().min(1).parse(query.get('code')), z.string().min(1).parse(query.get('state')), origin);
      back.searchParams.set('connected', email);
    } catch (error) {
      back.searchParams.set('error', (error as Error).message.slice(0, 300));
    }
    return Response.redirect(back.toString(), 302);
  }, 'marketer'),
  route('POST', /^mailboxes\/([0-9a-f-]{36})\/sync$/, async ({ params, user }) => {
    const row = await mailboxRow(uuid.parse(params[0]));
    if (row.user_id !== user.id && user.role !== 'admin') throw new AppError(403, 'Only the mailbox owner or an admin can sync it.');
    await runMailboxSync({ mailboxId: row.id });
    return toMailbox(await mailboxRow(row.id));
  }, 'marketer'),
  route('DELETE', /^mailboxes\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const row = await mailboxRow(uuid.parse(params[0]));
    if (row.user_id !== user.id && user.role !== 'admin') throw new AppError(403, 'Only the mailbox owner or an admin can disconnect it.');
    await db.query('DELETE FROM crm_mailboxes WHERE id = $1', [row.id]);
    await audit(user.id, 'disconnect', 'mailbox', row.id, row.email);
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^sales\/inbox$/, async () => inbox(), 'marketer'),
];
