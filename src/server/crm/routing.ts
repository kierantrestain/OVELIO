// Lead routing: assignment rules applied to new contacts without an owner when contact.created or form.submitted
// arrives. The first active matching rule (by position) hands the lead to the next user in its rotation, writes
// record_owners and emits contact.owner_changed, all in one transaction keyed by the event id.
import { z } from 'zod';
import type { PlatformEvent } from '@/contracts/platform';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { audit, emitEvent } from '../events';
import { json, readBody } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { engineContactCountry } from './engine';
import { uuid } from './shared';

export type RoutingRule = {
  id: string; name: string; position: number; active: boolean; matchField: 'any' | 'country' | 'source' | 'form'; matchValue: string;
  userIds: string[]; users: { id: string; name: string }[]; nextIndex: number;
};

type RuleRow = { id: string; name: string; position: number; active: boolean; match_field: RoutingRule['matchField']; match_value: string; user_ids: string[] | string; next_index: number };

/** PGlite and node-pg both return uuid[] as arrays; a text form is parsed defensively. */
const ids = (value: string[] | string) => Array.isArray(value) ? value : value.replace(/[{}]/g, '').split(',').filter(Boolean);

export async function listRules(): Promise<RoutingRule[]> {
  const [rules, users] = await Promise.all([
    db.query<RuleRow>('SELECT id, name, position, active, match_field, match_value, user_ids, next_index FROM crm_routing_rules ORDER BY position, created_at'),
    db.query<{ id: string; name: string }>('SELECT id, name FROM users WHERE disabled_at IS NULL'),
  ]);
  const names = new Map(users.rows.map(row => [row.id, row.name]));
  return rules.rows.map(row => ({
    id: row.id, name: row.name, position: row.position, active: row.active, matchField: row.match_field, matchValue: row.match_value,
    userIds: ids(row.user_ids), users: ids(row.user_ids).filter(id => names.has(id)).map(id => ({ id, name: names.get(id)! })), nextIndex: row.next_index,
  }));
}

const lower = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';

export function ruleMatches(rule: Pick<RoutingRule, 'matchField' | 'matchValue'>, event: PlatformEvent, country: string) {
  const wanted = lower(rule.matchValue);
  switch (rule.matchField) {
    case 'any': return true;
    case 'country': return Boolean(wanted) && lower(country) === wanted;
    case 'source': return Boolean(wanted) && [event.source, event.utm?.source, event.properties.source].some(value => lower(value) === wanted);
    case 'form': return event.type === 'form.submitted' && Boolean(wanted) && (lower(event.entityId) === wanted || lower(event.properties.formName) === wanted);
  }
}

/** Platform event handler. Safe to repeat: the routing log and the existing-owner check stop a second assignment. */
export async function routeLead(event: PlatformEvent) {
  if ((event.type !== 'contact.created' && event.type !== 'form.submitted') || !event.contactId) return;
  const contactId = event.contactId;
  const owned = await db.query(`SELECT 1 FROM record_owners WHERE object = 'contact' AND record_id = $1`, [contactId]);
  if (owned.rows[0]) return;
  const rules = (await listRules()).filter(rule => rule.active && rule.users.length);
  if (!rules.length) return;
  const country = rules.some(rule => rule.matchField === 'country') ? await engineContactCountry(contactId).catch(() => '') : '';
  const rule = rules.find(item => ruleMatches(item, event, country));
  if (!rule) return;
  await transaction(async client => {
    const logged = await client.query('INSERT INTO crm_routing_log (event_id, contact_id, rule_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING event_id', [event.id, contactId, rule.id]);
    if (!logged.rows[0]) return;
    const taken = await client.query(`SELECT 1 FROM record_owners WHERE object = 'contact' AND record_id = $1 FOR UPDATE`, [contactId]);
    if (taken.rows[0]) return;
    const cursor = (await client.query<{ next_index: number }>('UPDATE crm_routing_rules SET next_index = next_index + 1 WHERE id = $1 RETURNING next_index', [rule.id])).rows[0].next_index - 1;
    const owner = rule.users[cursor % rule.users.length];
    await client.query(`INSERT INTO record_owners (object, record_id, owner_id) VALUES ('contact', $1, $2) ON CONFLICT DO NOTHING`, [contactId, owner.id]);
    await client.query('UPDATE crm_routing_log SET owner_id = $2 WHERE event_id = $1', [event.id, owner.id]);
    await emitEvent({
      type: 'contact.owner_changed', contactId, entityType: 'contact', entityId: String(contactId), source: 'routing',
      properties: { fromOwnerId: null, ownerId: owner.id, ownerName: owner.name, ruleId: rule.id, ruleName: rule.name, trigger: event.type },
      idempotencyKey: `routing:${event.id}`,
    }, client);
    await audit(null, 'assign_owner', 'contact', String(contactId), `Lead routing (${rule.name}): ${owner.name}`, client);
  });
}

