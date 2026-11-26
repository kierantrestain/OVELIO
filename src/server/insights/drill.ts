// Drill-down: the deals, contacts, tasks, emails or visitors behind a number, with links to each record.
import { z } from 'zod';
import type { DrillMetric, DrillParams, DrillResult, InsightsFilters } from '@/contracts/insights';
import { db } from '../db';
import { getContacts } from '../directory';
import { lookbackDays, wonDealTouches } from './attribution';
import type { InsightsQuery } from './params';
import { Params, dealWhere, eventWhere, iso, leadTypes, money } from './params';

export const PAGE_SIZE = 25;

const metrics: DrillMetric[] = ['leads', 'new_deals', 'open_deals', 'won_deals', 'lost_deals', 'emails_sent', 'overdue_tasks',
  'attributed_deals', 'unattributed_deals', 'funnel_step', 'page_views'];

export function parseDrill(query: URLSearchParams): DrillParams & { page: number } {
  const text = (name: string) => z.string().trim().max(120).optional().parse(query.get(name) || undefined);
  return {
    metric: z.enum(metrics as [DrillMetric, ...DrillMetric[]]).parse(query.get('metric')),
    stageId: query.get('stageId') ? z.uuid().parse(query.get('stageId')) : undefined,
    closeMonth: query.get('closeMonth') ? z.string().regex(/^(\d{4}-\d{2}|none)$/).parse(query.get('closeMonth')) : undefined,
    formId: text('formId'),
    pageId: text('pageId'),
    funnelId: text('funnelId'),
    step: query.has('step') ? z.coerce.number().int().min(-1).max(999).parse(query.get('step')) : undefined,
    campaign: query.get('campaign') ? z.union([z.literal('none'), z.uuid()]).parse(query.get('campaign')) : undefined,
    source: text('source'),
    owner: query.get('owner') ? z.union([z.literal('none'), z.uuid()]).parse(query.get('owner')) : undefined,
    page: z.coerce.number().int().min(1).max(10_000).parse(query.get('page') ?? 1),
  };
}

/** Applies the drill's own campaign, source and owner narrowing over the page filters. */
function narrowed(filters: InsightsFilters, drill: DrillParams) {
  const next = { ...filters };
  const extra: string[] = [];
  if (drill.campaign === 'none') { next.campaignId = undefined; extra.push('campaign_none'); } else if (drill.campaign) next.campaignId = drill.campaign;
  if (drill.source === '(none)') { next.source = undefined; extra.push('source_none'); } else if (drill.source) next.source = drill.source;
  if (drill.owner === 'none') { next.ownerId = undefined; extra.push('owner_none'); } else if (drill.owner) next.ownerId = drill.owner;
  return { filters: next, extra };
}

const contactHref = (id: number | string | null) => (id ? `/crm/contacts/${id}` : null);
const fmtDate = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

