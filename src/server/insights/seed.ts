// Developer preview sample history for analytics (runs after every other lane's seed). It reuses the campaigns,
// forms, pages, funnels, deals and contacts other lanes seeded, and only creates its own labelled samples ("Sample · …")
// when a kind of record is missing. Revenue only ever comes from deal rows: deal.won events carry their deal's amount.
// Events are written directly (not through emitEvent) so sample history never triggers automations.
import type { Sql } from '../db';
import { usesEmbeddedDatabase } from '../db';
import { devPreviewContacts, DEV_PREVIEW_USER } from '../dev-preview';
import { upsertContact } from '../directory';
import { DAY } from './params';

const KEY = 'insights-seed:';

/** Small deterministic PRNG so the sample history is the same on every boot (relative to today). */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Campaign = { id: string; name: string; utm_campaign: string; utm_source: string; utm_medium: string };
type Thing = { id: string; name: string };
type EventRow = {
  type: string; at: number; contactId?: number | null; dealId?: string | null; campaignId?: string | null; entityType?: string | null;
  entityId?: string | null; visitorId?: string | null; amount?: number | null; currency?: string | null;
  utm?: Record<string, string>; properties?: Record<string, unknown>;
};

const people = [
  ['Amara', 'Osei', 'Lumen Freight'], ['Ben', 'Holloway', 'Copperleaf Labs'], ['Chloe', 'Ward', 'Riverside Dental'], ['Dev', 'Raman', 'Atlas Robotics'],
  ['Elena', 'Rossi', 'Verde Interiors'], ['Felix', 'Grant', 'Northwind Analytics'], ['Grace', 'Liu', 'Pinecrest Health'], ['Hamza', 'Iqbal', 'Quayside Legal'],
  ['Isla', 'Murray', 'Brightwater Hotels'], ['Jonas', 'Berg', 'Fjord Software'], ['Kemi', 'Adeyemi', 'Sable Fashion'], ['Leo', 'Fischer', 'Kite Logistics'],
  ['Mia', 'Kowalski', 'Orchid Wellness'], ['Noah', 'Ellison', 'Granite Build'], ['Olivia', 'Shaw', 'Meridian Travel'], ['Priya', 'Nair', 'Lattice Finance'],
  ['Quinn', 'Avery', 'Harbor Coffee'], ['Rosa', 'Mendes', 'Solstice Energy'], ['Sami', 'Haddad', 'Cedar Schools'], ['Tom', 'Whitaker', 'Ironbridge Motors'],
  ['Uma', 'Kapoor', 'Saffron Foods'], ['Victor', 'Lang', 'Alpine Outdoor'], ['Wen', 'Zhou', 'Blue Heron Media'], ['Yara', 'Costa', 'Coral Dental'],
  ['Zoe', 'Fletcher', 'Mosaic Studio'], ['Aiden', 'Park', 'Summit Insurance'], ['Bea', 'Lindqvist', 'Nordlys Design'], ['Caleb', 'Moore', 'Tidewater Marine'],
  ['Dina', 'Farah', 'Oasis Retail'], ['Ethan', 'Cole', 'Redwood Advisory'], ['Freya', 'Hughes', 'Willow Bakery'], ['Gabe', 'Ortiz', 'Pulse Fitness'],
] as const;

async function insertEvents(sql: Sql, rows: EventRow[]) {
  for (let start = 0; start < rows.length; start += 80) {
    const batch = rows.slice(start, start + 80);
    const values: unknown[] = [];
    const tuples = batch.map((row, offset) => {
      const index = start + offset;
      const cells = [row.type, new Date(row.at).toISOString(), row.contactId ?? null, row.dealId ?? null, row.campaignId ?? null,
        row.entityType ?? null, row.entityId ?? null, row.visitorId ?? null, row.amount ?? null, row.currency ?? null,
        JSON.stringify(row.utm ?? {}), JSON.stringify({ ...(row.properties ?? {}), sample: true }), KEY + index];
      const placeholders = cells.map(cell => { values.push(cell); return '$' + values.length; });
      return `(${placeholders[0]}, ${placeholders[1]}::timestamptz, ${placeholders[2]}::bigint, ${placeholders[3]}::uuid, ${placeholders[4]}::uuid, ${placeholders[5]}, ${placeholders[6]},
        ${placeholders[7]}, ${placeholders[8]}::numeric, ${placeholders[9]}, ${placeholders[10]}::jsonb, ${placeholders[11]}::jsonb, 'preview-sample', ${placeholders[12]})`;
    });
    await sql.query(
      `INSERT INTO events (type, occurred_at, contact_id, deal_id, campaign_id, entity_type, entity_id, visitor_id, amount, currency, utm, properties, source, idempotency_key)
       VALUES ${tuples.join(', ')} ON CONFLICT (idempotency_key) DO NOTHING`, values,
    );
  }
}

