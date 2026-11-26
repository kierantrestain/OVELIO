// Sales report: pipeline by stage, won revenue over time, win rate breakdowns, velocity, stage conversion, forecast.
import type { DateRange } from '@/contracts';
import type { ConversionRow, ForecastRow, InsightsFilters, Interval, SalesReport, Series, StageRow, WinRateRow } from '@/contracts/insights';
import { db } from '../db';
import type { InsightsQuery } from './params';
import { DAY, Params, bucketStarts, dealWhere, iso, meta, money, ratio, truncate } from './params';
import { closedDeals, openPipeline } from './summary';

type Bucket = { bucket: string; value: string | null; count: string };

/** Fills every bucket of the range (and aligns the comparison period's buckets by position). */
export function toSeries(range: DateRange, interval: Interval, rows: Bucket[], previousRange: DateRange | null, previousRows: Bucket[] | null): Series {
  const read = (items: Bucket[]) => new Map(items.map(row => [Date.parse(row.bucket + 'T00:00:00Z'), row]));
  const current = read(rows);
  const starts = bucketStarts(range, interval);
  const prior = previousRange && previousRows ? read(previousRows) : null;
  const priorStarts = previousRange ? bucketStarts(previousRange, interval) : [];
  return {
    interval,
    points: starts.map((start, index) => {
      const row = current.get(start);
      const before = prior ? prior.get(priorStarts[index] ?? -1) : undefined;
      return {
        start: new Date(start).toISOString(),
        value: money(row?.value),
        count: Number(row?.count ?? 0),
        previous: prior ? (priorStarts[index] === undefined ? null : money(before?.value)) : null,
      };
    }),
  };
}

async function wonBuckets(range: DateRange, filters: InsightsFilters, currency: string, interval: Interval): Promise<Bucket[]> {
  const p = new Params();
  const result = await db.query<Bucket>(
    `SELECT to_char(date_trunc('${interval}', d.closed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
            sum(d.amount) FILTER (WHERE d.currency = ${p.add(currency)}) AS value, count(*) AS count
     FROM deals d WHERE ${dealWhere(p, 'd', filters)} AND d.status = 'won'
       AND d.closed_at >= ${p.add(iso(range.startAt))} AND d.closed_at < ${p.add(iso(range.endAt))}
     GROUP BY 1`,
    p.values,
  );
  return result.rows;
}

export async function wonRevenueSeries(q: InsightsQuery): Promise<Series> {
  const [rows, previous] = await Promise.all([
    wonBuckets(q.range, q.filters, q.currency, q.interval),
    q.comparison ? wonBuckets(q.comparison, q.filters, q.currency, q.interval) : Promise.resolve(null),
  ]);
  return toSeries(q.range, q.interval, rows, q.comparison, previous);
}

