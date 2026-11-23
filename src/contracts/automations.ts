/* ── Forms, Assets, Pages, Automations & Webhooks (Mautic) ─────────────────── */

import { z } from 'zod';

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

/** A Mautic marketing message (multi-channel), used by the "Send marketing message" step. */
export type MarketingMessage = { id: number; name: string; published: boolean };

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

/* ── AUT-03 / AUT-05: the engine's condition and action catalogue ──────────── */
// One entry per event type Mautic 7.2.2 registers through CampaignBuilderEvent::addCondition/addAction in a stock
// install, plus the two email decisions. Property keys are exactly the keys the engine's form types store and its
// handlers read; each entry cites the subscriber that registers it.

export type WorkflowFieldKind =
  | 'email' | 'user-email' | 'stage' | 'stages' | 'segments' | 'tags' | 'list' | 'integer' | 'text' | 'url'
  | 'choice' | 'choices' | 'boolean' | 'user' | 'users' | 'company' | 'form' | 'campaigns' | 'point-group' | 'page'
  | 'dynamic-content' | 'focus' | 'message' | 'datetime' | 'seconds' | 'addresses' | 'key-values'
  | 'field-condition' | 'form-field-condition' | 'field-values' | 'jump-target';

export type WorkflowFieldChoice = { value: string; label: string };

export type WorkflowFieldSpec = {
  /** The properties key the value is stored under. Composite editors (field conditions, field values) own several keys. */
  key: string;
  label: string;
  kind: WorkflowFieldKind;
  required?: boolean;
  hint?: string;
  choices?: WorkflowFieldChoice[];
  /** Field pickers: which object's fields. */
  object?: 'contact' | 'company';
  /** Workflow pickers: offer "this workflow" (stored as the keyword `this`). */
  allowThis?: boolean;
  min?: number;
  max?: number;
  /** Only shown while this other property is switched on. */
  showWhen?: string;
  /** Choice values are stored as integers. */
  numeric?: boolean;
};

export type WorkflowNodeGroup = 'Contact' | 'Email' | 'Workflow' | 'Web' | 'Integrations';

/** One catalogue entry per engine event type. Adding a type is adding an entry here. */
export type WorkflowNodeSpec = {
  type: string;
  eventType: WorkflowEventType;
  group: WorkflowNodeGroup;
  label: string;
  description: string;
  fields: WorkflowFieldSpec[];
  /** Properties every new step of this type starts with. */
  defaults: Record<string, unknown>;
  /** Validates the stored properties with readable messages. Unknown keys are kept. */
  schema?: z.ZodType;
  /** Things worth knowing that do not block a save. */
  warnings?: (properties: Record<string, unknown>) => string[];
  /** The parent step must be one of these types (the engine's connection restrictions). */
  parentTypes?: string[];
  /** How the parent restriction reads in messages, for example "a Send email step". */
  parentLabel?: string;
  /** The engine forbids this step on a decision's no path (connectionRestrictions anchor `decision.inaction`). */
  notOnNoPath?: boolean;
  /** Nothing may follow this step (connectionRestrictions target `none`). */
  leaf?: boolean;
  /** The engine hides the timing for this step and runs it when it is reached (`hideTriggerMode`). */
  immediateOnly?: boolean;
  /** Decisions: the verb in "If not opened within 3 days". */
  verb?: string;
  /**
   * Set when a stock install does not register the type because it needs a transport, an integration or a decision
   * the console does not offer. The console lists it with this reason and keeps saved steps as advanced steps.
   */
  unavailable?: string;
  /** Where Mautic 7.2.2 registers the type. */
  source: string;
};

const isEngineId = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647)
  || (typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value));
const isBlank = (value: unknown) => value === undefined || value === null || value === '';
const isWhole = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value))
  || (typeof value === 'string' && /^-?\d{1,10}$/.test(value.trim()));
const isFlag = (value: unknown) => typeof value === 'boolean' || value === 0 || value === 1 || value === '0' || value === '1' || value === '';
const isIdList = (value: unknown, min = 0) => Array.isArray(value) && value.length >= min && value.every(isEngineId);
const isTextList = (value: unknown, min = 0) => Array.isArray(value) && value.length >= min
  && value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 191);
const isDateText = (value: unknown) => isBlank(value) || (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value.replace(' ', 'T'))));
const fieldAlias = /^[A-Za-z0-9_]{1,64}$/;

/** True for the engine's "on" values (form checkboxes store 1 or "1"). */
export function isOn(value: unknown) {
  return value === true || value === 1 || value === '1';
}

const required = (check: (value: unknown) => boolean, message: string) => z.unknown().refine(check, { error: message });
const optional = (check: (value: unknown) => boolean, message: string) => z.unknown().refine(check, { error: message }).optional();
const oneOf = (values: readonly (string | number)[], message: string) => required(value => values.includes(value as string | number), message);

const tokenPattern = /^\{contactfield=[A-Za-z0-9_]+(\|[^}]*)?\}$/;
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Splits a "to, cc or bcc" value the way the engine does; null when an entry is neither an address nor a contact-field token. */
export function addressList(value: unknown): string[] | null {
  if (isBlank(value)) return [];
  if (typeof value !== 'string' || value.length > 2000) return null;
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  return parts.every(part => emailPattern.test(part) || tokenPattern.test(part)) ? parts : null;
}

/** Webhook headers and data are stored as `{ list: [{ label, value }] }` (SortableListType, CampaignHelper.php:54-71). */
export function keyValueRows(value: unknown): { label: string; value: string }[] | null {
  if (isBlank(value) || (Array.isArray(value) && !value.length)) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const list = (value as Record<string, unknown>).list;
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return null;
  const rows: { label: string; value: string }[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') return null;
    const { label, value: rowValue } = row as Record<string, unknown>;
    if (typeof label !== 'string' || !(typeof rowValue === 'string' || typeof rowValue === 'number')) return null;
    rows.push({ label, value: String(rowValue) });
  }
  return rows;
}

/** Operators lead.field_value accepts, keyed as the engine stores them (Segment/OperatorOptions.php:9-65). */
export const fieldConditionOperators = [
  '=', '!=', 'gt', 'gte', 'lt', 'lte', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp',
  'startsWith', 'endsWith', 'contains', 'in', '!in', 'date',
] as const;
export type FieldConditionOperator = typeof fieldConditionOperators[number];

export const conditionOperatorLabels: Record<string, string> = {
  '=': 'equals', '!=': 'does not equal', gt: 'is greater than', gte: 'is greater than or equal to', lt: 'is less than',
  lte: 'is less than or equal to', empty: 'is empty', '!empty': 'is not empty', like: 'is like', '!like': 'is not like',
  regexp: 'matches the pattern', '!regexp': 'does not match the pattern', startsWith: 'starts with', endsWith: 'ends with',
  contains: 'contains', in: 'is any of', '!in': 'is none of', date: 'is on the relative date',
};

