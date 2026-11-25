// Published pages on a verified custom domain or subdomain. src/proxy.ts rewrites https://<domain>/<slug> here; the
// Host header must match the domain in the path, so this route never serves a domain's pages on another address.
import { respondError } from '@/server/http';
import { notFoundPage, servePage } from '@/server/sites/public';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ host: string; slug?: string[] }> }) {
  try {
    const { host, slug } = await context.params;
    const hostname = decodeURIComponent(host).toLowerCase();
    const requested = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(':')[0].toLowerCase();
    if (requested !== hostname) return notFoundPage();
    const path = (slug ?? []).join('/').toLowerCase();
    if (path && !/^[a-z0-9-]{1,80}$/.test(path)) return notFoundPage();
    return await servePage(request, path, hostname);
  } catch (error) {
    return respondError('sites-domain-page', error);
  }
}
