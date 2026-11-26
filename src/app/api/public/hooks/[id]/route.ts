// Inbound webhook endpoint (src/server/journeys/hooks.ts). Rate limited per hook and per sender address.
import { z } from 'zod';
import { rateLimit } from '@/server/auth';
import { json, respondError } from '@/server/http';
import { receiveHook } from '@/server/journeys/hooks';
import { drainAfterResponse } from '@/server/platform/after';
import { clientIp, hashIp } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await rateLimit('public:hook-ip:' + hashIp(clientIp(request)), 240, 60);
    if (!z.uuid().safeParse(id).success) return json({ error: 'Unknown webhook.' }, 404);
    const hookId = id.toLowerCase();
    await rateLimit('public:hook:' + hookId, 600, 60);
    const response = await receiveHook(hookId, request);
    drainAfterResponse();
    return response;
  } catch (error) {
    return respondError('inbound-hook', error);
  }
}
