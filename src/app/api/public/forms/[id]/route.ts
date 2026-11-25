// The form markup for the embed script on other websites (CORS, no credentials).
import { json, respondError } from '@/server/http';
import { requestOrigin } from '@/server/dev-preview';
import { corsHeaders, embedPayload } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const origin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : requestOrigin(request);
    const payload = await embedPayload((await context.params).id, origin);
    const response = payload ? json(payload) : json({ error: 'This form is not accepting submissions.' }, 404);
    for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
    return response;
  } catch (error) {
    return respondError('sites-embed', error);
  }
}
