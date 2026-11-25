// The /overview home screen: today's numbers, my tasks, pipeline snapshot, recent leads, campaigns in flight, OVELIO
// email sends and the first-use checklist, all read from the workspace's real records.
import type { User } from '@/contracts';
import type { HomeData, HomeTask, OnboardingStep } from '@/contracts/insights';
import { db } from '../db';
import { getContacts, searchContacts } from '../directory';
import { laneItems } from './labels';
import { DAY, dataset, defaultCurrency, iso, leadTypes, money } from './params';

const published = new Set(['published', 'active', 'live', 'enabled', 'running']);

async function onboarding(user: User): Promise<OnboardingStep[]> {
  const [contacts, counts, pages, flows] = await Promise.all([
    searchContacts('', 1).then(list => list.length > 0, () => null),
    db.query<{ deals: string; emails: string; views: string }>(
      `SELECT (SELECT count(*) FROM deals WHERE archived_at IS NULL) AS deals,
              (SELECT count(*) FROM designs WHERE kind = 'email' AND status <> 'archived') AS emails,
              (SELECT count(*) FROM (SELECT 1 FROM events WHERE type = 'page.viewed' LIMIT 1) seen) AS views`,
    ),
    laneItems('sites/pages', user),
    laneItems('journeys/flows', user),
  ]);
  const row = counts.rows[0];
  const pageDone = pages ? pages.some(item => published.has(String(item.status ?? '').toLowerCase())) : Number(row.views) > 0;
  const flowDone = flows ? flows.some(item => published.has(String(item.status ?? '').toLowerCase())) : false;
  return [
    { key: 'website', label: 'Track your website', description: 'Add the tracking snippet so visits, sources and conversions are measured.', done: null, href: '/analytics/website', action: 'Add website' },
    { key: 'contacts', label: 'Import your contacts', description: 'Bring in a CSV or add people so leads and deals have someone behind them.', done: contacts, href: '/crm?create=contact', action: 'Add contacts' },
    { key: 'deals', label: 'Add deals to your pipeline', description: 'Track opportunities so revenue, win rate and forecast can be measured.', done: Number(row.deals) > 0, href: '/sales?create=deal', action: 'Create a deal' },
    { key: 'email', label: 'Design an email', description: 'Start from a template in the email studio.', done: Number(row.emails) > 0, href: '/marketing/templates?create=email', action: 'Design an email' },
    { key: 'page', label: 'Publish a landing page', description: 'Capture leads with a page and form; submissions appear here as leads.', done: pageDone, href: '/sites?create=page', action: 'Build a page' },
    { key: 'workflow', label: 'Publish a workflow', description: 'Follow up automatically when a form is submitted or a deal moves.', done: flowDone, href: '/automations/templates', action: 'Start a workflow' },
  ];
}

