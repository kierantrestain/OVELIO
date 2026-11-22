import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type { Role, User } from '@/contracts';
import { AppError, appOrigin } from './config';

export const AUTH0_TX_COOKIE = 'ovelio_auth0_tx';
export const AUTH0_PREVIEW_COOKIE = 'ovelio_auth0_preview';

export type Auth0Config = {
  domain: string;
  clientId: string;
  clientSecret: string;
  defaultRole: Role;
  autoProvision: boolean;
};

export type Auth0Identity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

type Jwk = {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
};

const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 10 * 60_000;

export function normalizeAuth0Domain(raw?: string): string | null {
  if (!raw?.trim()) return null;
  let value = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!value) return null;
  // Reject paths, credentials, whitespace, or invalid hostnames.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value)) {
    return null;
  }
  value = value.toLowerCase();
  return value;
}

export function getAuth0Config(): Auth0Config | null {
  const domain = normalizeAuth0Domain(process.env.AUTH0_DOMAIN);
  const clientId = process.env.AUTH0_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.AUTH0_CLIENT_SECRET?.trim() ?? '';
  if (!domain || !clientId || !clientSecret) return null;
  const rawRole = process.env.AUTH0_DEFAULT_ROLE?.trim().toLowerCase();
  const defaultRole: Role = rawRole === 'admin' || rawRole === 'marketer' || rawRole === 'analyst' ? rawRole : 'analyst';
  const autoProvision = process.env.AUTH0_AUTO_PROVISION === 'true';
  return { domain, clientId, clientSecret, defaultRole, autoProvision };
}

export function isAuth0Configured(): boolean {
  return getAuth0Config() !== null;
}

export function resolvePublicOrigin(request: Request): string {
  if (process.env.APP_ORIGIN?.trim()) {
    return appOrigin();
  }
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim() || url.host;
  const origin = `${proto}://${host}`;
  if (process.env.OVELIO_ENV === 'production' && !origin.startsWith('https://')) {
    throw new AppError(500, 'APP_ORIGIN must use HTTPS in production.');
  }
  return origin;
}

function signToken(payload: unknown, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = createHmac('sha256', secret).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export type Auth0Transaction = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  exp: number;
};

export function createAuth0Login(request: Request, config: Auth0Config, screenHint?: 'signup' | 'login') {
  const origin = resolvePublicOrigin(request);
  const redirectUri = `${origin}/api/auth/auth0/callback`;
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const tx: Auth0Transaction = {
    state,
    nonce,
    verifier,
    redirectUri,
    exp: Date.now() + 10 * 60_000,
  };
  const cookieValue = signToken(tx, config.clientSecret);

  const authorizeUrl = new URL(`https://${config.domain}/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  if (screenHint === 'signup' || screenHint === 'login') {
    authorizeUrl.searchParams.set('screen_hint', screenHint);
  }

  return { authorizeUrl: authorizeUrl.toString(), cookieValue, secure: origin.startsWith('https:') };
}

export function readAuth0Transaction(cookieValue: string | undefined, config: Auth0Config): Auth0Transaction | null {
  const tx = verifyToken<Auth0Transaction>(cookieValue, config.clientSecret);
  if (!tx || typeof tx.exp !== 'number' || tx.exp < Date.now()) return null;
  if (!tx.state || !tx.nonce || !tx.verifier || !tx.redirectUri) return null;
  return tx;
}

export function signAuth0PreviewUser(user: User, config: Auth0Config): string {
  return signToken({ user, exp: Date.now() + 12 * 60 * 60_000 }, config.clientSecret);
}

export function readAuth0PreviewUser(cookieValue: string | undefined, config: Auth0Config): User | null {
  const data = verifyToken<{ user?: User; exp?: number }>(cookieValue, config.clientSecret);
  if (!data?.user || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  return data.user;
}

export function buildAuth0LogoutUrl(request: Request, config: Auth0Config): string {
  const origin = resolvePublicOrigin(request);
  const url = new URL(`https://${config.domain}/v2/logout`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('returnTo', `${origin}/login`);
  return url.toString();
}

function decodeBase64UrlJson<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
}