const textOperators: FieldConditionOperator[] = ['=', '!=', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp', 'startsWith', 'endsWith', 'contains'];
const numberOperators: FieldConditionOperator[] = ['=', '!=', 'gt', 'gte', 'lt', 'lte', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp', 'startsWith', 'endsWith', 'contains'];
/** The reserved `tags` field only matches equals, does not equal, like and not like (LeadFieldRepository.php:247-269). */
export const tagFieldOperators: FieldConditionOperator[] = ['=', '!=', 'like', '!like'];
export const utmFields = ['utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term'] as const;

/**
 * The operators the engine offers per field type (Entity/OperatorListTrait.php:12-125, normalizeType :213-238).
 * "Including all" is left out on purpose: the condition handler has no branch for it and the query builder has no
 * `in_all` expression (LeadFieldRepository.php:333-366), so the step would fail at run time.
 */
export function fieldConditionOperatorsFor(fieldType: string | null | undefined, field?: string): FieldConditionOperator[] {
  if (field === 'tags') return tagFieldOperators;
  const type = fieldType ?? 'default';
  if (type === 'boolean') return ['=', '!='];
  if (['select', 'country', 'timezone', 'region', 'locale'].includes(type)) return ['=', '!=', 'empty', '!empty', 'regexp', '!regexp', 'in', '!in'];
  if (['lookup', 'text', 'email', 'url', 'tel'].includes(type)) return textOperators;
  if (type === 'multiselect') return ['in', '!in', 'empty', '!empty'];
  if (type === 'date' || type === 'datetime') return [...numberOperators.slice(0, 12), 'date', 'startsWith', 'endsWith', 'contains'];
  if (type === 'lookup_id') return ['=', '!=', 'empty', '!empty'];
  return numberOperators;
}

/** Relative dates for the `date` operator (Helper/FormFieldHelper.php:208-216); any ±ISO-8601 period also works. */
export const relativeDateChoices: WorkflowFieldChoice[] = [
  { value: '+P0D', label: 'Today' }, { value: '-P1D', label: 'Yesterday' }, { value: '+P1D', label: 'Tomorrow' },
  { value: 'anniversary', label: 'Anniversary (same day and month)' },
];
const relativeDatePattern = /^(anniversary|[+-]P(?=\d|T\d)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?)$/;

/** form.field_value operators (FormBundle/Model/FormModel.php:808-866). */
export const formConditionOperators = ['=', '!=', 'gt', 'gte', 'lt', 'lte', 'like', '!like', 'startsWith', 'endsWith', 'contains'] as const;
export const pointOperators = ['=', '!=', 'gt', 'gte', 'lt', 'lte'] as const;

/** Channels a contact can be marked do-not-contact on (contact_preference channels: email always, sms with a transport). */
export const workflowDncChannels: WorkflowFieldChoice[] = [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'Text message' }];
/** DoNotContact reasons (LeadBundle/Entity/DoNotContact.php:17-32). The condition compares them strictly, so they stay integers. */
export const workflowDncReasons = [{ value: 1, label: 'Unsubscribed' }, { value: 2, label: 'Bounced' }, { value: 3, label: 'Added manually' }];

/** Device types the engine's device detector reports (CampaignEventLeadDeviceType::buildForm). */
export const deviceTypes = [
  'desktop', 'smartphone', 'tablet', 'phablet', 'feature phone', 'console', 'tv', 'car browser', 'smart display',
  'camera', 'portable media player', 'smart speaker', 'wearable', 'peripheral',
];

const intervalUnitChoices: WorkflowFieldChoice[] = [
  { value: 'i', label: 'Minutes' }, { value: 'h', label: 'Hours' }, { value: 'd', label: 'Days' },
  { value: 'm', label: 'Months' }, { value: 'y', label: 'Years' },
];

const operatorChoices = (keys: readonly string[]) => keys.map(value => ({ value, label: conditionOperatorLabels[value] ?? value }));

function issue(ctx: z.RefinementCtx, message: string, path?: string) {
  ctx.addIssue({ code: 'custom', message, ...(path ? { path: [path] } : {}) });
}

const fieldValueSchema = z.looseObject({
  field: required(value => typeof value === 'string' && fieldAlias.test(value), 'Choose the field to check.'),
  operator: oneOf(fieldConditionOperators, 'Choose how to compare the field.'),
}).superRefine((props, ctx) => {
  const { field, operator, value } = props as Record<string, unknown>;
  if (field === 'tags' && !tagFieldOperators.includes(operator as FieldConditionOperator)) {
    issue(ctx, 'Compare tags with equals, does not equal, is like or is not like.', 'operator');
  }
  if (operator === 'empty' || operator === '!empty') return;
  if (operator === 'date') {
    if (typeof value !== 'string' || !relativeDatePattern.test(value)) issue(ctx, 'Choose a relative date, or write one such as +P3D.', 'value');
    return;
  }
  const filled = (item: unknown) => (typeof item === 'string' && item.trim().length > 0 && item.length <= 500) || typeof item === 'number' || typeof item === 'boolean';
  if (operator === 'in' || operator === '!in') {
    if (!(filled(value) || (Array.isArray(value) && value.length > 0 && value.every(filled)))) issue(ctx, 'Choose at least one value.', 'value');
    return;
  }
  if (!filled(value)) issue(ctx, 'Enter the value to compare with.', 'value');
});

function fieldValuesSchema(object: 'contact' | 'company') {
  return z.record(z.string(), z.unknown()).superRefine((props, ctx) => {
    const entries = Object.entries(props);
    if (!entries.length) issue(ctx, `Set at least one ${object} field.`);
    for (const [alias, value] of entries) {
      if (!fieldAlias.test(alias)) issue(ctx, `“${alias.slice(0, 40)}” is not a ${object} field alias.`);
      const simple = value === null || typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 5000);
      if (!simple && !isTextList(value)) issue(ctx, `Use text, a number, yes or no for “${alias.slice(0, 40)}”.`);
    }
  });
}

