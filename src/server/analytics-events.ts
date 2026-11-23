import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ApiKeySummary, CreatedApiKey } from '@/contracts/analytics';
import { AppError } from '@/server/config';
import { db } from '@/server/db';
import type { Sql } from '@/server/db';
import { upstream } from '@/server/upstream';

export const IDEMPOTENCY_RETENTION_DAYS = 7;
export const MAX_EVENTS_PER_REQUEST = 100;
/** Umami drops requests whose user agent looks like a crawler (src/app/api/send/route.ts bot check), so server events send a plain one. */
export const SERVER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 OVELIO-Server-Events';

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

type KeyRow = {
  id: string; name: string; key_prefix: string; rate_limit_per_minute: number;
  created_at: Date; last_used_at: Date | null; revoked_at: Date | null;
};

const summary = (row: KeyRow): ApiKeySummary => ({
  id: row.id, name: row.name, prefix: row.key_prefix, rateLimitPerMinute: row.rate_limit_per_minute,
  createdAt: new Date(row.created_at).toISOString(),
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
});

const columns = 'id, name, key_prefix, rate_limit_per_minute, created_at, last_used_at, revoked_at';

export const apiKeyInput = z.object({
  name: z.string().trim().min(1).max(80),
  rateLimitPerMinute: z.number().int().min(1).max(6000).optional(),
});

export async function listApiKeys(sql: Sql = db): Promise<ApiKeySummary[]> {
  return (await sql.query<KeyRow>(`SELECT ${columns} FROM analytics_api_keys ORDER BY created_at DESC`)).rows.map(summary);
}

/** The full key is returned once. Only its SHA-256 hash is stored. */
export async function createApiKey(input: z.infer<typeof apiKeyInput>, userId: string | null, sql: Sql = db): Promise<CreatedApiKey> {
  const parsed = apiKeyInput.parse(input);
  const key = 'ovl_' + randomBytes(32).toString('base64url');
  const row = (await sql.query<KeyRow>(
    `INSERT INTO analytics_api_keys (name, key_prefix, key_hash, rate_limit_per_minute, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`,
    [parsed.name, key.slice(0, 8), hashKey(key), parsed.rateLimitPerMinute ?? 120, userId],
  )).rows[0];
  return { ...summary(row), key };
}

export async function revokeApiKey(id: string, sql: Sql = db): Promise<void> {
  const result = await sql.query('UPDATE analytics_api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
  if (!result.rowCount) throw new AppError(404, 'That API key was not found or is already revoked.');
}

export type AuthenticatedKey = { id: string; rateLimitPerMinute: number };

export async function authenticateApiKey(header: string | null, sql: Sql = db): Promise<AuthenticatedKey> {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!token) throw new AppError(401, 'Send the API key as "Authorization: Bearer <key>".');
  const row = (await sql.query<{ id: string; rate_limit_per_minute: number }>(
    `UPDATE analytics_api_keys SET last_used_at = now()
     WHERE key_hash = $1 AND revoked_at IS NULL RETURNING id, rate_limit_per_minute`,
    [hashKey(token)],
  )).rows[0];
  if (!row) throw new AppError(401, 'The API key is not valid.');
  return { id: row.id, rateLimitPerMinute: row.rate_limit_per_minute };
}

const unixSeconds = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const ms = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
  if (!Number.isFinite(ms)) {
    ctx.addIssue({ code: 'custom', message: 'Use an ISO date or a Unix timestamp.' });
    return z.NEVER;
  }
  if (ms > Date.now() + 5 * 60_000) {
    ctx.addIssue({ code: 'custom', message: 'The timestamp cannot be in the future.' });
    return z.NEVER;
  }
  if (ms < 0) {
    ctx.addIssue({ code: 'custom', message: 'The timestamp is out of range.' });
    return z.NEVER;
  }
  return Math.floor(ms / 1000);
});

