import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { emitEvent, listEvents } = await import('../../src/server/events');
const { drainPlatformJobs } = await import('../../src/server/platform/jobs');
const { getContact, tagContact } = await import('../../src/server/directory');
const { setMailTransport } = await import('../../src/server/mailer');
const { createDeal } = await import('../../src/server/records');
const { handlePlatformEvent, webhookSignature, dryRun } = await import('../../src/server/journeys/engine');
const flows = await import('../../src/server/journeys/flows');
const campaigns = await import('../../src/server/journeys/campaigns');
const { validateFlow, flowTemplates, tidyLayout, buildTrackedUrl } = await import('../../src/contracts/journeys');
type FlowGraph = import('../../src/contracts/journeys').FlowGraph;
type FlowNode = import('../../src/contracts/journeys').FlowNode;

after(async () => { await db.close(); });

const ADMIN = '00000000-0000-4000-8000-000000000001';

async function drainAll() {
  let total = 0;
  for (let i = 0; i < 40; i += 1) {
    const ran = await drainPlatformJobs({ maxJobs: 50, budgetMs: 10_000 });
    total += ran;
    if (!ran) break;
  }
  return total;
}

/** Makes every pending step job due now (simulates time passing for waits and retry back-off). */
async function fastForward() {
  await db.query(`UPDATE jobs SET run_at = now() - interval '1 second' WHERE kind = 'platform' AND status = 'pending'`);
}

function node(id: string, type: FlowNode['type'], config: Record<string, unknown> = {}): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, config };
}
function graphOf(nodes: FlowNode[], links: [string, string, ('next' | 'yes' | 'no' | 'a' | 'b')?][]): FlowGraph {
  return { nodes: [node('start', 'start'), ...nodes], edges: links.map(([source, target, sourceHandle = 'next']) => ({ id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle })) };
}

async function enrolmentsOf(flowId: string) {
  return (await db.query<{ id: string; status: string; contact_id: string; error: string; version: number }>('SELECT * FROM journey_enrolments WHERE flow_id = $1 ORDER BY enrolled_at', [flowId])).rows;
}
async function logsOf(enrolmentId: string) {
  return (await db.query<{ node_id: string; status: string; detail: string; attempt: number }>('SELECT * FROM journey_step_logs WHERE enrolment_id = $1 ORDER BY id', [enrolmentId])).rows;
}

test('JRN-01 publishing validates the graph: connections, required settings and loops without a wait', () => {
  const missing = graphOf([node('tag', 'add_tag', { tags: [] }), node('orphan', 'adjust_score', { delta: 5 })], [['start', 'tag']]);
  const issues = validateFlow(missing, []);
  assert.ok(issues.some(issue => issue.nodeId === 'tag' && /at least one tag/.test(issue.message)));
  assert.ok(issues.some(issue => issue.nodeId === 'orphan' && /Not connected/.test(issue.message)));
  assert.ok(issues.some(issue => issue.level === 'warning' && /manually/.test(issue.message)), 'no triggers is a warning, not an error');

  const loop = graphOf([node('a', 'adjust_score', { delta: 1 }), node('b', 'add_tag', { tags: ['x'] })], [['start', 'a'], ['a', 'b'], ['b', 'a']]);
  assert.ok(validateFlow(loop, []).some(issue => /loop has no wait/.test(issue.message)));
  const waited = graphOf([node('a', 'adjust_score', { delta: 1 }), node('w', 'wait', { mode: 'duration', amount: 1, unit: 'days' })], [['start', 'a'], ['a', 'w'], ['w', 'a']]);
  assert.equal(validateFlow(waited, []).filter(issue => issue.level === 'error').length, 0, 'a loop through a wait is allowed');

  assert.ok(flowTemplates.length >= 6);
  for (const template of flowTemplates) {
    const laidOut = tidyLayout(template.graph);
    assert.equal(new Set(laidOut.nodes.map(item => `${item.position.x},${item.position.y}`)).size, laidOut.nodes.length, `${template.key} layout has no overlaps`);
    const structural = validateFlow(template.graph, template.triggers).filter(issue => issue.level === 'error' && !/Choose|Enter|Add a signing|tag that starts/.test(issue.message));
    assert.deepEqual(structural, [], `${template.key} is structurally valid`);
  }
});

