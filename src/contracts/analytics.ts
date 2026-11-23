import type { DateRange, Point } from './common';

/* ── Website Analytics (Umami) ─────────────────────────────────────────────── */

export type Website = { id: string; name: string; domain: string };
export type GoalInput = { name: string; type: 'event' | 'path'; value: string };
export type Goal = GoalInput & { id: string };
/**
 * Umami 3.5.0 goal stats (src/queries/sql/goals/getGoal.ts:30-62): `unique` counts distinct sessions that hit the
 * goal, `total` counts every distinct session in the same period (not conversions), and `rate` is unique / total
 * (0 to 1). reporting.ts and the e2e suite read `unique`, so the names stay.
 */
export type GoalStats = { total: number; unique: number; rate: number };

/** A goal value containing `*` matches as a pattern (Umami src/lib/search.ts getWildcardMatch); otherwise it is exact. */
export function goalMatchKind(value: string): 'exact' | 'wildcard' {
  return value.includes('*') ? 'wildcard' : 'exact';
}

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
  filterRules: 20,
  filterValues: 25,
  propertyFilters: 10,
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

/* ── Filters (ANA-06, ANA-09) ──────────────────────────────────────────────── */

/**
 * Report dimensions Umami 3.5.0 can filter by: its FILTER_COLUMNS (src/lib/constants.ts:83) minus the aliases and
 * columns its request schema does not take (`entry`, `exit`, `domain`, numeric `eventType`).
 */