async function deals(q: InsightsQuery, drill: DrillParams, page: number): Promise<DrillResult> {
  const { filters, extra } = narrowed(q.filters, drill);
  const p = new Params();
  const where = [dealWhere(p, 'd', filters)];
  if (extra.includes('campaign_none')) where.push('d.campaign_id IS NULL');
  if (extra.includes('source_none')) where.push(`d.source = ''`);
  if (extra.includes('owner_none')) where.push('d.owner_id IS NULL');
  if (drill.stageId) where.push(`d.stage_id = ${p.add(drill.stageId)}`);
  const start = () => p.add(iso(q.range.startAt));
  const end = () => p.add(iso(q.range.endAt));
  let title = 'Deals';
  let definition = '';
  let order = 'd.created_at DESC';
  if (drill.metric === 'new_deals') {
    where.push(`d.created_at >= ${start()} AND d.created_at < ${end()}`);
    title = 'Deals created';
    definition = 'Deals created in the period.';
  } else if (drill.metric === 'open_deals') {
    where.push(`d.status = 'open'`);
    if (drill.closeMonth === 'none') where.push('d.expected_close_date IS NULL');
    else if (drill.closeMonth) where.push(`to_char(d.expected_close_date, 'YYYY-MM') = ${p.add(drill.closeMonth)}`);
    title = 'Open deals';
    definition = 'Deals open right now' + (drill.closeMonth ? ', by expected close month.' : '.');
    order = 'd.amount DESC';
  } else {
    const status = drill.metric === 'lost_deals' ? 'lost' : 'won';
    where.push(`d.status = '${status}' AND d.closed_at >= ${start()} AND d.closed_at < ${end()}`);
    title = status === 'won' ? 'Deals won' : 'Deals lost';
    definition = `Deals closed ${status} in the period.`;
    order = 'd.closed_at DESC';
  }
  const limit = p.add(PAGE_SIZE);
  const offset = p.add((page - 1) * PAGE_SIZE);
  const result = await db.query<{
    id: string; name: string; amount: string; currency: string; status: string; contact_name: string; company_name: string;
    stage: string; owner: string | null; created_at: Date; closed_at: Date | null; expected_close_date: string | null; total: string;
  }>(
    `SELECT d.id, d.name, d.amount, d.currency, d.status, d.contact_name, d.company_name, s.name AS stage, u.name AS owner,
            d.created_at, d.closed_at, d.expected_close_date, count(*) OVER () AS total
     FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id LEFT JOIN users u ON u.id = d.owner_id
     WHERE ${where.join(' AND ')} ORDER BY ${order}, d.id LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );
  return {
    title, definition, kind: 'deals', currency: q.currency, page, limit: PAGE_SIZE,
    total: Number(result.rows[0]?.total ?? 0),
    rows: result.rows.map(row => ({
      id: row.id,
      title: row.name,
      subtitle: [row.stage, row.contact_name || row.company_name, row.owner ? `Owner ${row.owner}` : 'Unassigned', row.currency !== q.currency ? row.currency : '']
        .filter(Boolean).join(' · '),
      href: `/sales/deals/${row.id}`,
      date: fmtDate(drill.metric === 'open_deals' ? row.expected_close_date : row.closed_at ?? row.created_at),
      amount: money(row.amount),
      status: row.status,
    })),
  };
}

async function leads(q: InsightsQuery, drill: DrillParams, page: number): Promise<DrillResult> {
  const { filters, extra } = narrowed(q.filters, drill);
  const p = new Params();
  const where = [`e.type = ANY(${p.add(drill.formId || drill.pageId ? ['form.submitted'] : leadTypes)}::text[])`, 'e.contact_id IS NOT NULL',
    `e.occurred_at >= ${p.add(iso(q.range.startAt))}`, `e.occurred_at < ${p.add(iso(q.range.endAt))}`, eventWhere(p, 'e', filters)];
  if (extra.includes('campaign_none')) where.push('e.campaign_id IS NULL');
  if (extra.includes('source_none')) where.push(`coalesce(e.utm->>'source', '') = ''`);
  if (drill.formId) where.push(`e.entity_id = ${p.add(drill.formId)}`);
  if (drill.pageId) where.push(`e.properties->>'pageId' = ${p.add(drill.pageId)}`);
  const result = await db.query<{ contact_id: string; first_at: Date; form: string | null; campaign: string | null; source: string | null; total: string }>(
    `SELECT e.contact_id, min(e.occurred_at) AS first_at, max(e.properties->>'formName') AS form, max(c.name) AS campaign,
            max(nullif(e.utm->>'source', '')) AS source, count(*) OVER () AS total
     FROM events e LEFT JOIN marketing_campaigns c ON c.id = e.campaign_id
     WHERE ${where.join(' AND ')} GROUP BY e.contact_id ORDER BY 2 DESC, 1 LIMIT ${p.add(PAGE_SIZE)} OFFSET ${p.add((page - 1) * PAGE_SIZE)}`,
    p.values,
  );
  const people = await getContacts(result.rows.map(row => Number(row.contact_id))).catch(() => new Map());
  return {
    title: 'Leads', kind: 'contacts', currency: q.currency, page, limit: PAGE_SIZE, total: Number(result.rows[0]?.total ?? 0),
    definition: 'Contacts with a form submission or contact-created event in the period, with their first lead date.',
    rows: result.rows.map(row => {
      const person = people.get(Number(row.contact_id));
      return {
        id: row.contact_id,
        title: person?.name ?? `Contact #${row.contact_id}`,
        subtitle: [person?.email ?? 'Not found in the contact directory', row.form, row.campaign, row.source].filter(Boolean).join(' · '),
        href: contactHref(row.contact_id),
        date: fmtDate(row.first_at), amount: null, status: null,
      };
    }),
  };
}

