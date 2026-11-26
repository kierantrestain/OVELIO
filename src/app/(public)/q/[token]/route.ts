// Public proposal page: review, accept with an electronic signature, or decline (src/server/revenue/public.ts).
import { respondError } from '@/server/http';
import { drainAfterResponse } from '@/server/platform/after';
import { postQuote, serveQuote } from '@/server/revenue/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const response = await serveQuote((await context.params).token, request);
    drainAfterResponse();
    return response;
  } catch (error) {
    return respondError('revenue-quote-page', error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const response = await postQuote((await context.params).token, request);
    drainAfterResponse();
    return response;
  } catch (error) {
    return respondError('revenue-quote-post', error);
  }
}
