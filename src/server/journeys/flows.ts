// Native flow records: drafts, published versions, lifecycle and enrolment listings (lane 4).
import type {
  Enrolment, EnrolmentDetail, EnrolResult, FlowDetail, FlowGraph, FlowInput, FlowSummary, FlowTrigger, FlowVersion, NodeStats, ReentryRule, StepLog,
} from '@/contracts/journeys';
import { blankGraph, describeNode, flowTemplates, nodeSpec, validateFlow } from '@/contracts/journeys';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { getContacts } from '../directory';
import { audit } from '../events';
import type { EnrolmentRow, FlowRow } from './engine';
import { enrol, resumeHeld } from './engine';

type SummaryRow = FlowRow & {
  campaign_name: string | null; owner_name: string | null; v_graph: FlowGraph | null; v_triggers: FlowTrigger[] | null; v_reentry: ReentryRule | null;
  enrolled: string; active: string; waiting: string; completed: string; failed: string; exited: string; last_run: Date | null;
};

const summarySql = `
  SELECT f.*, c.name AS campaign_name, u.name AS owner_name, v.graph AS v_graph, v.triggers AS v_triggers, v.reentry AS v_reentry,
    coalesce(s.enrolled, 0) AS enrolled, coalesce(s.active, 0) AS active, coalesce(s.waiting, 0) AS waiting,
    coalesce(s.completed, 0) AS completed, coalesce(s.failed, 0) AS failed, coalesce(s.exited, 0) AS exited, s.last_run
  FROM journey_flows f
  LEFT JOIN marketing_campaigns c ON c.id = f.campaign_id
  LEFT JOIN users u ON u.id = f.owner_id
  LEFT JOIN journey_flow_versions v ON v.flow_id = f.id AND v.version = f.published_version
  LEFT JOIN LATERAL (
    SELECT count(*) AS enrolled, count(*) FILTER (WHERE status = 'active') AS active, count(*) FILTER (WHERE status = 'waiting') AS waiting,
      count(*) FILTER (WHERE status = 'completed') AS completed, count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'exited') AS exited, max(updated_at) AS last_run
    FROM journey_enrolments WHERE flow_id = f.id
  ) s ON true`;

/** The logic of a graph, without node positions, so moving cards does not count as an unpublished change. */
function logic(graph: FlowGraph | null, triggers: FlowTrigger[] | null, reentry: string | null) {
  if (!graph) return '';
  const nodes = [...graph.nodes].map(node => ({ id: node.id, type: node.type, config: node.config })).sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...graph.edges].map(edge => `${edge.source}:${edge.sourceHandle}>${edge.target}`).sort();
  return JSON.stringify({ nodes, edges, triggers, reentry });
}

