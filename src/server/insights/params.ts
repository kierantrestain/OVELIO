// Request parsing and SQL building blocks shared by every insights report.
import { z } from 'zod';
import type { DateRange } from '@/contracts';
import type { ComparisonMode, Dataset, FilterKey, InsightsFilters, InsightsMeta, Interval } from '@/contracts/insights';
import { AppError } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { isDevPreviewMode } from '../dev-preview';

export const DAY = 86_400_000;
const MAX_RANGE_DAYS = 731;

export type InsightsQuery = {
  range: DateRange;
  compare: ComparisonMode;
  comparison: DateRange | null;
  filters: InsightsFilters;
  currency: string;
  interval: Interval;
};

const uuid = z.uuid();
const optionalUuid = (value: string | null) => (value ? uuid.parse(value) : undefined);

/** The period that is compared with `range`: the one just before it, or the same dates a year earlier. */
export function comparisonRange(range: DateRange, mode: ComparisonMode): DateRange | null {
  if (mode === 'none') return null;
  if (mode === 'previous') return { startAt: range.startAt - (range.endAt - range.startAt), endAt: range.startAt };
  const shift = (value: number) => {
    const date = new Date(value);
    date.setUTCFullYear(date.getUTCFullYear() - 1);
    return date.getTime();
  };
  return { startAt: shift(range.startAt), endAt: shift(range.endAt) };
}

/** Day buckets up to a month, weeks up to six months, months beyond. */
export function autoInterval(range: DateRange): Interval {
  const days = (range.endAt - range.startAt) / DAY;
  if (days <= 31) return 'day';
  if (days <= 186) return 'week';
  return 'month';
}

export function defaultInsightsRange(now = Date.now()): DateRange {
  return { startAt: Math.floor(now / DAY) * DAY - 29 * DAY, endAt: now };
}

export async function defaultCurrency(client: Sql = db, pipelineId?: string): Promise<string> {
  const result = await client.query<{ currency: string }>(
    `SELECT currency FROM pipelines WHERE archived_at IS NULL AND ($1::uuid IS NULL OR id = $1::uuid)
     ORDER BY is_default DESC, position, created_at LIMIT 1`, [pipelineId ?? null],
  );
  return result.rows[0]?.currency ?? 'GBP';
}

export async function parseInsightsQuery(query: URLSearchParams): Promise<InsightsQuery> {
  const timestamp = z.coerce.number().int().min(0);
  let range = defaultInsightsRange();
  if (query.has('startAt') || query.has('endAt')) {
    range = { startAt: timestamp.parse(query.get('startAt')), endAt: timestamp.parse(query.get('endAt')) };
    if (range.endAt <= range.startAt) throw new AppError(400, 'Choose an end date after the start date.');
    if (range.endAt - range.startAt > MAX_RANGE_DAYS * DAY) throw new AppError(400, 'Choose a date range of up to two years.');
  }
  const compare = z.enum(['none', 'previous', 'year']).parse(query.get('compare') ?? 'none');
  const source = query.get('source')?.trim();
  const filters: InsightsFilters = {
    pipelineId: optionalUuid(query.get('pipelineId')),
    ownerId: optionalUuid(query.get('ownerId')),
    campaignId: optionalUuid(query.get('campaignId')),
    source: source ? z.string().max(120).parse(source) : undefined,
  };
  const currencyParam = query.get('currency')?.trim().toUpperCase();
  const currency = currencyParam ? z.string().regex(/^[A-Z]{3}$/).parse(currencyParam) : await defaultCurrency(db, filters.pipelineId);
  const interval = query.has('interval') ? z.enum(['day', 'week', 'month']).parse(query.get('interval')) : autoInterval(range);
  return { range, compare, comparison: comparisonRange(range, compare), filters, currency, interval };
}

export function dataset(): Dataset {
  return isDevPreviewMode() ? 'preview_sample' : 'live';
}

