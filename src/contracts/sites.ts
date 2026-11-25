// Lane 3 · Sites & Forms API contracts (docs/rebuild/TRACKER.md §3). The list endpoints keep the cross-lane shape
// ({ id, name, slug, status, url } for pages, { id, name, status } for forms and funnels) and add display fields.

import type { Utm } from './platform';

export type PageStatus = 'draft' | 'published' | 'archived';
export type FormStatus = 'draft' | 'published' | 'archived';
export type FunnelStatus = 'draft' | 'active' | 'archived';
export type DomainStatus = 'pending' | 'verified' | 'failed';

export const pageTemplateCategories = [
  'Lead generation', 'Services', 'Events', 'Webinars', 'Products', 'Waitlists', 'Lead magnets',
] as const;
export type PageTemplateCategory = (typeof pageTemplateCategories)[number];

export type PageTemplateSummary = {
  key: string;
  name: string;
  category: PageTemplateCategory;
  description: string;
  /** Two or three colours that describe the look, for the gallery card. */
  palette: string[];
  hasForm: boolean;
};

export type PageTemplate = PageTemplateSummary & { html: string; css: string; form?: FormTemplate };

/** The form a template suggests; created and bound to the page's form block when a page is made from the template. */
export type FormTemplate = { name: string; fields: FormField[]; settings: Partial<FormSettings> };

export type LandingPageSummary = {
  id: string;
  name: string;
  slug: string;
  status: PageStatus;
  /** Public address once published (relative for the workspace address, absolute for a custom domain). */
  url: string;
  domainId: string | null;
  domain: string | null;
  templateKey: string | null;
  designId: string;
  publishedAt: string | null;
  publishedVersion: number | null;
  updatedAt: string;
  /** Unpublished edits exist (the design is newer than the published snapshot). */
  hasDraftChanges: boolean;
  views: number;
  visitors: number;
  conversions: number;
  conversionRate: number | null;
};

export type PageVariant = {
  id: string;
  key: string;
  name: string;
  designId: string;
  weight: number;
  publishedAt: string | null;
  publishedVersion: number | null;
};

export type PageSettings = {
  name: string;
  slug: string;
  domainId: string | null;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string;
  canonicalUrl: string;
  faviconUrl: string;
  noindex: boolean;
  utmDefaults: Utm;
  abEnabled: boolean;
  controlWeight: number;
};

export type LandingPageDetail = LandingPageSummary & PageSettings & { variants: PageVariant[]; funnels: { id: string; name: string; stepIndex: number }[] };

/** What the builder loads and saves. `version` is the optimistic-lock counter of the design row. */
export type PageDesign = {
  designId: string;
  name: string;
  version: number;
  /** GrapesJS project data; empty until the first save from the builder. */
  document: Record<string, unknown>;
  html: string;
  css: string;
  updatedAt: string;
};

export type DesignVersion = { version: number; label: string; createdAt: string; createdBy: string | null };

export type SavedSection = { id: string; name: string; html: string; css: string; updatedAt: string };

export type FieldType = 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checkboxes' | 'date' | 'url' | 'hidden';

export const contactFieldTargets = ['email', 'firstName', 'lastName', 'company', 'phone', 'position', 'city', 'country', 'website'] as const;
export type ContactFieldTarget = (typeof contactFieldTargets)[number];

/** Where a submitted value goes: a contact field, a custom field alias (`custom:<alias>`), or nowhere (`none`, kept on the submission). */
export type FieldMapping = ContactFieldTarget | `custom:${string}` | 'none';

export type FieldValidation = {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** A regular expression the whole value must match. */
  pattern?: string;
  /** Shown when the pattern does not match. */
  message?: string;
};

export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  validation?: FieldValidation;
  mapsTo: FieldMapping;
  /** Value of a hidden field. */
  defaultValue?: string;
  width?: 'full' | 'half';
};

export type FormSettings = {
  submitLabel: string;
  afterSubmit: 'message' | 'redirect' | 'page';
  successMessage: string;
  redirectUrl: string;
  thankYouPageId: string | null;
  tags: string[];
  consent: { enabled: boolean; text: string; required: boolean };
  /** Email design (kind 'email') sent to the person who submitted. Sent only with consent; the mailer's result is stored. */
  confirmationDesignId: string | null;
  /** Team member who gets a follow-up task for every accepted submission. */
  notifyUserId: string | null;
};

export type FormSummary = {
  id: string;
  name: string;
  status: FormStatus;
  description: string;
  fieldCount: number;
  submissions: number;
  lastSubmissionAt: string | null;
  updatedAt: string;
};

export type FormDetail = FormSummary & { fields: FormField[]; settings: FormSettings; pages: { id: string; name: string }[] };

export type SubmissionStatus = 'accepted' | 'spam' | 'error';

export type FormSubmissionRow = {
  id: string;
  createdAt: string;
  status: SubmissionStatus;
  errorDetail: string;
  contactId: number | null;
  email: string;
  values: Record<string, string | string[]>;
  pageId: string | null;
  pageName: string | null;
  funnelId: string | null;
  variant: string | null;
  utm: Utm;
  pageUrl: string;
  consentGiven: boolean;
  emailStatus: string | null;
  emailDetail: string;
};

export type FunnelStep = { id: string; position: number; name: string; pageId: string; pageName: string; pageStatus: PageStatus; url: string };

export type FunnelSummary = { id: string; name: string; status: FunnelStatus; description: string; stepCount: number; updatedAt: string; visitors: number; completions: number; completionRate: number | null };

export type FunnelDetail = FunnelSummary & { steps: FunnelStep[] };

export type FunnelStepStat = { position: number; name: string; pageId: string; visitors: number; conversionFromPrevious: number | null; dropOff: number | null };

export type FunnelStats = { days: number; steps: FunnelStepStat[]; entered: number; completed: number; completionRate: number | null; provenance: 'live' | 'preview_sample' };

export type DayPoint = { date: string; views: number; conversions: number };

export type VariantStat = { key: string; name: string; views: number; visitors: number; conversions: number; conversionRate: number | null };

export type PageStats = {
  days: number;
  views: number;
  visitors: number;
  submissions: number;
  conversions: number;
  conversionRate: number | null;
  series: DayPoint[];
  variants: VariantStat[];
  sources: { label: string; value: number }[];
  provenance: 'live' | 'preview_sample';
};

export type SiteDomain = {
  id: string;
  hostname: string;
  kind: 'subdomain' | 'custom';
  status: DomainStatus;
  statusDetail: string;
  routingDetail: string;
  verificationToken: string;
  checkedAt: string | null;
  verifiedAt: string | null;
  homePageId: string | null;
  /** The DNS records to create at the domain's DNS provider. */
  records: { type: 'TXT' | 'CNAME' | 'A'; name: string; value: string; purpose: string }[];
  pageCount: number;
};

/** The answer to a public form submission (JSON clients). */
export type SubmitResult =
  | { ok: true; message: string; redirect: string | null; submissionId: string }
  | { ok: false; error: string; fieldErrors: Record<string, string> };
