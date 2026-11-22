import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AUTH0_TX_COOKIE, createAuth0Login, getAuth0Config } from '@/server/auth0';
import { AppError } from '@/server/config';
import { respondError } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const config = getAuth0Config();
    if (!config) {
      throw new AppError(404, 'Auth0 sign-in is not configured in this environment.');
    }
    const hint = new URL(request.url).searchParams.get('screen_hint');
    const screenHint = hint === 'signup' || hint === 'login' ? hint : undefined;
    const { authorizeUrl, cookieValue, secure } = createAuth0Login(request, config, screenHint);
    const jar = await cookies();
    jar.set(AUTH0_TX_COOKIE, cookieValue, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    return NextResponse.redirect(authorizeUrl, 302);
  } catch (error) {
    return respondError('auth0-login', error);
  }
}