export const FILTER_DIMENSIONS = [
  'path', 'referrer', 'title', 'query', 'hostname', 'device', 'browser', 'os',
  'country', 'region', 'city', 'language', 'event', 'tag', 'distinctId',
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export const FILTER_DIMENSION_LABELS: Record<FilterDimension, string> = {
  path: 'Path', referrer: 'Referrer', title: 'Page title', query: 'Query', hostname: 'Hostname',
  device: 'Device', browser: 'Browser', os: 'OS', country: 'Country', region: 'Region', city: 'City',
  language: 'Language', event: 'Event', tag: 'Tag', distinctId: 'Distinct ID',
  utmSource: 'UTM source', utmMedium: 'UTM medium', utmCampaign: 'UTM campaign',
  utmContent: 'UTM content', utmTerm: 'UTM term',
};

export type DimensionOperator = (typeof SEGMENT_DIMENSION_OPERATORS)[number];

/** One filter on a traffic dimension. `is` and `is not` take several values; the other operators take one. */
export type FilterRule = { dimension: FilterDimension; operator: DimensionOperator; values: string[] };

/** Umami's DATA_TYPE codes (src/lib/constants.ts:145). */
export const PROPERTY_DATA_TYPE_CODES = { string: 1, number: 2, boolean: 3, date: 4, array: 5 } as const;
export type PropertyDataType = keyof typeof PROPERTY_DATA_TYPE_CODES;

/** Operators Umami's property filter SQL applies per data type (src/lib/prisma.ts getPropertyFilterQuery). */
export const PROPERTY_OPERATORS: Record<PropertyDataType, readonly string[]> = {
  string: ['eq', 'neq', 'c', 'dnc', 're', 'nre'],
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'],
  boolean: ['eq', 'neq'],
  date: ['eq', 'bf', 'af'],
  array: ['c', 'dnc'],
};

/** `session` properties come from identify calls; `event` properties come from custom events. */
export type PropertyScope = 'session' | 'event';
export type PropertyFilter = {
  scope: PropertyScope;
  name: string;
  dataType: PropertyDataType;
  operator: string;
  value: string;
};

/**
 * Filters applied to a report. Wire format (console and Umami alike): `path=c./blog`, a second filter on the same
 * dimension as `path1=...`, `match=any`, `segment=<id>`, `cohort=<id>`, `spf0=1.eq.plan.pro`, `epf0=...`.
 */
export type ReportFilters = {
  rules?: FilterRule[];
  /** `any` makes the dimension rules OR together; property filters always combine with AND. */
  match?: 'all' | 'any';
  segment?: string;
  cohort?: string;
  properties?: PropertyFilter[];
};

const dimensionKeys = new Set<string>(FILTER_DIMENSIONS);
const operatorPrefix = /^(eq|neq|s|ns|c|dnc|re|nre|t|f|gt|lt|gte|lte|bf|af)\.([\s\S]*)$/;
const dimensionOperatorSet = new Set<string>(SEGMENT_DIMENSION_OPERATORS);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const propertyKey = /^(spf|epf)(\d+)$/;

export function hasFilters(filters?: ReportFilters | null): boolean {
  return Boolean(filters && (filters.rules?.length || filters.segment || filters.cohort || filters.properties?.length));
}

/**
 * The filter a clicked report row produces: `is <value>`. Umami splits `is` values on commas, so a value that contains
 * one is matched with an anchored regular expression instead (case-insensitive there, as Umami's regex operator is).
 */
export function equalityRule(dimension: FilterDimension, value: string): FilterRule {
  if (!value.includes(',')) return { dimension, operator: 'eq', values: [value] };
  return { dimension, operator: 're', values: [`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`] };
}

function checkValue(value: string, label: string) {
  if (!value) throw new RangeError(`Enter a value for the ${label} filter.`);
  if (value.length > ANALYTICS_LIMITS.filterValueLength) {
    throw new RangeError(`Filter values can be at most ${ANALYTICS_LIMITS.filterValueLength} characters.`);
  }
  if (/[\r\n]/.test(value)) throw new RangeError('Filter values cannot contain line breaks.');
}

function checkRegex(value: string) {
  try {
    new RegExp(value);
  } catch {
    throw new RangeError(`"${value}" is not a valid regular expression.`);
  }
}

function encodePropertyName(name: string) {
  return encodeURIComponent(name).replaceAll('.', '%2E');
}

function decodePropertyName(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function checkPropertyFilter(filter: PropertyFilter) {
  if (!filter.name.trim()) throw new RangeError('Enter a property name.');
  if (filter.name.length > 200) throw new RangeError('Property names can be at most 200 characters.');
  if (!PROPERTY_OPERATORS[filter.dataType]?.includes(filter.operator)) {
    throw new RangeError(`"${operatorLabel(filter.operator)}" cannot be used on ${filter.dataType} properties.`);
  }
  const { value } = filter;
  if (filter.dataType === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value)) throw new RangeError('Enter a number for this property.');
  if (filter.dataType === 'boolean' && value !== 'true' && value !== 'false') throw new RangeError('Choose true or false for this property.');
  if (filter.dataType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Enter a date as YYYY-MM-DD.');
  if (filter.dataType === 'string' || filter.dataType === 'array') checkValue(value, filter.name);
  if (filter.dataType === 'string' && (filter.operator === 'eq' || filter.operator === 'neq') && value.includes(',')) {
    throw new RangeError('The analytics engine reads commas as separate values; use "contains" for text with a comma.');
  }
  if (filter.dataType === 'string' && (filter.operator === 're' || filter.operator === 'nre')) checkRegex(value);
}

/**
 * Query parameters Umami 3.5.0 reads for these filters. Operators are always written out (`eq.GB`), so a value that
 * happens to start with `c.` is never mistaken for an operator. Throws RangeError for anything the engine would ignore
 * or reject, so a report never looks filtered when it is not.
 */
export function filterQueryParams(filters?: ReportFilters | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!filters) return out;
  const rules = filters.rules ?? [];
  if (rules.length > ANALYTICS_LIMITS.filterRules) throw new RangeError(`Use at most ${ANALYTICS_LIMITS.filterRules} filters.`);
  const seen: Record<string, number> = {};
  for (const rule of rules) {
    if ((UNFILTERABLE_DIMENSIONS as readonly string[]).includes(rule.dimension)) {
      throw new RangeError(`The analytics engine cannot filter by ${rule.dimension}. Remove that filter.`);
    }
    if (!dimensionKeys.has(rule.dimension)) throw new RangeError(`Unknown filter "${rule.dimension}".`);
    if (!dimensionOperatorSet.has(rule.operator)) {
      throw new RangeError(`"${operatorLabel(rule.operator)}" cannot be used on ${rule.dimension} filters.`);
    }
    const values = rule.values.map(value => value.trim()).filter(Boolean);
    if (!values.length) throw new RangeError(`Enter a value for the ${FILTER_DIMENSION_LABELS[rule.dimension]} filter.`);
    const multiple = rule.operator === 'eq' || rule.operator === 'neq';
    if (!multiple && values.length > 1) throw new RangeError(`"${operatorLabel(rule.operator)}" takes a single value.`);
    if (values.length > ANALYTICS_LIMITS.filterValues) throw new RangeError(`Use at most ${ANALYTICS_LIMITS.filterValues} values per filter.`);
    for (const value of values) {
      checkValue(value, FILTER_DIMENSION_LABELS[rule.dimension]);
      if (multiple && value.includes(',')) {
        throw new RangeError('The analytics engine reads commas as separate values; use "contains" for text with a comma.');
      }
      if (rule.operator === 're' || rule.operator === 'nre') checkRegex(value);
    }
    const count = seen[rule.dimension] ?? 0;
    seen[rule.dimension] = count + 1;
    out[count ? `${rule.dimension}${count}` : rule.dimension] = `${rule.operator}.${values.join(',')}`;
  }
  if (filters.match === 'any') out.match = 'any';
  for (const key of ['segment', 'cohort'] as const) {
    const id = filters[key]?.trim();
    if (!id) continue;
    if (!idPattern.test(id)) throw new RangeError(`Choose a saved ${key} from the list.`);
    out[key] = id;
  }
  const properties = filters.properties ?? [];
  if (properties.length > ANALYTICS_LIMITS.propertyFilters) {
    throw new RangeError(`Use at most ${ANALYTICS_LIMITS.propertyFilters} property filters.`);
  }
  const counts = { session: 0, event: 0 };
  for (const property of properties) {
    checkPropertyFilter(property);
    const index = counts[property.scope]++;
    out[`${property.scope === 'session' ? 'spf' : 'epf'}${index}`] =
      `${PROPERTY_DATA_TYPE_CODES[property.dataType]}.${property.operator}.${encodePropertyName(property.name.trim())}.${property.value}`;
  }
  return out;
}

/** Reads filters back from request parameters written by `filterQueryParams` (or typed by hand). */
export function parseFilterParams(entries: Iterable<[string, string]>): ReportFilters | undefined {
  const filters: ReportFilters = {};
  const rules: FilterRule[] = [];
  const properties: PropertyFilter[] = [];
  for (const [key, raw] of entries) {
    const value = raw ?? '';
    if (key === 'match') {
      if (!value) continue;
      if (value !== 'all' && value !== 'any') throw new RangeError('Match must be "all" or "any".');
      if (value === 'any') filters.match = 'any';
      continue;
    }
    if (key === 'segment' || key === 'cohort') {
      if (!value.trim()) continue;
      if (!idPattern.test(value.trim())) throw new RangeError(`Choose a saved ${key} from the list.`);
      filters[key] = value.trim();
      continue;
    }
    const property = propertyKey.exec(key);
    if (property) {
      const parts = /^(\d+)\.([^.]+)\.([^.]+)\.([\s\S]*)$/.exec(value);
      const dataType = (Object.keys(PROPERTY_DATA_TYPE_CODES) as PropertyDataType[])
        .find(name => parts && PROPERTY_DATA_TYPE_CODES[name] === Number(parts[1]));
      if (!parts || !dataType) throw new RangeError('A property filter is not in a form the analytics engine reads.');
      properties.push({
        scope: property[1] === 'spf' ? 'session' : 'event',
        name: decodePropertyName(parts[3]),
        dataType,
        operator: parts[2],
        value: parts[4],
      });
      continue;
    }
    const base = key.replace(/\d+$/, '');
    if ((UNFILTERABLE_DIMENSIONS as readonly string[]).includes(base)) {
      if (value.trim()) throw new RangeError(`The analytics engine cannot filter by ${base}.`);
      continue;
    }
    if (!dimensionKeys.has(base) || !value.trim()) continue;
    const dimension = base as FilterDimension;
    const prefixed = operatorPrefix.exec(value);
    const operator = prefixed ? prefixed[1] : 'eq';
    const rest = prefixed ? prefixed[2] : value;
    if (!dimensionOperatorSet.has(operator)) {
      throw new RangeError(`"${operatorLabel(operator)}" cannot be used on ${FILTER_DIMENSION_LABELS[dimension]} filters. Use is, is not, contains, does not contain or a regular expression.`);
    }
    const multiple = operator === 'eq' || operator === 'neq';
    const values = multiple ? rest.split(',').map(item => item.trim()).filter(Boolean) : [rest.trim()].filter(Boolean);
    if (!values.length) continue;
    rules.push({ dimension, operator: operator as DimensionOperator, values });
  }
  if (rules.length) filters.rules = rules;
  if (properties.length) filters.properties = properties;
  if (!hasFilters(filters)) return undefined;
  // Validate the same way an outgoing request is, so limits and bad values fail here with a plain message.
  filterQueryParams(filters);
  return filters;
}

const listJoin = (values: string[]) => values.join(' or ');

/** "Path contains /blog", "Country is GB or US". */
export function describeFilterRule(rule: FilterRule): string {
  return `${FILTER_DIMENSION_LABELS[rule.dimension] ?? rule.dimension} ${operatorLabel(rule.operator)} ${listJoin(rule.values)}`;
}

export function describePropertyFilter(filter: PropertyFilter): string {
  return `${filter.scope === 'session' ? 'Session' : 'Event'} property ${filter.name} ${operatorLabel(filter.operator)} ${filter.value}`;
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
  /** Set when a lookback window widened the date range sent to the analytics engine (ANA-08). */
  lookbackDays?: number;
  /** The first moment the engine searched for earlier visits (the range start minus the lookback). */
  searchedFrom?: number;
  /** Revenue recorded in the range under the same filters, when the site records revenue (ANA-08). */
  revenue?: { currency: string; sum: number; count: number } | null;
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
  /** Session property filters saved with the segment (Umami segmentParamSchema.sessionPropertyFilters). */
  sessionPropertyFilters?: PropertyFilter[];
  createdAt: string | null;
};

export type WebsiteSegmentInput = {
  name: string;
  type: 'segment' | 'cohort';
  filters?: WebsiteSegmentFilter[];
  match?: 'all' | 'any';
  dateRange?: string;
  action?: { type: 'path' | 'event'; value: string };
  sessionPropertyFilters?: PropertyFilter[];
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
  /** Umami DATA_TYPE code (1 text, 2 number, 3 true/false, 4 date, 5 list) when the engine reports it. */
  dataType?: number;
  total: number;
};

export type SessionPropertyEntry = {
  propertyName: string;
  value: string;
  dataType: number;
};

/* ── ANA-05: tracking snippet options and consent ─────────────────────────── */

export type SnippetOptions = {
  domains: string[];
  doNotTrack: boolean;
  excludeSearch: boolean;
  excludeHash: boolean;
  tag: string;
  /** Turn off to stop automatic page views and clicks; the site then calls umami.track itself. */
  autoTrack: boolean;
  hostUrl: string;
  /** Name of a global function the tracker calls before each send. */
  beforeSend: string;
  performance: boolean;
  /** Load nothing until the site calls ovelioConsent.grant(). */
  consentMode: boolean;
};

export const DEFAULT_SNIPPET_OPTIONS: SnippetOptions = {
  domains: [], doNotTrack: false, excludeSearch: false, excludeHash: false, tag: '', autoTrack: true,
  hostUrl: '', beforeSend: '', performance: false, consentMode: false,
};

export type SnippetPreferences = { websiteId: string; options: SnippetOptions; updatedAt: string | null };

/* ── ANA-07: channel rules ────────────────────────────────────────────────── */

export const CHANNEL_FIELDS = ['referrer', 'utmSource', 'utmMedium', 'query'] as const;
export type ChannelField = (typeof CHANNEL_FIELDS)[number];
export const CHANNEL_OPERATORS = ['contains', 'equals', 'present', 'absent'] as const;
export type ChannelOperator = (typeof CHANNEL_OPERATORS)[number];

export type ChannelCondition = { field: ChannelField; operator: ChannelOperator; values: string[] };
/** Every condition must match (AND). Values inside one condition match if any of them does (OR). */
export type ChannelRule = { id?: string; name: string; channel: string; conditions: ChannelCondition[] };
export type ChannelVisit = { referrer?: string; utmSource?: string; utmMedium?: string; query?: string };
export type ChannelRow = { channel: string; visits: number; visitors: number; share: number };
export type ChannelReport = {
  rows: ChannelRow[];
  /** Sources that matched no rule, shown as "Unclassified". */
  total: number;
  precision: 'breakdown';
  truncated: boolean;
};

/* ── ANA-08: revenue by UTM ───────────────────────────────────────────────── */

export type RevenueUtmDimension = 'utmSource' | 'utmMedium' | 'utmCampaign';
export type RevenueUtmRow = { name: string; sum: number; count: number };
export type RevenueUtmReport = { currency: string; dimension: RevenueUtmDimension; rows: RevenueUtmRow[]; truncated: boolean };

/* ── ANA-10: server-side events API ───────────────────────────────────────── */

export type ApiKeySummary = {
  id: string; name: string; prefix: string; rateLimitPerMinute: number;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
};
export type CreatedApiKey = ApiKeySummary & { key: string };
