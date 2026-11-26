// Marketing report: leads over time and by campaign, source, form and page; the campaign performance table.
import type { User } from '@/contracts';
import type { BreakdownRow, CampaignRow, MarketingReport } from '@/contracts/insights';
import { db } from '../db';
import { laneNames, shortId } from './labels';
import type { InsightsQuery } from './params';
import { Params, dealWhere, eventWhere, iso, leadTypes, meta, money } from './params';
import { toSeries } from './sales';
import { countLeads } from './summary';

type Group = { key: string | null; label: string | null; value: string };

function leadBase(p: Params, q: InsightsQuery, types = leadTypes) {
  return `e.type = ANY(${p.add(types)}::text[]) AND e.contact_id IS NOT NULL
    AND e.occurred_at >= ${p.add(iso(q.range.startAt))} AND e.occurred_at < ${p.add(iso(q.range.endAt))}
    AND ${eventWhere(p, 'e', q.filters)}`;
}

async function grouped(q: InsightsQuery, key: string, label: string, types = leadTypes, join = ''): Promise<Group[]> {
  const p = new Params();
  const result = await db.query<Group>(
    `SELECT ${key} AS key, max(${label}) AS label, count(DISTINCT e.contact_id) AS value
     FROM events e ${join} WHERE ${leadBase(p, q, types)} GROUP BY 1 ORDER BY 3 DESC, 2 LIMIT 50`,
    p.values,
  );
  return result.rows;
}

async function leadSeries(q: InsightsQuery, range = q.range) {
  const p = new Params();
  const scoped = { ...q, range };
  const result = await db.query<{ bucket: string; value: string; count: string }>(
    `SELECT to_char(date_trunc('${q.interval}', first_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket, count(*) AS value, count(*) AS count
     FROM (SELECT e.contact_id, min(e.occurred_at) AS first_at FROM events e WHERE ${leadBase(p, scoped)} GROUP BY e.contact_id) firsts
     GROUP BY 1`,
    p.values,
  );
  return result.rows;
}

/** One row per campaign: leads, deals and won revenue in the period, with budget-based cost per lead and ROI. */
export async function campaignTable(q: InsightsQuery): Promise<CampaignRow[]> {
  const p = new Params();
  const start = p.add(iso(q.range.startAt));
  const end = p.add(iso(q.range.endAt));
  const cur = p.add(q.currency);
  const types = p.add(leadTypes);
  const leadFilter = { ...q.filters, campaignId: undefined };
  const result = await db.query<{
    id: string; name: string; status: string; starts_on: string | null; ends_on: string | null; utm_campaign: string;
    budget: string | null; currency: string; leads: string; deals: string; won: string; won_value: string | null;
  }>(
    `SELECT c.id, c.name, c.status, c.starts_on, c.ends_on, c.utm_campaign, c.budget, c.currency,
       (SELECT count(DISTINCT e.contact_id) FROM events e WHERE e.campaign_id = c.id AND e.type = ANY(${types}::text[])
          AND e.contact_id IS NOT NULL AND e.occurred_at >= ${start} AND e.occurred_at < ${end} AND ${eventWhere(p, 'e', leadFilter)}) AS leads,
       (SELECT count(*) FROM deals d WHERE d.campaign_id = c.id AND ${dealWhere(p, 'd', q.filters, ['campaign'])}
          AND d.created_at >= ${start} AND d.created_at < ${end}) AS deals,
       (SELECT count(*) FROM deals d WHERE d.campaign_id = c.id AND ${dealWhere(p, 'd', q.filters, ['campaign'])}
          AND d.status = 'won' AND d.closed_at >= ${start} AND d.closed_at < ${end}) AS won,
       (SELECT sum(d.amount) FROM deals d WHERE d.campaign_id = c.id AND ${dealWhere(p, 'd', q.filters, ['campaign'])}
          AND d.status = 'won' AND d.currency = ${cur} AND d.closed_at >= ${start} AND d.closed_at < ${end}) AS won_value
     FROM marketing_campaigns c
     WHERE c.status <> 'archived' ${q.filters.campaignId ? `AND c.id = ${p.add(q.filters.campaignId)}` : ''}
     ORDER BY c.created_at DESC LIMIT 200`,
    p.values,
  );
  return result.rows.map(row => {
    const budget = row.budget == null ? null : money(row.budget);
    const leads = Number(row.leads);
    const wonRevenue = money(row.won_value);
    const sameCurrency = row.currency === q.currency;
    let costPerLeadNote: string | null = null;
    let roiNote: string | null = null;
    if (budget == null || budget === 0) {
      costPerLeadNote = 'No budget is recorded for this campaign.';
      roiNote = 'No budget is recorded for this campaign, so there is no cost to measure a return against.';
    } else if (!sameCurrency) {
      costPerLeadNote = `The budget is in ${row.currency} and revenue is reported in ${q.currency}.`;
      roiNote = costPerLeadNote;
    } else {
      if (!leads) costPerLeadNote = 'No leads in this period.';
      if (!wonRevenue) roiNote = 'No won revenue from this campaign’s deals in this period.';
    }
    return {
      campaignId: row.id, name: row.name, status: row.status, startsOn: row.starts_on, endsOn: row.ends_on, utmCampaign: row.utm_campaign,
      leads, deals: Number(row.deals), wonDeals: Number(row.won), wonRevenue, budget, currency: row.currency,
      costPerLead: costPerLeadNote ? null : money(budget! / leads),
      costPerLeadNote,
      roi: roiNote ? null : Math.round(((wonRevenue - budget!) / budget!) * 10_000) / 10_000,
      roiNote,
      href: `/marketing/campaigns/${row.id}`,
    };
  });
}

