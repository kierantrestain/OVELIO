/* ── Audience & Contacts (Mautic + OVELIO Consent/Suppression) ─────────────── */

import type { CustomField } from './automations';

export type Contact = {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  phone?: string;
  position?: string;
  city?: string;
  country?: string;
  website?: string;
  stageId?: number | null;
  stageName?: string | null;
  points: number;
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
  suppressed: boolean;
  /** Non-empty values of every contact field outside the nine core fields, keyed by field alias. */
  customFields?: Record<string, string>;
};

export type Consent = 'unknown' | 'opted_in' | 'suppressed';

export type ConsentEvent = {
  id: string;
  action: 'opted_in' | 'suppressed';
  evidence: string;
  at: string;
};

export type SuppressionRecord = {
  emailKey: string;
  reason: 'unsubscribe' | 'bounce' | 'complaint' | 'erasure';
  at: string;
  contactId?: number | null;
  email?: string | null;
};

export type ContactInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  position?: string;
  city?: string;
  country?: string;
  website?: string;
  tags?: string[];
  /** Custom field values keyed by alias. An empty string clears the value. A multiselect takes a list. */
  customFields?: Record<string, string | string[]>;
};

export type ContactNote = {
  id: number;
  text: string;
  type: 'general' | 'email' | 'call' | 'meeting' | string;
  dateTime: string | null;
};

export type ContactNoteInput = {
  text: string;
  type?: 'general' | 'email' | 'call' | 'meeting';
};

export type ContactLinkedCompany = {
  id: number;
  name: string;
  isPrimary: boolean;
};

export type ContactDevice = {
  id: number;
  device: string;
  os: string;
  brand: string;
  dateAdded: string | null;
};

export type SubscriberActivity = {
  views: { campaignId: number; campaignName: string; at: string }[];
  clicks: { campaignId: number; campaignName: string; url: string; at: string }[];
};

export type SubscriberBounce = {
  id: number;
  type: 'hard' | 'soft' | 'complaint' | string;
  source: string;
  campaignId: number | null;
  campaignName: string | null;
  createdAt: string | null;
};

export type ContactDetail = Contact & {
  consent: Consent;
  consentHistory?: ConsentEvent[];
  segments: Segment[];
  activity: { label: string; at: string; type: string }[];
  notes?: ContactNote[];
  workflowIds?: number[];
  mailingListIds?: number[];
  linkedCompanies?: ContactLinkedCompany[];
  devices?: ContactDevice[];
  newsletterActivity?: SubscriberActivity;
  subscriberBounces?: SubscriberBounce[];
};

/** Where Mautic stores a filter row: contact fields use `lead`, company fields `company`, behaviours `behaviors`. */
export type SegmentFilterObject = 'lead' | 'company' | 'behaviors';

export type SegmentDateUnit = 'day' | 'month' | 'year';

/** Value shape Mautic stores for the "in the last / in the next" operators (Segment/Decorator/ParseDateFilterValueTrait.php:25-31). */
export type SegmentDateSpan = { interval: number; unit: SegmentDateUnit };

export type SegmentFilterValue = string | number | string[] | SegmentDateSpan;

export type SegmentFilter = {
  glue: 'and' | 'or';
  field: string;
  object?: SegmentFilterObject;
  type?: string;
  operator: string;
  filter: SegmentFilterValue;
};

export type Segment = {
  id: number;
  name: string;
  alias: string;
  description: string;
  published: boolean;
  filters?: SegmentFilter[];
  isGlobal?: boolean;
  /** Members counted by the engine (cached for up to 12 hours). Null when the engine did not report it. */
  contactCount?: number | null;
  /** When the engine last finished rebuilding membership. Mautic 7.2.2 does not return this over REST, so it is usually null. */
  lastBuiltAt?: string | null;
  /** Seconds the last rebuild took. Null when not reported. */
  lastBuiltSeconds?: number | null;
};

/** Lookups the segment builder needs that the other audience endpoints do not already serve. */
export type SegmentOptions = {
  owners: { id: number; name: string }[];
  pointGroups: { id: number; name: string }[];
};

export type SegmentInput = {
  name: string;
  description?: string;
  published?: boolean;
  filters?: SegmentFilter[];
};

export type Tag = {
  id: number;
  tag: string;
  description?: string;
};

export type Stage = {
  id: number;
  name: string;
  description: string;
  weight: number;
  published: boolean;
};

