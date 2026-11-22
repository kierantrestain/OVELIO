/* ── Audience & Contacts (Mautic + OVELIO Consent/Suppression) ─────────────── */

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

export type SegmentFilter = {
  glue: 'and' | 'or';
  field: string;
  object?: 'lead' | 'company';
  type?: string;
  operator: string;
  filter: string | number | string[];
};

export type Segment = {
  id: number;
  name: string;
  alias: string;
  description: string;
  published: boolean;
  filters?: SegmentFilter[];
  isGlobal?: boolean;
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

export type PointAction = {
  id: number;
  name: string;
  description: string;
  type: string;
  delta: number;
  published: boolean;
};

export type PointActionInput = {
  name: string;
  description?: string;
  type: string;
  delta: number;
  published?: boolean;
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
