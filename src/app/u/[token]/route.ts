// One-click unsubscribe for email OVELIO sends itself (src/server/mailer.ts). GET asks for confirmation so link
// scanners cannot unsubscribe anyone; POST (the form, or a mail client's RFC 8058 one-click request) records it.
import { emitEvent } from '@/server/events';
import { logError } from '@/server/config';
import { findContactByEmail } from '@/server/directory';
import { readUnsubscribeToken, unsubscribe } from '@/server/mailer';
import { drainAfterResponse } from '@/server/platform/after';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f6f8;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827}
main{max-width:440px;margin:24px;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 1px 2px rgb(0 0 0 / .04)}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 20px;color:#4b5563}button{font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:8px;background:#2457d6;color:#fff;cursor:pointer}</style>
</head><body><main>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const email = readUnsubscribeToken((await context.params).token);
  if (!email) return page('Link not recognised', '<h1>This link is not valid</h1><p>It may have been copied incompletely. Use the unsubscribe link in the latest email you received.</p>', 404);
  return page('Unsubscribe', `<h1>Unsubscribe?</h1><p>Stop marketing and sales email to <strong>${escape(email)}</strong>.</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  const email = readUnsubscribeToken((await context.params).token);
  if (!email) return page('Link not recognised', '<h1>This link is not valid</h1>', 404);
  try {
    await unsubscribe(email, 'One-click unsubscribe link');
    const contact = await findContactByEmail(email).catch(() => null);
    await emitEvent({ type: 'email.unsubscribed', contactId: contact?.id ?? null, source: 'unsubscribe-link', idempotencyKey: `unsubscribe:${email}:${new Date().toISOString().slice(0, 10)}` });
    drainAfterResponse();
  } catch (error) {
    logError('unsubscribe', error);
    return page('Try again', '<h1>We could not record that</h1><p>Please try again in a minute.</p>', 503);
  }
  return page('Unsubscribed', `<h1>You're unsubscribed</h1><p>${escape(email)} will not receive further marketing or sales email from us.</p>`);
}
