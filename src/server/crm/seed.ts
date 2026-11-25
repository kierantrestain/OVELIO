// Developer preview sample data for CRM & Sales: two pipelines, 18 B2B deals tied to the preview contacts and
// companies, tasks (some overdue), activities, owners and one sequence. Plain SQL through the seed client (the
// embedded database is still booting, so records.ts and db.query cannot be used here). Every deal carries
// source 'preview-seed', which the UI labels "Sample data". Idempotent.
import type { DirectoryContact } from '@/contracts/platform';
import type { Sql } from '../db';
import { createCompany, linkContactToCompany, searchCompanies, searchContacts } from '../directory';
import { schedulePlatformJob } from '../platform/jobs';
import { scheduleStep } from './sequences';

const DEV = '00000000-0000-4000-8000-000000000001';
const MAYA = '00000000-0000-4000-8000-000000000002';
const LIAM = '00000000-0000-4000-8000-000000000003';

type SeedDeal = {
  name: string; who: string; pipeline: 'new' | 'renewals'; stage: string; amount: number; owner: string;
  close?: number; closedAgo?: number; createdAgo: number; probability?: number; lostReason?: string;
};

const deals: SeedDeal[] = [
  { name: 'Website rebuild', who: 'claire', pipeline: 'new', stage: 'Proposal', amount: 18500, owner: DEV, close: 21, createdAgo: 30 },
  { name: 'Analytics add-on', who: 'claire', pipeline: 'new', stage: 'Qualified', amount: 6200, owner: MAYA, close: 45, createdAgo: 12 },
  { name: 'Loyalty platform', who: 'daniel', pipeline: 'new', stage: 'Negotiation', amount: 42000, owner: DEV, close: 10, createdAgo: 55, probability: 80 },
  { name: 'In-store screens pilot', who: 'daniel', pipeline: 'new', stage: 'Lead in', amount: 9800, owner: LIAM, close: 80, createdAgo: 4 },
  { name: 'Demand generation retainer', who: 'hannah', pipeline: 'new', stage: 'Qualified', amount: 24000, owner: MAYA, close: 38, createdAgo: 20 },
  { name: 'Marketing automation setup', who: 'hannah', pipeline: 'new', stage: 'Lead in', amount: 7500, owner: MAYA, close: 100, createdAgo: 2 },
  { name: 'Content hub', who: 'sam', pipeline: 'new', stage: 'Proposal', amount: 15000, owner: DEV, close: -6, createdAgo: 40 },
  { name: 'Video production bundle', who: 'sam', pipeline: 'new', stage: 'Negotiation', amount: 28000, owner: MAYA, close: 60, createdAgo: 48 },
  { name: 'Partner portal', who: 'hannah', pipeline: 'new', stage: 'Lead in', amount: 32000, owner: DEV, close: 115, createdAgo: 1 },
  { name: 'Brand refresh', who: 'claire', pipeline: 'new', stage: 'Won', amount: 12400, owner: DEV, closedAgo: 12, createdAgo: 70 },
  { name: 'Email platform migration', who: 'daniel', pipeline: 'new', stage: 'Won', amount: 8900, owner: MAYA, closedAgo: 35, createdAgo: 90 },
  { name: 'SEO audit', who: 'hannah', pipeline: 'new', stage: 'Won', amount: 4500, owner: DEV, closedAgo: 61, createdAgo: 95 },
  { name: 'Social media retainer', who: 'sam', pipeline: 'new', stage: 'Lost', amount: 11000, owner: MAYA, closedAgo: 20, createdAgo: 60, lostReason: 'Chose a cheaper agency' },
  { name: 'Pricing page experiments', who: 'daniel', pipeline: 'new', stage: 'Lost', amount: 3800, owner: DEV, closedAgo: 47, createdAgo: 80, lostReason: 'Budget frozen until next year' },
  { name: 'Annual support renewal', who: 'claire', pipeline: 'renewals', stage: 'Upcoming', amount: 9600, owner: DEV, close: 52, createdAgo: 15 },
  { name: 'Platform licence renewal', who: 'daniel', pipeline: 'renewals', stage: 'Contract sent', amount: 36000, owner: MAYA, close: 14, createdAgo: 33 },
  { name: 'Hosting renewal', who: 'sam', pipeline: 'renewals', stage: 'In discussion', amount: 4800, owner: DEV, close: 27, createdAgo: 18 },
  { name: 'Retainer renewal', who: 'hannah', pipeline: 'renewals', stage: 'Renewed', amount: 18000, owner: MAYA, closedAgo: 8, createdAgo: 45 },
];

