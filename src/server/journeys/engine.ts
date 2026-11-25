// OVELIO's native flow engine (lane 4, docs/rebuild/TRACKER.md D6). Platform events enrol contacts in published
// flows; every step runs as a platform job ('journeys.step'), writes the step log, and schedules the next step.
// Nothing is simulated: each action runs against the directory, records, mailer or a real HTTP endpoint, or is
// logged as skipped/failed with the reason.

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { DirectoryContact, PlatformEvent } from '@/contracts/platform';
import type {
  ConditionOperator, DryRunResult, DryRunStep, FlowGraph, FlowHandle, FlowNode, FlowTrigger, ReentryRule, StepStatus,
} from '@/contracts/journeys';
import {
  clampPercent, conditionChecks, contactFieldChoices, describeNode, describeTrigger, nodeSpec, operatorLabels, tagsOf,
  triggerSpec, waitMilliseconds,
} from '@/contracts/journeys';
import { renderMergeTags } from '@/contracts/merge-tags';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { adjustPoints, canEmail, getContact, tagContact } from '../directory';
import { emitEvent, eventColumns, listEvents, toEvent } from '../events';
import { sendDesign } from '../mailer';
import { schedulePlatformJob } from '../platform/jobs';
import { createDeal, createTask, moveDeal } from '../records';

export const STEP_JOB = 'journeys.step';
/** Attempts per step before the enrolment is marked failed. The job queue backs off between attempts. */
export const MAX_ATTEMPTS = 3;
/** Safety stop for flows that loop through a wait. */
const MAX_STEPS = 500;

export class StepError extends Error {
  constructor(message: string, readonly retry: boolean) {
    super(message);
    this.name = 'StepError';
  }
}

export type FlowRow = {
  id: string; name: string; description: string; status: 'draft' | 'published' | 'paused' | 'archived'; triggers: FlowTrigger[];
  reentry: ReentryRule; graph: FlowGraph; campaign_id: string | null; published_version: number | null; owner_id: string | null;
  template_key: string | null; created_by: string | null; created_at: Date; updated_at: Date; published_at: Date | null;
  paused_at: Date | null; archived_at: Date | null;
};

export type EnrolmentRow = {
  id: string; flow_id: string; version: number; contact_id: string | null; status: 'active' | 'waiting' | 'completed' | 'failed' | 'exited';
  current_node: string | null; step_seq: number; trigger_type: string; trigger_event_id: string | null; deal_id: string | null;
  entry_key: string; held_at: Date | null; next_run_at: Date | null; error: string; enrolled_by: string | null; enrolled_at: Date;
  updated_at: Date; finished_at: Date | null;
};

type VersionRow = { graph: FlowGraph; triggers: FlowTrigger[]; reentry: ReentryRule };

export function nextOf(graph: FlowGraph, nodeId: string, handle: FlowHandle = 'next'): string | null {
  return graph.edges.find(edge => edge.source === nodeId && edge.sourceHandle === handle)?.target ?? null;
}

async function loadVersion(flowId: string, version: number, client: Sql = db): Promise<VersionRow | null> {
  const result = await client.query<VersionRow>('SELECT graph, triggers, reentry FROM journey_flow_versions WHERE flow_id = $1 AND version = $2', [flowId, version]);
  return result.rows[0] ?? null;
}

async function loadEvent(id: string | null): Promise<PlatformEvent | null> {
  if (!id) return null;
  const result = await db.query(`SELECT ${eventColumns} FROM events WHERE id = $1`, [id]);
  return result.rows[0] ? toEvent(result.rows[0] as Parameters<typeof toEvent>[0]) : null;
}

function mergeValues(contact: DirectoryContact | null): Record<string, string> {
  return {
    'contact.first_name': contact?.firstName ?? '',
    'contact.last_name': contact?.lastName ?? '',
    'contact.full_name': contact ? contact.name : 'the contact',
    'contact.email': contact?.email ?? '',
    'contact.company': contact?.company ?? '',
    'contact.position': contact?.position ?? '',
    'contact.phone': contact?.phone ?? '',
  };
}

const render = (template: unknown, contact: DirectoryContact | null) => renderMergeTags(String(template ?? ''), mergeValues(contact), { html: false }).trim();

/* ── Enrolment ─────────────────────────────────────────────────────────────────────────────────────────── */

export type EnrolInput = {
  flowId: string;
  contactId: number | null;
  triggerType: string;
  event?: PlatformEvent | null;
  actorId?: string | null;
};

