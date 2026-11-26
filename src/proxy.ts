// Custom publishing domains (Lane 3, Sites & Forms). Requests whose Host is a verified site domain are rewritten to
// /sd/<host>/<path>, which serves the published page for that domain. Everything else passes through unchanged:
// the workspace address, localhost, IP addresses, and any host that is not a verified domain.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const verified = new Map<string, { ok: boolean; until: number }>();

async function isVerified(host: string) {
  const cached = verified.get(host);
  if (cached && cached.until > Date.now()) return cached.ok;
  let ok = false;
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/public/domains/check?domain=${encodeURIComponent(host)}`, { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    ok = response.ok;
  } catch {
    ok = false;
  }
  // Hosts come from the client, so bound the cache instead of letting random Host headers grow it.
  if (verified.size >= 500) verified.clear();
  verified.set(host, { ok, until: Date.now() + (ok ? 60_000 : 15_000) });
  return ok;
}

export async function proxy(request: NextRequest) {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) return NextResponse.next();
  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  let appHost = '';
  try { appHost = new URL(appOrigin).hostname; } catch { return NextResponse.next(); }
  if (!host || host === appHost || !host.includes('.') || /^[\d.]+$/.test(host) || host.endsWith('.localhost')) return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/public/')) return NextResponse.next();
  if (!await isVerified(host)) return NextResponse.next();
  // A publishing domain serves pages and the public form endpoints only, never the console.
  if (path.startsWith('/api/') || path.startsWith('/_next/')) return new NextResponse('Not found', { status: 404 });
  const url = request.nextUrl.clone();
  url.pathname = `/sd/${host}${path === '/' ? '' : path}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