export type StageInput = {
  name: string;
  description?: string;
  weight?: number;
  published?: boolean;
};

export type Company = {
  id: number;
  name: string;
  email: string;
  website: string;
  industry: string;
  city: string;
  country: string;
  score: number;
};

export type CompanyInput = {
  name: string;
  email?: string;
  website?: string;
  industry?: string;
  city?: string;
  country?: string;
};

/** Property keys Mautic reads per action type (EmailBundle/Helper/PointEventHelper.php:23, FormBundle/Helper/PointActionHelper.php:11, PageBundle/Helper/PointActionHelper.php:42, PointModel.php:356). */
export const pointActionTypeKeys = ['email.open', 'email.send', 'form.submit', 'page.hit', 'url.hit', 'asset.download'] as const;
export type PointActionTypeKey = (typeof pointActionTypeKeys)[number];

export type PointAction = {
  id: number;
  name: string;
  description: string;
  type: string;
  delta: number;
  published: boolean;
  /** Which email, page, form, asset or URL the rule is limited to. Empty means any. */
  properties: Record<string, unknown>;
  repeatable: boolean;
  groupId: number | null;
  groupName: string | null;
};

export type PointActionInput = {
  name: string;
  description?: string;
  type: string;
  delta: number;
  published?: boolean;
  properties?: Record<string, unknown>;
  repeatable?: boolean;
  groupId?: number | null;
};

export type PointTriggerEvent = {
  id?: number;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
};

export type PointTrigger = {
  id: number;
  name: string;
  description: string;
  points: number;
  published: boolean;
  triggerExistingLeads: boolean;
  events: PointTriggerEvent[];
};

export const pointTriggerEventTypes = [
  'lead.changelists', 'lead.changetags', 'lead.changestage', 'email.send', 'email.send_to_user',
  'campaign.changecampaign', 'plugin.leadpush',
] as const;

export type PointTriggerEventType = typeof pointTriggerEventTypes[number];

export type PointTriggerEventInput = {
  /** Keep the id of an existing event to update it. Events left out of an edit are removed. */
  id?: number;
  name?: string;
  type: PointTriggerEventType;
  properties: Record<string, unknown>;
};

export type PointTriggerInput = {
  name: string;
  description?: string;
  points: number;
  published?: boolean;
  triggerExistingLeads?: boolean;
  events?: PointTriggerEventInput[];
};

/* ── Segment builder: filter catalogue, operators and value shapes (AUD-04/05) ──
 * Reimplements what Mautic 7.2.2 accepts in `lead_lists.filters`. Evidence (Mautic app/bundles/LeadBundle):
 * - operators and their keys: Segment/OperatorOptions.php:11-190 (24 keys); per-type tables: Entity/OperatorListTrait.php:12-126
 * - filter fields: EventListener/FilterOperatorSubscriber.php:125-518 and Services/ContactSegmentFilterDictionary.php:63-290
 * - type aliasing and "in the last/next" for date types: EventListener/TypeOperatorSubscriber.php:70-95 */

export const segmentOperatorKeys = [
  '=', '!=', 'gt', 'gte', 'lt', 'lte', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp',
  'startsWith', 'endsWith', 'contains', 'in', '!in', 'in_all', '!in_all', 'inLast', 'inNext',
  'between', '!between', 'date',
] as const;

export type SegmentOperator = typeof segmentOperatorKeys[number];

/** How many values an operator takes: none (empty), one, a list (in), two (between) or "N days" (inLast). */
export type SegmentValueMode = 'none' | 'single' | 'multi' | 'pair' | 'span';

type SegmentOperatorInfo = { label: string; dateLabel?: string; mode: SegmentValueMode; hidden?: true };