const webhookSchema = z.looseObject({
  url: required(value => typeof value === 'string' && value.length <= 2000 && /^https?:\/\/\S+$/i.test(value.trim()), 'Enter the full webhook address, starting with https://.'),
  method: optional(value => ['get', 'post', 'put', 'patch', 'delete'].includes(value as string), 'Choose GET, POST, PUT, PATCH or DELETE.'),
  headers: optional(value => keyValueRows(value) !== null, 'Write each header as a name and a value.'),
  additional_data: optional(value => keyValueRows(value) !== null, 'Write each data item as a name and a value.'),
  timeout: optional(value => isBlank(value) || (isWhole(value) && Number(value) >= 1 && Number(value) <= 300), 'Set a timeout between 1 and 300 seconds.'),
}).superRefine((props, ctx) => {
  for (const key of ['headers', 'additional_data'] as const) {
    if ((keyValueRows(props[key]) ?? []).some(row => !row.label.trim())) issue(ctx, key === 'headers' ? 'Give every header a name.' : 'Give every data item a name.', key);
  }
});

const ownerWarning = (props: Record<string, unknown>) => Array.isArray(props.owner) && props.owner.length > 1
  ? ['The engine binds the owner list as one value, so only the first owner matches (LeadRepository::checkLeadOwner). Use one owner per condition.']
  : [];