test('JRN-02 a real form.submitted event enrols the contact; tag, wait, email, task and deal run with complete logs; duplicates are ignored', async () => {
  setMailTransport(undefined);
  const design = (await db.query<{ id: string }>(`INSERT INTO designs (kind, name, subject, html, status) VALUES ('email', 'JRN webinar welcome', 'Welcome {{contact.first_name}}', '<p>Hi {{contact.first_name}}</p>', 'ready') RETURNING id`)).rows[0];
  const campaign = await campaigns.createCampaign({ name: 'JRN spring webinar', budget: 1000, currency: 'GBP' }, ADMIN);
  const flow = await flows.createFlow({
    name: 'JRN webinar follow-up', campaignId: campaign.id,
    triggers: [{ id: 't1', type: 'form.submitted', filters: { formId: 'form-jrn-1', formName: 'Webinar sign-up' } }],
    graph: graphOf([
      node('tag', 'add_tag', { tags: ['webinar-2026'] }),
      node('wait', 'wait', { mode: 'duration', amount: 2, unit: 'days' }),
      node('email', 'send_email', { designId: design.id, designName: 'JRN webinar welcome' }),
      node('task', 'create_task', { title: 'Call {{contact.first_name}} about the webinar', dueInDays: 1, assignee: 'owner' }),
      node('deal', 'create_deal', { name: 'Webinar lead: {{contact.full_name}}', amount: 2500 }),
    ], [['start', 'tag'], ['tag', 'wait'], ['wait', 'email'], ['email', 'task'], ['task', 'deal']]),
  }, ADMIN);
  await assert.rejects(flows.enrolContacts(flow.id, [3], ADMIN).then(result => { if (result.skipped.length) throw new Error(result.skipped[0].reason); }), /Publish/);
  const published = await flows.publishFlow(flow.id, ADMIN);
  assert.equal(published.status, 'published');
  assert.equal(published.publishedVersion, 1);

  const other = await emitEvent({ type: 'form.submitted', contactId: 2, entityType: 'form', entityId: 'another-form', idempotencyKey: 'jrn02-other' });
  const event = await emitEvent({
    type: 'form.submitted', contactId: 3, entityType: 'form', entityId: 'form-jrn-1', campaignId: campaign.id,
    properties: { formName: 'Webinar sign-up', fields: { email: 'hannah.morris@kestrel.example', role: 'Head of Ops' } }, idempotencyKey: 'jrn02-submit',
  });
  assert.ok(event && other);
  await drainAll();

  const [enrolment, ...extra] = await enrolmentsOf(flow.id);
  assert.equal(extra.length, 0, 'the other form did not enrol anyone');
  assert.equal(Number(enrolment.contact_id), 3);
  assert.equal(enrolment.status, 'waiting');
  assert.ok((await getContact(3))!.tags.includes('webinar-2026'), 'tag added through the directory');
  const pending = await db.query<{ run_at: Date }>(`SELECT run_at FROM jobs WHERE dedupe_key LIKE $1 AND status = 'pending'`, [`platform:journeys.step:${enrolment.id}:%`]);
  assert.equal(pending.rows.length, 1, 'the wait scheduled the next step as a job');
  assert.ok(new Date(pending.rows[0].run_at).getTime() > Date.now() + 47 * 3_600_000, 'about two days out');
  assert.equal(await drainAll(), 0, 'nothing runs before the wait is over');

  await fastForward();
  await drainAll();
  const [done] = await enrolmentsOf(flow.id);
  assert.equal(done.status, 'completed');
  const logs = await logsOf(done.id);
  assert.deepEqual(logs.map(log => log.node_id), ['start', 'tag', 'wait', 'email', 'task', 'deal']);
  assert.deepEqual(logs.map(log => log.status), ['ok', 'ok', 'ok', 'skipped', 'ok', 'ok']);
  assert.match(logs[3].detail, /Not sent: the developer preview has no email relay/, 'the mailer reason is logged, not a fake send');
  const message = (await db.query<{ status: string; campaign_id: string; source: string }>(`SELECT status, campaign_id, source FROM messages WHERE design_id = $1`, [design.id])).rows[0];
  assert.deepEqual(message, { status: 'not_sent', campaign_id: campaign.id, source: `flow:${flow.id}` });
  const task = (await db.query<{ title: string; assignee_id: string; contact_id: string }>(`SELECT * FROM tasks WHERE source = $1`, [`flow:${flow.id}`])).rows[0];
  assert.equal(task.title, 'Call Hannah about the webinar');
  assert.equal(task.assignee_id, ADMIN, 'assigned to the flow owner when the contact has none');
  const deal = (await db.query<{ name: string; campaign_id: string; amount: string; source: string }>(`SELECT * FROM deals WHERE source = $1`, [`flow:${flow.id}`])).rows[0];
  assert.equal(deal.name, 'Webinar lead: Hannah Morris');
  assert.equal(deal.campaign_id, campaign.id);
  assert.equal(Number(deal.amount), 2500);
  const types = (await listEvents({ contactId: 3, entityId: flow.id, types: ['flow.enrolled', 'flow.completed'] })).map(item => item.type).sort();
  assert.deepEqual(types, ['flow.completed', 'flow.enrolled']);

  // Duplicates: the same event delivered again, and a second submission (once-only flow), enrol nobody.
  await handlePlatformEvent(event!);
  await emitEvent({ type: 'form.submitted', contactId: 3, entityType: 'form', entityId: 'form-jrn-1', idempotencyKey: 'jrn02-again' });
  await drainAll();
  assert.equal((await enrolmentsOf(flow.id)).length, 1);

  const detail = await flows.getFlow(flow.id);
  assert.equal(detail.counts.completed, 1);
  assert.equal(detail.nodeStats.deal.ok, 1);
  const performance = await campaigns.campaignPerformance(campaign.id);
  assert.equal(performance.leads, 1);
  assert.equal(performance.deals.created, 1);
  assert.equal(performance.emails.notSent, 1);
  assert.equal(performance.roi, null);
  assert.match(performance.notes.roi ?? '', /No won deals/);
  assert.equal(performance.costPerLead, 1000);
});