export async function reportPipeline(filters: InsightsFilters) {
  const result = await db.query<{ id: string; name: string; currency: string }>(
    `SELECT id, name, currency FROM pipelines WHERE archived_at IS NULL AND ($1::uuid IS NULL OR id = $1::uuid)
     ORDER BY is_default DESC, position, created_at LIMIT 1`, [filters.pipelineId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function stages(q: InsightsQuery, pipelineId: string): Promise<StageRow[]> {
  const p = new Params();
  const cur = p.add(q.currency);
  const start = p.add(iso(q.range.startAt));
  const end = p.add(iso(q.range.endAt));
  const result = await db.query<{
    id: string; name: string; position: number; probability: number; outcome: StageRow['outcome'];
    open_count: string; open_value: string | null; weighted: string | null; closed_count: string; closed_value: string | null;
  }>(
    `SELECT s.id, s.name, s.position, s.probability, s.outcome,
            count(d.id) FILTER (WHERE d.status = 'open') AS open_count,
            sum(d.amount) FILTER (WHERE d.status = 'open' AND d.currency = ${cur}) AS open_value,
            sum(d.amount * coalesce(d.probability, s.probability) / 100.0) FILTER (WHERE d.status = 'open' AND d.currency = ${cur}) AS weighted,
            count(d.id) FILTER (WHERE d.status <> 'open' AND d.closed_at >= ${start} AND d.closed_at < ${end}) AS closed_count,
            sum(d.amount) FILTER (WHERE d.status <> 'open' AND d.closed_at >= ${start} AND d.closed_at < ${end} AND d.currency = ${cur}) AS closed_value
     FROM pipeline_stages s
     LEFT JOIN deals d ON d.stage_id = s.id AND ${dealWhere(p, 'd', q.filters, ['pipeline'])}
     WHERE s.pipeline_id = ${p.add(pipelineId)}
     GROUP BY s.id, s.name, s.position, s.probability, s.outcome ORDER BY s.position`,
    p.values,
  );
  return result.rows.map(row => {
    const open = row.outcome === 'open';
    return {
      stageId: row.id, name: row.name, position: row.position, outcome: row.outcome, probability: row.probability,
      count: Number(open ? row.open_count : row.closed_count),
      value: money(open ? row.open_value : row.closed_value),
      weighted: open ? money(row.weighted) : null,
    };
  });
}

const breakdowns = {
  owner: { key: 'd.owner_id::text', label: `coalesce(u.name, 'Unassigned')` },
  source: { key: `nullif(d.source, '')`, label: `coalesce(nullif(d.source, ''), 'No source')` },
  campaign: { key: 'd.campaign_id::text', label: `coalesce(c.name, 'No campaign')` },
} as const;

export async function winRateBy(q: InsightsQuery, by: keyof typeof breakdowns): Promise<WinRateRow[]> {
  const p = new Params();
  const column = breakdowns[by];
  const result = await db.query<{ key: string | null; label: string; won: string; lost: string; won_value: string | null }>(
    `SELECT ${column.key} AS key, ${column.label} AS label,
            count(*) FILTER (WHERE d.status = 'won') AS won, count(*) FILTER (WHERE d.status = 'lost') AS lost,
            sum(d.amount) FILTER (WHERE d.status = 'won' AND d.currency = ${p.add(q.currency)}) AS won_value
     FROM deals d LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN marketing_campaigns c ON c.id = d.campaign_id
     WHERE ${dealWhere(p, 'd', q.filters)} AND d.status IN ('won', 'lost')
       AND d.closed_at >= ${p.add(iso(q.range.startAt))} AND d.closed_at < ${p.add(iso(q.range.endAt))}
     GROUP BY 1, 2 ORDER BY 5 DESC NULLS LAST, 3 DESC, 2`,
    p.values,
  );
  return result.rows.map(row => {
    const won = Number(row.won);
    const lost = Number(row.lost);
    return { key: row.key, label: row.label, won, lost, winRate: ratio(won, won + lost), wonRevenue: money(row.won_value) };
  });
}

/**
 * For deals created in the period: how many reached each open stage or Won (a deal that skips a stage still counts
 * as having passed it), and how long completed stays in each stage lasted.
 */
export async function stageConversion(q: InsightsQuery, pipelineId: string): Promise<ConversionRow[]> {
  const stageRows = await db.query<{ id: string; name: string; position: number; outcome: string }>(
    'SELECT id, name, position, outcome FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position', [pipelineId],
  );
  const steps = [...stageRows.rows.filter(row => row.outcome === 'open'), ...stageRows.rows.filter(row => row.outcome === 'won')];
  const rank = new Map(steps.map((row, index) => [row.id, index]));
  const p = new Params();
  const history = await db.query<{ deal_id: string; to_stage_id: string; changed_at: Date; left_at: Date | null }>(
    `SELECT h.deal_id, h.to_stage_id, h.changed_at,
            lead(h.changed_at) OVER (PARTITION BY h.deal_id ORDER BY h.changed_at, h.id) AS left_at
     FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id
     WHERE ${dealWhere(p, 'd', q.filters, ['pipeline'])} AND d.pipeline_id = ${p.add(pipelineId)}
       AND d.created_at >= ${p.add(iso(q.range.startAt))} AND d.created_at < ${p.add(iso(q.range.endAt))}`,
    p.values,
  );
  const furthest = new Map<string, number>();
  const stays = new Map<string, number[]>();
  for (const row of history.rows) {
    const position = rank.get(row.to_stage_id);
    if (position === undefined) continue;
    furthest.set(row.deal_id, Math.max(furthest.get(row.deal_id) ?? -1, position));
    if (row.left_at) {
      const list = stays.get(row.to_stage_id) ?? [];
      list.push((new Date(row.left_at).getTime() - new Date(row.changed_at).getTime()) / DAY);
      stays.set(row.to_stage_id, list);
    }
  }
  const reached = steps.map((_, index) => [...furthest.values()].filter(value => value >= index).length);
  return steps.map((step, index) => {
    const durations = step.outcome === 'open' ? stays.get(step.id) ?? [] : [];
    return {
      stageId: step.id,
      name: step.name,
      reached: reached[index],
      conversionToNext: index < steps.length - 1 ? ratio(reached[index + 1], reached[index]) : null,
      avgDaysInStage: durations.length ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null,
    };
  });
}

export async function forecast(q: InsightsQuery): Promise<ForecastRow[]> {
  const p = new Params();
  const cur = p.add(q.currency);
  const result = await db.query<{ month: string | null; count: string; value: string | null; weighted: string | null }>(
    `SELECT to_char(date_trunc('month', d.expected_close_date), 'YYYY-MM') AS month, count(*) AS count,
            sum(d.amount) FILTER (WHERE d.currency = ${cur}) AS value,
            sum(d.amount * coalesce(d.probability, s.probability) / 100.0) FILTER (WHERE d.currency = ${cur}) AS weighted
     FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
     WHERE ${dealWhere(p, 'd', q.filters)} AND d.status = 'open'
     GROUP BY 1 ORDER BY 1 NULLS LAST`,
    p.values,
  );
  const thisMonth = new Date(truncate(Date.now(), 'month')).toISOString().slice(0, 7);
  return result.rows.map(row => ({
    month: row.month, count: Number(row.count), value: money(row.value), weighted: money(row.weighted),
    overdue: row.month != null && row.month < thisMonth,
  }));
}

export async function sales(q: InsightsQuery): Promise<SalesReport> {
  const pipeline = await reportPipeline(q.filters);
  const [info, stageList, revenue, owner, source, campaign, conversion, forecastRows, open, closed] = await Promise.all([
    meta(q),
    pipeline ? stages(q, pipeline.id) : Promise.resolve([]),
    wonRevenueSeries(q),
    winRateBy(q, 'owner'),
    winRateBy(q, 'source'),
    winRateBy(q, 'campaign'),
    pipeline ? stageConversion(q, pipeline.id) : Promise.resolve([]),
    forecast(q),
    openPipeline(q.filters, q.currency),
    closedDeals(q.range, q.filters, q.currency),
  ]);
  const missing = closed.winRate == null ? 'No deals were closed in this period, so there is no win rate.'
    : closed.avgDealSize == null ? 'No deals were won in this period.'
      : !closed.cycleDays ? 'Won deals closed the day they were created, so the cycle length is zero.' : undefined;
  return {
    meta: info,
    pipeline,
    stages: stageList,
    revenue,
    winRate: { owner, source, campaign },
    velocity: {
      openDeals: open.count, winRate: closed.winRate, avgDealSize: closed.avgDealSize, cycleDays: closed.cycleDays,
      perDay: missing ? null : money((open.count * (closed.winRate ?? 0) * (closed.avgDealSize ?? 0)) / (closed.cycleDays ?? 1)),
      unavailable: missing,
    },
    conversion,
    forecast: forecastRows,
  };
}