export const workflowNodeSpecs: WorkflowNodeSpec[] = [
  /* Actions: email */
  {
    type: 'email.send', eventType: 'action', group: 'Email', label: 'Send email', description: 'Send a published journey email.',
    fields: [
      { key: 'email', label: 'Email', kind: 'email', required: true },
      { key: 'email_type', label: 'Email type', kind: 'choice', choices: [
        { value: 'marketing', label: 'Marketing: once per contact, respects unsubscribes' },
        { value: 'transactional', label: 'Transactional: may repeat, always sent' },
      ] },
    ],
    defaults: { email: 0, email_type: 'marketing' },
    schema: z.looseObject({
      email: required(isEngineId, 'Choose an email to send.'),
      email_type: optional(value => value === 'marketing' || value === 'transactional', 'Choose marketing or transactional.'),
      priority: optional(value => isBlank(value) || value === 1 || value === 2 || value === '1' || value === '2', 'Choose normal or high priority.'),
      attempts: optional(value => isBlank(value) || (isWhole(value) && Number(value) >= 0), 'Set the attempts as a whole number.'),
    }),
    source: 'EmailBundle/EventListener/CampaignSubscriber.php:99',
  },
  {
    type: 'email.send.to.user', eventType: 'action', group: 'Email', label: 'Send email to users',
    description: 'Notify console users, the contact owner or fixed addresses with a published email.',
    fields: [
      { key: 'useremail', label: 'Email', kind: 'user-email', required: true },
      { key: 'user_id', label: 'Users', kind: 'users' },
      { key: 'to_owner', label: 'Also send to the contact owner', kind: 'boolean' },
      { key: 'to', label: 'To', kind: 'addresses', hint: 'Separate addresses with commas. {contactfield=alias} tokens work too.' },
      { key: 'cc', label: 'Cc', kind: 'addresses' },
      { key: 'bcc', label: 'Bcc', kind: 'addresses' },
    ],
    defaults: { useremail: { email: 0 }, user_id: [], to_owner: false, to: '', cc: '', bcc: '' },
    schema: z.looseObject({
      useremail: required(value => Boolean(value) && typeof value === 'object' && isEngineId((value as Record<string, unknown>).email), 'Choose the email to send.'),
      user_id: optional(value => isBlank(value) || isIdList(value), 'Choose users from the list.'),
      to_owner: optional(isFlag, 'Choose yes or no for the owner copy.'),
      to: optional(value => addressList(value) !== null, 'Use email addresses or {contactfield=alias} tokens in To.'),
      cc: optional(value => addressList(value) !== null, 'Use email addresses or {contactfield=alias} tokens in Cc.'),
      bcc: optional(value => addressList(value) !== null, 'Use email addresses or {contactfield=alias} tokens in Bcc.'),
    }).superRefine((props, ctx) => {
      const users = Array.isArray(props.user_id) ? props.user_id.length : 0;
      if (!users && !isOn(props.to_owner) && !(addressList(props.to) ?? []).length) issue(ctx, 'Choose at least one user, the contact owner or a To address.');
    }),
    source: 'EmailBundle/EventListener/CampaignSubscriber.php:129',
  },
  {
    type: 'message.send', eventType: 'action', group: 'Email', label: 'Send marketing message',
    description: 'Send a multi-channel marketing message on the contact’s preferred channel.',
    fields: [{ key: 'marketingMessage', label: 'Marketing message', kind: 'message', required: true }],
    defaults: { marketingMessage: 0 },
    schema: z.looseObject({ marketingMessage: required(isEngineId, 'Choose a marketing message.') }),
    source: 'ChannelBundle/EventListener/CampaignSubscriber.php:80',
  },
  /* Actions: contact */
  {
    type: 'lead.changetags', eventType: 'action', group: 'Contact', label: 'Change tags', description: 'Add or remove contact tags.',
    fields: [{ key: 'add_tags', label: 'Add tags', kind: 'tags' }, { key: 'remove_tags', label: 'Remove tags', kind: 'tags' }],
    defaults: { add_tags: [], remove_tags: [] },
    schema: z.looseObject({
      add_tags: optional(value => isBlank(value) || isTextList(value), 'Write tags as text.'),
      remove_tags: optional(value => isBlank(value) || isTextList(value), 'Write tags as text.'),
    }).superRefine((props, ctx) => {
      const tags = [props.add_tags, props.remove_tags].flatMap(value => Array.isArray(value) ? value : []);
      if (!tags.length) issue(ctx, 'Add or remove at least one tag.');
      if (tags.some(tag => typeof tag === 'string' && tag.trim().startsWith('-'))) issue(ctx, 'A tag cannot start with a hyphen.');
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:146',
  },
  {
    type: 'lead.changepoints', eventType: 'action', group: 'Contact', label: 'Change points', description: 'Add or subtract contact points.',
    fields: [
      { key: 'points', label: 'Points', kind: 'integer', required: true, hint: 'Use a negative number to subtract.', min: -100000, max: 100000 },
      { key: 'group', label: 'Point group', kind: 'point-group', hint: 'Leave empty to change the main score.' },
    ],
    defaults: { points: 10 },
    schema: z.looseObject({
      points: required(value => isWhole(value) && Number(value) !== 0, 'Set a non-zero whole number of points.'),
      group: optional(value => isBlank(value) || isEngineId(value), 'Choose a point group from the list.'),
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:112',
  },
  {
    type: 'lead.changelist', eventType: 'action', group: 'Contact', label: 'Change segments', description: 'Add the contact to or remove them from segments.',
    fields: [{ key: 'addToLists', label: 'Add to segments', kind: 'segments' }, { key: 'removeFromLists', label: 'Remove from segments', kind: 'segments' }],
    defaults: { addToLists: [], removeFromLists: [] },
    schema: z.looseObject({
      addToLists: optional(value => isBlank(value) || isIdList(value), 'Choose segments from the list.'),
      removeFromLists: optional(value => isBlank(value) || isIdList(value), 'Choose segments from the list.'),
    }).superRefine((props, ctx) => {
      if (!isIdList(props.addToLists, 1) && !isIdList(props.removeFromLists, 1)) issue(ctx, 'Add to or remove from at least one segment.');
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:120',
  },
  {
    type: 'stage.change', eventType: 'action', group: 'Contact', label: 'Change stage', description: 'Move the contact to a lifecycle stage.',
    fields: [{ key: 'stage', label: 'Stage', kind: 'stage', required: true }], defaults: { stage: 0 },
    schema: z.looseObject({ stage: required(isEngineId, 'Choose a stage.') }),
    source: 'StageBundle/EventListener/CampaignSubscriber.php:43',
  },
  {
    type: 'lead.updatelead', eventType: 'action', group: 'Contact', label: 'Update contact fields',
    description: 'Set contact fields to fixed values or {contactfield=alias} tokens.',
    fields: [{ key: '', label: 'Fields to set', kind: 'field-values', object: 'contact' }], defaults: {},
    schema: fieldValuesSchema('contact'),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:129',
  },
  {
    type: 'lead.updatecompany', eventType: 'action', group: 'Contact', label: 'Update primary company',
    description: 'Set fields on the contact’s primary company.',
    fields: [{ key: '', label: 'Company fields to set', kind: 'field-values', object: 'company' }], defaults: {},
    schema: fieldValuesSchema('company'),
    warnings: () => ['Contacts without a primary company are skipped.'],
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:138',
  },
  {
    type: 'lead.addtocompany', eventType: 'action', group: 'Contact', label: 'Add to company', description: 'Link the contact to a company.',
    fields: [{ key: 'company', label: 'Company', kind: 'company', required: true }], defaults: { company: 0 },
    schema: z.looseObject({ company: required(isEngineId, 'Choose a company.') }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:154',
  },
  {
    type: 'lead.changeowner', eventType: 'action', group: 'Contact', label: 'Change owner', description: 'Assign the contact to a console user.',
    fields: [{ key: 'owner', label: 'New owner', kind: 'user', required: true }], defaults: { owner: 0 },
    schema: z.looseObject({ owner: required(isEngineId, 'Choose the new owner.') }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:162',
  },
  {
    type: 'lead.scorecontactscompanies', eventType: 'action', group: 'Contact', label: 'Change company score',
    description: 'Add to or subtract from the score of the contact’s companies.',
    fields: [{ key: 'score', label: 'Score change', kind: 'integer', required: true, min: -100000, max: 100000 }], defaults: { score: 10 },
    schema: z.looseObject({ score: required(value => isWhole(value) && Number(value) !== 0, 'Set a non-zero whole number for the score change.') }),
    warnings: () => ['The step fails for contacts without a company.'],
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:170',
  },
  {
    type: 'lead.adddnc', eventType: 'action', group: 'Contact', label: 'Add do not contact', description: 'Stop sending to the contact on these channels.',
    fields: [
      { key: 'channels', label: 'Channels', kind: 'choices', required: true, choices: workflowDncChannels },
      { key: 'reason', label: 'Note', kind: 'text', hint: 'Stored with the do-not-contact entry.' },
    ],
    defaults: { channels: ['email'], reason: '' },
    schema: z.looseObject({
      channels: required(value => isTextList(value, 1), 'Choose at least one channel.'),
      reason: optional(value => isBlank(value) || (typeof value === 'string' && value.length <= 1000), 'Keep the note under 1000 characters.'),
    }),
    source: 'LeadBundle/EventListener/CampaignActionDNCSubscriber.php:35',
  },
  {
    type: 'lead.removednc', eventType: 'action', group: 'Contact', label: 'Remove do not contact', description: 'Allow sending to the contact on these channels again.',
    fields: [{ key: 'channels', label: 'Channels', kind: 'choices', required: true, choices: workflowDncChannels }],
    defaults: { channels: ['email'] },
    schema: z.looseObject({ channels: required(value => isTextList(value, 1), 'Choose at least one channel.') }),
    source: 'LeadBundle/EventListener/CampaignActionDNCSubscriber.php:45',
  },
  {
    type: 'lead.deletecontact', eventType: 'action', group: 'Contact', label: 'Delete contact',
    description: 'Permanently delete the contact and their history. Nothing can follow this step.',
    fields: [], defaults: {}, schema: z.looseObject({}), leaf: true,
    warnings: () => ['This permanently deletes every contact who reaches it, with their history.'],
    source: 'LeadBundle/EventListener/CampaignActionDeleteContactSubscriber.php:31',
  },
  /* Actions: workflow */
  {
    type: 'campaign.addremovelead', eventType: 'action', group: 'Workflow', label: 'Change workflows',
    description: 'Add the contact to or remove them from workflows.',
    fields: [
      { key: 'addTo', label: 'Add to workflows', kind: 'campaigns', allowThis: true, hint: '“This workflow” restarts it for the contact.' },
      { key: 'removeFrom', label: 'Remove from workflows', kind: 'campaigns', allowThis: true },
    ],
    defaults: { addTo: [], removeFrom: [] },
    schema: z.looseObject({
      addTo: optional(value => isBlank(value) || (Array.isArray(value) && value.every(item => item === 'this' || isEngineId(item))), 'Choose workflows from the list.'),
      removeFrom: optional(value => isBlank(value) || (Array.isArray(value) && value.every(item => item === 'this' || isEngineId(item))), 'Choose workflows from the list.'),
    }).superRefine((props, ctx) => {
      const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
      if (!count(props.addTo) && !count(props.removeFrom)) issue(ctx, 'Add to or remove from at least one workflow.');
    }),
    source: 'CampaignBundle/EventListener/CampaignActionChangeMembershipSubscriber.php:40',
  },
  {
    type: 'campaign.jump_to_event', eventType: 'action', group: 'Workflow', label: 'Jump to step',
    description: 'Send the contact to another step of this workflow. Nothing can follow this step.',
    fields: [{ key: 'jumpToEvent', label: 'Step to jump to', kind: 'jump-target', required: true }],
    defaults: { jumpToEvent: '' }, leaf: true,
    schema: z.looseObject({ jumpToEvent: required(value => isEngineId(value) || (typeof value === 'string' && /^new[A-Za-z0-9_-]{0,40}$/.test(value)), 'Choose the step to jump to.') }),
    source: 'CampaignBundle/EventListener/CampaignActionJumpToEventSubscriber.php:46',
  },
  {
    type: 'campaign.sendwebhook', eventType: 'action', group: 'Integrations', label: 'Send a webhook',
    description: 'Call a URL with the contact’s data. {contactfield=alias} tokens work in the URL, headers and data.',
    fields: [
      { key: 'url', label: 'URL', kind: 'url', required: true },
      { key: 'method', label: 'Method', kind: 'choice', choices: ['get', 'post', 'put', 'patch', 'delete'].map(value => ({ value, label: value.toUpperCase() })) },
      { key: 'headers', label: 'Headers', kind: 'key-values' },
      { key: 'additional_data', label: 'Data', kind: 'key-values' },
      { key: 'timeout', label: 'Timeout (seconds)', kind: 'integer', min: 1, max: 300 },
    ],
    defaults: { url: '', method: 'post', headers: { list: [] }, additional_data: { list: [] }, timeout: 10 },
    schema: webhookSchema,
    source: 'WebhookBundle/EventListener/CampaignSubscriber.php:52',
  },
  {
    type: 'dwc.push_content', eventType: 'action', group: 'Web', label: 'Push dynamic content',
    description: 'Show a dynamic content item in the slot the contact requested.',
    fields: [{ key: 'dynamicContent', label: 'Dynamic content', kind: 'dynamic-content', required: true }],
    defaults: { dynamicContent: 0 },
    schema: z.looseObject({ dynamicContent: required(isEngineId, 'Choose a dynamic content item.') }),
    parentTypes: ['dwc.decision'], parentLabel: 'the yes path of a “Requests dynamic content” decision', notOnNoPath: true, immediateOnly: true,
    source: 'DynamicContentBundle/EventListener/CampaignSubscriber.php:41',
  },
  {
    type: 'focus.show', eventType: 'action', group: 'Web', label: 'Show popup or bar', description: 'Show a popup or bar on the page the contact is visiting.',
    fields: [{ key: 'focus', label: 'Popup or bar', kind: 'focus', required: true }],
    defaults: { focus: 0 },
    schema: z.looseObject({ focus: required(isEngineId, 'Choose a popup or bar.') }),
    parentTypes: ['page.pagehit'], parentLabel: 'the yes path of a “Visits a page” decision', notOnNoPath: true,
    source: 'plugins/MauticFocusBundle/EventListener/CampaignSubscriber.php:53',
  },
  /* Actions a stock install does not register */
  {
    type: 'sms.send_text_sms', eventType: 'action', group: 'Integrations', label: 'Send text message', description: 'Send an SMS.',
    fields: [], defaults: {}, source: 'SmsBundle/EventListener/CampaignSendSubscriber.php:36',
    unavailable: 'The engine registers this only when an SMS transport is enabled (CampaignSendSubscriber.php:35). OVELIO does not configure one.',
  },
  {
    type: 'notification.send_notification', eventType: 'action', group: 'Integrations', label: 'Send web push', description: 'Send a browser notification.',
    fields: [], defaults: {}, source: 'NotificationBundle/EventListener/CampaignSubscriber.php:92',
    unavailable: 'The engine registers this only when the OneSignal integration is published (CampaignSubscriber.php:67-71). OVELIO does not configure it.',
  },
  {
    type: 'notification.send_mobile_notification', eventType: 'action', group: 'Integrations', label: 'Send mobile push', description: 'Send a mobile app notification.',
    fields: [], defaults: {}, source: 'NotificationBundle/EventListener/CampaignSubscriber.php:76',
    unavailable: 'The engine registers this only when OneSignal is published with its mobile feature (CampaignSubscriber.php:67-75). OVELIO does not configure it.',
  },
  {
    type: 'tracking.pixel.send', eventType: 'action', group: 'Web', label: 'Send tracking pixel event', description: 'Fire a Google Analytics or Facebook Pixel event.',
    fields: [], defaults: {}, source: 'PageBundle/EventListener/CampaignSubscriber.php:88',
    unavailable: 'The engine registers this only when a Google Analytics or Facebook Pixel id is configured (TrackingHelper::getEnabledServices), and only after a “Visits a page” decision.',
  },
  {
    type: 'plugin.leadpush', eventType: 'action', group: 'Integrations', label: 'Push to integration', description: 'Push the contact to a CRM integration.',
    fields: [], defaults: {}, source: 'PluginBundle/EventListener/CampaignSubscriber.php:34',
    unavailable: 'The engine lists only published CRM plugins here (IntegrationsListType::buildForm) and each one has its own settings. OVELIO publishes none.',
  },
  {
    type: 'twitter.tweet', eventType: 'action', group: 'Integrations', label: 'Tweet contact', description: 'Send a tweet to the contact.',
    fields: [], defaults: {}, source: 'plugins/MauticSocialBundle/EventListener/CampaignSubscriber.php:46',
    unavailable: 'The engine registers this only when the Twitter integration is published (CampaignSubscriber.php:35-36). OVELIO does not configure it.',
  },
  /* Conditions: immediate yes/no checks (Executioner/Event/ConditionExecutioner.php:33-63) */
  {
    type: 'lead.field_value', eventType: 'condition', group: 'Contact', label: 'Contact field value',
    description: 'Check a contact, company or UTM field.',
    fields: [{ key: 'field', label: 'Field', kind: 'field-condition', required: true }],
    defaults: { field: '', operator: '=', value: '' },
    schema: fieldValueSchema,
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:179',
  },
  {
    type: 'lead.device', eventType: 'condition', group: 'Web', label: 'Contact device',
    description: 'Check the device type, brand or operating system the contact has used. Leave all empty to match any device.',
    fields: [
      { key: 'device_type', label: 'Device types', kind: 'choices', choices: deviceTypes.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) },
      { key: 'device_brand', label: 'Device brands', kind: 'list', hint: 'The engine’s brand codes, for example AP for Apple.' },
      { key: 'device_os', label: 'Operating systems', kind: 'list', hint: 'Operating system families, for example iOS, Android or Windows.' },
    ],
    defaults: { device_type: [], device_brand: [], device_os: [] },
    schema: z.looseObject({
      device_type: optional(value => isBlank(value) || isTextList(value), 'Choose device types from the list.'),
      device_brand: optional(value => isBlank(value) || isTextList(value), 'Write brands as text.'),
      device_os: optional(value => isBlank(value) || isTextList(value), 'Write operating systems as text.'),
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:188',
  },
  {
    type: 'lead.pageHit', eventType: 'condition', group: 'Web', label: 'Visited a page',
    description: 'Check whether the contact visited a landing page or URL, optionally in a date range and for a minimum time.',
    fields: [
      { key: 'page', label: 'Landing page', kind: 'page' },
      { key: 'page_url', label: 'Or a URL', kind: 'text', hint: 'Use * as a wildcard, for example https://example.test/pricing*.' },
      { key: 'startDate', label: 'Visited after', kind: 'datetime' },
      { key: 'endDate', label: 'Visited before', kind: 'datetime' },
      { key: 'accumulative_time', label: 'Stayed at least (seconds)', kind: 'seconds' },
    ],
    defaults: { page: '', page_url: '', startDate: '', endDate: '', accumulative_time: '', accumulative_time_unit: 's', returns_within_unit: 's' },
    schema: z.looseObject({
      page: optional(value => isBlank(value) || isEngineId(value), 'Choose a landing page from the list.'),
      page_url: optional(value => isBlank(value) || (typeof value === 'string' && value.length <= 2000), 'Keep the URL under 2000 characters.'),
      startDate: optional(isDateText, 'Write the start as a date and time.'),
      endDate: optional(isDateText, 'Write the end as a date and time.'),
      accumulative_time: optional(value => isBlank(value) || (isWhole(value) && Number(value) >= 0), 'Write the time on page as whole seconds.'),
    }).superRefine((props, ctx) => {
      if (isBlank(props.page) && isBlank(props.page_url)) issue(ctx, 'Choose a landing page or enter a URL.');
      if (!isBlank(props.startDate) && !isBlank(props.endDate)
        && Date.parse(String(props.startDate).replace(' ', 'T')) > Date.parse(String(props.endDate).replace(' ', 'T'))) {
        issue(ctx, 'The start of the date range must come before the end.');
      }
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:197',
  },
  {
    type: 'lead.tags', eventType: 'condition', group: 'Contact', label: 'Contact tags', description: 'Check whether the contact has any of these tags.',
    fields: [{ key: 'tags', label: 'Tags', kind: 'tags', required: true }], defaults: { tags: [] },
    schema: z.looseObject({ tags: required(value => isTextList(value, 1), 'Choose at least one tag.') }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:205',
  },
  {
    type: 'lead.segments', eventType: 'condition', group: 'Contact', label: 'Contact segments', description: 'Check whether the contact is in any of these segments.',
    fields: [{ key: 'segments', label: 'Segments', kind: 'segments', required: true }], defaults: { segments: [] },
    schema: z.looseObject({ segments: required(value => isIdList(value, 1), 'Choose at least one segment.') }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:214',
  },
  {
    type: 'lead.stages', eventType: 'condition', group: 'Contact', label: 'Contact stages', description: 'Check whether the contact is in any of these stages.',
    fields: [{ key: 'stages', label: 'Stages', kind: 'stages', required: true }], defaults: { stages: [] },
    schema: z.looseObject({ stages: required(value => isIdList(value, 1), 'Choose at least one stage.') }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:223',
  },
  {
    type: 'lead.owner', eventType: 'condition', group: 'Contact', label: 'Contact owner', description: 'Check whether the contact belongs to this owner.',
    fields: [{ key: 'owner', label: 'Owners', kind: 'users', required: true }], defaults: { owner: [] },
    schema: z.looseObject({ owner: required(value => isIdList(value, 1), 'Choose an owner.') }),
    warnings: ownerWarning,
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:232',
  },
  {
    type: 'lead.attached', eventType: 'condition', group: 'Workflow', label: 'Prevent action after date',
    description: 'Compare the current time with the workflow start date plus a period, so late joiners skip a step.',
    fields: [
      { key: 'operator', label: 'Now is', kind: 'choice', choices: [{ value: 'lt', label: 'Before the date' }, { value: 'gt', label: 'After the date' }] },
      { key: 'triggerInterval', label: 'Workflow start plus', kind: 'integer', min: 1, max: 100000 },
      { key: 'triggerIntervalUnit', label: 'Unit', kind: 'choice', choices: intervalUnitChoices },
    ],
    defaults: { timestamp: 'campaign_start_date', operator: 'lt', triggerInterval: 1, triggerIntervalUnit: 'd' },
    schema: z.looseObject({
      timestamp: oneOf(['campaign_start_date'], 'The engine only compares with the workflow start date.'),
      operator: oneOf(['gt', 'lt'], 'Choose before or after the date.'),
      triggerInterval: required(value => isWhole(value) && Number(value) >= 1, 'Set the period as a whole number of at least 1.'),
      triggerIntervalUnit: oneOf(['i', 'h', 'd', 'm', 'y'], 'Choose minutes, hours, days, months or years.'),
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:242',
  },
  {
    type: 'lead.campaigns', eventType: 'condition', group: 'Workflow', label: 'Contact workflows', description: 'Check whether the contact is in any of these workflows.',
    fields: [
      { key: 'campaigns', label: 'Workflows', kind: 'campaigns', required: true },
      { key: 'dataAddedLimit', label: 'Only count contacts added before or after a date', kind: 'boolean' },
      { key: 'expr', label: 'Added', kind: 'choice', showWhen: 'dataAddedLimit', choices: [{ value: 'lt', label: 'Before' }, { value: 'gt', label: 'After' }] },
      { key: 'dateAdded', label: 'Date', kind: 'datetime', showWhen: 'dataAddedLimit' },
    ],
    defaults: { campaigns: [], dataAddedLimit: false, expr: 'gt', dateAdded: '' },
    schema: z.looseObject({
      campaigns: required(value => isIdList(value, 1), 'Choose at least one workflow.'),
      dataAddedLimit: optional(isFlag, 'Choose yes or no for the date filter.'),
    }).superRefine((props, ctx) => {
      if (!isOn(props.dataAddedLimit)) return;
      if (props.expr !== 'gt' && props.expr !== 'lt') issue(ctx, 'Choose before or after the date.', 'expr');
      if (isBlank(props.dateAdded) || !isDateText(props.dateAdded)) issue(ctx, 'Choose the date to compare with.', 'dateAdded');
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:252',
  },
  {
    type: 'lead.dnc', eventType: 'condition', group: 'Contact', label: 'Marked do not contact', description: 'Check whether the contact is do-not-contact on a channel.',
    fields: [
      { key: 'channels', label: 'Channels', kind: 'choices', required: true, choices: workflowDncChannels },
      { key: 'reason', label: 'Only this reason', kind: 'choice', numeric: true, hint: 'Leave empty to match any reason.',
        choices: workflowDncReasons.map(reason => ({ value: String(reason.value), label: reason.label })) },
    ],
    defaults: { channels: ['email'], reason: null },
    schema: z.looseObject({
      channels: required(value => isTextList(value, 1), 'Choose at least one channel.'),
      reason: optional(value => isBlank(value) || value === 1 || value === 2 || value === 3, 'Choose unsubscribed, bounced or manual, or any reason.'),
    }),
    warnings: props => Array.isArray(props.channels) && props.channels.length > 1
      ? ['With several channels the engine keeps only the result of the last one it checks (CampaignSubscriber.php:595-613).'] : [],
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:261',
  },
  {
    type: 'lead.points', eventType: 'condition', group: 'Contact', label: 'Contact points', description: 'Compare the contact’s points with a number.',
    fields: [
      { key: 'operator', label: 'Points', kind: 'choice', choices: operatorChoices(pointOperators) },
      { key: 'score', label: 'Score', kind: 'integer', required: true, min: -1_000_000, max: 1_000_000 },
      { key: 'group', label: 'Point group', kind: 'point-group', hint: 'Leave empty to use the main score.' },
    ],
    defaults: { operator: 'gte', score: 10, group: null },
    schema: z.looseObject({
      operator: oneOf(pointOperators, 'Choose how to compare the points.'),
      score: required(isWhole, 'Set the score as a whole number.'),
      group: optional(value => isBlank(value) || isEngineId(value), 'Choose a point group from the list.'),
    }),
    source: 'LeadBundle/EventListener/CampaignSubscriber.php:270',
  },
  {
    type: 'form.field_value', eventType: 'condition', group: 'Contact', label: 'Form field value',
    description: 'Check a value the contact submitted in a lead form.',
    fields: [{ key: 'form', label: 'Form field', kind: 'form-field-condition', required: true }],
    defaults: { form: 0, field: '', operator: '=', value: '' },
    schema: z.looseObject({
      form: required(isEngineId, 'Choose a lead form.'),
      field: required(value => typeof value === 'string' && fieldAlias.test(value), 'Choose the form field to check.'),
      operator: oneOf(formConditionOperators, 'Choose how to compare the value.'),
      value: required(value => (typeof value === 'string' && value.trim().length > 0 && value.length <= 500) || typeof value === 'number', 'Enter the value to compare with.'),
    }),
    source: 'FormBundle/EventListener/CampaignSubscriber.php:62',
  },
  {
    type: 'email.validate.address', eventType: 'condition', group: 'Email', label: 'Has a valid email address',
    description: 'Check that the contact’s email address is valid and its domain can receive mail.',
    fields: [], defaults: {}, schema: z.looseObject({}),
    source: 'EmailBundle/EventListener/CampaignConditionSubscriber.php:31',
  },
  {
    type: 'notification.has.active', eventType: 'condition', group: 'Web', label: 'Has active web push',
    description: 'Check whether the contact has an enabled web push subscription.',
    fields: [], defaults: {}, schema: z.looseObject({}),
    warnings: () => ['Contacts only get web push subscriptions when the OneSignal integration is set up, so without it every contact takes the no path.'],
    source: 'NotificationBundle/EventListener/CampaignConditionSubscriber.php:24',
  },
  /* Decisions: wait for the contact to act */
  {
    type: 'email.open', eventType: 'decision', group: 'Email', label: 'Opened email?', description: 'Wait for the contact to open the email before this step.',
    fields: [], defaults: {}, schema: z.looseObject({}), parentTypes: ['email.send'], parentLabel: 'a Send email step', verb: 'opened',
    source: 'EmailBundle/EventListener/CampaignSubscriber.php:66',
  },
  {
    type: 'email.click', eventType: 'decision', group: 'Email', label: 'Clicked email?', description: 'Wait for the contact to click a link in the email before this step.',
    fields: [], defaults: {}, schema: z.looseObject({}), parentTypes: ['email.send'], parentLabel: 'a Send email step', verb: 'clicked',
    source: 'EmailBundle/EventListener/CampaignSubscriber.php:82',
  },
];

const nodeSpecByType = new Map(workflowNodeSpecs.map(spec => [spec.type, spec]));

export function workflowNodeSpec(type: string): WorkflowNodeSpec | undefined {
  return nodeSpecByType.get(type);
}

/** The spec the console can edit: known and registered in a stock install. */
export function editableNodeSpec(type: string): WorkflowNodeSpec | undefined {
  const spec = nodeSpecByType.get(type);
  return spec && !spec.unavailable ? spec : undefined;
}

/** Readable problems with a step's stored properties, or [] when the console cannot judge the type. */
export function nodePropertyIssues(node: Pick<WorkflowNode, 'type' | 'properties'>): string[] {
  const spec = editableNodeSpec(node.type);
  if (!spec?.schema) return [];
  const result = spec.schema.safeParse(node.properties);
  if (result.success) return [];
  return [...new Set(result.error.issues.map(problem => problem.message))];
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
      error(`${spec.label} must come straight after ${spec.parentLabel ?? 'a Send email step'}.`, node.id);
    }
    if (spec?.notOnNoPath && parent && branches(parent) && node.branch === 'no') error(`${spec.label} can only be on the yes path.`, node.id);
    if (parent && workflowNodeSpec(parent.type)?.leaf) error(`Nothing can follow “${parent.name}”. Move this step elsewhere.`, node.id);
    if (node.eventType === 'decision' && parent?.eventType === 'decision') {
      warn('The engine editor does not place a decision straight after another decision.', node.id);
    }
    if (!node.name.trim()) error('Give this step a name.', node.id);

    // AUT-03 / AUT-05: the step's properties, checked against the engine's own keys and rules.
    const label = spec?.label ?? node.type;
    for (const problem of nodePropertyIssues(node)) error(`${label}: ${problem}`, node.id);
    if (spec && !spec.unavailable) for (const note of spec.warnings?.(node.properties) ?? []) warn(note, node.id);
    if (spec?.unavailable) warn(`${spec.label} is kept as saved. ${spec.unavailable}`, node.id);
    if (spec?.immediateOnly && node.schedule.mode !== null && node.schedule.mode !== 'immediate') {
      error(`${spec.label} runs as soon as it is reached. Remove its wait.`, node.id);
    }
    if (node.type === 'campaign.jump_to_event' && !isBlank(node.properties.jumpToEvent)) {
      const target = String(node.properties.jumpToEvent);
      if (target === node.id) error('A step cannot jump to itself.', node.id);
      else if (!byId.has(target)) error('The step to jump to is not in this workflow.', node.id);
    }
    // CampaignActionChangeMembershipSubscriber.php:89-107 + InfiniteLoopValidator.php:28-45: re-adding contacts to the
    // same workflow needs a wait, or the engine refuses the save.
    if (node.type === 'campaign.addremovelead' && Array.isArray(node.properties.addTo) && node.properties.addTo.includes('this')) {
      const { mode, unit, interval } = node.schedule;
      if (mode === null || mode === 'immediate') error('Adding contacts back to this workflow needs a wait, or they loop forever.', node.id);
      else if (mode === 'interval' && unit === 'i' && interval < 30) error('Wait at least 30 minutes before adding contacts back to this workflow.', node.id);
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

    // A marketing email goes to each contact once; a transactional email may repeat (EmailSendType email_type).
    if (node.type === 'email.send' && node.properties.email_type !== 'transactional') {
      const emailId = node.properties.email;
      let ancestor = parent;
      const visited = new Set<string>();
      while (ancestor && !visited.has(ancestor.id)) {
        visited.add(ancestor.id);
        if (ancestor.type === 'email.send' && ancestor.properties.email_type !== 'transactional'
          && String(ancestor.properties.email) === String(emailId) && hasValue(emailId)) {
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

/* ── AUT-06: per-contact run state ──────────────────────────────────────────── */
// One entry per row of Mautic's campaign_lead_event_log (Entity/LeadEventLog.php:114-178). The engine writes a row when
// a step is scheduled, executed, failed or (for decisions) passed on the no path.

export type WorkflowRunState = 'scheduled' | 'executed' | 'failed' | 'cancelled';

export type WorkflowRunEntry = {
  /** The engine's log id, when the source returned it. */
  logId: number | null;
  workflowId: number;
  workflowName: string;
  /** The engine event id, matching `WorkflowNode.id`. */
  nodeId: string;
  nodeName: string;
  nodeType: string;
  eventType: WorkflowEventType | null;
  /**
   * scheduled: waiting for its trigger date. executed: ran (a `reason` here means it ran with an error and the contact
   * moved on). failed: did not run; `scheduledFor` is the retry. cancelled: unscheduled without running.
   */
  state: WorkflowRunState;
  /** Decisions and conditions: the path the contact took. */
  path: WorkflowBranch | null;
  /** The engine recorded a "did not act" or "condition not met" row (non_action_path_taken). */
  nonAction: boolean;
  triggeredAt: string | null;
  scheduledFor: string | null;
  reason: string | null;
  /** Which run of the workflow, for workflows contacts can restart. Null when the source does not say. */
  rotation: number | null;
  /** The step was deleted from the workflow after this row was written. */
  deleted: boolean;
};

export type WorkflowMembership = {
  dateAdded: string | null;
  manuallyRemoved: boolean;
  manuallyAdded: boolean;
  rotation: number | null;
  dateLastExited: string | null;
};

export type WorkflowRunLog = {
  contactId: number;
  entries: WorkflowRunEntry[];
  /** False when the engine held more rows than the console fetched, or one source could not be read. */
  complete: boolean;
};

export type WorkflowContactRun = WorkflowRunLog & {
  workflowId: number;
  /** The contact's membership row, or null when they were never added to this workflow. */
  membership: WorkflowMembership | null;
};

export type WorkflowNodeRunState = WorkflowRunState | 'waiting' | 'pending';

export type WorkflowNodeRun = {
  /**
   * The latest log row's state, or: waiting (a decision the contact reached but has not acted on yet), pending
   * (reached, and the engine runs it on its next pass).
   */
  state: WorkflowNodeRunState;
  entry?: WorkflowRunEntry;
  path: WorkflowBranch | null;
  /** Waiting decisions with a no path: when contacts who still have not acted move on. */
  deadline: string | null;
};

const runTime = (entry: WorkflowRunEntry) => entry.triggeredAt ?? entry.scheduledFor ?? '';

function addInterval(start: string, interval: number, unit: WorkflowIntervalUnit) {
  const at = new Date(start);
  if (!Number.isFinite(at.getTime())) return null;
  if (unit === 'm') at.setUTCMonth(at.getUTCMonth() + interval);
  else if (unit === 'y') at.setUTCFullYear(at.getUTCFullYear() + interval);
  else at.setTime(at.getTime() + interval * unitMinutes[unit] * 60_000);
  return at.toISOString();
}

/** The path a decision or condition row stands for. */
export function entryPath(entry: WorkflowRunEntry, node?: Pick<WorkflowNode, 'eventType'>): WorkflowBranch | null {
  if (entry.path) return entry.path;
  const eventType = entry.eventType ?? node?.eventType ?? null;
  if (entry.state !== 'executed' || (eventType !== 'decision' && eventType !== 'condition')) return null;
  return entry.nonAction ? 'no' : 'yes';
}

/**
 * AUT-06: where a contact is in one workflow, per step. Uses the latest row per step (highest run, then newest).
 * Decisions the contact reached without a row are waiting: the engine only logs a decision when the contact acts or
 * when the no-path wait runs out (Executioner/InactiveExecutioner.php:184-262).
 */
export function workflowRunStates(graph: WorkflowGraph, entries: WorkflowRunEntry[], options: { enrolled?: boolean } = {}) {
  const latest = new Map<string, WorkflowRunEntry>();
  for (const entry of entries) {
    const known = latest.get(entry.nodeId);
    if (!known || (entry.rotation ?? 0) > (known.rotation ?? 0)
      || ((entry.rotation ?? 0) === (known.rotation ?? 0) && runTime(entry) > runTime(known))) latest.set(entry.nodeId, entry);
  }
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const states = new Map<string, WorkflowNodeRun>();
  for (const node of graph.nodes) {
    const entry = latest.get(node.id);
    if (entry) states.set(node.id, { state: entry.state, entry, path: entryPath(entry, node), deadline: null });
  }
  const reached = (node: WorkflowNode) => {
    if (node.parentId === null) return Boolean(options.enrolled) || states.size > 0;
    const parent = byId.get(node.parentId);
    const parentRun = parent ? states.get(parent.id) : undefined;
    if (!parent || !parentRun || parentRun.state !== 'executed') return false;
    return !branches(parent) || parentRun.path === node.branch;
  };
  for (const node of graph.nodes) {
    if (states.has(node.id) || !reached(node)) continue;
    if (node.eventType === 'decision') {
      const wait = decisionWait(graph, node.id);
      const parentRun = node.parentId === null ? undefined : states.get(node.parentId);
      const since = parentRun?.entry?.triggeredAt ?? null;
      const deadline = wait.kind === 'interval' && since ? addInterval(since, wait.interval, wait.unit)
        : wait.kind === 'date' ? wait.date : null;
      states.set(node.id, { state: 'waiting', path: null, deadline });
    } else {
      states.set(node.id, { state: 'pending', path: null, deadline: null });
    }
  }
  return states;
}

/** The steps a contact is currently at: scheduled, failed and waiting for a retry, waiting to act, or about to run. */
export function currentRunNodes(graph: WorkflowGraph, states: Map<string, WorkflowNodeRun>) {
  return graph.nodes.filter(node => {
    const run = states.get(node.id);
    return run && (run.state === 'scheduled' || run.state === 'waiting' || run.state === 'pending'
      || (run.state === 'failed' && Boolean(run.entry?.scheduledFor)));
  });
}

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