test('JRN-03 conditions branch, A/B splits are stable, and a flow never re-triggers itself', async () => {
  const flow = await flows.createFlow({
    name: 'JRN tag loop guard', reentry: 'every_time',
    triggers: [{ id: 't1', type: 'contact.tagged', filters: { tag: 'jrn-loop' } }],
    graph: graphOf([
      node('vip', 'condition', { check: 'tag', operator: 'has', value: 'vip' }),
      node('split', 'split', { percentA: 50 }),
      node('a', 'adjust_score', { delta: 1 }), node('b', 'adjust_score', { delta: 2 }),
      node('again', 'remove_tag', { tags: ['jrn-loop'] }), node('readd', 'add_tag', { tags: ['jrn-loop'] }),
    ], [['start', 'vip'], ['vip', 'split', 'yes'], ['vip', 'again', 'no'], ['split', 'a', 'a'], ['split', 'b', 'b'], ['a', 'again'], ['b', 'again'], ['again', 'readd']]),
  }, ADMIN);
  await flows.publishFlow(flow.id, ADMIN);
  await tagContact(1, ['jrn-loop']);
  await emitEvent({ type: 'contact.tagged', contactId: 1, properties: { tags: ['jrn-loop'] }, idempotencyKey: 'jrn03-claire' });
  await tagContact(4, ['jrn-loop']);
  await emitEvent({ type: 'contact.tagged', contactId: 4, properties: { tags: ['jrn-loop'] }, idempotencyKey: 'jrn03-sam' });
  await drainAll();
  const rows = await enrolmentsOf(flow.id);
  assert.equal(rows.length, 2, 'the flow’s own re-tag did not enrol anyone again');
  assert.ok(rows.every(row => row.status === 'completed'));
  const claire = await logsOf(rows.find(row => Number(row.contact_id) === 1)!.id);
  const sam = await logsOf(rows.find(row => Number(row.contact_id) === 4)!.id);
  assert.match(claire.find(log => log.node_id === 'vip')!.detail, /^Yes: has tag “vip”/);
  assert.ok(claire.some(log => log.node_id === 'a' || log.node_id === 'b'), 'Claire took one A/B path');
  assert.match(sam.find(log => log.node_id === 'vip')!.detail, /^No:/);
  assert.ok(!sam.some(log => log.node_id === 'split'), 'Sam skipped the yes branch');
  const tagged = await listEvents({ contactId: 1, types: ['contact.tagged'] });
  assert.ok(tagged.some(item => item.source === `flow:${flow.id}`), 'the flow’s tag emitted contact.tagged for other flows');
});

