// robots.txt for the workspace address: published pages (/s/) may be crawled, the console may not.
import { requestOrigin } from '@/server/dev-preview';
import { robotsTxt } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request: Request) {
  const origin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : requestOrigin(request);
  return new Response(robotsTxt(origin), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
