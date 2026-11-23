/* ── Forms, Assets, Pages, Automations & Webhooks (Mautic) ─────────────────── */

/** AUT-01: one step limit shared by the editor, the console route and the Mautic adapter. */
export const maxWorkflowSteps = 20;

/** AUT-07: every field type Mautic 7.2.2 registers (FormBundle/Resources/views/Field and Form/Type/FieldType.php). */
export const formFieldTypes = [
  'text', 'textarea', 'email', 'tel', 'url', 'number', 'slider', 'rating', 'date', 'datetime', 'select', 'radiogrp',
  'checkboxgrp', 'country', 'hidden', 'file', 'captcha', 'password', 'pagebreak', 'freetext', 'freehtml',
  'companyLookup', 'button',
] as const;
export type FormFieldType = typeof formFieldTypes[number];

export type FormFieldPropertySpec = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'boolean' | 'list';
  /** Where Mautic stores the value: the `properties` or the `validation` JSON column. */
  store?: 'properties' | 'validation';
  hint?: string;
};

export type FormFieldTypeSpec = {
  type: FormFieldType;
  label: string;
  /** The properties key that holds the choices for this type. */
  choices?: 'list' | 'optionlist';
  /** Contact fields can be mapped to this field. */
  mappable: boolean;
  /** The field can be marked required. */
  required: boolean;
  defaultValue: boolean;
  helpMessage: boolean;
  showLabel: boolean;
  props: FormFieldPropertySpec[];
};

const placeholder: FormFieldPropertySpec = { key: 'placeholder', label: 'Placeholder', kind: 'text' };

function fieldSpec(
  type: FormFieldType, label: string, extra: Partial<Omit<FormFieldTypeSpec, 'type' | 'label'>> = {},
): FormFieldTypeSpec {
  return { type, label, mappable: true, required: true, defaultValue: true, helpMessage: true, showLabel: true, props: [], ...extra };
}

const layoutField = { mappable: false, required: false, defaultValue: false, helpMessage: false };

export const formFieldSpecs: FormFieldTypeSpec[] = [
  fieldSpec('text', 'Short text', { props: [placeholder] }),
  fieldSpec('textarea', 'Long text'),
  fieldSpec('email', 'Email address', { props: [
    placeholder,
    { key: 'donotsubmit', label: 'Block listed email domains', kind: 'boolean', store: 'validation' },
    { key: 'donotsubmit_validationmsg', label: 'Blocked domain message', kind: 'text', store: 'validation' },
    { key: 'blockfreeemail', label: 'Block free email providers', kind: 'boolean', store: 'validation' },
    { key: 'blockfreeemail_validationmsg', label: 'Free provider message', kind: 'text', store: 'validation' },
  ] }),
  fieldSpec('tel', 'Phone', { props: [
    placeholder,
    { key: 'international', label: 'Validate as international format', kind: 'boolean', store: 'validation' },
    { key: 'international_validationmsg', label: 'Invalid number message', kind: 'text', store: 'validation' },
  ] }),
  fieldSpec('url', 'Web address', { props: [placeholder] }),
  fieldSpec('number', 'Number', { props: [placeholder, { key: 'precision', label: 'Decimal places', kind: 'number' }] }),
  fieldSpec('slider', 'Slider', { required: false, props: [
    { key: 'min', label: 'Minimum', kind: 'number' },
    { key: 'max', label: 'Maximum', kind: 'number' },
    { key: 'step', label: 'Step', kind: 'number' },
  ] }),
  fieldSpec('rating', 'Rating', { defaultValue: false, props: [
    { key: 'star_count', label: 'Number of symbols', kind: 'number' },
    { key: 'symbol', label: 'Symbol', kind: 'text' },
    { key: 'star_color', label: 'Selected colour', kind: 'text' },
    { key: 'base_color', label: 'Unselected colour', kind: 'text' },
  ] }),
  fieldSpec('date', 'Date', { props: [placeholder] }),
  fieldSpec('datetime', 'Date and time'),
  fieldSpec('select', 'Dropdown', { choices: 'list', props: [
    placeholder,
    { key: 'multiple', label: 'Allow several choices', kind: 'boolean' },
  ] }),
  fieldSpec('radiogrp', 'Radio buttons', { choices: 'optionlist', props: [
    { key: 'labelAttributes', label: 'Choice label attributes', kind: 'text' },
  ] }),
  fieldSpec('checkboxgrp', 'Checkboxes', { choices: 'optionlist', props: [
    { key: 'labelAttributes', label: 'Choice label attributes', kind: 'text' },
    { key: 'minimum', label: 'Minimum choices', kind: 'number', store: 'validation' },
    { key: 'min_message', label: 'Minimum message', kind: 'text', store: 'validation' },
    { key: 'maximum', label: 'Maximum choices', kind: 'number', store: 'validation' },
    { key: 'max_message', label: 'Maximum message', kind: 'text', store: 'validation' },
  ] }),
  fieldSpec('country', 'Country', { choices: 'list', props: [
    placeholder,
    { key: 'multiple', label: 'Allow several choices', kind: 'boolean' },
  ] }),
  fieldSpec('hidden', 'Hidden value', { required: false, helpMessage: false, showLabel: false }),
  fieldSpec('file', 'File upload', { mappable: true, defaultValue: false, showLabel: false, props: [
    { key: 'allowed_file_extensions', label: 'Allowed extensions', kind: 'list', hint: 'Separate with commas, for example pdf, png.' },
    { key: 'allowed_file_size', label: 'Maximum size (MB)', kind: 'number' },
    { key: 'public', label: 'Make uploads public', kind: 'boolean' },
    { key: 'profile_image', label: 'Use as the contact photo', kind: 'boolean' },
  ] }),
  fieldSpec('captcha', 'Captcha question', { ...layoutField, showLabel: false, props: [
    { key: 'captcha', label: 'Expected answer', kind: 'text' },
    placeholder,
    { key: 'errorMessage', label: 'Wrong answer message', kind: 'text' },
  ] }),
  fieldSpec('password', 'Password'),
  fieldSpec('pagebreak', 'Page break', { ...layoutField, showLabel: false, props: [
    { key: 'next_page_label', label: 'Next button label', kind: 'text' },
    { key: 'prev_page_label', label: 'Back button label', kind: 'text' },
  ] }),
  fieldSpec('freetext', 'Description text', { ...layoutField, props: [{ key: 'text', label: 'Text', kind: 'textarea' }] }),
  fieldSpec('freehtml', 'HTML block', { ...layoutField, props: [{ key: 'text', label: 'HTML', kind: 'textarea' }] }),
  fieldSpec('companyLookup', 'Company lookup', { props: [placeholder] }),
  fieldSpec('button', 'Submit button', { ...layoutField, showLabel: false }),
];

