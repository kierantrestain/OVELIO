import assert from 'node:assert/strict';
import test from 'node:test';
import {
  branches, currentRunNodes, editableNodeSpec, emptySchedule, intervalSchedule, nodePropertyIssues, validateWorkflowGraph,
  workflowNodeSpec, workflowNodeSpecs, workflowRunStates,
} from '../../src/contracts';
import type { WorkflowGraph, WorkflowNode, WorkflowRunEntry, WorkflowSchedule } from '../../src/contracts';
import { createMautic } from '../../src/server/mautic';
import { graphPayload, mergeRunEntries, toWorkflow } from '../../src/server/mautic/workflows';
import { automationsEndpoints } from '../../src/server/routes/automations';

type Id = string | number;
type Row = Record<string, unknown>;
type SentEvent = Row & { id: Id; properties: Row | unknown[]; name: string; type: string };
type SentPayload = Row & {
  events: SentEvent[];
  canvasSettings: { nodes: { id: Id }[]; connections: { sourceId: Id; targetId: Id; anchors: { source: string; target: string } }[] };
};

function client(handler: (request: Request) => Response | Promise<Response>) {
  return createMautic({
    url: 'http://marketing-engine.local/', username: 'integration', password: 'unit-test-password',
    fetch: async (input, init) => handler(new Request(input, init)),
  });
}

/**
 * Mimics CampaignModel::setEvents + setCanvasSettings, plus CampaignActionJumpToEventSubscriber::
 * processCampaignEventsAfterSave, which swaps a jump step's temporary target for the saved id.
 */
function engineSave(payload: SentPayload, stored: Record<string, Row> = {}, nextId = { value: 300 }) {
  const ids = new Map<Id, number>();
  for (const event of payload.events) ids.set(event.id, typeof event.id === 'string' ? nextId.value++ : event.id);
  const real = (id: Id) => ids.get(id) ?? id;
  const relationships = new Map<number, { parent: number; anchor: string }>();
  for (const edge of payload.canvasSettings.connections) {
    if (edge.sourceId === 'lists' || edge.sourceId === 'forms' || edge.anchors.source === 'leadsource') continue;
    relationships.set(Number(real(edge.targetId)), { parent: Number(real(edge.sourceId)), anchor: edge.anchors.source });
  }
  const events: Record<string, Row> = {};
  for (const sent of payload.events) {
    const id = Number(real(sent.id));
    const relation = relationships.get(id);
    let properties = sent.properties;
    if (sent.type === 'campaign.jump_to_event' && properties && !Array.isArray(properties) && typeof properties.jumpToEvent === 'string') {
      assert.ok(ids.has(properties.jumpToEvent), 'a jump target sent with a temporary id names an event in the same payload');
      properties = { ...properties, jumpToEvent: real(properties.jumpToEvent) };
    }
    events[id] = {
      ...(stored[id] ?? {}), ...sent, properties, id,
      parent: relation ? { id: relation.parent } : null,
      decisionPath: relation && ['yes', 'no'].includes(relation.anchor) ? relation.anchor : null,
    };
  }
  return {
    ...payload, id: 41, events,
    canvasSettings: {
      nodes: payload.canvasSettings.nodes.map(node => ({ ...node, id: String(real(node.id)) })),
      connections: payload.canvasSettings.connections.map(edge => ({ ...edge, sourceId: String(real(edge.sourceId)), targetId: String(real(edge.targetId)) })),
    },
  };
}

const immediate = () => emptySchedule('immediate');
function node(id: string, type: string, properties: Row, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  const spec = workflowNodeSpec(type);
  const eventType = extra.eventType ?? spec?.eventType ?? 'action';
  return {
    id, parentId: null, branch: null, eventType, type, name: extra.name ?? `${type} ${id}`, description: '', properties,
    schedule: eventType === 'decision' ? emptySchedule(null) : immediate(), ...extra,
  };
}
const graphOf = (nodes: WorkflowNode[]): WorkflowGraph => ({ segmentIds: [3], formIds: [], allowRestart: false, nodes });
const errorsOf = (graph: WorkflowGraph) => validateWorkflowGraph(graph).filter(issue => issue.level === 'error').map(issue => issue.message);

const conditionTypes = [
  'lead.field_value', 'lead.device', 'lead.pageHit', 'lead.tags', 'lead.segments', 'lead.stages', 'lead.owner', 'lead.attached',
  'lead.campaigns', 'lead.dnc', 'lead.points', 'form.field_value', 'email.validate.address', 'notification.has.active',
];
const actionTypes = [
  'email.send', 'email.send.to.user', 'message.send', 'sms.send_text_sms', 'notification.send_notification',
  'notification.send_mobile_notification', 'tracking.pixel.send', 'focus.show', 'dwc.push_content', 'campaign.sendwebhook',
  'plugin.leadpush', 'twitter.tweet', 'lead.changepoints', 'lead.changelist', 'lead.updatelead', 'lead.updatecompany',
  'lead.changetags', 'lead.addtocompany', 'lead.changeowner', 'lead.scorecontactscompanies', 'lead.adddnc', 'lead.removednc',
  'lead.deletecontact', 'stage.change', 'campaign.addremovelead', 'campaign.jump_to_event',
];
const unavailableTypes = ['sms.send_text_sms', 'notification.send_notification', 'notification.send_mobile_notification', 'tracking.pixel.send', 'plugin.leadpush', 'twitter.tweet'];

