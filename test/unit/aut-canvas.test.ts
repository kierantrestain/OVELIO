import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decisionWaitLabel, emptySchedule, intervalSchedule, layoutWorkflowGraph, setDecisionWait, validateWorkflowGraph,
} from '../../src/contracts';
import type { WorkflowGraph, WorkflowNode } from '../../src/contracts';
import { createMautic } from '../../src/server/mautic';
import { campaignGraph, graphPayload, stepsGraph, toWorkflow } from '../../src/server/mautic/workflows';

type Id = string | number;
type Row = Record<string, unknown>;
type SentEvent = Row & { id: Id };
type SentPayload = Row & {
  events: SentEvent[];
  canvasSettings: {
    nodes: { id: Id; positionX: string; positionY: string }[];
    connections: { sourceId: Id; targetId: Id; anchors: { source: string; target: string } }[];
  };
};

function client(handler: (request: Request) => Response | Promise<Response>) {
  return createMautic({
    url: 'http://marketing-engine.local/',
    username: 'integration',
    password: 'unit-test-password',
    fetch: async (input, init) => handler(new Request(input, init)),
  });
}

const schedule = (fields: Row = {}) => ({
  triggerMode: 'immediate', triggerInterval: 0, triggerIntervalUnit: null, triggerDate: null, triggerHour: null,
  triggerRestrictedStartHour: null, triggerRestrictedStopHour: null, triggerRestrictedDaysOfWeek: [], ...fields,
});

/** A campaign as Mautic 7.2.2 returns it: events keyed by id with parent + decisionPath, and a canvas. */
function nativeCampaign(): Row {
  const events: Record<string, Row> = {
    101: { id: 101, name: 'Welcome', description: '', type: 'email.send', eventType: 'action', order: 1,
      properties: { email: 4, email_type: 'marketing', priority: 2, attempts: 3 }, parent: null, decisionPath: null, ...schedule() },
    102: { id: 102, name: 'Opened welcome?', description: '', type: 'email.open', eventType: 'decision', order: 2,
      properties: [], parent: { id: 101, name: 'Welcome' }, decisionPath: null, ...schedule({ triggerMode: null }) },
    103: { id: 103, name: 'Tag engaged', description: '', type: 'lead.changetags', eventType: 'action', order: 3,
      properties: { add_tags: ['engaged'], remove_tags: [] }, parent: { id: 102 }, decisionPath: 'yes',
      ...schedule({ triggerMode: 'interval', triggerInterval: 1, triggerIntervalUnit: 'h' }) },
    104: { id: 104, name: 'Reminder', description: '', type: 'email.send', eventType: 'action', order: 3,
      properties: { email: 5, email_type: 'marketing' }, parent: { id: 102 }, decisionPath: 'no',
      ...schedule({
        triggerMode: 'interval', triggerInterval: 3, triggerIntervalUnit: 'd',
        triggerRestrictedStartHour: '1970-01-01T09:00:00+00:00', triggerRestrictedStopHour: '1970-01-01T17:00:00+00:00',
        triggerRestrictedDaysOfWeek: [1, 2, 3, 4, 5],
      }) },
    105: { id: 105, name: 'Lives in Norway?', description: '', type: 'lead.field_value', eventType: 'condition', order: 4,
      properties: { field: 'country', operator: '=', value: 'Norway' }, parent: { id: 103 }, decisionPath: null, ...schedule() },
    106: { id: 106, name: 'Notify sales', description: '', type: 'campaign.sendwebhook', eventType: 'action', order: 5,
      properties: { url: 'https://hooks.example.test/sales', method: 'post', headers: { list: [{ label: 'X-Team', value: 'nordics' }] } },
      parent: { id: 105 }, decisionPath: 'yes', ...schedule({ triggerMode: 'date', triggerDate: '2026-12-01T09:00:00+00:00' }) },
    107: { id: 107, name: 'Score elsewhere', description: '', type: 'lead.changepoints', eventType: 'action', order: 5,
      properties: { points: 5 }, parent: { id: 105 }, decisionPath: 'no', ...schedule() },
    // Soft-deleted: still listed by the engine, gone from the canvas.
    99: { id: 99, name: 'Old step', description: '', type: 'email.send', eventType: 'action', order: 1,
      properties: { email: 9 }, parent: null, decisionPath: null, ...schedule() },
  };
  const edge = (sourceId: Id, targetId: Id, source: string) => ({ sourceId, targetId, anchors: { source, target: 'top' } });
  return {
    id: 41, name: 'Native nurture', description: 'Built in the engine', isPublished: false, allowRestart: false,
    lists: [{ id: 3, name: 'New leads' }], forms: [{ id: 22, name: 'Demo request' }],
    events,
    canvasSettings: {
      nodes: [
        { id: 'lists', positionX: '300', positionY: '20' }, { id: 'forms', positionX: '520', positionY: '20' },
        { id: '101', positionX: '400', positionY: '150' }, { id: '102', positionX: '400', positionY: '280' },
        { id: '103', positionX: '250', positionY: '410' }, { id: '104', positionX: '560', positionY: '410' },
        { id: '105', positionX: '250', positionY: '540' }, { id: '106', positionX: '100', positionY: '670' },
        { id: '107', positionX: '400', positionY: '670' },
      ],
      connections: [
        { sourceId: 'lists', targetId: 'forms', anchors: { source: 'leadsourceright', target: 'leadsourceleft' } },
        edge('lists', '101', 'leadsource'), edge('101', '102', 'bottom'), edge('102', '103', 'yes'), edge('102', '104', 'no'),
        edge('103', '105', 'bottom'), edge('105', '106', 'yes'), edge('105', '107', 'no'),
      ],
    },
  };
}

