import { maxWorkflowSteps } from '../../contracts';
import type { Workflow, WorkflowInput, WorkflowStep, WorkflowStepKind } from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, items, number, positiveId, published, record, requiredId, service, text, type ApiRecord } from './normalize';

const owner = 'Managed by OVELIO';
const decisionTypes = { opened_previous: 'email.open', clicked_previous: 'email.click' } as const;

type EventId = string | number;
type ActionProperties =
  | { email: number; email_type: 'marketing' }
  | { add_tags: string[]; remove_tags: string[] }
  | { points: number }
  | { addToLists: number[]; removeFromLists: number[] }
  | { stage: number }
  | [];
type NativeEvent = {
  id: EventId;
  type: string;
  name: string;
  description: string;
  eventType: 'decision' | 'action';
  properties: ActionProperties;
  triggerInterval: number;
  triggerIntervalUnit: 'i' | null;
  triggerMode: 'interval' | 'immediate' | null;
};
type Connection = {
  sourceId: EventId;
  targetId: EventId;
  anchors: { source: 'leadsource' | 'bottom' | 'yes'; target: 'top' };
};
type ManagedStep = WorkflowStep & { actionId: number; decisionId?: number };

function cleanStepTags(tags?: string[]) {
  const cleaned = [...new Set((tags ?? []).map(tag => tag.trim()).filter(Boolean))];
  if (cleaned.some(tag => tag.startsWith('-'))) {
    throw new UpstreamError(service, 400, 'A tag cannot start with a hyphen.');
  }
  return cleaned;
}

function stringList(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).map(text).map(entry => entry.trim()).filter(Boolean);
}

function idList(value: unknown): number[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).map(positiveId).filter((id): id is number => id !== null);
}

function sameList<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function toPublicStep(step: ManagedStep): WorkflowStep {
  const kind: WorkflowStepKind = step.kind ?? 'email';
  const condition = step.condition ? { condition: step.condition } : {};
  switch (kind) {
    case 'email':
      return { emailId: step.emailId, delayMinutes: step.delayMinutes, ...condition };
    case 'tags':
      return {
        kind: 'tags', emailId: 0, delayMinutes: step.delayMinutes, ...condition,
        addTags: step.addTags ?? [], removeTags: step.removeTags ?? [],
      };
    case 'points':
      return {
        kind: 'points', emailId: 0, delayMinutes: step.delayMinutes, ...condition,
        pointsDelta: step.pointsDelta ?? 0,
      };
    case 'segment':
      return {
        kind: 'segment', emailId: 0, delayMinutes: step.delayMinutes, ...condition,
        addSegmentIds: step.addSegmentIds ?? [], removeSegmentIds: step.removeSegmentIds ?? [],
      };
    case 'stage':
      return {
        kind: 'stage', emailId: 0, delayMinutes: step.delayMinutes, ...condition,
        stageId: step.stageId,
      };
  }
}

