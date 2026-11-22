import type { Workflow, WorkflowInput, WorkflowStep } from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, items, number, positiveId, published, record, requiredId, service, text, type ApiRecord } from './normalize';

const owner = 'Managed by OVELIO';
const decisionTypes = { opened_previous: 'email.open', clicked_previous: 'email.click' } as const;

type EventId = string | number;
type NativeEvent = {
  id: EventId;
  type: string;
  name: string;
  description: string;
  eventType: 'decision' | 'action';
  properties: { email: number; email_type: 'marketing' } | [];
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

// Mautic links events using canvasSettings.connections, including for a step editor.
// Matching on the saved graph also keeps arbitrary native campaigns read-only.
export function managedSteps(dto: ApiRecord): ManagedStep[] {
  const events = new Map(items(dto.events ?? []).map(event => [String(event.id), event]));
  const canvas = record(dto.canvasSettings);
  const connections = Array.isArray(canvas.connections) ? canvas.connections.map(record) : [];
  if (!events.size || flag(dto.allowRestart) || items(dto.forms ?? []).length || items(dto.lists ?? []).length !== 1) return [];
  if (connections.length !== events.size || Array.from(events.values()).some(event => event.description !== owner)) return [];

  const bySource = new Map(connections.map(connection => [String(connection.sourceId), connection]));
  if (bySource.size !== connections.length) return [];
  const visited = new Set<string>();
  const steps: ManagedStep[] = [];
  let from = 'lists';
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
      if (!steps.length || condition || nextAnchor !== 'bottom') return [];
      condition = event.type === 'email.open' ? 'opened_previous' : 'clicked_previous';
      decisionId = requiredId(event.id);
      nextAnchor = 'yes';
      continue;
    }

    const props = record(event.properties);
    const emailId = positiveId(props.email);
    const delayMinutes = number(event.triggerInterval) ?? 0;
    const expectedMode = delayMinutes ? 'interval' : 'immediate';
    if (
      event.type !== 'email.send' || event.eventType !== 'action' || !emailId || props.email_type !== 'marketing'
      || !Number.isSafeInteger(delayMinutes) || delayMinutes < 0
      || (delayMinutes > 0 && event.triggerIntervalUnit !== 'i')
      || event.triggerMode !== expectedMode
    ) return [];
    steps.push({ emailId, delayMinutes, condition, actionId: requiredId(event.id), decisionId });
    condition = undefined;
    decisionId = undefined;
    nextAnchor = 'bottom';
  }

  return condition || visited.size !== events.size ? [] : steps;
}

export function toWorkflow(dto: ApiRecord): Workflow {
  const steps = managedSteps(dto);
  return {
    id: requiredId(dto.id),
    name: text(dto.name),
    description: text(dto.description),
    segmentId: positiveId(items(dto.lists ?? [])[0]?.id) ?? 0,
    steps: steps.map(({ emailId, delayMinutes, condition }) => ({
      emailId, delayMinutes, ...(condition ? { condition } : {}),
    })),
    enabled: published(dto),
    editable: Boolean(steps.length),
  };
}

export function workflowPayload(input: WorkflowInput, prior: ManagedStep[] = []) {
  if (!input.steps.length || input.steps.length > 20) {
    throw new UpstreamError(service, 400, 'Add between 1 and 20 email steps.');
  }

  const emailIds = new Set<number>();
  const events: NativeEvent[] = [];
  const connections: Connection[] = [];
  let from: EventId = 'lists';
  let anchor: Connection['anchors']['source'] = 'leadsource';

  for (const [index, step] of input.steps.entries()) {
    const stepNumber = index + 1;
    const emailId = requiredId(step.emailId);
    if (emailIds.has(emailId)) {
      throw new UpstreamError(service, 400, 'Use a different email for each step. Each marketing email is sent once per contact.');
    }
    emailIds.add(emailId);
    if (!Number.isSafeInteger(step.delayMinutes) || step.delayMinutes < 0 || step.delayMinutes > 525600) {
      throw new UpstreamError(service, 400, 'Set a whole-minute delay between 0 and 525600.');
    }
    if (step.condition) {
      const type = decisionTypes[step.condition];
      if (!index || !type) throw new UpstreamError(service, 400, 'An activity condition needs a preceding email step.');

      const id = prior[index]?.decisionId ?? `new_decision_${stepNumber}`;
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

    const id = prior[index]?.actionId ?? `new_send_${stepNumber}`;
    events.push({
      id,
      type: 'email.send',
      name: `Send email ${stepNumber}`,
      description: owner,
      eventType: 'action',
      properties: { email: emailId, email_type: 'marketing' },
      triggerInterval: step.delayMinutes,
      triggerIntervalUnit: step.delayMinutes ? 'i' : null,
      triggerMode: step.delayMinutes ? 'interval' : 'immediate',
    });
    connections.push({ sourceId: from, targetId: id, anchors: { source: anchor, target: 'top' } });
    from = id;
    anchor = 'bottom';
  }

  const nodes = [{ id: 'lists' as EventId, positionX: '220', positionY: '45' }];
  events.forEach((event, index) => nodes.push({ id: event.id, positionX: '220', positionY: String(165 + index * 125) }));
  return {
    name: input.name,
    description: input.description ?? '',
    lists: [{ id: requiredId(input.segmentId) }],
    forms: [],
    isPublished: false,
    allowRestart: false,
    events,
    canvasSettings: { nodes, connections },
  };
}

export function verifySavedWorkflow(dto: ApiRecord, input: WorkflowInput) {
  const saved = toWorkflow(dto);
  const sameSteps = saved.steps.length === input.steps.length
    && input.steps.every(({ emailId, delayMinutes, condition }, index) => {
      const step = saved.steps[index];
      return step.emailId === emailId && step.delayMinutes === delayMinutes && step.condition === condition;
    });
  if (!saved.editable || saved.segmentId !== input.segmentId || !sameSteps || saved.enabled) {
    throw new UpstreamError(service, 502, 'The automation engine did not confirm the complete draft.');
  }
  return saved;
}
