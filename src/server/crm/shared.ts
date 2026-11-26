// Row mappers and small helpers shared by the CRM & Sales endpoints.
import Papa from 'papaparse';
import { z } from 'zod';
import type { Activity, CrmTask, Deal, MessageSummary, Pipeline, PipelineStage, StageChange, TeamMember } from '@/contracts/crm';
import { effectiveProbability, sourceLabel } from '@/contracts/crm';
import { AppError } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { mailboxRecordVisible } from '../mailbox-access';

export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
export const currency = z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code.').transform(value => value.toUpperCase());

const iso = (value: Date | string | null | undefined) => value == null ? null : new Date(value).toISOString();
const num = (value: unknown) => value == null ? 0 : Number(value);

/* ── Team ─────────────────────────────────────────────────────────────── */

export async function team(client: Sql = db): Promise<Map<string, TeamMember>> {
  const result = await client.query<TeamMember>('SELECT id, name, email FROM users WHERE disabled_at IS NULL ORDER BY name');
  return new Map(result.rows.map(row => [row.id, row]));
}

export async function assertUser(id: string | null | undefined, client: Sql = db) {
  if (!id) return;
  const found = await client.query('SELECT 1 FROM users WHERE id = $1 AND disabled_at IS NULL', [id]);
  if (!found.rows[0]) throw new AppError(400, 'Choose an active team member.');
}

/* ── Pipelines ────────────────────────────────────────────────────────── */

type PipelineRow = { id: string; name: string; currency: string; is_default: boolean; archived_at: Date | null; open_deals?: string };
type StageRow = { id: string; pipeline_id: string; name: string; position: number; probability: number; outcome: PipelineStage['outcome']; rotting_days: number | null; required_fields?: string[] | string };

export const toStage = (row: StageRow): PipelineStage => ({
  id: row.id, name: row.name, position: row.position, probability: row.probability, outcome: row.outcome, rottingDays: row.rotting_days,
  requiredFields: (Array.isArray(row.required_fields) ? row.required_fields : String(row.required_fields ?? '').replace(/[{}]/g, '').split(',').filter(Boolean)) as PipelineStage['requiredFields'],
});

export async function loadPipelines(options: { includeArchived?: boolean; ids?: string[] } = {}, client: Sql = db): Promise<Pipeline[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (!options.includeArchived) where.push('p.archived_at IS NULL');
  if (options.ids) {
    values.push(options.ids);
    where.push(`p.id = ANY($${values.length}::uuid[])`);
  }
  const pipelines = await client.query<PipelineRow>(
    `SELECT p.id, p.name, p.currency, p.is_default, p.archived_at,
       (SELECT count(*) FROM deals d WHERE d.pipeline_id = p.id AND d.status = 'open' AND d.archived_at IS NULL) AS open_deals
     FROM pipelines p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.archived_at IS NOT NULL, p.is_default DESC, p.position, p.created_at`, values,
  );
  if (!pipelines.rows.length) return [];
  const stages = await client.query<StageRow>(
    'SELECT id, pipeline_id, name, position, probability, outcome, rotting_days, required_fields FROM pipeline_stages WHERE pipeline_id = ANY($1::uuid[]) ORDER BY position, created_at',
    [pipelines.rows.map(row => row.id)],
  );
  return pipelines.rows.map(row => ({
    id: row.id, name: row.name, currency: row.currency, isDefault: row.is_default, archived: Boolean(row.archived_at),
    openDeals: num(row.open_deals),
    stages: stages.rows.filter(stage => stage.pipeline_id === row.id).map(toStage),
  }));
}

export async function loadPipeline(id: string, client: Sql = db): Promise<Pipeline> {
  const [pipeline] = await loadPipelines({ includeArchived: true, ids: [id] }, client);
  if (!pipeline) throw new AppError(404, 'That pipeline was not found.');
  return pipeline;
}

/* ── Deals ────────────────────────────────────────────────────────────── */