export async function marketing(q: InsightsQuery, user: User): Promise<MarketingReport> {
  const [info, total, previous, series, previousSeries, byCampaign, bySource, byForm, byPage, campaigns, formNames, pageNames] = await Promise.all([
    meta(q),
    countLeads(q.range, q.filters),
    q.comparison ? countLeads(q.comparison, q.filters) : Promise.resolve(null),
    leadSeries(q),
    q.comparison ? leadSeries(q, q.comparison) : Promise.resolve(null),
    grouped(q, 'e.campaign_id::text', `coalesce(c.name, 'No campaign')`, leadTypes, 'LEFT JOIN marketing_campaigns c ON c.id = e.campaign_id'),
    grouped(q, `nullif(e.utm->>'source', '')`, `coalesce(nullif(e.utm->>'source', ''), 'Direct or unknown')`),
    grouped(q, 'e.entity_id', `e.properties->>'formName'`, ['form.submitted']),
    grouped(q, `nullif(e.properties->>'pageId', '')`, `coalesce(e.properties->>'pageName', e.properties->>'pageTitle')`, ['form.submitted']),
    campaignTable(q),
    laneNames('sites/forms', user),
    laneNames('sites/pages', user),
  ]);
  const rows = (groups: Group[], label: (row: Group) => string, href: (row: Group) => string | null): BreakdownRow[] =>
    groups.map(row => ({ key: row.key, label: label(row), value: Number(row.value), href: href(row) }));
  return {
    meta: info,
    leads: { total, previous, series: toSeries(q.range, q.interval, series, q.comparison, previousSeries) },
    byCampaign: rows(byCampaign, row => row.label ?? 'No campaign', row => (row.key ? `/marketing/campaigns/${row.key}` : null)),
    bySource: rows(bySource, row => row.label ?? 'Direct or unknown', () => null),
    byForm: rows(byForm, row => (row.key && formNames.get(row.key)) || row.label || (row.key ? `Form ${shortId(row.key)}` : 'Unknown form'), () => '/sites/forms'),
    byPage: rows(byPage, row => (row.key ? pageNames.get(row.key) || row.label || `Page ${shortId(row.key)}` : 'Not on a landing page'), row => (row.key ? '/sites' : null)),
    campaigns,
  };
}
