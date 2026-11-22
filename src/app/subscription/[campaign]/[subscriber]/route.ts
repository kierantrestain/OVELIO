import { z } from 'zod';
import { unsubscribe } from '@/server/delivery';
import { json } from '@/server/http';

// The native unsubscribe UUID pair is the authorization for a POST. A bare one-click POST leaves the
// campaign's lists. Blocklisting everything and the preferences form are explicit fields in the body.
export async function POST(request: Request, context: { params: Promise<{ campaign: string; subscriber: string }> }) {
  const ids = z.object({ campaign: z.uuid(), subscriber: z.uuid() }).safeParse(await context.params);
  if (!ids.success) return json({ error: 'This unsubscribe link is invalid.' }, 400);
  const form = new URLSearchParams(await request.text().then(text => text.slice(0, 8192)).catch(() => ''));
  const result = await unsubscribe(ids.data, form);
  if ('error' in result) return json({ error: result.error }, result.status);
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': result.contentType, 'Cache-Control': 'no-store' },
  });
}