// Mautic links events using canvasSettings.connections, including for a step editor.
// Matching on the saved graph also keeps arbitrary native campaigns read-only.
export function managedSteps(dto: ApiRecord): ManagedStep[] {
  const events = new Map(items(dto.events ?? []).map(event => [String(event.id), event]));
  const canvas = record(dto.canvasSettings);
  const connections = Array.isArray(canvas.connections) ? canvas.connections.map(record) : [];
  const listItems = items(dto.lists ?? []);
  const formItems = items(dto.forms ?? []);
  const hasList = listItems.length === 1 && formItems.length === 0;
  const hasForm = formItems.length === 1 && listItems.length === 0;
  if (!events.size || flag(dto.allowRestart) || (!hasList && !hasForm)) return [];
  if (connections.length !== events.size || Array.from(events.values()).some(event => event.description !== owner)) return [];

  const bySource = new Map(connections.map(connection => [String(connection.sourceId), connection]));
  if (bySource.size !== connections.length) return [];
  const visited = new Set<string>();
  const steps: ManagedStep[] = [];
  let from = hasList ? 'lists' : 'forms';
  let nextAnchor: Connection['anchors']['source'] = 'leadsource';
  let condition: WorkflowStep['condition'];
  let decisionId: number | undefined;

  while (bySource.has(from)) {
    const connection = bySource.get(from)!;
    const target = String(connection.targetId);
    const event = events.get(target);
    if (visited.has(target) || !event || record(connection.anchors).source !== nextAnchor) return [];
    visited.add(target);
    from = target;

    if ((event.type === 'email.open' || event.type === 'email.click') && event.eventType === 'decision') {
      if (!steps.length || (steps[steps.length - 1].kind ?? 'email') !== 'email' || condition || nextAnchor !== 'bottom') return [];
      condition = event.type === 'email.open' ? 'opened_previous' : 'clicked_previous';
      decisionId = requiredId(event.id);
      nextAnchor = 'yes';
      continue;
    }

    const props = record(event.properties);
    const delayMinutes = number(event.triggerInterval) ?? 0;
    const expectedMode = delayMinutes ? 'interval' : 'immediate';
    if (
      event.eventType !== 'action'
      || !Number.isSafeInteger(delayMinutes) || delayMinutes < 0
      || (delayMinutes > 0 && event.triggerIntervalUnit !== 'i')
      || event.triggerMode !== expectedMode
    ) return [];

    const actionId = requiredId(event.id);
    if (event.type === 'email.send') {
      const emailId = positiveId(props.email);
      if (!emailId || props.email_type !== 'marketing') return [];
      steps.push({ emailId, delayMinutes, condition, actionId, decisionId });
    } else if (event.type === 'lead.changetags') {
      const addTags = stringList(props.add_tags);
      const removeTags = stringList(props.remove_tags);
      if (!addTags.length && !removeTags.length) return [];
      steps.push({ kind: 'tags', emailId: 0, delayMinutes, condition, addTags, removeTags, actionId, decisionId });
    } else if (event.type === 'lead.changepoints') {
      const pointsDelta = number(props.points);
      if (pointsDelta === null || !Number.isSafeInteger(pointsDelta) || pointsDelta === 0) return [];
      steps.push({ kind: 'points', emailId: 0, delayMinutes, condition, pointsDelta, actionId, decisionId });
    } else if (event.type === 'lead.changelist') {
      const addSegmentIds = idList(props.addToLists);
      const removeSegmentIds = idList(props.removeFromLists);
      if (!addSegmentIds.length && !removeSegmentIds.length) return [];
      steps.push({ kind: 'segment', emailId: 0, delayMinutes, condition, addSegmentIds, removeSegmentIds, actionId, decisionId });
    } else if (event.type === 'stage.change') {
      const stageId = positiveId(props.stage);
      if (!stageId) return [];
      steps.push({ kind: 'stage', emailId: 0, delayMinutes, condition, stageId, actionId, decisionId });
    } else {
      return [];
    }

    condition = undefined;
    decisionId = undefined;
    nextAnchor = 'bottom';
  }

  return condition || visited.size !== events.size ? [] : steps;
}

export function toWorkflow(dto: ApiRecord): Workflow {
  const steps = managedSteps(dto);
  const segmentId = positiveId(items(dto.lists ?? [])[0]?.id) ?? 0;
  const formId = positiveId(items(dto.forms ?? [])[0]?.id) ?? undefined;
  return {
    id: requiredId(dto.id),
    name: text(dto.name),
    description: text(dto.description),
    segmentId,
    ...(formId ? { formId } : {}),
    steps: steps.map(toPublicStep),
    enabled: published(dto),
    editable: Boolean(steps.length),
  };
}

