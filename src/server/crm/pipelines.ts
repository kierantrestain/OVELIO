// Sales pipelines and their stages (Sales › Pipelines). Deals move between stages with records.moveDeal, so a
// stage removed with a target keeps every deal's history.
import { z } from 'zod';
import type { Pipeline } from '@/contracts/crm';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { audit } from '../events';
import { readBody, json } from '../http';
import { moveDeal } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { currency, loadPipeline, loadPipelines, uuid } from './shared';

const stageName = z.string().trim().min(1).max(60);
const probability = z.number().int().min(0).max(100);
const outcome = z.enum(['open', 'won', 'lost']);
const rottingDays = z.number().int().min(1).max(365).nullable();

const defaultStages = [
  { name: 'Lead in', probability: 10, outcome: 'open' }, { name: 'Qualified', probability: 25, outcome: 'open' },
  { name: 'Proposal', probability: 50, outcome: 'open' }, { name: 'Negotiation', probability: 75, outcome: 'open' },
  { name: 'Won', probability: 100, outcome: 'won' }, { name: 'Lost', probability: 0, outcome: 'lost' },
] as const;

const pipelineInput = z.object({
  name: z.string().trim().min(1).max(80),
  currency: currency.default('GBP'),
  stages: z.array(z.object({ name: stageName, probability, outcome })).min(1).max(30).optional(),
});

/** Open stages first in their order, then the won stage, then the lost stage. */
async function renumber(client: Sql, pipelineId: string, order?: string[]) {
  const stages = await client.query<{ id: string; outcome: string; position: number }>(
    'SELECT id, outcome, position FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position, created_at', [pipelineId],
  );
  const rank = (outcome: string) => outcome === 'open' ? 0 : outcome === 'won' ? 1 : 2;
  const ids = order ?? stages.rows.map(row => row.id);
  const sorted = [...stages.rows].sort((a, b) => rank(a.outcome) - rank(b.outcome) || ids.indexOf(a.id) - ids.indexOf(b.id));
  for (const [index, stage] of sorted.entries()) {
    if (stage.position !== index) await client.query('UPDATE pipeline_stages SET position = $2 WHERE id = $1', [stage.id, index]);
  }
}

export async function createPipeline(input: z.infer<typeof pipelineInput>, actorId: string | null): Promise<Pipeline> {
  const stages = input.stages ?? [...defaultStages];
  if (!stages.some(stage => stage.outcome === 'open')) throw new AppError(400, 'Add at least one open stage.');
  if (stages.filter(stage => stage.outcome === 'won').length > 1 || stages.filter(stage => stage.outcome === 'lost').length > 1) {
    throw new AppError(400, 'A pipeline has at most one Won and one Lost stage.');
  }
  const id = await transaction(async client => {
    const position = await client.query<{ next: number }>('SELECT coalesce(max(position), -1) + 1 AS next FROM pipelines');
    const hasDefault = await client.query('SELECT 1 FROM pipelines WHERE is_default AND archived_at IS NULL');
    const created = await client.query<{ id: string }>(
      'INSERT INTO pipelines (name, currency, position, is_default) VALUES ($1, $2, $3, $4) RETURNING id',
      [input.name, input.currency, Number(position.rows[0].next), !hasDefault.rows[0]],
    );
    const pipelineId = created.rows[0].id;
    for (const [index, stage] of stages.entries()) {
      await client.query('INSERT INTO pipeline_stages (pipeline_id, name, position, probability, outcome) VALUES ($1, $2, $3, $4, $5)',
        [pipelineId, stage.name, index, stage.probability, stage.outcome]);
    }
    await renumber(client, pipelineId);
    await audit(actorId, 'create', 'pipeline', pipelineId, input.name, client);
    return pipelineId;
  });
  return loadPipeline(id);
}

async function stageRow(id: string) {
  const result = await db.query<{ id: string; pipeline_id: string; name: string; outcome: string; deals: string }>(
    `SELECT s.id, s.pipeline_id, s.name, s.outcome, (SELECT count(*) FROM deals d WHERE d.stage_id = s.id) AS deals
     FROM pipeline_stages s WHERE s.id = $1`, [id],
  );
  if (!result.rows[0]) throw new AppError(404, 'That stage was not found.');
  return { ...result.rows[0], deals: Number(result.rows[0].deals) };
}

export async function deleteStage(id: string, targetStageId: string | undefined, actorId: string | null) {
  const stage = await stageRow(id);
  const pipeline = await loadPipeline(stage.pipeline_id);
  if (stage.outcome === 'open' && pipeline.stages.filter(item => item.outcome === 'open').length <= 1) {
    throw new AppError(409, 'A pipeline needs at least one open stage.');
  }
  if (stage.deals > 0) {
    if (!targetStageId) throw new AppError(409, `This stage holds ${stage.deals} deal${stage.deals === 1 ? '' : 's'}. Choose a stage to move them to first.`);
    if (targetStageId === id) throw new AppError(400, 'Choose a different stage for its deals.');
    const target = await stageRow(targetStageId);
    if (target.pipeline_id !== stage.pipeline_id) throw new AppError(400, 'Move the deals to a stage in the same pipeline.');
    const deals = await db.query<{ id: string }>('SELECT id FROM deals WHERE stage_id = $1 ORDER BY board_position', [id]);
    for (const deal of deals.rows) await moveDeal(deal.id, { stageId: targetStageId, actorId });
  }
  await transaction(async client => {
    await client.query('DELETE FROM pipeline_stages WHERE id = $1', [id]);
    await renumber(client, stage.pipeline_id);
    await audit(actorId, 'delete', 'pipeline_stage', id, stage.name, client);
  });
  return loadPipeline(stage.pipeline_id);
}

