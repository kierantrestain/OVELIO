// KPI summary: every metric is one SQL query over OVELIO records, explained in `definition`.
import type { DateRange } from '@/contracts';
import type { FilterKey, InsightsFilters, InsightsSummary, Metric, SummaryMetricKey } from '@/contracts/insights';
import { db } from '../db';
import type { InsightsQuery } from './params';
import { Params, dealWhere, eventWhere, iso, leadIgnored, leadTypes, meta, money, ratio } from './params';

type PeriodValues = {
  leads: number; newDeals: number; newDealValue: number; wonDeals: number; lostDeals: number; wonRevenue: number;
  winRate: number | null; avgDealSize: number | null; avgSalesCycleDays: number | null; emailsSent: number;
};

export async function countLeads(range: DateRange, filters: InsightsFilters): Promise<number> {
  const p = new Params();
  const result = await db.query<{ count: string }>(
    `SELECT count(DISTINCT e.contact_id) AS count FROM events e
     WHERE e.type = ANY(${p.add(leadTypes)}::text[]) AND e.contact_id IS NOT NULL
       AND e.occurred_at >= ${p.add(iso(range.startAt))} AND e.occurred_at < ${p.add(iso(range.endAt))}
       AND ${eventWhere(p, 'e', filters)}`,
    p.values,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function closedDeals(range: DateRange, filters: InsightsFilters, currency: string) {
  const p = new Params();
  const cur = p.add(currency);
  const result = await db.query<{ won: string; lost: string; won_value: string | null; won_counted: string; cycle: string | null }>(
    `SELECT count(*) FILTER (WHERE d.status = 'won') AS won,
            count(*) FILTER (WHERE d.status = 'lost') AS lost,
            sum(d.amount) FILTER (WHERE d.status = 'won' AND d.currency = ${cur}) AS won_value,
            count(*) FILTER (WHERE d.status = 'won' AND d.currency = ${cur}) AS won_counted,
            avg(extract(epoch FROM d.closed_at - d.created_at) / 86400.0) FILTER (WHERE d.status = 'won') AS cycle
     FROM deals d
     WHERE ${dealWhere(p, 'd', filters)} AND d.status IN ('won', 'lost')
       AND d.closed_at >= ${p.add(iso(range.startAt))} AND d.closed_at < ${p.add(iso(range.endAt))}`,
    p.values,
  );
  const row = result.rows[0];
  const won = Number(row?.won ?? 0);
  const lost = Number(row?.lost ?? 0);
  const wonRevenue = money(row?.won_value);
  const counted = Number(row?.won_counted ?? 0);
  return {
    won, lost, wonRevenue,
    winRate: ratio(won, won + lost),
    avgDealSize: counted ? money(wonRevenue / counted) : null,
    cycleDays: row?.cycle == null ? null : Math.round(Number(row.cycle) * 10) / 10,
  };
}

export async function openPipeline(filters: InsightsFilters, currency: string) {
  const p = new Params();
  const cur = p.add(currency);
  const result = await db.query<{ count: string; value: string | null; weighted: string | null }>(
    `SELECT count(*) AS count,
            sum(d.amount) FILTER (WHERE d.currency = ${cur}) AS value,
            sum(d.amount * coalesce(d.probability, s.probability) / 100.0) FILTER (WHERE d.currency = ${cur}) AS weighted
     FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
     WHERE ${dealWhere(p, 'd', filters)} AND d.status = 'open'`,
    p.values,
  );
  const row = result.rows[0];
  return { count: Number(row?.count ?? 0), value: money(row?.value), weighted: money(row?.weighted) };
}

async function period(range: DateRange, filters: InsightsFilters, currency: string): Promise<PeriodValues> {
  const created = new Params();
  const createdCur = created.add(currency);
  const messages = new Params();
  const messageWhere = [`m.status = 'sent'`, `m.category <> 'test'`, 'm.mailbox_id IS NULL',
    `m.sent_at >= ${messages.add(iso(range.startAt))}`, `m.sent_at < ${messages.add(iso(range.endAt))}`];
  if (filters.campaignId) messageWhere.push(`m.campaign_id = ${messages.add(filters.campaignId)}`);
  if (filters.ownerId) messageWhere.push(`m.created_by = ${messages.add(filters.ownerId)}`);
  const [leads, newDeals, closed, sent] = await Promise.all([
    countLeads(range, filters),
    db.query<{ count: string; value: string | null }>(
      `SELECT count(*) AS count, sum(d.amount) FILTER (WHERE d.currency = ${createdCur}) AS value FROM deals d
       WHERE ${dealWhere(created, 'd', filters)} AND d.created_at >= ${created.add(iso(range.startAt))} AND d.created_at < ${created.add(iso(range.endAt))}`,
      created.values,
    ),
    closedDeals(range, filters, currency),
    db.query<{ count: string }>(`SELECT count(*) AS count FROM messages m WHERE ${messageWhere.join(' AND ')}`, messages.values),
  ]);
  return {
    leads,
    newDeals: Number(newDeals.rows[0]?.count ?? 0),
    newDealValue: money(newDeals.rows[0]?.value),
    wonDeals: closed.won,
    lostDeals: closed.lost,
    wonRevenue: closed.wonRevenue,
    winRate: closed.winRate,
    avgDealSize: closed.avgDealSize,
    avgSalesCycleDays: closed.cycleDays,
    emailsSent: Number(sent.rows[0]?.count ?? 0),
  };
}

async function overdueTasks(filters: InsightsFilters) {
  const p = new Params();
  const where = [`t.status = 'open'`, 't.due_at < now()'];
  if (filters.ownerId) where.push(`t.assignee_id = ${p.add(filters.ownerId)}`);
  const result = await db.query<{ count: string }>(`SELECT count(*) AS count FROM tasks t WHERE ${where.join(' AND ')}`, p.values);
  return Number(result.rows[0]?.count ?? 0);
}

const dealFilters: FilterKey[] = [];

export async function summary(q: InsightsQuery): Promise<InsightsSummary> {
  const [info, current, previous, open, overdue] = await Promise.all([
    meta(q),
    period(q.range, q.filters, q.currency),
    q.comparison ? period(q.comparison, q.filters, q.currency) : Promise.resolve(null),
    openPipeline(q.filters, q.currency),
    overdueTasks(q.filters),
  ]);
  const f = q.filters;
  const ignored = (keys: FilterKey[]) => keys.filter(key => (key === 'pipeline' && f.pipelineId) || (key === 'owner' && f.ownerId)
    || (key === 'campaign' && f.campaignId) || (key === 'source' && f.source));
  const cur = q.currency;
  const metric = (key: SummaryMetricKey, value: Omit<Metric, 'key' | 'previous'> & { previous?: number | null }): Metric => ({
    key, previous: null, ...value,
  });
  const prev = <K extends keyof PeriodValues>(name: K) => (previous ? previous[name] : null);
  const metrics: Record<SummaryMetricKey, Metric> = {
    leads: metric('leads', {
      label: 'Leads', value: current.leads, previous: prev('leads'), unit: 'count', provenance: 'measured', betterWhen: 'up',
      definition: 'Distinct contacts with a form submission or a contact-created event in the period. The campaign filter matches the campaign on the event, the source filter its UTM source, and the owner filter the contact owner.',
      ignoredFilters: leadIgnored(f), drill: { metric: 'leads' },
    }),
    newDeals: metric('newDeals', {
      label: 'New deals', value: current.newDeals, previous: prev('newDeals'), unit: 'count', provenance: 'measured', betterWhen: 'up',
      definition: 'Deals created in the period (archived deals excluded).', ignoredFilters: dealFilters, drill: { metric: 'new_deals' },
    }),
    newDealValue: metric('newDealValue', {
      label: 'New deal value', value: current.newDealValue, previous: prev('newDealValue'), unit: 'currency', provenance: 'measured', betterWhen: 'up',
      definition: `Sum of the amounts of deals created in the period, in ${cur}.`, ignoredFilters: dealFilters, drill: { metric: 'new_deals' },
    }),
    openPipeline: metric('openPipeline', {
      label: 'Open pipeline', value: open.value, unit: 'currency', provenance: 'snapshot', betterWhen: 'up',
      definition: `Sum of the amounts of every open deal right now, in ${cur} (${open.count} deals). Not tied to the date range.`,
      ignoredFilters: dealFilters, drill: { metric: 'open_deals' },
    }),
    weightedPipeline: metric('weightedPipeline', {
      label: 'Weighted pipeline', value: open.weighted, unit: 'currency', provenance: 'estimate', betterWhen: 'up',
      definition: `Estimate: each open deal's amount × its win probability (the deal's own probability, or its stage's), summed in ${cur}.`,
      ignoredFilters: dealFilters, drill: { metric: 'open_deals' },
    }),
    wonRevenue: metric('wonRevenue', {
      label: 'Won revenue', value: current.wonRevenue, previous: prev('wonRevenue'), unit: 'currency', provenance: 'measured', betterWhen: 'up',
      definition: `Sum of the amounts of deals closed won in the period (by close date), in ${cur}.`, ignoredFilters: dealFilters, drill: { metric: 'won_deals' },
    }),
    wonDeals: metric('wonDeals', {
      label: 'Deals won', value: current.wonDeals, previous: prev('wonDeals'), unit: 'count', provenance: 'measured', betterWhen: 'up',
      definition: 'Deals closed won in the period.', ignoredFilters: dealFilters, drill: { metric: 'won_deals' },
    }),
    lostDeals: metric('lostDeals', {
      label: 'Deals lost', value: current.lostDeals, previous: prev('lostDeals'), unit: 'count', provenance: 'measured', betterWhen: 'down',
      definition: 'Deals closed lost in the period.', ignoredFilters: dealFilters, drill: { metric: 'lost_deals' },
    }),
    winRate: metric('winRate', {
      label: 'Win rate', value: current.winRate, previous: prev('winRate'), unit: 'ratio', provenance: 'measured', betterWhen: 'up',
      definition: 'Won ÷ (won + lost), for deals closed in the period.', ignoredFilters: dealFilters, drill: { metric: 'won_deals' },
      unavailable: current.winRate == null ? 'No deals were closed in this period.' : undefined,
    }),
    avgDealSize: metric('avgDealSize', {
      label: 'Average deal size', value: current.avgDealSize, previous: prev('avgDealSize'), unit: 'currency', provenance: 'measured', betterWhen: 'up',
      definition: `Won revenue ÷ deals won in ${cur}, for deals closed won in the period.`, ignoredFilters: dealFilters, drill: { metric: 'won_deals' },
      unavailable: current.avgDealSize == null ? 'No deals were won in this period.' : undefined,
    }),
    avgSalesCycleDays: metric('avgSalesCycleDays', {
      label: 'Average sales cycle', value: current.avgSalesCycleDays, previous: prev('avgSalesCycleDays'), unit: 'days', provenance: 'measured', betterWhen: 'down',
      definition: 'Average days from a deal being created to being closed won, for deals won in the period.', ignoredFilters: dealFilters,
      drill: { metric: 'won_deals' }, unavailable: current.avgSalesCycleDays == null ? 'No deals were won in this period.' : undefined,
    }),
    emailsSent: metric('emailsSent', {
      label: 'Emails sent by OVELIO', value: current.emailsSent, previous: prev('emailsSent'), unit: 'count', provenance: 'measured', betterWhen: 'neutral',
      definition: 'Sales, sequence, automation and transactional emails OVELIO delivered through its mail gateway in the period (test sends and newsletters excluded; newsletters are reported by the email engine). Owner matches the sender.',
      ignoredFilters: ignored(['pipeline', 'source']), drill: { metric: 'emails_sent' },
    }),
    tasksOverdue: metric('tasksOverdue', {
      label: 'Overdue tasks', value: overdue, unit: 'count', provenance: 'snapshot', betterWhen: 'down',
      definition: 'Open tasks whose due time has passed, right now. Owner matches the assignee. Not tied to the date range.',
      ignoredFilters: ignored(['pipeline', 'campaign', 'source']), drill: { metric: 'overdue_tasks' },
    }),
  };
  for (const key of ['newDeals', 'newDealValue', 'openPipeline', 'weightedPipeline', 'wonRevenue', 'wonDeals', 'lostDeals', 'winRate', 'avgDealSize', 'avgSalesCycleDays'] as const) {
    metrics[key].ignoredFilters = [];
  }
  return { meta: info, metrics };
}
