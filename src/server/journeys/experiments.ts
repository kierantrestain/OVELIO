// Results for the A/B splits in a native workflow (lane 4). Each contact's path is the one the engine logged when it
// passed the split (deterministic per enrolment, src/server/journeys/engine.ts splitPath), and outcomes are platform
// events for that contact inside the split's measurement window. Opens are never used.
import type { ExperimentMetric, ExperimentResult } from '@/contracts/experiments';
import { experimentMetrics, experimentRules, judgeExperiment } from '@/contracts/experiments';
import type { FlowGraph } from '@/contracts/journeys';
import { clampPercent } from '@/contracts/journeys';
import { AppError } from '../config';
import { db } from '../db';

type Row = { node_id: string; arm: string | null; clicked: boolean; converted: boolean; qualified: boolean; revenue: string; scanner_clicks: string };

export function splitSettings(config: Record<string, unknown>) {
  const metric = (experimentMetrics as readonly string[]).includes(String(config.metric)) ? config.metric as ExperimentMetric : 'click';
  const days = Math.trunc(Number(config.windowDays));
  return { metric, windowDays: days >= 1 && days <= 90 ? days : experimentRules.defaultWindowDays, percentA: clampPercent(config.percentA) };
}

export async function flowExperiments(flowId: string): Promise<{ items: ExperimentResult[] }> {
  const flow = (await db.query<{ graph: FlowGraph }>('SELECT graph FROM journey_flows WHERE id = $1', [flowId])).rows[0];
  if (!flow) throw new AppError(404, 'That workflow was not found.');
  const splits = (flow.graph?.nodes ?? []).filter(node => node.type === 'split');
  if (!splits.length) return { items: [] };
  const items: ExperimentResult[] = [];
  for (const [index, node] of splits.entries()) {
    const settings = splitSettings(node.config ?? {});
    const rows = await db.query<Row>(
      `WITH s AS (
         SELECT DISTINCT ON (l.enrolment_id) l.enrolment_id, l.node_id, substring(l.detail from '^Path ([AB])') AS arm, l.at, e.contact_id
         FROM journey_step_logs l JOIN journey_enrolments e ON e.id = l.enrolment_id
         WHERE e.flow_id = $1 AND l.node_id = $2 AND l.node_type = 'split' AND l.status = 'ok' AND e.contact_id IS NOT NULL
         ORDER BY l.enrolment_id, l.at
       )
       SELECT s.node_id, s.arm,
         EXISTS (SELECT 1 FROM events c WHERE c.contact_id = s.contact_id AND c.type = 'email.clicked' AND c.source = $3
           AND c.occurred_at >= s.at AND c.occurred_at < s.at + make_interval(days => $4) AND coalesce(c.properties->>'suspectedBot', 'false') <> 'true') AS clicked,
         EXISTS (SELECT 1 FROM events c WHERE c.contact_id = s.contact_id AND c.type IN ('form.submitted', 'page.converted')
           AND c.occurred_at >= s.at AND c.occurred_at < s.at + make_interval(days => $4)) AS converted,
         EXISTS (SELECT 1 FROM events c WHERE c.contact_id = s.contact_id AND c.type = 'deal.created'
           AND c.occurred_at >= s.at AND c.occurred_at < s.at + make_interval(days => $4)) AS qualified,
         coalesce((SELECT sum(c.amount) FROM events c WHERE c.contact_id = s.contact_id AND c.type = 'deal.won'
           AND c.occurred_at >= s.at AND c.occurred_at < s.at + make_interval(days => $4)), 0) AS revenue,
         (SELECT count(*) FROM events c WHERE c.contact_id = s.contact_id AND c.type = 'email.clicked' AND c.source = $3
           AND c.occurred_at >= s.at AND c.occurred_at < s.at + make_interval(days => $4) AND c.properties->>'suspectedBot' = 'true') AS scanner_clicks
       FROM s`,
      [flowId, node.id, `flow:${flowId}`, settings.windowDays],
    );
    const outcomes = rows.rows.filter(row => row.arm === 'A' || row.arm === 'B').map(row => {
      const revenue = Number(row.revenue);
      const success = settings.metric === 'click' ? row.clicked : settings.metric === 'conversion' ? row.converted
        : settings.metric === 'qualified_lead' ? row.qualified : revenue > 0;
      return { arm: row.arm === 'A' ? 'a' as const : 'b' as const, success, revenue };
    });
    const judged = judgeExperiment({ metric: settings.metric, outcomes });
    items.push({
      nodeId: node.id, label: String(node.config?.label || `A/B split ${index + 1}`), ...settings, ...judged,
      excludedScannerClicks: rows.rows.reduce((sum, row) => sum + Number(row.scanner_clicks), 0),
    });
  }
  return { items };
}
