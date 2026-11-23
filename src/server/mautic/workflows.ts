import {
  branches, editableNodeSpec, emptySchedule, intervalSchedule, layoutPoint, layoutWorkflowGraph, maxWorkflowSteps,
  validateWorkflowGraph, workflowIntervalUnits,
} from '../../contracts';
import type {
  Workflow, WorkflowBranch, WorkflowEventType, WorkflowGraph, WorkflowInput, WorkflowIntervalUnit, WorkflowMembership,
  WorkflowNode, WorkflowRunEntry, WorkflowRunState, WorkflowSchedule, WorkflowStep, WorkflowStepKind, WorkflowTriggerMode,
} from '../../contracts';
import { UpstreamError } from '../upstream';
import { date, flag, number, positiveId, published, record, requiredId, service, text, type ApiRecord } from './normalize';

/*
 * AUT-02: Mautic campaign <-> OVELIO workflow graph.
 *
 * Engine facts this adapter relies on (Mautic 7.2.2, CampaignBundle):
 * - POST/PUT need non-empty `events` and `lists` or `forms`; PUT needs an `id` on every event and deletes every
 *   saved event missing from the payload (Controller/Api/CampaignApiController.php:183-251, 296-297).
 * - Events are matched by `id`; an id starting with "new" is a temporary id kept as tempId
 *   (Model/CampaignModel.php:226-254). Parent and decision path come only from canvas connections:
 *   sourceId -> parent, anchors.source 'yes'|'no' -> decision_path, 'leadsource' and list/form sources are skipped
 *   (CampaignModel.php:277-335). Temporary ids in the canvas are swapped for real ids after the save
 *   (CampaignModel.php:368-431), so every temporary id must contain "new" and be unique.
 * - Deleted events are soft-deleted and stay in the campaign (Model/EventModel.php:74-100), so a saved event
 *   that is neither on the canvas nor under a parent is sent back as `{ id }` to leave it exactly as it is.
 * - Any field a PUT omits keeps its saved value, because existing events are updated in place.
 */

const owner = 'Managed by OVELIO';
const decisionTypes = { opened_previous: 'email.open', clicked_previous: 'email.click' } as const;
const eventTypes = new Set<WorkflowEventType>(['action', 'decision', 'condition']);
const triggerModes = new Set<WorkflowTriggerMode>(['immediate', 'interval', 'date', 'optimized']);
const intervalUnits = new Set<string>(workflowIntervalUnits);
const stepTypes: Record<WorkflowStepKind, string> = {
  email: 'email.send', tags: 'lead.changetags', points: 'lead.changepoints', segment: 'lead.changelist', stage: 'stage.change',
};
const stepKinds = new Map(Object.entries(stepTypes).map(([kind, type]) => [type, kind as WorkflowStepKind]));
const unitMinutes: Partial<Record<WorkflowIntervalUnit, number>> = { i: 1, h: 60, d: 1440 };

export type ParsedCampaign = {
  graph: WorkflowGraph;
  /** Soft-deleted events the engine still lists. They are sent back untouched. */
  retiredIds: string[];
  /** Set when the campaign cannot be saved from the console. */
  problem?: string;
};

function entries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? Object.values(value) : [];
}

function sourceIds(value: unknown) {
  const found = entries(value).map(entry => positiveId(entry && typeof entry === 'object' ? record(entry).id : entry));
  return [...new Set(found.filter((id): id is number => id !== null))];
}

function hhmm(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : text(record(value).date);
  const timePart = raw.includes('T') ? raw.slice(raw.indexOf('T')) : raw;
  const match = /(\d{2}):(\d{2})/.exec(timePart);
  return match ? `${match[1]}:${match[2]}` : null;
}

function dateText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const nested = text(record(value).date);
  return nested || null;
}

