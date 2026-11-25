// Preview sample data for lane 4: campaigns with assets and tracked links, three native flows (one published and
// triggered by a seeded form), and a few historical runs. Runs after the studio and sites seeds; their records are
// looked up by name and may be absent. Plain SQL only, idempotent, labelled as sample data.
import type { FlowGraph, FlowNode, FlowTrigger } from '@/contracts/journeys';
import { buildTrackedUrl, flowTemplates, nodeSpec, tidyLayout } from '@/contracts/journeys';
import type { Sql } from '../db';

const ADMIN = '00000000-0000-4000-8000-000000000001';
const MAYA = '00000000-0000-4000-8000-000000000002';
const day = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();
const dateOnly = (offsetDays: number) => at(offsetDays).slice(0, 10);

async function first<T>(sql: Sql, text: string, values: unknown[] = []): Promise<T | undefined> {
  try {
    return (await sql.query<T & Record<string, unknown>>(text, values)).rows[0];
  } catch {
    return undefined;
  }
}

/** A form from the sites lane, looked up by name in whichever table it uses. */
async function findForm(sql: Sql): Promise<{ id: string; name: string } | undefined> {
  for (const table of ['site_forms', 'sites_forms', 'forms']) {
    const exists = await first<{ ok: boolean }>(sql, 'SELECT to_regclass($1) IS NOT NULL AS ok', [table]);
    if (!exists?.ok) continue;
    const row = await first<{ id: string; name: string }>(sql,
      `SELECT id::text AS id, name FROM ${table} ORDER BY (lower(name) LIKE '%webinar%') DESC, (lower(name) LIKE '%sign%') DESC LIMIT 1`);
    if (row) return row;
  }
  return undefined;
}

function graph(steps: [string, FlowNode['type'], Record<string, unknown>?][], links: [string, string, ('next' | 'yes' | 'no')?][]): FlowGraph {
  return tidyLayout({
    nodes: steps.map(([id, type, config]) => ({ id, type, position: { x: 0, y: 0 }, config: { ...nodeSpec(type).defaults(), ...config } })),
    edges: links.map(([source, target, handle = 'next']) => ({ id: `e_${source}_${handle}_${target}`, source, target, sourceHandle: handle })),
  });
}

