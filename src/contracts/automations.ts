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
  segmentId: number;
  formId?: number;
  steps: WorkflowStep[];
};

export type Workflow = WorkflowInput & {
  id: number;
  enabled: boolean;
  editable?: boolean;
};

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