export type DealQueryRow = {
  id: string; pipeline_id: string; pipeline_name: string; stage_id: string; stage_name: string; stage_outcome: PipelineStage['outcome'];
  stage_probability: number; rotting_days: number | null; name: string; amount: string; currency: string; probability: number | null;
  status: Deal['status']; owner_id: string | null; owner_name: string | null; contact_id: string | null; contact_name: string;
  contact_email: string; company_id: string | null; company_name: string; campaign_id: string | null; campaign_name: string | null;
  source: string; expected_close_date: string | null; closed_at: Date | null; lost_reason: string; board_position: number;
  custom: Record<string, unknown>; created_at: Date; updated_at: Date; archived_at: Date | null; stage_entered_at: Date; open_tasks: string;
  last_activity_at: Date | null; next_task_title: string | null; next_task_due: Date | null;
};

export const dealSelect = `SELECT d.id, d.pipeline_id, p.name AS pipeline_name, d.stage_id, s.name AS stage_name, s.outcome AS stage_outcome,
  s.probability AS stage_probability, s.rotting_days, d.name, d.amount, d.currency, d.probability, d.status, d.owner_id, u.name AS owner_name,
  d.contact_id, d.contact_name, d.contact_email, d.company_id, d.company_name, d.campaign_id, mc.name AS campaign_name, d.source,
  d.expected_close_date, d.closed_at, d.lost_reason, d.board_position, d.custom, d.created_at, d.updated_at, d.archived_at,
  coalesce((SELECT max(h.changed_at) FROM deal_stage_history h WHERE h.deal_id = d.id AND h.to_stage_id = d.stage_id), d.created_at) AS stage_entered_at,
  (SELECT count(*) FROM tasks t WHERE t.deal_id = d.id AND t.status = 'open') AS open_tasks,
  (SELECT max(a.occurred_at) FROM activities a
   WHERE a.mailbox_id IS NULL AND (a.deal_id = d.id OR a.contact_id = d.contact_id)) AS last_activity_at,
  (SELECT t.title FROM tasks t WHERE t.deal_id = d.id AND t.status = 'open' ORDER BY t.due_at NULLS LAST, t.created_at LIMIT 1) AS next_task_title,
  (SELECT t.due_at FROM tasks t WHERE t.deal_id = d.id AND t.status = 'open' ORDER BY t.due_at NULLS LAST, t.created_at LIMIT 1) AS next_task_due
  FROM deals d
  JOIN pipelines p ON p.id = d.pipeline_id
  JOIN pipeline_stages s ON s.id = d.stage_id
  LEFT JOIN users u ON u.id = d.owner_id
  LEFT JOIN marketing_campaigns mc ON mc.id = d.campaign_id`;

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Last interaction, next action and health for a deal card. Closed deals are not scored. */
export function dealHealth(row: Pick<DealQueryRow, 'status' | 'rotting_days' | 'expected_close_date' | 'last_activity_at' | 'next_task_title' | 'next_task_due' | 'created_at'>, daysInStage: number, now = Date.now()) {
  const lastActivityAt = iso(row.last_activity_at);
  const nextTask = row.next_task_title ? { title: row.next_task_title, dueAt: iso(row.next_task_due) } : null;
  if (row.status !== 'open') return { lastActivityAt, nextTask, health: 'closed' as const, healthReasons: [] };
  const reasons: string[] = [];
  if (row.rotting_days != null && daysInStage > row.rotting_days) reasons.push(`${daysInStage} days in this stage (limit ${row.rotting_days})`);
  if (row.expected_close_date && row.expected_close_date < new Date(now).toISOString().slice(0, 10)) reasons.push('Expected close date has passed');
  const quietSince = lastActivityAt ? Date.parse(lastActivityAt) : new Date(row.created_at).getTime();
  if (now - quietSince > 14 * 86_400_000) reasons.push(lastActivityAt ? 'No activity for 14 days' : 'No activity logged since it was created');
  return { lastActivityAt, nextTask, health: reasons.length ? 'at_risk' as const : 'healthy' as const, healthReasons: reasons };
}

