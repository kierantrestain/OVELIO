// Console endpoints for lane 4 under /api/console/journeys/ (docs/rebuild/TRACKER.md §3).
import { z } from 'zod';
import { enrolmentStatuses, flowNodeTypes, flowStatuses, flowTemplates, flowTriggerTypes } from '@/contracts/journeys';
import { db } from '../db';
import { json } from '../http';
import { searchContacts } from '../directory';
import { route } from '../routes/shared';
import type { Context, Entry } from '../routes/shared';
import { dryRun, exitEnrolment, retryEnrolment } from './engine';
import {
  createFlow, deleteFlow, duplicateFlow, enrolContacts, getEnrolment, getFlow, getVersion, listEnrolments, listFlows, publishFlow,
  restoreVersion, rollbackFlow, setFlowStatus, updateFlow,
} from './flows';
import { campaignEndpoints } from './campaign-routes';
import { flowExperiments } from './experiments';
import { hookEndpoints } from './hooks';

const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
export const pattern = (path: string) => new RegExp('^journeys/' + path.replaceAll(':id', uuid) + '$');

export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  return schema.parse(await request.json().catch(() => ({})));
}

const text = (max: number) => z.string().trim().max(max);
const handle = z.enum(['next', 'yes', 'no', 'a', 'b']);
const graph = z.object({
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(60),
    type: z.enum(flowNodeTypes),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    config: z.record(z.string(), z.unknown()).default({}),
  })).max(120),
  edges: z.array(z.object({ id: z.string().trim().min(1).max(160), source: z.string().max(60), target: z.string().max(60), sourceHandle: handle })).max(400),
});
const trigger = z.object({
  id: z.string().trim().min(1).max(60),
  type: z.enum(flowTriggerTypes),
  filters: z.record(z.string(), z.string().max(200)).default({}),
});
const flowInput = z.object({
  name: text(120).min(1).optional(),
  description: text(1000).optional(),
  campaignId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  triggers: z.array(trigger).max(10).optional(),
  reentry: z.enum(['once', 'every_time']).optional(),
  graph: graph.optional(),
});

const flowId = (context: Context) => context.params[0];