/** Enrols one contact (or a contactless trigger) in a published flow. Never enrols twice for the same event or, for once-only flows, at all. */
export async function enrol(input: EnrolInput): Promise<{ id: string | null; reason?: string }> {
  const flow = (await db.query<FlowRow>('SELECT * FROM journey_flows WHERE id = $1', [input.flowId])).rows[0];
  if (!flow) throw new AppError(404, 'That workflow was not found.');
  if (flow.status !== 'published' || !flow.published_version) {
    return { id: null, reason: flow.status === 'paused' ? 'The workflow is paused.' : 'Publish the workflow before enrolling contacts.' };
  }
  const version = await loadVersion(flow.id, flow.published_version);
  if (!version) throw new AppError(409, 'The published version of this workflow is missing.');
  const contactId = input.contactId && input.contactId > 0 ? input.contactId : null;
  if (contactId && !(await getContact(contactId))) return { id: null, reason: 'That contact was not found.' };
  if (contactId) {
    const last = (await db.query<{ status: string }>(
      'SELECT status FROM journey_enrolments WHERE flow_id = $1 AND contact_id = $2 ORDER BY enrolled_at DESC LIMIT 1', [flow.id, contactId],
    )).rows[0];
    if (last && version.reentry === 'once') return { id: null, reason: 'Already went through this workflow (it runs once per contact).' };
    if (last && (last.status === 'active' || last.status === 'waiting')) return { id: null, reason: 'Already in this workflow.' };
  }
  const event = input.event ?? null;
  const entryKey = version.reentry === 'once' && contactId
    ? `once:${flow.id}:${contactId}`
    : event ? `event:${flow.id}:${event.id}:${contactId ?? 0}` : `manual:${flow.id}:${contactId ?? 0}:${randomUUID()}`;
  const start = version.graph.nodes.find(node => node.type === 'start');
  const first = start ? nextOf(version.graph, start.id) : null;
  const trigger = input.triggerType === 'manual' ? 'Enrolled manually' : `Trigger: ${triggerSpec(input.triggerType as FlowTrigger['type']).label}`;

  return transaction(async client => {
    const inserted = await client.query<EnrolmentRow>(
      `INSERT INTO journey_enrolments (flow_id, version, contact_id, status, current_node, step_seq, trigger_type, trigger_event_id,
         deal_id, entry_key, enrolled_by, next_run_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, CASE WHEN $4 = 'active' THEN now() END, CASE WHEN $4 = 'completed' THEN now() END)
       ON CONFLICT DO NOTHING RETURNING *`,
      [flow.id, flow.published_version, contactId, first ? 'active' : 'completed', first, input.triggerType, event?.id ?? null,
        event?.dealId ?? null, entryKey, input.actorId ?? null],
    );
    const row = inserted.rows[0];
    if (!row) return { id: null, reason: 'Already enrolled from this event.' };
    await client.query(
      `INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail) VALUES ($1, 0, $2, 'start', 'Enrolled', 'ok', $3)`,
      [row.id, start?.id ?? 'start', `${trigger} · version ${flow.published_version}`],
    );
    const base = { contactId, entityType: 'flow', entityId: flow.id, campaignId: flow.campaign_id, source: `flow:${flow.id}`, actorId: input.actorId ?? null };
    await emitEvent({ ...base, type: 'flow.enrolled', properties: { enrolmentId: row.id, flowName: flow.name, version: row.version, trigger: input.triggerType }, idempotencyKey: `flow.enrolled:${row.id}` }, client);
    if (first) await schedulePlatformJob(STEP_JOB, `${row.id}:1`, { enrolmentId: row.id, seq: 1 }, { client });
    else await emitEvent({ ...base, type: 'flow.completed', properties: { enrolmentId: row.id, flowName: flow.name, outcome: 'completed' }, idempotencyKey: `flow.completed:${row.id}` }, client);
    return { id: row.id };
  });
}

/* ── Trigger matching ──────────────────────────────────────────────────────────────────────────────────── */

async function triggerMatches(trigger: FlowTrigger, event: PlatformEvent): Promise<boolean> {
  const f = trigger.filters ?? {};
  const props = event.properties ?? {};
  switch (trigger.type) {
    case 'form.submitted': return !f.formId || event.entityId === f.formId;
    case 'page.converted': case 'page.viewed': return !f.pageId || event.entityId === f.pageId;
    case 'deal.created': return !f.pipelineId || props.pipelineId === f.pipelineId;
    case 'deal.stage_changed': return (!f.pipelineId || props.pipelineId === f.pipelineId) && (!f.stageId || props.toStageId === f.stageId);
    case 'deal.won': case 'deal.lost': {
      if (!f.pipelineId) return true;
      if (!event.dealId) return false;
      const deal = await db.query<{ pipeline_id: string }>('SELECT pipeline_id FROM deals WHERE id = $1', [event.dealId]);
      return deal.rows[0]?.pipeline_id === f.pipelineId;
    }
    case 'contact.tagged': {
      const tags = Array.isArray(props.tags) ? props.tags.map(String) : typeof props.tag === 'string' ? [props.tag] : [];
      return Boolean(f.tag) && tags.some(tag => tag.toLowerCase() === f.tag!.trim().toLowerCase());
    }
    case 'campaign.launched': return !f.campaignId || event.campaignId === f.campaignId;
    default: return true;
  }
}

/**
 * True when the event came, directly or through other flows, from this flow's own actions. A flow never triggers
 * itself in a loop: its tag, deal and task events carry source 'flow:<id>', and the chain is followed up to six hops.
 */
