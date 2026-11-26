// OVELIO's own email sending (lead-owned, docs/rebuild/TRACKER.md §4): sales email, sequences, automation emails and
// studio test sends. Newsletters still go through Listmonk and journey emails through Mautic.
//
// Every send: (1) checks consent and suppression with the directory, (2) resolves merge tags, (3) adds the postal
// address and an unsubscribe link to marketing email, (4) relays through the SMTP policy gateway, which re-checks
// consent, and (5) records the exact rendered message in `messages`. Without a configured gateway (the developer
// preview) nothing is delivered: the message is stored with status `not_sent` and the reason, never reported as sent.

import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { CompanySettings } from '@/contracts';
import type { DirectoryContact } from '@/contracts/platform';
import { renderMergeTags } from '@/contracts/merge-tags';
import { AppError, requiredEnv } from './config';
import { db } from './db';
import { devPreviewCompany, isDevPreviewMode } from './dev-preview';
import { canEmail, findContactByEmail } from './directory';
import { emitEvent } from './events';
import { resolveConditionalBlocks } from './studio/conditions';

export type MessageCategory = 'marketing' | 'sales' | 'transactional' | 'test';
export type MessageStatus = 'sent' | 'failed' | 'blocked' | 'not_sent';

export type SendInput = {
  to: string;
  subject: string;
  /** HTML with OVELIO merge tags. */
  html: string;
  text?: string;
  category: MessageCategory;
  /** Where it came from: 'flow:<id>', 'sequence:<id>', 'studio:test', 'sales:<user id>'. */
  source: string;
  contactId?: number | null;
  campaignId?: string | null;
  designId?: string | null;
  replyTo?: string;
  fromName?: string;
  createdBy?: string | null;
  /** The same key never sends twice; the first result is returned. */
  idempotencyKey?: string;
};

export type SendResult = { messageId: string; status: MessageStatus; reason: string; duplicate: boolean };

const globalMail = globalThis as typeof globalThis & { ovelioTransport?: Transporter | null };

/** The SMTP policy gateway when configured (Docker Compose), otherwise null. */
export function mailTransport(): Transporter | null {
  if (globalMail.ovelioTransport !== undefined) return globalMail.ovelioTransport;
  const host = process.env.SMTP_GATEWAY_HOST;
  const pass = process.env.SMTP_OVELIO_PASSWORD;
  globalMail.ovelioTransport = host && pass
    ? nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_GATEWAY_PORT) || 2525,
        secure: false,
        ignoreTLS: true,
        auth: { user: process.env.SMTP_OVELIO_USERNAME || 'console', pass },
      })
    : null;
  return globalMail.ovelioTransport;
}

/** For tests: replace the transport (null means "not configured"). */
export function setMailTransport(transport: Transporter | null | undefined) {
  globalMail.ovelioTransport = transport;
}

function notConfiguredReason() {
  if (isDevPreviewMode()) return 'Not delivered: the developer preview has no email relay. The rendered message is stored here.';
  if (process.env.SMTP_GATEWAY_HOST && !process.env.SMTP_OVELIO_PASSWORD) {
    return 'Not delivered: set SMTP_OVELIO_PASSWORD (deploy/init-env.sh generates it) so OVELIO can use the email gateway.';
  }
  return 'Not delivered: no email gateway is configured.';
}

async function workspace(): Promise<CompanySettings> {
  if (isDevPreviewMode()) return devPreviewCompany();
  const { company } = await import('./reporting');
  return company();
}

function origin() {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  return 'http://localhost:3100';
}

function unsubscribeSecret() {
  const key = process.env.CONTACT_HMAC_KEY;
  if (!key) throw new Error('CONTACT_HMAC_KEY is required.');
  return key;
}

/** One-click unsubscribe link for an address. The token is the address signed with the workspace HMAC key. */
export function unsubscribeUrl(email: string) {
  const address = Buffer.from(email.trim().toLowerCase()).toString('base64url');
  const signature = createHmac('sha256', unsubscribeSecret()).update('unsubscribe:' + address).digest('base64url').slice(0, 32);
  return `${origin()}/u/${address}.${signature}`;
}