function toSummary(row: SummaryRow): FlowSummary {
  return {
    id: row.id, name: row.name, description: row.description, status: row.status, triggers: row.triggers ?? [], reentry: row.reentry,
    campaignId: row.campaign_id, campaignName: row.campaign_name, ownerId: row.owner_id, ownerName: row.owner_name,
    publishedVersion: row.published_version,
    hasUnpublishedChanges: row.published_version != null && logic(row.graph, row.triggers, row.reentry) !== logic(row.v_graph, row.v_triggers, row.v_reentry),
    counts: {
      enrolled: Number(row.enrolled), active: Number(row.active), waiting: Number(row.waiting), completed: Number(row.completed),
      failed: Number(row.failed), exited: Number(row.exited),
    },
    lastRunAt: row.last_run ? new Date(row.last_run).toISOString() : null,
    templateKey: row.template_key,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listFlows(filter: { status?: string; campaignId?: string; q?: string } = {}): Promise<FlowSummary[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.status) { values.push(filter.status); where.push(`f.status = $${values.length}`); }
  else where.push(`f.status <> 'archived'`);
  if (filter.campaignId) { values.push(filter.campaignId); where.push(`f.campaign_id = $${values.length}`); }
  if (filter.q?.trim()) { values.push(`%${filter.q.trim().toLowerCase()}%`); where.push(`lower(f.name) LIKE $${values.length}`); }
  const result = await db.query<SummaryRow>(`${summarySql} WHERE ${where.join(' AND ')} ORDER BY f.updated_at DESC LIMIT 500`, values);
  return result.rows.map(toSummary);
}

async function flowRow(id: string): Promise<SummaryRow> {
  const result = await db.query<SummaryRow>(`${summarySql} WHERE f.id = $1`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'That workflow was not found.');
  return result.rows[0];
}

export async function getFlow(id: string): Promise<FlowDetail> {
  const row = await flowRow(id);
  const versions = await db.query<{ version: number; published_at: Date; name: string | null; graph: FlowGraph; triggers: FlowTrigger[] }>(
    `SELECT v.version, v.published_at, u.name, v.graph, v.triggers FROM journey_flow_versions v LEFT JOIN users u ON u.id = v.published_by
     WHERE v.flow_id = $1 ORDER BY v.version DESC`, [id],
  );
  const stats = await db.query<{ node_id: string; status: string; n: string }>(
    `SELECT l.node_id, l.status, count(DISTINCT l.enrolment_id) AS n FROM journey_step_logs l JOIN journey_enrolments e ON e.id = l.enrolment_id
     WHERE e.flow_id = $1 AND l.seq > 0 GROUP BY l.node_id, l.status`, [id],
  );
  const nodeStats: Record<string, NodeStats> = {};
  for (const stat of stats.rows) {
    const entry = nodeStats[stat.node_id] ??= { ok: 0, failed: 0, skipped: 0, waiting: 0 };
    entry[stat.status as keyof NodeStats] += Number(stat.n);
  }
  return {
    ...toSummary(row),
    graph: row.graph?.nodes?.length ? row.graph : blankGraph(),
    versions: versions.rows.map(version => ({
      version: version.version, publishedAt: new Date(version.published_at).toISOString(), publishedBy: version.name,
      steps: version.graph.nodes.length - 1, triggers: version.triggers.length,
    })),
    nodeStats,
  };
}

export async function getVersion(id: string, version: number, client: Sql = db): Promise<FlowVersion> {
  const result = await client.query<{ version: number; graph: FlowGraph; triggers: FlowTrigger[]; reentry: ReentryRule; published_at: Date; name: string | null }>(
    `SELECT v.*, u.name FROM journey_flow_versions v LEFT JOIN users u ON u.id = v.published_by WHERE v.flow_id = $1 AND v.version = $2`, [id, version],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'That version was not found.');
  return { version: row.version, graph: row.graph, triggers: row.triggers, reentry: row.reentry, publishedAt: new Date(row.published_at).toISOString(), publishedBy: row.name };
}

/** Keeps the campaign's asset list in step with the flow's campaign. */
async function syncCampaignAsset(flowId: string, from: string | null, to: string | null, label: string) {
  if (from) await db.query(`DELETE FROM campaign_assets WHERE campaign_id = $1 AND asset_type = 'flow' AND asset_id = $2`, [from, flowId]);
  if (to) {
    await db.query(`INSERT INTO campaign_assets (campaign_id, asset_type, asset_id, label) VALUES ($1, 'flow', $2, $3) ON CONFLICT DO NOTHING`, [to, flowId, label]);
  }
}

export async function createFlow(input: FlowInput & { templateKey?: string }, actorId: string | null): Promise<FlowDetail> {
  const template = input.templateKey ? flowTemplates.find(item => item.key === input.templateKey) : undefined;
  if (input.templateKey && !template) throw new AppError(404, 'That template was not found.');
  const graph = input.graph ?? (template ? structuredClone(template.graph) : blankGraph());
  const triggers = input.triggers ?? (template ? structuredClone(template.triggers) : []);
  const result = await db.query<{ id: string }>(
    `INSERT INTO journey_flows (name, description, triggers, reentry, graph, campaign_id, owner_id, template_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [(input.name ?? template?.name ?? 'Untitled workflow').trim() || 'Untitled workflow', input.description ?? template?.description ?? '',
      JSON.stringify(triggers), input.reentry ?? template?.reentry ?? 'once', JSON.stringify(graph), input.campaignId ?? null,
      input.ownerId ?? actorId, template?.key ?? null, actorId],
  );
  await syncCampaignAsset(result.rows[0].id, null, input.campaignId ?? null, input.name ?? template?.name ?? 'Workflow');
  await audit(actorId, 'create', 'flow', result.rows[0].id, input.name ?? template?.name ?? '');
  return getFlow(result.rows[0].id);
}

export async function updateFlow(id: string, input: FlowInput, actorId: string | null): Promise<FlowDetail> {
  const current = await flowRow(id);
  if (current.status === 'archived') throw new AppError(409, 'Restore this workflow before editing it.');
  await db.query(
    `UPDATE journey_flows SET name = $2, description = $3, triggers = $4, reentry = $5, graph = $6, campaign_id = $7, owner_id = $8, updated_at = now()
     WHERE id = $1`,
    [id, input.name?.trim() || current.name, input.description ?? current.description, JSON.stringify(input.triggers ?? current.triggers),
      input.reentry ?? current.reentry, JSON.stringify(input.graph ?? current.graph),
      input.campaignId === undefined ? current.campaign_id : input.campaignId, input.ownerId === undefined ? current.owner_id : input.ownerId],
  );
  if (input.campaignId !== undefined && input.campaignId !== current.campaign_id) await syncCampaignAsset(id, current.campaign_id, input.campaignId, input.name ?? current.name);
  await audit(actorId, 'update', 'flow', id, input.name ?? current.name);
  return getFlow(id);
}

type Rollback = { to: number; expected: number };

async function publishSnapshot(id: string, actorId: string | null, rollback?: Rollback): Promise<FlowDetail> {
  const resume = await transaction(async client => {
    const { rows: [current] } = await client.query<FlowRow>('SELECT * FROM journey_flows WHERE id = $1 FOR UPDATE', [id]);
    if (!current) throw new AppError(404, 'That workflow was not found.');
    if (current.status === 'archived') throw new AppError(409, 'Restore this workflow before publishing it.');
    if (rollback && (current.status === 'draft' || current.published_version !== rollback.expected)) {
      throw new AppError(409, 'The active version changed. Reload this workflow before rolling it back.');
    }
    if (rollback?.to === current.published_version) throw new AppError(409, 'This version is already active.');
    const snapshot = rollback ? await getVersion(id, rollback.to, client) : current;
    const errors = validateFlow(snapshot.graph, snapshot.triggers).filter(issue => issue.level === 'error');
    if (errors.length) {
      const first = errors[0];
      const node = first.nodeId ? snapshot.graph.nodes.find(item => item.id === first.nodeId) : undefined;
      throw new AppError(422, `Fix ${errors.length} problem${errors.length === 1 ? '' : 's'} before publishing. ${node ? `${nodeSpec(node.type).label}: ` : ''}${first.message}`);
    }
    const next = await client.query<{ version: number }>('SELECT coalesce(max(version), 0) + 1 AS version FROM journey_flow_versions WHERE flow_id = $1', [id]);
    const version = Number(next.rows[0].version);
    const keepPaused = Boolean(rollback && current.status === 'paused');
    await client.query(
      `INSERT INTO journey_flow_versions (flow_id, version, graph, triggers, reentry, published_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, version, JSON.stringify(snapshot.graph), JSON.stringify(snapshot.triggers), snapshot.reentry, actorId],
    );
    await client.query(
      `UPDATE journey_flows SET status = $3, published_version = $2, published_at = now(),
       paused_at = CASE WHEN $3 = 'paused' THEN paused_at END, updated_at = now() WHERE id = $1`,
      [id, version, keepPaused ? 'paused' : 'published'],
    );
    await audit(actorId, rollback ? 'rollback' : 'publish', 'flow', id,
      rollback ? `${current.name} · version ${version} from version ${rollback.to}` : `${current.name} · version ${version}`, client);
    return !keepPaused && current.status === 'paused';
  });
  if (resume) await resumeHeld(id);
  return getFlow(id);
}

