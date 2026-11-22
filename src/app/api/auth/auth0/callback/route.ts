import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { User } from '@/contracts';
import { AUTH_PROVIDER_COOKIE, signInWithAuth0 } from '@/server/auth';
import {
  AUTH0_PREVIEW_COOKIE, AUTH0_TX_COOKIE, exchangeAuth0Code, getAuth0Config, readAuth0Transaction,
  resolvePublicOrigin, signAuth0PreviewUser,
} from '@/server/auth0';
import { AppError, logError } from '@/server/config';
import { isDevPreviewMode } from '@/server/dev-preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectLoginError(origin: string, code: string) {
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(code)}`, 302);
}

export async function GET(request: Request) {
  const origin = resolvePublicOrigin(request);
  const config = getAuth0Config();
  if (!config) return redirectLoginError(origin, 'auth0_failed');

  const jar = await cookies();
  const txCookie = jar.get(AUTH0_TX_COOKIE)?.value;
  jar.delete(AUTH0_TX_COOKIE);

  const url = new URL(request.url);
  if (url.searchParams.get('error')) {
    return redirectLoginError(origin, 'auth0_cancelled');
  }

  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const tx = readAuth0Transaction(txCookie, config);
  if (!code || !state || !tx) {
    return redirectLoginError(origin, 'auth0_state');
  }
  const stateA = Buffer.from(state);
  const stateB = Buffer.from(tx.state);
  if (stateA.length !== stateB.length || !timingSafeEqual(stateA, stateB)) {
    return redirectLoginError(origin, 'auth0_state');
  }

  try {
    const identity = await exchangeAuth0Code(code, tx, config);
    if (!identity.emailVerified) {
      return redirectLoginError(origin, 'auth0_unverified');
    }

    const secure = origin.startsWith('https:');
    if (isDevPreviewMode()) {
      const previewUser: User = {
        id: identity.sub,
        email: identity.email,
        name: identity.name,
        role: 'admin',
        disabled: false,
      };
      jar.set(AUTH0_PREVIEW_COOKIE, signAuth0PreviewUser(previewUser, config), {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60,
        path: '/',
      });
      jar.set(AUTH_PROVIDER_COOKIE, 'auth0', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60,
        path: '/',
      });
      return NextResponse.redirect(`${origin}/overview`, 302);
    }

    await signInWithAuth0(identity, config, secure);
    return NextResponse.redirect(`${origin}/overview`, 302);
  } catch (error) {
    if (error instanceof AppError && error.message.startsWith('auth0_')) {
      return redirectLoginError(origin, error.message);
    }
    logError('auth0-callback', error);
    return redirectLoginError(origin, 'auth0_failed');
  }
}
