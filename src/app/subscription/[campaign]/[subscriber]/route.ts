import { z } from 'zod';
import { json } from '@/server/http';

// The native unsubscribe UUID pair is the authorization for a one-click POST.
export async function POST(_request: Request, context: { params: Promise<{ campaign: string; subscriber: string }> }) {
  const ids = z.object({ campaign: z.uuid(), subscriber: z.uuid() }).safeParse(await context.params);
  if (!ids.success) return json({ error: 'This unsubscribe link is invalid.' }, 400);
  const base = process.env.LISTMONK_URL;
  if (!base) return json({ error: 'Unsubscribe is temporarily unavailable.' }, 503);
  try {
    const { campaign, subscriber } = ids.data;
    const response = await fetch(new URL('/subscription/' + campaign + '/' + subscriber, base), {
      method: 'POST',
      body: new URLSearchParams({ blocklist: 'true' }),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return json({ error: 'The unsubscribe request could not be completed. Check the link and try again.' }, response.status === 404 ? 404 : 502);
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch {
    return json({ error: 'Unsubscribe is temporarily unavailable. Please try again.' }, 503);
  }
}