export type FormFieldOptions = {
  id?: number;
  label: string;
  alias: string;
  /** Known types are listed in `formFieldTypes`; other values come from Mautic plugins and are kept as they are. */
  type: FormFieldType | string;
  mappedObject?: 'contact' | 'company' | string;
  mappedField?: string;
  isRequired?: boolean;
  showLabel?: boolean;
  defaultValue?: string;
  helpMessage?: string;
  validationMessage?: string;
  labelAttributes?: string;
  inputAttributes?: string;
  containerAttributes?: string;
  fieldWidth?: string;
  saveResult?: boolean;
  alwaysDisplay?: boolean;
  showWhenValueExists?: boolean;
  showAfterXSubmissions?: number;
  isReadOnly?: boolean;
  isAutoFill?: boolean;
  /** Choices for select, radio group, checkbox group and country fields. */
  options?: string[];
  /** Mautic's own `properties` JSON, kept as stored so nothing the console does not edit is lost. */
  properties?: Record<string, unknown>;
  /** Mautic's own `validation` JSON. */
  validation?: Record<string, unknown>;
  /** Conditional-field settings, passed through untouched. */
  parent?: string | number | null;
  conditions?: unknown;
};

export type FormField = FormFieldOptions;

/** AUT-08: submit actions registered on FormEvents::FORM_ON_BUILD in Mautic 7.2.2. */
export const formActionTypes = [
  'form.email', 'form.repost', 'email.send.user', 'email.send.lead', 'lead.pointschange', 'lead.changelist',
  'lead.changetags', 'lead.addutmtags', 'lead.remove_do_not_contact', 'lead.scorecontactscompanies',
  'lead.updatelead', 'asset.download', 'plugin.leadpush',
] as const;
export type FormActionType = typeof formActionTypes[number];

export type FormActionPropertySpec = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'ids' | 'tags' | 'emails';
  required?: boolean;
  choices?: { value: string; label: string }[];
  /** Which list the ids come from: a console resource such as segments, emails, assets or users. */
  source?: 'segments' | 'emails' | 'assets' | 'users';
  hint?: string;
};

export type FormActionSpec = {
  type: FormActionType;
  label: string;
  description: string;
  props: FormActionPropertySpec[];
};