/** A valid payload per available type, with Mautic's exact property keys and the value shapes its forms store. */
const samples: Record<string, Row> = {
  'email.send': { email: 4, email_type: 'marketing', priority: 2, attempts: 3 },
  'email.send.to.user': { useremail: { email: 6 }, user_id: [1, '2'], to_owner: true, to: 'sales@example.test, {contactfield=owner_email}', cc: '', bcc: '' },
  'message.send': { marketingMessage: 5 },
  'campaign.sendwebhook': {
    url: 'https://hooks.example.test/contact?id={contactfield=id}', method: 'post', timeout: 10,
    headers: { list: [{ label: 'X-Team', value: 'nordics' }] }, additional_data: { list: [{ label: 'email', value: '{contactfield=email}' }] },
  },
  'lead.changepoints': { points: -5, group: '2' },
  'lead.changelist': { addToLists: [5], removeFromLists: ['2'] },
  'lead.updatelead': { firstname: '{contactfield=firstname|Friend}', newsletter: 1, interests: ['a', 'b'], score_note: null },
  'lead.updatecompany': { companyname: 'Example Ltd', companycity: 'Oslo' },
  'lead.changetags': { add_tags: ['engaged'], remove_tags: ['cold'] },
  'lead.addtocompany': { company: 9 },
  'lead.changeowner': { owner: 2 },
  'lead.scorecontactscompanies': { score: 15 },
  'lead.adddnc': { channels: ['email'], reason: 'Asked to stop' },
  'lead.removednc': { channels: ['email', 'sms'] },
  'lead.deletecontact': {},
  'stage.change': { stage: '6' },
  'campaign.addremovelead': { addTo: [12], removeFrom: ['this'] },
  'campaign.jump_to_event': { jumpToEvent: 'new_root' },
  'dwc.push_content': { dynamicContent: 3 },
  'focus.show': { focus: 4 },
  'lead.field_value': { field: 'country', operator: 'in', value: ['Norway', 'Sweden'] },
  'lead.device': { device_type: ['smartphone'], device_brand: ['AP'], device_os: ['iOS'] },
  'lead.pageHit': { page: '', page_url: 'https://example.test/pricing*', startDate: '2026-11-01 00:00', endDate: '', accumulative_time: 30, accumulative_time_unit: 's', returns_within_unit: 's' },
  'lead.tags': { tags: ['vip', 'beta'] },
  'lead.segments': { segments: [3, '8'] },
  'lead.stages': { stages: [6] },
  'lead.owner': { owner: [2] },
  'lead.attached': { timestamp: 'campaign_start_date', operator: 'lt', triggerInterval: '14', triggerIntervalUnit: 'd' },
  'lead.campaigns': { campaigns: [12], dataAddedLimit: 1, expr: 'gt', dateAdded: '2026-10-01 00:00' },
  'lead.dnc': { channels: ['email'], reason: 2 },
  'lead.points': { operator: 'gte', score: 50, group: null },
  'form.field_value': { form: 22, field: 'plan', operator: '=', value: 'Growth' },
  'email.validate.address': {},
  'notification.has.active': {},
  'email.open': {},
  'email.click': {},
};

test('AUT-03 the catalogue holds all 14 engine conditions as immediate yes/no steps, distinct from decisions', () => {
  const conditions = workflowNodeSpecs.filter(spec => spec.eventType === 'condition').map(spec => spec.type).sort();
  assert.deepEqual(conditions, [...conditionTypes].sort());
  for (const type of conditionTypes) {
    const spec = editableNodeSpec(type)!;
    assert.ok(spec, `${type} is editable`);
    assert.ok(spec.schema, `${type} has a property schema`);
    assert.ok(branches({ eventType: spec.eventType }), `${type} answers yes or no`);
    assert.match(spec.source, /EventListener\/.+\.php:\d+$/);
  }
  assert.deepEqual(workflowNodeSpecs.filter(spec => spec.eventType === 'decision').map(spec => spec.type).sort(), ['email.click', 'email.open']);
  // A condition on a decision's no path does not need a wait; it is evaluated at once.
  const graph = graphOf([
    node('1', 'email.send', { email: 4, email_type: 'marketing' }),
    node('2', 'email.open', {}, { parentId: '1' }),
    node('3', 'lead.tags', { tags: ['vip'] }, { parentId: '2', branch: 'no' }),
    node('4', 'lead.changepoints', { points: 5 }, { parentId: '3', branch: 'yes' }),
    node('5', 'lead.changepoints', { points: -5 }, { parentId: '3', branch: 'no' }),
  ]);
  assert.deepEqual(errorsOf(graph), []);
});