async function causedByFlow(event: PlatformEvent, flowId: string): Promise<boolean> {
  let source = event.source;
  let at = event.occurredAt;
  for (let depth = 0; depth < 6 && source?.startsWith('flow:'); depth += 1) {
    const origin = source.slice(5);
    if (origin === flowId) return true;
    const parent = await db.query<{ source: string | null; occurred_at: Date | null }>(
      `SELECT ev.source, ev.occurred_at FROM journey_enrolments e LEFT JOIN events ev ON ev.id = e.trigger_event_id
       WHERE e.flow_id::text = $1 AND e.contact_id IS NOT DISTINCT FROM $2 AND e.enrolled_at <= $3::timestamptz
       ORDER BY e.enrolled_at DESC LIMIT 1`,
      [origin, event.contactId, at],
    );
    source = parent.rows[0]?.source ?? '';
    at = parent.rows[0]?.occurred_at ? new Date(parent.rows[0].occurred_at).toISOString() : at;
  }
  return false;
}

/** The lane's onPlatformEvent: enrol the event's contact in every published flow whose triggers match. Idempotent. */
export async function handlePlatformEvent(event: PlatformEvent): Promise<void> {
  if (!(triggerSpecTypes as readonly string[]).includes(event.type)) return;
  const flows = await db.query<{ id: string; triggers: FlowTrigger[] }>(
    `SELECT f.id, v.triggers FROM journey_flows f
     JOIN journey_flow_versions v ON v.flow_id = f.id AND v.version = f.published_version
     WHERE f.status = 'published' AND v.triggers @> $1::jsonb`,
    [JSON.stringify([{ type: event.type }])],
  );
  for (const flow of flows.rows) {
    if (event.source === `flow:${flow.id}`) continue;
    let matched: FlowTrigger | undefined;
    for (const trigger of flow.triggers.filter(item => item.type === event.type)) {
      if (await triggerMatches(trigger, event)) { matched = trigger; break; }
    }
    if (!matched) continue;
    const contactless = triggerSpec(matched.type).contactless;
    if (!contactless && !event.contactId) continue;
    if (await causedByFlow(event, flow.id)) continue;
    await enrol({ flowId: flow.id, contactId: contactless ? null : event.contactId, triggerType: event.type, event });
  }
}

const triggerSpecTypes = ['form.submitted', 'page.converted', 'page.viewed', 'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
  'task.completed', 'contact.created', 'contact.tagged', 'email.unsubscribed', 'campaign.launched'] as const;

/* ── Conditions ────────────────────────────────────────────────────────────────────────────────────────── */

type ConditionContext = { contact: DirectoryContact | null; event: PlatformEvent | null; dealId: string | null };

function compareText(actual: string, operator: ConditionOperator, expected: string) {
  const a = actual.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  switch (operator) {
    case 'equals': return a === b;
    case 'not_equals': return a !== b;
    case 'contains': return a.includes(b);
    case 'not_contains': return !a.includes(b);
    case 'is_empty': return !a;
    case 'is_not_empty': return Boolean(a);
    default: return false;
  }
}

function compareNumber(actual: number, operator: ConditionOperator, expected: number) {
  switch (operator) {
    case 'gte': return actual >= expected;
    case 'gt': return actual > expected;
    case 'lte': return actual <= expected;
    case 'lt': return actual < expected;
    case 'equals': return actual === expected;
    default: return false;
  }
}

/** Evaluates a condition node. Reads only, so the dry run uses it too. */
export async function evaluateCondition(config: Record<string, unknown>, ctx: ConditionContext): Promise<{ yes: boolean; detail: string }> {
  const check = String(config.check ?? '');
  const operator = String(config.operator ?? '') as ConditionOperator;
  const value = String(config.value ?? '');
  const op = operatorLabels[operator] ?? operator;
  const { contact } = ctx;
  const needsContact = ['field', 'tag', 'score', 'consent', 'open_deal'].includes(check);
  if (needsContact && !contact) return { yes: false, detail: 'No: this enrolment has no contact.' };
  const answer = (yes: boolean, why: string) => ({ yes, detail: `${yes ? 'Yes' : 'No'}: ${why}` });
  switch (check) {
    case 'tag': {
      const has = contact!.tags.some(tag => tag.toLowerCase() === value.trim().toLowerCase());
      return answer(operator === 'not_has' ? !has : has, `${has ? 'has' : 'does not have'} tag “${value}”.`);
    }
    case 'field': {
      const field = String(config.field ?? '') as keyof DirectoryContact;
      const label = contactFieldChoices.find(item => item.value === field)?.label ?? field;
      const actual = String(contact![field] ?? '');
      return answer(compareText(actual, operator, value), `${label} is “${actual || 'empty'}”.`);
    }
    case 'score': return answer(compareNumber(contact!.points, operator, Number(value)), `lead score is ${contact!.points} (${op} ${value}).`);
    case 'consent': {
      const permission = await canEmail(contact!.email);
      return answer(operator === 'no' ? !permission.allowed : permission.allowed, permission.allowed ? 'email consent is recorded.' : permission.reason ?? 'cannot be emailed.');
    }
    case 'open_deal': {
      const open = await db.query<{ n: string }>(`SELECT count(*) AS n FROM deals WHERE contact_id = $1 AND status = 'open' AND archived_at IS NULL`, [contact!.id]);
      const count = Number(open.rows[0]?.n ?? 0);
      return answer(operator === 'no' ? count === 0 : count > 0, count ? `${count} open deal${count === 1 ? '' : 's'}.` : 'no open deals.');
    }
    case 'deal_value': {
      const row = ctx.dealId
        ? (await db.query<{ amount: string; name: string }>('SELECT amount, name FROM deals WHERE id = $1', [ctx.dealId])).rows[0]
        : contact
          ? (await db.query<{ amount: string; name: string }>(`SELECT amount, name FROM deals WHERE contact_id = $1 AND archived_at IS NULL ORDER BY (status = 'open') DESC, amount DESC LIMIT 1`, [contact.id])).rows[0]
          : undefined;
      if (!row) return answer(false, 'no deal to compare.');
      return answer(compareNumber(Number(row.amount), operator, Number(value)), `“${row.name}” is worth ${Number(row.amount)} (${op} ${value}).`);
    }
    case 'form_field': {
      const field = String(config.field ?? '');
      const fields = (ctx.event?.properties?.fields ?? {}) as Record<string, unknown>;
      if (!ctx.event || ctx.event.type !== 'form.submitted') return answer(compareText('', operator, value), 'the flow did not start from a form submission.');
      const raw = fields[field] ?? Object.entries(fields).find(([key]) => key.toLowerCase() === field.toLowerCase())?.[1];
      const actual = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '');
      return answer(compareText(actual, operator, value), `answer “${field}” is “${actual || 'empty'}”.`);
    }
  }
  return answer(false, `unknown check “${check}”.`);
}