export const publishFlow = (id: string, actorId: string | null) => publishSnapshot(id, actorId);

export const rollbackFlow = (id: string, rollback: Rollback, actorId: string | null) => publishSnapshot(id, actorId, rollback);

export async function setFlowStatus(id: string, action: 'pause' | 'resume' | 'archive' | 'restore', actorId: string | null): Promise<FlowDetail> {
  const current = await flowRow(id);
  const allowed: Record<typeof action, string[]> = { pause: ['published'], resume: ['paused'], archive: ['draft', 'published', 'paused'], restore: ['archived'] };
  if (!allowed[action].includes(current.status)) throw new AppError(409, `A ${current.status} workflow cannot be ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action + 'd'}.`);
  if (action === 'pause') await db.query(`UPDATE journey_flows SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`, [id]);
  if (action === 'resume') {
    await db.query(`UPDATE journey_flows SET status = 'published', paused_at = NULL, updated_at = now() WHERE id = $1`, [id]);
    await resumeHeld(id);
  }
  if (action === 'archive') {
    await transaction(async client => {
      await client.query(`UPDATE journey_flows SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1`, [id]);
      const stopped = await client.query<{ id: string; step_seq: number; current_node: string | null }>(
        `UPDATE journey_enrolments SET status = 'exited', finished_at = now(), next_run_at = NULL, held_at = NULL, updated_at = now()
         WHERE flow_id = $1 AND status IN ('active', 'waiting') RETURNING id, step_seq, current_node`, [id],
      );
      for (const row of stopped.rows) {
        await client.query(
          `INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail) VALUES ($1, $2, $3, 'exit', 'Removed', 'ok', 'The workflow was archived.')`,
          [row.id, row.step_seq, row.current_node ?? 'start'],
        );
      }
    });
  }
  if (action === 'restore') await db.query(`UPDATE journey_flows SET status = 'draft', archived_at = NULL, updated_at = now() WHERE id = $1`, [id]);
  await audit(actorId, action, 'flow', id, current.name);
  return getFlow(id);
}

export async function duplicateFlow(id: string, actorId: string | null): Promise<FlowDetail> {
  const current = await flowRow(id);
  return createFlow({
    name: `Copy of ${current.name}`.slice(0, 120), description: current.description, triggers: current.triggers, reentry: current.reentry,
    graph: current.graph, campaignId: current.campaign_id, ownerId: actorId,
  }, actorId);
}

