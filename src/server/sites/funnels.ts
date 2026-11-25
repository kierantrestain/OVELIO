// Funnels (Lane 3): an ordered set of landing pages. Visitors move step to step; funnel.step_viewed is recorded once
// per visitor and step, funnel.completed once per visitor when they reach the last step.
import type { User } from '@/contracts';
import type { FunnelDetail, FunnelStats, FunnelSummary, PageStats } from '@/contracts/sites';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { isDevPreviewMode } from '../dev-preview';
import { audit } from '../events';
import type { DomainRow, PageRow } from './data';
import { domainsById, iso, pageUrl, requirePage, uuidPattern } from './data';
import { rate } from './pages';

type FunnelRow = { id: string; name: string; description: string; status: FunnelSummary['status']; created_at: Date; updated_at: Date };

async function requireFunnel(id: string): Promise<FunnelRow> {
  const row = uuidPattern.test(id) ? (await db.query<FunnelRow>('SELECT * FROM funnels WHERE id = $1', [id])).rows[0] : undefined;
  if (!row) throw new AppError(404, 'That funnel was not found.');
  return row;
}

async function funnelCounts(ids: string[], days = 30) {
  if (!ids.length) return new Map<string, { entered: number; completed: number }>();
  const rows = await db.query<{ entity_id: string; entered: string; completed: string }>(
    `SELECT entity_id,
       count(DISTINCT visitor_id) FILTER (WHERE type = 'funnel.step_viewed' AND properties->>'stepIndex' = '0') AS entered,
       count(DISTINCT visitor_id) FILTER (WHERE type = 'funnel.completed') AS completed
     FROM events WHERE entity_type = 'funnel' AND entity_id = ANY($1::text[]) AND occurred_at >= now() - make_interval(days => $2) GROUP BY entity_id`,
    [ids, days],
  );
  return new Map(rows.rows.map(row => [row.entity_id, { entered: Number(row.entered), completed: Number(row.completed) }]));
}

export async function listFunnels(): Promise<FunnelSummary[]> {
  const rows = await db.query<FunnelRow & { steps: string }>(
    `SELECT f.*, (SELECT count(*) FROM funnel_steps s WHERE s.funnel_id = f.id) AS steps FROM funnels f WHERE f.status <> 'archived' ORDER BY f.updated_at DESC`,
  );
  const counts = await funnelCounts(rows.rows.map(row => row.id));
  return rows.rows.map(row => {
    const count = counts.get(row.id) ?? { entered: 0, completed: 0 };
    return { id: row.id, name: row.name, status: row.status, description: row.description, stepCount: Number(row.steps), updatedAt: iso(row.updated_at)!,
      visitors: count.entered, completions: count.completed, completionRate: rate(count.completed, count.entered) };
  });
}

export async function getFunnel(id: string): Promise<FunnelDetail> {
  const row = await requireFunnel(id);
  const steps = await db.query<{ id: string; position: number; name: string; page_id: string } & Pick<PageRow, 'slug' | 'domain_id' | 'status'> & { page_name: string }>(
    `SELECT s.id, s.position, s.name, s.page_id, p.name AS page_name, p.slug, p.domain_id, p.status FROM funnel_steps s JOIN landing_pages p ON p.id = s.page_id
     WHERE s.funnel_id = $1 ORDER BY s.position`, [id],
  );
  const domains = await domainsById(steps.rows.map(step => step.domain_id));
  const count = (await funnelCounts([id])).get(id) ?? { entered: 0, completed: 0 };
  return {
    id: row.id, name: row.name, status: row.status, description: row.description, stepCount: steps.rows.length, updatedAt: iso(row.updated_at)!,
    visitors: count.entered, completions: count.completed, completionRate: rate(count.completed, count.entered),
    steps: steps.rows.map(step => ({
      id: step.id, position: step.position, name: step.name, pageId: step.page_id, pageName: step.page_name, pageStatus: step.status,
      url: pageUrl({ id: step.page_id, slug: step.slug, domain_id: step.domain_id }, step.domain_id ? domains.get(step.domain_id) : null),
    })),
  };
}

export type FunnelInput = { name?: string; description?: string; status?: FunnelSummary['status']; steps?: { name: string; pageId: string }[] };