export const journeyEndpoints: Entry[] = [
  route('GET', pattern('flows'), async ({ query }) => ({
    items: await listFlows({
      status: z.enum(flowStatuses).optional().parse(query.get('status') || undefined),
      campaignId: z.uuid().optional().parse(query.get('campaignId') || undefined),
      q: query.get('q') ?? undefined,
    }),
  })),
  route('POST', pattern('flows'), async ({ request, user }) => {
    const input = await body(request, flowInput.extend({ templateKey: z.string().max(60).optional() }));
    return json(await createFlow(input, user.id), 201);
  }, 'marketer'),
  route('GET', pattern('flows/:id'), async context => getFlow(flowId(context))),
  route('GET', pattern('flows/:id/experiments'), async context => flowExperiments(flowId(context))),
  route('PATCH', pattern('flows/:id'), async context => updateFlow(flowId(context), await body(context.request, flowInput), context.user.id), 'marketer'),
  route('DELETE', pattern('flows/:id'), async context => {
    await deleteFlow(flowId(context), context.user.id);
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', pattern('flows/:id/publish'), async context => publishFlow(flowId(context), context.user.id), 'marketer'),
  route('POST', pattern('flows/:id/(pause|resume|archive|restore)'), async context =>
    setFlowStatus(context.params[0], context.params[1] as 'pause', context.user.id), 'marketer'),
  route('POST', pattern('flows/:id/duplicate'), async context => json(await duplicateFlow(flowId(context), context.user.id), 201), 'marketer'),
  route('GET', pattern('flows/:id/versions/(\\d+)'), async context => getVersion(context.params[0], Number(context.params[1]))),
  route('POST', pattern('flows/:id/versions/(\\d+)/restore'), async context => restoreVersion(context.params[0], Number(context.params[1]), context.user.id), 'marketer'),
  route('POST', pattern('flows/:id/versions/(\\d+)/rollback'), async ({ request, params, user }) => {
    const version = z.number().int().positive().max(2_147_483_647);
    const { expected } = await body(request, z.object({ expected: version }));
    return rollbackFlow(params[0], { to: version.parse(Number(params[1])), expected }, user.id);
  }, 'marketer'),
  route('POST', pattern('flows/:id/test'), async context => {
    const input = await body(context.request, z.object({ contactId: z.number().int().positive().nullable(), version: z.enum(['draft', 'published']).default('draft') }));
    const flow = await getFlow(flowId(context));
    if (input.version === 'published' && flow.publishedVersion) {
      const published = await getVersion(flow.id, flow.publishedVersion);
      return dryRun(published.graph, published.triggers, input.contactId);
    }
    return dryRun(flow.graph, flow.triggers, input.contactId);
  }, 'marketer'),
  route('POST', pattern('flows/:id/enrol'), async context => {
    const input = await body(context.request, z.object({ contactIds: z.array(z.number().int().positive()).min(1).max(200) }));
    return enrolContacts(flowId(context), input.contactIds, context.user.id);
  }, 'marketer'),
  route('GET', pattern('enrolments'), async ({ query }) => ({
    items: await listEnrolments({
      flowId: z.uuid().optional().parse(query.get('flowId') || undefined),
      status: z.enum(enrolmentStatuses).optional().parse(query.get('status') || undefined),
      contactId: query.get('contactId') ? z.coerce.number().int().positive().parse(query.get('contactId')) : undefined,
      limit: query.get('limit') ? Number(query.get('limit')) : undefined,
    }),
  })),
  route('GET', pattern('enrolments/:id'), async context => getEnrolment(context.params[0])),
  route('POST', pattern('enrolments/:id/retry'), async context => {
    await retryEnrolment(context.params[0]);
    return getEnrolment(context.params[0]);
  }, 'marketer'),
  route('POST', pattern('enrolments/:id/exit'), async context => {
    await exitEnrolment(context.params[0], context.user.name);
    return getEnrolment(context.params[0]);
  }, 'marketer'),
  route('GET', pattern('contacts'), async ({ query }) => ({
    items: (await searchContacts(query.get('q') ?? '', 20)).map(contact => ({ id: contact.id, name: contact.name, email: contact.email, tags: contact.tags, points: contact.points })),
  }), 'marketer'),
  route('GET', pattern('templates'), async () => ({ items: flowTemplates })),
  // Fallbacks for the canvas pickers, read from the shared tables (migration 008) when the owning lane's list is unavailable.
  route('GET', pattern('lookups/designs'), async () => {
    const result = await db.query<{ id: string; name: string; subject: string; kind: string; status: string; updated_at: Date }>(
      `SELECT id, name, subject, kind, status, updated_at FROM designs WHERE kind = 'email' AND status <> 'archived' ORDER BY updated_at DESC LIMIT 200`);
    return { items: result.rows.map(row => ({ id: row.id, name: row.name, subject: row.subject, kind: row.kind, status: row.status, updatedAt: new Date(row.updated_at).toISOString() })) };
  }, 'marketer'),
  route('GET', pattern('lookups/pipelines'), async () => {
    const pipelines = await db.query<{ id: string; name: string; currency: string; is_default: boolean }>('SELECT id, name, currency, is_default FROM pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, position, name');
    const stages = await db.query<{ id: string; pipeline_id: string; name: string; position: number; probability: number; outcome: string }>('SELECT id, pipeline_id, name, position, probability, outcome FROM pipeline_stages ORDER BY position');
    return {
      items: pipelines.rows.map(row => ({
        id: row.id, name: row.name, currency: row.currency, isDefault: row.is_default,
        stages: stages.rows.filter(stage => stage.pipeline_id === row.id).map(stage => ({ id: stage.id, name: stage.name, position: stage.position, probability: stage.probability, outcome: stage.outcome })),
      })),
    };
  }, 'marketer'),
  ...campaignEndpoints,
  ...hookEndpoints,
];