async function campaignsFor(sql: Sql, now: number): Promise<Campaign[]> {
  const read = () => sql.query<Campaign>(`SELECT id, name, utm_campaign, utm_source, utm_medium FROM marketing_campaigns WHERE status <> 'archived' ORDER BY created_at LIMIT 8`);
  const existing = await read();
  if (existing.rows.length) return existing.rows;
  const day = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10);
  const samples = [
    ['Sample · Spring launch', 'sample-spring-launch', 'newsletter', 'email', 2500, 'active', -110, 20],
    ['Sample · Webinar series', 'sample-webinar-series', 'linkedin', 'social', 1800, 'active', -95, null],
    ['Sample · Partner referrals', 'sample-partner-referrals', 'partner', 'referral', null, 'active', -120, null],
    ['Sample · Paid search', 'sample-paid-search', 'google', 'cpc', 4000, 'completed', -120, -20],
  ] as const;
  for (const [name, slug, source, medium, budget, status, starts, ends] of samples) {
    await sql.query(
      `INSERT INTO marketing_campaigns (name, objective, status, starts_on, ends_on, budget, utm_campaign, utm_source, utm_medium, owner_id)
       VALUES ($1, 'Sample campaign for the developer preview', $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (utm_campaign) DO NOTHING`,
      [name, status, day(starts), ends == null ? null : day(ends), budget, slug, source, medium, DEV_PREVIEW_USER.id],
    );
  }
  return (await read()).rows;
}

async function assetsOf(sql: Sql, kind: 'form' | 'page' | 'funnel', fallback: Thing[]): Promise<Thing[]> {
  const linked = await sql.query<{ id: string; name: string }>(
    `SELECT asset_id AS id, max(label) AS name FROM campaign_assets WHERE asset_type = $1 GROUP BY asset_id LIMIT 4`, [kind]);
  const eventType = kind === 'form' ? 'form.submitted' : kind === 'page' ? 'page.viewed' : 'funnel.step_viewed';
  const seen = await sql.query<{ id: string; name: string | null }>(
    `SELECT entity_id AS id, max(coalesce(properties->>'formName', properties->>'pageName', properties->>'funnelName')) AS name
     FROM events WHERE type = $1 AND entity_id IS NOT NULL AND NOT (idempotency_key LIKE 'insights-seed:%') GROUP BY entity_id LIMIT 4`, [eventType]);
  const found = new Map<string, string>();
  for (const row of [...linked.rows, ...seen.rows]) if (!found.has(row.id)) found.set(row.id, row.name || '');
  return found.size ? [...found].map(([id, name], index) => ({ id, name: name || fallback[index % fallback.length].name })) : fallback;
}