test('AUT-05 the catalogue holds all 26 engine actions, with a reason for each one a stock install does not register', () => {
  const actions = workflowNodeSpecs.filter(spec => spec.eventType === 'action').map(spec => spec.type).sort();
  assert.deepEqual(actions, [...actionTypes].sort());
  assert.equal(actions.length, 26);
  for (const type of actionTypes) {
    const spec = workflowNodeSpec(type)!;
    if (unavailableTypes.includes(type)) {
      assert.ok(spec.unavailable && spec.unavailable.length > 40, `${type} explains why it is unavailable`);
      assert.equal(editableNodeSpec(type), undefined);
    } else {
      assert.ok(spec.schema && !spec.unavailable, `${type} is configurable`);
      assert.ok(samples[type], `${type} has a round-trip sample`);
      assert.deepEqual(nodePropertyIssues({ type, properties: samples[type] }), [], `${type} sample is valid`);
    }
  }
  assert.equal(workflowNodeSpec('lead.deletecontact')!.leaf, true);
  assert.equal(workflowNodeSpec('campaign.jump_to_event')!.leaf, true);
  assert.deepEqual(workflowNodeSpec('focus.show')!.parentTypes, ['page.pagehit']);
  assert.deepEqual(workflowNodeSpec('dwc.push_content')!.parentTypes, ['dwc.decision']);
});

test('AUT-03 AUT-05 every available step round-trips through the adapter with its properties unchanged', async () => {
  const nodes: WorkflowNode[] = [node('new_root', 'email.send', samples['email.send'], { name: 'root' })];
  for (const spec of workflowNodeSpecs) {
    if (spec.unavailable || spec.type === 'email.send' || spec.eventType === 'decision') continue;
    const id = `new_${spec.type.replace(/\W/g, '_')}`;
    if (spec.type === 'focus.show' || spec.type === 'dwc.push_content') {
      // Their parent decisions are engine types the console keeps as advanced steps.
      const parentType = spec.parentTypes![0];
      nodes.push(node(`${id}_parent`, parentType, parentType === 'page.pagehit' ? { pages: [1] } : { dwc_slot_name: 'hero', dynamicContent: 3 },
        { eventType: 'decision', name: `${parentType} parent` }));
      nodes.push(node(id, spec.type, samples[spec.type], { parentId: `${id}_parent`, branch: 'yes', name: spec.type }));
    } else {
      const schedule: WorkflowSchedule = spec.type === 'campaign.addremovelead' ? intervalSchedule(1, 'd') : immediate();
      nodes.push(node(id, spec.type, samples[spec.type], { name: spec.type, schedule }));
    }
  }
  nodes.push(node('new_open', 'email.open', {}, { parentId: 'new_root', name: 'email.open' }));
  nodes.push(node('new_click', 'email.click', {}, { parentId: 'new_root', name: 'email.click' }));
  const graph = graphOf(nodes);
  assert.deepEqual(errorsOf(graph), []);

  let posted: SentPayload | undefined;
  let stored: Row = {};
  const api = client(async request => {
    if (request.method === 'POST') {
      posted = await request.json() as SentPayload;
      stored = engineSave(posted);
      return Response.json({ campaign: stored }, { status: 201 });
    }
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  });
  const saved = await api.createWorkflow({ name: 'Catalogue', segmentId: 3, steps: [], graph });
  assert.ok(posted);
  const sentByName = new Map(posted.events.map(event => [event.name, event]));
  for (const original of nodes) {
    const sent = sentByName.get(original.name)!;
    const expected = Object.keys(original.properties).length ? original.properties : [];
    if (original.type === 'campaign.jump_to_event') {
      assert.equal(sent.properties && !Array.isArray(sent.properties) ? sent.properties.jumpToEvent : null, sentByName.get('root')!.id,
        'the jump target is sent as the target event’s temporary id');
    } else {
      assert.deepEqual(sent.properties, expected, `${original.type} is sent exactly as stored`);
    }
    assert.equal(sent.type, original.type);
  }
  const savedByName = new Map(saved.graph!.nodes.map(item => [item.name, item]));
  for (const original of nodes) {
    const reread = savedByName.get(original.name)!;
    assert.equal(reread.eventType, original.eventType);
    if (original.type === 'campaign.jump_to_event') assert.equal(String(reread.properties.jumpToEvent), savedByName.get('root')!.id);
    else assert.deepEqual(reread.properties, original.properties, `${original.type} reads back unchanged`);
  }
  assert.equal(savedByName.get('focus.show')!.branch, 'yes');
  assert.equal(savedByName.get('page.pagehit parent')!.type, 'page.pagehit');

  // A second save of the engine's graph sends the same properties again.
  const again = graphPayload(saved.graph!, { name: 'Catalogue' }).payload as unknown as SentPayload;
  const storedEvents = (stored as { events: Record<string, Row> }).events;
  for (const event of again.events) assert.deepEqual(event.properties, storedEvents[String(event.id)].properties);

  // Creating from a graph with saved ids (a copy) re-points the jump at the copy of its target.
  const copy = graphOf([node('7', 'email.send', samples['email.send'], { name: 'first' }), node('8', 'campaign.jump_to_event', { jumpToEvent: 7 }, { name: 'jump' })]);
  await api.createWorkflow({ name: 'Copy', segmentId: 3, steps: [], graph: copy });
  const copied = new Map(posted.events.map(event => [event.name, event]));
  assert.equal((copied.get('jump')!.properties as Row).jumpToEvent, copied.get('first')!.id);
});

