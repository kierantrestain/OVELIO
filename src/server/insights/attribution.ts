// Multi-touch attribution. A touchpoint is an event with a campaign for one of the deal's contacts, recorded in the
// lookback window before the deal was created. Each model splits the measured won amount (in minor units, by the
// largest-remainder method) so the credits always add up exactly to the won revenue; deals with no touchpoint are
// reported as unattributed rather than guessed.
import type { AttributionModel, AttributionReport, AttributionRow } from '@/contracts/insights';
import { attributionModels } from '@/contracts/insights';
import { db } from '../db';
import type { InsightsQuery } from './params';
import { Params, dealWhere, eventWhere, iso, leadTypes, meta } from './params';

export const touchpointTypes = [
  'contact.created', 'form.submitted', 'page.viewed', 'page.converted', 'funnel.step_viewed', 'funnel.completed',
  'email.sent', 'email.opened', 'email.clicked', 'email.replied', 'sequence.enrolled', 'flow.enrolled',
];

export const DEFAULT_LOOKBACK_DAYS = 90;

/** The share of credit each touchpoint (in time order) receives under a model. Always sums to 1 for n ≥ 1. */
export function modelWeights(count: number, model: AttributionModel): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  const weights = new Array<number>(count).fill(0);
  if (model === 'first_touch') weights[0] = 1;
  else if (model === 'last_touch') weights[count - 1] = 1;
  else if (model === 'linear') weights.fill(1 / count);
  else if (count === 2) weights.fill(0.5);
  else {
    weights[0] = 0.4;
    weights[count - 1] = 0.4;
    for (let index = 1; index < count - 1; index++) weights[index] = 0.2 / (count - 2);
  }
  return weights;
}

/** Splits an integer total by weights so the parts are integers that sum exactly to the total (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((acc, value) => acc + value, 0);
  const raw = weights.map(weight => (total * weight) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((acc, value) => acc + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; rest > 0; cursor = (cursor + 1) % order.length, rest--) parts[order[cursor].index] += 1;
  return parts;
}

/** Credits each touchpoint's campaign with its share of `total` minor units. */
export function creditCampaigns(campaigns: string[], total: number, model: AttributionModel): Map<string, number> {
  const parts = allocate(total, modelWeights(campaigns.length, model));
  const credit = new Map<string, number>();
  campaigns.forEach((campaign, index) => credit.set(campaign, (credit.get(campaign) ?? 0) + parts[index]));
  return credit;
}

type Touch = { owner: string; campaign_id: string };

/** Won deals closed in the period (in the reporting currency) with their ordered campaign touchpoints. */
export async function wonDealTouches(q: InsightsQuery, lookbackDays: number) {
  const p = new Params();
  const deals = await db.query<{ id: string; name: string; amount: string; campaign_id: string | null; closed_at: Date; contact_name: string }>(
    `SELECT d.id, d.name, d.amount, d.campaign_id, d.closed_at, d.contact_name FROM deals d
     WHERE ${dealWhere(p, 'd', q.filters, ['campaign'])} AND d.status = 'won' AND d.currency = ${p.add(q.currency)}
       AND d.closed_at >= ${p.add(iso(q.range.startAt))} AND d.closed_at < ${p.add(iso(q.range.endAt))}
     ORDER BY d.closed_at DESC`,
    p.values,
  );
  const ids = deals.rows.map(row => row.id);
  const touches = ids.length ? await db.query<Touch>(
    `WITH people AS (
       SELECT d.id AS deal_id, d.created_at, d.contact_id FROM deals d WHERE d.id = ANY($1::uuid[]) AND d.contact_id IS NOT NULL
       UNION SELECT d.id, d.created_at, dc.contact_id FROM deals d JOIN deal_contacts dc ON dc.deal_id = d.id WHERE d.id = ANY($1::uuid[])
     )
     SELECT people.deal_id AS owner, e.campaign_id FROM people
     JOIN events e ON e.contact_id = people.contact_id
     WHERE e.campaign_id IS NOT NULL AND e.type = ANY($2::text[])
       AND e.occurred_at <= people.created_at AND e.occurred_at >= people.created_at - ($3::int * interval '1 day')
     ORDER BY people.deal_id, e.occurred_at, e.id`,
    [ids, touchpointTypes, lookbackDays],
  ) : { rows: [] as Touch[] };
  const byDeal = group(touches.rows);
  return deals.rows.map(row => ({ ...row, amountMinor: Math.round(Number(row.amount) * 100), campaigns: byDeal.get(row.id) ?? [] }));
}