/** Mimics CampaignModel::setEvents + setCanvasSettings: temp ids get real ids, parents come from connections. */
function engineSave(payload: SentPayload, stored: Record<string, Row>, nextId = { value: 200 }) {
  const ids = new Map<Id, number>();
  for (const event of payload.events) {
    if (typeof event.id === 'string') {
      assert.ok(event.id.startsWith('new'), 'temporary ids must start with "new"');
      ids.set(event.id, nextId.value++);
    } else {
      ids.set(event.id, event.id);
    }
  }
  const real = (id: Id) => ids.get(id) ?? id;
  const relationships = new Map<number, { parent: number; anchor: string }>();
  for (const connection of payload.canvasSettings.connections) {
    if (connection.sourceId === 'lists' || connection.sourceId === 'forms' || connection.anchors.source === 'leadsource') continue;
    relationships.set(Number(real(connection.targetId)), { parent: Number(real(connection.sourceId)), anchor: connection.anchors.source });
  }
  const events: Record<string, Row> = {};
  for (const sent of payload.events) {
    const id = Number(real(sent.id));
    const base = stored[id] ?? {};
    const relation = relationships.get(id);
    events[id] = {
      ...base, ...sent, id,
      parent: relation ? { id: relation.parent } : null,
      decisionPath: relation && ['yes', 'no'].includes(relation.anchor) ? relation.anchor : null,
    };
  }
  return {
    ...payload,
    id: 41,
    events,
    canvasSettings: {
      nodes: payload.canvasSettings.nodes.map(node => ({ ...node, id: String(real(node.id)) })),
      connections: payload.canvasSettings.connections.map(connection => ({
        ...connection, sourceId: String(real(connection.sourceId)), targetId: String(real(connection.targetId)),
      })),
    },
  };
}