test('JRN-04 webhooks are signed, failures retry with back-off and then fail the enrolment with the reason', async () => {
  const received: { body: string; signature: string; timestamp: string }[] = [];
  let status = 200;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      received.push({ body, signature: String(request.headers['x-ovelio-signature']), timestamp: String(request.headers['x-ovelio-timestamp']) });
      response.statusCode = status;
      response.end('ok');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  const secret = 'jrn-test-signing-secret-0001';
  try {
    const flow = await flows.createFlow({
      name: 'JRN webhook', reentry: 'every_time',
      graph: graphOf([node('hook', 'webhook', { url, secret })], [['start', 'hook']]),
    }, ADMIN);
    await flows.publishFlow(flow.id, ADMIN);

    delete process.env.OVELIO_WEBHOOK_ALLOW_PRIVATE;
    await flows.enrolContacts(flow.id, [2], ADMIN);
    await drainAll();
    let [blocked] = await enrolmentsOf(flow.id);
    assert.equal(blocked.status, 'failed');
    assert.match(blocked.error, /private or internal network/, 'private targets are refused without retrying');
    assert.equal(received.length, 0);

    process.env.OVELIO_WEBHOOK_ALLOW_PRIVATE = 'true';
    await flows.enrolContacts(flow.id, [2], ADMIN);
    await drainAll();
    const ok = (await enrolmentsOf(flow.id))[1];
    assert.equal(ok.status, 'completed');
    assert.equal(received.length, 1);
    assert.equal(received[0].signature, webhookSignature(secret, received[0].timestamp, received[0].body), 'HMAC-SHA256 over timestamp.body');
    assert.equal(JSON.parse(received[0].body).contact.id, 2);

    status = 503;
    await flows.enrolContacts(flow.id, [2], ADMIN);
    await drainAll();
    const failing = (await enrolmentsOf(flow.id))[2];
    assert.equal(failing.status, 'active', 'first failure is retried');
    await fastForward(); await drainAll();
    await fastForward(); await drainAll();
    const [, , failed] = await enrolmentsOf(flow.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /HTTP 503/);
    const logs = await logsOf(failed.id);
    assert.deepEqual(logs.filter(log => log.node_id === 'hook').map(log => log.attempt), [1, 2, 3]);
    assert.equal(received.length, 4);
    const failures = await listEvents({ types: ['flow.failed'], entityId: flow.id });
    assert.ok(failures.some(item => item.properties.enrolmentId === failed.id));

    // Retry from the run history once the endpoint recovers.
    status = 200;
    blocked = failed;
    const { retryEnrolment } = await import('../../src/server/journeys/engine');
    await retryEnrolment(blocked.id);
    await drainAll();
    assert.equal((await enrolmentsOf(flow.id))[2].status, 'completed');
  } finally {
    delete process.env.OVELIO_WEBHOOK_ALLOW_PRIVATE;
    server.close();
  }
});