export const formActionSpecs: FormActionSpec[] = [
  { type: 'form.email', label: 'Email the submission to people', description: 'Send the submitted values to the addresses you list.', props: [
    { key: 'to', label: 'To', kind: 'emails', required: true, hint: 'Separate addresses with commas.' },
    { key: 'cc', label: 'Cc', kind: 'emails' },
    { key: 'bcc', label: 'Bcc', kind: 'emails' },
    { key: 'subject', label: 'Subject', kind: 'text' },
    { key: 'message', label: 'Message', kind: 'textarea', hint: 'Use {formfield=alias} to insert a submitted value.' },
    { key: 'copy_lead', label: 'Send a copy to the contact', kind: 'boolean' },
    { key: 'set_replyto', label: 'Reply to the contact', kind: 'boolean' },
    { key: 'email_to_owner', label: 'Send a copy to the contact owner', kind: 'boolean' },
  ] },
  { type: 'form.repost', label: 'Post the submission to another URL', description: 'Send the submitted values to a webhook or another system.', props: [
    { key: 'post_url', label: 'Post URL', kind: 'text', required: true },
    { key: 'authorization_header', label: 'Authorization header', kind: 'text' },
    { key: 'failure_email', label: 'Email on failure', kind: 'emails' },
  ] },
  { type: 'email.send.user', label: 'Send an email to users', description: 'Notify console users with a saved email.', props: [
    { key: 'useremail', label: 'Email to send', kind: 'select', required: true, source: 'emails' },
    { key: 'user_id', label: 'Send to users', kind: 'ids', required: true, source: 'users' },
  ] },
  { type: 'email.send.lead', label: 'Send an email to the contact', description: 'Send a saved email to the person who submitted the form.', props: [
    { key: 'email', label: 'Email to send', kind: 'select', required: true, source: 'emails' },
  ] },
  { type: 'lead.pointschange', label: 'Change points', description: 'Add, subtract, multiply or divide the contact points.', props: [
    { key: 'operator', label: 'Operation', kind: 'select', required: true, choices: [
      { value: 'plus', label: 'Add' }, { value: 'minus', label: 'Subtract' },
      { value: 'times', label: 'Multiply by' }, { value: 'divide', label: 'Divide by' },
    ] },
    { key: 'points', label: 'Points', kind: 'number', required: true },
    { key: 'group', label: 'Point group id', kind: 'number' },
  ] },
  { type: 'lead.changelist', label: 'Change segments', description: 'Add the contact to or remove them from segments.', props: [
    { key: 'addToLists', label: 'Add to segments', kind: 'ids', source: 'segments' },
    { key: 'removeFromLists', label: 'Remove from segments', kind: 'ids', source: 'segments' },
  ] },
  { type: 'lead.changetags', label: 'Change tags', description: 'Add or remove tags on the contact.', props: [
    { key: 'add_tags', label: 'Add tags', kind: 'tags' },
    { key: 'remove_tags', label: 'Remove tags', kind: 'tags' },
  ] },
  { type: 'lead.addutmtags', label: 'Record UTM tags', description: 'Save the UTM parameters from the page address on the contact.', props: [] },
  { type: 'lead.remove_do_not_contact', label: 'Remove from do not contact', description: 'Clear the email do-not-contact status for the contact.', props: [] },
  { type: 'lead.scorecontactscompanies', label: 'Change company score', description: 'Change the score of the contact companies.', props: [
    { key: 'score', label: 'Score change', kind: 'number', required: true },
  ] },
  { type: 'lead.updatelead', label: 'Update contact fields', description: 'Set fixed values on contact fields.', props: [] },
  { type: 'asset.download', label: 'Offer an asset download', description: 'Show a download link for an asset after the form is sent.', props: [
    { key: 'asset', label: 'Asset', kind: 'select', source: 'assets' },
    { key: 'message', label: 'Message above the link', kind: 'textarea' },
  ] },
  { type: 'plugin.leadpush', label: 'Push the contact to an integration', description: 'Send the contact to a connected integration.', props: [
    { key: 'integration', label: 'Integration name', kind: 'text', required: true },
  ] },
];

export type FormAction = {
  id?: number;
  type: FormActionType | string;
  name: string;
  description?: string;
  order?: number;
  /** Exactly the properties Mautic stores for this action. */
  properties: Record<string, unknown>;
};

export type FormActionInput = Omit<FormAction, 'order'>;

export type FormPostAction = 'message' | 'redirect' | 'return' | 'hideform';

export type LeadForm = {
  id: number;
  name: string;
  description?: string;
  submissions: number | null;
  published: boolean;
  fields?: FormField[];
  actions?: FormAction[];
  postAction?: FormPostAction | string;
  /** The confirmation message, redirect address or hide-form message, as saved. */
  postActionProperty?: string;
};

export type LeadFormInput = {
  name: string;
  description?: string;
  message?: string;
  published?: boolean;
  /** After submit: show the message (default), redirect to `redirectUrl`, or return to the page. */
  postAction?: FormPostAction;
  redirectUrl?: string;
  fields?: FormFieldOptions[];
  actions?: FormActionInput[];
};

export type FormSubmission = {
  id: number;
  formId: number;
  contactId: number | null;
  dateSubmitted: string | null;
  results: Record<string, string>;
};

export type JourneyEmail = {
  id: number;
  name: string;
  subject: string;
  body?: string;
  published: boolean;
  sentCount?: number | null;
  readCount?: number | null;
};

export type JourneyEmailInput = {
  name: string;
  subject: string;
  body: string;
  published?: boolean;
};