test('AUT-02 a branching campaign round-trips without losing events or ids', async () => {
  const campaign = nativeCampaign();
  const opened = toWorkflow(campaign);
  assert.equal(opened.editable, true);
  assert.deepEqual(opened.steps, [], 'a branching campaign has no linear step list');
  const graph = opened.graph!;
  assert.deepEqual(graph.segmentIds, [3]);
  assert.deepEqual(graph.formIds, [22]);
  assert.deepEqual(graph.nodes.map(node => node.id).sort(), ['101', '102', '103', '104', '105', '106', '107']);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  assert.deepEqual([byId.get('103')!.branch, byId.get('104')!.branch, byId.get('106')!.branch, byId.get('107')!.branch], ['yes', 'no', 'yes', 'no']);
  assert.equal(byId.get('105')!.eventType, 'condition');
  assert.deepEqual(byId.get('104')!.schedule, {
    mode: 'interval', interval: 3, unit: 'd', date: null, hour: null, restrictedStartHour: '09:00', restrictedStopHour: '17:00',
    restrictedDaysOfWeek: [1, 2, 3, 4, 5], window: null,
  });
  assert.equal(decisionWaitLabel(graph, byId.get('102')!), 'If not opened within 3 days');
  assert.deepEqual(validateWorkflowGraph(graph).filter(issue => issue.level === 'error'), []);

  // Add one step under the webhook, then save through the API.
  const added: WorkflowNode = {
    id: 'new_k1', parentId: '106', branch: null, eventType: 'action', type: 'stage.change', name: 'Move to sales',
    description: '', properties: { stage: 2 }, schedule: emptySchedule(),
  };
  const edited: WorkflowGraph = { ...graph, nodes: [...graph.nodes, added] };
  let stored = campaign;
  let put: SentPayload | undefined;
  const api = client(async request => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/api/campaigns/41') return Response.json({ campaign: stored });
    if (request.method === 'PUT' && path === '/api/campaigns/41/edit') {
      put = await request.json() as SentPayload;
      stored = engineSave(put, campaign.events as Record<string, Row>);
      return Response.json({ campaign: stored });
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  });
  const saved = await api.updateWorkflow(41, { name: 'Native nurture', description: 'Built in the engine', segmentId: 3, steps: [], graph: edited });

  assert.ok(put);
  const sentIds = put.events.map(event => event.id);
  for (const id of [101, 102, 103, 104, 105, 106, 107]) assert.ok(sentIds.includes(id), `saved event ${id} is kept`);
  assert.ok(put.events.some(event => event.id === 99 && Object.keys(event).length === 1), 'the soft-deleted event is sent back untouched');
  const temp = put.events.find(event => typeof event.id === 'string')!;
  assert.match(String(temp.id), /^new_[a-z0-9]+_\d+$/);
  const sentById = new Map(put.events.map(event => [event.id, event]));
  assert.deepEqual(sentById.get(105)!.properties, { field: 'country', operator: '=', value: 'Norway' });
  assert.deepEqual(sentById.get(106)!.properties, (campaign.events as Record<string, Row>)[106].properties);
  assert.equal(sentById.get(106)!.triggerMode, 'date');
  assert.equal(sentById.get(106)!.triggerDate, '2026-12-01T09:00:00+00:00');
  assert.deepEqual(sentById.get(101)!.properties, { email: 4, email_type: 'marketing', priority: 2, attempts: 3 });
  assert.equal(sentById.get(104)!.triggerRestrictedStartHour, '09:00');
  const anchors = new Map(put.canvasSettings.connections.map(edge => [String(edge.targetId), edge.anchors.source]));
  assert.equal(anchors.get('104'), 'no');
  assert.equal(anchors.get('103'), 'yes');
  assert.equal(anchors.get('105'), 'bottom');
  assert.equal(anchors.get(String(temp.id)), 'bottom');
  assert.equal(anchors.get('forms'), 'leadsourceright');
  assert.equal(put.isPublished, false);
  assert.deepEqual(put.lists, [{ id: 3 }]);
  assert.deepEqual(put.forms, [{ id: 22 }]);

  assert.equal(saved.editable, true);
  assert.equal(saved.graph!.nodes.length, 8);
  const reread = new Map(saved.graph!.nodes.map(node => [node.id, node]));
  assert.equal(reread.get('200')!.parentId, '106');
  assert.equal(reread.get('107')!.branch, 'no');
});

test('AUT-02 an edit that leaves out a saved step is refused unless it was deleted on purpose', async () => {
  const campaign = nativeCampaign();
  const graph = toWorkflow(campaign).graph!;
  const withoutScore = { ...graph, nodes: graph.nodes.filter(node => node.id !== '107') };
  const requests: string[] = [];
  let put: SentPayload | undefined;
  const api = client(async request => {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (request.method === 'GET') return Response.json({ campaign });
    put = await request.json() as SentPayload;
    return Response.json({ campaign: engineSave(put, campaign.events as Record<string, Row>) });
  });
  await assert.rejects(
    () => api.updateWorkflow(41, { name: 'Native nurture', segmentId: 3, steps: [], graph: withoutScore }),
    { name: 'UpstreamError', status: 409 },
  );
  assert.deepEqual(requests, ['GET /api/campaigns/41'], 'nothing is written');

  const stale = { ...graph, nodes: [...graph.nodes, { ...graph.nodes[0], id: '555', parentId: '107', branch: null }] };
  await assert.rejects(() => api.updateWorkflow(41, { name: 'Native nurture', segmentId: 3, steps: [], graph: stale }), { status: 409 });

  const saved = await api.updateWorkflow(41, { name: 'Native nurture', segmentId: 3, steps: [], graph: withoutScore, removedNodeIds: ['107'] });
  assert.ok(put && !put.events.some(event => event.id === 107));
  assert.equal(saved.graph!.nodes.length, 6);

  // The linear step editor cannot flatten a branching campaign.
  await assert.rejects(
    () => api.updateWorkflow(41, { name: 'Native nurture', segmentId: 3, steps: [{ emailId: 4, delayMinutes: 0 }] }),
    { status: 409 },
  );

  const published = { ...campaign, isPublished: true };
  const live = client(() => Response.json({ campaign: published }));
  await assert.rejects(() => live.updateWorkflow(41, { name: 'x', segmentId: 3, steps: [], graph }), { status: 409 });
});