export async function seedJourneys(sql: Sql): Promise<void> {
  if (await first(sql, `SELECT 1 FROM marketing_campaigns WHERE utm_campaign = 'spring-webinar-series'`)) return;

  let design = await first<{ id: string; name: string }>(sql,
    `SELECT id, name FROM designs WHERE kind = 'email' AND html <> '' AND status <> 'archived' ORDER BY (lower(name) LIKE '%webinar%') DESC, (lower(name) LIKE '%welcome%') DESC, created_at LIMIT 1`);
  if (!design) {
    design = await first<{ id: string; name: string }>(sql,
      `INSERT INTO designs (kind, name, subject, html, status, category, created_by)
       VALUES ('email', 'Sample · Webinar welcome', 'You are registered, {{contact.first_name | there}}',
         '<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px"><h1>See you at the webinar</h1><p>Hi {{contact.first_name | there}}, thanks for registering. We will send the joining link the day before.</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p></body></html>',
         'ready', 'Sample', $1) RETURNING id, name`, [ADMIN]);
  }
  const form = await findForm(sql);
  const pipeline = await first<{ id: string }>(sql, `SELECT id FROM pipelines WHERE is_default LIMIT 1`);
  const stages = pipeline ? (await sql.query<{ id: string; name: string; outcome: string }>('SELECT id, name, outcome FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position', [pipeline.id])).rows : [];

  const campaign = async (values: unknown[]) => (await sql.query<{ id: string }>(
    `INSERT INTO marketing_campaigns (name, objective, description, status, owner_id, starts_on, ends_on, budget, currency, utm_campaign, utm_source, utm_medium, launched_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GBP', $9, $10, $11, $12, $13) RETURNING id`, [...values, ADMIN])).rows[0].id;
  const spring = await campaign(['Spring webinar series', 'Generate leads', 'Sample campaign for the developer preview: three live webinars with a nurture workflow and tracked links.',
    'active', MAYA, dateOnly(-18), dateOnly(24), 2500, 'spring-webinar-series', 'newsletter', 'email', at(-18)]);
  const renewals = await campaign(['Q4 renewals push', 'Retain customers', 'Sample campaign for the developer preview: renewal reminders and account reviews before year end.',
    'planned', ADMIN, dateOnly(6), dateOnly(52), 4000, 'q4-renewals-push', 'email', 'crm', null]);
  await campaign(['Autumn product launch', 'Launch a product', 'Sample campaign for the developer preview (completed).',
    'completed', MAYA, dateOnly(-75), dateOnly(-40), 1500, 'autumn-product-launch', 'linkedin', 'social', at(-75)]);

  const insertFlow = async (input: { name: string; description: string; status: string; triggers: FlowTrigger[]; reentry: string; graph: FlowGraph; campaignId: string | null; template?: string; published: boolean }) => {
    const id = (await sql.query<{ id: string }>(
      `INSERT INTO journey_flows (name, description, status, triggers, reentry, graph, campaign_id, published_version, owner_id, template_key, created_by, published_at, paused_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $11, $12, now() - interval '20 days', now() - interval '2 days') RETURNING id`,
      [input.name, input.description, input.status, JSON.stringify(input.triggers), input.reentry, JSON.stringify(input.graph), input.campaignId,
        input.published ? 1 : null, ADMIN, input.template ?? null, input.published ? at(-17) : null, input.status === 'paused' ? at(-3) : null],
    )).rows[0].id;
    if (input.published) {
      await sql.query(`INSERT INTO journey_flow_versions (flow_id, version, graph, triggers, reentry, published_by, published_at) VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [id, JSON.stringify(input.graph), JSON.stringify(input.triggers), input.reentry, ADMIN, at(-17)]);
    }
    if (input.campaignId) await sql.query(`INSERT INTO campaign_assets (campaign_id, asset_type, asset_id, label) VALUES ($1, 'flow', $2, $3)`, [input.campaignId, id, input.name]);
    return id;
  };

  const followUpGraph = graph([
    ['start', 'start'], ['tag', 'add_tag', { tags: ['webinar-2026'] }], ['wait', 'wait', { mode: 'duration', amount: 1, unit: 'days' }],
    ['email', 'send_email', { designId: design?.id ?? '', designName: design?.name ?? '' }],
    ['task', 'create_task', { title: 'Call {{contact.full_name}} after the webinar', dueInDays: 2, type: 'call', assignee: 'owner' }],
  ], [['start', 'tag'], ['tag', 'wait'], ['wait', 'email'], ['email', 'task']]);
  const followUp = await insertFlow({
    name: 'Webinar sign-up follow-up', description: 'Sample workflow: tags webinar registrants, waits a day, sends the welcome email and creates a follow-up call.',
    status: 'published', reentry: 'once', campaignId: spring, published: true, graph: followUpGraph,
    triggers: [{ id: 't1', type: 'form.submitted', filters: form ? { formId: form.id, formName: form.name } : {} }],
  });
  const retention = flowTemplates.find(item => item.key === 'customer-retention')!;
  await insertFlow({
    name: 'Renewal reminders', description: 'Sample draft workflow from the customer retention template.', status: 'draft', reentry: retention.reentry,
    campaignId: renewals, published: false, graph: retention.graph, triggers: retention.triggers, template: 'customer-retention',
  });
  const nurture = flowTemplates.find(item => item.key === 'lead-nurture')!;
  const nurtureGraph: FlowGraph = { ...nurture.graph, nodes: nurture.graph.nodes.map(node => node.type === 'send_email' ? { ...node, config: { designId: design?.id ?? '', designName: design?.name ?? '' } } : node) };
  await insertFlow({
    name: 'Lead nurturing', description: 'Sample workflow from the lead nurturing template, paused while the content is refreshed.', status: design ? 'paused' : 'draft',
    reentry: 'once', campaignId: null, published: Boolean(design), graph: nurtureGraph, triggers: nurture.triggers, template: 'lead-nurture',
  });

  // Historical runs of the published flow (sample data; the waiting one continues when its step is due).
  const runs: { contact: number; status: string; logs: [string, string, string][]; node: string | null; seq: number; enrolledDays: number }[] = [
    { contact: 1, status: 'completed', node: 'task', seq: 4, enrolledDays: -9, logs: [['tag', 'ok', 'Added webinar-2026.'], ['wait', 'ok', 'Wait 1 day.'], ['email', 'skipped', 'Not sent: the developer preview has no email relay. The rendered message is stored here.'], ['task', 'ok', 'Task “Call Claire Bennett after the webinar” for Maya Chen.']] },
    { contact: 4, status: 'completed', node: 'task', seq: 4, enrolledDays: -6, logs: [['tag', 'ok', 'Added webinar-2026.'], ['wait', 'ok', 'Wait 1 day.'], ['email', 'skipped', 'Blocked: No consent is recorded for this address.'], ['task', 'ok', 'Task “Call Sam Okafor after the webinar” for Maya Chen.']] },
    { contact: 2, status: 'waiting', node: 'email', seq: 3, enrolledDays: -0.6, logs: [['tag', 'ok', 'Added webinar-2026.'], ['wait', 'waiting', 'Wait 1 day.']] },
  ];
  for (const run of runs) {
    const enrolledAt = at(run.enrolledDays);
    const enrolment = (await sql.query<{ id: string }>(
      `INSERT INTO journey_enrolments (flow_id, version, contact_id, status, current_node, step_seq, trigger_type, entry_key, enrolled_at, updated_at, finished_at, next_run_at)
       VALUES ($1, 1, $2, $3, $4, $5, 'form.submitted', $6, $7, $8, $9, $10) RETURNING id`,
      [followUp, run.contact, run.status, run.node, run.seq, `once:${followUp}:${run.contact}`, enrolledAt, at(run.enrolledDays + 1),
        run.status === 'completed' ? at(run.enrolledDays + 1) : null, run.status === 'waiting' ? at(run.enrolledDays + 1) : null],
    )).rows[0].id;
    await sql.query(`INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail, at) VALUES ($1, 0, 'start', 'start', 'Enrolled', 'ok', 'Sample run · Trigger: Form submitted · version 1', $2)`, [enrolment, enrolledAt]);
    for (const [index, [node, status, detail]] of run.logs.entries()) {
      const step = followUpGraph.nodes.find(item => item.id === node)!;
      await sql.query(`INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [enrolment, index + 1, node, step.type, nodeSpec(step.type).label, status, detail, at(run.enrolledDays + (index >= 2 ? 1 : 0))]);
    }
    if (run.status === 'waiting') {
      await sql.query(`INSERT INTO jobs (kind, dedupe_key, payload, run_at) VALUES ('platform', $1, $2, $3)`,
        [`platform:journeys.step:${enrolment}:${run.seq}`, JSON.stringify({ handler: 'journeys.step', data: { enrolmentId: enrolment, seq: run.seq } }), at(run.enrolledDays + 1)]);
    }
  }

  // Assets and tracked links.
  const assets: [string, string, string, string, Record<string, unknown>?][] = [
    [spring, 'journey', '1', 'New Subscriber Welcome Sequence'], [spring, 'segment', '1', 'Newsletter subscribers'], [spring, 'list', '1', 'Product & marketing dispatch'],
    [spring, 'newsletter', '3', 'Summer Webinar Invite'], [renewals, 'newsletter', '2', 'Q2 Customer Benchmark Report'], [renewals, 'segment', '2', 'Product-qualified leads'],
  ];
  if (design) assets.push([spring, 'design', design.id, design.name]);
  if (form) assets.push([spring, 'form', form.id, form.name]);
  for (const [name, destination, source, medium, content, campaignId, slug] of [
    ['Registration page · newsletter', 'https://ovelio.example/webinars/spring', 'newsletter', 'email', 'header-button', spring, 'spring-webinar-series'],
    ['Registration page · LinkedIn', 'https://ovelio.example/webinars/spring', 'linkedin', 'social', 'post', spring, 'spring-webinar-series'],
    ['Renewal pricing', 'https://ovelio.example/pricing', 'email', 'crm', 'renewal-reminder', renewals, 'q4-renewals-push'],
  ] as const) {
    const url = buildTrackedUrl(destination, { campaign: slug, source, medium, content });
    assets.push([campaignId, 'link', `sample-${slug}-${source}`, name, { destination, url, source, medium, content, term: '' }]);
  }
  for (const [campaignId, type, id, label, meta] of assets) {
    await sql.query(`INSERT INTO campaign_assets (campaign_id, asset_type, asset_id, label, meta) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [campaignId, type, id, label, JSON.stringify(meta ?? {})]);
  }

  // Attributed activity so the campaign workspace has measured numbers (sample events and deals, labelled).
  const sample = { sample: true, formName: form?.name ?? 'Webinar sign-up (sample)' };
  for (const [contact, offset] of [[1, -9], [4, -6], [2, -0.6], [3, -4]] as const) {
    await sql.query(`INSERT INTO events (type, occurred_at, contact_id, campaign_id, entity_type, entity_id, source, utm, properties) VALUES ('form.submitted', $1, $2, $3, 'form', $4, 'preview-sample', $5, $6)`,
      [at(offset), contact, spring, form?.id ?? 'sample-form', JSON.stringify({ campaign: 'spring-webinar-series', source: 'newsletter', medium: 'email' }), JSON.stringify(sample)]);
  }
  for (const offset of [-8, -3]) {
    await sql.query(`INSERT INTO events (type, occurred_at, campaign_id, entity_type, entity_id, source, utm, properties) VALUES ('page.converted', $1, $2, 'page', 'sample-page', 'preview-sample', $3, '{"sample": true}')`,
      [at(offset), spring, JSON.stringify({ campaign: 'spring-webinar-series', source: 'linkedin', medium: 'social' })]);
  }
  await sql.query(`INSERT INTO events (type, occurred_at, campaign_id, entity_type, entity_id, source, properties) VALUES ('campaign.launched', $1, $2::uuid, 'campaign', $2::text, 'preview-sample', '{"name": "Spring webinar series", "sample": true}')`, [at(-18), spring]);
  const won = stages.find(stage => stage.outcome === 'won');
  const open = stages.find(stage => stage.name === 'Qualified') ?? stages[0];
  if (pipeline && won && open) {
    const deal = (await sql.query<{ id: string }>(
      `INSERT INTO deals (pipeline_id, stage_id, name, amount, currency, status, owner_id, contact_id, contact_name, contact_email, company_name, campaign_id, source, closed_at, created_by)
       VALUES ($1, $2, 'Sample · Northbridge webinar upsell', 4800, 'GBP', 'won', $3, 1, 'Claire Bennett', 'claire.bennett@northbridge.example', 'Northbridge Studio', $4, 'preview-sample', $5, $3) RETURNING id`,
      [pipeline.id, won.id, MAYA, spring, at(-2)])).rows[0].id;
    await sql.query(`INSERT INTO events (type, occurred_at, contact_id, deal_id, campaign_id, amount, currency, source, properties) VALUES ('deal.won', $1, 1, $2, $3, 4800, 'GBP', 'preview-sample', '{"name": "Sample · Northbridge webinar upsell", "sample": true}')`, [at(-2), deal, spring]);
    await sql.query(
      `INSERT INTO deals (pipeline_id, stage_id, name, amount, currency, status, owner_id, contact_id, contact_name, contact_email, company_name, campaign_id, source, created_by)
       VALUES ($1, $2, 'Sample · Harbourline webinar lead', 1800, 'GBP', 'open', $3, 2, 'Daniel Patel', 'daniel.patel@harbourline.example', 'Harbourline Retail', $4, 'preview-sample', $3)`,
      [pipeline.id, open.id, MAYA, spring]);
  }
}
