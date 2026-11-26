// Inbound webhooks (lane 4, connector infrastructure). POST /api/public/hooks/<id> with a JSON body. The sender proves
// it holds the hook's secret in one of the common ways: `Authorization: Bearer <secret>`, or an HMAC-SHA256 of the raw
// body as hex (`X-OVELIO-Signature: sha256=…`, `X-Hub-Signature-256: sha256=…`) or base64 (`X-Shopify-Hmac-Sha256`,
// `X-WC-Webhook-Signature`). Each delivery is recorded once per delivery id, maps fields to a contact (never consent),
// and emits `webhook.received`, which workflows can start on.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { InboundHook } from '@/contracts/journeys';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { requestOrigin } from '../dev-preview';
import { upsertContact } from '../directory';
import { audit, emitEvent } from '../events';
import { json, readBody, readBodyBytes } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';

type HookRow = {
  id: string; name: string; secret: string; email_path: string; first_name_path: string; last_name_path: string; amount_path: string; currency_path: string;
  tags: string[]; active: boolean; received_count: number; rejected_count: number; last_received_at: Date | null; last_error: string; last_error_at: Date | null;
};

const iso = (value: Date | null) => value ? new Date(value).toISOString() : null;
const publicBase = (request: Request) => {
  const configured = process.env.APP_ORIGIN;
  try { if (configured) return new URL(configured).origin; } catch { /* fall through */ }
  return requestOrigin(request);
};
const toHook = (row: HookRow, request: Request): InboundHook => ({
  id: row.id, name: row.name, secret: row.secret, emailPath: row.email_path, firstNamePath: row.first_name_path, lastNamePath: row.last_name_path,
  amountPath: row.amount_path, currencyPath: row.currency_path, tags: row.tags ?? [], active: row.active, receivedCount: row.received_count,
  rejectedCount: row.rejected_count, lastReceivedAt: iso(row.last_received_at), lastError: row.last_error, lastErrorAt: iso(row.last_error_at),
  url: `${publicBase(request)}/api/public/hooks/${row.id}`,
});

const path = z.string().trim().max(200).regex(/^(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)?$/, 'Use a dot path such as customer.email.');
const hookInput = z.object({
  name: z.string().trim().min(1).max(120),
  emailPath: path.min(1, 'Say where the email address is.').default('email'),
  firstNamePath: path.default(''), lastNamePath: path.default(''), amountPath: path.default(''), currencyPath: path.default(''),
  tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  active: z.boolean().default(true),
});

const newSecret = () => 'whk_' + randomBytes(24).toString('base64url');

