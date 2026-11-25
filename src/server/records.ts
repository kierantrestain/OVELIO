// Shared record operations (lead-owned, docs/rebuild/TRACKER.md §4). Sales screens, automations, forms and sequences
// all create and move deals, tasks and activities through these functions, so the stage history, owner defaults,
// display snapshots and platform events are identical whoever makes the change.
//
// Lane 1 (CRM & Sales) builds its API on these and may extend them in its own files; behaviour changes here go in a
// [shared] commit.

import type { PoolClient } from 'pg';
import { AppError } from './config';
import { db, transaction } from './db';
import type { Sql } from './db';
import { getCompanies, getContact } from './directory';
import { audit, emitEvent } from './events';

export type DealRow = {
  id: string; pipeline_id: string; stage_id: string; name: string; amount: string; currency: string; probability: number | null;
  status: 'open' | 'won' | 'lost'; owner_id: string | null; contact_id: string | null; company_id: string | null;
  contact_name: string; contact_email: string; company_name: string; campaign_id: string | null; source: string;
  expected_close_date: string | null; closed_at: Date | null; lost_reason: string; board_position: number;
  custom: Record<string, unknown>; created_by: string | null; created_at: Date; updated_at: Date; archived_at: Date | null;
};

type StageRow = { id: string; pipeline_id: string; name: string; position: number; probability: number; outcome: 'open' | 'won' | 'lost' };