export function workflowPayload(input: WorkflowInput, prior: ManagedStep[] = []) {
  if (!input.steps.length || input.steps.length > maxWorkflowSteps) {
    throw new UpstreamError(service, 400, `Add between 1 and ${maxWorkflowSteps} workflow steps.`);
  }

  const useFormTrigger = input.segmentId === 0 && input.formId !== undefined && input.formId > 0;
  if (!useFormTrigger && input.segmentId <= 0) {
    throw new UpstreamError(service, 400, 'Select a valid segment or form trigger.');
  }
  const lists = useFormTrigger ? [] : [{ id: requiredId(input.segmentId) }];
  const forms = useFormTrigger ? [{ id: requiredId(input.formId) }] : [];
  const rootSource: EventId = useFormTrigger ? 'forms' : 'lists';

  const emailIds = new Set<number>();
  const events: NativeEvent[] = [];
  const connections: Connection[] = [];
  let from: EventId = rootSource;
  let anchor: Connection['anchors']['source'] = 'leadsource';

  for (const [index, step] of input.steps.entries()) {
    const stepNumber = index + 1;
    const kind: WorkflowStepKind = step.kind ?? 'email';
    if (!Number.isSafeInteger(step.delayMinutes) || step.delayMinutes < 0 || step.delayMinutes > 525600) {
      throw new UpstreamError(service, 400, 'Set a whole-minute delay between 0 and 525600.');
    }
    if (step.condition) {
      const type = decisionTypes[step.condition];
      const previous = index > 0 ? input.steps[index - 1] : undefined;
      if (!previous || (previous.kind ?? 'email') !== 'email' || !type) {
        throw new UpstreamError(service, 400, 'An activity condition needs a preceding email step.');
      }

      const id = prior[index]?.condition === step.condition && prior[index]?.decisionId
        ? prior[index].decisionId!
        : `new_decision_${stepNumber}`;
      events.push({
        id,
        type,
        name: step.condition === 'opened_previous' ? 'Opened the previous email' : 'Clicked the previous email',
        description: owner,
        eventType: 'decision',
        properties: [],
        triggerInterval: 0,
        triggerIntervalUnit: null,
        triggerMode: null,
      });
      connections.push({ sourceId: from, targetId: id, anchors: { source: anchor, target: 'top' } });
      from = id;
      anchor = 'yes';
    }

    const existingId = prior[index] && (prior[index].kind ?? 'email') === kind ? prior[index].actionId : undefined;
    const triggerInterval = step.delayMinutes;
    const triggerIntervalUnit = step.delayMinutes ? 'i' : null;
    const triggerMode = step.delayMinutes ? 'interval' : 'immediate';

    let actionEvent: NativeEvent;
    if (kind === 'email') {
      const emailId = requiredId(step.emailId);
      if (emailIds.has(emailId)) {
        throw new UpstreamError(service, 400, 'Use a different email for each step. Each marketing email is sent once per contact.');
      }
      emailIds.add(emailId);
      actionEvent = {
        id: existingId ?? `new_send_${stepNumber}`,
        type: 'email.send',
        name: `Send email ${stepNumber}`,
        description: owner,
        eventType: 'action',
        properties: { email: emailId, email_type: 'marketing' },
        triggerInterval, triggerIntervalUnit, triggerMode,
      };
    } else if (kind === 'tags') {
      const addTags = cleanStepTags(step.addTags);
      const removeTags = cleanStepTags(step.removeTags);
      if (!addTags.length && !removeTags.length) {
        throw new UpstreamError(service, 400, 'Add or remove at least one tag in a tag step.');
      }
      actionEvent = {
        id: existingId ?? `new_tags_${stepNumber}`,
        type: 'lead.changetags',
        name: `Update tags ${stepNumber}`,
        description: owner,
        eventType: 'action',
        properties: { add_tags: addTags, remove_tags: removeTags },
        triggerInterval, triggerIntervalUnit, triggerMode,
      };
    } else if (kind === 'points') {
      const pointsDelta = step.pointsDelta ?? 0;
      if (!Number.isSafeInteger(pointsDelta) || pointsDelta === 0) {
        throw new UpstreamError(service, 400, 'Set a non-zero whole number of points.');
      }
      actionEvent = {
        id: existingId ?? `new_points_${stepNumber}`,
        type: 'lead.changepoints',
        name: `Adjust points ${stepNumber}`,
        description: owner,
        eventType: 'action',
        properties: { points: pointsDelta },
        triggerInterval, triggerIntervalUnit, triggerMode,
      };
    } else if (kind === 'segment') {
      const addSegmentIds = [...new Set((step.addSegmentIds ?? []).map(requiredId))];
      const removeSegmentIds = [...new Set((step.removeSegmentIds ?? []).map(requiredId))];
      if (!addSegmentIds.length && !removeSegmentIds.length) {
        throw new UpstreamError(service, 400, 'Add or remove at least one segment in a segment step.');
      }
      actionEvent = {
        id: existingId ?? `new_segment_${stepNumber}`,
        type: 'lead.changelist',
        name: `Update segments ${stepNumber}`,
        description: owner,
        eventType: 'action',
        properties: { addToLists: addSegmentIds, removeFromLists: removeSegmentIds },
        triggerInterval, triggerIntervalUnit, triggerMode,
      };
    } else if (kind === 'stage') {
      const stageId = requiredId(step.stageId);
      actionEvent = {
        id: existingId ?? `new_stage_${stepNumber}`,
        type: 'stage.change',
        name: `Change stage ${stepNumber}`,
        description: owner,
        eventType: 'action',
        properties: { stage: stageId },
        triggerInterval, triggerIntervalUnit, triggerMode,
      };
    } else {
      throw new UpstreamError(service, 400, 'Choose a supported workflow step type.');
    }

    events.push(actionEvent);
    connections.push({ sourceId: from, targetId: actionEvent.id, anchors: { source: anchor, target: 'top' } });
    from = actionEvent.id;
    anchor = 'bottom';
  }

  const nodes: { id: EventId; positionX: string; positionY: string }[] = [{ id: rootSource, positionX: '220', positionY: '45' }];
  events.forEach((event, index) => nodes.push({ id: event.id, positionX: '220', positionY: String(165 + index * 125) }));
  return {
    name: input.name,
    description: input.description ?? '',
    lists,
    forms,
    isPublished: false,
    allowRestart: false,
    events,
    canvasSettings: { nodes, connections },
  };
}

