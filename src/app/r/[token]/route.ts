// Click redirect for links in email OVELIO sends itself (src/server/mailer.ts trackLinks). Records one
// `email.clicked` per link per message, then redirects. Only destinations OVELIO signed are followed.
import { createHash } from 'node:crypto';
import { logError } from '@/server/config';
import { db } from '@/server/db';
import { emitEvent } from '@/server/events';
import { linkKey, readClickToken } from '@/server/mailer';
import { drainAfterResponse } from '@/server/platform/after';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Mail security gateways and link previewers follow every link the moment a message arrives. Their visits are
// recorded but flagged, so experiments and reports can leave them out.
const scanner = /bot|crawl|spider|preview|scan|proofpoint|mimecast|barracuda|safelinks|urldefense|headless/i;

function notFound() {
  return new Response('This link is not valid. It may have been copied incompletely.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

async function record(request: Request, messageId: string, url: string) {
  const message = (await db.query<{ contact_id: string | null; campaign_id: string | null; source: string; design_id: string | null; subject: string; sent_at: Date | null }>(
    'SELECT contact_id, campaign_id, source, design_id, subject, sent_at FROM messages WHERE id = $1', [messageId])).rows[0];
  if (!message) return;
  const agent = request.headers.get('user-agent') ?? '';
  const secondsAfterSend = message.sent_at ? (Date.now() - new Date(message.sent_at).getTime()) / 1000 : null;
  const suspectedBot = !agent || scanner.test(agent) || (secondsAfterSend != null && secondsAfterSend < 5);
  await emitEvent({
    type: 'email.clicked', contactId: message.contact_id == null ? null : Number(message.contact_id), campaignId: message.campaign_id,
    entityType: 'message', entityId: messageId, source: message.source,
    properties: { url, linkId: linkKey(url), designId: message.design_id, subject: message.subject, suspectedBot, agent: createHash('sha256').update(agent).digest('hex').slice(0, 12) },
    idempotencyKey: `email.clicked:${messageId}:${linkKey(url)}`,
  });
}

async function handle(request: Request, context: { params: Promise<{ token: string }> }, count: boolean) {
  const target = readClickToken((await context.params).token);
  if (!target) return notFound();
  if (count) {
    try {
      await record(request, target.messageId, target.url);
      drainAfterResponse();
    } catch (error) {
      // A failed count never blocks the recipient from reaching the page.
      logError('email-click', error);
    }
  }
  return new Response(null, { status: 302, headers: { location: target.url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export const GET = (request: Request, context: { params: Promise<{ token: string }> }) => handle(request, context, true);
// HEAD is what link checkers send; it is answered but not counted.
export const HEAD = (request: Request, context: { params: Promise<{ token: string }> }) => handle(request, context, false);