/** Contacts who became leads in the period, each with the campaign touchpoints up to their first lead event. */
export async function leadTouches(q: InsightsQuery, lookbackDays: number) {
  const p = new Params();
  const filters = { ...q.filters, campaignId: undefined };
  const result = await db.query<Touch & { campaign_id: string | null }>(
    `WITH leads AS (
       SELECT e.contact_id, min(e.occurred_at) AS lead_at FROM events e
       WHERE e.type = ANY(${p.add(leadTypes)}::text[]) AND e.contact_id IS NOT NULL
         AND e.occurred_at >= ${p.add(iso(q.range.startAt))} AND e.occurred_at < ${p.add(iso(q.range.endAt))} AND ${eventWhere(p, 'e', filters)}
       GROUP BY e.contact_id
     )
     SELECT leads.contact_id::text AS owner, t.campaign_id FROM leads
     LEFT JOIN events t ON t.contact_id = leads.contact_id AND t.campaign_id IS NOT NULL AND t.type = ANY(${p.add(touchpointTypes)}::text[])
       AND t.occurred_at <= leads.lead_at AND t.occurred_at >= leads.lead_at - (${p.add(lookbackDays)}::int * interval '1 day')
     ORDER BY leads.contact_id, t.occurred_at, t.id`,
    p.values,
  );
  const owners = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = owners.get(row.owner) ?? [];
    if (row.campaign_id) list.push(row.campaign_id);
    owners.set(row.owner, list);
  }
  return owners;
}

function group(rows: Touch[]) {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.owner) ?? [];
    list.push(row.campaign_id);
    map.set(row.owner, list);
  }
  return map;
}

const zero = (): Record<AttributionModel, number> => ({ first_touch: 0, last_touch: 0, linear: 0, position_based: 0 });

export async function attribution(q: InsightsQuery, lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<AttributionReport> {
  const [info, deals, leads] = await Promise.all([meta(q), wonDealTouches(q, lookbackDays), leadTouches(q, lookbackDays)]);
  const revenue = new Map<string, Record<AttributionModel, number>>();
  const dealCredit = new Map<string, Record<AttributionModel, number>>();
  const leadCredit = new Map<string, Record<AttributionModel, number>>();
  const touchCount = new Map<string, number>();
  const add = (target: Map<string, Record<AttributionModel, number>>, campaign: string, model: AttributionModel, value: number) => {
    const row = target.get(campaign) ?? zero();
    row[model] += value;
    target.set(campaign, row);
  };
  let unattributedMinor = 0;
  let unattributedDeals = 0;
  let withDealCampaign = 0;
  let totalMinor = 0;
  for (const deal of deals) {
    totalMinor += deal.amountMinor;
    if (!deal.campaigns.length) {
      unattributedMinor += deal.amountMinor;
      unattributedDeals += 1;
      if (deal.campaign_id) withDealCampaign += 1;
      continue;
    }
    for (const campaign of deal.campaigns) touchCount.set(campaign, (touchCount.get(campaign) ?? 0) + 1);
    for (const { key } of attributionModels) {
      for (const [campaign, minor] of creditCampaigns(deal.campaigns, deal.amountMinor, key)) add(revenue, campaign, key, minor);
      for (const [campaign, share] of creditCampaigns(deal.campaigns, 10_000, key)) add(dealCredit, campaign, key, share);
    }
  }
  let unattributedLeads = 0;
  for (const campaigns of leads.values()) {
    if (!campaigns.length) {
      unattributedLeads += 1;
      continue;
    }
    for (const { key } of attributionModels) {
      for (const [campaign, share] of creditCampaigns(campaigns, 10_000, key)) add(leadCredit, campaign, key, share);
    }
  }
  const ids = [...new Set([...revenue.keys(), ...leadCredit.keys()])];
  const names = ids.length
    ? new Map((await db.query<{ id: string; name: string }>('SELECT id, name FROM marketing_campaigns WHERE id = ANY($1::uuid[])', [ids])).rows.map(row => [row.id, row.name]))
    : new Map<string, string>();
  const scale = (row: Record<AttributionModel, number> | undefined, divisor: number) => {
    const out = zero();
    for (const { key } of attributionModels) out[key] = (row?.[key] ?? 0) / divisor;
    return out;
  };
  const rows: AttributionRow[] = ids
    .filter(id => !q.filters.campaignId || id === q.filters.campaignId)
    .map(id => ({
      campaignId: id,
      name: names.get(id) ?? 'Deleted campaign',
      href: `/marketing/campaigns/${id}`,
      revenue: scale(revenue.get(id), 100),
      deals: scale(dealCredit.get(id), 10_000),
      leads: scale(leadCredit.get(id), 10_000),
      touchpoints: touchCount.get(id) ?? 0,
    }))
    .sort((a, b) => b.revenue.linear - a.revenue.linear || b.leads.linear - a.leads.linear || a.name.localeCompare(b.name));
  return {
    meta: info,
    lookbackDays,
    touchpointTypes,
    totals: { wonRevenue: totalMinor / 100, wonDeals: deals.length, leads: leads.size },
    unattributed: { revenue: unattributedMinor / 100, deals: unattributedDeals, leads: unattributedLeads, dealsWithDealCampaign: withDealCampaign },
    rows,
  };
}

export const lookbackDays = (value: string | null) => {
  const days = Number(value ?? DEFAULT_LOOKBACK_DAYS);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_LOOKBACK_DAYS;
};

