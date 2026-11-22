import { strict as assert } from 'node:assert';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  buildAuth0LogoutUrl, createAuth0Login, exchangeAuth0Code, normalizeAuth0Domain,
  readAuth0PreviewUser, readAuth0Transaction, signAuth0PreviewUser, verifyAuth0IdToken,
} from '../../src/server/auth0';
import type { Auth0Config } from '../../src/server/auth0';

const config: Auth0Config = {
  domain: 'ovelio-test.us.auth0.com',
  clientId: 'client_12345',
  clientSecret: 'super-secret-auth0-client-key-0123456789',
  defaultRole: 'analyst',
  autoProvision: false,
};

function makeSignedJwt(
  payload: Record<string, unknown>,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  kid = 'key-1',
) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${body}`, 'utf8'), privateKey).toString('base64url');
  return `${header}.${body}.${sig}`;
}

test('normalizes valid Auth0 domains and rejects invalid hostnames or paths', () => {
  assert.equal(normalizeAuth0Domain('https://Dev-Ovelio.US.Auth0.com/'), 'dev-ovelio.us.auth0.com');
  assert.equal(normalizeAuth0Domain('auth.example.com'), 'auth.example.com');
  assert.equal(normalizeAuth0Domain(''), null);
  assert.equal(normalizeAuth0Domain('evil.com/path'), null);
  assert.equal(normalizeAuth0Domain('user:pass@auth0.com'), null);
});

test('creates PKCE S256 login transaction and rejects tampered transaction cookies', () => {
  const req = new Request('https://ovelio.vercel.app/api/auth/auth0/login');
  const { authorizeUrl, cookieValue, secure } = createAuth0Login(req, config);
  assert.equal(secure, true);

  const tx = readAuth0Transaction(cookieValue, config);
  assert.ok(tx);
  assert.equal(tx.redirectUri, 'https://ovelio.vercel.app/api/auth/auth0/callback');

  const url = new URL(authorizeUrl);
  assert.equal(url.origin, 'https://ovelio-test.us.auth0.com');
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('client_id'), config.clientId);
  assert.equal(url.searchParams.get('state'), tx.state);
  assert.equal(url.searchParams.get('nonce'), tx.nonce);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const expectedChallenge = createHash('sha256').update(tx.verifier).digest('base64url');
  assert.equal(url.searchParams.get('code_challenge'), expectedChallenge);

  assert.equal(readAuth0Transaction(cookieValue + 'x', config), null);
  assert.equal(readAuth0Transaction('bad-token', config), null);
});

test('verifies RS256 JWKS ID tokens, rejects forged/wrong-nonce/expired tokens, and exchanges auth codes', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { privateKey: wrongPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'key-1', use: 'sig', alg: 'RS256' };

  const now = Math.floor(Date.now() / 1000);
  const req = new Request('https://ovelio.vercel.app/api/auth/auth0/login');
  const { cookieValue } = createAuth0Login(req, config);
  const tx = readAuth0Transaction(cookieValue, config)!;

  const validJwt = makeSignedJwt({
    iss: `https://${config.domain}/`,
    aud: config.clientId,
    sub: 'auth0|user-42',
    email: 'Kieran@Example.Test',
    email_verified: true,
    name: 'Kieran Trestain',
    nonce: tx.nonce,
    iat: now,
    exp: now + 3600,
  }, privateKey);

  const mockFetch: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    if (u.pathname === '/.well-known/jwks.json') {
      return Response.json({ keys: [jwk] });
    }
    if (u.pathname === '/oauth/token') {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      assert.equal(body.grant_type, 'authorization_code');
      assert.equal(body.code, 'auth-code-123');
      assert.equal(body.code_verifier, tx.verifier);
      assert.equal(body.redirect_uri, tx.redirectUri);
      return Response.json({ id_token: validJwt, access_token: 'access-tok' });
    }
    assert.fail(`Unexpected URL ${u.toString()}`);
  };

  const identity = await exchangeAuth0Code('auth-code-123', tx, config, mockFetch);
  assert.deepEqual(identity, {
    sub: 'auth0|user-42',
    email: 'kieran@example.test',
    emailVerified: true,
    name: 'Kieran Trestain',
  });

  // Forged signature must fail
  const forgedJwt = makeSignedJwt({
    iss: `https://${config.domain}/`, aud: config.clientId, sub: 'auth0|x', nonce: tx.nonce, exp: now + 3600,
  }, wrongPrivateKey);
  await assert.rejects(() => verifyAuth0IdToken(forgedJwt, config, tx.nonce, mockFetch), /signature verification failed/i);

  // Nonce mismatch must fail
  await assert.rejects(() => verifyAuth0IdToken(validJwt, config, 'wrong-nonce', mockFetch), /nonce mismatch/i);

  // Audience mismatch must fail
  const wrongAudJwt = makeSignedJwt({
    iss: `https://${config.domain}/`, aud: 'other-client', sub: 'auth0|x', nonce: tx.nonce, exp: now + 3600,
  }, privateKey);
  await assert.rejects(() => verifyAuth0IdToken(wrongAudJwt, config, tx.nonce, mockFetch), /audience mismatch/i);

  // Expired token must fail
  const expiredJwt = makeSignedJwt({
    iss: `https://${config.domain}/`, aud: config.clientId, sub: 'auth0|x', nonce: tx.nonce, exp: now - 120,
  }, privateKey);
  await assert.rejects(() => verifyAuth0IdToken(expiredJwt, config, tx.nonce, mockFetch), /expired/i);
});

test('signs and verifies Auth0 preview sessions and builds federated logout URL', () => {
  const user = { id: 'auth0|1', email: 'dev@example.test', name: 'Dev', role: 'admin' as const, disabled: false };
  const signed = signAuth0PreviewUser(user, config);
  assert.deepEqual(readAuth0PreviewUser(signed, config), user);
  assert.equal(readAuth0PreviewUser(signed + 'tamper', config), null);

  const logoutUrl = new URL(buildAuth0LogoutUrl(new Request('https://ovelio.vercel.app/api/auth/logout'), config));
  assert.equal(logoutUrl.origin, 'https://ovelio-test.us.auth0.com');
  assert.equal(logoutUrl.pathname, '/v2/logout');
  assert.equal(logoutUrl.searchParams.get('client_id'), config.clientId);
  assert.equal(logoutUrl.searchParams.get('returnTo'), 'https://ovelio.vercel.app/login');
});
