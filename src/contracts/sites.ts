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
  /** Factory templates name the industry they were generated for. */
  industry?: TemplateIndustry;
  source?: 'curated' | 'factory';
};

export const templateIndustries = ['SaaS', 'Agency', 'E-commerce', 'Events', 'Professional services'] as const;
export type TemplateIndustry = (typeof templateIndustries)[number];

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
  /** 0-based step of a multi-step form (settings.steps). */
  step?: number;
  /** Shown only when every rule matches. Rules refer to earlier fields; a hidden field is never required or stored. */
  showIf?: FieldRule[];
  /** Progressive profiling: left out when a recognised visitor's contact already has this value. */
  skipIfKnown?: boolean;
};

export type RuleOperator = 'equals' | 'not_equals' | 'contains' | 'checked' | 'not_checked' | 'not_empty';
export type FieldRule = { field: string; operator: RuleOperator; value?: string };

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
  /** Two or more entries make the form multi-step, with a progress bar. */
  steps?: { title: string }[];
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

/** Send visitors who answer a step's form in a certain way to another step. The first matching route wins. */
export type FunnelRoute = FieldRule & { toPosition: number };

export type FunnelStep = {
  id: string; position: number; name: string; pageId: string; pageName: string; pageStatus: PageStatus; url: string;
  routes: FunnelRoute[];
  /** Fields of the forms on the step's page, for building routes. */
  fields: { key: string; label: string; options?: string[] }[];
};

export type FunnelBranchStat = { label: string; toPosition: number; toName: string; visitors: number; reached: number; conversion: number | null };

export type FunnelSummary = { id: string; name: string; status: FunnelStatus; description: string; stepCount: number; updatedAt: string; visitors: number; completions: number; completionRate: number | null };

export type FunnelDetail = FunnelSummary & { steps: FunnelStep[] };

export type FunnelStepStat = { position: number; name: string; pageId: string; visitors: number; conversionFromPrevious: number | null; dropOff: number | null; branches: FunnelBranchStat[] };

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

// ── Form logic shared by the server renderer, the submit pipeline and the builder preview ─────────────────────

const truthy = ['yes', 'on', 'true', '1', 'checked'];

export type AnswerValues = Record<string, string | string[] | undefined>;

export function ruleMatches(rule: FieldRule, values: AnswerValues): boolean {
  const raw = values[rule.field];
  const list = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(item => String(item).trim()).filter(Boolean);
  const target = (rule.value ?? '').trim().toLowerCase();
  const equals = list.some(item => item.toLowerCase() === target);
  const checked = rule.value ? equals : list.some(item => truthy.includes(item.toLowerCase()) || (Array.isArray(raw) && item.length > 0));
  switch (rule.operator) {
    case 'equals': return equals;
    case 'not_equals': return !equals;
    case 'contains': return Boolean(target) && list.some(item => item.toLowerCase().includes(target));
    case 'checked': return checked;
    case 'not_checked': return !checked;
    case 'not_empty': return list.length > 0;
    default: return false;
  }
}

export function describeRule(rule: FieldRule, label = rule.field) {
  const text: Record<RuleOperator, string> = { equals: 'is', not_equals: 'is not', contains: 'contains', checked: 'is ticked', not_checked: 'is not ticked', not_empty: 'is filled in' };
  return `${label} ${text[rule.operator]}${['equals', 'not_equals', 'contains'].includes(rule.operator) || (rule.value && rule.operator.endsWith('checked')) ? ` “${rule.value ?? ''}”` : ''}`;
}

/**
 * The fields a visitor sees, in order. A field is hidden when it is skipped for a known contact or when any of its
 * rules fails; rules only look at earlier fields, and a hidden field counts as empty for the fields after it.
 */
export function visibleFieldKeys(fields: FormField[], values: AnswerValues, known: ReadonlySet<string> = new Set()): Set<string> {
  const visible = new Set<string>();
  const effective: AnswerValues = {};
  for (const field of fields) {
    const skipped = field.skipIfKnown && known.has(field.key);
    const shown = !skipped && (field.showIf ?? []).every(rule => ruleMatches(rule, effective));
    if (shown) {
      visible.add(field.key);
      effective[field.key] = values[field.key];
    }
  }
  return visible;
}

export function formStepCount(settings: Pick<FormSettings, 'steps'>) {
  return Math.max(1, settings.steps?.length ?? 1);
}
