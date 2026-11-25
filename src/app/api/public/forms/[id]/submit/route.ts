// Public form submissions: JSON from the page tracker or embed script, or a plain form post without JavaScript.
import { rateLimit } from '@/server/auth';
import { AppError } from '@/server/config';
import { json, respondError } from '@/server/http';
import { drainAfterResponse } from '@/server/platform/after';
import { clientIp, corsHeaders, formPostResultPage, hashIp, readSubmission, submitForm } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const wantsJson = (request: Request) => (request.headers.get('accept') ?? '').includes('application/json')
  || (request.headers.get('content-type') ?? '').includes('application/json');

function withCors(response: Response) {
  for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
  return response;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const asJson = wantsJson(request);
  const referer = request.headers.get('referer');
  try {
    const { id } = await context.params;
    const ip = clientIp(request);
    await rateLimit('public:submit:' + hashIp(ip), 12, 60);
    await rateLimit('public:submit-form:' + id.slice(0, 36), 600, 60);
    const raw = await readSubmission(request);
    const cookie = /(?:^|; )ov_vid=([A-Za-z0-9-]{8,64})/.exec(request.headers.get('cookie') ?? '');
    const outcome = await submitForm(id, raw, { ip, cookieVisitorId: cookie?.[1] ?? null, referer });
    // The preview has no worker: run the automations this submission triggered after responding.
    drainAfterResponse();
    return asJson ? withCors(json(outcome.result, outcome.status)) : formPostResultPage(outcome, referer);
  } catch (error) {
    if (asJson) {
      const response = respondError('sites-submit', error);
      const body = await response.json() as { error?: string };
      return withCors(json({ ok: false, error: body.error ?? 'The form could not be sent.', fieldErrors: {} }, response.status));
    }
    const message = error instanceof AppError ? error.message : 'The form could not be sent. Please try again in a few minutes.';
    return formPostResultPage({ status: error instanceof AppError ? error.status : 500, result: { ok: false, error: message, fieldErrors: {} } }, referer);
  }
}
