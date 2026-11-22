export type Role = 'admin' | 'marketer' | 'analyst';
export type User = { id: string; email: string; name: string; role: Role; disabled?: boolean };
export type Health = { status: 'ready' | 'unavailable'; message?: string };
export type DateRange = { startAt: number; endAt: number };
export type Point = { label: string; value: number };
export type Page<T> = { items: T[]; total: number; page: number; limit: number };

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

export type PointTriggerInput = {
  name: string;
  description?: string;
  points: number;
  published?: boolean;
  triggerExistingLeads?: boolean;
};

/* ── Forms, Assets, Pages, Automations & Webhooks (Mautic) ─────────────────── */

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

/* ── Newsletters, Lists, Templates, Media & Bounces (Listmonk) ─────────────── */

export type MailingList = {
  id: number;
  name: string;
  description?: string;
  type?: 'private' | 'public' | string;
  optin?: 'single' | 'double' | string;
  subscriberCount: number | null;
  tags: string[];
};

export type MailingListInput = {
  name: string;
  description?: string;
  type?: 'private' | 'public';
  optin?: 'single' | 'double';
  tags?: string[];
};

export type Subscriber = {
  id: number;
  email: string;
  name?: string;
  blocked: boolean;
  lists: { id: number; status: 'unconfirmed' | 'confirmed' | 'unsubscribed' | string }[];
};

export type SubscriberInput = {
  email: string;
  name: string;
  mauticId: number;
  lists: number[];
};

export type Template = {
  id: number;
  name: string;
  body: string;
  type?: 'campaign' | 'tx' | string;
  subject?: string;
  isDefault?: boolean;
};

export type TemplateInput = {
  name: string;
  body: string;
  type?: 'campaign' | 'tx';
  subject?: string;
};

export type CampaignMetrics = {
  sent: number | null;
  delivered: number | null;
  opens: number | null;
  clicks: number | null;
  bounces: number | null;
  unsubscribes: number | null;
};

export type CampaignInput = {
  name: string;
  subject: string;
  body: string;
  altBody?: string;
  contentType?: 'html' | 'richtext' | 'markdown' | 'plain';
  tags?: string[];
  listIds: number[];
  fromEmail?: string;
  templateId?: number;
  archive?: boolean;
};

export type CampaignArchiveInput = {
  archive: boolean;
  archiveSlug?: string;
};

export type Campaign = CampaignInput & {
  id: number;
  status: string;
  sendAt: string | null;
  createdAt: string | null;
  toSend?: number | null;
  archiveSlug?: string;
  metrics: CampaignMetrics;
};

export type RunningCampaignStat = {
  id: number;
  status: string;
  toSend: number;
  sent: number;
  rate: number;
  netRate: number;
  startedAt: string | null;
};

export type CampaignLinkStat = {
  url: string;
  count: number;
};

export type MediaItem = {
  id: number;
  uuid: string;
  filename: string;
  contentType: string;
  url: string;
  thumbUrl: string | null;
  createdAt: string | null;
};

export type BounceRecord = {
  id: number;
  email: string;
  subscriberId: number;
  type: 'hard' | 'soft' | 'complaint' | string;
  source: string;
  campaignName: string | null;
  createdAt: string | null;
};

export type TransactionalEmailInput = {
  email: string;
  templateId: number;
  subject?: string;
  data?: Record<string, unknown>;
};

export type MaintenanceResult = {
  count: number;
};

/* ── Website Analytics (Umami) ─────────────────────────────────────────────── */

export type Website = { id: string; name: string; domain: string };
export type GoalInput = { name: string; type: 'event' | 'path'; value: string };
export type Goal = GoalInput & { id: string };
export type GoalStats = { total: number; unique: number };

export type Traffic = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime?: number;
};

export type ReportDimension =
  | 'path' | 'entry' | 'exit' | 'title' | 'query' | 'hostname'
  | 'referrer' | 'channel' | 'device' | 'browser' | 'os' | 'screen'
  | 'country' | 'region' | 'city' | 'language' | 'event'
  | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'utmTerm';

export type ReportFilters = Partial<Record<ReportDimension, string>>;

export type FunnelStep = { type: 'event' | 'path'; value: string };
export type FunnelResult = { label: string; visitors: number }[];
export type SavedFunnelInput = {
  name: string;
  description?: string;
  steps: FunnelStep[];
  windowMinutes: number;
};
export type SavedFunnel = SavedFunnelInput & { id: string };

export type WebsiteReport = {
  website: Website;
  range: DateRange;
  filters?: ReportFilters;
  current: Traffic | null;
  previous: Traffic | null;
  activeVisitors?: number | null;
  pageviews: Point[] | null;
  visitors: Point[] | null;
  eventsSeries?: Point[] | null;
  dimensions: Partial<Record<ReportDimension, Point[] | null>>;
};

export type RealtimeEvent = {
  type: string;
  path: string;
  eventName: string | null;
  country: string | null;
  browser: string | null;
  device: string | null;
  createdAt: string;
};

export type RealtimeReport = {
  visitors: number;
  pageviews: number;
  events: number;
  countries: Point[];
  urls: Point[];
  referrers: Point[];
  series: Point[];
  recent: RealtimeEvent[];
};

export type WebsiteSession = {
  id: string;
  hostname: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  screen: string | null;
  language: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  firstAt: string;
  lastAt: string;
  visits: number;
  views: number;
  events: number;
};

export type SessionActivityItem = {
  id: string;
  createdAt: string;
  urlPath: string | null;
  urlQuery: string | null;
  referrerDomain: string | null;
  eventName: string | null;
  eventType: number;
  pageTitle: string | null;
};