export async function saveFunnel(id: string | null, input: FunnelInput, user: User) {
  if (input.steps) {
    const pageIds = input.steps.map(step => step.pageId);
    if (new Set(pageIds).size !== pageIds.length) throw new AppError(400, 'Use each page once per funnel.');
    for (const pageId of pageIds) await requirePage(pageId);
  }
  const savedId = await transaction(async client => {
    let funnelId = id;
    if (funnelId) {
      const current = await requireFunnel(funnelId);
      if (input.status === 'active' && !(input.steps ?? []).length) {
        const existing = await client.query('SELECT 1 FROM funnel_steps WHERE funnel_id = $1', [funnelId]);
        if (!existing.rows.length && !input.steps) throw new AppError(400, 'Add at least two steps before activating the funnel.');
      }
      await client.query('UPDATE funnels SET name = $2, description = $3, status = $4, updated_at = now() WHERE id = $1',
        [funnelId, input.name?.trim() || current.name, input.description ?? current.description, input.status ?? current.status]);
    } else {
      if (!input.name?.trim()) throw new AppError(400, 'Name the funnel.');
      funnelId = (await client.query<{ id: string }>('INSERT INTO funnels (name, description, status, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [input.name.trim(), input.description ?? '', input.status ?? 'draft', user.id])).rows[0].id;
      await audit(user.id, 'create', 'funnel', funnelId, input.name.trim(), client);
    }
    if (input.steps) {
      await client.query('DELETE FROM funnel_steps WHERE funnel_id = $1', [funnelId]);
      for (const [position, step] of input.steps.entries()) {
        await client.query('INSERT INTO funnel_steps (funnel_id, position, name, page_id) VALUES ($1, $2, $3, $4)',
          [funnelId, position, step.name.trim().slice(0, 120) || `Step ${position + 1}`, step.pageId]);
      }
    }
    const steps = await client.query('SELECT 1 FROM funnel_steps WHERE funnel_id = $1', [funnelId]);
    const status = (await client.query<{ status: string }>('SELECT status FROM funnels WHERE id = $1', [funnelId])).rows[0].status;
    if (status === 'active' && steps.rows.length < 2) throw new AppError(400, 'An active funnel needs at least two steps.');
    return funnelId;
  });
  return getFunnel(savedId);
}

export async function deleteFunnel(id: string, user: User) {
  const row = await requireFunnel(id);
  await db.query(`UPDATE funnels SET status = 'archived', updated_at = now() WHERE id = $1`, [id]);
  await audit(user.id, 'archive', 'funnel', id, row.name);
}

export type FunnelPlacement = { funnelId: string; stepIndex: number; stepCount: number; nextPage: (Pick<PageRow, 'id' | 'slug' | 'domain_id'> & { domain?: DomainRow | null }) | null };

/** The active funnel a page belongs to (the one named in `preferred` when the page is in several). */
export async function funnelForPage(pageId: string, preferred?: string | null): Promise<FunnelPlacement | null> {
  const rows = await db.query<{ funnel_id: string; position: number; total: string }>(
    `SELECT s.funnel_id, s.position, (SELECT count(*) FROM funnel_steps x WHERE x.funnel_id = s.funnel_id) AS total
     FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id WHERE s.page_id = $1 AND f.status = 'active' ORDER BY f.updated_at DESC`, [pageId],
  );
  const match = rows.rows.find(row => row.funnel_id === preferred) ?? rows.rows[0];
  if (!match) return null;
  const next = (await db.query<Pick<PageRow, 'id' | 'slug' | 'domain_id'>>(
    `SELECT p.id, p.slug, p.domain_id FROM funnel_steps s JOIN landing_pages p ON p.id = s.page_id WHERE s.funnel_id = $1 AND s.position > $2 ORDER BY s.position LIMIT 1`,
    [match.funnel_id, match.position],
  )).rows[0];
  const domain = next?.domain_id ? (await domainsById([next.domain_id])).get(next.domain_id) : null;
  return { funnelId: match.funnel_id, stepIndex: match.position, stepCount: Number(match.total), nextPage: next ? { ...next, domain } : null };
}

const provenance = () => isDevPreviewMode() ? 'preview_sample' as const : 'live' as const;

export async function funnelStats(id: string, days = 30): Promise<FunnelStats> {
  const funnel = await getFunnel(id);
  const rows = await db.query<{ step: string; visitors: string }>(
    `SELECT properties->>'stepIndex' AS step, count(DISTINCT visitor_id) AS visitors FROM events
     WHERE type = 'funnel.step_viewed' AND entity_type = 'funnel' AND entity_id = $1 AND occurred_at >= now() - make_interval(days => $2) GROUP BY 1`,
    [id, days],
  );
  const byStep = new Map(rows.rows.map(row => [Number(row.step), Number(row.visitors)]));
  const steps = funnel.steps.map((step, index) => {
    const visitors = byStep.get(step.position) ?? 0;
    const previous = index ? byStep.get(funnel.steps[index - 1].position) ?? 0 : null;
    return {
      position: step.position, name: step.name, pageId: step.pageId, visitors,
      conversionFromPrevious: previous == null ? null : rate(visitors, previous),
      dropOff: previous == null ? null : Math.max(0, previous - visitors),
    };
  });
  const completed = (await funnelCounts([id], days)).get(id)?.completed ?? 0;
  const entered = steps[0]?.visitors ?? 0;
  return { days, steps, entered, completed, completionRate: rate(completed, entered), provenance: provenance() };
}

/** Views, visitors, submissions and conversions for one page, by day, variant and source. */
export async function pageStats(pageId: string, days = 30): Promise<PageStats> {
  const page = await requirePage(pageId);
  const [totals, series, variants, sources, submissions, names] = await Promise.all([
    db.query<{ views: string; visitors: string; conversions: string }>(
      `SELECT count(*) FILTER (WHERE type = 'page.viewed') AS views, count(DISTINCT visitor_id) FILTER (WHERE type = 'page.viewed') AS visitors,
         count(DISTINCT coalesce(visitor_id, id::text)) FILTER (WHERE type = 'page.converted') AS conversions
       FROM events WHERE entity_type = 'page' AND entity_id = $1 AND occurred_at >= now() - make_interval(days => $2)`, [pageId, days]),
    db.query<{ day: string; views: string; conversions: string }>(
      `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, count(*) FILTER (WHERE type = 'page.viewed') AS views,
         count(*) FILTER (WHERE type = 'page.converted') AS conversions
       FROM events WHERE entity_type = 'page' AND entity_id = $1 AND occurred_at >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [pageId, days]),
    db.query<{ variant: string; views: string; visitors: string; conversions: string }>(
      `SELECT coalesce(properties->>'variant', 'a') AS variant, count(*) FILTER (WHERE type = 'page.viewed') AS views,
         count(DISTINCT visitor_id) FILTER (WHERE type = 'page.viewed') AS visitors,
         count(DISTINCT coalesce(visitor_id, id::text)) FILTER (WHERE type = 'page.converted') AS conversions
       FROM events WHERE entity_type = 'page' AND entity_id = $1 AND occurred_at >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [pageId, days]),
    db.query<{ label: string; value: string }>(
      `SELECT coalesce(nullif(utm->>'source', ''), 'Direct') AS label, count(*) AS value FROM events
       WHERE type = 'page.viewed' AND entity_type = 'page' AND entity_id = $1 AND occurred_at >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [pageId, days]),
    db.query<{ count: string }>(`SELECT count(*) FROM form_submissions WHERE page_id = $1 AND status = 'accepted' AND created_at >= now() - make_interval(days => $2)`, [pageId, days]),
    db.query<{ key: string; name: string }>('SELECT key, name FROM page_variants WHERE page_id = $1', [pageId]),
  ]);
  const variantName = new Map([['a', page.ab_enabled || names.rows.length ? 'Variant A (control)' : 'Page'], ...names.rows.map(row => [row.key, row.name] as [string, string])]);
  const daily = new Map(series.rows.map(row => [row.day, row]));
  const points = Array.from({ length: days }, (_, index) => {
    const day = new Date(Date.now() - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
    const row = daily.get(day);
    return { date: day, views: Number(row?.views ?? 0), conversions: Number(row?.conversions ?? 0) };
  });
  const total = totals.rows[0];
  return {
    days, views: Number(total.views), visitors: Number(total.visitors), conversions: Number(total.conversions), submissions: Number(submissions.rows[0].count),
    conversionRate: rate(Number(total.conversions), Number(total.visitors)), series: points,
    variants: variants.rows.map(row => ({ key: row.variant, name: variantName.get(row.variant) ?? `Variant ${row.variant.toUpperCase()}`, views: Number(row.views), visitors: Number(row.visitors), conversions: Number(row.conversions), conversionRate: rate(Number(row.conversions), Number(row.visitors)) })),
    sources: sources.rows.map(row => ({ label: row.label, value: Number(row.value) })), provenance: provenance(),
  };
}

export async function searchFunnels(q: string) {
  const rows = await db.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM funnels WHERE status <> 'archived' AND name ILIKE '%' || $1 || '%' ORDER BY updated_at DESC LIMIT 5`, [q],
  );
  return rows.rows;
}