export async function home(user: User): Promise<HomeData> {
  const now = Date.now();
  const todayStart = Math.floor(now / DAY) * DAY;
  const todayEnd = todayStart + DAY;
  const currency = await defaultCurrency();
  const [today, tasks, pipeline, recent, campaigns, emails, steps] = await Promise.all([
    db.query<{ leads: string; leads_yesterday: string; new_deals: string; new_value: string | null; won: string; won_value: string | null; due: string; overdue: string }>(
      `SELECT
         (SELECT count(DISTINCT contact_id) FROM events WHERE type = ANY($1::text[]) AND contact_id IS NOT NULL AND occurred_at >= $2) AS leads,
         (SELECT count(DISTINCT contact_id) FROM events WHERE type = ANY($1::text[]) AND contact_id IS NOT NULL AND occurred_at >= $3 AND occurred_at < $2) AS leads_yesterday,
         (SELECT count(*) FROM deals WHERE archived_at IS NULL AND created_at >= $2) AS new_deals,
         (SELECT sum(amount) FROM deals WHERE archived_at IS NULL AND created_at >= $2 AND currency = $4) AS new_value,
         (SELECT count(*) FROM deals WHERE archived_at IS NULL AND status = 'won' AND closed_at >= $2) AS won,
         (SELECT sum(amount) FROM deals WHERE archived_at IS NULL AND status = 'won' AND closed_at >= $2 AND currency = $4) AS won_value,
         (SELECT count(*) FROM tasks WHERE status = 'open' AND assignee_id = $5 AND due_at >= $2 AND due_at < $6) AS due,
         (SELECT count(*) FROM tasks WHERE status = 'open' AND assignee_id = $5 AND due_at < $2) AS overdue`,
      [leadTypes, iso(todayStart), iso(todayStart - DAY), currency, user.id, iso(todayEnd)],
    ),
    db.query<{ id: string; title: string; type: string; priority: string; due_at: Date; deal_id: string | null; deal_name: string | null; contact_id: string | null }>(
      `SELECT t.id, t.title, t.type, t.priority, t.due_at, t.deal_id, d.name AS deal_name, t.contact_id FROM tasks t
       LEFT JOIN deals d ON d.id = t.deal_id
       WHERE t.status = 'open' AND t.assignee_id = $1 AND t.due_at < $2
       ORDER BY t.due_at < $3 DESC, t.due_at LIMIT 40`,
      [user.id, iso(todayEnd), iso(todayStart)],
    ),
    db.query<{ pipeline: string | null; name: string; count: string; value: string | null; weighted: string | null }>(
      `WITH p AS (SELECT id, name FROM pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, position, created_at LIMIT 1)
       SELECT p.name AS pipeline, s.name, count(d.id) AS count, sum(d.amount) FILTER (WHERE d.currency = $1) AS value,
              sum(d.amount * coalesce(d.probability, s.probability) / 100.0) FILTER (WHERE d.currency = $1) AS weighted
       FROM p JOIN pipeline_stages s ON s.pipeline_id = p.id AND s.outcome = 'open'
       LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open' AND d.archived_at IS NULL
       GROUP BY p.name, s.name, s.position ORDER BY s.position`,
      [currency],
    ),
    db.query<{ contact_id: string; occurred_at: Date; source: string | null; form: string | null; campaign_id: string | null; campaign: string | null }>(
      `SELECT e.contact_id, e.occurred_at, nullif(e.utm->>'source', '') AS source, e.properties->>'formName' AS form, e.campaign_id, c.name AS campaign
       FROM events e LEFT JOIN marketing_campaigns c ON c.id = e.campaign_id
       WHERE e.type = 'form.submitted' AND e.contact_id IS NOT NULL ORDER BY e.occurred_at DESC, e.id DESC LIMIT 8`,
    ),
    db.query<{ id: string; name: string; status: string; ends_on: string | null; leads: string; won_value: string | null }>(
      `SELECT c.id, c.name, c.status, c.ends_on,
         (SELECT count(DISTINCT e.contact_id) FROM events e WHERE e.campaign_id = c.id AND e.type = ANY($1::text[]) AND e.occurred_at >= $2) AS leads,
         (SELECT sum(d.amount) FROM deals d WHERE d.campaign_id = c.id AND d.status = 'won' AND d.closed_at >= $2 AND d.currency = $3 AND d.archived_at IS NULL) AS won_value
       FROM marketing_campaigns c WHERE c.status = 'active' ORDER BY c.ends_on NULLS LAST, c.created_at DESC LIMIT 6`,
      [leadTypes, iso(todayStart - 29 * DAY), currency],
    ),
    db.query<{ sent: string; previous: string; not_sent: string }>(
      `SELECT count(*) FILTER (WHERE status = 'sent' AND sent_at >= $1) AS sent,
              count(*) FILTER (WHERE status = 'sent' AND sent_at >= $2 AND sent_at < $1) AS previous,
              count(*) FILTER (WHERE status IN ('not_sent', 'blocked', 'failed') AND created_at >= $1) AS not_sent
       FROM messages WHERE category <> 'test' AND created_at >= $2`,
      [iso(now - 7 * DAY), iso(now - 14 * DAY)],
    ),
    onboarding(user),
  ]);
  const contactIds = [...recent.rows.map(row => Number(row.contact_id)), ...tasks.rows.filter(row => !row.deal_id && row.contact_id).map(row => Number(row.contact_id))];
  const people = await getContacts(contactIds).catch(() => new Map());
  const toTask = (row: typeof tasks.rows[number]): HomeTask => {
    const person = row.contact_id ? people.get(Number(row.contact_id)) : undefined;
    return {
      id: row.id, title: row.title, type: row.type, priority: row.priority, dueAt: new Date(row.due_at).toISOString(),
      overdue: new Date(row.due_at).getTime() < now,
      related: row.deal_id ? { label: row.deal_name ?? 'Deal', href: `/sales/deals/${row.deal_id}` }
        : row.contact_id ? { label: person?.name ?? `Contact #${row.contact_id}`, href: `/crm/contacts/${row.contact_id}` } : null,
    };
  };
  const overdueRows = tasks.rows.filter(row => new Date(row.due_at).getTime() < todayStart);
  const todayRows = tasks.rows.filter(row => new Date(row.due_at).getTime() >= todayStart);
  const t = today.rows[0];
  return {
    dataset: dataset(),
    currency,
    today: {
      leads: Number(t.leads), leadsYesterday: Number(t.leads_yesterday), newDeals: Number(t.new_deals), newDealValue: money(t.new_value),
      wonRevenue: money(t.won_value), wonDeals: Number(t.won), tasksDue: Number(t.due), tasksOverdue: Number(t.overdue),
    },
    myTasks: { overdue: overdueRows.slice(0, 6).map(toTask), today: todayRows.slice(0, 8).map(toTask), overdueTotal: Number(t.overdue), todayTotal: Number(t.due) },
    pipeline: {
      name: pipeline.rows[0]?.pipeline ?? null,
      openDeals: pipeline.rows.reduce((sum, row) => sum + Number(row.count), 0),
      openValue: money(pipeline.rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0)),
      weighted: money(pipeline.rows.reduce((sum, row) => sum + Number(row.weighted ?? 0), 0)),
      stages: pipeline.rows.map(row => ({ name: row.name, count: Number(row.count), value: money(row.value) })),
    },
    recentLeads: recent.rows.map(row => {
      const person = people.get(Number(row.contact_id));
      return {
        contactId: Number(row.contact_id), name: person?.name ?? `Contact #${row.contact_id}`, email: person?.email ?? '',
        at: new Date(row.occurred_at).toISOString(), source: row.form || row.source || 'Form submission',
        campaign: row.campaign_id && row.campaign ? { id: row.campaign_id, name: row.campaign } : null,
        href: `/crm/contacts/${row.contact_id}`,
      };
    }),
    campaignsInFlight: campaigns.rows.map(row => ({
      id: row.id, name: row.name, status: row.status, endsOn: row.ends_on, leads: Number(row.leads), wonRevenue: money(row.won_value),
      href: `/marketing/campaigns/${row.id}`,
    })),
    ovelioEmails: { sent7d: Number(emails.rows[0]?.sent ?? 0), sentPrevious7d: Number(emails.rows[0]?.previous ?? 0), notSent7d: Number(emails.rows[0]?.not_sent ?? 0) },
    onboarding: steps,
  };
}