test('AUT-03 AUT-05 invalid properties are rejected with readable messages before anything is written', () => {
  const cases: [string, Row, string][] = [
    ['lead.field_value', { field: 'country', operator: '=', value: '' }, 'Contact field value: Enter the value to compare with.'],
    ['lead.field_value', { field: 'tags', operator: 'gt', value: 'vip' }, 'Compare tags with equals'],
    ['lead.field_value', { field: 'last_active', operator: 'date', value: 'next week' }, 'Choose a relative date'],
    ['lead.field_value', { field: 'x; DROP TABLE leads', operator: '=', value: '1' }, 'Choose the field to check.'],
    ['lead.field_value', { field: 'interests', operator: 'in_all', value: ['a'] }, 'Choose how to compare the field.'],
    ['campaign.sendwebhook', { url: 'ftp://files.example.test', method: 'post' }, 'Send a webhook: Enter the full webhook address'],
    ['campaign.sendwebhook', { url: 'https://hooks.example.test', method: 'post', headers: { list: [{ label: '', value: 'x' }] } }, 'Give every header a name.'],
    ['campaign.sendwebhook', { url: 'https://hooks.example.test', method: 'trace' }, 'Choose GET, POST, PUT, PATCH or DELETE.'],
    ['lead.dnc', { channels: [] }, 'Choose at least one channel.'],
    ['lead.dnc', { channels: ['email'], reason: '2' }, 'Choose unsubscribed, bounced or manual'],
    ['lead.changepoints', { points: 0 }, 'Set a non-zero whole number of points.'],
    ['lead.changetags', { add_tags: ['-cold'], remove_tags: [] }, 'A tag cannot start with a hyphen.'],
    ['lead.updatelead', { 'first name': 'Ada' }, 'is not a contact field alias'],
    ['lead.updatelead', {}, 'Set at least one contact field.'],
    ['email.send.to.user', { useremail: { email: 6 }, user_id: [], to_owner: false, to: '' }, 'Choose at least one user, the contact owner or a To address.'],
    ['email.send.to.user', { useremail: { email: 6 }, to: 'not-an-address' }, 'Use email addresses or {contactfield=alias} tokens in To.'],
    ['email.send', { email: 0, email_type: 'marketing' }, 'Send email: Choose an email to send.'],
    ['lead.pageHit', { page: '', page_url: '' }, 'Choose a landing page or enter a URL.'],
    ['lead.pageHit', { page_url: 'https://example.test', startDate: '2026-12-01 00:00', endDate: '2026-11-01 00:00' }, 'must come before the end'],
    ['lead.campaigns', { campaigns: [12], dataAddedLimit: true, expr: 'gt', dateAdded: '' }, 'Choose the date to compare with.'],
    ['form.field_value', { form: 0, field: 'plan', operator: '=', value: 'Growth' }, 'Choose a lead form.'],
    ['lead.attached', { timestamp: 'campaign_start_date', operator: 'lt', triggerInterval: 2, triggerIntervalUnit: 'w' }, 'Choose minutes, hours, days, months or years.'],
    ['lead.points', { operator: 'like', score: 5 }, 'Choose how to compare the points.'],
    ['lead.owner', { owner: [] }, 'Choose an owner.'],
    ['campaign.addremovelead', { addTo: [], removeFrom: [] }, 'Add to or remove from at least one workflow.'],
    ['stage.change', { stage: 'six' }, 'Change stage: Choose a stage.'],
  ];
  for (const [type, properties, message] of cases) {
    const errors = errorsOf(graphOf([node('1', type, properties)]));
    assert.ok(errors.some(error => error.includes(message)), `${type}: expected “${message}”, got ${JSON.stringify(errors)}`);
  }
  assert.throws(() => graphPayload(graphOf([node('1', 'lead.dnc', { channels: [] })]), { name: 'x' }),
    (error: unknown) => (error as { status?: number }).status === 400 && /Marked do not contact: Choose at least one channel\./.test(String((error as Error).message)));

  // Graph-level rules from the engine's connection restrictions and validators.
  const loop = (schedule: WorkflowSchedule) => errorsOf(graphOf([node('1', 'campaign.addremovelead', { addTo: ['this'], removeFrom: [] }, { schedule })]));
  assert.ok(loop(immediate()).some(error => error.includes('needs a wait')));
  assert.ok(loop(intervalSchedule(10, 'i')).some(error => error.includes('at least 30 minutes')));
  assert.deepEqual(loop(intervalSchedule(1, 'h')), []);
  assert.ok(errorsOf(graphOf([node('1', 'campaign.jump_to_event', { jumpToEvent: '99' })])).some(error => error.includes('not in this workflow')));
  assert.ok(errorsOf(graphOf([node('1', 'campaign.jump_to_event', { jumpToEvent: '1' })])).some(error => error.includes('cannot jump to itself')));
  assert.ok(errorsOf(graphOf([node('1', 'lead.deletecontact', {}), node('2', 'lead.changepoints', { points: 1 }, { parentId: '1' })]))
    .some(error => error.includes('Nothing can follow')));
  assert.ok(errorsOf(graphOf([node('1', 'focus.show', { focus: 4 })])).some(error => error.includes('must come straight after the yes path of a “Visits a page” decision')));
  const dwcParent = node('1', 'dwc.decision', { dwc_slot_name: 'hero' }, { eventType: 'decision' });
  assert.ok(errorsOf(graphOf([dwcParent, node('2', 'dwc.push_content', { dynamicContent: 3 }, { parentId: '1', branch: 'no', schedule: intervalSchedule(1, 'd') })]))
    .some(error => error.includes('can only be on the yes path')));
  assert.ok(errorsOf(graphOf([dwcParent, node('2', 'dwc.push_content', { dynamicContent: 3 }, { parentId: '1', branch: 'yes', schedule: intervalSchedule(1, 'd') })]))
    .some(error => error.includes('Remove its wait')));

  // Marketing emails go once per contact; transactional ones may repeat.
  const twice = (emailType: string) => errorsOf(graphOf([
    node('1', 'email.send', { email: 4, email_type: emailType }),
    node('2', 'email.send', { email: '4', email_type: emailType }, { parentId: '1' }),
  ]));
  assert.ok(twice('marketing').some(error => error.includes('already sent earlier')));
  assert.deepEqual(twice('transactional'), []);

  // Engine quirks are warnings, not errors.
  const owners = validateWorkflowGraph(graphOf([node('1', 'lead.owner', { owner: [1, 2] })]));
  assert.ok(owners.some(issue => issue.level === 'warning' && issue.message.includes('only the first owner matches')));
  assert.ok(!owners.some(issue => issue.level === 'error'));
});

