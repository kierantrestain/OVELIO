import type { InboxMessageContent, MailboxProvider } from '@/contracts/crm';
import { AppError } from '../config';
import { db } from '../db';
import { readBodyBytes } from '../http';
import { canReadMailbox } from '../mailbox-access';
import { htmlToText } from '../mailer';
import { mailProviderFetch, withReadableMailboxMessage } from './mailboxes';

const maxFile = 10 * 1024 * 1024;
const maxProviderDocument = 15 * 1024 * 1024; // Encoded provider documents can include inline file data.
const maxText = 250_000;
const graphRoot = 'https://graph.microsoft.com/v1.0/me/messages/';
const gmailRoot = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/';

function segment(value: string) {
  if (!value || value === '.' || value === '..') throw new AppError(404, 'That provider item was not found.');
  return encodeURIComponent(value);
}

function providerMessage(provider: MailboxProvider, messageId: string) {
  return (provider === 'google' ? gmailRoot : graphRoot) + segment(messageId);
}

async function contentBytes(url: string | URL, token: string, limit: number, headers?: HeadersInit) {
  const response = await mailProviderFetch(url, token, { headers }).catch(() => {
    throw new AppError(502, 'The mail provider could not be reached. Try again.');
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 404 || response.status === 410) throw new AppError(404, 'This item is no longer available from the mail provider.');
    if (response.status === 401 || response.status === 403) throw new AppError(409, 'The mailbox owner needs to reconnect this provider.');
    if (response.status === 429) throw new AppError(429, 'The mail provider is busy. Try again shortly.');
    throw new AppError(502, 'The mail provider could not load this item.');
  }
  try {
    return await readBodyBytes(response, limit);
  } catch (error) {
    if (error instanceof AppError && error.status === 413) {
      await response.body?.cancel().catch(() => undefined);
      throw new AppError(413, 'This item exceeds the mailbox content size limit.');
    }
    throw new AppError(502, 'The mail provider response was interrupted. Try again.');
  }
}

async function contentJson<T>(url: string | URL, token: string, headers?: HeadersInit): Promise<T> {
  const bytes = await contentBytes(url, token, maxProviderDocument, headers);
  try {
    return JSON.parse(bytes.toString('utf8')) as T;
  } catch {
    throw new AppError(502, 'The mail provider returned an invalid response.');
  }
}

type GmailBody = { attachmentId?: string; data?: string; size?: number };
type GmailPart = {
  partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[];
  body?: GmailBody; parts?: GmailPart[];
};
type Attachment = InboxMessageContent['attachments'][number];

function filename(value?: string) {
  return value?.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim().slice(0, 180).toWellFormed() || 'attachment';
}

