// Funnels from OVELIO events: multi-step funnels (funnel.step_viewed / funnel.completed), landing page conversion
// (page.viewed → form.submitted on that page by the same visitor) and the lead-to-revenue lifecycle funnel.
import type { User } from '@/contracts';
import type { FunnelResult, FunnelStep, FunnelsReport, PageConversionRow } from '@/contracts/insights';
import { db } from '../db';
import { laneNames, shortId } from './labels';
import type { InsightsQuery } from './params';
import { Params, eventWhere, iso, leadTypes, meta, ratio } from './params';

const COMPLETED = -1;

/** Builds funnel steps from per-visitor first times at each step; a visitor reaches a step only after the previous one. */
export function sequentialSteps(
  visits: Map<string, Map<number, number>>, stepIndexes: number[], labels: Map<number, string>, funnelId: string,
): FunnelStep[] {
  const order = [...stepIndexes.filter(index => index !== COMPLETED).sort((a, b) => a - b), ...(stepIndexes.includes(COMPLETED) ? [COMPLETED] : [])];
  const counts = order.map(() => 0);
  for (const times of visits.values()) {
    let previous = -Infinity;
    for (let position = 0; position < order.length; position++) {
      const at = times.get(order[position]);
      if (at === undefined || at < previous) break;
      counts[position] += 1;
      previous = at;
    }
  }
  return order.map((index, position) => {
    const before = position ? counts[position - 1] : null;
    return {
      index: position,
      label: index === COMPLETED ? 'Completed' : labels.get(index) || `Step ${index + 1}`,
      visitors: counts[position],
      conversionFromStart: ratio(counts[position], counts[0]),
      conversionFromPrevious: before == null ? null : ratio(counts[position], before),
      abandonment: before == null || !before ? null : 1 - counts[position] / before,
      drill: { metric: 'funnel_step', funnelId, step: index },
    };
  });
}

async function eventFunnels(q: InsightsQuery, user: User): Promise<FunnelResult[]> {
  const p = new Params();
  const result = await db.query<{ funnel: string; who: string; step: number; at: Date; step_name: string | null; funnel_name: string | null }>(
    `SELECT e.entity_id AS funnel, coalesce(e.visitor_id, 'contact:' || e.contact_id::text) AS who,
            CASE WHEN e.type = 'funnel.completed' THEN ${COMPLETED}
                 WHEN e.properties->>'stepIndex' ~ '^[0-9]{1,3}$' THEN (e.properties->>'stepIndex')::int ELSE 0 END AS step,
            min(e.occurred_at) AS at, max(e.properties->>'stepName') AS step_name, max(e.properties->>'funnelName') AS funnel_name
     FROM events e
     WHERE e.type IN ('funnel.step_viewed', 'funnel.completed') AND e.entity_type = 'funnel' AND e.entity_id IS NOT NULL
       AND (e.visitor_id IS NOT NULL OR e.contact_id IS NOT NULL)
       AND e.occurred_at >= ${p.add(iso(q.range.startAt))} AND e.occurred_at < ${p.add(iso(q.range.endAt))}
       AND ${eventWhere(p, 'e', q.filters)}
     GROUP BY 1, 2, 3`,
    p.values,
  );
  const names = await laneNames('sites/funnels', user);
  const funnels = new Map<string, { visits: Map<string, Map<number, number>>; steps: Set<number>; labels: Map<number, string>; name: string | null }>();
  for (const row of result.rows) {
    const funnel = funnels.get(row.funnel) ?? { visits: new Map(), steps: new Set(), labels: new Map(), name: null };
    const times = funnel.visits.get(row.who) ?? new Map<number, number>();
    times.set(row.step, new Date(row.at).getTime());
    funnel.visits.set(row.who, times);
    funnel.steps.add(row.step);
    if (row.step_name) funnel.labels.set(row.step, row.step_name);
    funnel.name ??= row.funnel_name;
    funnels.set(row.funnel, funnel);
  }
  return [...funnels.entries()].map(([id, funnel]) => ({
    id,
    name: names.get(id) || funnel.name || `Funnel ${shortId(id)}`,
    kind: 'funnel' as const,
    href: '/sites/funnels',
    definition: 'Distinct visitors who viewed each step in order (a visitor counts at a step only after reaching the previous one), from funnel step and completion events in the period.',
    steps: sequentialSteps(funnel.visits, [...funnel.steps], funnel.labels, id),
  })).sort((a, b) => (b.steps[0]?.visitors ?? 0) - (a.steps[0]?.visitors ?? 0));
}