export type WorkflowStepKind = 'email' | 'tags' | 'points' | 'segment' | 'stage';

export type WorkflowStep = {
  kind?: WorkflowStepKind;
  emailId: number;
  delayMinutes: number;
  condition?: 'opened_previous' | 'clicked_previous';
  addTags?: string[];
  removeTags?: string[];
  pointsDelta?: number;
  addSegmentIds?: number[];
  removeSegmentIds?: number[];
  stageId?: number;
};

export type WorkflowInput = {
  name: string;
  description?: string;
  /** Linear step editor fields. Ignored when `graph` is sent. */
  segmentId: number;
  formId?: number;
  steps: WorkflowStep[];
  /** AUT-02: the full branching graph. When present it replaces `segmentId`, `formId` and `steps`. */
  graph?: WorkflowGraph;
  /** AUT-02: saved step ids the editor deleted on purpose. Any other saved step missing from `graph` is refused. */
  removedNodeIds?: string[];
};

export type Workflow = WorkflowInput & {
  id: number;
  enabled: boolean;
  editable?: boolean;
  /** Why the canvas cannot save this automation, when `editable` is false. */
  readOnlyReason?: string;
};

/* ── AUT-02 / AUT-04: branching workflow graph ─────────────────────────────── */
// Mautic 7.2.2 stores a campaign as events with parent_id + decision_path ('yes'|'no') and a canvas
// (CampaignBundle/Model/CampaignModel.php:277-335, Entity/Event.php:54-70). The graph below mirrors that
// one-to-one so any campaign the engine holds opens, edits and saves without losing events.

/** Most steps one workflow graph may hold. */
export const maxWorkflowNodes = 100;

export type WorkflowEventType = 'action' | 'decision' | 'condition';
export type WorkflowBranch = 'yes' | 'no';
export const workflowIntervalUnits = ['i', 'h', 'd', 'm', 'y'] as const;
export type WorkflowIntervalUnit = typeof workflowIntervalUnits[number];
export type WorkflowTriggerMode = 'immediate' | 'interval' | 'date' | 'optimized';

/** The engine's per-event trigger columns (Event.php trigger_* fields), kept as stored. */
export type WorkflowSchedule = {
  /** null means "run when reached"; decisions always have null. */
  mode: WorkflowTriggerMode | null;
  interval: number;
  unit: WorkflowIntervalUnit | null;
  /** Fixed date for mode 'date', as the engine returned it (ISO 8601). */
  date: string | null;
  /** HH:MM values. */
  hour: string | null;
  restrictedStartHour: string | null;
  restrictedStopHour: string | null;
  /** 0 = Sunday ... 6 = Saturday, -1 = weekdays. */
  restrictedDaysOfWeek: number[];
  window: number | null;
};

export type WorkflowNode = {
  /** The engine event id ("18") or a temporary id starting with "new" for a step not saved yet. */
  id: string;
  /** null when the step starts from the workflow's sources. */
  parentId: string | null;
  /** Set when the parent is a decision or condition: which answer leads here. */
  branch: WorkflowBranch | null;
  eventType: WorkflowEventType;
  /** The engine event type, such as email.send or email.open. Unknown types are kept as advanced steps. */
  type: string;
  name: string;
  description: string;
  /** Exactly the properties the engine stores for this step. */
  properties: Record<string, unknown>;
  schedule: WorkflowSchedule;
  /** Canvas position, written by the auto layout. */
  position?: { x: number; y: number };
};

export type WorkflowGraph = {
  segmentIds: number[];
  formIds: number[];
  /** Re-entry flag, kept as stored (AUT-11 adds a control). */
  allowRestart: boolean;
  nodes: WorkflowNode[];
};

export type WorkflowFieldKind = 'email' | 'stage' | 'segments' | 'tags' | 'integer';

export type WorkflowFieldSpec = {
  /** The properties key the value is stored under. */
  key: string;
  label: string;
  kind: WorkflowFieldKind;
  required?: boolean;
  hint?: string;
};

/** One catalogue entry per engine event type. Adding a type is adding an entry here. */
export type WorkflowNodeSpec = {
  type: string;
  eventType: WorkflowEventType;
  label: string;
  description: string;
  fields: WorkflowFieldSpec[];
  /** Properties every new step of this type starts with. */
  defaults: Record<string, unknown>;
  /** At least one of these properties must hold a value. */
  needsOneOf?: string[];
  /** The parent step must be one of these types (the engine's connection restrictions). */
  parentTypes?: string[];
  /** Decisions: the verb in "If not opened within 3 days". */
  verb?: string;
};