function sizeOf(value?: number) {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function file(id: string, name: string | undefined, size: number, supported: boolean): Attachment {
  return { id, name: filename(name), size, downloadable: supported && size <= maxFile };
}

function gmailParts(root?: GmailPart) {
  const bodies: GmailPart[] = [];
  const attachments: { display: Attachment; content: GmailBody }[] = [];
  let count = 0;
  const visit = (part: GmailPart, position: string, depth: number) => {
    if (depth > 32 || ++count > 512) throw new AppError(413, 'This message has too many parts to display.');
    const disposition = part.headers?.find(h => h.name.toLowerCase() === 'content-disposition')?.value;
    if (part.filename || /^attachment\b/i.test(disposition ?? '')) {
      if (part.body) attachments.push({
        display: file(position, part.filename, sizeOf(part.body.size), Boolean(part.body.attachmentId) || typeof part.body.data === 'string'),
        content: part.body,
      });
    } else if (part.parts?.length) {
      part.parts.forEach((child, index) => visit(child, `${position}.${index}`, depth + 1));
    } else if (/^text\/(plain|html)$/i.test(part.mimeType ?? '') && part.body) {
      bodies.push(part);
    }
  };
  if (root) visit(root, '0', 0);
  return { bodies, attachments };
}

async function gmailBody(base: string, content: GmailBody, token: string) {
  if (!content.attachmentId) return Buffer.from(content.data ?? '', 'base64url');
  const body = await contentJson<GmailBody>(`${base}/attachments/${segment(content.attachmentId)}`, token);
  if (typeof body.data !== 'string') throw new AppError(502, 'The provider did not include the attachment data.');
  return Buffer.from(body.data, 'base64url');
}

async function gmailDocument(base: string, token: string) {
  const content = await contentJson<{ payload?: GmailPart }>(`${base}?format=full`, token);
  return gmailParts(content.payload);
}

type GraphAttachment = { id: string; name?: string; size?: number; '@odata.type'?: string };
const graphFile = (item: GraphAttachment) => file(item.id, item.name, sizeOf(item.size), item['@odata.type'] === '#microsoft.graph.fileAttachment');

function boundedText(body: string, hasMore = false) {
  return body.length <= maxText && !hasMore ? body : body.slice(0, maxText) + '\n\n[The rest of this message exceeds the viewing limit.]';
}

async function graphFiles(base: string, token: string) {
  const expected = new URL(base + '/attachments');
  let next: URL | null = new URL(expected);
  next.searchParams.set('$select', 'id,name,size');
  const items: Attachment[] = [];
  const pages = new Set<string>();
  while (next) {
    if (pages.has(next.href) || pages.size >= 8) throw new AppError(502, 'The provider returned an unsupported attachment list.');
    pages.add(next.href);
    const page: { value?: GraphAttachment[]; '@odata.nextLink'?: string } = await contentJson(next, token);
    items.push(...(page.value ?? []).map(graphFile));
    next = page['@odata.nextLink'] ? new URL(page['@odata.nextLink']) : null;
    if (next && (next.origin !== expected.origin || next.pathname !== expected.pathname || items.length >= 250 || !page.value?.length)) {
      throw new AppError(502, 'The provider returned an unsupported attachment list.');
    }
  }
  return items;
}

function decodePart(part: GmailPart, data: Buffer) {
  const contentType = part.headers?.find(item => item.name.toLowerCase() === 'content-type')?.value ?? '';
  const charset = /\bcharset\s*=\s*"?([a-z\d_-]+)"?/i.exec(contentType)?.[1] ?? 'utf-8';
  try { return new TextDecoder(charset).decode(data); } catch { return data.toString('utf8'); }
}

export async function readMessageContent(viewerId: string, mailboxId: string, messageId: string): Promise<InboxMessageContent> {
  // OVELIO already holds the full text for its own sends. In particular, a
  // Graph draft ID can change when the message moves to Sent Items.
  const { rows: [local] } = await db.query<{ text_body: string }>(
    `SELECT m.text_body FROM crm_mailbox_messages mm JOIN messages m ON m.mailbox_id = mm.mailbox_id
       AND m.provider_message_id = mm.provider_message_id AND m.status = 'sent'
     WHERE mm.mailbox_id = $1 AND mm.provider_message_id = $2 AND mm.direction = 'outbound'
       AND ${canReadMailbox('mm.mailbox_id', '$3')} ORDER BY m.created_at DESC LIMIT 1`, [mailboxId, messageId, viewerId]);
  if (local) return { body: boundedText(local.text_body), attachments: [] };
  return withReadableMailboxMessage(viewerId, mailboxId, messageId, async (provider, token) => {
    const base = providerMessage(provider, messageId);
    if (provider === 'google') {
      const { bodies, attachments } = await gmailDocument(base, token);
      const plain = bodies.filter(part => part.mimeType?.toLowerCase() === 'text/plain');
      const parts = plain.length ? plain : bodies;
      let body = '';
      let linkedParts = 0;
      let hasMore = false;
      for (const part of parts) {
        if (body.length > maxText || (part.body?.attachmentId && ++linkedParts > 8)) {
          hasMore = true;
          break;
        }
        const value = decodePart(part, await gmailBody(base, part.body!, token));
        body += (body ? '\n\n' : '') + (part.mimeType?.toLowerCase() === 'text/html' ? htmlToText(value) : value);
      }
      return { body: boundedText(body, hasMore), attachments: attachments.map(part => part.display) };
    }
    const message = await contentJson<{ body?: { contentType?: string; content?: string }; hasAttachments?: boolean }>(
      `${base}?$select=body,hasAttachments`, token, { prefer: 'outlook.body-content-type="text"' },
    );
    const raw = message.body?.content ?? '';
    return {
      body: boundedText(message.body?.contentType?.toLowerCase() === 'html' ? htmlToText(raw) : raw),
      attachments: message.hasAttachments ? await graphFiles(base, token) : [],
    };
  });
}

function checkDownload(attachment: Attachment) {
  if (attachment.size > maxFile) throw new AppError(413, 'Attachments larger than 10 MiB are available in the mail provider.');
  if (!attachment.downloadable) throw new AppError(415, 'Open this attachment in the mail provider.');
}

export function downloadAttachment(viewerId: string, mailboxId: string, messageId: string, attachmentId: string) {
  return withReadableMailboxMessage(viewerId, mailboxId, messageId, async (provider, token) => {
    const base = providerMessage(provider, messageId);
    let attachment: Attachment;
    let bytes: Buffer;
    if (provider === 'google') {
      const found = (await gmailDocument(base, token)).attachments.find(part => part.display.id === attachmentId);
      if (!found) throw new AppError(404, 'That attachment was not found on this message.');
      attachment = found.display;
      checkDownload(attachment);
      bytes = await gmailBody(base, found.content, token);
    } else {
      const url = `${base}/attachments/${segment(attachmentId)}`;
      attachment = graphFile(await contentJson<GraphAttachment>(`${url}?$select=id,name,size`, token));
      checkDownload(attachment);
      bytes = await contentBytes(`${url}/$value`, token, maxFile);
    }
    if (bytes.length > maxFile) throw new AppError(413, 'Attachments larger than 10 MiB are available in the mail provider.');
    const ascii = attachment.name.replace(/[^A-Za-z0-9_. -]/g, '_') || 'attachment';
    const encoded = encodeURIComponent(attachment.name).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