/** The address an unsubscribe token was issued for, or null when the signature does not match. */
export function readUnsubscribeToken(token: string): string | null {
  const [address, signature] = token.split('.');
  if (!address || !signature) return null;
  const expected = createHmac('sha256', unsubscribeSecret()).update('unsubscribe:' + address).digest('base64url').slice(0, 32);
  if (expected.length !== signature.length || expected !== signature) return null;
  const email = Buffer.from(address, 'base64url').toString('utf8');
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

export function mergeValues(contact: DirectoryContact | null, email: string, company: CompanySettings): Record<string, string> {
  return {
    'contact.first_name': contact?.firstName ?? '',
    'contact.last_name': contact?.lastName ?? '',
    'contact.full_name': contact ? `${contact.firstName} ${contact.lastName}`.trim() : '',
    'contact.email': contact?.email ?? email,
    'contact.company': contact?.company ?? '',
    'contact.position': contact?.position ?? '',
    'contact.city': '',
    'contact.country': '',
    'contact.phone': contact?.phone ?? '',
    'workspace.name': company.name,
    'workspace.address': company.postalAddress ?? '',
    'workspace.website': company.website ?? '',
    unsubscribe_url: unsubscribeUrl(email),
    current_year: String(new Date().getFullYear()),
  };
}

/** Marketing email must carry the sender's postal address and a working unsubscribe link. */
function withComplianceFooter(html: string, company: CompanySettings, unsubscribe: string) {
  if (html.includes(unsubscribe)) return html;
  const footer = `<div style="padding:24px 16px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#6b7280">`
    + `${escapeHtml(company.name)}${company.postalAddress ? ' · ' + escapeHtml(company.postalAddress) : ''}<br>`
    + `<a href="${unsubscribe}" style="color:#6b7280">Unsubscribe</a></div>`;
  return html.includes('</body>') ? html.replace('</body>', footer + '</body>') : html + footer;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

type Stored = { id: string; status: MessageStatus; status_reason: string };

async function record(input: SendInput, rendered: { subject: string; html: string; text: string }, from: { email: string; name: string },
  status: MessageStatus, reason: string, providerId: string | null, contactId: number | null) {
  const result = await db.query<Stored>(
    `INSERT INTO messages (category, status, status_reason, to_email, contact_id, from_email, from_name, reply_to, subject, html,
       text_body, campaign_id, design_id, source, provider_message_id, idempotency_key, created_by, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CASE WHEN $2 = 'sent' THEN now() END)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, status, status_reason`,
    [input.category, status, reason, input.to.trim().toLowerCase(), contactId, from.email, from.name, input.replyTo ?? '',
      rendered.subject, rendered.html, rendered.text, input.campaignId ?? null, input.designId ?? null, input.source,
      providerId, input.idempotencyKey ?? null, input.createdBy ?? null],
  );
  return result.rows[0];
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new AppError(400, 'Enter a valid recipient address.');
  if (!input.subject.trim()) throw new AppError(400, 'Add a subject line.');
  if (input.idempotencyKey) {
    const existing = await db.query<Stored>('SELECT id, status, status_reason FROM messages WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (existing.rows[0]) return { messageId: existing.rows[0].id, status: existing.rows[0].status, reason: existing.rows[0].status_reason, duplicate: true };
  }
  const [company, contact, permission] = await Promise.all([workspace(), findContactByEmail(to), canEmail(to)]);
  const values = mergeValues(contact, to, company);
  const subject = renderMergeTags(input.subject, values, { html: false });
  // Conditional blocks from the email studio are kept or dropped for this recipient before merge tags are filled.
  let html = renderMergeTags(resolveConditionalBlocks(input.html, contact), values);
  if (input.category === 'marketing' || input.category === 'sales') html = withComplianceFooter(html, company, values.unsubscribe_url);
  const rendered = { subject, html, text: input.text ? renderMergeTags(input.text, values, { html: false }) : htmlToText(html) };
  const from = { email: (process.env.SMTP_FROM_EMAIL || 'hello@ovelio.test').toLowerCase(), name: input.fromName || process.env.MAIL_FROM_NAME || company.name || 'OVELIO' };
  const contactId = input.contactId ?? contact?.id ?? null;

  const finish = async (status: MessageStatus, reason: string, providerId: string | null = null) => {
    const stored = await record(input, rendered, from, status, reason, providerId, contactId);
    if (!stored) {
      const again = await db.query<Stored>('SELECT id, status, status_reason FROM messages WHERE idempotency_key = $1', [input.idempotencyKey]);
      return { messageId: again.rows[0].id, status: again.rows[0].status, reason: again.rows[0].status_reason, duplicate: true };
    }
    if (status === 'sent') {
      await emitEvent({
        type: 'email.sent', contactId, campaignId: input.campaignId ?? null, entityType: 'message', entityId: stored.id,
        source: input.source, actorId: input.createdBy ?? null, properties: { category: input.category, subject, designId: input.designId ?? null },
        idempotencyKey: 'email.sent:' + stored.id,
      });
    }
    return { messageId: stored.id, status, reason, duplicate: false };
  };

  if (!permission.allowed) return finish('blocked', `Not sent: ${permission.reason ?? 'this address may not be emailed.'}`);
  const transport = mailTransport();
  if (!transport) return finish('not_sent', notConfiguredReason());
  try {
    const unsubscribe = values.unsubscribe_url;
    const info = await transport.sendMail({
      from: { address: from.email, name: from.name },
      to,
      replyTo: input.replyTo || undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: input.category === 'marketing' || input.category === 'sales'
        ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
        : undefined,
    });
    return finish('sent', 'Accepted by the email gateway.', info.messageId ?? null);
  } catch (error) {
    const failure = error as { responseCode?: number; response?: string; message?: string };
    const reason = failure.responseCode === 550
      ? 'Rejected by the email policy: the recipient has no active consent or is suppressed.'
      : `Delivery failed: ${(failure.response || failure.message || 'unknown error').slice(0, 200)}`;
    return finish(failure.responseCode === 550 ? 'blocked' : 'failed', reason);
  }
}

/** Sends a saved email design (designs.kind = 'email') to one recipient. */
export async function sendDesign(designId: string, input: Omit<SendInput, 'subject' | 'html' | 'designId'> & { subject?: string }): Promise<SendResult> {
  const design = await db.query<{ subject: string; html: string; kind: string }>('SELECT subject, html, kind FROM designs WHERE id = $1', [designId]);
  const row = design.rows[0];
  if (!row || row.kind !== 'email') throw new AppError(404, 'That email design was not found.');
  if (!row.html.trim()) throw new AppError(409, 'Save the email design before sending it.');
  return sendEmail({ ...input, designId, subject: input.subject || row.subject, html: row.html });
}

/** Records an unsubscribe from a one-click link. */
export async function unsubscribe(email: string, evidence: string) {
  if (isDevPreviewMode()) {
    const { devPreviewContacts } = await import('./dev-preview');
    const contact = devPreviewContacts().find(item => item.email === email.trim().toLowerCase());
    if (contact) {
      contact.suppressed = true;
      contact.consent = 'suppressed';
    }
    return;
  }
  requiredEnv('CONTACT_HMAC_KEY');
  const { receiveSuppression } = await import('./audience');
  await receiveSuppression(email, 'unsubscribe', evidence);
}
