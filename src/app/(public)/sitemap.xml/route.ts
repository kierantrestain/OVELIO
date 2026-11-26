// sitemap.xml for the workspace address: every published, indexable landing page at /s/<slug>.
import { requestOrigin } from '@/server/dev-preview';
import { respondError } from '@/server/http';
import { sitemapXml } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const origin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : requestOrigin(request);
    return new Response(await sitemapXml(origin), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
  } catch (error) {
    return respondError('sites-sitemap', error);
  }
}
