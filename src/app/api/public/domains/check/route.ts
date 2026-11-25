// For the reverse proxy's on-demand TLS "ask" hook: 200 only for verified publishing domains.
import { isVerifiedDomain } from '@/server/sites/domains';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain') ?? '';
  const ok = /^[a-z0-9.-]{3,253}$/i.test(domain) && await isVerifiedDomain(domain).catch(() => false);
  return new Response(ok ? 'ok' : 'unknown domain', { status: ok ? 200 : 404, headers: { 'cache-control': 'no-store' } });
}
