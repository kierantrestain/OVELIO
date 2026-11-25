// Lane 4 (Campaigns & Automations) contracts: OVELIO's native flow engine and the marketing campaign hub.
// Shared by the server (src/server/journeys/) and the console (src/components/journeys/), so validation, node
// summaries, layout and templates are identical on both sides. Owned by lane 4 (docs/rebuild/TRACKER.md §3).

/* ── Flows ────────────────────────────────────────────────────────────────────────────────────────────────── */

export const flowStatuses = ['draft', 'published', 'paused', 'archived'] as const;
export type FlowStatus = (typeof flowStatuses)[number];

/** `once`: a contact enters a flow at most once. `every_time`: again on each matching event, but never while already in it. */
export type ReentryRule = 'once' | 'every_time';

export const flowTriggerTypes = [
  'form.submitted', 'page.converted', 'page.viewed',
  'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost', 'task.completed',
  'contact.created', 'contact.tagged', 'email.unsubscribed', 'campaign.launched',
] as const;
export type FlowTriggerType = (typeof flowTriggerTypes)[number];

export type TriggerFilters = {
  formId?: string; formName?: string;
  pageId?: string; pageName?: string;
  pipelineId?: string; pipelineName?: string;
  stageId?: string; stageName?: string;
  tag?: string;
  campaignId?: string; campaignName?: string;
};
export type FlowTrigger = { id: string; type: FlowTriggerType; filters: TriggerFilters };

type TriggerFilterKind = 'form' | 'page' | 'pipeline' | 'stage' | 'tag' | 'campaign';
export type FlowTriggerSpec = {
  type: FlowTriggerType;
  label: string;
  group: 'Forms & pages' | 'Sales' | 'Contacts' | 'Campaigns';
  description: string;
  filters: TriggerFilterKind[];
  /** Filters that must be set. */
  required?: TriggerFilterKind[];
  /** The event carries no contact (the enrolment runs without one; contact steps are skipped). */
  contactless?: boolean;
};

export const flowTriggerSpecs: FlowTriggerSpec[] = [
  { type: 'form.submitted', label: 'Form submitted', group: 'Forms & pages', description: 'Someone submits an OVELIO form.', filters: ['form'] },
  { type: 'page.converted', label: 'Landing page conversion', group: 'Forms & pages', description: 'A visitor converts on a landing page.', filters: ['page'] },
  { type: 'page.viewed', label: 'Landing page viewed', group: 'Forms & pages', description: 'A known contact views a landing page.', filters: ['page'] },
  { type: 'deal.created', label: 'Deal created', group: 'Sales', description: 'A deal is added to a pipeline.', filters: ['pipeline'] },
  { type: 'deal.stage_changed', label: 'Deal stage changed', group: 'Sales', description: 'A deal moves to a stage.', filters: ['pipeline', 'stage'] },
  { type: 'deal.won', label: 'Deal won', group: 'Sales', description: 'A deal is closed as won.', filters: ['pipeline'] },
  { type: 'deal.lost', label: 'Deal lost', group: 'Sales', description: 'A deal is closed as lost.', filters: ['pipeline'] },
  { type: 'task.completed', label: 'Task completed', group: 'Sales', description: 'A task linked to a contact is marked done.', filters: [] },
  { type: 'contact.created', label: 'Contact created', group: 'Contacts', description: 'A new contact is added.', filters: [] },
  { type: 'contact.tagged', label: 'Tag added', group: 'Contacts', description: 'A contact receives a tag.', filters: ['tag'], required: ['tag'] },
  { type: 'email.unsubscribed', label: 'Unsubscribed', group: 'Contacts', description: 'A contact unsubscribes from email.', filters: [] },
  { type: 'campaign.launched', label: 'Campaign launched', group: 'Campaigns', description: 'A marketing campaign is launched. Runs once, without a contact.', filters: ['campaign'], contactless: true },
];

export function triggerSpec(type: FlowTriggerType): FlowTriggerSpec {
  return flowTriggerSpecs.find(spec => spec.type === type) ?? flowTriggerSpecs[0];
}

export function describeTrigger(trigger: FlowTrigger): string {
  const spec = triggerSpec(trigger.type);
  const f = trigger.filters ?? {};
  switch (trigger.type) {
    case 'form.submitted': return f.formId ? `${spec.label}: ${f.formName || 'selected form'}` : `${spec.label}: any form`;
    case 'page.converted': case 'page.viewed': return f.pageId ? `${spec.label}: ${f.pageName || 'selected page'}` : `${spec.label}: any page`;
    case 'deal.stage_changed': return f.stageId ? `Deal moved to ${f.stageName || 'selected stage'}` : `${spec.label}${f.pipelineId ? ` in ${f.pipelineName || 'pipeline'}` : ''}`;
    case 'deal.created': case 'deal.won': case 'deal.lost': return f.pipelineId ? `${spec.label} in ${f.pipelineName || 'selected pipeline'}` : spec.label;
    case 'contact.tagged': return f.tag ? `Tag added: ${f.tag}` : 'Tag added (choose a tag)';
    case 'campaign.launched': return f.campaignId ? `Campaign launched: ${f.campaignName || 'selected campaign'}` : 'Any campaign launched';
    default: return spec.label;
  }
}