test('JRN-05 pause holds scheduled steps, resume continues, and enrolments stay on their version', async () => {
  const flow = await flows.createFlow({
    name: 'JRN pause', reentry: 'every_time',
    graph: graphOf([node('wait', 'wait', { mode: 'duration', amount: 1, unit: 'hours' }), node('score', 'adjust_score', { delta: 3 })], [['start', 'wait'], ['wait', 'score']]),
  }, ADMIN);
  await flows.publishFlow(flow.id, ADMIN);
  const before = (await getContact(2))!.points;
  await flows.enrolContacts(flow.id, [2], ADMIN);
  await drainAll();
  await flows.setFlowStatus(flow.id, 'pause', ADMIN);
  assert.match((await flows.enrolContacts(flow.id, [1], ADMIN)).skipped[0].reason, /paused/);
  await fastForward(); await drainAll();
  const [held] = await flows.listEnrolments({ flowId: flow.id });
  assert.equal(held.held, true);
  assert.equal((await getContact(2))!.points, before, 'nothing ran while paused');

  // A new version changes the score step; the held enrolment keeps version 1.
  const draft = await flows.getFlow(flow.id);
  await flows.updateFlow(flow.id, { graph: { ...draft.graph, nodes: draft.graph.nodes.map(item => item.id === 'score' ? { ...item, config: { delta: 50 } } : item) } }, ADMIN);
  assert.equal((await flows.getFlow(flow.id)).hasUnpublishedChanges, true);
  await flows.publishFlow(flow.id, ADMIN);
  await drainAll();
  const [resumed] = await flows.listEnrolments({ flowId: flow.id });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.version, 1);
  assert.equal((await getContact(2))!.points, before + 3, 'version 1 ran');

  const copy = await flows.duplicateFlow(flow.id, ADMIN);
  assert.equal(copy.status, 'draft');
  assert.equal(copy.graph.nodes.length, 3);
  await flows.setFlowStatus(flow.id, 'archive', ADMIN);
  await assert.rejects(flows.updateFlow(flow.id, { name: 'x' }, ADMIN), /Restore/);
});

test('JRN-06 a dry run evaluates conditions and lists actions without side effects', async () => {
  const graph = graphOf([
    node('consent', 'condition', { check: 'consent', operator: 'yes' }),
    node('email', 'send_email', { designId: '00000000-0000-4000-8000-00000000dead' }),
    node('tag', 'add_tag', { tags: ['dry-run'] }), node('deal', 'create_deal', { name: 'Deal for {{contact.first_name}}' }),
  ], [['start', 'consent'], ['consent', 'tag', 'yes'], ['consent', 'email', 'no'], ['tag', 'deal']]);
  const messages = (await db.query('SELECT 1 FROM messages')).rows.length;
  const result = await dryRun(graph, [], 1);
  assert.equal(result.contact?.id, 1);
  assert.deepEqual(result.steps.map(step => step.outcome), ['branch', 'would_run', 'would_run', 'end']);
  assert.match(result.steps[2].detail, /Deal for Claire/);
  const sam = await dryRun(graph, [], 4);
  assert.match(sam.steps[0].detail, /^No: No consent/);
  assert.match(sam.steps[1].detail, /design was not found/);
  assert.ok(!(await getContact(1))!.tags.includes('dry-run'));
  assert.equal((await db.query('SELECT 1 FROM messages')).rows.length, messages);
});