export const workflowNodeSpecs: WorkflowNodeSpec[] = [
  { type: 'email.send', eventType: 'action', label: 'Send email', description: 'Send a published journey email.',
    fields: [{ key: 'email', label: 'Email', kind: 'email', required: true }], defaults: { email: 0, email_type: 'marketing' } },
  { type: 'lead.changetags', eventType: 'action', label: 'Change tags', description: 'Add or remove contact tags.',
    fields: [{ key: 'add_tags', label: 'Add tags', kind: 'tags' }, { key: 'remove_tags', label: 'Remove tags', kind: 'tags' }],
    defaults: { add_tags: [], remove_tags: [] }, needsOneOf: ['add_tags', 'remove_tags'] },
  { type: 'lead.changepoints', eventType: 'action', label: 'Change points', description: 'Add or subtract contact points.',
    fields: [{ key: 'points', label: 'Points', kind: 'integer', required: true, hint: 'Use a negative number to subtract.' }],
    defaults: { points: 10 } },
  { type: 'lead.changelist', eventType: 'action', label: 'Change segments', description: 'Add the contact to or remove them from segments.',
    fields: [{ key: 'addToLists', label: 'Add to segments', kind: 'segments' }, { key: 'removeFromLists', label: 'Remove from segments', kind: 'segments' }],
    defaults: { addToLists: [], removeFromLists: [] }, needsOneOf: ['addToLists', 'removeFromLists'] },
  { type: 'stage.change', eventType: 'action', label: 'Change stage', description: 'Move the contact to a lifecycle stage.',
    fields: [{ key: 'stage', label: 'Stage', kind: 'stage', required: true }], defaults: { stage: 0 } },
  { type: 'email.open', eventType: 'decision', label: 'Opened email?', description: 'Wait for the contact to open the email before this step.',
    fields: [], defaults: {}, parentTypes: ['email.send'], verb: 'opened' },
  { type: 'email.click', eventType: 'decision', label: 'Clicked email?', description: 'Wait for the contact to click a link in the email before this step.',
    fields: [], defaults: {}, parentTypes: ['email.send'], verb: 'clicked' },
];

const nodeSpecByType = new Map(workflowNodeSpecs.map(spec => [spec.type, spec]));

export function workflowNodeSpec(type: string): WorkflowNodeSpec | undefined {
  return nodeSpecByType.get(type);
}

export function emptySchedule(mode: WorkflowTriggerMode | null = 'immediate'): WorkflowSchedule {
  return {
    mode, interval: 0, unit: null, date: null, hour: null,
    restrictedStartHour: null, restrictedStopHour: null, restrictedDaysOfWeek: [], window: null,
  };
}

export function intervalSchedule(interval: number, unit: WorkflowIntervalUnit): WorkflowSchedule {
  return { ...emptySchedule('interval'), interval, unit };
}

/** Workflow steps a node branches into: decisions and conditions answer yes or no. */
export function branches(node: Pick<WorkflowNode, 'eventType'>) {
  return node.eventType === 'decision' || node.eventType === 'condition';
}

export function childNodes(graph: WorkflowGraph, parentId: string | null, branch?: WorkflowBranch | null) {
  return graph.nodes.filter(node => node.parentId === parentId && (branch === undefined || node.branch === branch));
}