export async function restoreVersion(id: string, version: number, actorId: string | null): Promise<FlowDetail> {
  const snapshot = await getVersion(id, version);
  return updateFlow(id, { graph: snapshot.graph, triggers: snapshot.triggers, reentry: snapshot.reentry }, actorId);
}

export async function deleteFlow(id: string, actorId: string | null) {
  const current = await flowRow(id);
  if (Number(current.enrolled) > 0) throw new AppError(409, 'This workflow has enrolment history. Archive it instead, so its logs are kept.');
  await db.query('DELETE FROM journey_flows WHERE id = $1', [id]);
  await audit(actorId, 'delete', 'flow', id, current.name);
}

export async function enrolContacts(flowId: string, contactIds: number[], actorId: string | null): Promise<EnrolResult> {
  const skipped: EnrolResult['skipped'] = [];
  let enrolled = 0;
  for (const contactId of [...new Set(contactIds)]) {
    const result = await enrol({ flowId, contactId, triggerType: 'manual', actorId });
    if (result.id) enrolled += 1;
    else skipped.push({ contactId, reason: result.reason ?? 'Not enrolled.' });
  }
  return { enrolled, skipped };
}

/* ── Enrolments ────────────────────────────────────────────────────────────────────────────────────────── */

type EnrolmentListRow = EnrolmentRow & { flow_name: string; v_graph: FlowGraph | null };

async function toEnrolments(rows: EnrolmentListRow[]): Promise<Enrolment[]> {
  const contacts = await getContacts(rows.map(row => Number(row.contact_id)).filter(Boolean));
  return rows.map(row => {
    const contact = row.contact_id ? contacts.get(Number(row.contact_id)) : undefined;
    const node = row.v_graph?.nodes.find(item => item.id === row.current_node);
    return {
      id: row.id, flowId: row.flow_id, flowName: row.flow_name, version: row.version,
      contactId: row.contact_id ? Number(row.contact_id) : null,
      contactName: contact?.name ?? (row.contact_id ? `Contact #${row.contact_id}` : null), contactEmail: contact?.email ?? null,
      status: row.status, currentNodeId: row.current_node,
      currentStep: node ? `${nodeSpec(node.type).label}: ${describeNode(node)}` : null,
      triggerType: row.trigger_type, triggerEventId: row.trigger_event_id, held: Boolean(row.held_at), error: row.error,
      nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
      enrolledAt: new Date(row.enrolled_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    };
  });
}

export async function listEnrolments(filter: { flowId?: string; status?: string; contactId?: number; limit?: number }): Promise<Enrolment[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.flowId) { values.push(filter.flowId); where.push(`e.flow_id = $${values.length}`); }
  if (filter.status) { values.push(filter.status); where.push(`e.status = $${values.length}`); }
  if (filter.contactId) { values.push(filter.contactId); where.push(`e.contact_id = $${values.length}`); }
  values.push(Math.min(Math.max(filter.limit ?? 100, 1), 300));
  const result = await db.query<EnrolmentListRow>(
    `SELECT e.*, f.name AS flow_name, v.graph AS v_graph FROM journey_enrolments e
     JOIN journey_flows f ON f.id = e.flow_id
     LEFT JOIN journey_flow_versions v ON v.flow_id = e.flow_id AND v.version = e.version
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.updated_at DESC LIMIT $${values.length}`, values,
  );
  return toEnrolments(result.rows);
}

export async function getEnrolment(id: string): Promise<EnrolmentDetail> {
  const result = await db.query<EnrolmentListRow>(
    `SELECT e.*, f.name AS flow_name, v.graph AS v_graph FROM journey_enrolments e JOIN journey_flows f ON f.id = e.flow_id
     LEFT JOIN journey_flow_versions v ON v.flow_id = e.flow_id AND v.version = e.version WHERE e.id = $1`, [id],
  );
  if (!result.rows[0]) throw new AppError(404, 'That enrolment was not found.');
  const [enrolment] = await toEnrolments(result.rows);
  const logs = await db.query<{ id: string; seq: number; node_id: string; node_type: string; action: string; status: string; detail: string; attempt: number; at: Date }>(
    'SELECT * FROM journey_step_logs WHERE enrolment_id = $1 ORDER BY id', [id],
  );
  return {
    ...enrolment,
    logs: logs.rows.map(row => ({
      id: String(row.id), seq: row.seq, nodeId: row.node_id, nodeType: row.node_type as StepLog['nodeType'], action: row.action,
      status: row.status as StepLog['status'], detail: row.detail, attempt: row.attempt, at: new Date(row.at).toISOString(),
    })),
  };
}