async function messages(q: InsightsQuery, drill: DrillParams, page: number): Promise<DrillResult> {
  const { filters } = narrowed(q.filters, drill);
  const p = new Params();
  const where = [`m.status = 'sent'`, `m.category <> 'test'`, `m.sent_at >= ${p.add(iso(q.range.startAt))}`, `m.sent_at < ${p.add(iso(q.range.endAt))}`];
  if (filters.campaignId) where.push(`m.campaign_id = ${p.add(filters.campaignId)}`);
  if (filters.ownerId) where.push(`m.created_by = ${p.add(filters.ownerId)}`);
  const result = await db.query<{ id: string; subject: string; to_email: string; contact_id: string | null; category: string; sent_at: Date; total: string }>(
    `SELECT m.id, m.subject, m.to_email, m.contact_id, m.category, m.sent_at, count(*) OVER () AS total FROM messages m
     WHERE ${where.join(' AND ')} ORDER BY m.sent_at DESC LIMIT ${p.add(PAGE_SIZE)} OFFSET ${p.add((page - 1) * PAGE_SIZE)}`,
    p.values,
  );
  return {
    title: 'Emails sent by OVELIO', kind: 'messages', currency: q.currency, page, limit: PAGE_SIZE, total: Number(result.rows[0]?.total ?? 0),
    definition: 'Emails OVELIO delivered through its mail gateway in the period (test sends excluded).',
    rows: result.rows.map(row => ({
      id: row.id, title: row.subject, subtitle: `${row.to_email} · ${row.category}`, href: contactHref(row.contact_id),
      date: fmtDate(row.sent_at), amount: null, status: 'sent',
    })),
  };
}

async function tasks(q: InsightsQuery, drill: DrillParams, page: number): Promise<DrillResult> {
  const { filters } = narrowed(q.filters, drill);
  const p = new Params();
  const where = [`t.status = 'open'`, 't.due_at < now()'];
  if (filters.ownerId) where.push(`t.assignee_id = ${p.add(filters.ownerId)}`);
  const result = await db.query<{ id: string; title: string; type: string; due_at: Date; assignee: string | null; deal_id: string | null; contact_id: string | null; total: string }>(
    `SELECT t.id, t.title, t.type, t.due_at, u.name AS assignee, t.deal_id, t.contact_id, count(*) OVER () AS total
     FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE ${where.join(' AND ')} ORDER BY t.due_at LIMIT ${p.add(PAGE_SIZE)} OFFSET ${p.add((page - 1) * PAGE_SIZE)}`,
    p.values,
  );
  return {
    title: 'Overdue tasks', kind: 'tasks', currency: q.currency, page, limit: PAGE_SIZE, total: Number(result.rows[0]?.total ?? 0),
    definition: 'Open tasks whose due time has passed.',
    rows: result.rows.map(row => ({
      id: row.id, title: row.title, subtitle: [row.type.replace('_', ' '), row.assignee ?? 'Unassigned'].join(' · '),
      href: row.deal_id ? `/sales/deals/${row.deal_id}` : row.contact_id ? contactHref(row.contact_id) : '/sales/tasks',
      date: fmtDate(row.due_at), amount: null, status: 'overdue',
    })),
  };
}