/** `hidden` operators exist in the engine but Mautic's own builder never offers them (OperatorOptions.php:121-146, 166-171). */
export const segmentOperatorInfo: Record<SegmentOperator, SegmentOperatorInfo> = {
  '=': { label: 'is equal to', mode: 'single' },
  '!=': { label: 'is not equal to', mode: 'single' },
  gt: { label: 'is greater than', dateLabel: 'is more recent than', mode: 'single' },
  gte: { label: 'is greater than or equal to', dateLabel: 'is equal to or more recent than', mode: 'single' },
  lt: { label: 'is less than', dateLabel: 'is older than', mode: 'single' },
  lte: { label: 'is less than or equal to', dateLabel: 'is equal to or older than', mode: 'single' },
  empty: { label: 'is empty', mode: 'none' },
  '!empty': { label: 'is not empty', mode: 'none' },
  like: { label: 'is like (use % as a wildcard)', mode: 'single' },
  '!like': { label: 'is not like (use % as a wildcard)', mode: 'single' },
  regexp: { label: 'matches pattern', mode: 'single' },
  '!regexp': { label: 'does not match pattern', mode: 'single' },
  startsWith: { label: 'starts with', mode: 'single' },
  endsWith: { label: 'ends with', mode: 'single' },
  contains: { label: 'contains', mode: 'single' },
  in: { label: 'includes any of', mode: 'multi' },
  '!in': { label: 'excludes any of', mode: 'multi' },
  in_all: { label: 'includes all of', mode: 'multi' },
  '!in_all': { label: 'excludes all of', mode: 'multi' },
  inLast: { label: 'in the last', mode: 'span' },
  inNext: { label: 'in the next', mode: 'span' },
  between: { label: 'is between', mode: 'pair', hidden: true },
  '!between': { label: 'is not between', mode: 'pair', hidden: true },
  date: { label: 'is on date', mode: 'single', hidden: true },
};

/** Rows saved by earlier OVELIO versions used these spellings. Mautic passes them through unchanged. */
export function canonicalSegmentOperator(operator: string): string {
  return operator === 'eq' ? '=' : operator === 'neq' ? '!=' : operator;
}

/** The field families, named after the type tables in Entity/OperatorListTrait.php. */
export type SegmentFieldKind =
  | 'text' | 'select' | 'multiselect' | 'boolean' | 'number' | 'default' | 'date'
  | 'owner' | 'stage' | 'behaviorText' | 'behaviorNumber' | 'behaviorDate' | 'emailPick';