const ruleInput = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
  matchField: z.enum(['any', 'country', 'source', 'form']).default('any'),
  matchValue: z.string().trim().max(120).default(''),
  userIds: z.array(uuid).min(1, 'Choose at least one person to receive leads.').max(50),
}).refine(rule => rule.matchField === 'any' || rule.matchValue, 'Enter the value this rule matches.');

export const routingEndpoints: Entry[] = [
  route('GET', /^crm\/routing$/, async () => {
    const recent = await db.query<{ contact_id: string; owner: string | null; rule: string | null; assigned_at: Date }>(
      `SELECT l.contact_id, u.name AS owner, r.name AS rule, l.assigned_at FROM crm_routing_log l LEFT JOIN users u ON u.id = l.owner_id
       LEFT JOIN crm_routing_rules r ON r.id = l.rule_id WHERE l.owner_id IS NOT NULL ORDER BY l.assigned_at DESC LIMIT 10`);
    return {
      rules: await listRules(),
      recent: recent.rows.map(row => ({ contactId: Number(row.contact_id), owner: row.owner ?? '', rule: row.rule ?? '', at: new Date(row.assigned_at).toISOString() })),
    };
  }, 'marketer'),
  route('POST', /^crm\/routing$/, async ({ request, user }) => {
    const input = await readBody(request, ruleInput);
    const row = await db.query<{ id: string }>(
      `INSERT INTO crm_routing_rules (name, active, match_field, match_value, user_ids, position)
       VALUES ($1, $2, $3, $4, $5::uuid[], (SELECT coalesce(max(position), -1) + 1 FROM crm_routing_rules)) RETURNING id`,
      [input.name, input.active, input.matchField, input.matchValue, input.userIds]);
    await audit(user.id, 'create', 'routing_rule', row.rows[0].id, input.name);
    return json(await listRules(), 201);
  }, 'marketer'),
  route('PATCH', /^crm\/routing\/([0-9a-f-]{36})$/, async ({ request, params, user }) => {
    const input = await readBody(request, ruleInput);
    const updated = await db.query(
      `UPDATE crm_routing_rules SET name = $2, active = $3, match_field = $4, match_value = $5, user_ids = $6::uuid[], updated_at = now() WHERE id = $1`,
      [uuid.parse(params[0]), input.name, input.active, input.matchField, input.matchValue, input.userIds]);
    if (!updated.rowCount) throw new AppError(404, 'That rule was not found.');
    await audit(user.id, 'update', 'routing_rule', params[0], input.name);
    return listRules();
  }, 'marketer'),
  route('POST', /^crm\/routing\/order$/, async ({ request }) => {
    const { ids: order } = await readBody(request, z.object({ ids: z.array(uuid).min(1).max(100) }));
    await transaction(async client => {
      for (const [position, id] of order.entries()) await client.query('UPDATE crm_routing_rules SET position = $2 WHERE id = $1', [id, position]);
    });
    return listRules();
  }, 'marketer'),
  route('DELETE', /^crm\/routing\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    await db.query('DELETE FROM crm_routing_rules WHERE id = $1', [uuid.parse(params[0])]);
    await audit(user.id, 'delete', 'routing_rule', params[0]);
    return listRules();
  }, 'marketer'),
];
