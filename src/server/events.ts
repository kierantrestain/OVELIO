// Emits the unified platform events (src/contracts/platform.ts) and records the audit log.
import type { EventInput, PlatformEvent, PlatformEventType } from '@/contracts/platform';
import { platformEventTypes } from '@/contracts/platform';
import { db } from './db';
import type { Sql } from './db';
import { mailboxRecordVisible } from './mailbox-access';
import { schedulePlatformJob } from './platform/jobs';

type EventRow = {
  id: string; type: PlatformEventType; occurred_at: Date; contact_id: string | null; company_id: string | null; deal_id: string | null;
  campaign_id: string | null; entity_type: string | null; entity_id: string | null; source: string; visitor_id: string | null;
  amount: string | null; currency: string | null; utm: PlatformEvent['utm']; properties: Record<string, unknown>; actor_id: string | null;
};

export const eventColumns = `id, type, occurred_at, contact_id, company_id, deal_id, campaign_id, entity_type, entity_id, source,
  visitor_id, amount, currency, utm, properties, actor_id`;

export function toEvent(row: EventRow): PlatformEvent {
  return {
    id: String(row.id),
    type: row.type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    contactId: row.contact_id == null ? null : Number(row.contact_id),
    companyId: row.company_id == null ? null : Number(row.company_id),
    dealId: row.deal_id,
    campaignId: row.campaign_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    source: row.source,
    visitorId: row.visitor_id,
    amount: row.amount == null ? null : Number(row.amount),
    currency: row.currency,
    utm: row.utm ?? {},
    properties: row.properties ?? {},
    actorId: row.actor_id,
  };
}

/**
 * Records an event and queues its dispatch to every module's `onPlatformEvent` (automations, sequences, campaigns).
 * Pass the transaction client to emit atomically with the change that caused it. Returns null for a duplicate key.
 */
export async function emitEvent(input: EventInput, client: Sql = db): Promise<PlatformEvent | null> {
  if (!platformEventTypes.includes(input.type)) throw new Error(`Unknown platform event type: ${input.type}`);
  const result = await client.query<EventRow>(
    `INSERT INTO events (type, occurred_at, contact_id, company_id, deal_id, campaign_id, entity_type, entity_id, source,
       visitor_id, amount, currency, utm, properties, actor_id, idempotency_key, mailbox_id)
     VALUES ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${eventColumns}`,
    [
      input.type, input.occurredAt ? new Date(input.occurredAt).toISOString() : null, input.contactId ?? null, input.companyId ?? null,
      input.dealId ?? null, input.campaignId ?? null, input.entityType ?? null, input.entityId ?? null, input.source ?? 'ovelio',
      input.visitorId ?? null, input.amount ?? null, input.currency ?? null, JSON.stringify(input.utm ?? {}),
      JSON.stringify(input.properties ?? {}), input.actorId ?? null, input.idempotencyKey ?? null, input.mailboxId ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) return null;
  const event = toEvent(row);
  await schedulePlatformJob('event.dispatch', event.id, { eventId: event.id }, { client });
  return event;
}

export async function listEvents(filter: {
  contactId?: number; companyId?: number; dealId?: string; campaignId?: string; entityType?: string; entityId?: string;
  types?: PlatformEventType[]; since?: Date; until?: Date; limit?: number;
}, viewerId?: string): Promise<PlatformEvent[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace('?', '$' + values.length)); };
  if (viewerId) add(mailboxRecordVisible('events.mailbox_id', '?'), viewerId);
  else where.push('events.mailbox_id IS NULL');
  if (filter.contactId) add('contact_id = ?', filter.contactId);
  if (filter.companyId) add('company_id = ?', filter.companyId);
  if (filter.dealId) add('deal_id = ?', filter.dealId);
  if (filter.campaignId) add('campaign_id = ?', filter.campaignId);
  if (filter.entityType) add('entity_type = ?', filter.entityType);
  if (filter.entityId) add('entity_id = ?', filter.entityId);
  if (filter.types?.length) add('type = ANY(?::text[])', filter.types);
  if (filter.since) add('occurred_at >= ?', filter.since.toISOString());
  if (filter.until) add('occurred_at < ?', filter.until.toISOString());
  values.push(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
  const result = await db.query<EventRow>(
    `SELECT ${eventColumns} FROM events WHERE ${where.join(' AND ')}
     ORDER BY occurred_at DESC, id DESC LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toEvent);
}

export async function audit(actorId: string | null | undefined, action: string, entityType: string, entityId: string, summary = '', client: Sql = db) {
  await client.query(
    'INSERT INTO audit_log (actor_id, action, entity_type, entity_id, summary) VALUES ($1, $2, $3, $4, $5)',
    [actorId ?? null, action, entityType, entityId, summary.slice(0, 500)],
  );
}