async function attributed(q: InsightsQuery, drill: DrillParams, page: number, lookback: number): Promise<DrillResult> {
  const all = await wonDealTouches(q, lookback);
  const matching = drill.metric === 'unattributed_deals'
    ? all.filter(deal => !deal.campaigns.length)
    : all.filter(deal => deal.campaigns.length && (!drill.campaign || deal.campaigns.includes(drill.campaign)));
  const slice = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return {
    title: drill.metric === 'unattributed_deals' ? 'Unattributed won deals' : 'Attributed won deals',
    kind: 'deals', currency: q.currency, page, limit: PAGE_SIZE, total: matching.length,
    definition: drill.metric === 'unattributed_deals'
      ? `Won deals in the period with no campaign touchpoint in the ${lookback} days before the deal was created.`
      : `Won deals in the period with at least one touchpoint from the campaign in the ${lookback} days before the deal was created.`,
    rows: slice.map(deal => ({
      id: deal.id, title: deal.name,
      subtitle: [deal.contact_name, `${deal.campaigns.length} touchpoint${deal.campaigns.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      href: `/sales/deals/${deal.id}`, date: fmtDate(deal.closed_at), amount: deal.amountMinor / 100, status: 'won',
    })),
  };
}

async function visitors(q: InsightsQuery, drill: DrillParams, page: number): Promise<DrillResult> {
  const p = new Params();
  const where = [`e.occurred_at >= ${p.add(iso(q.range.startAt))}`, `e.occurred_at < ${p.add(iso(q.range.endAt))}`, eventWhere(p, 'e', q.filters)];
  let title = 'Page viewers';
  let definition = 'Visitors who viewed the page in the period.';
  if (drill.metric === 'funnel_step') {
    where.push(`e.entity_type = 'funnel' AND e.entity_id = ${p.add(drill.funnelId ?? '')}`);
    if (drill.step === -1) where.push(`e.type = 'funnel.completed'`);
    else where.push(`e.type = 'funnel.step_viewed' AND coalesce(e.properties->>'stepIndex', '0') = ${p.add(String(drill.step ?? 0))}`);
    title = drill.step === -1 ? 'Visitors who completed the funnel' : `Visitors who viewed step ${(drill.step ?? 0) + 1}`;
    definition = 'Every visitor with this funnel event in the period (the funnel chart counts a step only when it followed the previous step).';
  } else {
    where.push(`e.type = 'page.viewed' AND e.entity_type = 'page' AND e.entity_id = ${p.add(drill.pageId ?? '')}`);
  }
  const result = await db.query<{ who: string; contact_id: string | null; first_at: Date; total: string }>(
    `SELECT coalesce(e.visitor_id, 'contact:' || e.contact_id::text) AS who, max(e.contact_id) AS contact_id, min(e.occurred_at) AS first_at,
            count(*) OVER () AS total
     FROM events e WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY 3 DESC LIMIT ${p.add(PAGE_SIZE)} OFFSET ${p.add((page - 1) * PAGE_SIZE)}`,
    p.values,
  );
  const people = await getContacts(result.rows.filter(row => row.contact_id).map(row => Number(row.contact_id))).catch(() => new Map());
  return {
    title, definition, kind: 'events', currency: q.currency, page, limit: PAGE_SIZE, total: Number(result.rows[0]?.total ?? 0),
    rows: result.rows.map(row => {
      const person = row.contact_id ? people.get(Number(row.contact_id)) : undefined;
      return {
        id: row.who, title: person?.name ?? (row.contact_id ? `Contact #${row.contact_id}` : 'Anonymous visitor'),
        subtitle: person?.email ?? `Visitor ${row.who.slice(0, 12)}`, href: contactHref(row.contact_id), date: fmtDate(row.first_at), amount: null, status: null,
      };
    }),
  };
}

export async function drill(q: InsightsQuery, params: DrillParams & { page: number }, query: URLSearchParams): Promise<DrillResult> {
  switch (params.metric) {
    case 'leads': return leads(q, params, params.page);
    case 'emails_sent': return messages(q, params, params.page);
    case 'overdue_tasks': return tasks(q, params, params.page);
    case 'attributed_deals':
    case 'unattributed_deals': return attributed(q, params, params.page, lookbackDays(query.get('lookbackDays')));
    case 'funnel_step':
    case 'page_views': return visitors(q, params, params.page);
    default: return deals(q, params, params.page);
  }
}