function splitPath(enrolmentId: string, node: FlowNode): 'a' | 'b' {
  const bucket = createHash('sha256').update(`${enrolmentId}:${node.id}`).digest().readUInt16BE(0) % 100;
  return bucket < clampPercent(node.config.percentA) ? 'a' : 'b';
}

/* ── Actions ───────────────────────────────────────────────────────────────────────────────────────────── */

type Outcome = { status: StepStatus; detail: string; handle?: FlowHandle; delayUntil?: Date; end?: 'exited' };

type StepContext = { flow: FlowRow; enrolment: EnrolmentRow; contact: DirectoryContact | null; event: PlatformEvent | null; seq: number };

async function ownerFor(ctx: StepContext): Promise<string | null> {
  if (ctx.enrolment.deal_id) {
    const deal = await db.query<{ owner_id: string | null }>('SELECT owner_id FROM deals WHERE id = $1', [ctx.enrolment.deal_id]);
    if (deal.rows[0]?.owner_id) return deal.rows[0].owner_id;
  }
  if (ctx.contact) {
    const owner = await db.query<{ owner_id: string }>(`SELECT owner_id FROM record_owners WHERE object = 'contact' AND record_id = $1`, [ctx.contact.id]);
    if (owner.rows[0]) return owner.rows[0].owner_id;
  }
  return ctx.flow.owner_id ?? ctx.flow.created_by ?? null;
}

function isPrivateAddress(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.includes(':')) {
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  const [a, b] = lower.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Webhooks may not reach the private network (engines, database) unless the operator allows it. */
async function assertPublicTarget(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new StepError('Only http and https webhooks are allowed.', false);
  if (process.env.OVELIO_WEBHOOK_ALLOW_PRIVATE === 'true') return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map(item => item.address);
  } catch {
    throw new StepError(`Could not resolve ${host}.`, true);
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new StepError('Webhooks cannot be sent to private or internal network addresses.', false);
}

/** Signs `timestamp.body` with HMAC-SHA256; receivers recompute it with the shared secret. */
export function webhookSignature(secret: string, timestamp: string, body: string) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function sendWebhook(node: FlowNode, ctx: StepContext): Promise<Outcome> {
  let url: URL;
  try { url = new URL(String(node.config.url ?? '')); } catch { throw new StepError('The webhook URL is not valid.', false); }
  await assertPublicTarget(url);
  const secret = String(node.config.secret ?? '');
  if (secret.length < 16) throw new StepError('The webhook has no signing secret.', false);
  const body = JSON.stringify({
    type: 'flow.webhook',
    flow: { id: ctx.flow.id, name: ctx.flow.name },
    enrolmentId: ctx.enrolment.id,
    step: node.id,
    contact: ctx.contact && {
      id: ctx.contact.id, email: ctx.contact.email, firstName: ctx.contact.firstName, lastName: ctx.contact.lastName,
      company: ctx.contact.company, tags: ctx.contact.tags, points: ctx.contact.points,
    },
    trigger: ctx.event && { id: ctx.event.id, type: ctx.event.type, entityType: ctx.event.entityType, entityId: ctx.event.entityId, dealId: ctx.event.dealId, properties: ctx.event.properties },
    sentAt: new Date().toISOString(),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'OVELIO-Workflows/1.0',
        'x-ovelio-timestamp': timestamp,
        'x-ovelio-signature': webhookSignature(secret, timestamp, body),
        'x-ovelio-delivery': `${ctx.enrolment.id}:${ctx.seq}`,
      },
    });
  } catch (error) {
    const name = (error as Error).name;
    throw new StepError(name === 'TimeoutError' || name === 'AbortError' ? `${url.host} did not answer within 10 seconds.` : `Could not reach ${url.host}: ${(error as Error).message}`, true);
  }
  if (!response.ok) {
    throw new StepError(`${url.host} answered HTTP ${response.status}.`, response.status >= 500 || response.status === 408 || response.status === 429);
  }
  return { status: 'ok', detail: `Delivered to ${url.host} (HTTP ${response.status}).` };
}

