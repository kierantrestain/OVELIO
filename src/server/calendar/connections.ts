import { createHash, randomBytes } from 'node:crypto';
import type { CalendarConnection, CalendarProvider } from '@/contracts/calendar';
import { AppError, appOrigin } from '../config';
import { decryptToken, encryptionKey, encryptToken, pkcePair } from '../crm/mailboxes';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { isDevPreviewMode, requestOrigin } from '../dev-preview';
import { route } from '../routes/shared';
import { calendarProvider, calendarProviderConfig, calendarToken, primaryCalendar, providerBusy, providerNeedsRefresh } from './providers';
import type { BusyInterval } from './providers';

type Connection = {
  user_id: string;
  provider: CalendarProvider;
  revision: string;
  calendar_ref: string;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: Date;
  health: 'connected' | 'unavailable';
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function sessionHash(request: Request) {
  const token = /(?:^|;\s*)ovelio_session=([\w-]{43})(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
  return token ? hash(token) : null;
}

function canConnect(provider: CalendarProvider) {
  const { clientId, clientSecret } = calendarProviderConfig(provider);
  return Boolean(!isDevPreviewMode() && process.env.APP_ORIGIN && clientId && clientSecret && encryptionKey());
}

export async function calendarConnections(userId: string): Promise<CalendarConnection[]> {
  const { rows } = await db.query<Pick<Connection, 'provider' | 'health'>>(
    'SELECT provider, health FROM calendar_connections WHERE user_id = $1', [userId]);
  return calendarProvider.options.map(provider => {
    const configured = canConnect(provider);
    const existing = rows.find(row => row.provider === provider);
    return {
      provider, label: calendarProviderConfig(provider).label, configured,
      status: existing ? configured ? existing.health : 'unavailable' : 'disconnected',
    };
  });
}

async function beginConnection(request: Request, userId: string, provider: CalendarProvider) {
  if (!canConnect(provider)) throw new AppError(503, 'Calendar connection is unavailable. Ask your administrator to configure calendar OAuth.');
  const session = sessionHash(request);
  if (!session) throw new AppError(403, 'Sign in again before connecting a calendar.');
  const state = randomBytes(32).toString('base64url');
  const pkce = pkcePair();
  const redirect = `${appOrigin()}/api/console/calendar/connections/${provider}/callback`;
  const { rowCount } = await db.query(
    `INSERT INTO calendar_oauth_requests (user_id, provider, state_hash, session_hash, code_verifier, redirect_uri, expires_at)
     SELECT user_id, $2, $3, token_hash, $5, $6, now() + interval '10 minutes' FROM sessions
     WHERE user_id = $1 AND token_hash = $4 AND expires_at > now()
     ON CONFLICT (user_id, provider) DO UPDATE SET state_hash = EXCLUDED.state_hash, session_hash = EXCLUDED.session_hash,
       code_verifier = EXCLUDED.code_verifier, redirect_uri = EXCLUDED.redirect_uri, expires_at = EXCLUDED.expires_at, claimed = false`,
    [userId, provider, hash(state), session, pkce.verifier, redirect],
  );
  if (!rowCount) throw new AppError(403, 'Sign in again before connecting a calendar.');
  const config = calendarProviderConfig(provider);
  const authorize = new URL(config.authorize);
  const params = {
    client_id: config.clientId, response_type: 'code', scope: config.scopes, redirect_uri: redirect,
    state, code_challenge: pkce.challenge, code_challenge_method: 'S256', ...config.extra,
  };
  authorize.search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
  return { url: authorize.toString() };
}

/** The same row lock protects booking selection from connection changes. Provider requests always precede it. */
async function lockHost(client: Sql, userId: string) {
  await client.query('INSERT INTO calendar_hosts (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await client.query('SELECT user_id FROM calendar_hosts WHERE user_id = $1 FOR UPDATE', [userId]);
}

async function completeConnection(request: Request, query: URLSearchParams, userId: string, provider: CalendarProvider) {
  const session = sessionHash(request);
  const state = query.get('state');
  const code = query.get('code');
  if (!canConnect(provider) || !session || !state || !/^[\w-]{43}$/.test(state) || !code || code.length > 8192) return false;
  const key = hash(state);
  const { rows: [claimed] } = await db.query<{ code_verifier: string; redirect_uri: string }>(
    `UPDATE calendar_oauth_requests q SET claimed = true FROM sessions s
     WHERE q.user_id = $1 AND q.provider = $2 AND q.state_hash = $3 AND q.session_hash = $4
       AND q.expires_at > now() AND NOT q.claimed
       AND s.token_hash = q.session_hash AND s.user_id = q.user_id AND s.expires_at > now()
     RETURNING q.code_verifier, q.redirect_uri`, [userId, provider, key, session]);
  if (!claimed) return false;
  try {
    const token = await calendarToken(provider, {
      grant_type: 'authorization_code', code, redirect_uri: claimed.redirect_uri, code_verifier: claimed.code_verifier,
    });
    if (!token.refresh_token) return false;
    const calendar = await primaryCalendar(provider, token.access_token);
    const checkedAt = Date.now();
    await providerBusy(provider, calendar, token.access_token, checkedAt, checkedAt + 3600_000);
    const accessToken = encryptToken(token.access_token);
    const refreshToken = encryptToken(token.refresh_token);
    return await transaction(async client => {
      await lockHost(client, userId);
      const { rowCount } = await client.query(
        `DELETE FROM calendar_oauth_requests q USING sessions s, users u
         WHERE q.user_id = $1 AND q.provider = $2 AND q.state_hash = $3 AND q.claimed AND q.expires_at > now()
           AND s.token_hash = q.session_hash AND s.user_id = q.user_id AND s.expires_at > now()
           AND u.id = q.user_id AND u.disabled_at IS NULL AND u.role IN ('marketer', 'admin')`, [userId, provider, key]);
      if (!rowCount) return false;
      await client.query(
        `INSERT INTO calendar_connections (user_id, provider, calendar_ref, access_token_enc, refresh_token_enc, access_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, provider) DO UPDATE SET
           revision = gen_random_uuid(), calendar_ref = EXCLUDED.calendar_ref, access_token_enc = EXCLUDED.access_token_enc,
           refresh_token_enc = EXCLUDED.refresh_token_enc, access_expires_at = EXCLUDED.access_expires_at, health = 'connected'`,
        [userId, provider, calendar, accessToken, refreshToken, new Date(checkedAt + token.expires_in * 1000)],
      );
      return true;
    });
  } catch {
    return false;
  }
}

export const calendarConnectionEndpoints = [
  route('GET', /^calendar\/connections$/, async ({ user }) => calendarConnections(user.id), 'marketer'),
  route('POST', /^calendar\/connections\/(google|microsoft)$/, async ({ request, user, params }) =>
    beginConnection(request, user.id, calendarProvider.parse(params[0])), 'marketer'),
  route('GET', /^calendar\/connections\/(google|microsoft)\/callback$/, async ({ request, query, user, params }) => {
    const provider = calendarProvider.parse(params[0]);
    const connected = await completeConnection(request, query, user.id, provider);
    const destination = new URL('/sales/calendar', process.env.APP_ORIGIN ? appOrigin() : requestOrigin(request));
    destination.searchParams.set('calendarConnection', connected ? 'connected' : 'failed');
    return new Response(null, { status: 303, headers: { Location: destination.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }, 'marketer'),
  route('DELETE', /^calendar\/connections\/(google|microsoft)$/, async ({ user, params }) => {
    const provider = calendarProvider.parse(params[0]);
    await transaction(async client => {
      await client.query('SELECT user_id FROM calendar_hosts WHERE user_id = $1 FOR UPDATE', [user.id]);
      await client.query('DELETE FROM calendar_oauth_requests WHERE user_id = $1 AND provider = $2', [user.id, provider]);
      await client.query('DELETE FROM calendar_connections WHERE user_id = $1 AND provider = $2', [user.id, provider]);
    });
    return new Response(null, { status: 204 });
  }, 'marketer'),
];

async function refreshAccess(row: Connection) {
  const token = await calendarToken(row.provider, { grant_type: 'refresh_token', refresh_token: decryptToken(row.refresh_token_enc) });
  const { rowCount } = await db.query(
    `UPDATE calendar_connections SET access_token_enc = $2, access_expires_at = $3, refresh_token_enc = coalesce($4, refresh_token_enc)
     WHERE revision = $1 AND access_token_enc = $5`,
    [row.revision, encryptToken(token.access_token), new Date(Date.now() + token.expires_in * 1000),
      token.refresh_token ? encryptToken(token.refresh_token) : null, row.access_token_enc],
  );
  if (rowCount) return token.access_token;
  const { rows: [current] } = await db.query<Pick<Connection, 'access_token_enc'>>(
    'SELECT access_token_enc FROM calendar_connections WHERE revision = $1', [row.revision]);
  if (!current) throw new Error('The calendar connection changed.');
  return decryptToken(current.access_token_enc);
}

async function checkConnection(row: Connection, from: number, until: number) {
  let busy: BusyInterval[] | null = null;
  try {
    const config = calendarProviderConfig(row.provider);
    if (!config.clientId || !config.clientSecret) throw new Error('Calendar OAuth is not configured.');
    const expired = row.access_expires_at.getTime() < Date.now() + 60_000;
    const access = expired ? await refreshAccess(row) : decryptToken(row.access_token_enc);
    try {
      busy = await providerBusy(row.provider, row.calendar_ref, access, from, until);
    } catch (error) {
      if (expired || !providerNeedsRefresh(error)) throw error;
      busy = await providerBusy(row.provider, row.calendar_ref, await refreshAccess(row), from, until);
    }
  } catch {
    // The host stays unavailable. Provider responses and appointment details are never retained.
  }
  const health = busy === null ? 'unavailable' : 'connected';
  if (health !== row.health) await db.query('UPDATE calendar_connections SET health = $2 WHERE revision = $1', [row.revision, health]);
  return busy;
}

type Revisions = Map<string, string[]>;
function groupRevisions(rows: Pick<Connection, 'user_id' | 'revision'>[]): Revisions {
  const map: Revisions = new Map();
  for (const row of rows) {
    const revisions = map.get(row.user_id) ?? [];
    revisions.push(row.revision);
    map.set(row.user_id, revisions);
  }
  return map;
}

export async function currentCalendarRevisions(client: Sql, hostIds: string[]) {
  if (!hostIds.length) return new Map<string, string[]>();
  const { rows } = await client.query<Pick<Connection, 'user_id' | 'revision'>>(
    'SELECT user_id, revision FROM calendar_connections WHERE user_id = ANY($1::uuid[])', [hostIds]);
  return groupRevisions(rows);
}

export async function checkCalendars(hostIds: string[], from: number, until: number) {
  const { rows } = await db.query<Connection>(
    'SELECT * FROM calendar_connections WHERE user_id = ANY($1::uuid[])', [hostIds]);
  const results = new Map(await Promise.all(rows.map(async row => [row.revision, await checkConnection(row, from, until)] as const)));
  const revisions = groupRevisions(rows);
  const observedAt = Date.now();
  function isFree(host: string, startsAt: number, blockedUntil: number, current = revisions) {
    return (current.get(host) ?? []).every(revision => {
      const busy = results.get(revision);
      return startsAt >= from && blockedUntil <= until && Date.now() - observedAt < 30_000 && busy != null
        && !busy.some(period => startsAt < period.blockedUntil && blockedUntil > period.startsAt);
    });
  }
  return { isFree };
}

export type CalendarAvailabilityCheck = Awaited<ReturnType<typeof checkCalendars>>;