export const pipelineEndpoints: Entry[] = [
  // Cross-lane contract (TRACKER §3): every lane may read pipelines and stages.
  route('GET', /^sales\/pipelines$/, async ({ query }) => ({ items: await loadPipelines({ includeArchived: query.get('archived') === 'true' }) })),
  route('POST', /^sales\/pipelines$/, async ({ request, user }) => json(await createPipeline(await readBody(request, pipelineInput), user.id), 201), 'marketer'),
  route('PATCH', /^sales\/pipelines\/([0-9a-f-]{36})$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const input = await readBody(request, z.object({ name: z.string().trim().min(1).max(80).optional(), currency: currency.optional(), isDefault: z.literal(true).optional() }));
    const current = await loadPipeline(id);
    if (input.isDefault && current.archived) throw new AppError(409, 'Restore the pipeline before making it the default.');
    await transaction(async client => {
      if (input.isDefault) {
        await client.query('UPDATE pipelines SET is_default = false WHERE is_default AND id <> $1', [id]);
        await client.query('UPDATE pipelines SET is_default = true, updated_at = now() WHERE id = $1', [id]);
      }
      await client.query('UPDATE pipelines SET name = coalesce($2, name), currency = coalesce($3, currency), updated_at = now() WHERE id = $1',
        [id, input.name ?? null, input.currency ?? null]);
      await audit(user.id, 'update', 'pipeline', id, input.name ?? current.name, client);
    });
    return loadPipeline(id);
  }, 'marketer'),
  route('POST', /^sales\/pipelines\/([0-9a-f-]{36})\/archive$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const { archived } = await readBody(request, z.object({ archived: z.boolean() }));
    const current = await loadPipeline(id);
    if (archived && current.isDefault) throw new AppError(409, 'Make another pipeline the default before archiving this one.');
    await db.query(`UPDATE pipelines SET archived_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1`, [id, archived]);
    await audit(user.id, archived ? 'archive' : 'restore', 'pipeline', id, current.name);
    return loadPipeline(id);
  }, 'marketer'),
  route('POST', /^sales\/pipelines\/([0-9a-f-]{36})\/stages$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const input = await readBody(request, z.object({ name: stageName, probability: probability.default(10), outcome: outcome.default('open'), rottingDays: rottingDays.optional() }));
    const pipeline = await loadPipeline(id);
    if (input.outcome !== 'open' && pipeline.stages.some(stage => stage.outcome === input.outcome)) {
      throw new AppError(409, `This pipeline already has a ${input.outcome === 'won' ? 'Won' : 'Lost'} stage.`);
    }
    await transaction(async client => {
      await client.query('INSERT INTO pipeline_stages (pipeline_id, name, position, probability, outcome, rotting_days) VALUES ($1, $2, 1000, $3, $4, $5)',
        [id, input.name, input.probability, input.outcome, input.rottingDays ?? null]);
      await renumber(client, id);
      await audit(user.id, 'create', 'pipeline_stage', id, input.name, client);
    });
    return json(await loadPipeline(id), 201);
  }, 'marketer'),
  route('POST', /^sales\/pipelines\/([0-9a-f-]{36})\/stages\/order$/, async ({ request, params }) => {
    const id = uuid.parse(params[0]);
    const { ids } = await readBody(request, z.object({ ids: z.array(uuid).min(1).max(60) }));
    const pipeline = await loadPipeline(id);
    if (ids.some(stageId => !pipeline.stages.some(stage => stage.id === stageId))) throw new AppError(400, 'Reorder stages of this pipeline only.');
    await transaction(client => renumber(client, id, ids));
    return loadPipeline(id);
  }, 'marketer'),
  route('PATCH', /^sales\/stages\/([0-9a-f-]{36})$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const input = await readBody(request, z.object({ name: stageName.optional(), probability: probability.optional(), outcome: outcome.optional(), rottingDays: rottingDays.optional() }));
    const stage = await stageRow(id);
    if (input.outcome && input.outcome !== stage.outcome) {
      if (stage.deals > 0) throw new AppError(409, 'Move this stage’s deals to another stage before changing whether it means won, lost or open.');
      const pipeline = await loadPipeline(stage.pipeline_id);
      if (input.outcome !== 'open' && pipeline.stages.some(item => item.outcome === input.outcome)) {
        throw new AppError(409, `This pipeline already has a ${input.outcome === 'won' ? 'Won' : 'Lost'} stage.`);
      }
      if (stage.outcome === 'open' && pipeline.stages.filter(item => item.outcome === 'open').length <= 1) {
        throw new AppError(409, 'A pipeline needs at least one open stage.');
      }
    }
    await transaction(async client => {
      await client.query(
        `UPDATE pipeline_stages SET name = coalesce($2, name), probability = coalesce($3, probability), outcome = coalesce($4, outcome),
           rotting_days = CASE WHEN $5 THEN $6 ELSE rotting_days END WHERE id = $1`,
        [id, input.name ?? null, input.probability ?? null, input.outcome ?? null, input.rottingDays !== undefined, input.rottingDays ?? null],
      );
      if (input.outcome) await renumber(client, stage.pipeline_id);
      await audit(user.id, 'update', 'pipeline_stage', id, input.name ?? stage.name, client);
    });
    return loadPipeline(stage.pipeline_id);
  }, 'marketer'),
  route('DELETE', /^sales\/stages\/([0-9a-f-]{36})$/, async ({ params, query, user }) => {
    const target = query.get('targetStageId');
    return deleteStage(uuid.parse(params[0]), target ? uuid.parse(target) : undefined, user.id);
  }, 'marketer'),
];