async function execute(node: FlowNode, ctx: StepContext): Promise<Outcome> {
  const c = node.config ?? {};
  const { contact, flow, enrolment } = ctx;
  const source = `flow:${flow.id}`;
  if (nodeSpec(node.type).needsContact && !contact) return { status: 'skipped', detail: 'Skipped: this enrolment has no contact.' };
  switch (node.type) {
    case 'start': return { status: 'ok', detail: 'Started.' };
    case 'wait': {
      const until = c.mode === 'until' ? new Date(String(c.until ?? '')) : new Date(Date.now() + waitMilliseconds(c));
      if (Number.isNaN(until.getTime())) throw new StepError('The wait has no valid date.', false);
      const label = until.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
      if (until.getTime() <= Date.now()) return { status: 'ok', detail: `No wait: ${label} UTC has already passed.` };
      return { status: 'waiting', detail: `${describeNode(node)}${c.mode === 'until' ? '' : `, until ${label} UTC`}.`, delayUntil: until };
    }
    case 'condition': {
      const result = await evaluateCondition(c, { contact, event: ctx.event, dealId: enrolment.deal_id });
      return { status: 'ok', detail: result.detail, handle: result.yes ? 'yes' : 'no' };
    }
    case 'split': {
      const path = splitPath(enrolment.id, node);
      return { status: 'ok', detail: `Path ${path.toUpperCase()} (${describeNode(node)}).`, handle: path };
    }
    case 'send_email': {
      let result;
      try {
        result = await sendDesign(String(c.designId), {
          to: contact!.email, category: 'marketing', source, contactId: contact!.id, campaignId: flow.campaign_id,
          idempotencyKey: `flow:${enrolment.id}:${ctx.seq}`,
        });
      } catch (error) {
        if (error instanceof AppError && error.status < 500) throw new StepError(error.message, false);
        throw error;
      }
      const name = String(c.designName || 'the email');
      if (result.status === 'sent') return { status: 'ok', detail: `Sent “${name}” to ${contact!.email}.` };
      if (result.status === 'failed') throw new StepError(result.reason, false);
      return { status: 'skipped', detail: `${result.status === 'blocked' ? 'Blocked' : 'Not sent'}: ${result.reason.replace(/^Not (sent|delivered): /, '')}` };
    }
    case 'add_tag': case 'remove_tag': {
      const tags = tagsOf(c.tags);
      const before = new Set(contact!.tags.map(tag => tag.toLowerCase()));
      if (node.type === 'add_tag') {
        const added = tags.filter(tag => !before.has(tag.toLowerCase()));
        await tagContact(contact!.id, tags);
        if (added.length) {
          await emitEvent({
            type: 'contact.tagged', contactId: contact!.id, campaignId: flow.campaign_id, source, entityType: 'flow', entityId: flow.id,
            properties: { tags: added, flowName: flow.name }, idempotencyKey: `contact.tagged:${enrolment.id}:${ctx.seq}`,
          });
        }
        return { status: 'ok', detail: added.length ? `Added ${added.join(', ')}.` : `Already tagged ${tags.join(', ')}.` };
      }
      await tagContact(contact!.id, [], tags);
      return { status: 'ok', detail: `Removed ${tags.join(', ')}.` };
    }
    case 'adjust_score': {
      const delta = Math.trunc(Number(c.delta) || 0);
      const updated = await adjustPoints(contact!.id, delta);
      return { status: 'ok', detail: `${delta > 0 ? '+' : ''}${delta} points: score is now ${updated.points}.` };
    }
    case 'create_deal': {
      const key = `${enrolment.id}:${ctx.seq}`;
      const existing = await db.query<{ id: string; name: string }>(`SELECT id, name FROM deals WHERE custom->>'flowStep' = $1`, [key]);
      if (existing.rows[0]) return { status: 'ok', detail: `Deal “${existing.rows[0].name}” already created.` };
      const amount = Number(c.amount);
      const deal = await createDeal({
        name: render(c.name, contact) || `Deal from ${flow.name}`, amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
        pipelineId: c.pipelineId ? String(c.pipelineId) : undefined, stageId: c.stageId ? String(c.stageId) : undefined,
        ownerId: c.ownerId ? String(c.ownerId) : await ownerFor(ctx), contactId: contact?.id ?? null, campaignId: flow.campaign_id,
        source, custom: { flowStep: key, flowId: flow.id },
      });
      return { status: 'ok', detail: `Created deal “${deal.name}”.` };
    }
    case 'move_deal': {
      if (!enrolment.deal_id) return { status: 'skipped', detail: 'Skipped: this enrolment did not start from a deal.' };
      const deal = await moveDeal(enrolment.deal_id, { stageId: String(c.stageId), source });
      return { status: 'ok', detail: `Moved “${deal.name}” to ${String(c.stageName || 'the chosen stage')}.` };
    }
    case 'create_task': case 'notify_owner': {
      const assignee = node.type === 'create_task'
        ? (c.assignee === 'owner' || !c.assignee ? await ownerFor(ctx) : String(c.assignee))
        : (c.userId ? String(c.userId) : await ownerFor(ctx));
      const days = Number(c.dueInDays);
      const task = await createTask({
        title: render(node.type === 'create_task' ? c.title : c.message, contact) || flow.name,
        notes: node.type === 'create_task' ? render(c.notes, contact) : `From the workflow “${flow.name}”.`,
        type: node.type === 'create_task' ? (String(c.type || 'follow_up') as 'follow_up') : 'todo',
        priority: (['low', 'normal', 'high'].includes(String(c.priority)) ? c.priority : 'normal') as 'normal',
        dueAt: node.type === 'create_task' && Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : node.type === 'notify_owner' ? new Date() : null,
        assigneeId: assignee, contactId: contact?.id ?? null, dealId: enrolment.deal_id, source,
      });
      const who = assignee ? (await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [assignee])).rows[0]?.name : null;
      return { status: 'ok', detail: `${node.type === 'notify_owner' ? 'Notified' : 'Task'} “${task.title}”${who ? ` for ${who}` : ' (unassigned: no owner found)'}.` };
    }
    case 'webhook': return sendWebhook(node, ctx);
    case 'exit': return { status: 'ok', detail: 'Left the workflow.', end: 'exited' };
  }
}