test('AUT-03 AUT-05 unknown and unavailable engine types survive edits as advanced steps', async () => {
  const sms = node('101', 'sms.send_text_sms', { sms: 7 }, { name: 'Text them' });
  const plugin = node('102', 'custom.plugin_action', { config: { nested: [1, { deep: true }] }, mode: 'x' }, { parentId: '101', name: 'Plugin step' });
  const check = node('103', 'lead.tags', { tags: ['vip'] }, { parentId: '102', name: 'VIP?' });
  const native = engineSave(graphPayload(graphOf([sms, plugin, check]), { name: 'Native', nonce: 'n1' }).payload as unknown as SentPayload, {}, { value: 101 });
  const opened = toWorkflow(native);
  assert.equal(opened.editable, true);
  const issues = validateWorkflowGraph(opened.graph!);
  assert.ok(!issues.some(issue => issue.level === 'error'), JSON.stringify(issues));
  assert.ok(issues.some(issue => issue.level === 'warning' && issue.message.includes('SMS transport')));

  let put: SentPayload | undefined;
  const api = client(async request => {
    if (request.method === 'GET') return Response.json({ campaign: { ...native, isPublished: false } });
    put = await request.json() as SentPayload;
    return Response.json({ campaign: engineSave(put, native.events as Record<string, Row>) });
  });
  const edited = { ...opened.graph!, nodes: [...opened.graph!.nodes, node('new_x', 'lead.changepoints', { points: 3 }, { parentId: '103', branch: 'yes', name: 'Score VIP' })] };
  const saved = await api.updateWorkflow(41, { name: 'Native', segmentId: 3, steps: [], graph: edited });
  const byId = new Map(put!.events.map(event => [String(event.id), event]));
  assert.deepEqual(byId.get('101')!.properties, { sms: 7 });
  assert.deepEqual(byId.get('102')!.properties, { config: { nested: [1, { deep: true }] }, mode: 'x' });
  assert.equal(byId.get('102')!.type, 'custom.plugin_action');
  assert.equal(saved.graph!.nodes.length, 4);
});

test('AUT-03 AUT-05 the update guard still refuses to drop saved steps that were not deleted on purpose', async () => {
  const graph = graphOf([
    node('new1', 'lead.field_value', { field: 'country', operator: '=', value: 'Norway' }, { name: 'Norway?' }),
    node('new2', 'campaign.sendwebhook', samples['campaign.sendwebhook'], { parentId: 'new1', branch: 'yes', name: 'Hook' }),
    node('new3', 'lead.adddnc', { channels: ['email'], reason: '' }, { parentId: 'new1', branch: 'no', name: 'Stop' }),
  ]);
  const campaign = engineSave(graphPayload(graph, { name: 'Guard', nonce: 'g1' }).payload as unknown as SentPayload, {}, { value: 500 });
  const opened = toWorkflow(campaign).graph!;
  const requests: string[] = [];
  let put: SentPayload | undefined;
  const api = client(async request => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    if (request.method === 'GET') return Response.json({ campaign });
    put = await request.json() as SentPayload;
    return Response.json({ campaign: engineSave(put, campaign.events as Record<string, Row>) });
  });
  const withoutHook = { ...opened, nodes: opened.nodes.filter(item => item.name !== 'Hook') };
  const hookId = opened.nodes.find(item => item.name === 'Hook')!.id;
  await assert.rejects(() => api.updateWorkflow(41, { name: 'Guard', segmentId: 3, steps: [], graph: withoutHook }), { status: 409 });
  assert.deepEqual(requests, ['GET /api/campaigns/41'], 'nothing is written');
  await api.updateWorkflow(41, { name: 'Guard', segmentId: 3, steps: [], graph: withoutHook, removedNodeIds: [hookId] });
  assert.ok(put && !put.events.some(event => String(event.id) === hookId));
});