/** Counts deals the money totals leave out because they are in another currency. */
export async function meta(q: InsightsQuery): Promise<InsightsMeta> {
  const p = new Params();
  const where = dealWhere(p, 'd', q.filters);
  const other = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM deals d WHERE ${where} AND d.currency <> ${p.add(q.currency)}`, p.values,
  );
  return {
    range: q.range,
    comparison: q.comparison && q.compare !== 'none' ? { mode: q.compare, range: q.comparison } : null,
    filters: q.filters,
    currency: q.currency,
    otherCurrencyDeals: Number(other.rows[0]?.count ?? 0),
    dataset: dataset(),
    generatedAt: new Date().toISOString(),
  };
}

/** Positional parameter collector: `p.add(value)` returns `$n`. */
export class Params {
  values: unknown[] = [];
  add(value: unknown) {
    this.values.push(value);
    return '$' + this.values.length;
  }
}

export const iso = (value: number) => new Date(value).toISOString();

/** Deal filters: not archived, plus pipeline, owner, campaign and deal source. */
export function dealWhere(p: Params, alias: string, filters: InsightsFilters, skip: FilterKey[] = []): string {
  const parts = [`${alias}.archived_at IS NULL`];
  if (filters.pipelineId && !skip.includes('pipeline')) parts.push(`${alias}.pipeline_id = ${p.add(filters.pipelineId)}`);
  if (filters.ownerId && !skip.includes('owner')) parts.push(`${alias}.owner_id = ${p.add(filters.ownerId)}`);
  if (filters.campaignId && !skip.includes('campaign')) parts.push(`${alias}.campaign_id = ${p.add(filters.campaignId)}`);
  if (filters.source && !skip.includes('source')) parts.push(`${alias}.source = ${p.add(filters.source)}`);
  return parts.join(' AND ');
}

/** Lead and touchpoint event filters: campaign, UTM source and the contact's record owner. Pipelines do not apply. */
export function eventWhere(p: Params, alias: string, filters: InsightsFilters): string {
  const parts = ['true'];
  if (filters.campaignId) parts.push(`${alias}.campaign_id = ${p.add(filters.campaignId)}`);
  if (filters.source) parts.push(`coalesce(${alias}.utm->>'source', '') = ${p.add(filters.source)}`);
  if (filters.ownerId) {
    parts.push(`EXISTS (SELECT 1 FROM record_owners ro WHERE ro.object = 'contact' AND ro.record_id = ${alias}.contact_id AND ro.owner_id = ${p.add(filters.ownerId)})`);
  }
  return parts.join(' AND ');
}

export const leadTypes = ['form.submitted', 'contact.created'];

/** The filters a lead count cannot honour. */
export function leadIgnored(filters: InsightsFilters): FilterKey[] {
  return filters.pipelineId ? ['pipeline'] : [];
}

/** Bucket starts (UTC) covering the range, aligned like PostgreSQL date_trunc (weeks start on Monday). */
export function bucketStarts(range: DateRange, interval: Interval): number[] {
  const starts: number[] = [];
  let cursor = truncate(range.startAt, interval);
  let guard = 0;
  while (cursor < range.endAt && guard++ < 800) {
    starts.push(cursor);
    cursor = nextBucket(cursor, interval);
  }
  return starts;
}

export function truncate(value: number, interval: Interval): number {
  const date = new Date(value);
  if (interval === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (interval === 'day') return dayStart;
  const weekday = (date.getUTCDay() + 6) % 7;
  return dayStart - weekday * DAY;
}

function nextBucket(value: number, interval: Interval): number {
  if (interval === 'day') return value + DAY;
  if (interval === 'week') return value + 7 * DAY;
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export const money = (value: string | number | null | undefined) => Math.round(Number(value ?? 0) * 100) / 100;

/** Plain-language names for filters a number ignores. */
export const filterNames: Record<FilterKey, string> = { pipeline: 'pipeline', owner: 'owner', campaign: 'campaign', source: 'source' };