/* ── Graph ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const flowNodeTypes = [
  'start', 'wait', 'condition', 'split',
  'send_email', 'add_tag', 'remove_tag', 'adjust_score',
  'create_deal', 'move_deal', 'create_task', 'notify_owner', 'webhook', 'exit',
] as const;
export type FlowNodeType = (typeof flowNodeTypes)[number];

/** Exits from a node: `next` for a plain step, `yes`/`no` for a condition, `a`/`b` for an A/B split. */
export type FlowHandle = 'next' | 'yes' | 'no' | 'a' | 'b';

export type FlowNode = { id: string; type: FlowNodeType; position: { x: number; y: number }; config: Record<string, unknown> };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle: FlowHandle };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

export type WaitUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type ConditionCheck = 'field' | 'tag' | 'score' | 'consent' | 'open_deal' | 'deal_value' | 'form_field';
export type ConditionOperator =
  | 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'
  | 'has' | 'not_has' | 'gte' | 'lte' | 'gt' | 'lt' | 'yes' | 'no';
export type TaskKind = 'todo' | 'call' | 'email' | 'meeting' | 'follow_up';

export const contactFieldChoices = [
  { value: 'firstName', label: 'First name' }, { value: 'lastName', label: 'Last name' }, { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' }, { value: 'position', label: 'Job title' }, { value: 'phone', label: 'Phone' },
  { value: 'stageName', label: 'Lifecycle stage' },
] as const;

export const conditionChecks: { value: ConditionCheck; label: string; operators: ConditionOperator[]; needsValue: boolean }[] = [
  { value: 'tag', label: 'Contact has a tag', operators: ['has', 'not_has'], needsValue: true },
  { value: 'field', label: 'Contact field', operators: ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'], needsValue: true },
  { value: 'score', label: 'Lead score', operators: ['gte', 'gt', 'lte', 'lt', 'equals'], needsValue: true },
  { value: 'consent', label: 'Email consent', operators: ['yes', 'no'], needsValue: false },
  { value: 'open_deal', label: 'Has an open deal', operators: ['yes', 'no'], needsValue: false },
  { value: 'deal_value', label: 'Deal value', operators: ['gte', 'gt', 'lte', 'lt'], needsValue: true },
  { value: 'form_field', label: 'Form answer (from the trigger)', operators: ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty'], needsValue: true },
];

export const operatorLabels: Record<ConditionOperator, string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'does not contain', is_empty: 'is empty',
  is_not_empty: 'is not empty', has: 'has', not_has: 'does not have', gte: 'is at least', lte: 'is at most',
  gt: 'is more than', lt: 'is less than', yes: 'yes', no: 'no',
};

export type FlowNodeGroup = 'Start' | 'Timing & logic' | 'Messages' | 'Contacts' | 'Sales' | 'Integrations' | 'End';

export type FlowNodeSpec = {
  type: FlowNodeType;
  label: string;
  group: FlowNodeGroup;
  description: string;
  handles: FlowHandle[];
  defaults: () => Record<string, unknown>;
  /** Needs a contact on the enrolment; skipped (and logged) for contactless triggers. */
  needsContact?: boolean;
};

export const flowNodeSpecs: FlowNodeSpec[] = [
  { type: 'start', label: 'Start', group: 'Start', description: 'Contacts enter here when a trigger fires or they are enrolled manually.', handles: ['next'], defaults: () => ({}) },
  { type: 'wait', label: 'Wait', group: 'Timing & logic', description: 'Pause for a time, or until a date.', handles: ['next'], defaults: () => ({ mode: 'duration', amount: 1, unit: 'days' }) },
  { type: 'condition', label: 'If / else', group: 'Timing & logic', description: 'Check the contact, their deals or the form answers, then follow Yes or No.', handles: ['yes', 'no'], defaults: () => ({ check: 'tag', operator: 'has', value: '' }) },
  { type: 'split', label: 'A/B split', group: 'Timing & logic', description: 'Send a share of contacts down path A and the rest down B.', handles: ['a', 'b'], defaults: () => ({ percentA: 50 }) },
  { type: 'send_email', label: 'Send email', group: 'Messages', description: 'Send a saved email design. Consent and suppression are checked first.', handles: ['next'], defaults: () => ({ designId: '', designName: '' }), needsContact: true },
  { type: 'add_tag', label: 'Add tag', group: 'Contacts', description: 'Add one or more tags to the contact.', handles: ['next'], defaults: () => ({ tags: [] }), needsContact: true },
  { type: 'remove_tag', label: 'Remove tag', group: 'Contacts', description: 'Remove tags from the contact.', handles: ['next'], defaults: () => ({ tags: [] }), needsContact: true },
  { type: 'adjust_score', label: 'Adjust lead score', group: 'Contacts', description: 'Add or subtract lead score points.', handles: ['next'], defaults: () => ({ delta: 10 }), needsContact: true },
  { type: 'create_deal', label: 'Create deal', group: 'Sales', description: 'Open a deal for the contact, attributed to the flow’s campaign.', handles: ['next'], defaults: () => ({ name: 'New deal for {{contact.full_name}}', amount: 0, pipelineId: '', stageId: '' }) },
  { type: 'move_deal', label: 'Move deal stage', group: 'Sales', description: 'Move the deal that triggered the flow to a stage.', handles: ['next'], defaults: () => ({ pipelineId: '', stageId: '' }) },
  { type: 'create_task', label: 'Create task', group: 'Sales', description: 'Create a follow-up task for the record owner or a teammate.', handles: ['next'], defaults: () => ({ title: 'Follow up with {{contact.full_name}}', type: 'follow_up', dueInDays: 1, priority: 'normal', assignee: 'owner' }) },
  { type: 'notify_owner', label: 'Notify owner', group: 'Sales', description: 'Tell the record owner, as a task in their list.', handles: ['next'], defaults: () => ({ message: 'Take a look at {{contact.full_name}}', userId: '' }) },
  { type: 'webhook', label: 'Send webhook', group: 'Integrations', description: 'POST signed JSON to another system (HMAC-SHA256, 10 s timeout, retried).', handles: ['next'], defaults: () => ({ url: '', secret: '' }) },
  { type: 'exit', label: 'Exit', group: 'End', description: 'Remove the contact from the flow here.', handles: [], defaults: () => ({}) },
];

export function nodeSpec(type: FlowNodeType): FlowNodeSpec {
  return flowNodeSpecs.find(spec => spec.type === type) ?? flowNodeSpecs[0];
}

export const handleLabels: Record<FlowHandle, string> = { next: '', yes: 'Yes', no: 'No', a: 'A', b: 'B' };

export function handleLabel(handle: FlowHandle, node?: FlowNode): string {
  if (node?.type === 'split') {
    const percent = clampPercent(node.config.percentA);
    return handle === 'a' ? `A · ${percent}%` : handle === 'b' ? `B · ${100 - percent}%` : '';
  }
  return handleLabels[handle];
}

const str = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : String(value);
const num = (value: unknown) => typeof value === 'number' ? value : Number(value);
export const tagsOf = (value: unknown): string[] => Array.isArray(value) ? value.map(item => str(item).trim()).filter(Boolean) : [];
export function clampPercent(value: unknown) {
  const n = Math.round(num(value));
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 50;
}

export function waitMilliseconds(config: Record<string, unknown>): number {
  const amount = Math.max(0, num(config.amount) || 0);
  const unit = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }[str(config.unit) as WaitUnit] ?? 86_400_000;
  return amount * unit;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** One line describing what a node does, for cards, logs and the dry run. */
export function describeNode(node: FlowNode): string {
  const c = node.config ?? {};
  switch (node.type) {
    case 'start': return 'Contacts enter here';
    case 'wait': {
      if (c.mode === 'until') return c.until ? `Until ${new Date(str(c.until)).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC` : 'Choose a date';
      const amount = Math.max(0, num(c.amount) || 0);
      return amount ? `Wait ${plural(amount, str(c.unit || 'days').replace(/s$/, ''))}` : 'Choose how long';
    }
    case 'condition': {
      const check = conditionChecks.find(item => item.value === c.check);
      if (!check) return 'Choose what to check';
      const op = operatorLabels[c.operator as ConditionOperator] ?? '';
      switch (check.value) {
        case 'tag': return `${c.operator === 'not_has' ? 'Does not have' : 'Has'} tag “${str(c.value) || '…'}”`;
        case 'field': return `${contactFieldChoices.find(item => item.value === c.field)?.label ?? 'Field'} ${op}${needsCompare(c.operator) ? ` “${str(c.value)}”` : ''}`;
        case 'score': return `Lead score ${op} ${str(c.value) || '…'}`;
        case 'consent': return c.operator === 'no' ? 'Cannot be emailed' : 'Can be emailed (consent recorded)';
        case 'open_deal': return c.operator === 'no' ? 'Has no open deal' : 'Has an open deal';
        case 'deal_value': return `Deal value ${op} ${str(c.value) || '…'}`;
        case 'form_field': return `Answer “${str(c.field) || '…'}” ${op}${needsCompare(c.operator) ? ` “${str(c.value)}”` : ''}`;
      }
      return check.label;
    }
    case 'split': { const a = clampPercent(c.percentA); return `${a}% to A, ${100 - a}% to B`; }
    case 'send_email': return c.designId ? `Email “${str(c.designName) || 'selected design'}”` : 'Choose an email design';
    case 'add_tag': return tagsOf(c.tags).length ? `Add ${tagsOf(c.tags).join(', ')}` : 'Choose tags';
    case 'remove_tag': return tagsOf(c.tags).length ? `Remove ${tagsOf(c.tags).join(', ')}` : 'Choose tags';
    case 'adjust_score': { const d = num(c.delta) || 0; return d ? `${d > 0 ? '+' : ''}${d} points` : 'Choose points'; }
    case 'create_deal': return str(c.name) ? `“${str(c.name)}”${num(c.amount) ? ` · ${num(c.amount)}` : ''}` : 'Name the deal';
    case 'move_deal': return c.stageId ? `To ${str(c.stageName) || 'selected stage'}` : 'Choose a stage';
    case 'create_task': return str(c.title) ? `“${str(c.title)}”${num(c.dueInDays) ? ` · due in ${plural(num(c.dueInDays), 'day')}` : ''}` : 'Name the task';
    case 'notify_owner': return str(c.message) ? `“${str(c.message)}”` : 'Write a message';
    case 'webhook': { try { return c.url ? `POST ${new URL(str(c.url)).host}` : 'Enter a URL'; } catch { return 'Enter a valid URL'; } }
    case 'exit': return 'Leave the flow';
  }
}

export function needsCompare(operator: unknown) {
  return !['is_empty', 'is_not_empty', 'yes', 'no'].includes(str(operator));
}

/* ── Validation ───────────────────────────────────────────────────────────────────────────────────────────── */

export type FlowIssue = { level: 'error' | 'warning'; message: string; nodeId?: string; triggerId?: string };

export const maxFlowNodes = 80;

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Node configuration problems: what must be filled in before the flow can publish. */
export function nodeIssues(node: FlowNode): string[] {
  const c = node.config ?? {};
  const issues: string[] = [];
  switch (node.type) {
    case 'wait':
      if (c.mode === 'until') { if (!c.until || Number.isNaN(Date.parse(str(c.until)))) issues.push('Choose the date to wait until.'); }
      else if (!(num(c.amount) > 0)) issues.push('Enter how long to wait.');
      break;
    case 'condition': {
      const check = conditionChecks.find(item => item.value === c.check);
      if (!check) { issues.push('Choose what to check.'); break; }
      if (!check.operators.includes(c.operator as ConditionOperator)) issues.push('Choose how to compare.');
      if ((check.value === 'field' || check.value === 'form_field') && !str(c.field).trim()) issues.push(check.value === 'field' ? 'Choose a contact field.' : 'Enter the form field name.');
      if (check.needsValue && needsCompare(c.operator) && !str(c.value).trim()) issues.push('Enter a value to compare with.');
      if ((check.value === 'score' || check.value === 'deal_value') && str(c.value).trim() && !Number.isFinite(Number(c.value))) issues.push('Enter a number.');
      break;
    }
    case 'send_email': if (!str(c.designId)) issues.push('Choose the email design to send.'); break;
    case 'add_tag': case 'remove_tag': if (!tagsOf(c.tags).length) issues.push('Add at least one tag.'); break;
    case 'adjust_score': if (!Number.isInteger(num(c.delta)) || num(c.delta) === 0) issues.push('Enter a whole number of points other than zero.'); break;
    case 'create_deal': if (!str(c.name).trim()) issues.push('Name the deal.'); if (c.amount != null && c.amount !== '' && !(num(c.amount) >= 0)) issues.push('Enter a deal value of zero or more.'); break;
    case 'move_deal': if (!str(c.stageId)) issues.push('Choose the stage to move the deal to.'); break;
    case 'create_task': if (!str(c.title).trim()) issues.push('Give the task a title.'); if (c.assignee !== 'owner' && !str(c.assignee)) issues.push('Choose who the task is for.'); break;
    case 'notify_owner': if (!str(c.message).trim()) issues.push('Write the message for the owner.'); break;
    case 'webhook':
      if (!validUrl(str(c.url))) issues.push('Enter the http(s) URL to POST to.');
      if (str(c.secret).length < 16) issues.push('Add a signing secret of at least 16 characters.');
      break;
    default: break;
  }
  return issues;
}

/** Problems that block publishing (`error`) or are worth a look (`warning`). Used by the canvas and by publish. */
export function validateFlow(graph: FlowGraph, triggers: FlowTrigger[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const starts = graph.nodes.filter(node => node.type === 'start');
  if (starts.length !== 1) issues.push({ level: 'error', message: starts.length ? 'A flow has exactly one start.' : 'Add a start step.' });
  if (graph.nodes.length > maxFlowNodes) issues.push({ level: 'error', message: `A flow can hold up to ${maxFlowNodes} steps.` });
  if (graph.nodes.length <= 1) issues.push({ level: 'error', message: 'Add at least one step after the start.' });

  for (const trigger of triggers) {
    const spec = triggerSpec(trigger.type);
    for (const required of spec.required ?? []) {
      if (required === 'tag' && !trigger.filters?.tag?.trim()) issues.push({ level: 'error', message: 'Choose the tag that starts the flow.', triggerId: trigger.id });
    }
  }
  if (!triggers.length) issues.push({ level: 'warning', message: 'No triggers: contacts join only when enrolled manually.' });

  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      issues.push({ level: 'error', message: 'A connection points to a step that no longer exists.' });
      continue;
    }
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    if (nodes.get(edge.target)?.type === 'start') issues.push({ level: 'error', message: 'Nothing can lead back into the start.', nodeId: edge.source });
  }

  for (const node of graph.nodes) {
    const spec = nodeSpec(node.type);
    for (const message of nodeIssues(node)) issues.push({ level: 'error', message, nodeId: node.id });
    const edges = outgoing.get(node.id) ?? [];
    for (const handle of spec.handles) {
      const from = edges.filter(edge => edge.sourceHandle === handle);
      if (from.length > 1) issues.push({ level: 'error', message: `${handle === 'next' ? 'This step' : `The ${handleLabel(handle, node)} path`} can lead to only one next step.`, nodeId: node.id });
      if (!from.length && node.type === 'start') issues.push({ level: 'error', message: 'Connect the start to the first step.', nodeId: node.id });
      if (!from.length && node.type === 'wait') issues.push({ level: 'error', message: 'Connect the wait to the step that follows it.', nodeId: node.id });
      if (!from.length && (node.type === 'condition' || node.type === 'split')) {
        issues.push({ level: 'warning', message: `Nothing on the ${handleLabel(handle, node)} path: those contacts finish the flow here.`, nodeId: node.id });
      }
    }
    for (const edge of edges) if (!spec.handles.includes(edge.sourceHandle)) issues.push({ level: 'error', message: 'A connection leaves this step from an exit it does not have.', nodeId: node.id });
  }

  // Reachability from the start.
  const start = starts[0];
  if (start) {
    const seen = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const edge of outgoing.get(id) ?? []) if (!seen.has(edge.target)) { seen.add(edge.target); queue.push(edge.target); }
    }
    for (const node of graph.nodes) if (!seen.has(node.id)) issues.push({ level: 'error', message: 'Not connected: link this step into the flow or delete it.', nodeId: node.id });
  }

  // Loops must pass through a wait, or a contact could run the same actions endlessly in one go.
  const cycleNode = findCycleWithoutWait(graph);
  if (cycleNode) issues.push({ level: 'error', message: 'This loop has no wait in it. Add a wait so contacts cannot repeat it endlessly.', nodeId: cycleNode });

  const hasDealTrigger = triggers.some(trigger => trigger.type.startsWith('deal.'));
  for (const node of graph.nodes) {
    if (node.type === 'move_deal' && !hasDealTrigger) issues.push({ level: 'warning', message: 'Moves the triggering deal: enrolments that did not start from a deal skip this step.', nodeId: node.id });
  }
  if (triggers.length && triggers.every(trigger => triggerSpec(trigger.type).contactless)) {
    for (const node of graph.nodes) {
      if (nodeSpec(node.type).needsContact) issues.push({ level: 'warning', message: 'This trigger has no contact, so this step will be skipped.', nodeId: node.id });
    }
  }
  return issues;
}