/** Mirrors the limits of Umami's collection schema (request-schema.ts) so a rejected event fails here, with a clear message. */
export const serverEventSchema = z.object({
  websiteId: z.uuid(),
  name: z.string().trim().min(1).max(50).regex(/^[^=+\-@\t\r]/, 'The name cannot start with = + - @ or a tab.'),
  url: z.string().trim().min(1).max(2000),
  data: z.record(z.string(), z.unknown()).optional(),
  timestamp: unixSeconds.optional(),
  distinctId: z.string().trim().min(1).max(50).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export type ServerEvent = z.infer<typeof serverEventSchema>;

export const serverEventsBody = z.union([
  z.array(serverEventSchema),
  z.object({ events: z.array(serverEventSchema) }).transform(value => value.events),
]).refine(list => list.length >= 1 && list.length <= MAX_EVENTS_PER_REQUEST, `Send between 1 and ${MAX_EVENTS_PER_REQUEST} events.`);

export type EventResult = { idempotencyKey: string; status: 'accepted' | 'duplicate' | 'failed'; error?: string };

/** The payload Umami's /api/send reads for an event (request-schema.ts payloadSchema). */
export function collectPayload(event: ServerEvent) {
  let hostname: string | undefined;
  let url = event.url;
  try {
    const parsed = new URL(event.url);
    hostname = parsed.hostname;
    url = parsed.pathname + parsed.search + parsed.hash;
  } catch { /* A path such as /thanks stays as sent. */ }
  return {
    type: 'event',
    payload: {
      website: event.websiteId,
      name: event.name,
      url,
      ...(hostname ? { hostname } : {}),
      ...(event.data ? { data: event.data } : {}),
      ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
      ...(event.distinctId ? { id: event.distinctId } : {}),
      userAgent: SERVER_USER_AGENT,
    },
  };
}

export type IngestDeps = {
  sql?: Sql;
  fetch?: typeof fetch;
  umamiUrl?: string;
  limit?: (bucket: string, limit: number, seconds: number) => Promise<void>;
};

/**
 * Accepts a batch for an authenticated key. Each idempotency key is claimed before forwarding (a repeat is reported as
 * a duplicate and not sent again); a key whose forward fails is released so the caller can retry it.
 */
export async function ingestEvents(key: AuthenticatedKey, events: ServerEvent[], deps: IngestDeps = {}): Promise<EventResult[]> {
  const sql = deps.sql ?? db;
  const limit = deps.limit ?? (async (bucket, max, seconds) => (await import('@/server/auth')).rateLimit(bucket, max, seconds));
  await limit('events:' + key.id, key.rateLimitPerMinute, 60);

  const seen = new Set<string>();
  const results = new Map<string, EventResult>();
  const toSend: ServerEvent[] = [];
  await sql.query(`DELETE FROM analytics_event_idempotency WHERE created_at < now() - make_interval(days => ${IDEMPOTENCY_RETENTION_DAYS})`);
  for (const event of events) {
    if (seen.has(event.idempotencyKey)) {
      results.set(event.idempotencyKey, { idempotencyKey: event.idempotencyKey, status: 'duplicate' });
      continue;
    }
    seen.add(event.idempotencyKey);
    const claimed = await sql.query(
      'INSERT INTO analytics_event_idempotency (api_key_id, idempotency_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [key.id, event.idempotencyKey],
    );
    if (!claimed.rowCount) results.set(event.idempotencyKey, { idempotencyKey: event.idempotencyKey, status: 'duplicate' });
    else toSend.push(event);
  }

  if (toSend.length) {
    const failures = new Map<number, string>();
    try {
      const reply = await upstream<{ details?: { index: number; response?: { message?: string } }[]; processed?: number; beep?: string }>(
        'tracking', (deps.umamiUrl ?? process.env.UMAMI_URL ?? '').replace(/\/+$/, ''), '/api/batch',
        { method: 'POST', body: JSON.stringify(toSend.map(collectPayload)), fetch: deps.fetch },
      );
      for (const detail of reply?.details ?? []) failures.set(detail.index, detail.response?.message ?? 'The analytics engine rejected this event.');
    } catch {
      toSend.forEach((_, index) => failures.set(index, 'The analytics engine could not be reached. Retry with the same idempotency key.'));
    }
    const failed: string[] = [];
    toSend.forEach((event, index) => {
      const error = failures.get(index);
      if (error) {
        failed.push(event.idempotencyKey);
        results.set(event.idempotencyKey, { idempotencyKey: event.idempotencyKey, status: 'failed', error });
      } else results.set(event.idempotencyKey, { idempotencyKey: event.idempotencyKey, status: 'accepted' });
    });
    if (failed.length) {
      await sql.query('DELETE FROM analytics_event_idempotency WHERE api_key_id = $1 AND idempotency_key = ANY($2::text[])', [key.id, failed]);
    }
  }
  return events.map(event => results.get(event.idempotencyKey) ?? { idempotencyKey: event.idempotencyKey, status: 'duplicate' });
}