/** Reads a dot path ("customer.emails.0") from parsed JSON. */
export function readPath(data: unknown, dotted: string): unknown {
  if (!dotted) return undefined;
  let current: unknown = data;
  for (const part of dotted.split('.')) {
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const equal = (a: string, b: string) => {
  const one = Buffer.from(a);
  const two = Buffer.from(b);
  return one.length === two.length && timingSafeEqual(one, two);
};

/** True when the request proves knowledge of the secret by token or by an HMAC of the exact body. */
export function verifyHookRequest(raw: string | Buffer, headers: Headers, secret: string) {
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') ?? '')?.[1]?.trim();
  if (bearer && equal(bearer, secret)) return true;
  const mac = createHmac('sha256', secret).update(raw);
  const hex = mac.digest('hex');
  const base64 = Buffer.from(hex, 'hex').toString('base64');
  for (const name of ['x-ovelio-signature', 'x-hub-signature-256']) {
    const value = headers.get(name)?.trim().replace(/^sha256=/i, '');
    if (value && equal(value.toLowerCase(), hex)) return true;
  }
  for (const name of ['x-shopify-hmac-sha256', 'x-wc-webhook-signature']) {
    const value = headers.get(name)?.trim();
    if (value && equal(value, base64)) return true;
  }
  return false;
}

async function reject(hookId: string, message: string) {
  await db.query('UPDATE journey_inbound_hooks SET rejected_count = rejected_count + 1, last_error = $2, last_error_at = now() WHERE id = $1', [hookId, message]);
}

export async function receiveHook(hookId: string, request: Request): Promise<Response> {
  if (!z.uuid().safeParse(hookId).success) return json({ error: 'Unknown webhook.' }, 404);
  const row = (await db.query<HookRow>('SELECT * FROM journey_inbound_hooks WHERE id = $1', [hookId])).rows[0];
  if (!row) return json({ error: 'Unknown webhook.' }, 404);
  if (!row.active) return json({ error: 'This webhook is paused.' }, 410);
  const raw = await readBodyBytes(request, 256 * 1024);
  if (!verifyHookRequest(raw, request.headers, row.secret)) {
    await reject(row.id, 'A delivery was refused: missing or wrong signature.');
    return json({ error: 'Missing or invalid signature.' }, 401);
  }
  const body = parseDelivery(raw);
  if (!body) {
    await reject(row.id, 'A delivery was refused: the body was not a JSON object.');
    return json({ error: 'Send a UTF-8 JSON object.' }, 400);
  }
  const deliveryKey = (request.headers.get('idempotency-key') || request.headers.get('x-shopify-webhook-id') || request.headers.get('x-wc-webhook-delivery-id')
    || 'sha256:' + createHash('sha256').update(raw).digest('hex')).slice(0, 200);
  const email = text(readPath(body, row.email_path)).toLowerCase();
  if (email && !z.email().max(254).safeParse(email).success) {
    await reject(row.id, 'A delivery was refused: the mapped email was invalid.');
    return json({ error: 'The mapped email is invalid.' }, 422);
  }

  const lease = randomUUID();
  const claimed = await db.query(
    `INSERT INTO journey_hook_deliveries (hook_id, delivery_key, lease_id, lease_expires_at)
     SELECT id, $2, $3, now() + interval '90 seconds' FROM journey_inbound_hooks WHERE id = $1 AND active AND secret = $4
     ON CONFLICT (hook_id, delivery_key) DO UPDATE SET lease_id = EXCLUDED.lease_id, lease_expires_at = EXCLUDED.lease_expires_at
     WHERE journey_hook_deliveries.outcome = '' AND coalesce(journey_hook_deliveries.lease_expires_at, '-infinity') <= now()
     RETURNING hook_id`, [row.id, deliveryKey, lease, row.secret],
  );
  if (!claimed.rowCount) {
    const completed = await db.query(`SELECT 1 FROM journey_hook_deliveries WHERE hook_id = $1 AND delivery_key = $2 AND outcome <> ''`, [row.id, deliveryKey]);
    return completed.rowCount ? json({ received: true, duplicate: true }) : retryDelivery();
  }

  try {
    const mapped = email ? await upsertContact({
      email, firstName: text(readPath(body, row.first_name_path)).slice(0, 120) || undefined,
      lastName: text(readPath(body, row.last_name_path)).slice(0, 120) || undefined,
      tags: row.tags, source: `Webhook: ${row.name}`,
    }) : null;
    const contactId = mapped?.contact.id ?? null;
    const outcome = email ? 'accepted' : `accepted without a contact (no email at ${row.email_path})`;
    const committed = await transaction(async client => {
      const updated = await client.query(
        `UPDATE journey_hook_deliveries SET contact_id = $4, outcome = $5, lease_id = NULL, lease_expires_at = NULL
         WHERE hook_id = $1 AND delivery_key = $2 AND lease_id = $3 RETURNING hook_id`, [row.id, deliveryKey, lease, contactId, outcome]);
      if (!updated.rowCount) return false;
      const amountText = text(readPath(body, row.amount_path));
      const amount = amountText ? Number(amountText) : NaN;
      const currency = text(readPath(body, row.currency_path)).toUpperCase();
      const fields = Object.fromEntries(Object.entries(body)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
        .slice(0, 30).map(([key, value]) => [key.slice(0, 60), String(value).slice(0, 200)]));
      await emitEvent({
        type: 'webhook.received', contactId, entityType: 'hook', entityId: row.id, source: `hook:${row.id}`,
        amount: Number.isFinite(amount) && Math.abs(amount) <= 1e12 ? amount : null,
        currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
        properties: { hookName: row.name, fields }, idempotencyKey: `webhook.received:${row.id}:${deliveryKey}`,
      }, client);
      await client.query('UPDATE journey_inbound_hooks SET received_count = received_count + 1, last_received_at = now() WHERE id = $1', [row.id]);
      return true;
    });
    return committed ? json({ received: true, contactId, outcome }, 202) : retryDelivery();
  } catch (error) {
    await db.query(`UPDATE journey_hook_deliveries SET lease_id = NULL, lease_expires_at = NULL
      WHERE hook_id = $1 AND delivery_key = $2 AND lease_id = $3`, [row.id, deliveryKey, lease]);
    throw error;
  }
}

const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

function parseDelivery(raw: Buffer): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function retryDelivery() {
  return Response.json({ error: 'This delivery is still being processed. Retry shortly.' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '15' } });
}

const hookId = (value: string) => z.uuid().parse(value);

export const hookEndpoints: Entry[] = [
  route('GET', /^journeys\/hooks$/, async ({ request }) => ({
    items: (await db.query<HookRow>('SELECT * FROM journey_inbound_hooks ORDER BY lower(name)')).rows.map(row => toHook(row, request)),
  }), 'admin'),
  route('POST', /^journeys\/hooks$/, async ({ request, user }) => {
    const input = await readBody(request, hookInput);
    const row = (await db.query<HookRow>(
      `INSERT INTO journey_inbound_hooks (name, secret, email_path, first_name_path, last_name_path, amount_path, currency_path, tags, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.name, newSecret(), input.emailPath, input.firstNamePath, input.lastNamePath, input.amountPath, input.currencyPath, input.tags, input.active, user.id])).rows[0];
    await audit(user.id, 'create', 'inbound_hook', row.id, input.name);
    return json(toHook(row, request), 201);
  }, 'admin'),
  route('PATCH', /^journeys\/hooks\/([0-9a-f-]{36})$/, async ({ request, params, user }) => {
    const input = await readBody(request, hookInput);
    const row = (await db.query<HookRow>(
      `UPDATE journey_inbound_hooks SET name = $2, email_path = $3, first_name_path = $4, last_name_path = $5, amount_path = $6, currency_path = $7,
         tags = $8, active = $9, updated_at = now() WHERE id = $1 RETURNING *`,
      [hookId(params[0]), input.name, input.emailPath, input.firstNamePath, input.lastNamePath, input.amountPath, input.currencyPath, input.tags, input.active])).rows[0];
    if (!row) throw new AppError(404, 'That webhook was not found.');
    await audit(user.id, 'update', 'inbound_hook', row.id, input.name);
    return toHook(row, request);
  }, 'admin'),
  route('POST', /^journeys\/hooks\/([0-9a-f-]{36})\/rotate$/, async ({ request, params, user }) => {
    const row = (await db.query<HookRow>('UPDATE journey_inbound_hooks SET secret = $2, updated_at = now() WHERE id = $1 RETURNING *', [hookId(params[0]), newSecret()])).rows[0];
    if (!row) throw new AppError(404, 'That webhook was not found.');
    await audit(user.id, 'rotate_secret', 'inbound_hook', row.id, row.name);
    return toHook(row, request);
  }, 'admin'),
  route('DELETE', /^journeys\/hooks\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const id = hookId(params[0]);
    await db.query('DELETE FROM journey_inbound_hooks WHERE id = $1', [id]);
    await audit(user.id, 'delete', 'inbound_hook', id, '');
    return new Response(null, { status: 204 });
  }, 'admin'),
  route('GET', /^journeys\/hooks\/([0-9a-f-]{36})\/deliveries$/, async ({ params }) => ({
    items: (await db.query<{ delivery_key: string; contact_id: string | null; outcome: string; received_at: Date }>(
      'SELECT delivery_key, contact_id, outcome, received_at FROM journey_hook_deliveries WHERE hook_id = $1 ORDER BY received_at DESC LIMIT 50', [hookId(params[0])]))
      .rows.map(row => ({ deliveryKey: row.delivery_key, contactId: row.contact_id == null ? null : Number(row.contact_id), outcome: row.outcome, receivedAt: iso(row.received_at) })),
  }), 'admin'),
  // Names only, for the workflow trigger picker (marketers build workflows; secrets stay with admins).
  route('GET', /^journeys\/lookups\/hooks$/, async () => ({ items: (await db.query<{ id: string; name: string; active: boolean }>('SELECT id, name, active FROM journey_inbound_hooks ORDER BY lower(name)')).rows.map(row => ({ id: row.id, name: row.name, status: row.active ? 'active' : 'paused' })) }), 'marketer'),
];