/** A node on a cycle that contains no wait, or null. */
export function findCycleWithoutWait(graph: FlowGraph): string | null {
  const types = new Map(graph.nodes.map(node => [node.id, node.type]));
  const next = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (types.get(edge.source) === 'wait' || types.get(edge.target) === 'wait') continue;
    next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]);
  }
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): string | null => {
    state.set(id, 1);
    for (const target of next.get(id) ?? []) {
      if (state.get(target) === 1) return target;
      if (!state.has(target)) { const found = visit(target); if (found) return found; }
    }
    state.set(id, 2);
    return null;
  };
  for (const node of graph.nodes) {
    if (!state.has(node.id)) { const found = visit(node.id); if (found) return found; }
  }
  return null;
}

/* ── Layout ───────────────────────────────────────────────────────────────────────────────────────────────── */

export const nodeBox = { width: 240, height: 86, gapX: 40, gapY: 70 };

const handleOrder: FlowHandle[] = ['yes', 'a', 'next', 'no', 'b'];

/**
 * Tidy top-down layout: a spanning tree from the start (branches ordered Yes/A first), each parent centred over its
 * children. Edges that close a loop or merge paths keep their connection but do not move nodes. Unreachable steps
 * line up to the right.
 */
export function tidyLayout(graph: FlowGraph): FlowGraph {
  const start = graph.nodes.find(node => node.type === 'start');
  if (!start) return graph;
  const children = new Map<string, string[]>();
  const placed = new Set<string>([start.id]);
  const queue = [start.id];
  const depth = new Map<string, number>([[start.id, 0]]);
  while (queue.length) {
    const id = queue.shift()!;
    const edges = graph.edges.filter(edge => edge.source === id)
      .sort((a, b) => handleOrder.indexOf(a.sourceHandle) - handleOrder.indexOf(b.sourceHandle));
    for (const edge of edges) {
      if (placed.has(edge.target)) continue;
      placed.add(edge.target);
      depth.set(edge.target, (depth.get(id) ?? 0) + 1);
      children.set(id, [...(children.get(id) ?? []), edge.target]);
      queue.push(edge.target);
    }
  }
  const step = nodeBox.width + nodeBox.gapX;
  const width = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id) ?? [];
    const total = kids.length ? kids.reduce((sum, kid) => sum + measure(kid), 0) : 1;
    width.set(id, total);
    return total;
  };
  measure(start.id);
  const x = new Map<string, number>();
  const assign = (id: string, left: number) => {
    const kids = children.get(id) ?? [];
    x.set(id, left + ((width.get(id) ?? 1) * step) / 2 - nodeBox.width / 2);
    let cursor = left;
    for (const kid of kids) { assign(kid, cursor); cursor += (width.get(kid) ?? 1) * step; }
  };
  assign(start.id, 0);
  let spare = (width.get(start.id) ?? 1) * step + nodeBox.gapX;
  let spareRow = 0;
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      if (x.has(node.id)) return { ...node, position: { x: Math.round(x.get(node.id)!), y: (depth.get(node.id) ?? 0) * (nodeBox.height + nodeBox.gapY) } };
      const position = { x: spare, y: spareRow * (nodeBox.height + nodeBox.gapY) };
      spareRow += 1;
      if (spareRow > 4) { spareRow = 0; spare += step; }
      return { ...node, position };
    }),
  };
}