export type WeeklyTraffic = number[][];

export type RetentionRow = {
  date: string;
  day: number;
  visitors: number;
  returnVisitors: number;
  percentage: number;
};

export type JourneyPath = {
  items: string[];
  count: number;
};

export type AttributionResult = {
  referrer: Point[];
  paidAds: Point[];
  utmSource: Point[];
  utmMedium: Point[];
  utmCampaign: Point[];
  utmContent: Point[];
  utmTerm: Point[];
  total: { pageviews: number; visitors: number; visits: number };
};

export type BreakdownRow = Record<string, string | number | null>;

export type EventPropertyStat = {
  eventName: string;
  propertyName: string;
  total: number;
};

export type EventPropertyValue = {
  value: string;
  total: number;
};

export type Annotation = {
  id: string;
  date: string;
  allDay: boolean;
  note: string;
};

export type AnnotationInput = {
  date: string;
  allDay?: boolean;
  note: string;
};

export type WebsiteShare = {
  id: string;
  name: string;
  slug: string;
};

export type TrackedLink = {
  id: string;
  name: string;
  url: string;
  slug: string;
  createdAt: string | null;
};

export type TrackedLinkInput = {
  name: string;
  url: string;
  slug?: string;
};

export type TrackingPixel = {
  id: string;
  name: string;
  slug: string;
  createdAt: string | null;
};

export type TrackingPixelInput = {
  name: string;
  slug?: string;
};

export type TrackedLinkUpdateInput = {
  name?: string;
  url?: string;
  slug?: string;
};

export type TrackingPixelUpdateInput = {
  name?: string;
  slug?: string;
};

export type EntityChartSeries = Record<string, Point[]>;

export type WebsiteSegmentFilter = {
  name: string;
  operator: string;
  value: string;
};

export type WebsiteSegment = {
  id: string;
  name: string;
  type: 'segment' | 'cohort';
  filters: WebsiteSegmentFilter[];
  match?: 'all' | 'any';
  dateRange?: string;
  action?: { type: 'path' | 'event'; value: string };
  createdAt: string | null;
};

export type WebsiteSegmentInput = {
  name: string;
  type: 'segment' | 'cohort';
  filters?: WebsiteSegmentFilter[];
  match?: 'all' | 'any';
  dateRange?: string;
  action?: { type: 'path' | 'event'; value: string };
};

export type RevenueStats = {
  sum: number;
  count: number;
  uniqueCount: number;
  totalSessions: number;
  average: number;
  arpu: number;
};

export type RevenueMetricType = 'country' | 'region' | 'referrer' | 'channel';

export type RevenueMetricRow = {
  name: string;
  sum: number;
  count: number;
};

export type RevenueReport = {
  currency: string;
  stats: RevenueStats;
  comparison: RevenueStats | null;
  chart: Point[];
  metrics: RevenueMetricRow[];
};

export type PerformanceMetricKey = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb';
export type PerformanceBreakdownType = 'path' | 'title' | 'device' | 'browser';
export type PerformancePercentiles = { p50: number; p75: number; p95: number };

export type PerformanceStats = {
  lcp: PerformancePercentiles;
  inp: PerformancePercentiles;
  cls: PerformancePercentiles;
  fcp: PerformancePercentiles;
  ttfb: PerformancePercentiles;
  count: number;
};

export type PerformanceMetricRow = {
  name: string;
  count: number;
  p50: number;
  p75: number;
  p95: number;
};

export type PerformanceReport = {
  metric: PerformanceMetricKey;
  stats: PerformanceStats;
  chart: Point[];
  metrics: PerformanceMetricRow[];
};

export type ExpandedMetricRow = {
  name: string;
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
};

export type WebsiteEventRow = {
  id: string;
  sessionId: string;
  urlPath: string;
  pageTitle: string | null;
  eventName: string | null;
  eventType: number;
  referrerDomain: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
};

export type SessionStats = {
  pageviews: number;
  visitors: number;
  visits: number;
  countries: number;
  events: number;
};

export type SessionPropertyStat = {
  propertyName: string;
  total: number;
};

export type SessionPropertyEntry = {
  propertyName: string;
  value: string;
  dataType: number;
};

/* ── Unified Dashboard & Settings ──────────────────────────────────────────── */

export type Activity = { id: string; description: string; at: string; href?: string };

export type Dashboard = {
  contacts: number | null;
  contactGrowth: Point[] | null;
  activeCampaigns: number | null;
  runningCampaigns?: RunningCampaignStat[];
  activeWorkflows: number | null;
  email: CampaignMetrics;
  emailTrend: Point[] | null;
  emailClicksTrend?: Point[] | null;
  emailBouncesTrend?: Point[] | null;
  visitors: number | null;
  activeVisitors?: number | null;
  websiteName?: string;
  traffic: Point[] | null;
  leads: number | null;
  conversions: number | null;
  conversionGoal?: string;
  recent: Activity[];
  alerts: { label: string; href: string }[];
};

export type CompanySettings = { name: string; website: string; accent: string; privacyUrl: string; postalAddress: string };
export type SenderSettings = { fromEmail: string; provider: string; smtpHost: string; configured: boolean; verifiedDomain: string };
export type Settings = {
  company: CompanySettings;
  sender: SenderSettings;
  health: { audience: Health; delivery: Health; tracking: Health; worker: Health };
  trackingOrigin: string;
  team: User[];
  failedJobs?: { id: string; kind: string; attempts: number; at: string }[];
};