/** The node and every step below it. */
export function subtreeIds(graph: WorkflowGraph, id: string) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of graph.nodes) {
      if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

const unitMinutes: Record<WorkflowIntervalUnit, number> = { i: 1, h: 60, d: 1440, m: 43200, y: 525600 };
const unitNames: Record<WorkflowIntervalUnit, [string, string]> = {
  i: ['minute', 'minutes'], h: ['hour', 'hours'], d: ['day', 'days'], m: ['month', 'months'], y: ['year', 'years'],
};

export function intervalLabel(interval: number, unit: WorkflowIntervalUnit) {
  // Minute and hour waits from the step editor read better as hours or days when they divide evenly.
  if (unit === 'i' && interval >= 60 && interval % 60 === 0) return intervalLabel(interval / 60, 'h');
  if (unit === 'h' && interval >= 24 && interval % 24 === 0) return intervalLabel(interval / 24, 'd');
  return `${interval} ${unitNames[unit][interval === 1 ? 0 : 1]}`;
}

function dateLabel(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
    : value;
}

export function scheduleLabel(schedule: WorkflowSchedule) {
  const window = schedule.restrictedStartHour && schedule.restrictedStopHour
    ? ` between ${schedule.restrictedStartHour} and ${schedule.restrictedStopHour}` : '';
  const at = schedule.hour ? ` at ${schedule.hour}` : '';
  switch (schedule.mode) {
    case 'interval':
      return schedule.unit && schedule.interval > 0 ? `Wait ${intervalLabel(schedule.interval, schedule.unit)}${at}${window}` : `Immediately${window}`;
    case 'date':
      return schedule.date ? `On ${dateLabel(schedule.date)}` : 'On a date';
    case 'optimized':
      return 'At the best time for each contact';
    default:
      return `Immediately${window}`;
  }
}

export type DecisionWait =
  | { kind: 'none' }
  | { kind: 'immediate' }
  | { kind: 'interval'; interval: number; unit: WorkflowIntervalUnit }
  | { kind: 'date'; date: string };

/**
 * AUT-04: how long a decision waits before contacts who did not act take the no path.
 * Mautic stores the wait on the decision's no-path children: InactiveHelper::getEarliestInactiveDate takes the
 * earliest execution date of those children, counted from when the decision's parent ran
 * (CampaignBundle/Executioner/Helper/InactiveHelper.php:121-147).
 */
export function decisionWait(graph: WorkflowGraph, decisionId: string): DecisionWait {
  let best: DecisionWait = { kind: 'none' };
  let bestMinutes = Infinity;
  for (const child of childNodes(graph, decisionId, 'no')) {
    const { mode, interval, unit, date } = child.schedule;
    if (mode === 'interval' && unit && interval > 0) {
      const minutes = interval * unitMinutes[unit];
      if (minutes < bestMinutes) {
        bestMinutes = minutes;
        best = { kind: 'interval', interval, unit };
      }
    } else if (mode === 'date' && date) {
      if (best.kind === 'none') best = { kind: 'date', date };
    } else {
      bestMinutes = 0;
      best = { kind: 'immediate' };
    }
  }
  return best;
}

/** "If not opened within 3 days", or null when the decision has no no path. */
export function decisionWaitLabel(graph: WorkflowGraph, decision: WorkflowNode) {
  const verb = workflowNodeSpec(decision.type)?.verb ?? 'done';
  const wait = decisionWait(graph, decision.id);
  switch (wait.kind) {
    case 'interval':
      return `If not ${verb} within ${intervalLabel(wait.interval, wait.unit)}`;
    case 'date':
      return `If not ${verb} by ${dateLabel(wait.date)}`;
    case 'immediate':
      return `If not ${verb} by the next engine run`;
    default:
      return null;
  }
}

/** AUT-04: set the decision's wait on every step of its no path. */
export function setDecisionWait(graph: WorkflowGraph, decisionId: string, interval: number, unit: WorkflowIntervalUnit): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => node.parentId === decisionId && node.branch === 'no'
      ? { ...node, schedule: { ...node.schedule, mode: 'interval', interval, unit, date: null } }
      : node),
  };
}

export type WorkflowIssue = { level: 'error' | 'warning'; message: string; nodeId?: string };

const hourPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  return typeof value === 'string' ? value.trim().length > 0 : false;
}

function scheduleIssues(node: WorkflowNode): string[] {
  const { mode, interval, unit, date, hour, restrictedStartHour, restrictedStopHour, restrictedDaysOfWeek } = node.schedule;
  const problems: string[] = [];
  if (mode === 'interval') {
    if (!Number.isSafeInteger(interval) || interval < 0) problems.push('Set the wait as a whole number.');
    if (!unit) problems.push('Choose minutes, hours, days, months or years for the wait.');
  }
  if (mode === 'date' && (!date || !Number.isFinite(Date.parse(date)))) problems.push('Choose the date this step runs.');
  for (const value of [hour, restrictedStartHour, restrictedStopHour]) {
    if (value !== null && !hourPattern.test(value)) problems.push('Write times as HH:MM, for example 09:00.');
  }
  if (Boolean(restrictedStartHour) !== Boolean(restrictedStopHour)) problems.push('Set both the start and the end of the send window.');
  if (restrictedDaysOfWeek.some(day => !Number.isInteger(day) || day < -1 || day > 6)) problems.push('Choose valid days of the week.');
  return problems;
}

/**
 * AUT-02: structural rules the engine needs, plus the engine editor's own connection rules
 * (CampaignBundle/Assets/js/campaign.js:881-960) and AUT-04's no-path wait (Form/Type/EventType.php:64-72).
 */