const day = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * day - hours * 3_600_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * day).toISOString().slice(0, 10);

async function ensureCompany(name: string, website: string, industry: string, contact?: DirectoryContact) {
  const existing = (await searchCompanies(name, 5)).find(item => item.name === name);
  const company = existing ?? await createCompany({ name, website, industry, country: 'United Kingdom' });
  if (contact) await linkContactToCompany(contact.id, company.id);
  return company;
}

export async function seedCrmPreview(sql: Sql) {
  const seeded = await sql.query(`SELECT 1 FROM deals WHERE source = 'preview-seed' LIMIT 1`);
  if (seeded.rows.length) return;

  const people = new Map<string, DirectoryContact>();
  for (const name of ['claire', 'daniel', 'hannah', 'sam']) {
    const [found] = await searchContacts(name, 1);
    if (found) people.set(name, found);
  }
  const companies = new Map([
    ['claire', await ensureCompany('Northbridge Studio', 'https://northbridge.example', 'Technology', people.get('claire'))],
    ['daniel', await ensureCompany('Harbourline Retail', 'https://harbourline.example', 'Retail', people.get('daniel'))],
    ['hannah', await ensureCompany('Kestrel Digital', 'https://kestrel.example', 'Marketing services', people.get('hannah'))],
    ['sam', await ensureCompany('Bayside Media', 'https://bayside.example', 'Media', people.get('sam'))],
  ]);

  // Pipelines: the default becomes "New business"; "Renewals" is added beside it.
  const main = (await sql.query<{ id: string; currency: string }>(`SELECT id, currency FROM pipelines WHERE is_default LIMIT 1`)).rows[0];
  if (!main) return;
  await sql.query(`UPDATE pipelines SET name = 'New business' WHERE id = $1 AND name = 'Sales pipeline'`, [main.id]);
  const renewals = (await sql.query<{ id: string }>(`INSERT INTO pipelines (name, currency, position, is_default) VALUES ('Renewals', $1, 1, false) RETURNING id`, [main.currency])).rows[0].id;
  const renewalStages: [string, number, string][] = [['Upcoming', 20, 'open'], ['In discussion', 50, 'open'], ['Contract sent', 80, 'open'], ['Renewed', 100, 'won'], ['Churned', 0, 'lost']];
  for (const [index, [name, probability, outcome]] of renewalStages.entries()) {
    await sql.query('INSERT INTO pipeline_stages (pipeline_id, name, position, probability, outcome) VALUES ($1, $2, $3, $4, $5)', [renewals, name, index, probability, outcome]);
  }
  await sql.query(`UPDATE pipeline_stages SET rotting_days = 21 WHERE pipeline_id = $1 AND outcome = 'open'`, [main.id]);
  const stages = (await sql.query<{ id: string; pipeline_id: string; name: string; position: number }>(
    'SELECT id, pipeline_id, name, position FROM pipeline_stages WHERE pipeline_id = ANY($1::uuid[]) ORDER BY position', [[main.id, renewals]])).rows;
  const stageOf = (pipeline: string, name: string) => stages.find(stage => stage.pipeline_id === pipeline && stage.name === name);

  const ids: string[] = [];
  const positions = new Map<string, number>();
  for (const [index, deal] of deals.entries()) {
    const pipelineId = deal.pipeline === 'new' ? main.id : renewals;
    const stage = stageOf(pipelineId, deal.stage);
    const first = stages.find(item => item.pipeline_id === pipelineId);
    if (!stage || !first) continue;
    const contact = people.get(deal.who);
    const company = companies.get(deal.who);
    const status = deal.closedAgo != null ? (deal.lostReason || deal.stage === 'Churned' ? 'lost' : 'won') : 'open';
    const position = positions.get(stage.id) ?? 0;
    positions.set(stage.id, position + 1);
    const created = ago(deal.createdAgo);
    const closedAt = deal.closedAgo != null ? ago(deal.closedAgo) : null;
    const expected = deal.close != null ? ahead(deal.close) : closedAt?.slice(0, 10) ?? null;
    const row = (await sql.query<{ id: string }>(
      `INSERT INTO deals (pipeline_id, stage_id, name, amount, currency, probability, status, owner_id, contact_id, company_id, contact_name, contact_email,
         company_name, source, expected_close_date, closed_at, lost_reason, board_position, custom, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'preview-seed', $14, $15, $16, $17, '{"sample":true}', $8, $18, $18) RETURNING id`,
      [pipelineId, stage.id, `${company?.name ?? 'Sample'} — ${deal.name}`, deal.amount, main.currency, deal.probability ?? null, status, deal.owner,
        contact?.id ?? null, company?.id ?? null, contact?.name ?? '', contact?.email ?? '', company?.name ?? '', expected, closedAt, deal.lostReason ?? '',
        position, created],
    )).rows[0];
    ids.push(row.id);
    await sql.query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, changed_at) VALUES ($1, NULL, $2, $3, $4)', [row.id, first.id, deal.owner, created]);
    if (stage.id !== first.id) {
      const entered = closedAt ?? ago(Math.min(Math.max(deal.createdAgo - 2, 0), 9 + (index % 5) * 4));
      await sql.query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, changed_at) VALUES ($1, $2, $3, $4, $5)', [row.id, first.id, stage.id, deal.owner, entered]);
    }
    await sql.query(
      `INSERT INTO events (type, occurred_at, contact_id, company_id, deal_id, source, actor_id, currency, properties, idempotency_key)
       VALUES ('deal.created', $1, $2, $3, $4, 'preview-seed', $5, $6, $7, $8)`,
      [created, contact?.id ?? null, company?.id ?? null, row.id, deal.owner, main.currency, JSON.stringify({ name: deal.name, stageName: first.name, value: deal.amount }), `preview-seed:created:${index}`],
    );
    if (status !== 'open') {
      await sql.query(
        `INSERT INTO events (type, occurred_at, contact_id, company_id, deal_id, source, actor_id, amount, currency, properties, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'preview-seed', $6, $7, $8, $9, $10)`,
        [status === 'won' ? 'deal.won' : 'deal.lost', closedAt, contact?.id ?? null, company?.id ?? null, row.id, deal.owner,
          status === 'won' ? deal.amount : null, main.currency, JSON.stringify({ name: deal.name, reason: deal.lostReason ?? '' }), `preview-seed:closed:${index}`],
      );
    }
  }

  const contactId = (who: string) => people.get(who)?.id ?? null;
  // Owners for contacts and companies.
  for (const [who, owner] of [['claire', DEV], ['daniel', MAYA], ['hannah', MAYA], ['sam', DEV]] as const) {
    if (people.get(who)) await sql.query(`INSERT INTO record_owners (object, record_id, owner_id) VALUES ('contact', $1, $2) ON CONFLICT DO NOTHING`, [people.get(who)!.id, owner]);
    await sql.query(`INSERT INTO record_owners (object, record_id, owner_id) VALUES ('company', $1, $2) ON CONFLICT DO NOTHING`, [companies.get(who)!.id, owner]);
  }

  // Tasks: two overdue, one due today, the rest upcoming, one done.
  const tasks: [string, string, number, string, number, string | null, string][] = [
    ['Call Daniel about loyalty platform pricing', 'call', -2, DEV, 2, 'daniel', 'high'],
    ['Send the revised content hub proposal', 'email', -1, DEV, 6, 'sam', 'normal'],
    ['Prepare the demand generation demo', 'meeting', 0.15, MAYA, 4, 'hannah', 'normal'],
    ['Follow up on the website rebuild proposal', 'follow_up', 2, DEV, 0, 'claire', 'normal'],
    ['Renewal check-in with Harbourline', 'call', 5, MAYA, 15, 'daniel', 'normal'],
    ['Introduce the analytics add-on to Claire', 'todo', 9, DEV, 1, 'claire', 'low'],
  ];
  for (const [title, type, dueDays, assignee, dealIndex, who, priority] of tasks) {
    const due = new Date(Date.now() + dueDays * day);
    const remind = type === 'follow_up' ? new Date(due.getTime() - 3_600_000) : null;
    const task = (await sql.query<{ id: string }>(
      `INSERT INTO tasks (title, type, priority, due_at, remind_at, assignee_id, created_by, contact_id, deal_id, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, 'manual', $9) RETURNING id`,
      [title, type, priority, due.toISOString(), remind?.toISOString() ?? null, assignee, who ? contactId(who) : null, ids[dealIndex] ?? null, ago(3)],
    )).rows[0];
    if (remind) await schedulePlatformJob('crm.task_reminder', task.id, { taskId: task.id }, { runAt: remind, client: sql });
  }
  await sql.query(
    `INSERT INTO tasks (title, type, status, due_at, completed_at, assignee_id, created_by, contact_id, deal_id, source, created_at)
     VALUES ('Kick-off call for the brand refresh', 'call', 'done', $1, $1, $2, $2, $3, $4, 'manual', $5)`,
    [ago(14), DEV, contactId('claire'), ids[9] ?? null, ago(20)],
  );

  // Activities on deals and contacts.
  const activities: [string, string, string, string, number, string, number, string | null][] = [
    ['call', 'Discovery call', 'Needs a headless CMS and faster page loads before the spring campaign.', 'Interested', 30, 'claire', 26, 'outbound'],
    ['meeting', 'Proposal walkthrough', 'Walked through scope and timeline with Claire and her CTO.', 'Positive', 45, 'claire', 6, null],
    ['note', '', 'Daniel confirmed the loyalty budget is approved for Q1; legal review pending.', '', 0, 'daniel', 3, null],
    ['email', 'Loyalty platform — commercial terms', 'Sent revised commercial terms with a 3-year option.', '', 0, 'daniel', 2, 'outbound'],
    ['call', 'Qualification call', 'Hannah wants to double inbound leads; currently on a basic CRM.', 'Qualified', 25, 'hannah', 15, 'outbound'],
    ['meeting', 'Creative review', 'Sam asked for two more video concepts before committing.', 'Follow-up needed', 60, 'sam', 9, null],
  ];
  const dealFor: Record<string, number> = { claire: 0, daniel: 2, hannah: 4, sam: 7 };
  for (const [type, subject, body, outcome, minutes, who, daysAgo, direction] of activities) {
    await sql.query(
      `INSERT INTO activities (type, subject, body, direction, outcome, duration_minutes, occurred_at, contact_id, company_id, deal_id, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [type, subject, body, direction, outcome, minutes || null, ago(daysAgo, 2), contactId(who), companies.get(who)?.id ?? null, ids[dealFor[who]] ?? null, who === 'hannah' ? MAYA : DEV],
    );
  }

  // One sequence, with Hannah enrolled and its first email already attempted.
  const sequence = (await sql.query<{ id: string }>(
    `INSERT INTO crm_sequences (name, description, created_by) VALUES ('New lead follow-up', 'Three touches over a week for inbound leads.', $1) RETURNING id`, [DEV])).rows[0].id;
  const steps: [string, number, string, string, string, string][] = [
    ['email', 0, 'Thanks for getting in touch, {{contact.first_name | there}}', 'Hi {{contact.first_name | there}},\n\nThanks for your interest. Could we find 20 minutes this week to understand your goals?\n\nBest,\nThe OVELIO team', '', 'todo'],
    ['task', 2, '', '', 'Call to book a discovery meeting', 'call'],
    ['email', 3, 'Any questions, {{contact.first_name | there}}?', 'Hi {{contact.first_name | there}},\n\nJust checking whether you had any questions. Happy to share a short case study from a similar team.\n\nBest,\nThe OVELIO team', '', 'todo'],
  ];
  for (const [position, [kind, delay, subject, body, title, taskType]] of steps.entries()) {
    await sql.query(
      `INSERT INTO crm_sequence_steps (sequence_id, position, kind, delay_days, business_hours, subject, body, task_title, task_type) VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8)`,
      [sequence, position, kind, delay, subject, body, title, taskType],
    );
  }
  const hannah = people.get('hannah');
  if (hannah) {
    const nextRun = new Date(Date.now() + 2 * day);
    const enrolment = (await sql.query<{ id: string }>(
      `INSERT INTO crm_sequence_enrolments (sequence_id, contact_id, contact_email, contact_name, next_position, next_run_at, sender_id, enrolled_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7) RETURNING id`,
      [sequence, hannah.id, hannah.email, hannah.name, nextRun.toISOString(), MAYA, ago(1)])).rows[0].id;
    const reason = 'Not delivered: the developer preview has no email relay. The rendered message is stored here.';
    const message = (await sql.query<{ id: string }>(
      `INSERT INTO messages (category, status, status_reason, to_email, contact_id, from_email, subject, html, text_body, source, created_by, created_at)
       VALUES ('sales', 'not_sent', $1, $2, $3, 'hello@ovelio.test', $4, $5, $6, $7, $8, $9) RETURNING id`,
      [reason, hannah.email, hannah.id, `Thanks for getting in touch, ${hannah.firstName}`, `<p>Hi ${hannah.firstName},</p><p>Thanks for your interest.</p>`,
        `Hi ${hannah.firstName}, thanks for your interest.`, `sequence:${sequence}`, MAYA, ago(1)])).rows[0].id;
    await sql.query(`INSERT INTO crm_sequence_step_runs (enrolment_id, position, kind, status, reason, message_id, ran_at) VALUES ($1, 0, 'email', 'not_sent', $2, $3, $4)`,
      [enrolment, reason, message, ago(1)]);
    await scheduleStep(enrolment, 1, nextRun, sql);
  }
}