export function verifySavedWorkflow(dto: ApiRecord, input: WorkflowInput) {
  const saved = toWorkflow(dto);
  const expectedSegmentId = input.segmentId > 0 ? input.segmentId : 0;
  const expectedFormId = expectedSegmentId > 0 ? undefined : input.formId;
  const sameSteps = saved.steps.length === input.steps.length
    && input.steps.every((expected, index) => {
      const step = saved.steps[index];
      const kind: WorkflowStepKind = expected.kind ?? 'email';
      if ((step.kind ?? 'email') !== kind || step.delayMinutes !== expected.delayMinutes || step.condition !== expected.condition) {
        return false;
      }
      switch (kind) {
        case 'email':
          return step.emailId === expected.emailId;
        case 'tags':
          return sameList(step.addTags ?? [], cleanStepTags(expected.addTags))
            && sameList(step.removeTags ?? [], cleanStepTags(expected.removeTags));
        case 'points':
          return step.pointsDelta === (expected.pointsDelta ?? 0);
        case 'segment':
          return sameList(step.addSegmentIds ?? [], [...new Set(expected.addSegmentIds ?? [])])
            && sameList(step.removeSegmentIds ?? [], [...new Set(expected.removeSegmentIds ?? [])]);
        case 'stage':
          return step.stageId === expected.stageId;
      }
    });
  if (
    !saved.editable
    || saved.segmentId !== expectedSegmentId
    || saved.formId !== expectedFormId
    || !sameSteps
    || saved.enabled
  ) {
    throw new UpstreamError(service, 502, 'The automation engine did not confirm the complete draft.');
  }
  return saved;
}
