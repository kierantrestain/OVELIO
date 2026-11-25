// First-party page-view collector for published pages: records page.viewed and funnel progress.
import { rateLimit } from '@/server/auth';
import { AppError } from '@/server/config';
import { respondError } from '@/server/http';
import { drainAfterResponse } from '@/server/platform/after';
import { clientIp, hashIp, recordView } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    await rateLimit('public:track:' + hashIp(clientIp(request)), 240, 60);
    const body = await request.text();
    if (body.length > 8192) throw new AppError(413, 'The tracking payload is too large.');
    let data: unknown;
    try { data = JSON.parse(body); } catch { throw new AppError(400, 'Send the view as JSON.'); }
    await recordView(data);
    drainAfterResponse();
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return respondError('sites-track', error);
  }
}