function wholeNumber(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

export function readSchedule(event: ApiRecord): WorkflowSchedule {
  const mode = text(event.triggerMode) as WorkflowTriggerMode;
  const unit = text(event.triggerIntervalUnit).toLowerCase();
  const interval = wholeNumber(event.triggerInterval);
  return {
    mode: triggerModes.has(mode) ? mode : null,
    interval: interval !== null && interval >= 0 ? interval : 0,
    unit: intervalUnits.has(unit) ? unit as WorkflowIntervalUnit : null,
    date: dateText(event.triggerDate),
    hour: hhmm(event.triggerHour),
    restrictedStartHour: hhmm(event.triggerRestrictedStartHour),
    restrictedStopHour: hhmm(event.triggerRestrictedStopHour),
    restrictedDaysOfWeek: entries(event.triggerRestrictedDaysOfWeek).map(wholeNumber).filter((day): day is number => day !== null),
    window: wholeNumber(event.triggerWindow),
  };
}

function scheduleFields(schedule: WorkflowSchedule) {
  return {
    triggerMode: schedule.mode,
    triggerInterval: schedule.interval,
    triggerIntervalUnit: schedule.unit,
    triggerDate: schedule.date,
    triggerHour: schedule.hour,
    triggerRestrictedStartHour: schedule.restrictedStartHour,
    triggerRestrictedStopHour: schedule.restrictedStopHour,
    triggerRestrictedDaysOfWeek: schedule.restrictedDaysOfWeek,
    // The REST serializer does not return trigger_window (Entity/Event.php loadApiMetadata), so it is only sent when
    // known; leaving it out keeps the saved value.
    ...(schedule.window !== null ? { triggerWindow: schedule.window } : {}),
  };
}

function readProperties(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? { ...value } : { ...record(value) };
}

function connectionAnchor(connection: ApiRecord) {
  const anchors = connection.anchors;
  if (Array.isArray(anchors)) return text(record(anchors[0]).endpoint);
  return text(record(anchors).source);
}

/** Mautic campaign -> graph. Unknown event types and properties are kept exactly as stored. */
export function campaignGraph(dto: ApiRecord): ParsedCampaign {
  const canvas = record(dto.canvasSettings);
  const canvasNodes = entries(canvas.nodes).map(record);
  const connections = entries(canvas.connections).map(record);
  const positions = new Map(canvasNodes.map(node => [String(node.id), {
    x: number(node.positionX) ?? 0, y: number(node.positionY) ?? 0,
  }]));
  const canvasParents = new Map<string, { parentId: string; anchor: string }>();
  const connected = new Set<string>();
  for (const connection of connections) {
    const source = String(connection.sourceId ?? '');
    const target = String(connection.targetId ?? '');
    const anchor = connectionAnchor(connection);
    if (!source || !target) continue;
    connected.add(target);
    if (source === 'lists' || source === 'forms' || anchor === 'leadsource' || anchor.startsWith('leadsource')) continue;
    canvasParents.set(target, { parentId: source, anchor });
  }

  let problem: string | undefined;
  const retiredIds: string[] = [];
  const drafts: (WorkflowNode & { order: number; anchor: string | null })[] = [];
  const seen = new Set<string>();
  for (const event of entries(dto.events).map(record)) {
    const numericId = positiveId(event.id);
    if (!numericId) {
      problem = 'A step in this automation has no id.';
      continue;
    }
    const id = String(numericId);
    if (seen.has(id)) continue;
    seen.add(id);

    const engineParent = 'parent' in event ? positiveId(event.parent && typeof event.parent === 'object' ? record(event.parent).id : event.parent) : null;
    const onCanvas = positions.has(id) || connected.has(id);
    if (event.deleted || (canvasNodes.length > 0 && !onCanvas && !engineParent)) {
      retiredIds.push(id);
      continue;
    }

    const eventType = text(event.eventType) as WorkflowEventType;
    if (!eventTypes.has(eventType)) problem = `The step “${text(event.name) || id}” has a type the console does not know.`;
    let parentId: string | null = null;
    let anchor: string | null = null;
    if ('parent' in event) {
      parentId = engineParent ? String(engineParent) : null;
      anchor = text(event.decisionPath) || canvasParents.get(id)?.anchor || null;
    } else if (canvasParents.has(id)) {
      parentId = canvasParents.get(id)!.parentId;
      anchor = canvasParents.get(id)!.anchor;
    }
    drafts.push({
      id, parentId, branch: null, anchor,
      eventType: eventTypes.has(eventType) ? eventType : 'action',
      type: text(event.type),
      name: text(event.name),
      description: text(event.description),
      properties: readProperties(event.properties),
      schedule: readSchedule(event),
      order: number(event.order) ?? 0,
      ...(positions.has(id) ? { position: positions.get(id) } : {}),
    });
  }

  const byId = new Map(drafts.map(node => [node.id, node]));
  for (const node of drafts) {
    if (node.parentId === null) continue;
    const parent = byId.get(node.parentId);
    if (!parent) {
      problem = `The step “${node.name || node.id}” points to a step that is not in this automation.`;
      continue;
    }
    if (branches(parent)) node.branch = node.anchor === 'yes' || node.anchor === 'no' ? node.anchor : null;
  }

  drafts.sort((a, b) => {
    if (a.position && b.position) return a.position.y - b.position.y || a.position.x - b.position.x || Number(a.id) - Number(b.id);
    return a.order - b.order || Number(a.id) - Number(b.id);
  });
  const nodes: WorkflowNode[] = drafts.map(draft => {
    const node: WorkflowNode & { order?: number; anchor?: string | null } = { ...draft };
    delete node.order;
    delete node.anchor;
    return node;
  });
  return {
    graph: { segmentIds: sourceIds(dto.lists), formIds: sourceIds(dto.forms), allowRestart: flag(dto.allowRestart), nodes },
    retiredIds,
    ...(problem ? { problem } : {}),
  };
}

function orderedNodes(graph: WorkflowGraph) {
  const ordered: WorkflowNode[] = [];
  const done = new Set<string>();
  const visit = (parentId: string | null) => {
    const children = graph.nodes.filter(node => node.parentId === parentId);
    children.sort((a, b) => (a.branch === 'no' ? 1 : 0) - (b.branch === 'no' ? 1 : 0));
    for (const child of children) {
      if (done.has(child.id)) continue;
      done.add(child.id);
      ordered.push(child);
      visit(child.id);
    }
  };
  visit(null);
  return ordered;
}

/**
 * AUT-05: a jump step names its target by event id. A target saved in the same request has no id yet, so the engine
 * matches it by temporary id and rewrites the property after the save
 * (CampaignActionJumpToEventSubscriber.php:115-143), which means the temporary id sent must be the target's.
 * Every other property is sent exactly as stored.
 */
function enginePropertiesFor(node: WorkflowNode, engineIds: Map<string, number | string>): Record<string, unknown> {
  if (node.type !== 'campaign.jump_to_event') return node.properties;
  const target = node.properties.jumpToEvent;
  const engineTarget = typeof target === 'string' && !/^\d+$/.test(target) ? engineIds.get(target) : undefined;
  return engineTarget === undefined ? node.properties : { ...node.properties, jumpToEvent: engineTarget };
}

export type GraphPayloadOptions = {
  name: string;
  description?: string;
  /** Soft-deleted ids to send back untouched on PUT. */
  retiredIds?: string[];
  /** Makes temporary ids unique per save; tests pass a fixed value. */
  nonce?: string;
};

/** Graph -> Mautic campaign payload, with the canvas laid out top-down. */
export function graphPayload(graph: WorkflowGraph, options: GraphPayloadOptions) {
  const errors = validateWorkflowGraph(graph).filter(issue => issue.level === 'error');
  if (errors.length) throw new UpstreamError(service, 400, errors[0].message);

  const nonce = (options.nonce ?? Date.now().toString(36)).replace(/[^a-z0-9]/gi, '');
  const ordered = orderedNodes(graph);
  const engineIds = new Map<string, number | string>();
  ordered.forEach((node, index) => engineIds.set(node.id, /^\d+$/.test(node.id) ? Number(node.id) : `new_${nonce}_${index + 1}`));

  const layout = layoutWorkflowGraph(graph);
  const positioned = new Map<string, { x: number; y: number }>();
  for (const node of ordered) positioned.set(node.id, layoutPoint(layout.positions.get(node.id)!));

  const events: ApiRecord[] = ordered.map(node => {
    const properties = enginePropertiesFor(node, engineIds);
    return {
      id: engineIds.get(node.id)!,
      type: node.type,
      eventType: node.eventType,
      name: node.name.trim(),
      description: node.description,
      properties: Object.keys(properties).length ? properties : [],
      ...scheduleFields(node.schedule),
    };
  });
  for (const id of options.retiredIds ?? []) events.push({ id: Number(id) });

  const sources = [...(graph.segmentIds.length ? ['lists'] : []), ...(graph.formIds.length ? ['forms'] : [])];
  const entry = layoutPoint(layout.entry);
  const canvasNodes: { id: string | number; positionX: string; positionY: string }[] = sources.map((source, index) => ({
    id: source,
    positionX: String(entry.x + (sources.length > 1 ? (index === 0 ? -110 : 110) : 0)),
    positionY: String(entry.y),
  }));
  const connections: { sourceId: string | number; targetId: string | number; anchors: { source: string; target: string } }[] = [];
  const parents = new Map(graph.nodes.map(node => [node.id, node]));
  for (const node of ordered) {
    const point = positioned.get(node.id)!;
    canvasNodes.push({ id: engineIds.get(node.id)!, positionX: String(point.x), positionY: String(point.y) });
    const parent = node.parentId === null ? undefined : parents.get(node.parentId);
    connections.push(parent
      ? { sourceId: engineIds.get(parent.id)!, targetId: engineIds.get(node.id)!, anchors: { source: branches(parent) ? node.branch! : 'bottom', target: 'top' } }
      : { sourceId: sources[0], targetId: engineIds.get(node.id)!, anchors: { source: 'leadsource', target: 'top' } });
  }
  if (sources.length > 1) {
    connections.push({ sourceId: 'lists', targetId: 'forms', anchors: { source: 'leadsourceright', target: 'leadsourceleft' } });
  }

  const expected: WorkflowGraph = { ...graph, nodes: ordered.map(node => ({ ...node, position: positioned.get(node.id) })) };
  return {
    payload: {
      name: options.name,
      description: options.description ?? '',
      lists: graph.segmentIds.map(id => ({ id })),
      forms: graph.formIds.map(id => ({ id })),
      isPublished: false,
      allowRestart: graph.allowRestart,
      events,
      canvasSettings: { nodes: canvasNodes, connections },
    },
    expected,
  };
}

/* ── Linear step editor (AUT-01) on top of the graph ─────────────────────────── */

type ChainLink = { action: WorkflowNode; decision?: WorkflowNode };

/** The managed linear chain: source -> action -> [email decision -> yes] -> action ... */
export function linearChain(graph: WorkflowGraph): ChainLink[] | null {
  if (graph.segmentIds.length + graph.formIds.length !== 1 || graph.allowRestart || !graph.nodes.length) return null;
  const links: ChainLink[] = [];
  let parentId: string | null = null;
  let pendingDecision: WorkflowNode | undefined;
  let count = 0;
  for (;;) {
    const children: WorkflowNode[] = graph.nodes.filter(node => node.parentId === parentId);
    if (!children.length) break;
    if (children.length > 1) return null;
    const node: WorkflowNode = children[0];
    count += 1;
    if (node.eventType === 'decision') {
      const previous = links.at(-1)?.action;
      if (pendingDecision || !previous || previous.type !== 'email.send' || !(node.type === 'email.open' || node.type === 'email.click')) return null;
      pendingDecision = node;
    } else if (node.eventType === 'action' && stepKinds.has(node.type)) {
      if (pendingDecision ? node.branch !== 'yes' : node.branch !== null) return null;
      links.push({ action: node, ...(pendingDecision ? { decision: pendingDecision } : {}) });
      pendingDecision = undefined;
    } else {
      return null;
    }
    parentId = node.id;
  }
  return pendingDecision || count !== graph.nodes.length ? null : links;
}

function stringList(value: unknown): string[] {
  return entries(value).map(text).map(entry => entry.trim()).filter(Boolean);
}

function idList(value: unknown): number[] {
  return entries(value).map(positiveId).filter((id): id is number => id !== null);
}

function delayMinutes(schedule: WorkflowSchedule): number | null {
  if (schedule.hour || schedule.restrictedStartHour || schedule.restrictedStopHour || schedule.restrictedDaysOfWeek.length) return null;
  if (schedule.mode === null || schedule.mode === 'immediate') return schedule.mode === 'immediate' || schedule.interval === 0 ? 0 : null;
  if (schedule.mode !== 'interval') return null;
  const factor = schedule.unit ? unitMinutes[schedule.unit] : undefined;
  if (!factor) return schedule.interval === 0 ? 0 : null;
  return schedule.interval * factor;
}

/** The step list shown for simple chains, or null when the workflow branches. */
export function stepsFromGraph(graph: WorkflowGraph): WorkflowStep[] | null {
  const chain = linearChain(graph);
  if (!chain) return null;
  const steps: WorkflowStep[] = [];
  for (const { action, decision } of chain) {
    const props = action.properties;
    const delay = delayMinutes(action.schedule);
    if (delay === null) return null;
    const condition = decision ? { condition: decision.type === 'email.open' ? 'opened_previous' as const : 'clicked_previous' as const } : {};
    const kind = stepKinds.get(action.type)!;
    if (kind === 'email') {
      const emailId = positiveId(props.email);
      if (!emailId || (props.email_type !== undefined && props.email_type !== 'marketing')) return null;
      steps.push({ emailId, delayMinutes: delay, ...condition });
    } else if (kind === 'tags') {
      const addTags = stringList(props.add_tags);
      const removeTags = stringList(props.remove_tags);
      if (!addTags.length && !removeTags.length) return null;
      steps.push({ kind, emailId: 0, delayMinutes: delay, ...condition, addTags, removeTags });
    } else if (kind === 'points') {
      const pointsDelta = wholeNumber(props.points);
      if (!pointsDelta) return null;
      steps.push({ kind, emailId: 0, delayMinutes: delay, ...condition, pointsDelta });
    } else if (kind === 'segment') {
      const addSegmentIds = idList(props.addToLists);
      const removeSegmentIds = idList(props.removeFromLists);
      if (!addSegmentIds.length && !removeSegmentIds.length) return null;
      steps.push({ kind, emailId: 0, delayMinutes: delay, ...condition, addSegmentIds, removeSegmentIds });
    } else {
      const stageId = positiveId(props.stage);
      if (!stageId) return null;
      steps.push({ kind, emailId: 0, delayMinutes: delay, ...condition, stageId });
    }
  }
  return steps;
}

function cleanStepTags(tags?: string[]) {
  const cleaned = [...new Set((tags ?? []).map(tag => tag.trim()).filter(Boolean))];
  if (cleaned.some(tag => tag.startsWith('-'))) {
    throw new UpstreamError(service, 400, 'A tag cannot start with a hyphen.');
  }
  return cleaned;
}

/** Steps from the linear editor -> graph, keeping the ids of matching saved steps. */
export function stepsGraph(input: WorkflowInput, prior?: WorkflowGraph | null): WorkflowGraph {
  if (!input.steps.length || input.steps.length > maxWorkflowSteps) {
    throw new UpstreamError(service, 400, `Add between 1 and ${maxWorkflowSteps} workflow steps.`);
  }
  const useFormTrigger = input.segmentId === 0 && input.formId !== undefined && input.formId > 0;
  if (!useFormTrigger && input.segmentId <= 0) {
    throw new UpstreamError(service, 400, 'Select a valid segment or form trigger.');
  }
  const chain = prior ? linearChain(prior) ?? [] : [];
  const emailIds = new Set<number>();
  const nodes: WorkflowNode[] = [];
  let parentId: string | null = null;

  for (const [index, step] of input.steps.entries()) {
    const stepNumber = index + 1;
    const kind: WorkflowStepKind = step.kind ?? 'email';
    if (!Number.isSafeInteger(step.delayMinutes) || step.delayMinutes < 0 || step.delayMinutes > 525600) {
      throw new UpstreamError(service, 400, 'Set a whole-minute delay between 0 and 525600.');
    }
    let branch: WorkflowBranch | null = null;
    if (step.condition) {
      const type = decisionTypes[step.condition];
      const previous = index > 0 ? input.steps[index - 1] : undefined;
      if (!previous || (previous.kind ?? 'email') !== 'email' || !type) {
        throw new UpstreamError(service, 400, 'An activity condition needs a preceding email step.');
      }
      const reuse = chain[index]?.decision?.type === type ? chain[index].decision : undefined;
      const id = reuse?.id ?? `new_decision_${stepNumber}`;
      nodes.push({
        id, parentId, branch: null, eventType: 'decision', type,
        name: step.condition === 'opened_previous' ? 'Opened the previous email' : 'Clicked the previous email',
        description: reuse?.description ?? owner, properties: reuse?.properties ?? {}, schedule: emptySchedule(null),
      });
      parentId = id;
      branch = 'yes';
    }

    let properties: Record<string, unknown>;
    let name: string;
    if (kind === 'email') {
      const emailId = requiredId(step.emailId);
      if (emailIds.has(emailId)) {
        throw new UpstreamError(service, 400, 'Use a different email for each step. Each marketing email is sent once per contact.');
      }
      emailIds.add(emailId);
      properties = { email: emailId, email_type: 'marketing' };
      name = `Send email ${stepNumber}`;
    } else if (kind === 'tags') {
      const addTags = cleanStepTags(step.addTags);
      const removeTags = cleanStepTags(step.removeTags);
      if (!addTags.length && !removeTags.length) throw new UpstreamError(service, 400, 'Add or remove at least one tag in a tag step.');
      properties = { add_tags: addTags, remove_tags: removeTags };
      name = `Update tags ${stepNumber}`;
    } else if (kind === 'points') {
      const pointsDelta = step.pointsDelta ?? 0;
      if (!Number.isSafeInteger(pointsDelta) || pointsDelta === 0) throw new UpstreamError(service, 400, 'Set a non-zero whole number of points.');
      properties = { points: pointsDelta };
      name = `Adjust points ${stepNumber}`;
    } else if (kind === 'segment') {
      const addSegmentIds = [...new Set((step.addSegmentIds ?? []).map(requiredId))];
      const removeSegmentIds = [...new Set((step.removeSegmentIds ?? []).map(requiredId))];
      if (!addSegmentIds.length && !removeSegmentIds.length) {
        throw new UpstreamError(service, 400, 'Add or remove at least one segment in a segment step.');
      }
      properties = { addToLists: addSegmentIds, removeFromLists: removeSegmentIds };
      name = `Update segments ${stepNumber}`;
    } else if (kind === 'stage') {
      properties = { stage: requiredId(step.stageId) };
      name = `Change stage ${stepNumber}`;
    } else {
      throw new UpstreamError(service, 400, 'Choose a supported workflow step type.');
    }

    const reuse = chain[index]?.action.type === stepTypes[kind] ? chain[index].action : undefined;
    const id = reuse?.id ?? `new_${kind}_${stepNumber}`;
    nodes.push({
      id, parentId, branch, eventType: 'action', type: stepTypes[kind], name,
      description: reuse?.description ?? owner,
      properties: { ...(reuse?.properties ?? {}), ...properties },
      schedule: step.delayMinutes ? intervalSchedule(step.delayMinutes, 'i') : emptySchedule('immediate'),
    });
    parentId = id;
  }

  return {
    segmentIds: useFormTrigger ? [] : [requiredId(input.segmentId)],
    formIds: useFormTrigger ? [requiredId(input.formId)] : [],
    allowRestart: prior?.allowRestart ?? false,
    nodes,
  };
}

/** AUT-01 compatibility: the payload for a linear step list. */
export function workflowPayload(input: WorkflowInput, prior?: WorkflowGraph | null) {
  return graphPayload(stepsGraph(input, prior), { name: input.name, description: input.description }).payload;
}

export function toWorkflow(dto: ApiRecord): Workflow {
  const parsed = campaignGraph(dto);
  const { graph } = parsed;
  const steps = parsed.problem ? null : stepsFromGraph(graph);
  return {
    id: requiredId(dto.id),
    name: text(dto.name),
    description: text(dto.description),
    segmentId: graph.segmentIds[0] ?? 0,
    ...(graph.formIds[0] ? { formId: graph.formIds[0] } : {}),
    steps: steps ?? [],
    graph,
    enabled: published(dto),
    editable: !parsed.problem && graph.nodes.length > 0,
    ...(parsed.problem ? { readOnlyReason: parsed.problem } : !graph.nodes.length ? { readOnlyReason: 'This automation has no steps.' } : {}),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return canonical(Object.fromEntries(value.map((entry, index) => [String(index), entry])));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as ApiRecord)[key])]));
  }
  return value;
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function sameSchedule(a: WorkflowSchedule, b: WorkflowSchedule) {
  const sameDate = a.date === b.date || (a.date !== null && b.date !== null && Date.parse(a.date) === Date.parse(b.date));
  return a.mode === b.mode && a.interval === b.interval && a.unit === b.unit && sameDate
    && a.hour === b.hour && a.restrictedStartHour === b.restrictedStartHour && a.restrictedStopHour === b.restrictedStopHour
    && sameValue([...a.restrictedDaysOfWeek].sort(), [...b.restrictedDaysOfWeek].sort()) && (b.window === null || a.window === b.window);
}