export function toDeal(row: DealQueryRow, now = Date.now()): Deal {
  const amount = Number(row.amount);
  const probability = effectiveProbability({ status: row.status, probability: row.probability }, row.stage_probability);
  const daysInStage = Math.max(0, Math.floor((now - new Date(row.stage_entered_at).getTime()) / 86_400_000));
  return {
    id: row.id, pipelineId: row.pipeline_id, pipelineName: row.pipeline_name, stageId: row.stage_id, stageName: row.stage_name,
    stageOutcome: row.stage_outcome, name: row.name, amount, currency: row.currency, probability: row.probability,
    effectiveProbability: probability, weightedAmount: Math.round(amount * probability) / 100, status: row.status,
    ownerId: row.owner_id, ownerName: row.owner_name ?? '', contactId: row.contact_id ? Number(row.contact_id) : null,
    contactName: row.contact_name, contactEmail: row.contact_email, companyId: row.company_id ? Number(row.company_id) : null,
    companyName: row.company_name, campaignId: row.campaign_id, campaignName: row.campaign_name ?? '', source: row.source,
    sourceLabel: sourceLabel(row.source), expectedCloseDate: row.expected_close_date, closedAt: iso(row.closed_at),
    lostReason: row.lost_reason, boardPosition: Number(row.board_position), daysInStage,
    overdue: row.status === 'open' && Boolean(row.expected_close_date) && (row.expected_close_date as string) < new Date(now).toISOString().slice(0, 10),
    rotting: row.status === 'open' && row.rotting_days != null && daysInStage > row.rotting_days,
    ...dealHealth(row, daysInStage, now),
    openTasks: num(row.open_tasks), custom: row.custom ?? {}, createdAt: iso(row.created_at) as string, updatedAt: iso(row.updated_at) as string,
    archivedAt: iso(row.archived_at),
  };
}

export async function loadDeal(id: string, client: Sql = db): Promise<Deal> {
  const result = await client.query<DealQueryRow>(`${dealSelect} WHERE d.id = $1`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'That deal was not found.');
  return toDeal(result.rows[0]);
}

/* ── Tasks, activities, messages, history ─────────────────────────────── */

export type TaskQueryRow = {
  id: string; title: string; notes: string; type: CrmTask['type']; status: CrmTask['status']; priority: CrmTask['priority'];
  due_at: Date | null; remind_at: Date | null; reminded_at: Date | null; completed_at: Date | null; assignee_id: string | null;
  assignee_name: string | null; contact_id: string | null; company_id: string | null; deal_id: string | null; deal_name: string | null;
  deal_contact_name: string | null; deal_company_name: string | null; source: string; created_at: Date;
};

export const taskSelect = `SELECT t.id, t.title, t.notes, t.type, t.status, t.priority, t.due_at, t.remind_at, t.reminded_at, t.completed_at,
  t.assignee_id, u.name AS assignee_name, t.contact_id, t.company_id, t.deal_id, d.name AS deal_name, d.contact_name AS deal_contact_name,
  d.company_name AS deal_company_name, t.source, t.created_at
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN deals d ON d.id = t.deal_id`;

export function toTask(row: TaskQueryRow, names: { contacts?: Map<number, string>; companies?: Map<number, string> } = {}, now = Date.now()): CrmTask {
  const contactId = row.contact_id ? Number(row.contact_id) : null;
  const companyId = row.company_id ? Number(row.company_id) : null;
  return {
    id: row.id, title: row.title, notes: row.notes, type: row.type, status: row.status, priority: row.priority,
    dueAt: iso(row.due_at), remindAt: iso(row.remind_at), remindedAt: iso(row.reminded_at), completedAt: iso(row.completed_at),
    assigneeId: row.assignee_id, assigneeName: row.assignee_name ?? '',
    contactId, contactName: (contactId && names.contacts?.get(contactId)) || (row.deal_contact_name ?? ''),
    companyId, companyName: (companyId && names.companies?.get(companyId)) || (row.deal_company_name ?? ''),
    dealId: row.deal_id, dealName: row.deal_name ?? '', source: row.source,
    overdue: row.status === 'open' && row.due_at != null && new Date(row.due_at).getTime() < now,
    createdAt: iso(row.created_at) as string,
  };
}