/* ── Templates ────────────────────────────────────────────────────────────────────────────────────────────── */

export type FlowTemplate = {
  key: string;
  name: string;
  category: string;
  description: string;
  outcome: string;
  triggers: FlowTrigger[];
  reentry: ReentryRule;
  graph: FlowGraph;
};

type Spec = [id: string, type: FlowNodeType, config?: Record<string, unknown>];
type Link = [from: string, to: string, handle?: FlowHandle];

function build(steps: Spec[], links: Link[]): FlowGraph {
  const nodes: FlowNode[] = steps.map(([id, type, config]) => ({ id, type, position: { x: 0, y: 0 }, config: { ...nodeSpec(type).defaults(), ...config } }));
  const edges: FlowEdge[] = links.map(([source, target, handle = 'next']) => ({ id: `e_${source}_${handle}_${target}`, source, target, sourceHandle: handle }));
  return tidyLayout({ nodes, edges });
}

export const flowTemplates: FlowTemplate[] = [
  {
    key: 'onboarding', name: 'New customer onboarding', category: 'Onboarding',
    description: 'Welcome new contacts, give them a few days to get started, then check in and alert the owner if they have not engaged.',
    outcome: 'Activated customers and an early warning for slow starters.',
    triggers: [{ id: 't1', type: 'contact.tagged', filters: { tag: 'customer' } }], reentry: 'once',
    graph: build([
      ['start', 'start'], ['welcome', 'send_email'], ['tag', 'add_tag', { tags: ['onboarding'] }], ['wait1', 'wait', { amount: 3, unit: 'days' }],
      ['tips', 'send_email'], ['wait2', 'wait', { amount: 4, unit: 'days' }],
      ['engaged', 'condition', { check: 'score', operator: 'gte', value: '30' }],
      ['done', 'add_tag', { tags: ['onboarded'] }],
      ['nudge', 'create_task', { title: 'Check in with {{contact.full_name}}: onboarding stalled', dueInDays: 1, type: 'call' }],
    ], [['start', 'welcome'], ['welcome', 'tag'], ['tag', 'wait1'], ['wait1', 'tips'], ['tips', 'wait2'], ['wait2', 'engaged'], ['engaged', 'done', 'yes'], ['engaged', 'nudge', 'no']]),
  },
  {
    key: 'lead-nurture', name: 'Lead nurturing', category: 'Lead nurturing',
    description: 'Turn form leads into sales-ready contacts with a short educational series and scoring, then hand hot leads to sales.',
    outcome: 'Sales-qualified leads with a deal in the pipeline.',
    triggers: [{ id: 't1', type: 'form.submitted', filters: {} }], reentry: 'once',
    graph: build([
      ['start', 'start'], ['score', 'adjust_score', { delta: 10 }], ['guide', 'send_email'], ['wait1', 'wait', { amount: 2, unit: 'days' }],
      ['case', 'send_email'], ['wait2', 'wait', { amount: 3, unit: 'days' }],
      ['hot', 'condition', { check: 'score', operator: 'gte', value: '40' }],
      ['deal', 'create_deal', { name: 'Inbound: {{contact.full_name}}', amount: 0 }], ['tell', 'notify_owner', { message: 'New sales-ready lead: {{contact.full_name}}' }],
      ['later', 'add_tag', { tags: ['nurture-continue'] }],
    ], [['start', 'score'], ['score', 'guide'], ['guide', 'wait1'], ['wait1', 'case'], ['case', 'wait2'], ['wait2', 'hot'], ['hot', 'deal', 'yes'], ['deal', 'tell'], ['hot', 'later', 'no']]),
  },
  {
    key: 'sales-follow-up', name: 'Sales follow-up', category: 'Sales',
    description: 'When a deal reaches Proposal, remind the owner to follow up and send the contact a check-in if nothing has moved.',
    outcome: 'No proposal goes quiet without a follow-up.',
    triggers: [{ id: 't1', type: 'deal.stage_changed', filters: {} }], reentry: 'every_time',
    graph: build([
      ['start', 'start'], ['task', 'create_task', { title: 'Follow up on the proposal for {{contact.full_name}}', dueInDays: 2, type: 'call', priority: 'high' }],
      ['wait', 'wait', { amount: 5, unit: 'days' }], ['open', 'condition', { check: 'open_deal', operator: 'yes' }],
      ['email', 'send_email'], ['owner', 'notify_owner', { message: 'Proposal still open after 5 days: {{contact.full_name}}' }],
    ], [['start', 'task'], ['task', 'wait'], ['wait', 'open'], ['open', 'email', 'yes'], ['email', 'owner']]),
  },
  {
    key: 'event-registration', name: 'Event registration', category: 'Events',
    description: 'Confirm a registration straight away, remind attendees the day before, then follow up with the recording.',
    outcome: 'Higher attendance and a warm follow-up for every registrant.',
    triggers: [{ id: 't1', type: 'form.submitted', filters: {} }], reentry: 'once',
    graph: build([
      ['start', 'start'], ['tag', 'add_tag', { tags: ['event-registered'] }], ['confirm', 'send_email'],
      ['until', 'wait', { mode: 'until', until: '' }], ['remind', 'send_email'], ['after', 'wait', { amount: 1, unit: 'days' }],
      ['recording', 'send_email'], ['score', 'adjust_score', { delta: 15 }],
    ], [['start', 'tag'], ['tag', 'confirm'], ['confirm', 'until'], ['until', 'remind'], ['remind', 'after'], ['after', 'recording'], ['recording', 'score']]),
  },
  {
    key: 're-engagement', name: 'Re-engagement', category: 'Re-engagement',
    description: 'Win back contacts who have gone quiet with an A/B tested offer, and clean up those who stay inactive.',
    outcome: 'A cleaner list and a measured win-back offer.',
    triggers: [{ id: 't1', type: 'contact.tagged', filters: { tag: 'inactive-90-days' } }], reentry: 'every_time',
    graph: build([
      ['start', 'start'], ['consent', 'condition', { check: 'consent', operator: 'yes' }], ['split', 'split', { percentA: 50 }],
      ['offerA', 'send_email'], ['offerB', 'send_email'], ['waitA', 'wait', { amount: 7, unit: 'days' }], ['waitB', 'wait', { amount: 7, unit: 'days' }],
      ['back', 'condition', { check: 'score', operator: 'gte', value: '20' }],
      ['remove', 'remove_tag', { tags: ['inactive-90-days'] }], ['sunset', 'add_tag', { tags: ['sunset'] }], ['stop', 'exit'],
    ], [['start', 'consent'], ['consent', 'split', 'yes'], ['consent', 'stop', 'no'], ['split', 'offerA', 'a'], ['split', 'offerB', 'b'], ['offerA', 'waitA'], ['offerB', 'waitB'], ['waitA', 'back'], ['waitB', 'back'], ['back', 'remove', 'yes'], ['back', 'sunset', 'no']]),
  },
  {
    key: 'customer-retention', name: 'Customer retention', category: 'Retention',
    description: 'After a deal is won, thank the customer, schedule a success check-in and invite high-value accounts to a review.',
    outcome: 'Renewals and expansion from happy customers.',
    triggers: [{ id: 't1', type: 'deal.won', filters: {} }], reentry: 'every_time',
    graph: build([
      ['start', 'start'], ['tag', 'add_tag', { tags: ['customer'] }], ['thanks', 'send_email'], ['wait', 'wait', { amount: 30, unit: 'days' }],
      ['value', 'condition', { check: 'deal_value', operator: 'gte', value: '10000' }],
      ['review', 'create_task', { title: 'Book a business review with {{contact.full_name}}', dueInDays: 7, type: 'meeting' }],
      ['checkin', 'send_email'], ['hook', 'webhook', { url: '', secret: '' }],
    ], [['start', 'tag'], ['tag', 'thanks'], ['thanks', 'wait'], ['wait', 'value'], ['value', 'review', 'yes'], ['value', 'checkin', 'no'], ['review', 'hook']]),
  },
  {
    key: 'webinar-no-show', name: 'Webinar no-show recovery', category: 'Events',
    description: 'When a registrant lands on the replay page, send the replay and score their interest.',
    outcome: 'Value from registrants who missed the live session.',
    triggers: [{ id: 't1', type: 'page.viewed', filters: {} }], reentry: 'once',
    graph: build([
      ['start', 'start'], ['replay', 'send_email'], ['score', 'adjust_score', { delta: 5 }], ['wait', 'wait', { amount: 2, unit: 'days' }],
      ['deal', 'condition', { check: 'open_deal', operator: 'no' }], ['task', 'create_task', { title: 'Offer a demo to {{contact.full_name}}', dueInDays: 1 }],
    ], [['start', 'replay'], ['replay', 'score'], ['score', 'wait'], ['wait', 'deal'], ['deal', 'task', 'yes']]),
  },
];