export function validateWorkflowGraph(graph: WorkflowGraph): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const error = (message: string, nodeId?: string) => issues.push({ level: 'error', message, nodeId });
  const warn = (message: string, nodeId?: string) => issues.push({ level: 'warning', message, nodeId });

  if (!graph.segmentIds.length && !graph.formIds.length) error('Choose at least one segment or lead form to start the workflow.');
  if (!graph.nodes.length) error('Add at least one step.');
  if (graph.nodes.length > maxWorkflowNodes) error(`Use at most ${maxWorkflowNodes} steps in one workflow.`);

  const byId = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) error('Two steps share the same id.', node.id);
    byId.set(node.id, node);
  }

  for (const node of graph.nodes) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    if (node.parentId !== null && !parent) {
      error('This step is not connected to the workflow.', node.id);
      continue;
    }
    // Every step must lead back to the sources without a loop.
    const seen = new Set([node.id]);
    let cursor = parent;
    while (cursor) {
      if (seen.has(cursor.id)) {
        error('These steps form a loop.', node.id);
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }

    if (parent && branches(parent)) {
      if (node.branch !== 'yes' && node.branch !== 'no') error('Choose the yes or the no path for this step.', node.id);
    } else if (node.branch !== null) {
      error('Only a decision or a condition has yes and no paths.', node.id);
    }

    const spec = workflowNodeSpec(node.type);
    if (spec && spec.eventType !== node.eventType) error(`${spec.label} must be a ${spec.eventType}.`, node.id);
    if (spec?.parentTypes && (!parent || !spec.parentTypes.includes(parent.type))) {
      error(`${spec.label} must come straight after a Send email step.`, node.id);
    }
    if (node.eventType === 'decision' && parent?.eventType === 'decision') {
      warn('The engine editor does not place a decision straight after another decision.', node.id);
    }
    if (!node.name.trim()) error('Give this step a name.', node.id);

    if (spec) {
      for (const field of spec.fields) {
        if (field.required && !hasValue(node.properties[field.key])) error(`${spec.label}: set ${field.label.toLowerCase()}.`, node.id);
      }
      if (spec.needsOneOf && !spec.needsOneOf.some(key => hasValue(node.properties[key]))) {
        error(`${spec.label}: add or remove at least one item.`, node.id);
      }
    }
    if (node.type === 'lead.changetags') {
      const tags = [node.properties.add_tags, node.properties.remove_tags].flatMap(value => Array.isArray(value) ? value : []);
      if (tags.some(tag => typeof tag === 'string' && tag.trim().startsWith('-'))) error('A tag cannot start with a hyphen.', node.id);
    }

    if (node.eventType !== 'decision') for (const problem of scheduleIssues(node)) error(problem, node.id);

    // AUT-04: an action on a decision's no path needs a wait, as in the engine's own editor (EventType.php:64-72).
    if (parent?.eventType === 'decision' && node.branch === 'no') {
      const waits = (node.schedule.mode === 'interval' && node.schedule.interval > 0) || node.schedule.mode === 'date';
      if (!waits && node.eventType === 'action') {
        error(`Set how long to wait for “${parent.name}” before contacts take the no path.`, node.id);
      } else if (!waits) {
        warn('Contacts take this no path at the next engine run because it has no wait.', node.id);
      }
    }

    if (node.type === 'email.send') {
      const emailId = node.properties.email;
      let ancestor = parent;
      const visited = new Set<string>();
      while (ancestor && !visited.has(ancestor.id)) {
        visited.add(ancestor.id);
        if (ancestor.type === 'email.send' && ancestor.properties.email === emailId && hasValue(emailId)) {
          error('This email is already sent earlier on this path. Each marketing email is sent once per contact.', node.id);
          break;
        }
        ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.eventType === 'decision' && !childNodes(graph, node.id, 'no').length) {
      warn(`Contacts who never act wait at “${node.name}” with no end. Add a step on the no path to move them on.`, node.id);
    }
  }
  return issues;
}

/* ── Auto layout: top-down tree, yes paths left of no paths ─────────────────── */

export const workflowLayout = { columnWidth: 248, rowHeight: 168, originX: 24, originY: 24 } as const;

export type WorkflowLayout = {
  /** Column centre (in columns) and depth (row) per node id; the sources sit at depth 0. */
  positions: Map<string, { column: number; depth: number }>;
  entry: { column: number; depth: 0 };
  columns: number;
  rows: number;
};

type Slot = { branch: WorkflowBranch | null; children: WorkflowNode[] };

function slotsOf(graph: WorkflowGraph, node: WorkflowNode | null): Slot[] {
  const id = node ? node.id : null;
  if (node && branches(node)) {
    return (['yes', 'no'] as const).map(branch => ({ branch, children: childNodes(graph, id, branch) }));
  }
  return [{ branch: null, children: childNodes(graph, id) }];
}

export function layoutWorkflowGraph(graph: WorkflowGraph): WorkflowLayout {
  const positions = new Map<string, { column: number; depth: number }>();
  const widths = new Map<string | null, number>();
  const visiting = new Set<string | null>();
  let rows = 1;

  function width(node: WorkflowNode | null): number {
    const key = node ? node.id : null;
    const known = widths.get(key);
    if (known !== undefined) return known;
    if (visiting.has(key)) return 1;
    visiting.add(key);
    const total = slotsOf(graph, node).reduce((sum, slot) => sum + Math.max(1, slot.children.reduce((acc, child) => acc + width(child), 0)), 0);
    visiting.delete(key);
    widths.set(key, Math.max(1, total));
    return Math.max(1, total);
  }

  function place(node: WorkflowNode | null, left: number, depth: number) {
    const own = width(node);
    if (node) {
      if (positions.has(node.id)) return;
      positions.set(node.id, { column: left + own / 2, depth });
    }
    rows = Math.max(rows, depth + 1);
    let cursor = left;
    for (const slot of slotsOf(graph, node)) {
      const slotWidth = Math.max(1, slot.children.reduce((acc, child) => acc + width(child), 0));
      let childLeft = cursor + (slotWidth - slot.children.reduce((acc, child) => acc + width(child), 0)) / 2;
      for (const child of slot.children) {
        place(child, childLeft, depth + 1);
        childLeft += width(child);
      }
      cursor += slotWidth;
    }
  }

  place(null, 0, 0);
  const columns = width(null);
  // Steps outside the tree (invalid graphs) still get a place so they can be fixed.
  for (const node of graph.nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { column: columns + 0.5, depth: rows });
      rows += 1;
    }
  }
  return { positions, entry: { column: columns / 2, depth: 0 }, columns: Math.max(columns, ...[...positions.values()].map(p => Math.ceil(p.column + 0.5))), rows };
}