function retryable(error: unknown) {
  if (error instanceof StepError) return error.retry;
  if (error instanceof AppError) return error.status >= 500;
  return true;
}

function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500) || 'The step failed.';
}

async function writeLog(client: Sql, enrolmentId: string, seq: number, node: FlowNode, status: StepStatus, detail: string, attempt: number) {
  await client.query(
    `INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail, attempt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [enrolmentId, seq, node.id, node.type, nodeSpec(node.type).label + (node.type === 'start' ? '' : `: ${describeNode(node)}`), status, detail.slice(0, 1000), attempt],
  );
}

async function finish(client: Sql, flow: FlowRow, enrolment: EnrolmentRow, status: 'completed' | 'exited' | 'failed', error = '') {
  await client.query(
    `UPDATE journey_enrolments SET status = $2, error = $3, finished_at = now(), next_run_at = NULL, held_at = NULL, updated_at = now() WHERE id = $1`,
    [enrolment.id, status, error],
  );
  const base = {
    contactId: enrolment.contact_id ? Number(enrolment.contact_id) : null, entityType: 'flow', entityId: flow.id, campaignId: flow.campaign_id,
    source: `flow:${flow.id}`,
  };
  if (status === 'failed') {
    await emitEvent({ ...base, type: 'flow.failed', properties: { enrolmentId: enrolment.id, flowName: flow.name, error }, idempotencyKey: `flow.failed:${enrolment.id}:${enrolment.step_seq}` }, client);
  } else {
    await emitEvent({ ...base, type: 'flow.completed', properties: { enrolmentId: enrolment.id, flowName: flow.name, outcome: status }, idempotencyKey: `flow.completed:${enrolment.id}` }, client);
  }
}

/** The 'journeys.step' job: runs the enrolment's current step once, logs it, and schedules what follows. */
export async function runStep(data: { enrolmentId: string; seq: number }, context: { attempt: number }): Promise<void> {
  const enrolment = (await db.query<EnrolmentRow>('SELECT * FROM journey_enrolments WHERE id = $1', [data.enrolmentId])).rows[0];
  if (!enrolment || enrolment.step_seq !== data.seq || (enrolment.status !== 'active' && enrolment.status !== 'waiting')) return;
  const flow = (await db.query<FlowRow>('SELECT * FROM journey_flows WHERE id = $1', [enrolment.flow_id])).rows[0];
  if (!flow) return;
  if (flow.status === 'paused') {
    // Held: resuming the flow reschedules this step.
    await db.query('UPDATE journey_enrolments SET held_at = coalesce(held_at, now()), updated_at = now() WHERE id = $1', [enrolment.id]);
    return;
  }
  const version = await loadVersion(flow.id, enrolment.version);
  const node = version?.graph.nodes.find(item => item.id === enrolment.current_node);
  if (flow.status === 'archived' || !version || !node || data.seq > MAX_STEPS) {
    const reason = flow.status === 'archived' ? '' : !node ? `Step ${enrolment.current_node} is missing from version ${enrolment.version}.` : `Stopped after ${MAX_STEPS} steps.`;
    await transaction(client => finish(client, flow, enrolment, flow.status === 'archived' ? 'exited' : 'failed', reason));
    return;
  }
  await db.query(`UPDATE journey_step_logs SET status = 'ok' WHERE enrolment_id = $1 AND status = 'waiting'`, [enrolment.id]);
  const contact = enrolment.contact_id ? await getContact(Number(enrolment.contact_id)) : null;
  if (enrolment.contact_id && !contact) {
    await transaction(async client => {
      await writeLog(client, enrolment.id, data.seq, node, 'failed', 'The contact no longer exists.', context.attempt);
      await finish(client, flow, enrolment, 'failed', 'The contact no longer exists.');
    });
    return;
  }
  const event = await loadEvent(enrolment.trigger_event_id);
  const done = await db.query(`SELECT 1 FROM journey_step_logs WHERE enrolment_id = $1 AND seq = $2 AND status IN ('ok', 'skipped', 'waiting') LIMIT 1`, [enrolment.id, data.seq]);
  if (done.rows.length) return;

  let outcome: Outcome;
  try {
    outcome = await execute(node, { flow, enrolment, contact, event, seq: data.seq });
  } catch (error) {
    const message = errorText(error);
    const retry = retryable(error) && context.attempt < MAX_ATTEMPTS;
    if (retry) {
      await writeLog(db, enrolment.id, data.seq, node, 'failed', `${message} Retrying (attempt ${context.attempt} of ${MAX_ATTEMPTS}).`, context.attempt);
      await db.query('UPDATE journey_enrolments SET error = $2, updated_at = now() WHERE id = $1', [enrolment.id, message]);
      throw error;
    }
    await transaction(async client => {
      await writeLog(client, enrolment.id, data.seq, node, 'failed', message, context.attempt);
      await finish(client, flow, enrolment, 'failed', message);
    });
    return;
  }

  await transaction(async client => {
    await writeLog(client, enrolment.id, data.seq, node, outcome.status, outcome.detail, context.attempt);
    if (outcome.end) return finish(client, flow, enrolment, outcome.end);
    const next = nextOf(version.graph, node.id, outcome.handle ?? 'next');
    if (!next) return finish(client, flow, enrolment, 'completed');
    const runAt = outcome.delayUntil && outcome.delayUntil.getTime() > Date.now() ? outcome.delayUntil : new Date();
    const seq = data.seq + 1;
    await client.query(
      `UPDATE journey_enrolments SET step_seq = $2, current_node = $3, status = $4, next_run_at = $5, held_at = NULL, error = '', updated_at = now() WHERE id = $1`,
      [enrolment.id, seq, next, outcome.delayUntil ? 'waiting' : 'active', runAt.toISOString()],
    );
    await schedulePlatformJob(STEP_JOB, `${enrolment.id}:${seq}`, { enrolmentId: enrolment.id, seq }, { runAt, client });
  });
}

/** Retries a failed enrolment from the step that failed. */
export async function retryEnrolment(id: string) {
  const enrolment = (await db.query<EnrolmentRow>('SELECT * FROM journey_enrolments WHERE id = $1', [id])).rows[0];
  if (!enrolment) throw new AppError(404, 'That enrolment was not found.');
  if (enrolment.status !== 'failed') throw new AppError(409, 'Only failed enrolments can be retried.');
  const flow = (await db.query<FlowRow>('SELECT status FROM journey_flows WHERE id = $1', [enrolment.flow_id])).rows[0];
  if (flow?.status === 'archived') throw new AppError(409, 'This workflow is archived.');
  const seq = enrolment.step_seq + 1;
  await transaction(async client => {
    await client.query(
      `UPDATE journey_enrolments SET status = 'active', step_seq = $2, error = '', finished_at = NULL, next_run_at = now(), updated_at = now() WHERE id = $1`,
      [id, seq],
    );
    await schedulePlatformJob(STEP_JOB, `${id}:${seq}`, { enrolmentId: id, seq }, { client });
  });
}

/** Removes a contact from a flow; any scheduled step is ignored when it fires. */
export async function exitEnrolment(id: string, actorName: string) {
  const enrolment = (await db.query<EnrolmentRow>('SELECT * FROM journey_enrolments WHERE id = $1', [id])).rows[0];
  if (!enrolment) throw new AppError(404, 'That enrolment was not found.');
  if (enrolment.status !== 'active' && enrolment.status !== 'waiting') throw new AppError(409, 'This enrolment has already finished.');
  await db.query(`UPDATE journey_enrolments SET status = 'exited', finished_at = now(), next_run_at = NULL, held_at = NULL, updated_at = now() WHERE id = $1`, [id]);
  await db.query(
    `INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail) VALUES ($1, $2, $3, 'exit', 'Removed', 'ok', $4)`,
    [id, enrolment.step_seq, enrolment.current_node ?? 'start', `Removed from the workflow by ${actorName}.`],
  );
}

/** Reschedules steps that were held while the flow was paused. */
export async function resumeHeld(flowId: string) {
  const held = await db.query<{ id: string; step_seq: number }>(
    `UPDATE journey_enrolments SET held_at = NULL, next_run_at = now(), updated_at = now()
     WHERE flow_id = $1 AND held_at IS NOT NULL AND status IN ('active', 'waiting') RETURNING id, step_seq`, [flowId],
  );
  for (const row of held.rows) await schedulePlatformJob(STEP_JOB, `${row.id}:${row.step_seq}`, { enrolmentId: row.id, seq: row.step_seq });
  return held.rows.length;
}

/* ── Dry run ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Walks the flow for one contact without side effects: conditions are evaluated, actions are only described. */
export async function dryRun(graph: FlowGraph, triggers: FlowTrigger[], contactId: number | null): Promise<DryRunResult> {
  const contact = contactId ? await getContact(contactId) : null;
  if (contactId && !contact) throw new AppError(404, 'That contact was not found.');
  const types = triggers.map(trigger => trigger.type);
  const event = contact && types.length ? (await listEvents({ contactId: contact.id, types, limit: 1 }))[0] ?? null : null;
  const steps: DryRunStep[] = [];
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const start = graph.nodes.find(node => node.type === 'start');
  const visits = new Map<string, number>();
  let current = start ? nextOf(graph, start.id) : null;
  const push = (node: FlowNode, outcome: DryRunStep['outcome'], detail: string) => steps.push({ nodeId: node.id, nodeType: node.type, action: `${nodeSpec(node.type).label}: ${describeNode(node)}`, outcome, detail });
  while (current && steps.length < 60) {
    const node = nodes.get(current);
    if (!node) break;
    visits.set(node.id, (visits.get(node.id) ?? 0) + 1);
    if ((visits.get(node.id) ?? 0) > 1) {
      steps.push({ nodeId: node.id, nodeType: node.type, action: 'Loop', outcome: 'end', detail: `Loops back to “${nodeSpec(node.type).label}” after a wait; the test stops here.` });
      break;
    }
    let handle: FlowHandle = 'next';
    const c = node.config ?? {};
    if (nodeSpec(node.type).needsContact && !contact) push(node, 'would_skip', 'Would be skipped: no contact.');
    else switch (node.type) {
      case 'wait': push(node, 'would_wait', c.mode === 'until' ? `Would wait ${describeNode(node).toLowerCase()}.` : `Would ${describeNode(node).toLowerCase()}.`); break;
      case 'condition': {
        const result = await evaluateCondition(c, { contact, event, dealId: event?.dealId ?? null });
        handle = result.yes ? 'yes' : 'no';
        push(node, 'branch', result.detail);
        break;
      }
      case 'split': {
        const a = clampPercent(c.percentA);
        handle = a >= 50 ? 'a' : 'b';
        push(node, 'branch', `About ${a}% take path A and ${100 - a}% path B; this test follows ${handle.toUpperCase()}.`);
        break;
      }
      case 'send_email': {
        const design = (await db.query<{ name: string; subject: string; html: string }>(`SELECT name, subject, html FROM designs WHERE id::text = $1 AND kind = 'email'`, [String(c.designId ?? '')])).rows[0];
        if (!design) { push(node, 'would_skip', 'The email design was not found: this step would fail.'); break; }
        if (!design.html.trim()) { push(node, 'would_skip', `“${design.name}” has not been saved with content: this step would fail.`); break; }
        const permission = await canEmail(contact!.email);
        push(node, permission.allowed ? 'would_run' : 'would_skip', permission.allowed
          ? `Would send “${design.subject || design.name}” to ${contact!.email}.`
          : `Would not be sent: ${permission.reason ?? 'this address may not be emailed.'}`);
        break;
      }
      case 'add_tag': {
        const tags = tagsOf(c.tags);
        const has = tags.filter(tag => contact!.tags.some(item => item.toLowerCase() === tag.toLowerCase()));
        push(node, 'would_run', `Would add ${tags.join(', ')}${has.length ? ` (already has ${has.join(', ')})` : ''}.`);
        break;
      }
      case 'remove_tag': push(node, 'would_run', `Would remove ${tagsOf(c.tags).join(', ')}.`); break;
      case 'adjust_score': push(node, 'would_run', `Would change the score from ${contact!.points} to ${contact!.points + Math.trunc(Number(c.delta) || 0)}.`); break;
      case 'create_deal': push(node, 'would_run', `Would create deal “${render(c.name, contact)}”.`); break;
      case 'move_deal': push(node, event?.dealId ? 'would_run' : 'would_skip', event?.dealId ? `Would move the triggering deal to ${String(c.stageName || 'the chosen stage')}.` : 'Would be skipped: no triggering deal.'); break;
      case 'create_task': push(node, 'would_run', `Would create task “${render(c.title, contact)}”.`); break;
      case 'notify_owner': push(node, 'would_run', `Would notify the owner: “${render(c.message, contact)}”.`); break;
      case 'webhook': push(node, 'would_run', `Would POST signed JSON to ${describeNode(node).replace(/^POST /, '')}.`); break;
      case 'exit': push(node, 'end', 'Would leave the workflow here.'); current = null; continue;
      default: break;
    }
    current = nextOf(graph, node.id, handle);
    if (!current) steps.push({ nodeId: node.id, nodeType: node.type, action: 'Complete', outcome: 'end', detail: 'Would complete the workflow.' });
  }
  if (!start || !nextOf(graph, start.id)) steps.push({ nodeId: start?.id ?? 'start', nodeType: 'start', action: 'Complete', outcome: 'end', detail: 'No steps after the start yet.' });
  return {
    contact: contact ? { id: contact.id, name: contact.name, email: contact.email } : null,
    steps,
    note: `Test only: nothing was sent, tagged or created.${event ? ` Form answers and deal checks use the contact's latest “${describeTrigger({ id: 'x', type: event.type as FlowTrigger['type'], filters: {} })}” event.` : ''}`,
  };
}

export const conditionCheckLabels = Object.fromEntries(conditionChecks.map(check => [check.value, check.label]));
