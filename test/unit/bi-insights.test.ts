import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { parseInsightsQuery } = await import('../../src/server/insights/params');
const { summary } = await import('../../src/server/insights/summary');
const { sales } = await import('../../src/server/insights/sales');
const { marketing } = await import('../../src/server/insights/marketing');
const { attribution, allocate, modelWeights } = await import('../../src/server/insights/attribution');
const { funnels, sequentialSteps } = await import('../../src/server/insights/funnels');
const { drill, parseDrill } = await import('../../src/server/insights/drill');
const { csvCell, exportReport } = await import('../../src/server/insights/csv');
const { seedInsightsPreview } = await import('../../src/server/insights/seed');
const { attributionModels } = await import('../../src/contracts/insights');
const { DEV_PREVIEW_USER } = await import('../../src/server/dev-preview');

after(async () => { await db.close(); });

// Everything below happens in March 2020 on a dedicated pipeline, far from the preview seed's last 120 days.
const MARCH = { startAt: Date.UTC(2020, 2, 1), endAt: Date.UTC(2020, 3, 1) };
const ids: Record<string, string> = {};
const user = DEV_PREVIEW_USER;

async function event(type: string, at: string, fields: { contact?: number; campaign?: string; entityType?: string; entityId?: string; visitor?: string; source?: string; properties?: Record<string, unknown> } = {}) {
  await db.query(
    `INSERT INTO events (type, occurred_at, contact_id, campaign_id, entity_type, entity_id, visitor_id, utm, properties)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [type, at, fields.contact ?? null, fields.campaign ?? null, fields.entityType ?? null, fields.entityId ?? null, fields.visitor ?? null,
      JSON.stringify(fields.source ? { source: fields.source } : {}), JSON.stringify(fields.properties ?? {})],
  );
}

async function deal(name: string, input: { amount: number; stage: string; status: 'open' | 'won' | 'lost'; created: string; closed?: string; campaign?: string; contact?: number; source?: string; expected?: string; probability?: number; owner?: string }) {
  const row = (await db.query<{ id: string }>(
    `INSERT INTO deals (pipeline_id, stage_id, name, amount, status, created_at, closed_at, campaign_id, contact_id, source, expected_close_date, probability, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [ids.pipeline, ids[input.stage], name, input.amount, input.status, input.created, input.closed ?? null, input.campaign ?? null, input.contact ?? null,
      input.source ?? '', input.expected ?? null, input.probability ?? null, input.owner ?? ids.owner],
  )).rows[0];
  ids[name] = row.id;
  const path = input.status === 'won' ? ['lead', 'proposal', 'won'] : input.status === 'lost' ? ['lead', 'lost'] : input.stage === 'proposal' ? ['lead', 'proposal'] : ['lead'];
  const start = Date.parse(input.created);
  const end = input.closed ? Date.parse(input.closed) : start + 4 * 86_400_000;
  for (const [index, stage] of path.entries()) {
    const at = start + ((end - start) * index) / Math.max(1, path.length - 1);
    await db.query('INSERT INTO deal_stage_history (deal_id, to_stage_id, changed_at) VALUES ($1, $2, $3)', [row.id, ids[stage], new Date(at).toISOString()]);
  }
}

const query = (extra: Record<string, string> = {}) => parseInsightsQuery(new URLSearchParams({
  startAt: String(MARCH.startAt), endAt: String(MARCH.endAt), pipelineId: ids.pipeline, ...extra,
}));