const operatorSets: Record<SegmentFieldKind, SegmentOperator[]> = {
  text: ['=', '!=', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp', 'in', '!in', 'startsWith', 'endsWith', 'contains'],
  select: ['=', '!=', 'empty', '!empty', 'regexp', '!regexp', 'in', '!in'],
  multiselect: ['in', '!in', 'in_all', '!in_all', 'empty', '!empty'],
  boolean: ['=', '!='],
  number: ['=', '!=', 'gt', 'gte', 'lt', 'lte', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp', 'startsWith', 'endsWith', 'contains'],
  default: ['=', '!=', 'gt', 'gte', 'lt', 'lte', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp', 'startsWith', 'endsWith', 'contains'],
  date: [
    '=', '!=', 'gt', 'gte', 'lt', 'lte', 'empty', '!empty', 'like', '!like', 'regexp', '!regexp',
    'startsWith', 'endsWith', 'contains', 'inLast', 'inNext',
  ],
  owner: ['=', '!=', 'empty', '!empty'],
  stage: ['=', '!=', 'empty', '!empty'],
  behaviorText: ['=', '!=', 'like', '!like', 'regexp', '!regexp', 'startsWith', 'endsWith', 'contains'],
  behaviorNumber: ['=', 'gt', 'gte', 'lt', 'lte'],
  behaviorDate: ['=', '!=', 'gt', 'gte', 'lt', 'lte', 'inLast', 'inNext'],
  emailPick: ['in', '!in', 'in_all', '!in_all'],
};

/** Where the choices for an id-based filter come from. */
export type SegmentPicker =
  | 'segments' | 'tags' | 'stages' | 'owners' | 'campaigns' | 'emails' | 'assets' | 'categories';

export type SegmentFilterField = {
  /** `object:key`, unique across contact, company and behaviour fields. */
  id: string;
  key: string;
  label: string;
  group: string;
  object: SegmentFilterObject;
  /** The `type` Mautic stores on the row. It selects the decorator (dates) and the value cast (number, boolean). */
  type: string;
  kind: SegmentFieldKind;
  picker?: SegmentPicker;
  /** Fixed choices of a custom select, multiselect or boolean-like field. */
  options?: string[];
};

export const segmentFieldId = (object: SegmentFilterObject, key: string) => `${object}:${key}`;

type Seed = [key: string, label: string, type: string, kind: SegmentFieldKind, picker?: SegmentPicker];

function seeds(group: string, object: SegmentFilterObject, rows: Seed[]): SegmentFilterField[] {
  return rows.map(([key, label, type, kind, picker]) => ({
    id: segmentFieldId(object, key), key, label, group, object, type, kind, ...(picker ? { picker } : {}),
  }));
}

/** Filter keys that do not depend on the instance's field definitions (FilterOperatorSubscriber.php:125-518). */
export const staticSegmentFields: SegmentFilterField[] = [
  ...seeds('Contact', 'lead', [
    ['date_added', 'Date added', 'datetime', 'date'],
    ['date_identified', 'Date identified', 'datetime', 'date'],
    ['date_modified', 'Date modified', 'datetime', 'date'],
    ['last_active', 'Date last active', 'datetime', 'date'],
    ['owner_id', 'Owner', 'lookup_id', 'owner', 'owners'],
    ['points', 'Points', 'number', 'number'],
    ['stage', 'Lifecycle stage', 'stage', 'stage', 'stages'],
  ]),
  ...seeds('Membership', 'lead', [
    ['leadlist', 'Segment membership', 'leadlist', 'multiselect', 'segments'],
    ['tags', 'Tags', 'tags', 'multiselect', 'tags'],
    ['campaign', 'Campaign membership', 'campaign', 'multiselect', 'campaigns'],
    ['globalcategory', 'Subscribed categories', 'globalcategory', 'multiselect', 'categories'],
  ]),
  ...seeds('Do not contact', 'lead', [
    ['dnc_bounced', 'Bounced (email)', 'boolean', 'boolean'],
    ['dnc_unsubscribed', 'Unsubscribed (email)', 'boolean', 'boolean'],
    ['dnc_manual_email', 'Unsubscribed manually (email)', 'boolean', 'boolean'],
    ['dnc_bounced_sms', 'Bounced (SMS)', 'boolean', 'boolean'],
    ['dnc_unsubscribed_sms', 'Unsubscribed (SMS)', 'boolean', 'boolean'],
    ['dnc_manual_sms', 'Unsubscribed manually (SMS)', 'boolean', 'boolean'],
  ]),
  ...seeds('Devices', 'lead', [
    ['device_type', 'Device type', 'device_type', 'multiselect'],
    ['device_brand', 'Device brand', 'device_brand', 'multiselect'],
    ['device_os', 'Device operating system', 'device_os', 'multiselect'],
    ['device_model', 'Device model', 'text', 'text'],
  ]),
  ...seeds('UTM', 'lead', [
    ['utm_campaign', 'UTM campaign', 'text', 'text'],
    ['utm_content', 'UTM content', 'text', 'text'],
    ['utm_medium', 'UTM medium', 'text', 'text'],
    ['utm_source', 'UTM source', 'text', 'text'],
    ['utm_term', 'UTM term', 'text', 'text'],
  ]),
  ...seeds('Email activity', 'behaviors', [
    ['lead_email_received', 'Read a specific email', 'lead_email_received', 'emailPick', 'emails'],
    ['lead_email_sent', 'Was sent a specific email', 'lead_email_received', 'emailPick', 'emails'],
    ['lead_email_sent_date', 'Sent any email (date)', 'datetime', 'behaviorDate'],
    ['lead_email_read_date', 'Read any email (date)', 'datetime', 'behaviorDate'],
    ['lead_email_read_count', 'Read any email this many times', 'number', 'behaviorNumber'],
    ['email_id', 'Clicked any link in any email', 'boolean', 'boolean'],
    ['email_clicked_link_date', 'Clicked any link in any email (date)', 'datetime', 'behaviorDate'],
  ]),
  ...seeds('Web activity', 'behaviors', [
    ['hit_url', 'Visited a URL', 'text', 'behaviorText'],
    ['hit_url_date', 'Visited any URL (date)', 'datetime', 'behaviorDate'],
    ['hit_url_count', 'Visited any URL this many times', 'number', 'behaviorNumber'],
    ['url_title', 'Visited a URL with this page title', 'text', 'behaviorText'],
    ['referer', 'Visited from this referrer', 'text', 'behaviorText'],
    ['source', 'Visited from this source', 'text', 'behaviorText'],
    ['source_id', 'Visited from this source ID', 'number', 'number'],
    ['sessions', 'Number of browsing sessions', 'number', 'behaviorNumber'],
    ['page_id', 'Visited a landing page', 'boolean', 'boolean'],
    ['redirect_id', 'Clicked a tracked link in any channel', 'boolean', 'boolean'],
  ]),
  ...seeds('Assets, SMS and push', 'behaviors', [
    ['lead_asset_download', 'Downloaded a specific asset', 'assets', 'multiselect', 'assets'],
    ['sms_clicked_link', 'Clicked any link in any text message', 'boolean', 'boolean'],
    ['sms_clicked_link_date', 'Clicked any link in any text message (date)', 'datetime', 'behaviorDate'],
    ['notification', 'Was sent a push notification', 'boolean', 'boolean'],
  ]),
];

/** Mautic's type to operator-table mapping (OperatorListTrait::normalizeType, lines 213-240). */
export function segmentKindForFieldType(type: string): SegmentFieldKind {
  if (type === 'boolean') return 'boolean';
  if (type === 'multiselect') return 'multiselect';
  if (['select', 'country', 'region', 'timezone', 'locale'].includes(type)) return 'select';
  if (['text', 'email', 'url', 'tel', 'lookup'].includes(type)) return 'text';
  if (type === 'date' || type === 'datetime') return 'date';
  if (type === 'number') return 'number';
  return 'default';
}

function definitionField(field: CustomField, object: SegmentFilterObject, group: string): SegmentFilterField {
  const kind = segmentKindForFieldType(field.type);
  return {
    id: segmentFieldId(object, field.alias),
    key: field.alias,
    label: field.label || field.alias,
    group,
    object,
    type: field.type,
    kind,
    ...((kind === 'select' || kind === 'multiselect') && field.options.length ? { options: field.options } : {}),
  };
}

/** Static filters plus every published contact field, company field and point group (R1#6). */
export function segmentFieldCatalogue(input: {
  contactFields?: CustomField[];
  companyFields?: CustomField[];
  pointGroups?: { id: number; name: string }[];
} = {}): SegmentFilterField[] {
  return [
    ...staticSegmentFields,
    ...(input.pointGroups ?? []).map(group => ({
      id: segmentFieldId('lead', `group_points_${group.id}`),
      key: `group_points_${group.id}`,
      label: `Points (${group.name})`,
      group: 'Point groups',
      object: 'lead' as const,
      type: 'number',
      kind: 'number' as const,
    })),
    ...(input.contactFields ?? []).filter(field => field.published).map(field => definitionField(field, 'lead', 'Contact fields')),
    ...(input.companyFields ?? []).filter(field => field.published).map(field => definitionField(field, 'company', 'Company fields')),
  ];
}

function prettyKey(key: string) {
  return key.replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

function inferKind(filter: { type?: string; operator: string; filter: SegmentFilterValue }): SegmentFieldKind {
  if (filter.type) {
    if (filter.type === 'number') return 'number';
    if (filter.type === 'boolean') return 'boolean';
    if (filter.type === 'date' || filter.type === 'datetime') return 'date';
    if (['tags', 'leadlist', 'campaign', 'globalcategory', 'assets', 'multiselect'].includes(filter.type)) return 'multiselect';
    return segmentKindForFieldType(filter.type);
  }
  return Array.isArray(filter.filter) ? 'multiselect' : 'text';
}

/** Finds the catalogue entry for a stored row. Rows Mautic wrote with another `object`, or for fields that no longer exist, still resolve. */
export function resolveSegmentField(catalogue: SegmentFilterField[], filter: Pick<SegmentFilter, 'field' | 'object' | 'type' | 'operator' | 'filter'>): SegmentFilterField {
  const object = filter.object ?? 'lead';
  const exact = catalogue.find(entry => entry.id === segmentFieldId(object, filter.field));
  if (exact) return exact;
  // Some behaviour filters were moved from `lead` to `behaviors` (Form/Type/FilterType.php:56-58), so match either way.
  const sibling = object === 'company' ? undefined : catalogue.find(entry => entry.key === filter.field && entry.object !== 'company');
  if (sibling) return sibling;
  return {
    id: segmentFieldId(object, filter.field), key: filter.field, label: prettyKey(filter.field), group: 'Other',
    object, type: filter.type ?? 'text', kind: inferKind(filter),
  };
}

export type SegmentOperatorChoice = { value: string; label: string; mode: SegmentValueMode; valid: boolean };

/** The operators to show for a field. A rule that already carries another operator keeps it, marked invalid. */
export function segmentOperatorsFor(field: SegmentFilterField, current?: string): SegmentOperatorChoice[] {
  const dated = field.kind === 'date' || field.kind === 'behaviorDate';
  const choices: SegmentOperatorChoice[] = operatorSets[field.kind].map(operator => {
    const info = segmentOperatorInfo[operator];
    return { value: operator, label: dated && info.dateLabel ? info.dateLabel : info.label, mode: info.mode, valid: true };
  });
  const operator = current ? canonicalSegmentOperator(current) : '';
  if (operator && !choices.some(choice => choice.value === operator)) {
    const info = segmentOperatorInfo[operator as SegmentOperator];
    choices.push({ value: operator, label: `${info?.label ?? operator} (not valid for this field)`, mode: info?.mode ?? 'single', valid: false });
  }
  return choices;
}

export function segmentValueMode(operator: string): SegmentValueMode {
  return segmentOperatorInfo[canonicalSegmentOperator(operator) as SegmentOperator]?.mode ?? 'single';
}

export const segmentDateUnits: { value: SegmentDateUnit; label: string }[] = [
  { value: 'day', label: 'days' },
  { value: 'month', label: 'months' },
  { value: 'year', label: 'years' },
];

/** Relative dates Mautic resolves by their English wording (Segment/RelativeDate.php:20-36, Decorator/Date/DateOptionFactory.php:46-90). */
export const segmentRelativeDates = [
  'today', 'tomorrow', 'yesterday', 'this week', 'last week', 'next week', 'this month', 'last month', 'next month',
  'this year', 'last year', 'next year', 'anniversary',
].map(value => ({ value, label: value.replace(/^./, letter => letter.toUpperCase()) }));

export const segmentOffsetUnits = ['days', 'weeks', 'months', 'years'] as const;
export type SegmentOffsetUnit = typeof segmentOffsetUnits[number];

export type SegmentDateInput =
  | { mode: 'absolute'; value: string }
  | { mode: 'relative'; value: string }
  | { mode: 'offset'; amount: number; unit: SegmentOffsetUnit; direction: 'ago' | 'ahead' };

/** Classifies a stored date value for the date picker: a calendar date, a named period, or "-5 days" style offsets. */
export function parseSegmentDate(value: string): SegmentDateInput {
  const trimmed = value.trim();
  if (segmentRelativeDates.some(option => option.value === trimmed.toLowerCase())) return { mode: 'relative', value: trimmed.toLowerCase() };
  const offset = /^([+-])\s*(\d+)\s+(day|week|month|year)s?$/i.exec(trimmed);
  if (offset) {
    return { mode: 'offset', amount: Number(offset[2]), unit: `${offset[3].toLowerCase()}s` as SegmentOffsetUnit, direction: offset[1] === '-' ? 'ago' : 'ahead' };
  }
  return { mode: 'absolute', value: trimmed };
}

/** Builds the string Mautic's relative-interval decorator hands to PHP `DateTime::modify` (Decorator/Date/Other/DateRelativeInterval.php:60-64). */
export function formatSegmentOffset(amount: number, unit: SegmentOffsetUnit, direction: 'ago' | 'ahead'): string {
  return `${direction === 'ago' ? '-' : '+'}${Math.max(1, Math.floor(amount))} ${unit}`;
}

/** A segment rule as the editor holds it, before it becomes a stored filter row. */
export type SegmentRule = {
  glue: 'and' | 'or';
  /** Catalogue field id (`object:key`). */
  field: string;
  operator: string;
  text: string;
  text2: string;
  list: string[];
  interval: string;
  unit: SegmentDateUnit;
};

export function emptySegmentRule(field: SegmentFilterField, glue: 'and' | 'or' = 'and'): SegmentRule {
  const operator = segmentOperatorsFor(field)[0].value;
  return { glue, field: field.id, operator, text: field.kind === 'boolean' ? '1' : '', text2: '', list: [], interval: '', unit: 'day' };
}

const spanOf = (value: unknown): SegmentDateSpan | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { interval, unit } = value as Record<string, unknown>;
  const count = Number(interval);
  return Number.isFinite(count) && count > 0 && (unit === 'day' || unit === 'month' || unit === 'year')
    ? { interval: count, unit } : undefined;
};

/** Reads a stored row back into editable form, including rows made in the Mautic UI. */
export function segmentRuleFromFilter(filter: SegmentFilter, field: SegmentFilterField): SegmentRule {
  const operator = canonicalSegmentOperator(filter.operator);
  const rule = emptySegmentRule(field, filter.glue);
  rule.operator = operator;
  const value = filter.filter;
  const span = spanOf(value);
  if (span) {
    rule.interval = String(span.interval);
    rule.unit = span.unit;
  } else if (Array.isArray(value)) {
    if (segmentValueMode(operator) === 'pair') [rule.text, rule.text2] = [value[0] ?? '', value[1] ?? ''];
    else rule.list = value.map(String);
  } else if (field.kind === 'boolean') {
    rule.text = value === 0 || value === '0' || value === '' ? '0' : '1';
  } else if (typeof value === 'string' || typeof value === 'number') {
    rule.text = String(value);
    if (segmentValueMode(operator) === 'multi') rule.list = String(value).split('|').map(part => part.trim()).filter(Boolean);
  }
  return rule;
}

/** Turns an editor rule into the row stored in Mautic. Throws a plain message when the value is missing or invalid. */
export function segmentFilterFromRule(rule: SegmentRule, field: SegmentFilterField, position: number): SegmentFilter {
  const label = `filter rule ${position + 1}`;
  const operator = canonicalSegmentOperator(rule.operator);
  const base = { glue: position === 0 ? 'and' as const : rule.glue, field: field.key, object: field.object, type: field.type, operator };
  const mode = segmentValueMode(operator);
  if (mode === 'none') return { ...base, filter: '' };
  if (mode === 'span') {
    const interval = Number(rule.interval);
    if (!Number.isInteger(interval) || interval < 1) throw new Error(`Enter a whole number of days, months or years for ${label}.`);
    return { ...base, filter: { interval, unit: rule.unit } };
  }
  if (mode === 'multi') {
    const list = rule.list.length ? rule.list : rule.text.split(',').map(part => part.trim()).filter(Boolean);
    if (!list.length) throw new Error(`Choose at least one value for ${label}.`);
    return { ...base, filter: list };
  }
  if (mode === 'pair') {
    const pair = [rule.text.trim(), rule.text2.trim()];
    if (!pair[0] || !pair[1]) throw new Error(`Enter both values for ${label}.`);
    return { ...base, filter: pair };
  }
  const raw = rule.text.trim();
  if (field.kind === 'boolean') return { ...base, filter: raw === '0' ? 0 : 1 };
  if (!raw) throw new Error(`Enter a value for ${label}.`);
  if ((field.kind === 'number' || field.kind === 'behaviorNumber') && ['=', '!=', 'gt', 'gte', 'lt', 'lte'].includes(operator)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) throw new Error(`Enter a number for ${label}.`);
    return { ...base, filter: numeric };
  }
  return { ...base, filter: raw };
}


/* ── Contact list: search grammar, sorting, saved views ──────────────────── */

/** Columns the contact list can be sorted by, mapped to Mautic's `l.` columns server-side. */
export const contactSortKeys = [
  'createdAt', 'updatedAt', 'lastActive', 'email', 'firstName', 'lastName', 'company', 'city', 'country', 'position', 'points', 'id',
] as const;
export type ContactSortKey = (typeof contactSortKeys)[number];

export type ContactSearchCommand = { command: string; label: string; example: string; description: string };

/** The 28 commands LeadRepository::getSearchCommands() registers (LeadRepository.php:1021-1052), spelled as Mautic's English translations spell them. */
export const contactSearchCommands: ContactSearchCommand[] = [
  { command: 'is:anonymous', label: 'Anonymous visitors', example: 'is:anonymous', description: 'Contacts that have not been identified.' },
  { command: 'is:mine', label: 'My contacts', example: 'is:mine', description: 'Contacts owned by the connected API user.' },
  { command: 'is:unowned', label: 'Unowned', example: 'is:unowned', description: 'Contacts with no owner.' },
  { command: 'segment', label: 'Segment', example: 'segment:newsletter', description: 'Members of a segment, by segment alias.' },
  { command: 'campaign', label: 'Campaign', example: 'campaign:12', description: 'Members of a campaign, by campaign id.' },
  { command: 'name', label: 'Name', example: 'name:ada', description: 'First or last name.' },
  { command: 'company', label: 'Company', example: 'company:northwind', description: 'Company name.' },
  { command: 'company_id', label: 'Company id', example: 'company_id:4', description: 'Linked company, by id.' },
  { command: 'email', label: 'Email', example: 'email:*@example.com', description: 'Email address.' },
  { command: 'owner', label: 'Owner', example: 'owner:admin', description: 'Contacts owned by a user.' },
  { command: 'ip', label: 'IP address', example: 'ip:203.0.113.5', description: 'Contacts seen from an IP address.' },
  { command: 'tag', label: 'Tag', example: 'tag:vip', description: 'Contacts with a tag.' },
  { command: 'stage', label: 'Lifecycle stage', example: 'stage:lead', description: 'Contacts in a lifecycle stage.' },
  { command: 'common', label: 'In several segments', example: 'common:"a,b"', description: 'Contacts common to the listed segments.' },
  { command: 'email_sent', label: 'Email sent', example: 'email_sent:5', description: 'Contacts sent an email, by email id.' },
  { command: 'email_read', label: 'Email read', example: 'email_read:5', description: 'Contacts who read an email, by email id.' },
  { command: 'email_queued', label: 'Email queued', example: 'email_queued:5', description: 'Contacts with an email queued, by email id.' },
  { command: 'email_pending', label: 'Email pending', example: 'email_pending:5', description: 'Contacts with an email pending, by email id.' },
  { command: 'page_source', label: 'Page source', example: 'page_source:page', description: 'Contacts by the source of a page visit.' },
  { command: 'page_source_id', label: 'Page source id', example: 'page_source_id:3', description: 'Contacts by the id of a page source.' },
  { command: 'import_id', label: 'Import id', example: 'import_id:7', description: 'Contacts created or updated by a Mautic import.' },
  { command: 'import_action', label: 'Import action', example: 'import_action:created', description: 'Contacts by import action.' },
  { command: 'page_id', label: 'Page visited', example: 'page_id:3', description: 'Contacts who visited a page, by id.' },
  { command: 'sms_sent', label: 'Text message sent', example: 'sms_sent:2', description: 'Contacts sent a text message, by id.' },
  { command: 'web_sent', label: 'Web notification sent', example: 'web_sent:2', description: 'Contacts sent a web notification, by id.' },
  { command: 'mobile_sent', label: 'Mobile notification sent', example: 'mobile_sent:2', description: 'Contacts sent a mobile notification, by id.' },
  { command: 'dnc', label: 'Do not contact', example: 'dnc:any', description: 'Contacts marked do not contact, for any or one channel.' },
  { command: 'form', label: 'Form', example: 'form:3', description: 'Contacts who submitted a form, by id.' },
];

export type ContactView = {
  id: string;
  name: string;
  search: string;
  sortBy: ContactSortKey;
  sortDir: 'asc' | 'desc';
  createdBy: string | null;
  updatedAt: string;
};

export type ContactViewInput = { name: string; search: string; sortBy: ContactSortKey; sortDir: 'asc' | 'desc' };

/* ── Contact timeline ─────────────────────────────────────────────────────── */

export type TimelineEvent = { id: string; type: string; typeLabel: string; label: string; at: string; href?: string };

export type ContactTimeline = {
  events: TimelineEvent[];
  /** Every event type the engine reports, as key to label, for the filter menu. */
  types: Record<string, string>;
  total: number;
  page: number;
  limit: number;
};

export type TimelineQuery = { search?: string; include?: string[]; exclude?: string[]; page?: number; limit?: number; dir?: 'asc' | 'desc' };

/* ── Contact import ───────────────────────────────────────────────────────── */

export const importCoreFields = [
  'email', 'firstName', 'lastName', 'company', 'phone', 'position', 'city', 'country', 'website', 'tags', 'consent', 'evidence',
] as const;

/** Maps a CSV column header to a target: a core field name, `custom:<alias>`, or `skip`. */
export type ImportMapping = Record<string, string>;

export type ImportPreview = {
  headers: string[];
  rows: string[][];
  rowCount: number;
  mapping: ImportMapping;
  targets: { value: string; label: string }[];
};

export type ImportStatus = 'draft' | 'queued' | 'running' | 'done' | 'failed';

export type ImportRun = {
  id: string;
  fileName: string;
  status: ImportStatus;
  dryRun: boolean;
  total: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  createdAt: string;
  finishedAt: string | null;
};