async function fetchJwks(domain: string, fetcher: typeof fetch, forceRefresh = false): Promise<Jwk[]> {
  const cached = jwksCache.get(domain);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const response = await fetcher(`https://${domain}/.well-known/jwks.json`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new AppError(502, 'Could not load Auth0 signing keys.');
  const payload = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  jwksCache.set(domain, { fetchedAt: Date.now(), keys });
  return keys;
}

export async function verifyAuth0IdToken(
  idToken: string,
  config: Auth0Config,
  expectedNonce: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new AppError(401, 'Invalid Auth0 ID token format.');
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerPart);
  if (header.alg !== 'RS256' || !header.kid) {
    throw new AppError(401, 'Unsupported Auth0 ID token signing algorithm.');
  }

  let keys = await fetchJwks(config.domain, fetcher, false);
  let jwk = keys.find(item => item.kid === header.kid && item.kty === 'RSA');
  if (!jwk) {
    keys = await fetchJwks(config.domain, fetcher, true);
    jwk = keys.find(item => item.kid === header.kid && item.kty === 'RSA');
  }
  if (!jwk) throw new AppError(401, 'Matching Auth0 signing key was not found.');

  const publicKey: KeyObject = createPublicKey({ key: jwk as Record<string, unknown>, format: 'jwk' });
  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`, 'utf8');
  const signature = Buffer.from(signaturePart, 'base64url');
  const valid = verify('RSA-SHA256', signingInput, publicKey, signature);
  if (!valid) throw new AppError(401, 'Auth0 ID token signature verification failed.');

  const claims = decodeBase64UrlJson<Record<string, unknown>>(payloadPart);
  const expectedIssuer = `https://${config.domain}/`;
  if (claims.iss !== expectedIssuer) throw new AppError(401, 'Auth0 ID token issuer mismatch.');

  const aud = claims.aud;
  const audValid = aud === config.clientId || (Array.isArray(aud) && aud.includes(config.clientId));
  if (!audValid) throw new AppError(401, 'Auth0 ID token audience mismatch.');

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec - 60) {
    throw new AppError(401, 'Auth0 ID token has expired.');
  }
  if (typeof claims.nonce !== 'string') throw new AppError(401, 'Auth0 ID token nonce is missing.');
  const nonceA = Buffer.from(claims.nonce);
  const nonceB = Buffer.from(expectedNonce);
  if (nonceA.length !== nonceB.length || !timingSafeEqual(nonceA, nonceB)) {
    throw new AppError(401, 'Auth0 ID token nonce mismatch.');
  }
  return claims;
}

export async function exchangeAuth0Code(
  code: string,
  tx: Auth0Transaction,
  config: Auth0Config,
  fetcher: typeof fetch = fetch,
): Promise<Auth0Identity> {
  const tokenResponse = await fetcher(`https://${config.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: tx.verifier,
      redirect_uri: tx.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) {
    throw new AppError(401, 'Auth0 authorization code exchange failed.');
  }
  const tokens = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new AppError(401, 'Auth0 did not return an ID token.');

  const claims = await verifyAuth0IdToken(tokens.id_token, config, tx.nonce, fetcher);
  let email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  let emailVerified = claims.email_verified === true;
  let name = typeof claims.name === 'string' ? claims.name.trim() : '';
  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';

  if ((!email || !name) && tokens.access_token) {
    const infoRes = await fetcher(`https://${config.domain}/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (infoRes.ok) {
      const profile = (await infoRes.json()) as Record<string, unknown>;
      if (!email && typeof profile.email === 'string') email = profile.email.trim().toLowerCase();
      if (!emailVerified && profile.email_verified === true) emailVerified = true;
      if (!name && typeof profile.name === 'string') name = profile.name.trim();
    }
  }

  if (!sub || !email) throw new AppError(401, 'Auth0 account did not include an email address.');
  return { sub, email, emailVerified, name: name || email.split('@')[0] || 'User' };
}

export const AUTH0_ERROR_MESSAGES: Record<string, string> = {
  auth0_cancelled: 'Auth0 sign-in was cancelled or denied.',
  auth0_state: 'Your sign-in session expired. Please try continuing with Auth0 again.',
  auth0_unverified: 'Verify your email address in Auth0 before signing into OVELIO.',
  auth0_not_invited: 'No OVELIO workspace account matches your Auth0 email. Ask an administrator to add you in Settings → Team.',
  auth0_disabled: 'Your OVELIO workspace account has been disabled.',
  auth0_failed: 'Auth0 sign-in could not be completed. Verify AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET and callback URL.',
};