export function blankGraph(): FlowGraph {
  return { nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} }], edges: [] };
}

/* ── API shapes ───────────────────────────────────────────────────────────────────────────────────────────── */

export type FlowCounts = { enrolled: number; active: number; waiting: number; completed: number; failed: number; exited: number };

export type FlowSummary = {
  id: string;
  name: string;
  description: string;
  status: FlowStatus;
  triggers: FlowTrigger[];
  reentry: ReentryRule;
  campaignId: string | null;
  campaignName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  publishedVersion: number | null;
  hasUnpublishedChanges: boolean;
  counts: FlowCounts;
  lastRunAt: string | null;
  templateKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FlowVersionSummary = { version: number; publishedAt: string; publishedBy: string | null; steps: number; triggers: number };
export type NodeStats = { ok: number; failed: number; skipped: number; waiting: number };

export type FlowDetail = FlowSummary & {
  graph: FlowGraph;
  versions: FlowVersionSummary[];
  nodeStats: Record<string, NodeStats>;
};

export type FlowVersion = { version: number; graph: FlowGraph; triggers: FlowTrigger[]; reentry: ReentryRule; publishedAt: string; publishedBy: string | null };

export type FlowInput = {
  name?: string;
  description?: string;
  campaignId?: string | null;
  ownerId?: string | null;
  triggers?: FlowTrigger[];
  reentry?: ReentryRule;
  graph?: FlowGraph;
};

export const enrolmentStatuses = ['active', 'waiting', 'completed', 'failed', 'exited'] as const;
export type EnrolmentStatus = (typeof enrolmentStatuses)[number];
export type StepStatus = 'ok' | 'failed' | 'skipped' | 'waiting';

export type Enrolment = {
  id: string;
  flowId: string;
  flowName: string;
  version: number;
  contactId: number | null;
  contactName: string | null;
  contactEmail: string | null;
  status: EnrolmentStatus;
  currentNodeId: string | null;
  currentStep: string | null;
  triggerType: string;
  triggerEventId: string | null;
  held: boolean;
  error: string;
  nextRunAt: string | null;
  enrolledAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type StepLog = { id: string; seq: number; nodeId: string; nodeType: FlowNodeType; action: string; status: StepStatus; detail: string; attempt: number; at: string };
export type EnrolmentDetail = Enrolment & { logs: StepLog[] };

export type DryRunStep = {
  nodeId: string;
  nodeType: FlowNodeType;
  action: string;
  outcome: 'would_run' | 'would_skip' | 'would_wait' | 'branch' | 'end';
  detail: string;
};
export type DryRunResult = { contact: { id: number; name: string; email: string } | null; steps: DryRunStep[]; note: string };

export type EnrolResult = { enrolled: number; skipped: { contactId: number; reason: string }[] };

/* ── Campaign hub ─────────────────────────────────────────────────────────────────────────────────────────── */

export const campaignStatuses = ['planned', 'active', 'paused', 'completed', 'archived'] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

export const campaignAssetTypes = ['design', 'newsletter', 'journey_email', 'page', 'funnel', 'form', 'flow', 'journey', 'segment', 'list', 'link'] as const;
export type CampaignAssetType = (typeof campaignAssetTypes)[number];

export const campaignAssetLabels: Record<CampaignAssetType, string> = {
  design: 'Email designs', newsletter: 'Newsletters', journey_email: 'Journey emails', page: 'Landing pages', funnel: 'Funnels',
  form: 'Forms', flow: 'Workflows', journey: 'Mautic journeys', segment: 'Segments', list: 'Mailing lists', link: 'Tracked links',
};

export type MarketingCampaign = {
  id: string;
  name: string;
  objective: string;
  description: string;
  status: CampaignStatus;
  ownerId: string | null;
  ownerName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  budget: number | null;
  currency: string;
  utmCampaign: string;
  utmSource: string;
  utmMedium: string;
  launchedAt: string | null;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CampaignInput = {
  name: string;
  objective?: string;
  description?: string;
  ownerId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  budget?: number | null;
  currency?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
};

export type LinkMeta = { destination: string; url: string; source: string; medium: string; content: string; term: string };
export type CampaignAsset = { type: CampaignAssetType; id: string; label: string; addedAt: string; meta: Partial<LinkMeta> & Record<string, unknown> };
export type CampaignDetail = MarketingCampaign & { assets: CampaignAsset[] };

export type MoneyTotal = { currency: string; amount: number };
export type CampaignPerformance = {
  leads: number;
  conversions: number;
  formSubmissions: number;
  emails: { sent: number; notSent: number; blocked: number; failed: number };
  deals: { created: number; open: number; won: number; lost: number; wonRevenue: MoneyTotal[] };
  flows: { enrolled: number; completed: number; failed: number };
  costPerLead: number | null;
  roi: number | null;
  /** Why cost per lead or ROI is not shown. */
  notes: { costPerLead?: string; roi?: string };
};

export const objectiveChoices = ['Generate leads', 'Drive sales', 'Grow awareness', 'Launch a product', 'Event attendance', 'Retain customers', 'Re-engage contacts'];

/** URL-safe slug for utm_campaign: lowercase letters, digits, hyphens and underscores. */
export function slugify(value: string, max = 80) {
  return value.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}

/** Adds UTM parameters to a destination URL, keeping its existing query and fragment. */
export function buildTrackedUrl(destination: string, utm: { campaign: string; source?: string; medium?: string; content?: string; term?: string }): string {
  const url = new URL(destination);
  const pairs: [string, string | undefined][] = [
    ['utm_source', utm.source], ['utm_medium', utm.medium], ['utm_campaign', utm.campaign], ['utm_content', utm.content], ['utm_term', utm.term],
  ];
  for (const [key, value] of pairs) {
    const clean = value?.trim();
    if (clean) url.searchParams.set(key, clean);
  }
  return url.toString();
}