test('JRN-07 deal triggers move the triggering deal without re-triggering, and campaign launch emits once', async () => {
  const pipeline = (await db.query<{ id: string }>('SELECT id FROM pipelines WHERE is_default')).rows[0].id;
  const stages = (await db.query<{ id: string; name: string }>('SELECT id, name FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position', [pipeline])).rows;
  const proposal = stages.find(stage => stage.name === 'Proposal')!;
  const negotiation = stages.find(stage => stage.name === 'Negotiation')!;
  const flow = await flows.createFlow({
    name: 'JRN deal mover', reentry: 'every_time',
    triggers: [{ id: 't1', type: 'deal.stage_changed', filters: { pipelineId: pipeline } }],
    graph: graphOf([node('move', 'move_deal', { stageId: negotiation.id, stageName: 'Negotiation' }), node('note', 'notify_owner', { message: 'Deal advanced for {{contact.first_name}}' })], [['start', 'move'], ['move', 'note']]),
  }, ADMIN);
  await flows.publishFlow(flow.id, ADMIN);
  const deal = await createDeal({ name: 'JRN deal', amount: 900, contactId: 2, stageId: proposal.id, ownerId: ADMIN, source: 'test' });
  const { moveDeal } = await import('../../src/server/records');
  await moveDeal(deal.id, { stageId: stages[0].id });
  await drainAll();
  const rows = await enrolmentsOf(flow.id);
  assert.equal(rows.length, 1, 'the flow’s own stage move did not enrol again');
  const current = (await db.query<{ stage_id: string }>('SELECT stage_id FROM deals WHERE id = $1', [deal.id])).rows[0];
  assert.equal(current.stage_id, negotiation.id);
  const notified = (await db.query<{ assignee_id: string }>(`SELECT assignee_id FROM tasks WHERE source = $1`, [`flow:${flow.id}`])).rows[0];
  assert.equal(notified.assignee_id, ADMIN, 'the deal owner was notified');

  const campaign = await campaigns.createCampaign({ name: 'JRN Q4 renewals push', budget: 500, currency: 'GBP', utmSource: 'newsletter', utmMedium: 'email' }, ADMIN);
  assert.equal(campaign.utmCampaign, 'jrn-q4-renewals-push');
  const withLink = await campaigns.addTrackedLink(campaign.id, { name: 'Pricing', destination: 'https://ovelio.example/pricing?ref=a#plans' }, ADMIN);
  assert.equal(withLink.assets[0].meta.url, 'https://ovelio.example/pricing?ref=a&utm_source=newsletter&utm_medium=email&utm_campaign=jrn-q4-renewals-push#plans');
  assert.equal(buildTrackedUrl('https://x.example', { campaign: 'c', content: 'hero' }), 'https://x.example/?utm_campaign=c&utm_content=hero');
  const linked = await campaigns.linkAsset(campaign.id, { type: 'flow', id: flow.id, label: flow.name }, ADMIN);
  assert.equal(linked.assets.length, 2);
  assert.equal((await flows.getFlow(flow.id)).campaignId, campaign.id);
  const launched = await campaigns.setCampaignStatus(campaign.id, 'launch', ADMIN);
  assert.equal(launched.status, 'active');
  await assert.rejects(campaigns.setCampaignStatus(campaign.id, 'launch', ADMIN), /cannot be launched/);
  assert.equal((await listEvents({ campaignId: campaign.id, types: ['campaign.launched'] })).length, 1);

  await db.query(`UPDATE deals SET campaign_id = $1 WHERE id = $2`, [campaign.id, deal.id]);
  const won = stages.find(stage => stage.name === 'Won')!;
  await moveDeal(deal.id, { stageId: won.id });
  const performance = await campaigns.campaignPerformance(campaign.id);
  assert.deepEqual(performance.deals.wonRevenue, [{ currency: 'GBP', amount: 900 }]);
  assert.equal(performance.roi, 80, 'ROI shown once budget and revenue exist');
  assert.match(performance.notes.costPerLead ?? '', /No leads/);
});

test('JRN-08 the preview seed adds labelled campaigns, flows and runs, and search finds them', async () => {
  const list = await campaigns.listCampaigns();
  const spring = list.find(item => item.name === 'Spring webinar series');
  assert.ok(spring && spring.status === 'active' && spring.budget === 2500);
  assert.ok(list.some(item => item.name === 'Q4 renewals push' && item.status === 'planned'));
  const detail = await campaigns.getCampaign(spring.id);
  assert.match(detail.description, /Sample campaign/);
  assert.ok(detail.assets.some(asset => asset.type === 'link' && String(asset.meta.url).includes('utm_campaign=spring-webinar-series')));
  assert.ok(detail.assets.some(asset => asset.type === 'flow'));
  const all = await flows.listFlows();
  const followUp = all.find(item => item.name === 'Webinar sign-up follow-up')!;
  assert.equal(followUp.status, 'published');
  assert.equal(followUp.triggers[0].type, 'form.submitted');
  assert.ok(followUp.counts.enrolled >= 3);
  assert.ok(all.some(item => item.name === 'Renewal reminders' && item.status === 'draft'));
  const performance = await campaigns.campaignPerformance(spring.id);
  assert.ok(performance.leads >= 4);
  assert.equal(performance.roi, 92);
  const { journeysModule } = await import('../../src/server/journeys/module');
  const results = await journeysModule.search('webinar', { id: ADMIN, email: 'a@example.com', name: 'Admin', role: 'admin' });
  assert.ok(results.some(item => item.kind === 'campaign' && item.href === `/marketing/campaigns/${spring.id}`));
  assert.ok(results.some(item => item.kind === 'flow' && item.href === `/automations/flows/${followUp.id}`));
});