export async function seedInsightsPreview(sql: Sql, now = Date.now()) {
  const already = await sql.query(`SELECT 1 FROM events WHERE idempotency_key LIKE 'insights-seed:%' LIMIT 1`);
  if (already.rows.length) return;
  const rand = random(20_261_125);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const campaigns = await campaignsFor(sql, now);
  const forms = await assetsOf(sql, 'form', [{ id: 'sample-form-guide', name: 'Sample · Guide download form' }, { id: 'sample-form-demo', name: 'Sample · Demo request form' }]);
  const pages = await assetsOf(sql, 'page', [{ id: 'sample-page-launch', name: 'Sample · Spring launch page' }, { id: 'sample-page-pricing', name: 'Sample · Pricing page' }]);
  const [funnel] = await assetsOf(sql, 'funnel', [{ id: 'sample-funnel-webinar', name: 'Sample · Webinar sign-up funnel' }]);
  const pipeline = (await sql.query<{ id: string; currency: string }>(
    'SELECT id, currency FROM pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, position LIMIT 1')).rows[0];
  const currency = pipeline?.currency ?? 'GBP';
  const team = (await sql.query<{ id: string }>(`SELECT id FROM users WHERE role <> 'analyst' ORDER BY created_at LIMIT 3`)).rows.map(row => row.id);
  const events: EventRow[] = [];

  // Contacts: the directory's preview contacts, plus labelled sample leads when the directory is the in-memory one
  // (a hosted preview keeps events in PostgreSQL but contacts per instance, so it adds none).
  type Lead = { id: number; at: number; name: string; email: string; campaign: Campaign | null; visitor: string };
  const leads: Lead[] = [];
  for (const contact of devPreviewContacts().slice(0, 8)) {
    if (!contact.createdAt) continue;
    leads.push({ id: contact.id, at: Date.parse(contact.createdAt), name: `${contact.firstName} ${contact.lastName}`.trim(), email: contact.email, campaign: pick(campaigns), visitor: `sample-visitor-c${contact.id}` });
  }
  if (usesEmbeddedDatabase()) {
    for (const [index, [first, last, company]] of people.entries()) {
      const ago = Math.floor(118 * (1 - Math.sqrt(rand()))) + 1;
      const at = now - ago * DAY - Math.floor(rand() * 9) * 3_600_000;
      const domain = company.toLowerCase().replace(/[^a-z]+/g, '') + '.example';
      const { contact } = await upsertContact({
        email: `${first}.${last}@${domain}`.toLowerCase(), firstName: first, lastName: last, company, tags: ['sample-data'], source: 'Preview sample data',
      });
      const record = devPreviewContacts().find(item => item.id === contact.id);
      if (record) record.createdAt = new Date(at).toISOString();
      leads.push({ id: contact.id, at, name: contact.name, email: contact.email, campaign: index % 6 === 5 ? null : pick(campaigns), visitor: `sample-visitor-${index}` });
    }
  }

  for (const lead of leads) {
    const page = pick(pages);
    const form = pick(forms);
    const utm = (campaign: Campaign | null): Record<string, string> => campaign
      ? { source: campaign.utm_source || 'newsletter', medium: campaign.utm_medium || 'email', campaign: campaign.utm_campaign }
      : { source: pick(['google', 'direct', '']) };
    for (let touch = Math.floor(rand() * 3); touch > 0; touch--) {
      const earlier = pick(campaigns);
      events.push({ type: 'page.viewed', at: lead.at - Math.floor(2 + rand() * 25) * DAY, contactId: lead.id, campaignId: earlier.id,
        entityType: 'page', entityId: pick(pages).id, visitorId: lead.visitor, utm: utm(earlier) });
    }
    events.push({ type: 'page.viewed', at: lead.at - 6 * 60_000, contactId: lead.id, campaignId: lead.campaign?.id, entityType: 'page', entityId: page.id,
      visitorId: lead.visitor, utm: utm(lead.campaign), properties: { pageName: page.name } });
    events.push({ type: 'form.submitted', at: lead.at, contactId: lead.id, campaignId: lead.campaign?.id, entityType: 'form', entityId: form.id,
      visitorId: lead.visitor, utm: utm(lead.campaign), properties: { formName: form.name, pageId: page.id, pageName: page.name, fields: { email: lead.email } } });
    events.push({ type: 'contact.created', at: lead.at + 1000, contactId: lead.id, campaignId: lead.campaign?.id, utm: utm(lead.campaign),
      properties: { source: form.name } });
  }

  // Anonymous traffic and a three-step funnel, so page conversion and funnel drop-off have a denominator.
  for (let index = 0; index < 220; index++) {
    const campaign = rand() < 0.5 ? pick(campaigns) : null;
    const at = now - Math.floor(rand() * 119 * DAY) - DAY;
    const visitor = `sample-anon-${index}`;
    const utm: Record<string, string> = campaign ? { source: campaign.utm_source, medium: campaign.utm_medium, campaign: campaign.utm_campaign } : {};
    const page = pick(pages);
    events.push({ type: 'page.viewed', at, campaignId: campaign?.id, entityType: 'page', entityId: page.id, visitorId: visitor, utm, properties: { pageName: page.name } });
    if (index < 150) {
      const steps = ['Landing page', 'Registration', 'Confirmation'];
      let reached = 1;
      while (reached < steps.length && rand() < (reached === 1 ? 0.56 : 0.62)) reached += 1;
      for (let step = 0; step < reached; step++) {
        events.push({ type: 'funnel.step_viewed', at: at + step * 120_000, campaignId: campaign?.id, entityType: 'funnel', entityId: funnel.id, visitorId: visitor, utm,
          properties: { stepIndex: step, stepName: steps[step], funnelName: funnel.name } });
      }
      if (reached === steps.length && rand() < 0.8) {
        events.push({ type: 'funnel.completed', at: at + 400_000, campaignId: campaign?.id, entityType: 'funnel', entityId: funnel.id, visitorId: visitor, utm, properties: { funnelName: funnel.name } });
      }
    }
  }

  // Deals: reuse what the CRM lane seeded (adding campaign touchpoints before most of them); create labelled samples only when there are none.
  const existing = await sql.query<{ id: string; contact_id: string | null; created_at: Date; status: string; amount: string; currency: string; closed_at: Date | null; campaign_id: string | null }>(
    `SELECT id, contact_id, created_at, status, amount, currency, closed_at, campaign_id FROM deals WHERE archived_at IS NULL`);
  if (existing.rows.length) {
    const won = new Set((await sql.query<{ deal_id: string }>(`SELECT deal_id FROM events WHERE type = 'deal.won' AND deal_id IS NOT NULL`)).rows.map(row => row.deal_id));
    for (const deal of existing.rows) {
      const created = new Date(deal.created_at).getTime();
      if (deal.contact_id && rand() < 0.75) {
        const campaign = campaigns.find(item => item.id === deal.campaign_id) ?? pick(campaigns);
        events.push({ type: 'form.submitted', at: created - Math.floor(1 + rand() * 20) * DAY, contactId: Number(deal.contact_id), campaignId: campaign.id,
          entityType: 'form', entityId: pick(forms).id, utm: { source: campaign.utm_source, medium: campaign.utm_medium, campaign: campaign.utm_campaign },
          properties: { formName: pick(forms).name } });
      }
      if (deal.status === 'won' && deal.closed_at && !won.has(deal.id)) {
        events.push({ type: 'deal.won', at: new Date(deal.closed_at).getTime(), dealId: deal.id, contactId: deal.contact_id ? Number(deal.contact_id) : null,
          campaignId: deal.campaign_id, amount: Number(deal.amount), currency: deal.currency });
      }
    }
  } else if (pipeline) {
    const stages = (await sql.query<{ id: string; name: string; outcome: string }>(
      'SELECT id, name, outcome FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position', [pipeline.id])).rows;
    const open = stages.filter(stage => stage.outcome === 'open');
    const wonStage = stages.find(stage => stage.outcome === 'won');
    const lostStage = stages.find(stage => stage.outcome === 'lost');
    const products = ['annual plan', 'team rollout', 'pilot', 'expansion', 'onboarding package'];
    let dealIndex = 0;
    for (const lead of leads) {
      if (rand() > 0.62 || !wonStage || !lostStage || !open.length) continue;
      const created = lead.at + Math.floor(1 + rand() * 12) * DAY;
      if (created > now - DAY) continue;
      const age = (now - created) / DAY;
      const roll = rand();
      const planned = age > 30 ? (roll < 0.5 ? 'won' : roll < 0.72 ? 'lost' : 'open') : age > 10 ? (roll < 0.32 ? 'won' : roll < 0.45 ? 'lost' : 'open') : 'open';
      // Sample close dates fall between five days after creation and yesterday, never in the future.
      const earliest = created + 5 * DAY;
      const span = Math.min(now - DAY - earliest, 60 * DAY);
      const outcome = planned !== 'open' && span > 0 ? planned : 'open';
      const closed = outcome === 'open' ? null : Math.floor(earliest + rand() * span);
      const furthest = outcome === 'won' ? open.length - 1 : Math.floor(rand() * open.length);
      const path = [...open.slice(0, furthest + 1), ...(outcome === 'won' ? [wonStage] : outcome === 'lost' ? [lostStage] : [])];
      const stage = path[path.length - 1];
      const amount = Math.round((1200 + rand() * 23_000) / 100) * 100;
      const owner = team.length ? team[dealIndex % team.length] : null;
      const company = lead.email.split('@')[1]?.replace('.example', '') ?? 'account';
      const name = `Sample · ${people.find(([first]) => lead.name.startsWith(first))?.[2] ?? company} ${pick(products)}`;
      const expected = outcome === 'open' ? new Date(now + Math.floor(-12 + rand() * 100) * DAY).toISOString().slice(0, 10) : null;
      const inserted = await sql.query<{ id: string }>(
        `INSERT INTO deals (pipeline_id, stage_id, name, amount, currency, status, owner_id, contact_id, contact_name, contact_email, campaign_id, source,
           expected_close_date, closed_at, board_position, custom, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $7, $17, $17) RETURNING id`,
        [pipeline.id, stage.id, name, amount, currency, outcome, owner, lead.id, lead.name, lead.email, lead.campaign?.id ?? null,
          lead.campaign ? 'Website form' : pick(['Referral', 'Outbound']), expected, closed ? new Date(closed).toISOString() : null, -dealIndex,
          JSON.stringify({ sample: true }), new Date(created).toISOString()],
      );
      const dealId = inserted.rows[0].id;
      const end = closed ?? now - 3_600_000;
      let previous: string | null = null;
      for (const [step, entry] of path.entries()) {
        const at = step === 0 ? created : created + ((end - created) * step) / Math.max(1, path.length - 1);
        await sql.query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, changed_at) VALUES ($1, $2, $3, $4, $5)',
          [dealId, previous, entry.id, owner, new Date(at).toISOString()]);
        const base = { dealId, contactId: lead.id, campaignId: lead.campaign?.id ?? null, currency };
        if (step === 0) events.push({ ...base, type: 'deal.created', at, properties: { name, stageName: entry.name, value: amount } });
        else events.push({ ...base, type: 'deal.stage_changed', at, properties: { fromStageId: previous, toStageId: entry.id, stageName: entry.name } });
        if (entry.outcome === 'won') events.push({ ...base, type: 'deal.won', at, amount, properties: { name } });
        if (entry.outcome === 'lost') events.push({ ...base, type: 'deal.lost', at, properties: { name, reason: 'Sample: chose another vendor' } });
        previous = entry.id;
      }
      dealIndex += 1;
    }
  }

  // A few tasks for the preview user's home screen, only when no lane created any.
  const anyTask = await sql.query('SELECT 1 FROM tasks LIMIT 1');
  if (!anyTask.rows.length) {
    const deals = (await sql.query<{ id: string; contact_id: string | null; name: string }>(
      `SELECT id, contact_id, name FROM deals WHERE status = 'open' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 5`)).rows;
    const today = Math.floor(now / DAY) * DAY;
    const tasks = [
      ['Sample · Send the revised proposal', 'email', 'high', today - 3 * DAY + 10 * 3_600_000],
      ['Sample · Follow up on pricing questions', 'call', 'normal', today - DAY + 15 * 3_600_000],
      ['Sample · Discovery call', 'meeting', 'normal', today + 14 * 3_600_000],
      ['Sample · Share the onboarding plan', 'follow_up', 'normal', today + 16 * 3_600_000],
      ['Sample · Check in after the trial', 'call', 'low', today + 2 * DAY + 11 * 3_600_000],
    ] as const;
    for (const [index, [title, type, priority, due]] of tasks.entries()) {
      const deal = deals[index % Math.max(1, deals.length)];
      await sql.query(
        `INSERT INTO tasks (title, type, priority, due_at, assignee_id, created_by, deal_id, contact_id, source) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'sample')`,
        [title, type, priority, new Date(due).toISOString(), DEV_PREVIEW_USER.id, deal?.id ?? null, deal?.contact_id ?? null],
      );
    }
  }

  await insertEvents(sql, events.sort((a, b) => a.at - b.at));
}
