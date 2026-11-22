import type { DateRange, Point } from './common';

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

/**
 * Limits shared by the console route and the Umami adapter. Umami 3.5.0 accepts any positive funnel
 * window, 2 to 8 funnel steps, and any of its 20 breakdown fields once each; OVELIO caps the window
 * at one week and leaves the rest at Umami's own bounds.
 */
export const ANALYTICS_LIMITS = {
  funnelWindowMinutes: 10_080,
  funnelSteps: 8,
  stepValueLength: 500,
  breakdownFields: 20,
  filterValueLength: 500,
} as const;

/** Dimensions Umami 3.5.0 can report on but cannot filter by (not in its FILTER_COLUMNS). `entry` and `exit` are
 * not offered as filters here and are skipped.. */
export const UNFILTERABLE_DIMENSIONS = ['channel', 'screen'] as const;

/** Umami's 16 filter operators (src/lib/constants.ts OPERATORS). */
export const OPERATOR_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  s: 'is set',
  ns: 'is not set',
  c: 'contains',
  dnc: 'does not contain',
  re: 'matches regex',
  nre: 'does not match regex',
  t: 'is true',
  f: 'is false',
  gt: 'greater than',
  lt: 'less than',
  gte: 'at least',
  lte: 'at most',
  bf: 'before',
  af: 'after',
};

/**
 * Operators Umami applies to a segment's traffic dimensions. Its SQL filter builder
 * (src/lib/prisma.ts mapFilter) handles only these six, so these are the only ones offered.
 */
export const SEGMENT_DIMENSION_OPERATORS = ['eq', 'neq', 'c', 'dnc', 're', 'nre'] as const;

/** Segments saved by older versions used `nc`, which Umami does not know; it means `dnc`. */
export function normalizeSegmentOperator(operator: string): string {
  return operator === 'nc' ? 'dnc' : operator;
}

export function operatorLabel(operator: string): string {
  const normalized = normalizeSegmentOperator(operator);
  return OPERATOR_LABELS[normalized] ?? normalized;
}

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
