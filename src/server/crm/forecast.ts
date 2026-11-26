// Sales forecast by expected-close month and by owner. Weighted, best case and committed are estimates from open deals;
// closed won, win rate, average deal size and sales cycle are measured from deals closed in the period.
import { z } from 'zod';
import type { Deal, Forecast, ForecastRow } from '@/contracts/crm';
import { db } from '../db';
import { defaultPipelineId } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { dealSelect, loadPipeline, toDeal, uuid } from './shared';
import type { DealQueryRow } from './shared';

const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use a YYYY-MM month.');

function monthRange(from: string, count: number) {
  const [year, mon] = from.split('-').map(Number);
  const months: { key: string; label: string; start: string; end: string }[] = [];
  for (let index = 0; index < count; index++) {
    const start = new Date(Date.UTC(year, mon - 1 + index, 1));
    const end = new Date(Date.UTC(year, mon + index, 0));
    months.push({
      key: start.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(start),
      start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10),
    });
  }
  return months;
}

const emptyRow = (key: string, label: string): ForecastRow => ({ key, label, weighted: 0, bestCase: 0, committed: 0, closedWon: 0, openCount: 0, wonCount: 0, lostCount: 0 });
const round = (value: number) => Math.round(value * 100) / 100;

export function summarise(deals: Deal[], months: { key: string; label: string; start: string; end: string }[], threshold: number) {
  const byMonth = new Map(months.map(item => [item.key, emptyRow(item.key, item.label)]));
  const byOwner = new Map<string, ForecastRow>();
  const totals = emptyRow('total', 'Total');
  const from = months[0].start;
  const to = months.at(-1)!.end;
  let cycleDays = 0;
  for (const deal of deals) {
    const closedDay = deal.closedAt?.slice(0, 10);
    const bucketDay = deal.status === 'open' ? deal.expectedCloseDate : closedDay;
    if (!bucketDay || bucketDay < from || bucketDay > to) continue;
    const ownerKey = deal.ownerId ?? 'none';
    if (!byOwner.has(ownerKey)) byOwner.set(ownerKey, emptyRow(ownerKey, deal.ownerName || 'Unassigned'));
    for (const row of [byMonth.get(bucketDay.slice(0, 7)), byOwner.get(ownerKey), totals]) {
      if (!row) continue;
      if (deal.status === 'open') {
        row.openCount++;
        row.bestCase += deal.amount;
        row.weighted += deal.weightedAmount;
        if (deal.effectiveProbability >= threshold) row.committed += deal.amount;
      } else if (deal.status === 'won') {
        row.wonCount++;
        row.closedWon += deal.amount;
      } else {
        row.lostCount++;
      }
    }
    if (deal.status === 'won' && deal.closedAt) cycleDays += Math.max(0, (Date.parse(deal.closedAt) - Date.parse(deal.createdAt)) / 86_400_000);
  }
  const fix = (row: ForecastRow) => ({ ...row, weighted: round(row.weighted), bestCase: round(row.bestCase), committed: round(row.committed), closedWon: round(row.closedWon) });
  const closed = totals.wonCount + totals.lostCount;
  return {
    months: [...byMonth.values()].map(fix),
    owners: [...byOwner.values()].map(fix).sort((a, b) => b.weighted + b.closedWon - (a.weighted + a.closedWon)),
    totals: {
      ...fix(totals),
      winRate: closed ? round(totals.wonCount / closed * 100) : null,
      averageDealSize: totals.wonCount ? round(totals.closedWon / totals.wonCount) : null,
      averageCycleDays: totals.wonCount ? Math.round(cycleDays / totals.wonCount) : null,
    },
  };
}

async function forecastDeals(input: { pipelineId: string | null; currency: string; from: string; to: string; ownerId?: string }) {
  const values: unknown[] = [input.currency, input.from, input.to];
  const where = [`d.archived_at IS NULL`, `d.currency = $1`,
    `((d.status = 'open' AND d.expected_close_date BETWEEN $2 AND $3) OR (d.status <> 'open' AND d.closed_at >= $2::date AND d.closed_at < $3::date + 1))`];
  if (input.pipelineId) { values.push(input.pipelineId); where.push(`d.pipeline_id = $${values.length}`); }
  if (input.ownerId) {
    if (input.ownerId === 'none') where.push('d.owner_id IS NULL');
    else { values.push(input.ownerId); where.push(`d.owner_id = $${values.length}`); }
  }
  const rows = await db.query<DealQueryRow>(`${dealSelect} WHERE ${where.join(' AND ')} ORDER BY d.expected_close_date NULLS LAST, d.closed_at DESC LIMIT 5000`, values);
  const now = Date.now();
  return rows.rows.map(row => toDeal(row, now));
}

export async function forecast(query: URLSearchParams): Promise<Forecast> {
  const pipelineParam = query.get('pipelineId');
  const pipelineId = pipelineParam === 'all' ? null : pipelineParam ? uuid.parse(pipelineParam) : await defaultPipelineId();
  const pipeline = pipelineId ? await loadPipeline(pipelineId) : null;
  const currencies = (await db.query<{ currency: string }>('SELECT DISTINCT currency FROM deals WHERE archived_at IS NULL ORDER BY currency')).rows.map(row => row.currency);
  const currency = (query.get('currency') || pipeline?.currency || currencies[0] || 'GBP').toUpperCase();
  const count = z.coerce.number().int().min(1).max(24).parse(query.get('months') ?? 6);
  const start = query.get('from') ? month.parse(query.get('from')) : new Date().toISOString().slice(0, 7);
  const threshold = z.coerce.number().int().min(0).max(100).parse(query.get('threshold') ?? 75);
  const months = monthRange(start, count);
  const deals = await forecastDeals({ pipelineId, currency, from: months[0].start, to: months.at(-1)!.end, ownerId: query.get('ownerId') || undefined });
  return {
    currency, currencies: [...new Set([...currencies, currency])], from: months[0].start, to: months.at(-1)!.end, threshold, pipelineId,
    ...summarise(deals, months, threshold),
  };
}

export const forecastEndpoints: Entry[] = [
  route('GET', /^sales\/forecast$/, async ({ query }) => forecast(query), 'marketer'),
  // Drill-down: the deals behind one forecast cell.
  route('GET', /^sales\/forecast\/deals$/, async ({ query }) => {
    const pipelineParam = query.get('pipelineId');
    const pipelineId = pipelineParam === 'all' || !pipelineParam ? null : uuid.parse(pipelineParam);
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(query.get('from'));
    const to = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(query.get('to'));
    const deals = await forecastDeals({ pipelineId, currency: (query.get('currency') || 'GBP').toUpperCase(), from, to, ownerId: query.get('ownerId') || undefined });
    const kind = query.get('kind');
    return deals.filter(deal => !kind || kind === 'all' || deal.status === kind);
  }, 'marketer'),
];