export type ActivityQueryRow = {
  id: string; type: Activity['type']; subject: string; body: string; direction: Activity['direction']; outcome: string;
  duration_minutes: number | null; occurred_at: Date; contact_id: string | null; company_id: string | null; deal_id: string | null;
  deal_name: string | null; author_id: string | null; author_name: string | null; message_id: string | null;
};

export const activitySelect = `SELECT a.id, a.type, a.subject, a.body, a.direction, a.outcome, a.duration_minutes, a.occurred_at, a.contact_id,
  a.company_id, a.deal_id, d.name AS deal_name, a.author_id, u.name AS author_name, a.message_id
  FROM activities a LEFT JOIN users u ON u.id = a.author_id LEFT JOIN deals d ON d.id = a.deal_id`;

export const toActivity = (row: ActivityQueryRow): Activity => ({
  id: row.id, type: row.type, subject: row.subject, body: row.body, direction: row.direction, outcome: row.outcome,
  durationMinutes: row.duration_minutes, occurredAt: iso(row.occurred_at) as string,
  contactId: row.contact_id ? Number(row.contact_id) : null, companyId: row.company_id ? Number(row.company_id) : null,
  dealId: row.deal_id, dealName: row.deal_name ?? '', authorId: row.author_id, authorName: row.author_name ?? '', messageId: row.message_id,
});

type MessageRow = { id: string; subject: string; to_email: string; from_email: string; status: MessageSummary['status']; status_reason: string; category: string; source: string; created_at: Date };

export async function loadMessages(filter: { contactIds: number[]; limit?: number }, viewerId: string): Promise<MessageSummary[]> {
  if (!filter.contactIds.length) return [];
  const result = await db.query<MessageRow>(
    `SELECT id, subject, to_email, from_email, status, status_reason, category, source, created_at FROM messages
     WHERE contact_id = ANY($1::bigint[]) AND ${mailboxRecordVisible('messages.mailbox_id', '$3')}
     ORDER BY created_at DESC LIMIT $2`,
    [filter.contactIds, filter.limit ?? 50, viewerId],
  );
  return result.rows.map(row => ({
    id: row.id, subject: row.subject, toEmail: row.to_email, fromEmail: row.from_email, status: row.status, statusReason: row.status_reason,
    category: row.category, source: row.source, createdAt: iso(row.created_at) as string,
  }));
}

type HistoryRow = { id: string; from_stage_id: string | null; from_name: string | null; to_stage_id: string; to_name: string | null; changed_by: string | null; changed_by_name: string | null; changed_at: Date };

export async function loadHistory(dealId: string): Promise<StageChange[]> {
  const result = await db.query<HistoryRow>(
    `SELECT h.id, h.from_stage_id, f.name AS from_name, h.to_stage_id, t.name AS to_name, h.changed_by, u.name AS changed_by_name, h.changed_at
     FROM deal_stage_history h LEFT JOIN pipeline_stages f ON f.id = h.from_stage_id LEFT JOIN pipeline_stages t ON t.id = h.to_stage_id
     LEFT JOIN users u ON u.id = h.changed_by WHERE h.deal_id = $1 ORDER BY h.changed_at DESC, h.id DESC`, [dealId],
  );
  return result.rows.map(row => ({
    id: String(row.id), fromStageId: row.from_stage_id, fromStageName: row.from_name ?? '', toStageId: row.to_stage_id,
    toStageName: row.to_name ?? 'Removed stage', changedById: row.changed_by, changedByName: row.changed_by_name ?? '',
    changedAt: iso(row.changed_at) as string,
  }));
}

/* ── CSV ──────────────────────────────────────────────────────────────── */

export function csvResponse(rows: (string | number | null)[][], fields: string[], filename: string) {
  const body = Papa.unparse({ fields, data: rows }, { escapeFormulae: true });
  return new Response(body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  });
}

export function optionalNumber(value: string | null) {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new AppError(400, 'Enter numbers for amount filters.');
  return parsed;
}