/** Every property that was sent is stored as sent; keys the engine adds are allowed. */
function keepsProperties(saved: Record<string, unknown>, sent: Record<string, unknown>) {
  return Object.keys(sent).every(key => sameValue(saved[key], sent[key]));
}

function sameIds(a: number[], b: number[]) {
  return sameValue([...a].sort((x, y) => x - y), [...b].sort((x, y) => x - y));
}

/**
 * AUT-02: the saved campaign must hold exactly the graph that was sent: same steps, same ids for saved steps,
 * same parents, paths, properties and schedules, and still a draft.
 */
export function verifySavedGraph(dto: ApiRecord, expected: WorkflowGraph): Workflow {
  const saved = toWorkflow(dto);
  const fail = (): never => {
    throw new UpstreamError(service, 502, 'The automation engine did not confirm the complete draft.');
  };
  const graph = saved.graph;
  if (!graph || !saved.editable || saved.enabled) return fail();
  if (!sameIds(graph.segmentIds, expected.segmentIds) || !sameIds(graph.formIds, expected.formIds)) return fail();
  if (graph.nodes.length !== expected.nodes.length || graph.allowRestart !== expected.allowRestart) return fail();

  const savedById = new Map(graph.nodes.map(node => [node.id, node]));
  const mapped = new Map<string, string>();
  const used = new Set<string>();
  for (const node of orderedNodes(expected)) {
    const match = /^\d+$/.test(node.id)
      ? savedById.get(node.id)
      : graph.nodes.find(candidate => !used.has(candidate.id) && !/^\d+$/.test(node.id)
        && candidate.position && node.position && candidate.position.x === node.position.x && candidate.position.y === node.position.y);
    if (!match || used.has(match.id)) return fail();
    used.add(match.id);
    mapped.set(node.id, match.id);
    const parentMatches = node.parentId === null ? match.parentId === null : match.parentId === mapped.get(node.parentId);
    const comparable = node.type === 'campaign.jump_to_event'
      ? Object.fromEntries(Object.entries(node.properties).filter(([key]) => key !== 'jumpToEvent')) : node.properties;
    if (
      !parentMatches || match.type !== node.type || match.eventType !== node.eventType || match.branch !== node.branch
      || !keepsProperties(match.properties, comparable)
      || (node.eventType !== 'decision' && !sameSchedule(match.schedule, node.schedule))
    ) return fail();
  }
  // Jump steps must point at the saved id of the step they were sent with (CampaignActionJumpToEventSubscriber.php:115-143).
  for (const node of expected.nodes) {
    if (node.type !== 'campaign.jump_to_event') continue;
    const target = String(node.properties.jumpToEvent ?? '');
    const savedJump = savedById.get(mapped.get(node.id) ?? '');
    if (!savedJump || String(savedJump.properties.jumpToEvent ?? '') !== (mapped.get(target) ?? target)) return fail();
  }
  return saved;
}