test('AUT-03 AUT-05 activation checks every referenced record on every branch', async () => {
  const graph = graphOf([
    node('new1', 'email.send', { email: 4, email_type: 'marketing' }, { name: 'Offer' }),
    node('new2', 'email.open', {}, { parentId: 'new1', name: 'Opened?' }),
    node('new3', 'stage.change', { stage: 6 }, { parentId: 'new2', branch: 'yes', name: 'To sales' }),
    node('new4', 'lead.addtocompany', { company: 9 }, { parentId: 'new2', branch: 'no', name: 'Link company', schedule: intervalSchedule(3, 'd') }),
    node('new5', 'form.field_value', { form: 22, field: 'plan', operator: '=', value: 'Growth' }, { parentId: 'new3', name: 'Growth plan?' }),
    node('new6', 'lead.segments', { segments: [8] }, { parentId: 'new4', name: 'In VIP?' }),
    node('new7', 'email.send.to.user', { useremail: { email: 7 }, user_id: [2], to_owner: false }, { parentId: 'new6', branch: 'yes', name: 'Tell sales' }),
    node('new8', 'sms.send_text_sms', { sms: 3 }, { parentId: 'new6', branch: 'no', name: 'Text' }),
  ]);
  const campaign = engineSave(graphPayload(graph, { name: 'Refs', nonce: 'r1' }).payload as unknown as SentPayload);
  let fixed = false;
  let live = false;
  const fetched: string[] = [];
  const email = (id: number) => ({ id, isPublished: true, emailType: 'template', sendToDnc: false, customHtml: '<a href="{unsubscribe_url}">Unsubscribe</a>' });
  const api = client(async request => {
    const path = new URL(request.url).pathname;
    fetched.push(`${request.method} ${path}`);
    if (path === '/api/campaigns/41' && request.method === 'GET') return Response.json({ campaign: { ...campaign, isPublished: live } });
    if (path === '/api/campaigns/41/edit') {
      live = (await request.json() as { isPublished: boolean }).isPublished;
      return Response.json({ campaign: { ...campaign, isPublished: live } });
    }
    if (path === '/api/segments/3') return Response.json({ list: { id: 3, isPublished: true } });
    if (path === '/api/segments/8') return Response.json({ list: { id: 8, isPublished: false } });
    if (path === '/api/emails/4' || path === '/api/emails/7') return Response.json({ email: email(Number(path.split('/').at(-1))) });
    if (path === '/api/stages/6') return Response.json({ stage: { id: 6, isPublished: fixed } });
    if (path === '/api/companies/9') return fixed ? Response.json({ company: { id: 9 } }) : Response.json({ errors: [{ code: 404 }] }, { status: 404 });
    if (path === '/api/forms/22') return Response.json({ form: { id: 22, fields: [{ alias: 'email' }, ...(fixed ? [{ alias: 'plan' }] : [])] } });
    if (path === '/api/users/2') return Response.json({ user: { id: 2 } });
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  });
  await assert.rejects(() => api.setWorkflowEnabled(41, true), (error: unknown) => {
    const message = String((error as Error).message);
    return (error as { status?: number }).status === 409 && message.includes('stage #6, which is unpublished')
      && message.includes('company #9, which no longer exists') && message.includes('field “plan”');
  });
  for (const path of ['/api/stages/6', '/api/companies/9', '/api/forms/22', '/api/segments/8', '/api/emails/7', '/api/users/2']) {
    assert.ok(fetched.includes(`GET ${path}`), `${path} is checked`);
  }
  assert.ok(!fetched.some(entry => entry.startsWith('PATCH')), 'nothing is published');
  assert.ok(!fetched.some(entry => entry.includes('/sms')), 'unavailable steps are left to the engine');
  fixed = true;
  assert.equal((await api.setWorkflowEnabled(41, true)).enabled, true);
});

const restRow = (eventId: number, eventType: string, fields: Row) => ({
  event: { id: eventId, name: `Step ${eventId}`, type: 'x', eventType }, campaign: { id: 41, name: 'Nurture' },
  dateTriggered: null, isScheduled: false, triggerDate: null, metadata: [], nonActionPathTaken: null, rotation: 1, ...fields,
});
const activityRow = (logId: number, eventId: number, fields: Row, type = 'campaign.event') => ({
  event: type, eventId: `${type}${logId}`, timestamp: fields.dateTriggered ?? null,
  details: { log: { log_id: String(logId), event_id: String(eventId), campaign_id: '41', event_name: `Step ${eventId}`, campaign_name: 'Nurture',
    type: 'x', isScheduled: '0', dateTriggered: null, triggerDate: null, metadata: [], nonActionPathTaken: null, fail_reason: null, lead_id: '17', ...fields } },
});

function logClient(rest: unknown[], activity: unknown[], seen: URL[], options: { campaignMembership?: unknown; campaignStatus?: number } = {}) {
  return client(async request => {
    const url = new URL(request.url);
    seen.push(url);
    if (url.pathname === '/api/campaigns/events/contact/17') return Response.json({ total: rest.length, events: rest });
    if (url.pathname === '/api/campaigns/41/events/contact/17') {
      if (options.campaignStatus) return Response.json({ errors: [{ message: 'Contact 17 is not in campaign 41' }] }, { status: options.campaignStatus });
      return Response.json({ total: rest.length, events: rest, campaign: { id: 41 }, membership: options.campaignMembership ?? [] });
    }
    if (url.pathname === '/api/contacts/17/activity') return Response.json({ events: activity, total: activity.length, page: 1, limit: 100, maxPages: 1 });
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });
}