/** Pixel position of a node's top-left corner for a given card width. */
export function layoutPoint(position: { column: number; depth: number }, cardWidth = 200) {
  return {
    x: Math.round(workflowLayout.originX + position.column * workflowLayout.columnWidth - cardWidth / 2),
    y: Math.round(workflowLayout.originY + position.depth * workflowLayout.rowHeight),
  };
}

export type WorkflowContact = {
  contactId: number;
  dateAdded: string | null;
  manuallyRemoved: boolean;
};

export type Asset = {
  id: number;
  title: string;
  alias: string;
  description: string;
  storageLocation: 'local' | 'remote' | string;
  remotePath: string;
  downloadCount: number;
  uniqueDownloadCount: number;
  published: boolean;
  downloadUrl?: string;
};

export type AssetInput = {
  title: string;
  description?: string;
  remotePath: string;
  published?: boolean;
};

export type LandingPage = {
  id: number;
  title: string;
  alias: string;
  metaDescription: string;
  customHtml: string;
  hits: number;
  uniqueHits: number;
  published: boolean;
};

export type LandingPageInput = {
  title: string;
  alias?: string;
  metaDescription?: string;
  customHtml: string;
  published?: boolean;
};

export type Webhook = {
  id: number;
  name: string;
  description: string;
  webhookUrl: string;
  triggers: string[];
  published: boolean;
};

export type WebhookInput = {
  name: string;
  description?: string;
  webhookUrl: string;
  triggers: string[];
  published?: boolean;
};

export type CustomFieldObject = 'contact' | 'company';

export type CustomField = {
  id: number;
  label: string;
  alias: string;
  type: string;
  group: string;
  object: CustomFieldObject;
  defaultValue: string;
  isRequired: boolean;
  isPubliclyUpdatable: boolean;
  isFixed: boolean;
  published: boolean;
  options: string[];
};

export type CustomFieldInput = {
  label: string;
  alias?: string;
  type: string;
  group?: string;
  defaultValue?: string;
  isRequired?: boolean;
  isPubliclyUpdatable?: boolean;
  published?: boolean;
  options?: string[];
};

export type Category = {
  id: number;
  title: string;
  alias: string;
  description: string;
  color: string;
  bundle: string;
  published: boolean;
};

export type CategoryInput = {
  title: string;
  bundle: string;
  description?: string;
  color?: string;
  published?: boolean;
};

export type DynamicContent = {
  id: number;
  name: string;
  slotName: string;
  content: string;
  isCampaignBased: boolean;
  published: boolean;
  sentCount: number;
  dateAdded: string | null;
};

export type DynamicContentInput = {
  name: string;
  slotName: string;
  content: string;
  isCampaignBased?: boolean;
  published?: boolean;
};

export type FocusItem = {
  id: number;
  name: string;
  description: string;
  type: 'form' | 'notice' | 'link' | string;
  style: 'bar' | 'modal' | 'notification' | 'page' | string;
  headline: string;
  tagline: string;
  linkText: string;
  linkUrl: string;
  formId: number | null;
  primaryColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  when: 'immediately' | 'scroll_slight' | 'scroll_middle' | 'scroll_bottom' | 'leave' | string;
  published: boolean;
  embedScript: string;
};

export type FocusItemInput = {
  name: string;
  description?: string;
  type: 'form' | 'notice' | 'link';
  style: 'bar' | 'modal' | 'notification' | 'page';
  headline?: string;
  tagline?: string;
  linkText?: string;
  linkUrl?: string;
  formId?: number | null;
  primaryColor?: string;
  textColor?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  when?: 'immediately' | 'scroll_slight' | 'scroll_middle' | 'scroll_bottom' | 'leave';
  published?: boolean;
};

export type MarketingReport = {
  id: number;
  name: string;
  description: string;
  source: string;
  columns: string[];
  system: boolean;
};

export type MarketingReportData = {
  report: MarketingReport;
  totalResults: number;
  columns: string[];
  rows: Record<string, string | number | null>[];
};