/* ── AUT-03 / AUT-05: every record a workflow points at, for activation ──────── */

export type WorkflowReferenceKind =
  | 'email' | 'userEmail' | 'segment' | 'stage' | 'publishedStage' | 'company' | 'user' | 'form' | 'pointGroup'
  | 'campaign' | 'page' | 'dynamicContent' | 'focus' | 'message';

export type WorkflowReference = { kind: WorkflowReferenceKind; id: number; node: string; field?: string };

/**
 * Ids referenced by known steps on every branch. Unknown and unavailable steps are skipped: the console cannot tell
 * what their properties point at. Source segments and forms are checked separately.
 */
export function workflowReferences(graph: WorkflowGraph): WorkflowReference[] {
  const found: WorkflowReference[] = [];
  for (const node of graph.nodes) {
    if (!editableNodeSpec(node.type)) continue;
    const props = node.properties;
    const add = (kind: WorkflowReferenceKind, value: unknown, field?: string) => {
      const id = positiveId(value);
      if (id) found.push({ kind, id, node: node.name || node.type, ...(field ? { field } : {}) });
    };
    const addAll = (kind: WorkflowReferenceKind, value: unknown) => {
      for (const entry of entries(value)) if (entry !== 'this') add(kind, entry);
    };
    switch (node.type) {
      case 'email.send': add('email', props.email); break;
      case 'email.send.to.user': add('userEmail', record(props.useremail).email); addAll('user', props.user_id); break;
      case 'message.send': add('message', props.marketingMessage); break;
      case 'lead.changepoints': case 'lead.points': add('pointGroup', props.group); break;
      case 'lead.changelist': addAll('segment', props.addToLists); addAll('segment', props.removeFromLists); break;
      case 'stage.change': add('publishedStage', props.stage); break;
      case 'lead.addtocompany': add('company', props.company); break;
      case 'lead.changeowner': add('user', props.owner); break;
      case 'lead.owner': addAll('user', props.owner); break;
      case 'campaign.addremovelead': addAll('campaign', props.addTo); addAll('campaign', props.removeFrom); break;
      case 'lead.campaigns': addAll('campaign', props.campaigns); break;
      case 'dwc.push_content': add('dynamicContent', props.dynamicContent); break;
      case 'focus.show': add('focus', props.focus); break;
      case 'lead.pageHit': add('page', props.page); break;
      case 'lead.segments': addAll('segment', props.segments); break;
      case 'lead.stages': addAll('stage', props.stages); break;
      case 'form.field_value': add('form', props.form, text(props.field)); break;
    }
  }
  return found;
}