test('AUT-06 the run log joins the REST event log with the activity feed and reads every state', async () => {
  const rest = [
    restRow(101, 'action', { dateTriggered: '2026-11-20T10:00:00+00:00' }),
    restRow(102, 'decision', { dateTriggered: '2026-11-23T10:00:00+00:00', nonActionPathTaken: true }),
    restRow(105, 'condition', { dateTriggered: '2026-11-23T10:05:00+00:00', nonActionPathTaken: true }),
    restRow(106, 'action', { dateTriggered: '2026-11-23T10:05:00+00:00', isScheduled: true, triggerDate: '2026-11-23T11:05:00+00:00',
      metadata: { failed: 1, reason: 'Webhook answered <b>500</b><br />Server error' } }),
    restRow(107, 'action', { dateTriggered: '2026-11-23T10:06:00+00:00', metadata: { failed: 1, reason: 'Stage missing' } }),
    restRow(108, 'action', { dateTriggered: null, isScheduled: false }),
  ];
  const activity = [
    // Written by cron: no IP address, so only the activity feed has it.
    activityRow(901, 104, { isScheduled: '1', triggerDate: '2026-11-26 10:00:00' }, 'campaign.event.scheduled'),
    // The same failed webhook row, with the failed-log reason.
    activityRow(906, 106, { isScheduled: '1', dateTriggered: '2026-11-23 10:05:00', triggerDate: '2026-11-23 11:05:00', metadata: { failed: 1, reason: 'Webhook answered <b>500</b><br />Server error' }, fail_reason: 'Webhook answered 500' }, 'campaign.event.scheduled'),
    // A failure the engine did not reschedule: only the failed-log table says it failed.
    activityRow(909, 109, { dateTriggered: '2026-11-22 09:00:00', fail_reason: 'Company missing', metadata: { failed: 1, reason: 'Company missing' } }),
    { event: 'email.sent', eventId: 'email.sent1', details: {} },
  ];
  const seen: URL[] = [];
  const log = await logClient(rest, activity, seen).contactWorkflowLog(17);
  assert.equal(log.complete, true);
  const byNode = new Map(log.entries.map(entry => [entry.nodeId, entry]));
  assert.equal(log.entries.length, 8, 'the duplicate webhook row collapses into one');
  assert.deepEqual([byNode.get('101')!.state, byNode.get('101')!.path], ['executed', null]);
  assert.deepEqual([byNode.get('102')!.state, byNode.get('102')!.path, byNode.get('102')!.nonAction], ['executed', 'no', true]);
  assert.equal(byNode.get('105')!.path, 'no');
  assert.deepEqual([byNode.get('104')!.state, byNode.get('104')!.scheduledFor, byNode.get('104')!.logId], ['scheduled', '2026-11-26T10:00:00.000Z', 901]);
  const hook = byNode.get('106')!;
  assert.deepEqual([hook.state, hook.scheduledFor, hook.reason, hook.logId], ['failed', '2026-11-23T11:05:00.000Z', 'Webhook answered 500 ; Server error', 906]);
  assert.deepEqual([byNode.get('107')!.state, byNode.get('107')!.reason], ['executed', 'Stage missing'], 'a pass with an error moved on');
  assert.equal(byNode.get('108')!.state, 'cancelled');
  assert.deepEqual([byNode.get('109')!.state, byNode.get('109')!.reason, byNode.get('109')!.scheduledFor], ['failed', 'Company missing', null]);
  assert.equal(log.entries[0].nodeId, '104', 'newest first');

  const restUrl = seen.find(url => url.pathname === '/api/campaigns/events/contact/17')!;
  assert.deepEqual([restUrl.searchParams.get('start'), restUrl.searchParams.get('limit')], ['0', '200']);
  const activityUrl = seen.find(url => url.pathname === '/api/contacts/17/activity')!;
  assert.deepEqual(activityUrl.searchParams.getAll('filters[includeEvents][]'), ['campaign.event', 'campaign.event.scheduled']);

  // Merging is order-independent for a matching row.
  const merged = mergeRunEntries([hook], [{ ...hook, logId: 5, reason: null }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].logId, 906);
});

test('AUT-06 one workflow’s log carries the membership, drops other workflows and handles contacts never added', async () => {
  const rest = [restRow(101, 'action', { dateTriggered: '2026-11-20T10:00:00+00:00', rotation: 2 })];
  const activity = [activityRow(1, 101, { dateTriggered: '2026-11-20 10:00:00' }), { ...activityRow(2, 900, { dateTriggered: '2026-11-21 10:00:00' }),
    details: { log: { ...activityRow(2, 900, {}).details.log, campaign_id: '77', dateTriggered: '2026-11-21 10:00:00' } } }];
  const membership = [{ dateAdded: '2026-11-19T09:00:00+00:00', manuallyRemoved: false, manuallyAdded: true, rotation: 2, dateLastExited: null }];
  const run = await logClient(rest, activity, [], { campaignMembership: membership }).workflowContactLog(41, 17);
  assert.deepEqual(run.membership, { dateAdded: '2026-11-19T09:00:00.000Z', manuallyRemoved: false, manuallyAdded: true, rotation: 2, dateLastExited: null });
  assert.deepEqual(run.entries.map(entry => [entry.nodeId, entry.rotation, entry.logId]), [['101', 2, 1]]);

  const never = await logClient([], [], [], { campaignStatus: 409 }).workflowContactLog(41, 17);
  assert.equal(never.membership, null);
  assert.deepEqual(never.entries, []);
});