test('AUT-02 validation rejects loops, stray branches, unreachable steps and misplaced decisions', () => {
  const action = (id: string, parentId: string | null, branch: 'yes' | 'no' | null = null): WorkflowNode => ({
    id, parentId, branch, eventType: 'action', type: 'lead.changepoints', name: `Step ${id}`, description: '',
    properties: { points: 1 }, schedule: emptySchedule(),
  });
  const base: WorkflowGraph = { segmentIds: [3], formIds: [], allowRestart: false, nodes: [action('1', null)] };
  assert.deepEqual(validateWorkflowGraph(base), []);
  const errors = (graph: WorkflowGraph) => validateWorkflowGraph(graph).filter(issue => issue.level === 'error').map(issue => issue.message);

  assert.ok(errors({ ...base, segmentIds: [] }).some(message => message.includes('segment or lead form')));
  assert.ok(errors({ ...base, nodes: [action('1', '2'), action('2', '1')] }).some(message => message.includes('loop')));
  assert.ok(errors({ ...base, nodes: [action('1', null), action('2', '9')] }).some(message => message.includes('not connected')));
  assert.ok(errors({ ...base, nodes: [action('1', null), action('2', '1', 'yes')] }).some(message => message.includes('yes and no paths')));
  const condition: WorkflowNode = { ...action('2', '1'), eventType: 'condition', type: 'lead.field_value', properties: {} };
  assert.ok(errors({ ...base, nodes: [action('1', null), condition, action('3', '2')] }).some(message => message.includes('yes or the no path')));
  const opened: WorkflowNode = { ...action('2', '1'), eventType: 'decision', type: 'email.open', properties: {}, schedule: emptySchedule(null) };
  assert.ok(errors({ ...base, nodes: [action('1', null), opened] }).some(message => message.includes('straight after a Send email')));
  const send: WorkflowNode = { ...action('1', null), type: 'email.send', properties: { email: 4 } };
  const again: WorkflowNode = { ...send, id: '3', parentId: '2', branch: 'yes', schedule: emptySchedule() };
  assert.ok(errors({ ...base, nodes: [send, opened, again] }).some(message => message.includes('already sent earlier')));
});

test('AUT-02 existing linear workflows open in the graph unchanged and keep their ids on save', async () => {
  const linear = stepsGraph({
    name: 'Welcome', segmentId: 3,
    steps: [{ emailId: 4, delayMinutes: 0 }, { emailId: 5, delayMinutes: 90, condition: 'opened_previous' }],
  });
  const created = engineSave(graphPayload(linear, { name: 'Welcome', nonce: 'a1' }).payload as unknown as SentPayload, {});
  const opened = toWorkflow(created);
  assert.deepEqual(opened.steps, [{ emailId: 4, delayMinutes: 0 }, { emailId: 5, delayMinutes: 90, condition: 'opened_previous' }]);
  assert.deepEqual(opened.graph!.nodes.map(node => [node.id, node.parentId, node.branch, node.type]), [
    ['200', null, null, 'email.send'], ['201', '200', null, 'email.open'], ['202', '201', 'yes', 'email.send'],
  ]);
  const again = graphPayload(opened.graph!, { name: 'Welcome' }).payload as unknown as SentPayload;
  assert.deepEqual(again.events.map(event => event.id), [200, 201, 202]);
  assert.deepEqual(again.canvasSettings.connections.map(edge => edge.anchors.source), ['leadsource', 'bottom', 'yes']);
  assert.ok(campaignGraph(created).retiredIds.length === 0);
});

test('AUT-02 auto layout places yes paths left of no paths without overlaps', () => {
  const graph = toWorkflow(nativeCampaign()).graph!;
  const layout = layoutWorkflowGraph(graph);
  const at = (id: string) => layout.positions.get(id)!;
  assert.ok(at('103').column < at('104').column);
  assert.ok(at('106').column < at('107').column);
  assert.equal(at('101').depth, 1);
  assert.equal(at('106').depth, 5);
  const seen = new Set([...layout.positions.values()].map(position => `${position.column}:${position.depth}`));
  assert.equal(seen.size, graph.nodes.length);
});