export async function defaultPipelineId(client: Sql = db): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, position, created_at LIMIT 1`,
  );
  if (!result.rows[0]) throw new AppError(409, 'Create a sales pipeline first.');
  return result.rows[0].id;
}

async function stage(client: Sql, stageId: string): Promise<StageRow> {
  const result = await client.query<StageRow>('SELECT id, pipeline_id, name, position, probability, outcome FROM pipeline_stages WHERE id = $1', [stageId]);
  if (!result.rows[0]) throw new AppError(404, 'That pipeline stage was not found.');
  return result.rows[0];
}

async function firstOpenStage(client: Sql, pipelineId: string): Promise<StageRow> {
  const result = await client.query<StageRow>(
    `SELECT id, pipeline_id, name, position, probability, outcome FROM pipeline_stages
     WHERE pipeline_id = $1 ORDER BY (outcome <> 'open'), position LIMIT 1`, [pipelineId],
  );
  if (!result.rows[0]) throw new AppError(409, 'That pipeline has no stages.');
  return result.rows[0];
}

/** Resolves a campaign from linked assets first, then from a UTM campaign slug. */
export async function resolveCampaignId(input: { assets?: { type: string; id: string }[]; utmCampaign?: string | null }, client: Sql = db): Promise<string | null> {
  for (const asset of input.assets ?? []) {
    const linked = await client.query<{ campaign_id: string }>(
      `SELECT ca.campaign_id FROM campaign_assets ca JOIN marketing_campaigns c ON c.id = ca.campaign_id
       WHERE ca.asset_type = $1 AND ca.asset_id = $2 AND c.status <> 'archived' ORDER BY ca.added_at DESC LIMIT 1`,
      [asset.type, asset.id],
    );
    if (linked.rows[0]) return linked.rows[0].campaign_id;
  }
  const slug = input.utmCampaign?.trim().toLowerCase();
  if (slug) {
    const bySlug = await client.query<{ id: string }>('SELECT id FROM marketing_campaigns WHERE utm_campaign = $1', [slug]);
    if (bySlug.rows[0]) return bySlug.rows[0].id;
  }
  return null;
}

export type CreateDealInput = {
  name: string;
  amount?: number;
  currency?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string | null;
  contactId?: number | null;
  companyId?: number | null;
  campaignId?: string | null;
  source?: string;
  expectedCloseDate?: string | null;
  probability?: number | null;
  custom?: Record<string, unknown>;
  actorId?: string | null;
};

export async function createDeal(input: CreateDealInput): Promise<DealRow> {
  if (!input.name.trim()) throw new AppError(400, 'Name the deal.');
  if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0)) throw new AppError(400, 'Enter a deal value of zero or more.');
  const [contact, companies] = await Promise.all([
    input.contactId ? getContact(input.contactId) : null,
    input.companyId ? getCompanies([input.companyId]) : null,
  ]);
  if (input.contactId && !contact) throw new AppError(404, 'That contact was not found.');
  const company = input.companyId ? companies?.get(input.companyId) : undefined;
  return transaction(async client => {
    const pipelineId = input.pipelineId ?? (input.stageId ? (await stage(client, input.stageId)).pipeline_id : await defaultPipelineId(client));
    const target = input.stageId ? await stage(client, input.stageId) : await firstOpenStage(client, pipelineId);
    if (target.pipeline_id !== pipelineId) throw new AppError(400, 'That stage belongs to another pipeline.');
    const pipeline = await client.query<{ currency: string }>('SELECT currency FROM pipelines WHERE id = $1', [pipelineId]);
    const position = await client.query<{ next: number }>(
      'SELECT coalesce(min(board_position), 0) - 1 AS next FROM deals WHERE stage_id = $1 AND archived_at IS NULL', [target.id],
    );
    const status = target.outcome;
    const result = await client.query<DealRow>(
      `INSERT INTO deals (pipeline_id, stage_id, name, amount, currency, probability, status, owner_id, contact_id, company_id,
         contact_name, contact_email, company_name, campaign_id, source, expected_close_date, closed_at, board_position, custom, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CASE WHEN $7 <> 'open' THEN now() END, $17, $18, $19)
       RETURNING *`,
      [pipelineId, target.id, input.name.trim(), input.amount ?? 0, input.currency || pipeline.rows[0]?.currency || 'GBP',
        input.probability ?? null, status, input.ownerId ?? input.actorId ?? null, input.contactId ?? null, input.companyId ?? null,
        contact?.name ?? '', contact?.email ?? '', company?.name ?? contact?.company ?? '', input.campaignId ?? null,
        input.source ?? '', input.expectedCloseDate ?? null, Number(position.rows[0].next), JSON.stringify(input.custom ?? {}), input.actorId ?? null],
    );
    const deal = result.rows[0];
    await client.query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by) VALUES ($1, NULL, $2, $3)',
      [deal.id, target.id, input.actorId ?? null]);
    await emitEvent({
      type: 'deal.created', dealId: deal.id, contactId: input.contactId ?? null, companyId: input.companyId ?? null,
      campaignId: deal.campaign_id, amount: null, currency: deal.currency, actorId: input.actorId ?? null, source: input.source || 'ovelio',
      properties: { name: deal.name, pipelineId, stageId: target.id, stageName: target.name, value: Number(deal.amount) },
    }, client);
    await audit(input.actorId, 'create', 'deal', deal.id, deal.name, client);
    return deal;
  });
}

/**
 * Moves a deal to a stage (any pipeline) and an optional board position. Entering a won or lost stage closes the
 * deal and emits deal.won (with the measured amount) or deal.lost; leaving one re-opens it.
 */
export async function moveDeal(dealId: string, input: { stageId: string; boardPosition?: number; lostReason?: string; actorId?: string | null; source?: string }): Promise<DealRow> {
  return transaction(async (client: PoolClient) => {
    const current = (await client.query<DealRow>('SELECT * FROM deals WHERE id = $1 FOR UPDATE', [dealId])).rows[0];
    if (!current) throw new AppError(404, 'That deal was not found.');
    const target = await stage(client, input.stageId);
    const position = input.boardPosition ?? Number((await client.query<{ next: number }>(
      'SELECT coalesce(min(board_position), 0) - 1 AS next FROM deals WHERE stage_id = $1 AND archived_at IS NULL', [target.id],
    )).rows[0].next);
    const status = target.outcome;
    const updated = (await client.query<DealRow>(
      `UPDATE deals SET stage_id = $2, pipeline_id = $3, board_position = $4, status = $5,
         closed_at = CASE WHEN $5 = 'open' THEN NULL WHEN status = $5 THEN closed_at ELSE now() END,
         lost_reason = CASE WHEN $5 = 'lost' THEN coalesce($6, lost_reason) ELSE '' END, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [dealId, target.id, target.pipeline_id, position, status, input.lostReason ?? null],
    )).rows[0];
    if (current.stage_id !== target.id) {
      await client.query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by) VALUES ($1, $2, $3, $4)',
        [dealId, current.stage_id, target.id, input.actorId ?? null]);
      const base = {
        dealId, contactId: updated.contact_id ? Number(updated.contact_id) : null, companyId: updated.company_id ? Number(updated.company_id) : null,
        campaignId: updated.campaign_id, actorId: input.actorId ?? null, currency: updated.currency, source: input.source || 'ovelio',
      };
      await emitEvent({ ...base, type: 'deal.stage_changed', properties: { fromStageId: current.stage_id, toStageId: target.id, stageName: target.name, pipelineId: target.pipeline_id } }, client);
      if (status === 'won' && current.status !== 'won') {
        await emitEvent({ ...base, type: 'deal.won', amount: Number(updated.amount), properties: { name: updated.name } }, client);
      }
      if (status === 'lost' && current.status !== 'lost') {
        await emitEvent({ ...base, type: 'deal.lost', properties: { name: updated.name, reason: updated.lost_reason } }, client);
      }
    }
    return updated;
  });
}