async function pageConversion(q: InsightsQuery, user: User): Promise<PageConversionRow[]> {
  const p = new Params();
  const start = p.add(iso(q.range.startAt));
  const end = p.add(iso(q.range.endAt));
  const result = await db.query<{ page: string; viewers: string; converters: string; page_name: string | null }>(
    `WITH views AS (
       SELECT e.entity_id AS page, e.visitor_id, min(e.occurred_at) AS first_view, max(e.properties->>'pageName') AS page_name FROM events e
       WHERE e.type = 'page.viewed' AND e.entity_type = 'page' AND e.entity_id IS NOT NULL AND e.visitor_id IS NOT NULL
         AND e.occurred_at >= ${start} AND e.occurred_at < ${end} AND ${eventWhere(p, 'e', q.filters)}
       GROUP BY 1, 2
     )
     SELECT views.page, count(*) AS viewers, max(views.page_name) AS page_name,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM events f WHERE f.type = 'form.submitted' AND f.visitor_id = views.visitor_id
                AND f.properties->>'pageId' = views.page AND f.occurred_at >= views.first_view AND f.occurred_at < ${end}
            )) AS converters
     FROM views GROUP BY views.page ORDER BY 2 DESC LIMIT 50`,
    p.values,
  );
  const names = await laneNames('sites/pages', user);
  return result.rows.map(row => ({
    pageId: row.page,
    label: names.get(row.page) || row.page_name || `Page ${shortId(row.page)}`,
    viewers: Number(row.viewers),
    converters: Number(row.converters),
    conversion: ratio(Number(row.converters), Number(row.viewers)),
    href: '/sites',
  }));
}

/** Leads in the period → those with a deal created after they became a lead → those with a won deal. */
async function lifecycle(q: InsightsQuery): Promise<FunnelResult> {
  const p = new Params();
  const result = await db.query<{ leads: string; with_deal: string; won: string }>(
    `WITH leads AS (
       SELECT e.contact_id, min(e.occurred_at) AS lead_at FROM events e
       WHERE e.type = ANY(${p.add(leadTypes)}::text[]) AND e.contact_id IS NOT NULL
         AND e.occurred_at >= ${p.add(iso(q.range.startAt))} AND e.occurred_at < ${p.add(iso(q.range.endAt))} AND ${eventWhere(p, 'e', q.filters)}
       GROUP BY e.contact_id
     ), people AS (
       SELECT d.id, d.status, d.created_at, d.contact_id FROM deals d WHERE d.archived_at IS NULL AND d.contact_id IS NOT NULL
       UNION SELECT d.id, d.status, d.created_at, dc.contact_id FROM deals d JOIN deal_contacts dc ON dc.deal_id = d.id WHERE d.archived_at IS NULL
     )
     SELECT count(*) AS leads,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM people WHERE people.contact_id = leads.contact_id AND people.created_at >= leads.lead_at)) AS with_deal,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM people WHERE people.contact_id = leads.contact_id AND people.created_at >= leads.lead_at AND people.status = 'won')) AS won
     FROM leads`,
    p.values,
  );
  const row = result.rows[0];
  const counts = [Number(row?.leads ?? 0), Number(row?.with_deal ?? 0), Number(row?.won ?? 0)];
  const labels = ['Became a lead', 'Deal created', 'Deal won'];
  return {
    id: 'lifecycle',
    name: 'Lead to revenue',
    kind: 'lifecycle',
    href: null,
    definition: 'Contacts who became leads in the period, how many of them then had a deal created (as the deal contact), and how many of those deals are won.',
    steps: counts.map((visitors, index) => ({
      index, label: labels[index], visitors,
      conversionFromStart: ratio(visitors, counts[0]),
      conversionFromPrevious: index ? ratio(visitors, counts[index - 1]) : null,
      abandonment: index && counts[index - 1] ? 1 - visitors / counts[index - 1] : null,
      drill: index === 0 ? { metric: 'leads' } : null,
    })),
  };
}

export async function funnels(q: InsightsQuery, user: User): Promise<FunnelsReport> {
  const [info, life, list, pages] = await Promise.all([meta(q), lifecycle(q), eventFunnels(q, user), pageConversion(q, user)]);
  return { meta: info, lifecycle: life, funnels: list, pages };
}