test('AUT-04 a decision gets a no-path that fires after the wait', async () => {
  const nodes: WorkflowNode[] = [
    { id: 'new1', parentId: null, branch: null, eventType: 'action', type: 'email.send', name: 'Offer', description: '',
      properties: { email: 4, email_type: 'marketing' }, schedule: emptySchedule() },
    { id: 'new2', parentId: 'new1', branch: null, eventType: 'decision', type: 'email.open', name: 'Opened offer?', description: '',
      properties: {}, schedule: emptySchedule(null) },
    { id: 'new3', parentId: 'new2', branch: 'yes', eventType: 'action', type: 'lead.changetags', name: 'Tag engaged', description: '',
      properties: { add_tags: ['engaged'], remove_tags: [] }, schedule: emptySchedule() },
    { id: 'new4', parentId: 'new2', branch: 'no', eventType: 'action', type: 'email.send', name: 'Reminder', description: '',
      properties: { email: 5, email_type: 'marketing' }, schedule: emptySchedule() },
  ];
  const draft: WorkflowGraph = { segmentIds: [3], formIds: [], allowRestart: false, nodes };

  // Without a wait the no path would fire at once (InactiveHelper::getEarliestInactiveDate), so it is refused.
  assert.ok(validateWorkflowGraph(draft).some(issue => issue.level === 'error' && issue.nodeId === 'new4' && issue.message.startsWith('Set how long to wait')));
  assert.throws(() => graphPayload(draft, { name: 'Offer' }), { status: 400 });

  const graph = setDecisionWait(draft, 'new2', 3, 'd');
  assert.equal(decisionWaitLabel(graph, graph.nodes[1]), 'If not opened within 3 days');
  assert.deepEqual(graph.nodes[3].schedule, intervalSchedule(3, 'd'));
  assert.deepEqual(validateWorkflowGraph(graph).filter(issue => issue.level === 'error'), []);

  let posted: SentPayload | undefined;
  const api = client(async request => {
    assert.equal(request.method, 'POST');
    posted = await request.json() as SentPayload;
    return Response.json({ campaign: engineSave(posted, {}) }, { status: 201 });
  });
  const saved = await api.createWorkflow({ name: 'Offer', segmentId: 3, steps: [], graph });
  assert.ok(posted);
  const reminder = posted.events.find(event => event.name === 'Reminder')!;
  assert.equal(reminder.triggerMode, 'interval');
  assert.equal(reminder.triggerInterval, 3);
  assert.equal(reminder.triggerIntervalUnit, 'd');
  const decision = posted.events.find(event => event.type === 'email.open')!;
  const noEdge = posted.canvasSettings.connections.find(edge => edge.targetId === reminder.id)!;
  assert.deepEqual([noEdge.sourceId, noEdge.anchors.source], [decision.id, 'no']);
  const reread = saved.graph!;
  const savedDecision = reread.nodes.find(node => node.type === 'email.open')!;
  assert.equal(decisionWaitLabel(reread, savedDecision), 'If not opened within 3 days');
  assert.equal(reread.nodes.find(node => node.name === 'Reminder')!.branch, 'no');
});

test('AUT-04 activation checks every email and segment across all branches', async () => {
  const campaign = nativeCampaign();
  const fetched: string[] = [];
  const api = client(async request => {
    const path = new URL(request.url).pathname;
    fetched.push(`${request.method} ${path}`);
    if (path === '/api/campaigns/41' && request.method === 'GET') return Response.json({ campaign });
    if (path === '/api/segments/3') return Response.json({ list: { id: 3, isPublished: true } });
    if (path.startsWith('/api/emails/')) {
      const id = Number(path.split('/').at(-1));
      return Response.json({ email: {
        id, isPublished: id !== 5, emailType: 'template', sendToDnc: false, customHtml: '<a href="{unsubscribe_url}">Unsubscribe</a>',
      } });
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  });
  await assert.rejects(() => api.setWorkflowEnabled(41, true), { status: 409 });
  assert.ok(fetched.includes('GET /api/emails/4'));
  assert.ok(fetched.includes('GET /api/emails/5'), 'the reminder on the no path is checked too');
  assert.ok(!fetched.includes('GET /api/emails/9'), 'soft-deleted steps are ignored');
  assert.ok(!fetched.some(entry => entry.startsWith('PATCH')));
});