export type TaskRow = {
  id: string; title: string; notes: string; type: string; status: 'open' | 'done' | 'cancelled'; priority: string;
  due_at: Date | null; remind_at: Date | null; completed_at: Date | null; assignee_id: string | null; created_by: string | null;
  contact_id: string | null; company_id: string | null; deal_id: string | null; source: string; created_at: Date; updated_at: Date;
};

export type CreateTaskInput = {
  title: string; notes?: string; type?: 'todo' | 'call' | 'email' | 'meeting' | 'follow_up'; priority?: 'low' | 'normal' | 'high';
  dueAt?: Date | string | null; remindAt?: Date | string | null; assigneeId?: string | null; contactId?: number | null;
  companyId?: number | null; dealId?: string | null; source?: string; actorId?: string | null;
};

export async function createTask(input: CreateTaskInput, client: Sql = db): Promise<TaskRow> {
  if (!input.title.trim()) throw new AppError(400, 'Give the task a title.');
  const result = await client.query<TaskRow>(
    `INSERT INTO tasks (title, notes, type, priority, due_at, remind_at, assignee_id, created_by, contact_id, company_id, deal_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [input.title.trim().slice(0, 300), input.notes ?? '', input.type ?? 'todo', input.priority ?? 'normal',
      input.dueAt ? new Date(input.dueAt).toISOString() : null, input.remindAt ? new Date(input.remindAt).toISOString() : null,
      input.assigneeId ?? input.actorId ?? null, input.actorId ?? null, input.contactId ?? null, input.companyId ?? null,
      input.dealId ?? null, input.source ?? 'manual'],
  );
  const task = result.rows[0];
  await emitEvent({
    type: 'task.created', contactId: input.contactId ?? null, companyId: input.companyId ?? null, dealId: input.dealId ?? null,
    entityType: 'task', entityId: task.id, actorId: input.actorId ?? null, source: task.source,
    properties: { title: task.title, type: task.type, assigneeId: task.assignee_id, dueAt: task.due_at },
  }, client);
  return task;
}

export async function completeTask(taskId: string, actorId: string | null, client: Sql = db): Promise<TaskRow> {
  const result = await client.query<TaskRow>(
    `UPDATE tasks SET status = 'done', completed_at = coalesce(completed_at, now()), updated_at = now() WHERE id = $1 RETURNING *`, [taskId],
  );
  const task = result.rows[0];
  if (!task) throw new AppError(404, 'That task was not found.');
  await emitEvent({
    type: 'task.completed', contactId: task.contact_id ? Number(task.contact_id) : null, dealId: task.deal_id,
    entityType: 'task', entityId: task.id, actorId, properties: { title: task.title }, idempotencyKey: 'task.completed:' + task.id,
  }, client);
  return task;
}

export type ActivityInput = {
  type: 'note' | 'call' | 'meeting' | 'email' | 'other'; subject?: string; body?: string; direction?: 'inbound' | 'outbound' | null;
  outcome?: string; durationMinutes?: number | null; occurredAt?: Date | string; contactId?: number | null; companyId?: number | null;
  dealId?: string | null; messageId?: string | null; authorId?: string | null;
};

export async function logActivity(input: ActivityInput, client: Sql = db) {
  if (!input.contactId && !input.companyId && !input.dealId) throw new AppError(400, 'Link the activity to a contact, company or deal.');
  const result = await client.query<{ id: string }>(
    `INSERT INTO activities (type, subject, body, direction, outcome, duration_minutes, occurred_at, contact_id, company_id, deal_id, message_id, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8, $9, $10, $11, $12) RETURNING id`,
    [input.type, input.subject ?? '', input.body ?? '', input.direction ?? null, input.outcome ?? '', input.durationMinutes ?? null,
      input.occurredAt ? new Date(input.occurredAt).toISOString() : null, input.contactId ?? null, input.companyId ?? null,
      input.dealId ?? null, input.messageId ?? null, input.authorId ?? null],
  );
  await emitEvent({
    type: 'activity.logged', contactId: input.contactId ?? null, companyId: input.companyId ?? null, dealId: input.dealId ?? null,
    entityType: 'activity', entityId: result.rows[0].id, actorId: input.authorId ?? null, properties: { type: input.type, subject: input.subject ?? '' },
  }, client);
  return result.rows[0].id;
}
