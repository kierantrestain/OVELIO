/* ── Forms, Assets, Pages, Automations & Webhooks (Mautic) ─────────────────── */

/** AUT-01: one step limit shared by the editor, the console route and the Mautic adapter. */
export const maxWorkflowSteps = 20;

export type FormField = {
  id?: number;
  label: string;
  alias: string;
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkboxgrp' | 'hidden' | 'button' | string;
  mappedField?: string;
  isRequired?: boolean;
  options?: string[];
};

export type LeadForm = {
  id: number;
  name: string;
  description?: string;
  submissions: number | null;
  published: boolean;
  fields?: FormField[];
};

export type LeadFormInput = {
  name: string;
  description?: string;
  message?: string;
  published?: boolean;
  fields?: Array<{
    label: string;
    alias: string;
    type: 'text' | 'email' | 'textarea' | 'select' | 'checkboxgrp';
    mappedField?: string;
    isRequired?: boolean;
    options?: string[];
  }>;
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