test('AUT-06 run states mark executed, scheduled, failed, waiting and pending steps on the graph', () => {
  const graph = graphOf([
    node('101', 'email.send', { email: 4, email_type: 'marketing' }, { name: 'Offer' }),
    node('102', 'email.open', {}, { parentId: '101', name: 'Opened?' }),
    node('103', 'lead.changetags', { add_tags: ['engaged'], remove_tags: [] }, { parentId: '102', branch: 'yes', name: 'Tag' }),
    node('104', 'email.send', { email: 5, email_type: 'marketing' }, { parentId: '102', branch: 'no', name: 'Reminder', schedule: intervalSchedule(3, 'd') }),
    node('105', 'lead.tags', { tags: ['vip'] }, { parentId: '104', name: 'VIP?' }),
  ]);
  const entry = (nodeId: string, fields: Partial<WorkflowRunEntry>): WorkflowRunEntry => ({
    logId: null, workflowId: 41, workflowName: 'Nurture', nodeId, nodeName: nodeId, nodeType: 'x', eventType: null, state: 'executed',
    path: null, nonAction: false, triggeredAt: null, scheduledFor: null, reason: null, rotation: 1, deleted: false, ...fields,
  });

  const waiting = workflowRunStates(graph, [entry('101', { triggeredAt: '2026-11-20T10:00:00.000Z' })], { enrolled: true });
  assert.equal(waiting.get('101')!.state, 'executed');
  assert.deepEqual([waiting.get('102')!.state, waiting.get('102')!.deadline], ['waiting', '2026-11-23T10:00:00.000Z']);
  assert.equal(waiting.get('103'), undefined, 'not reached');
  assert.deepEqual(currentRunNodes(graph, waiting).map(item => item.id), ['102']);

  const noPath = workflowRunStates(graph, [
    entry('101', { triggeredAt: '2026-11-20T10:00:00.000Z' }),
    entry('102', { triggeredAt: '2026-11-23T10:00:00.000Z', nonAction: true }),
    entry('104', { state: 'failed', triggeredAt: '2026-11-23T10:00:00.000Z', scheduledFor: '2026-11-23T11:00:00.000Z', reason: 'SMTP down' }),
  ], { enrolled: true });
  assert.deepEqual([noPath.get('102')!.state, noPath.get('102')!.path], ['executed', 'no']);
  assert.equal(noPath.get('103'), undefined, 'the yes path was not taken');
  assert.equal(noPath.get('104')!.state, 'failed');
  assert.equal(noPath.get('105'), undefined);
  assert.deepEqual(currentRunNodes(graph, noPath).map(item => item.id), ['104']);

  const pending = workflowRunStates(graph, [
    entry('101', { triggeredAt: '2026-11-20T10:00:00.000Z' }),
    entry('102', { triggeredAt: '2026-11-21T10:00:00.000Z' }),
    entry('103', { state: 'scheduled', scheduledFor: '2026-11-22T10:00:00.000Z' }),
  ]);
  assert.equal(pending.get('103')!.state, 'scheduled');
  assert.equal(workflowRunStates(graph, [], { enrolled: true }).get('101')!.state, 'pending');
  assert.equal(workflowRunStates(graph, []).size, 0, 'a contact who never joined reaches nothing');
});

test('AUT-06 the console routes serve the per-contact and per-workflow logs to marketers', async () => {
  const find = (method: string, path: string) => automationsEndpoints.find(entry => entry.method === method && entry.path.test(path));
  const all = find('GET', 'workflows/contact-log/17')!;
  const one = find('GET', 'workflows/41/contacts/17/log')!;
  assert.equal(all.role, 'marketer');
  assert.equal(one.role, 'marketer');
  assert.ok(find('GET', 'marketing-messages'));
  assert.ok(find('GET', 'workflows/41'));

  const saved = { url: process.env.MAUTIC_URL, user: process.env.MAUTIC_USERNAME, password: process.env.MAUTIC_PASSWORD, fetch: globalThis.fetch };
  process.env.MAUTIC_URL = 'http://marketing-engine.local';
  process.env.MAUTIC_USERNAME = 'integration';
  process.env.MAUTIC_PASSWORD = 'unit-test-password';
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requested.push(url.pathname);
    if (url.pathname.endsWith('/activity')) return Response.json({ events: [], total: 0, page: 1, limit: 100, maxPages: 1 });
    return Response.json({ total: 1, events: [restRow(101, 'action', { dateTriggered: '2026-11-20T10:00:00+00:00' })], membership: [] });
  }) as typeof fetch;
  try {
    const context = (path: string, params: string[]) => ({
      request: new Request(`http://console.local/api/console/${path}`), user: { id: 1, role: 'marketer' } as never, params, query: new URLSearchParams(),
    });
    const contactLog = await all.handler(context('workflows/contact-log/17', ['17'])) as { entries: WorkflowRunEntry[] };
    assert.equal(contactLog.entries[0].nodeId, '101');
    const workflowLog = await one.handler(context('workflows/41/contacts/17/log', ['41', '17'])) as { workflowId: number; membership: unknown };
    assert.equal(workflowLog.workflowId, 41);
    assert.ok(requested.includes('/api/campaigns/events/contact/17'));
    assert.ok(requested.includes('/api/campaigns/41/events/contact/17'));
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [key, value] of [['MAUTIC_URL', saved.url], ['MAUTIC_USERNAME', saved.user], ['MAUTIC_PASSWORD', saved.password]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