before(async () => {
  ids.owner = (await db.query<{ id: string }>(`INSERT INTO users (email, name, role, password_hash) VALUES ('bi.owner@example.test', 'BI Owner', 'marketer', 'x') RETURNING id`)).rows[0].id;
  ids.pipeline = (await db.query<{ id: string }>(`INSERT INTO pipelines (name, currency, position) VALUES ('BI test pipeline', 'GBP', 9) RETURNING id`)).rows[0].id;
  for (const [key, name, position, probability, outcome] of [['lead', 'Lead', 0, 10, 'open'], ['proposal', 'Proposal', 1, 50, 'open'], ['won', 'Won', 2, 100, 'won'], ['lost', 'Lost', 3, 0, 'lost']] as const) {
    ids[key] = (await db.query<{ id: string }>(
      'INSERT INTO pipeline_stages (pipeline_id, name, position, probability, outcome) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [ids.pipeline, name, position, probability, outcome])).rows[0].id;
  }
  for (const [key, slug, budget] of [['A', 'bi-campaign-a', 1000], ['B', 'bi-campaign-b', null], ['C', 'bi-campaign-c', 500]] as const) {
    ids[key] = (await db.query<{ id: string }>(`INSERT INTO marketing_campaigns (name, utm_campaign, budget) VALUES ($1, $2, $3) RETURNING id`, ['BI ' + key, slug, budget])).rows[0].id;
  }
  // Touchpoints and leads.
  await event('page.viewed', '2019-10-01T10:00:00Z', { contact: 9101, campaign: ids.C });
  await event('page.viewed', '2020-02-20T10:00:00Z', { contact: 9101, campaign: ids.A });
  await event('page.viewed', '2020-02-25T10:00:00Z', { contact: 9101, campaign: ids.B });
  await event('page.viewed', '2020-02-28T10:00:00Z', { contact: 9101, campaign: ids.C });
  await event('form.submitted', '2020-03-05T10:00:00Z', { contact: 9101, campaign: ids.A, entityType: 'form', entityId: 'bi-form', source: 'newsletter', properties: { formName: 'BI form', pageId: 'bi-page' } });
  await event('contact.created', '2020-03-05T10:00:01Z', { contact: 9101, campaign: ids.A, source: 'newsletter' });
  await event('page.viewed', '2020-03-02T09:00:00Z', { contact: 9102, campaign: ids.A });
  await event('form.submitted', '2020-03-02T09:05:00Z', { contact: 9102, campaign: ids.A, entityType: 'form', entityId: 'bi-form', source: 'newsletter', properties: { formName: 'BI form' } });
  await event('form.submitted', '2020-03-08T12:00:00Z', { contact: 9104, entityType: 'form', entityId: 'bi-form-2', source: 'google', properties: { formName: '=HYPERLINK("x")' } });
  await event('form.submitted', '2020-02-10T12:00:00Z', { contact: 9105, entityType: 'form', entityId: 'bi-form' });
  // Deals.
  await deal('D1', { amount: 1000.01, stage: 'won', status: 'won', created: '2020-03-01T12:00:00Z', closed: '2020-03-10T12:00:00Z', campaign: ids.A, contact: 9101, source: 'Website form' });
  await deal('D2', { amount: 500, stage: 'won', status: 'won', created: '2020-03-03T12:00:00Z', closed: '2020-03-15T12:00:00Z', campaign: ids.A, contact: 9102, source: 'Website form' });
  await deal('D3', { amount: 250, stage: 'won', status: 'won', created: '2020-02-20T12:00:00Z', closed: '2020-03-20T12:00:00Z', campaign: ids.B, contact: 9103, source: 'Referral' });
  await deal('D4', { amount: 800, stage: 'lost', status: 'lost', created: '2020-03-05T12:00:00Z', closed: '2020-03-25T12:00:00Z', source: 'Outbound' });
  await deal('D5', { amount: 2000, stage: 'proposal', status: 'open', created: '2020-03-06T12:00:00Z', expected: '2020-05-15' });
  await deal('D6', { amount: 1000, stage: 'lead', status: 'open', created: '2020-03-07T12:00:00Z', probability: 30 });
  await deal('D7', { amount: 400, stage: 'won', status: 'won', created: '2020-02-01T12:00:00Z', closed: '2020-02-15T12:00:00Z' });
  // Tasks for the owner.
  await db.query(`INSERT INTO tasks (title, due_at, assignee_id) VALUES ('Late one', now() - interval '2 days', $1), ('Late two', now() - interval '1 hour', $1),
    ('Later', now() + interval '2 days', $1)`, [ids.owner]);
});

test('BI-01 summary counts leads, deals, revenue, win rate, cycle and comparison from constructed records', async () => {
  const result = await summary(await query({ compare: 'previous' }));
  const m = result.metrics;
  assert.equal(m.leads.value, 3, 'distinct contacts 9101, 9102, 9104; 9101 counted once');
  assert.equal(m.leads.previous, 1, '9105 in the previous period');
  assert.deepEqual(m.leads.ignoredFilters, ['pipeline'], 'a pipeline filter cannot apply to leads');
  assert.equal(m.newDeals.value, 5);
  assert.equal(m.newDealValue.value, 5300.01);
  assert.equal(m.wonRevenue.value, 1750.01);
  assert.equal(m.wonDeals.value, 3);
  assert.equal(m.wonRevenue.previous, 400);
  assert.equal(m.lostDeals.value, 1);
  assert.equal(m.winRate.value, 0.75);
  assert.equal(m.avgDealSize.value, 583.34);
  assert.equal(m.avgSalesCycleDays.value, 16.7, '(9 + 12 + 29) / 3 days');
  assert.equal(m.openPipeline.value, 3000);
  assert.equal(m.openPipeline.provenance, 'snapshot');
  assert.equal(m.weightedPipeline.value, 1300, '2000 × 50% + 1000 × 30% (deal override)');
  assert.equal(m.weightedPipeline.provenance, 'estimate');
  assert.equal(result.meta.comparison?.range.endAt, MARCH.startAt);
  const owned = await summary(await query({ ownerId: ids.owner }));
  assert.equal(owned.metrics.tasksOverdue.value, 2);
});

test('BI-02 sales report: stages, revenue buckets, win rate by source, conversion and forecast', async () => {
  const report = await sales(await query({ compare: 'previous', interval: 'week' }));
  const stage = (name: string) => report.stages.find(row => row.name === name)!;
  assert.deepEqual([stage('Lead').count, stage('Lead').value, stage('Lead').weighted], [1, 1000, 300]);
  assert.deepEqual([stage('Proposal').count, stage('Proposal').weighted], [1, 1000]);
  assert.deepEqual([stage('Won').count, stage('Won').value, stage('Won').weighted], [3, 1750.01, null]);
  assert.equal(stage('Lost').count, 1);
  const total = report.revenue.points.reduce((sum, point) => sum + point.value, 0);
  assert.equal(Math.round(total * 100), 175001, 'buckets add up to won revenue');
  assert.equal(report.revenue.interval, 'week');
  assert.equal(Math.round(report.revenue.points.reduce((sum, point) => sum + (point.previous ?? 0), 0)), 400);
  const website = report.winRate.source.find(row => row.label === 'Website form')!;
  assert.deepEqual([website.won, website.lost, website.winRate], [2, 0, 1]);
  assert.equal(report.winRate.source.find(row => row.label === 'Outbound')?.winRate, 0);
  assert.equal(report.winRate.owner[0].label, 'BI Owner');
  const conversion = Object.fromEntries(report.conversion.map(row => [row.name, row.reached]));
  assert.deepEqual(conversion, { Lead: 5, Proposal: 3, Won: 2 }, 'deals created in March: D1, D2, D4, D5, D6');
  const may = report.forecast.find(row => row.month === '2020-05')!;
  assert.deepEqual([may.count, may.value, may.weighted, may.overdue], [1, 2000, 1000, true]);
  assert.equal(report.forecast.find(row => row.month === null)?.weighted, 300);
  assert.ok(report.velocity.perDay && report.velocity.perDay > 0);
});

test('BI-03 campaign table shows cost per lead and ROI only when budget and revenue exist', async () => {
  const report = await marketing(await query(), user);
  const row = (key: string) => report.campaigns.find(item => item.campaignId === ids[key])!;
  assert.deepEqual([row('A').leads, row('A').deals, row('A').wonDeals, row('A').wonRevenue], [2, 2, 2, 1500.01]);
  assert.equal(row('A').costPerLead, 500);
  assert.equal(row('A').roi, 0.5);
  assert.equal(row('B').roi, null);
  assert.match(row('B').roiNote ?? '', /No budget/);
  assert.equal(row('C').roi, null, 'budget but no revenue');
  assert.match(row('C').roiNote ?? '', /No won revenue/);
  assert.equal(row('C').costPerLead, null);
  assert.equal(report.leads.total, 3);
  assert.deepEqual(report.bySource.map(item => [item.label, item.value]), [['newsletter', 2], ['google', 1]]);
  assert.equal(report.byForm.find(item => item.key === 'bi-form')?.value, 2);
  assert.equal(report.leads.series.points.reduce((sum, point) => sum + point.value, 0), 3, 'each lead bucketed once');
});

test('BI-04 attribution models: weights, exact largest-remainder split and credit summing to won revenue', async () => {
  assert.deepEqual(modelWeights(3, 'position_based'), [0.4, 0.2, 0.4]);
  assert.deepEqual(modelWeights(4, 'position_based').map(value => Math.round(value * 100)), [40, 10, 10, 40]);
  assert.deepEqual(modelWeights(2, 'position_based'), [0.5, 0.5]);
  assert.deepEqual(modelWeights(3, 'first_touch'), [1, 0, 0]);
  assert.deepEqual(allocate(100001, modelWeights(3, 'linear')), [33334, 33334, 33333]);
  assert.equal(allocate(7, [1, 1, 1, 1, 1, 1]).reduce((a, b) => a + b, 0), 7);

  const report = await attribution(await query(), 90);
  assert.equal(report.totals.wonRevenue, 1750.01);
  assert.equal(report.unattributed.revenue, 250, 'D3 has no touchpoints');
  assert.equal(report.unattributed.dealsWithDealCampaign, 1);
  for (const { key } of attributionModels) {
    const credited = report.rows.reduce((sum, row) => sum + Math.round(row.revenue[key] * 100), 0);
    assert.equal(credited + Math.round(report.unattributed.revenue * 100), 175001, `${key} credit sums exactly to won revenue`);
    const leads = report.rows.reduce((sum, row) => sum + row.leads[key], 0) + report.unattributed.leads;
    assert.equal(Math.round(leads * 1000) / 1000, report.totals.leads);
  }
  const revenue = (campaign: string) => report.rows.find(row => row.campaignId === ids[campaign])!.revenue;
  assert.deepEqual([revenue('A').first_touch, revenue('C').first_touch ?? 0], [1500.01, 0]);
  assert.deepEqual([revenue('A').last_touch, revenue('C').last_touch], [500, 1000.01]);
  assert.deepEqual([revenue('A').linear, revenue('B').linear, revenue('C').linear], [833.34, 333.34, 333.33]);
  assert.deepEqual([revenue('A').position_based, revenue('B').position_based, revenue('C').position_based], [900.01, 200, 400]);
  assert.equal(report.rows.find(row => row.campaignId === ids.A)?.leads.linear, 1.5);
});

test('BI-05 funnels count visitors in step order and report abandonment', async () => {
  const visits = new Map([
    ['v1', new Map([[0, 1], [1, 2], [2, 3], [-1, 4]])],
    ['v2', new Map([[0, 1], [1, 2]])],
    ['v3', new Map([[0, 1]])],
    ['v4', new Map([[1, 1]])],
    ['v5', new Map([[0, 10], [1, 5]])],
  ]);
  const steps = sequentialSteps(visits, [0, 1, 2, -1], new Map([[0, 'Landing']]), 'f');
  assert.deepEqual(steps.map(step => step.visitors), [4, 2, 1, 1]);
  assert.deepEqual(steps.map(step => step.label), ['Landing', 'Step 2', 'Step 3', 'Completed']);
  assert.equal(steps[1].abandonment, 0.5);
  assert.equal(steps[3].conversionFromStart, 0.25);

  for (const [visitor, step, at] of [['bv1', 0, '2020-03-03T10:00:00Z'], ['bv1', 1, '2020-03-03T10:02:00Z'], ['bv2', 0, '2020-03-04T10:00:00Z']] as const) {
    await event('funnel.step_viewed', at, { entityType: 'funnel', entityId: 'bi-funnel', visitor, properties: { stepIndex: step, funnelName: 'BI funnel' } });
  }
  const report = await funnels(await query(), user);
  const funnel = report.funnels.find(item => item.id === 'bi-funnel')!;
  assert.equal(funnel.name, 'BI funnel');
  assert.deepEqual(funnel.steps.map(step => step.visitors), [2, 1]);
  assert.deepEqual(report.lifecycle.steps.map(step => step.visitors), [3, 1, 1], 'only 9102 had a deal (D2, won) created after becoming a lead');
});

test('BI-06 drill-down lists the deals and leads behind a number with record links', async () => {
  const won = await drill(await query(), parseDrill(new URLSearchParams({ metric: 'won_deals' })), new URLSearchParams());
  assert.equal(won.total, 3);
  assert.deepEqual(won.rows.map(row => row.href), [ids.D3, ids.D2, ids.D1].map(id => `/sales/deals/${id}`));
  const leads = await drill(await query(), parseDrill(new URLSearchParams({ metric: 'leads', campaign: ids.A })), new URLSearchParams());
  assert.deepEqual(leads.rows.map(row => row.href).sort(), ['/crm/contacts/9101', '/crm/contacts/9102']);
  const stage = await drill(await query(), parseDrill(new URLSearchParams({ metric: 'open_deals', stageId: ids.proposal })), new URLSearchParams());
  assert.deepEqual(stage.rows.map(row => row.amount), [2000]);
  assert.throws(() => parseDrill(new URLSearchParams({ metric: 'everything' })));
});

test('BI-07 CSV exports neutralise formulas and carry the report rows', async () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(-5), '-5');
  const response = await exportReport('leads-by-form', await query(), user, new URLSearchParams());
  assert.match(response.headers.get('content-disposition') ?? '', /ovelio-leads-by-form-2020-03-01-to-2020-04-01\.csv/);
  const text = await response.text();
  assert.match(text, /BI form,bi-form,2/);
  assert.match(text, /'=HYPERLINK/);
  const attributionCsv = await (await exportReport('attribution', await query(), user, new URLSearchParams())).text();
  assert.match(attributionCsv, /Total \(measured\),1750\.01/);
});

test('BI-08 the preview seed is idempotent and only records revenue for real deals', async () => {
  const count = async () => Number((await db.query<{ count: string }>(`SELECT count(*) FROM events WHERE idempotency_key LIKE 'insights-seed:%'`)).rows[0].count);
  const before = await count();
  assert.ok(before > 100, 'the preview boot seeded sample history');
  await seedInsightsPreview(db);
  assert.equal(await count(), before);
  const orphans = await db.query(
    `SELECT e.id FROM events e LEFT JOIN deals d ON d.id = e.deal_id
     WHERE e.type = 'deal.won' AND (d.id IS NULL OR d.status <> 'won' OR e.amount <> d.amount)`);
  assert.equal(orphans.rows.length, 0);
  const span = await db.query<{ days: string }>(`SELECT extract(day FROM max(occurred_at) - min(occurred_at)) AS days FROM events WHERE idempotency_key LIKE 'insights-seed:%'`);
  assert.ok(Number(span.rows[0].days) >= 90, 'history spans most of 120 days');
});