/* ── AUT-06: the engine's per-contact event log ────────────────────────────── */

function cleanReason(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.map(text).filter(Boolean).join('; ') : text(value);
  const cleaned = raw.replace(/<br\s*\/?>/gi, '; ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 500) : null;
}

type LogRow = {
  logId: number | null;
  workflowId: number | null;
  workflowName: string;
  nodeId: number | null;
  nodeName: string;
  nodeType: string;
  eventType: WorkflowEventType | null;
  isScheduled: boolean;
  dateTriggered: string | null;
  triggerDate: string | null;
  metadata: ApiRecord;
  nonAction: boolean;
  failReason: string | null;
  rotation: number | null;
  deleted: boolean;
  path: WorkflowBranch | null;
};

/**
 * Reads a row the way Mautic's own timeline does (Resources/views/SubscribedEvents/Timeline/index.html.twig:1-22,
 * EventListener/LeadSubscriber.php:105-114): a failure is metadata.failed or a failed-log reason; a row neither
 * scheduled nor triggered was cancelled. A failed row the engine rescheduled is retried at its trigger date
 * (EventScheduler::rescheduleFailures). PendingEvent::passWithError marks a row failed but passes it, so the contact
 * moved on: that reads as executed with a reason.
 */
function toRunEntry(row: LogRow): WorkflowRunEntry | null {
  if (!row.workflowId || !row.nodeId) return null;
  const errors = row.metadata.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Boolean(text(errors));
  const failedFlag = flag(row.metadata.failed) || Boolean(row.failReason) || (hasErrors && !row.dateTriggered);
  const reason = cleanReason(hasErrors ? errors : '') ?? cleanReason(row.metadata.reason) ?? cleanReason(row.failReason)
    ?? (failedFlag ? 'The engine reported a failure without a reason.' : null);
  let state: WorkflowRunState;
  if (failedFlag) state = row.isScheduled || row.failReason || !row.dateTriggered ? 'failed' : 'executed';
  else if (row.isScheduled) state = 'scheduled';
  else state = row.dateTriggered ? 'executed' : 'cancelled';
  const branchable = row.eventType === 'decision' || row.eventType === 'condition';
  return {
    logId: row.logId,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    nodeId: String(row.nodeId),
    nodeName: row.nodeName,
    nodeType: row.nodeType,
    eventType: row.eventType,
    state,
    path: row.path ?? (state === 'executed' && branchable ? (row.nonAction ? 'no' : 'yes') : null),
    nonAction: row.nonAction,
    triggeredAt: row.dateTriggered,
    scheduledFor: row.isScheduled ? row.triggerDate : null,
    reason: state === 'scheduled' || state === 'cancelled' ? null : reason,
    rotation: row.rotation,
    deleted: row.deleted,
  };
}

function eventTypeOf(value: unknown): WorkflowEventType | null {
  const type = text(value) as WorkflowEventType;
  return eventTypes.has(type) ? type : null;
}

/**
 * `GET /campaigns/events/contact/{id}` and `GET /campaigns/{campaignId}/events/contact/{id}`
 * (Config/config.php:91-111, Controller/Api/EventLogApiController.php:92-137): `{ total, events }` with each row in
 * the `campaignEventStandaloneLog` group (Entity/LeadEventLog.php:189-224): event, campaign, dateTriggered,
 * isScheduled, triggerDate, metadata, nonActionPathTaken, rotation. The rows carry no log id; when the engine keys
 * them by id, the key is used.
 */
export function eventLogEntries(response: ApiRecord): WorkflowRunEntry[] {
  const raw = response.events;
  const pairs: [string | null, unknown][] = Array.isArray(raw) ? raw.map(entry => [null, entry])
    : raw && typeof raw === 'object' ? Object.entries(raw) : [];
  return pairs.flatMap(([key, value]) => {
    const row = record(value);
    const event = record(row.event);
    const campaign = record(row.campaign);
    const entry = toRunEntry({
      logId: positiveId(row.id) ?? (key && /^\d+$/.test(key) ? positiveId(key) : null),
      workflowId: positiveId(campaign.id ?? row.campaign_id),
      workflowName: text(campaign.name),
      nodeId: positiveId(event.id ?? row.event_id),
      nodeName: text(event.name),
      nodeType: text(event.type),
      eventType: eventTypeOf(event.eventType),
      isScheduled: flag(row.isScheduled),
      dateTriggered: date(row.dateTriggered),
      triggerDate: date(row.triggerDate),
      metadata: record(row.metadata),
      nonAction: flag(row.nonActionPathTaken),
      failReason: null,
      rotation: number(row.rotation),
      deleted: false,
      path: null,
    });
    return entry ? [entry] : [];
  });
}

/**
 * Contact activity rows of type campaign.event and campaign.event.scheduled (`GET /contacts/{id}/activity`,
 * EventListener/LeadSubscriber.php:41-152). Each holds `details.log` from LeadEventLogRepository::getLeadLogs
 * (:67-138), which also returns the failed-log reason and covers rows written by cron, which carry no IP address.
 */
export function timelineLogEntries(events: unknown[]): WorkflowRunEntry[] {
  return events.flatMap(value => {
    const event = record(value);
    if (event.event !== 'campaign.event' && event.event !== 'campaign.event.scheduled') return [];
    const details = record(event.details ?? event.extra);
    const log = record(details.log);
    const pick = (snake: string, camel: string) => log[snake] ?? log[camel];
    const eventPath = text(record(details.eventDetails).path);
    const entry = toRunEntry({
      logId: positiveId(pick('log_id', 'logId')),
      workflowId: positiveId(pick('campaign_id', 'campaignId')),
      workflowName: text(pick('campaign_name', 'campaignName')),
      nodeId: positiveId(pick('event_id', 'eventId')),
      nodeName: text(pick('event_name', 'eventName')),
      nodeType: text(log.type),
      eventType: null,
      isScheduled: flag(log.isScheduled),
      dateTriggered: date(log.dateTriggered),
      triggerDate: date(log.triggerDate),
      metadata: record(log.metadata),
      nonAction: flag(log.nonActionPathTaken),
      failReason: cleanReason(pick('fail_reason', 'failReason')),
      rotation: null,
      deleted: Boolean(pick('event_deleted_timestamp', 'eventDeletedTimestamp')),
      path: eventPath === 'yes' || eventPath === 'no' ? eventPath : null,
    });
    return entry ? [entry] : [];
  });
}

const entryTime = (entry: WorkflowRunEntry) => entry.triggeredAt ?? entry.scheduledFor ?? '';

/**
 * Joins both sources. The REST log is exact (run number, event type) but only lists rows with an IP address: its query
 * inner-joins ipAddress (Entity/LeadEventLogRepository.php:28-53) and rows written by `mautic:campaigns:trigger` have
 * none (Executioner/Logger/EventLogger.php:71-73). The activity feed fills those in and adds failure reasons.
 */
export function mergeRunEntries(primary: WorkflowRunEntry[], secondary: WorkflowRunEntry[]): WorkflowRunEntry[] {
  const key = (entry: WorkflowRunEntry) => `${entry.workflowId}:${entry.nodeId}:${entry.triggeredAt ?? ''}:${entry.scheduledFor ?? ''}`;
  const merged = new Map<string, WorkflowRunEntry>();
  for (const entry of primary) merged.set(key(entry), entry);
  for (const entry of secondary) {
    const known = merged.get(key(entry)) ?? (entry.logId ? [...merged.values()].find(item => item.logId === entry.logId) : undefined);
    if (!known) {
      merged.set(key(entry), entry);
      continue;
    }
    merged.set(key(known), {
      ...known,
      logId: known.logId ?? entry.logId,
      workflowName: known.workflowName || entry.workflowName,
      nodeName: known.nodeName || entry.nodeName,
      nodeType: known.nodeType || entry.nodeType,
      // Only the activity feed sees the failed-log table, so its "failed" wins over "ran with an error".
      state: entry.state === 'failed' ? 'failed' : known.state,
      reason: known.reason ?? entry.reason,
      path: known.path ?? entry.path,
      deleted: known.deleted || entry.deleted,
    });
  }
  return [...merged.values()].sort((a, b) => entryTime(b).localeCompare(entryTime(a)) || Number(b.nodeId) - Number(a.nodeId));
}

/** The contact's newest membership row (Entity/Lead.php:84-103, Campaign::getContactMembership). */
export function membershipOf(value: unknown): WorkflowMembership | null {
  const rows = entries(value).map(record);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    dateAdded: date(row.dateAdded),
    manuallyRemoved: flag(row.manuallyRemoved),
    manuallyAdded: flag(row.manuallyAdded),
    rotation: number(row.rotation),
    dateLastExited: date(row.dateLastExited),
  };
}
