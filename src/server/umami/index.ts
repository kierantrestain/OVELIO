import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  ANALYTICS_LIMITS, FILTER_DIMENSIONS, PROPERTY_DATA_TYPE_CODES, UNFILTERABLE_DIMENSIONS,
  filterQueryParams, hasFilters, normalizeSegmentOperator,
} from '@/contracts/analytics';
import type {
  Annotation,
  AnnotationInput,
  AttributionResult,
  BreakdownRow,
  DateRange,
  EntityChartSeries,
  EventPropertyStat,
  EventPropertyValue,
  ExpandedMetricRow,
  FunnelResult,
  FunnelStep,
  Goal,
  GoalInput,
  GoalStats,
  Health,
  JourneyPath,
  Page,
  PerformanceBreakdownType,
  PerformanceMetricKey,
  PerformanceMetricRow,
  PerformancePercentiles,
  PerformanceReport,
  PerformanceStats,
  Point,
  PropertyDataType,
  PropertyFilter,
  RealtimeEvent,
  RealtimeReport,
  ReportDimension,
  ReportFilters,
  RetentionRow,
  RevenueMetricRow,
  RevenueMetricType,
  RevenueReport,
  RevenueStats,
  SavedFunnel,
  SavedFunnelInput,
  SessionActivityItem,
  SessionPropertyEntry,
  SessionPropertyStat,
  SessionStats,
  TrackedLink,
  TrackedLinkInput,
  TrackedLinkUpdateInput,
  TrackingPixel,
  TrackingPixelInput,
  TrackingPixelUpdateInput,
  Traffic,
  Website,
  WebsiteEventRow,
  WebsiteReport,
  WebsiteSegment,
  WebsiteSegmentInput,
  WebsiteSession,
  WebsiteShare,
  WeeklyTraffic,
} from '../../contracts';
import { UpstreamError, upstream } from '../upstream';

const uid = z.uuid();
const count = z.number().int().nonnegative();
const intCount = z.union([count, z.string().regex(/^\d+$/).transform(Number)]).pipe(count);
const finiteNumber = z
  .union([z.number().finite(), z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).transform(Number)])
  .pipe(z.number().finite());
const nullableFinite = z.union([finiteNumber, z.null()]).transform(value => value ?? 0);
const coercedNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform(value => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  });
const nullableText = z.string().nullable().optional().transform(value => value ?? null);

const websiteSchema = z.object({ id: uid, name: z.string(), domain: z.string() });
const shareSchema = z.object({ id: uid, name: z.string(), slug: z.string() });
const trafficSchema = z.object({
  pageviews: count,
  visitors: count,
  visits: count,
  bounces: count,
  totaltime: count.optional(),
});
const metricRow = z.object({ x: z.string().nullable(), y: count });
const timeSeries = z.object({ x: z.string(), y: count }).array();
const seriesSchema = z.object({ pageviews: timeSeries, sessions: timeSeries });
const statsSchema = trafficSchema.extend({ comparison: trafficSchema });
const activeSchema = z.union([
  z.object({ visitors: intCount }).transform(({ visitors }) => visitors),
  z.object({ x: intCount }).transform(({ x }) => x),
]);
const eventSeriesRow = z.union([
  z.object({ x: z.string().nullable(), t: z.string(), y: intCount }),
  z.object({ x: z.string(), y: intCount }),
]);
const utmSchema = z.object({ utm: z.string(), views: count }).array();
const stepSchema = z.object({ type: z.enum(['event', 'path']), value: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength) });
const funnelSchema = stepSchema.extend({ visitors: count }).array();
const goalSchema = z.object({ id: uid, name: z.string(), parameters: stepSchema });
const goalStatsSchema = z.object({ num: count, total: count });
const savedFunnelSchema = z.object({
  id: uid,
  name: z.string(),
  description: z.string().nullable().optional(),
  parameters: z.object({
    window: intCount.refine(value => value > 0),
    steps: stepSchema.array(),
  }),
});
const loginSchema = z.object({ token: z.string().min(1) });

function pointCollection(emptyLabel = 'Unknown') {
  return z.union([
    z.record(z.string(), intCount).transform(record =>
      Object.entries(record)
        .map(([label, value]) => ({ label: label || emptyLabel, value }))
        .sort((a, b) => b.value - a.value),
    ),
    z.array(z.union([
      z.object({ label: z.string(), value: intCount }),
      z.object({ x: z.string().nullable(), y: intCount }).transform(({ x, y }) => ({
        label: x || emptyLabel,
        value: y,
      })),
    ])),
  ]);
}

const realtimeEventSchema = z.object({
  __type: z.string().optional(),
  type: z.string().optional(),
  urlPath: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  eventName: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  browser: z.string().nullable().optional(),
  device: z.string().nullable().optional(),
  createdAt: z.string(),
}).transform((item): RealtimeEvent => ({
  type: item.__type ?? item.type ?? (item.eventName ? 'event' : 'pageview'),
  path: item.urlPath ?? item.path ?? '',
  eventName: item.eventName ?? null,
  country: item.country ?? null,
  browser: item.browser ?? null,
  device: item.device ?? null,
  createdAt: item.createdAt,
}));

const realtimeSeriesSchema = z.union([
  z.object({
    views: timeSeries.optional(),
    visitors: timeSeries.optional(),
  }).transform(({ views, visitors }) => mapSeries(views ?? visitors ?? [])),
  z.array(z.union([
    z.object({ label: z.string(), value: intCount }),
    z.object({ x: z.string(), y: intCount }).transform(({ x, y }) => ({ label: x, value: y })),
  ])),
]);

const realtimeSchema = z.object({
  countries: pointCollection().optional().default([]),
  urls: pointCollection().optional().default([]),
  referrers: pointCollection('Direct').optional().default([]),
  events: realtimeEventSchema.array().optional().default([]),
  series: realtimeSeriesSchema.optional().default([]),
  totals: z.object({
    views: intCount.optional(),
    pageviews: intCount.optional(),
    visitors: intCount.optional().default(0),
    events: intCount.optional().default(0),
    countries: intCount.optional(),
  }),
}).transform((data): RealtimeReport => ({
  visitors: data.totals.visitors,
  pageviews: data.totals.views ?? data.totals.pageviews ?? 0,
  events: data.totals.events,
  countries: data.countries,
  urls: data.urls,
  referrers: data.referrers,
  series: data.series,
  recent: data.events,
}));

const sessionSchema = z.object({
  id: uid,
  hostname: nullableText,
  browser: nullableText,
  os: nullableText,
  device: nullableText,
  screen: nullableText,
  language: nullableText,
  country: nullableText,
  region: nullableText,
  city: nullableText,
  firstAt: z.string(),
  lastAt: z.string(),
  visits: intCount,
  views: intCount,
  events: intCount,
});

const sessionsPageSchema = z.object({
  data: sessionSchema.array(),
  count: intCount,
  page: intCount.optional(),
  pageSize: intCount.optional(),
});

const sessionActivitySchema = z.object({
  id: z.string().optional(),
  eventId: z.string().optional(),
  createdAt: z.string(),
  urlPath: nullableText,
  urlQuery: nullableText,
  referrerDomain: nullableText,
  eventName: nullableText,
  eventType: intCount,
  pageTitle: nullableText,
}).refine(row => Boolean(row.id || row.eventId), 'Missing activity event identifier').transform((row): SessionActivityItem => ({
  id: row.id ?? row.eventId ?? '',
  createdAt: row.createdAt,
  urlPath: row.urlPath,
  urlQuery: row.urlQuery,
  referrerDomain: row.referrerDomain,
  eventName: row.eventName,
  eventType: row.eventType,
  pageTitle: row.pageTitle,
}));

const weeklyTrafficSchema = z.array(z.array(intCount).length(24)).length(7);

const eventPropertySchema = z.object({
  eventName: z.string(),
  propertyName: z.string(),
  total: intCount,
});

const eventPropertyValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().transform(value => (value == null ? '' : String(value))),
  total: intCount,
});

const retentionRowSchema = z.object({
  date: z.string(),
  day: intCount,
  visitors: intCount,
  returnVisitors: intCount,
  percentage: finiteNumber,
});

const journeyPathSchema = z.object({
  items: z.array(z.string().nullable()).transform(list => list.filter((item): item is string => Boolean(item))),
  count: intCount,
});

function attributionPoint(emptyLabel = 'Unknown') {
  return z.union([
    z.object({ name: z.string().nullable(), value: intCount }).transform(({ name, value }): Point => ({
      label: name || emptyLabel,
      value,
    })),
    z.object({ label: z.string(), value: intCount }),
    z.object({ x: z.string().nullable(), y: intCount }).transform(({ x, y }): Point => ({
      label: x || emptyLabel,
      value: y,
    })),
  ]);
}

const attributionSchema = z.object({
  referrer: attributionPoint('Direct').array().optional().default([]),
  paidAds: attributionPoint().array().optional().default([]),
  utm_source: attributionPoint().array().optional(),
  utmSource: attributionPoint().array().optional(),
  utm_medium: attributionPoint().array().optional(),
  utmMedium: attributionPoint().array().optional(),
  utm_campaign: attributionPoint().array().optional(),
  utmCampaign: attributionPoint().array().optional(),
  utm_content: attributionPoint().array().optional(),
  utmContent: attributionPoint().array().optional(),
  utm_term: attributionPoint().array().optional(),
  utmTerm: attributionPoint().array().optional(),
  total: z.object({
    pageviews: intCount,
    visitors: intCount,
    visits: intCount,
  }),
}).transform((data): AttributionResult => ({
  referrer: data.referrer,
  paidAds: data.paidAds,
  utmSource: data.utmSource ?? data.utm_source ?? [],
  utmMedium: data.utmMedium ?? data.utm_medium ?? [],
  utmCampaign: data.utmCampaign ?? data.utm_campaign ?? [],
  utmContent: data.utmContent ?? data.utm_content ?? [],
  utmTerm: data.utmTerm ?? data.utm_term ?? [],
  total: data.total,
}));

const breakdownRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

const annotationSchema = z.object({
  id: uid,
  date: z.string(),
  allDay: z.boolean().optional().default(true),
  note: z.string(),
});

const trackedLinkSchema = z.object({
  id: uid,
  name: z.string(),
  url: z.string(),
  slug: z.string(),
  createdAt: nullableText,
});

const trackingPixelSchema = z.object({
  id: uid,
  name: z.string(),
  slug: z.string(),
  createdAt: nullableText,
});

const floatChartRow = z.union([
  z.object({ x: z.string().nullable(), t: z.string(), y: nullableFinite }).transform(({ t, y }): Point => ({
    label: t,
    value: y,
  })),
  z.object({ x: z.string(), y: nullableFinite }).transform(({ x, y }): Point => ({
    label: x,
    value: y,
  })),
  z.object({ label: z.string(), value: nullableFinite }),
]);

const revenueChartSchema = z.union([
  z.object({ chart: floatChartRow.array() }).transform(({ chart }) => chart),
  floatChartRow.array(),
]);

const performanceChartRow = z.union([
  floatChartRow,
  z
    .object({
      x: z.string().optional(),
      t: z.string().optional(),
      p50: nullableFinite.optional(),
      p75: nullableFinite.optional(),
      p95: nullableFinite.optional(),
    })
    .refine(
      row => Boolean(row.t || row.x) && (row.p75 !== undefined || row.p50 !== undefined || row.p95 !== undefined),
      'Invalid performance chart row',
    )
    .transform((row): Point => ({
      label: row.t ?? row.x ?? '',
      value: row.p75 ?? row.p50 ?? row.p95 ?? 0,
    })),
]);

const performanceChartSchema = z.union([
  z.object({ chart: performanceChartRow.array() }).transform(({ chart }) => chart),
  performanceChartRow.array(),
]);

const entityChartBucketSchema = z
  .object({
    values: nullableFinite.array(),
    total: nullableFinite.optional(),
  })
  .transform(({ values }): Point[] => values.map((value, index) => ({ label: `#${index + 1}`, value })));

const entityChartMapSchema = z.record(z.string(), z.union([floatChartRow.array(), entityChartBucketSchema]));
const entityChartSeriesSchema = z.union([
  z.object({ data: entityChartMapSchema }).transform(({ data }) => data),
  entityChartMapSchema,
]);

const websiteSegmentTypeSchema = z.enum(['segment', 'cohort']);
const websiteSegmentMatchSchema = z.enum(['all', 'any']);
const websiteSegmentFilterSchema = z.object({
  name: z.string(),
  operator: z.string(),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .nullable()
    .optional()
    .transform(value => (value == null ? '' : String(value))),
});
const websiteSegmentDateRangeSchema = z
  .union([
    z.string(),
    z.object({ value: z.string() }).transform(({ value }) => value),
    z.object({ type: z.string() }).transform(({ type }) => type),
  ])
  .nullable()
  .optional();
const websiteSegmentActionSchema = z
  .object({
    type: z.enum(['path', 'event']),
    value: z.string(),
  })
  .nullable()
  .optional();

const propertyDataTypeNames = Object.fromEntries(
  Object.entries(PROPERTY_DATA_TYPE_CODES).map(([name, code]) => [code, name]),
) as Record<number, PropertyDataType>;

/** Umami stores a segment's property filters as { propertyName, dataType: code, operator, value }. */
const storedPropertyFilterSchema = z
  .object({
    propertyName: z.string(),
    dataType: z.number().int().refine(code => code in propertyDataTypeNames),
    operator: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
  })
  .transform((row): PropertyFilter => ({
    scope: 'session',
    name: row.propertyName,
    dataType: propertyDataTypeNames[row.dataType],
    operator: row.operator,
    value: row.value,
  }));

const websiteSegmentSchema = z
  .object({
    id: uid,
    name: z.string(),
    type: websiteSegmentTypeSchema,
    parameters: z
      .object({
        filters: websiteSegmentFilterSchema.array().nullable().optional(),
        match: websiteSegmentMatchSchema.nullable().optional(),
        dateRange: websiteSegmentDateRangeSchema,
        action: websiteSegmentActionSchema,
        sessionPropertyFilters: storedPropertyFilterSchema.array().nullable().optional(),
      })
      .nullable()
      .optional(),
    createdAt: nullableText,
  })
  .transform((segment): WebsiteSegment => ({
    id: segment.id,
    name: segment.name,
    type: segment.type,
    filters: (segment.parameters?.filters ?? []).map(rule => ({ ...rule, operator: normalizeSegmentOperator(rule.operator) })),
    ...(segment.parameters?.match ? { match: segment.parameters.match } : {}),
    ...(segment.parameters?.dateRange ? { dateRange: segment.parameters.dateRange } : {}),
    ...(segment.parameters?.action ? { action: segment.parameters.action } : {}),
    ...(segment.parameters?.sessionPropertyFilters?.length
      ? { sessionPropertyFilters: segment.parameters.sessionPropertyFilters }
      : {}),
    createdAt: segment.createdAt,
  }));

const revenueStatsFields = {
  sum: nullableFinite,
  count: nullableFinite,
  unique_count: nullableFinite.optional(),
  uniqueCount: nullableFinite.optional(),
  total_sessions: nullableFinite.optional(),
  totalSessions: nullableFinite.optional(),
  average: nullableFinite.optional(),
  arpu: nullableFinite.optional(),
};

function mapRevenueStats(row: {
  sum: number;
  count: number;
  unique_count?: number;
  uniqueCount?: number;
  total_sessions?: number;
  totalSessions?: number;
  average?: number;
  arpu?: number;
}): RevenueStats {
  return {
    sum: row.sum,
    count: row.count,
    uniqueCount: row.uniqueCount ?? row.unique_count ?? 0,
    totalSessions: row.totalSessions ?? row.total_sessions ?? 0,
    average: row.average ?? 0,
    arpu: row.arpu ?? 0,
  };
}

const revenueComparisonSchema = z.object(revenueStatsFields).transform(mapRevenueStats);
const revenueStatsResponseSchema = z
  .object({
    ...revenueStatsFields,
    comparison: revenueComparisonSchema.nullable().optional(),
  })
  .transform(row => ({
    stats: mapRevenueStats(row),
    comparison: row.comparison ?? null,
  }));

function revenueMetricRowsSchema(emptyLabel: string) {
  const rowSchema = z.union([
    z
      .object({
        name: z.string().nullable(),
        sum: nullableFinite,
        count: nullableFinite.optional().default(0),
      })
      .transform((row): RevenueMetricRow => ({
        name: row.name || emptyLabel,
        sum: row.sum,
        count: row.count,
      })),
    z
      .object({
        x: z.string().nullable(),
        sum: nullableFinite.optional(),
        y: nullableFinite.optional(),
        count: nullableFinite.optional().default(0),
      })
      .refine(row => row.sum !== undefined || row.y !== undefined, 'Missing revenue metric sum')
      .transform((row): RevenueMetricRow => ({
        name: row.x || emptyLabel,
        sum: row.sum ?? row.y ?? 0,
        count: row.count,
      })),
  ]);
  return z.union([rowSchema.array(), z.object({ data: rowSchema.array() }).transform(({ data }) => data)]);
}

const zeroPercentiles: PerformancePercentiles = { p50: 0, p75: 0, p95: 0 };

const performancePercentilesSchema = z
  .object({
    p50: nullableFinite.optional().default(0),
    p75: nullableFinite.optional().default(0),
    p95: nullableFinite.optional().default(0),
  })
  .nullable()
  .optional()
  .transform((value): PerformancePercentiles => value ?? { ...zeroPercentiles });

const performanceStatsSchema: z.ZodType<PerformanceStats> = z.object({
  lcp: performancePercentilesSchema,
  inp: performancePercentilesSchema,
  cls: performancePercentilesSchema,
  fcp: performancePercentilesSchema,
  ttfb: performancePercentilesSchema,
  count: nullableFinite,
});

const performanceMetricRowSchema = z
  .object({
    name: z.string().nullable().optional(),
    x: z.string().nullable().optional(),
    count: nullableFinite,
    p50: nullableFinite,
    p75: nullableFinite,
    p95: nullableFinite,
  })
  .refine(row => row.name !== undefined || row.x !== undefined, 'Missing performance metric label')
  .transform((row): PerformanceMetricRow => ({
    name: row.name || row.x || 'Unknown',
    count: row.count,
    p50: row.p50,
    p75: row.p75,
    p95: row.p95,
  }));

const performanceMetricsResponseSchema = z.union([
  performanceMetricRowSchema.array(),
  z.object({ data: performanceMetricRowSchema.array() }).transform(({ data }) => data),
]);

function expandedMetricRowsSchema(emptyLabel: string) {
  const rowSchema = z
    .object({
      name: z.string().nullable().optional(),
      x: z.string().nullable().optional(),
      pageviews: coercedNumber,
      visitors: coercedNumber,
      visits: coercedNumber,
      bounces: coercedNumber,
      totaltime: coercedNumber,
    })
    .refine(row => row.name !== undefined || row.x !== undefined, 'Missing expanded metric label')
    .transform((row): ExpandedMetricRow => ({
      name: row.name || row.x || emptyLabel,
      pageviews: row.pageviews,
      visitors: row.visitors,
      visits: row.visits,
      bounces: row.bounces,
      totaltime: row.totaltime,
    }));
  return z.union([rowSchema.array(), z.object({ data: rowSchema.array() }).transform(({ data }) => data)]);
}

const websiteEventRowSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    urlPath: z.string().nullable().optional().transform(value => value ?? ''),
    pageTitle: nullableText,
    eventName: nullableText,
    eventType: intCount,
    referrerDomain: nullableText,
    country: nullableText,
    device: nullableText,
    browser: nullableText,
    createdAt: z.string(),
  })
  .transform((row): WebsiteEventRow => ({
    id: row.id,
    sessionId: row.sessionId,
    urlPath: row.urlPath,
    pageTitle: row.pageTitle,
    eventName: row.eventName,
    eventType: row.eventType,
    referrerDomain: row.referrerDomain,
    country: row.country,
    device: row.device,
    browser: row.browser,
    createdAt: row.createdAt,
  }));

const eventsPageSchema = z.object({
  data: websiteEventRowSchema.array(),
  count: intCount,
  page: intCount.optional(),
  pageSize: intCount.optional(),
});

const statCount = z.union([
  intCount,
  z.object({ value: z.union([intCount, z.null()]).transform(value => value ?? 0) }).transform(({ value }) => value),
  z.null().transform(() => 0),
]);

const sessionStatsSchema: z.ZodType<SessionStats> = z.object({
  pageviews: statCount,
  visitors: statCount,
  visits: statCount,
  countries: statCount,
  events: statCount,
});

const sessionPropertyStatSchema = z.object({
  propertyName: z.string(),
  dataType: intCount.optional(),
  total: intCount,
});

const sessionPropertiesResponseSchema = z.union([
  sessionPropertyStatSchema.array(),
  z.object({ data: sessionPropertyStatSchema.array() }).transform(({ data }) => data),
]);

const scalarValue = z.union([z.string(), z.number(), z.boolean()]).nullable().optional();

const sessionPropertyEntrySchema = z
  .object({
    propertyName: z.string().optional(),
    dataKey: z.string().optional(),
    value: scalarValue,
    stringValue: scalarValue,
    numberValue: scalarValue,
    dateValue: scalarValue,
    dataType: intCount.optional().default(1),
  })
  .refine(row => Boolean(row.propertyName || row.dataKey), 'Missing session property name')
  .transform((row): SessionPropertyEntry => {
    const raw =
      row.value !== undefined
        ? row.value
        : row.dataType === 2
          ? (row.numberValue ?? row.stringValue ?? row.dateValue)
          : row.dataType === 4
            ? (row.dateValue ?? row.stringValue ?? row.numberValue)
            : (row.stringValue ?? row.numberValue ?? row.dateValue);
    return {
      propertyName: row.propertyName ?? row.dataKey ?? '',
      value: raw == null ? '' : String(raw),
      dataType: row.dataType,
    };
  });

const singleSessionPropertiesResponseSchema = z.union([
  sessionPropertyEntrySchema.array(),
  z.object({ data: sessionPropertyEntrySchema.array() }).transform(({ data }) => data),
]);

const service = 'tracking';
const pageSize = 100;
const hour = 60 * 60 * 1000;
const slugAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

const utmDimensions = {
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  utmContent: 'utm_content',
  utmTerm: 'utm_term',
} as const;
type UtmDimension = keyof typeof utmDimensions;

const standardDimensions = [
  'path', 'entry', 'exit', 'title', 'query', 'hostname',
  'referrer', 'channel', 'device', 'browser', 'os', 'screen',
  'country', 'region', 'city', 'language', 'event',
] as const;

const reportDimensions: ReportDimension[] = [
  ...standardDimensions,
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
];

const reportDimensionSchema = z.enum([
  ...standardDimensions,
  'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
]);

const filterValueSchema = z.string().trim().min(1).max(ANALYTICS_LIMITS.filterValueLength);

const websiteInput = z.object({
  name: z.string().trim().min(1).max(100),
  domain: z.string().trim().toLowerCase().max(500).regex(
    /^(?:localhost(?::[1-9]\d{0,4})?|(?:[a-z0-9_-]{1,63}\.)+[a-z0-9_-]{2,63})$/,
    'Use a hostname such as example.com or localhost:3000.',
  ),
});

const shareNameInput = z.string().trim().min(1).max(200);
const goalInput = stepSchema.extend({ name: z.string().trim().min(1).max(200) });

const funnelInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  steps: stepSchema.array().min(2).max(ANALYTICS_LIMITS.funnelSteps),
  windowMinutes: z.number().int().min(1).max(ANALYTICS_LIMITS.funnelWindowMinutes),
});

const sessionOptionsSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

const journeyOptionsSchema = z.object({
  steps: z.number().int().min(2).max(7).default(3),
  startStep: z.string().trim().min(1).max(500).optional(),
  endStep: z.string().trim().min(1).max(500).optional(),
});

const attributionOptionsSchema = z.object({
  model: z.enum(['first-click', 'last-click']),
  type: z.enum(['path', 'event']),
  step: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code.').optional(),
});

const breakdownFieldSchema = z.enum([
  'path', 'referrer', 'title', 'query', 'os', 'browser', 'device',
  'country', 'region', 'city', 'tag', 'hostname', 'distinctId',
  'language', 'event', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
]);
const breakdownFieldsSchema = z.array(breakdownFieldSchema).min(1).max(ANALYTICS_LIMITS.breakdownFields);

const annotationInputSchema = z.object({
  date: z.string().trim().min(1).refine(value => !Number.isNaN(Date.parse(value)), 'Use a valid ISO date.'),
  allDay: z.boolean().optional(),
  note: z.string().trim().min(1).max(500),
});

const slugSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Use 8-100 letters, numbers, hyphens, or underscores.');

const httpUrlSchema = z.string().trim().min(1).max(500).refine(value => {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}, 'Use a valid http or https URL.');

function randomSlug(length = 10): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, byte => slugAlphabet[byte % slugAlphabet.length]).join('');
}

const trackedLinkInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: httpUrlSchema,
  slug: z.string().trim().optional(),
}).transform(({ name, url, slug }) => ({
  name,
  url,
  slug: slug ? slugSchema.parse(slug) : randomSlug(10),
}));

const trackingPixelInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().optional(),
}).transform(({ name, slug }) => ({
  name,
  slug: slug ? slugSchema.parse(slug) : randomSlug(10),
}));

const trackedLinkUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    url: httpUrlSchema.optional(),
    slug: slugSchema.optional(),
  })
  .refine(
    value => value.name !== undefined || value.url !== undefined || value.slug !== undefined,
    'Provide at least one link field to update.',
  );

const trackingPixelUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: slugSchema.optional(),
  })
  .refine(
    value => value.name !== undefined || value.slug !== undefined,
    'Provide at least one pixel field to update.',
  );

const websiteSegmentFilterInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  operator: z.string().trim().min(1).max(50),
  value: z.string().trim().max(500),
});

const websiteSegmentInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: websiteSegmentTypeSchema,
  filters: websiteSegmentFilterInputSchema.array().max(25).optional(),
  match: websiteSegmentMatchSchema.optional(),
  dateRange: z.string().trim().min(1).max(100).optional(),
  action: stepSchema.optional(),
  sessionPropertyFilters: z.object({
    scope: z.literal('session').default('session'),
    name: z.string().trim().min(1).max(200),
    dataType: z.enum(['string', 'number', 'boolean', 'date', 'array']),
    operator: z.string().trim().min(1).max(20),
    value: z.string().max(ANALYTICS_LIMITS.filterValueLength),
  }).array().max(ANALYTICS_LIMITS.propertyFilters).optional(),
});

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code.');

const revenueMetricTypeSchema = z.enum(['country', 'region', 'referrer', 'channel']);
const performanceMetricKeySchema = z.enum(['lcp', 'inp', 'cls', 'fcp', 'ttfb']);
const performanceBreakdownTypeSchema = z.enum(['path', 'title', 'device', 'browser']);
const expandedLimitSchema = z.number().int().min(1).max(500);

export type WebsiteInput = z.input<typeof websiteInput>;

type UmamiConfig = {
  url?: string;
  username?: string;
  password?: string;
  token?: string;
  fetch?: typeof fetch;
};

function queryRange(range: DateRange) {
  if (
    !Number.isSafeInteger(range.startAt) || !Number.isSafeInteger(range.endAt) ||
    range.startAt < 0 || range.endAt <= range.startAt || range.endAt > 8.64e15
  ) {
    throw new RangeError('Choose a valid analytics date range.');
  }

  return { startAt: String(range.startAt), endAt: String(range.endAt), timezone: 'UTC' };
}

function rangeUnit(range: DateRange): 'hour' | 'day' {
  return range.endAt - range.startAt <= 48 * hour ? 'hour' : 'day';
}

/** Umami 3.5.0 filter parameters (`path=c./blog`, `match=any`, `segment=`, `cohort=`, `spf0=`); see filterQueryParams. */
function queryFilters(filters?: ReportFilters): Record<string, string> {
  return filterQueryParams(filters);
}

function websitePath(id: string) {
  return `websites/${uid.parse(id)}`;
}

function getTraffic(data: Traffic): Traffic {
  const { pageviews, visitors, visits, bounces, totaltime } = data;
  return totaltime === undefined
    ? { pageviews, visitors, visits, bounces }
    : { pageviews, visitors, visits, bounces, totaltime };
}

function mapSeries(rows: { x: string; y: number }[]): Point[] {
  return rows.map(({ x, y }) => ({ label: x, value: y }));
}

function mapEventSeries(rows: z.output<typeof eventSeriesRow>[]): Point[] {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const label = 't' in row ? row.t : row.x;
    buckets.set(label, (buckets.get(label) ?? 0) + row.y);
  }
  return [...buckets.entries()].map(([label, value]) => ({ label, value }));
}

function mapGoal(goal: z.output<typeof goalSchema>): Goal {
  return { id: goal.id, name: goal.name, ...goal.parameters };
}

function mapSavedFunnel(funnel: z.output<typeof savedFunnelSchema>): SavedFunnel {
  return {
    id: funnel.id,
    name: funnel.name,
    ...(funnel.description ? { description: funnel.description } : {}),
    steps: funnel.parameters.steps,
    windowMinutes: funnel.parameters.window,
  };
}

function validated<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new UpstreamError(service, 502, 'The tracking service returned an incompatible response.');
  }
  return parsed.data;
}

async function available<T>(operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof UpstreamError) return null;
    throw error;
  }
}

function isUtm(dimension: ReportDimension): dimension is UtmDimension {
  return Object.hasOwn(utmDimensions, dimension);
}

export function createUmami(config: UmamiConfig) {
  let session: Promise<string> | undefined;
  let sessionExpires = 0;

  async function request(path: string, init: RequestInit = {}, query?: Record<string, string>) {
    if (!config.url) {
      throw new UpstreamError(service, 503, 'Configure the tracking service URL in the deployment environment.');
    }

    try {
      const base = new URL(config.url);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error('Invalid service URL');
      }
    } catch {
      throw new UpstreamError(service, 503, 'The tracking service URL is invalid.');
    }

    const suffix = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
    try {
      return await upstream<unknown>(service, config.url.replace(/\/+$/, ''), `/api/${path}${suffix}`, {
        ...init,
        fetch: config.fetch,
      });
    } catch (error) {
      if (error instanceof UpstreamError && [401, 403].includes(error.status)) {
        throw new UpstreamError(service, error.status, 'Check the tracking service credentials and permissions.');
      }
      throw error;
    }
  }

  async function login(): Promise<string> {
    if (!config.username || !config.password) {
      throw new UpstreamError(service, 503, 'Configure a tracking API key or service account credentials.');
    }
    const data = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: config.username, password: config.password }),
    });
    if (typeof data === 'object' && data && 'requiresTwoFactor' in data && data.requiresTwoFactor) {
      throw new UpstreamError(service, 403, 'Use a tracking API key for an account protected by two-factor authentication.');
    }
    return validated(loginSchema, data).token;
  }

  function token() {
    if (config.token) return Promise.resolve(config.token);
    if (session && Date.now() < sessionExpires) return session;
    sessionExpires = Date.now() + 55 * 60 * 1000;
    session = login().catch(error => {
      session = undefined;
      sessionExpires = 0;
      throw error;
    });
    return session;
  }

  async function authorized(path: string, init: RequestInit = {}, query?: Record<string, string>) {
    const current = token();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await current}`);
    try {
      return await request(path, { ...init, headers }, query);
    } catch (error) {
      // Umami rejects an invalid session before executing authenticated handlers.
      if (!(error instanceof UpstreamError) || error.status !== 401 || config.token) throw error;
      if (session === current) {
        session = undefined;
        sessionExpires = 0;
      }
      headers.set('Authorization', `Bearer ${await token()}`);
      return request(path, { ...init, headers }, query);
    }
  }

  async function allPages<T>(path: string, item: z.ZodType<T>, extraQuery?: Record<string, string>): Promise<T[]> {
    const schema = z.union([z.object({ data: item.array(), count: intCount.optional() }), item.array()]);
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const result = validated(
        schema,
        await authorized(path, {}, { ...extraQuery, page: String(page), pageSize: String(pageSize) }),
      );
      if (Array.isArray(result)) return result;
      items.push(...result.data);
      if (!result.data.length || result.count === undefined || items.length >= result.count) return items;
    }
  }

  async function entityCharts(kind: 'links' | 'pixels', ids: string[], range?: DateRange): Promise<EntityChartSeries> {
    const rangeQuery = range ? queryRange(range) : {};
    const parsedIds = [...new Set(ids.map(id => uid.parse(id)))];
    if (!parsedIds.length) return {};
    const result = await authorized(`${kind}/charts`, {}, {
      ids: parsedIds.join(','),
      ...rangeQuery,
    });
    return validated(entityChartSeriesSchema, result);
  }

  async function dimensionData(path: string, dimension: ReportDimension, query: Record<string, string>) {
    const validatedDimension = reportDimensionSchema.parse(dimension);
    if (isUtm(validatedDimension)) {
      const result = await authorized(`${path}/utm/metrics`, {}, { ...query, type: utmDimensions[validatedDimension] });
      return validated(utmSchema, result).map(({ utm, views }) => ({ label: utm, value: views }));
    }
    const result = await authorized(`${path}/metrics`, {}, { ...query, type: validatedDimension, limit: '20' });
    return validated(metricRow.array(), result).map(({ x, y }) => ({
      label: x || (validatedDimension === 'referrer' ? 'Direct' : 'Unknown'),
      value: y,
    }));
  }

  return {
    async health(): Promise<Health> {
      try {
        const data = await authorized('websites', {}, { page: '1', pageSize: '1' });
        validated(z.object({ data: websiteSchema.array() }), data);
        return { status: 'ready' };
      } catch (error) {
        return {
          status: 'unavailable',
          message: error instanceof UpstreamError ? error.message : 'Check the tracking service connection.',
        };
      }
    },

    websites(): Promise<Website[]> {
      return allPages('websites', websiteSchema);
    },

    async createWebsite(input: WebsiteInput): Promise<Website> {
      return validated(websiteSchema, await authorized('websites', {
        method: 'POST',
        body: JSON.stringify(websiteInput.parse(input)),
      }));
    },

    async updateWebsite(id: string, input: WebsiteInput): Promise<Website> {
      return validated(websiteSchema, await authorized(websitePath(id), {
        method: 'POST',
        body: JSON.stringify(websiteInput.parse(input)),
      }));
    },

    async deleteWebsite(id: string): Promise<void> {
      await authorized(websitePath(id), { method: 'DELETE' });
    },

    async resetWebsite(id: string): Promise<void> {
      await authorized(`${websitePath(id)}/reset`, { method: 'POST' });
    },

    shares(id: string): Promise<WebsiteShare[]> {
      return allPages(`${websitePath(id)}/shares`, shareSchema);
    },

    async createShare(id: string, name: string): Promise<WebsiteShare> {
      const parsedName = shareNameInput.parse(name);
      return validated(shareSchema, await authorized(`${websitePath(id)}/shares`, {
        method: 'POST',
        body: JSON.stringify({ name: parsedName }),
      }));
    },

    async deleteShare(shareId: string): Promise<void> {
      await authorized(`share/id/${uid.parse(shareId)}`, { method: 'DELETE' });
    },

    async exportWebsite(id: string, range: DateRange): Promise<unknown> {
      return authorized(`${websitePath(id)}/export`, {}, queryRange(range));
    },

    async activeVisitors(id: string): Promise<number> {
      return validated(activeSchema, await authorized(`${websitePath(id)}/active`));
    },

    async report(
      id: string,
      range: DateRange,
      dimensions = reportDimensions,
      filters?: ReportFilters,
    ): Promise<WebsiteReport> {
      const path = websitePath(id);
      const appliedFilters = queryFilters(filters);
      const query = { ...queryRange(range), ...appliedFilters };
      const unit = rangeUnit(range);
      const selectedDimensions = [...new Set(dimensions.map(dimension => reportDimensionSchema.parse(dimension)))];
      const [website, stats, series, active, eventsSeries, dimensionEntries] = await Promise.all([
        authorized(path).then(data => validated(websiteSchema, data)),
        available(authorized(`${path}/stats`, {}, { ...query, compare: 'prev' }).then(data => validated(statsSchema, data))),
        available(authorized(`${path}/pageviews`, {}, { ...query, unit }).then(data => validated(seriesSchema, data))),
        available(authorized(`${path}/active`).then(data => validated(activeSchema, data))),
        available(
          authorized(`${path}/events/series`, {}, { ...query, unit })
            .then(data => mapEventSeries(validated(eventSeriesRow.array(), data))),
        ),
        Promise.all(selectedDimensions.map(async dimension => [
          dimension,
          await available(dimensionData(path, dimension, query)),
        ] as const)),
      ]);

      return {
        website,
        range,
        ...(hasFilters(filters) ? { filters } : {}),
        current: stats ? getTraffic(stats) : null,
        previous: stats ? getTraffic(stats.comparison) : null,
        activeVisitors: active,
        pageviews: series ? mapSeries(series.pageviews) : null,
        visitors: series ? mapSeries(series.sessions) : null,
        eventsSeries,
        dimensions: Object.fromEntries(dimensionEntries),
      };
    },

    async realtime(id: string): Promise<RealtimeReport> {
      return validated(realtimeSchema, await authorized(`realtime/${uid.parse(id)}`));
    },

    async sessions(
      id: string,
      range: DateRange,
      options?: { page?: number; pageSize?: number; search?: string; filters?: ReportFilters },
    ): Promise<Page<WebsiteSession>> {
      const parsedOptions = sessionOptionsSchema.parse({
        page: options?.page,
        pageSize: options?.pageSize,
        search: options?.search,
      });
      const query: Record<string, string> = {
        ...queryRange(range),
        ...queryFilters(options?.filters),
        page: String(parsedOptions.page),
        pageSize: String(parsedOptions.pageSize),
        ...(parsedOptions.search ? { search: parsedOptions.search } : {}),
      };
      const result = validated(sessionsPageSchema, await authorized(`${websitePath(id)}/sessions`, {}, query));
      return {
        items: result.data,
        total: result.count,
        page: result.page ?? parsedOptions.page,
        limit: result.pageSize ?? parsedOptions.pageSize,
      };
    },

    async sessionActivity(id: string, sessionId: string, range: DateRange): Promise<SessionActivityItem[]> {
      const result = await authorized(
        `${websitePath(id)}/sessions/${uid.parse(sessionId)}/activity`,
        {},
        queryRange(range),
      );
      return validated(sessionActivitySchema.array(), result);
    },

    async weeklyTraffic(id: string, range: DateRange, filters?: ReportFilters): Promise<WeeklyTraffic> {
      const result = await authorized(
        `${websitePath(id)}/sessions/weekly`,
        {},
        { ...queryRange(range), ...queryFilters(filters) },
      );
      return validated(weeklyTrafficSchema, result);
    },

    async eventProperties(id: string, range: DateRange, filters?: ReportFilters): Promise<EventPropertyStat[]> {
      const result = await authorized(
        `${websitePath(id)}/event-data/properties`,
        {},
        { ...queryRange(range), ...queryFilters(filters) },
      );
      return validated(eventPropertySchema.array(), result);
    },

    async eventPropertyValues(
      id: string,
      range: DateRange,
      eventName: string,
      propertyName: string,
    ): Promise<EventPropertyValue[]> {
      const parsedProperty = filterValueSchema.parse(propertyName);
      const trimmedEvent = eventName.trim();
      const query: Record<string, string> = {
        ...queryRange(range),
        ...(trimmedEvent ? { event: filterValueSchema.parse(trimmedEvent) } : {}),
        propertyName: parsedProperty,
      };
      const result = await authorized(`${websitePath(id)}/event-data/values`, {}, query);
      return validated(eventPropertyValueSchema.array(), result);
    },

    async funnel(id: string, range: DateRange, steps: FunnelStep[], windowMinutes = 60): Promise<FunnelResult> {
      const path = `${websitePath(id)}/funnels/stats`;
      const input = funnelInput.pick({ steps: true, windowMinutes: true }).parse({ steps, windowMinutes });
      const result = await authorized(path, {}, {
        ...queryRange(range),
        steps: JSON.stringify(input.steps),
        window: String(input.windowMinutes),
      });
      return validated(funnelSchema, result).map(({ value, visitors }) => ({ label: value, visitors }));
    },

    async funnels(id: string): Promise<SavedFunnel[]> {
      return (await allPages(`${websitePath(id)}/funnels`, savedFunnelSchema)).map(mapSavedFunnel);
    },

    async createFunnel(id: string, input: SavedFunnelInput): Promise<SavedFunnel> {
      const parsed = funnelInput.parse(input);
      const result = await authorized(`${websitePath(id)}/funnels`, {
        method: 'POST',
        body: JSON.stringify({
          name: parsed.name,
          ...(parsed.description !== undefined ? { description: parsed.description } : {}),
          parameters: { window: parsed.windowMinutes, steps: parsed.steps },
        }),
      });
      return mapSavedFunnel(validated(savedFunnelSchema, result));
    },

    async updateFunnel(id: string, funnelId: string, input: SavedFunnelInput): Promise<SavedFunnel> {
      const parsed = funnelInput.parse(input);
      const result = await authorized(`${websitePath(id)}/funnels/${uid.parse(funnelId)}`, {
        method: 'POST',
        body: JSON.stringify({
          name: parsed.name,
          ...(parsed.description !== undefined ? { description: parsed.description } : {}),
          parameters: { window: parsed.windowMinutes, steps: parsed.steps },
        }),
      });
      return mapSavedFunnel(validated(savedFunnelSchema, result));
    },

    async deleteFunnel(id: string, funnelId: string): Promise<void> {
      await authorized(`${websitePath(id)}/funnels/${uid.parse(funnelId)}`, { method: 'DELETE' });
    },

    async funnelStats(id: string, funnelId: string, range: DateRange): Promise<FunnelResult> {
      const result = await authorized(
        `${websitePath(id)}/funnels/${uid.parse(funnelId)}/stats`,
        {},
        queryRange(range),
      );
      return validated(funnelSchema, result).map(({ value, visitors }) => ({ label: value, visitors }));
    },

    async goals(id: string): Promise<Goal[]> {
      return (await allPages(`${websitePath(id)}/goals`, goalSchema)).map(mapGoal);
    },

    async createGoal(id: string, input: GoalInput): Promise<Goal> {
      const { name, type, value } = goalInput.parse(input);
      const result = await authorized(`${websitePath(id)}/goals`, {
        method: 'POST',
        body: JSON.stringify({ name, parameters: { type, value } }),
      });
      return mapGoal(validated(goalSchema, result));
    },

    async updateGoal(id: string, goalId: string, input: GoalInput): Promise<Goal> {
      const { name, type, value } = goalInput.parse(input);
      const result = await authorized(`${websitePath(id)}/goals/${uid.parse(goalId)}`, {
        method: 'POST',
        body: JSON.stringify({ name, parameters: { type, value } }),
      });
      return mapGoal(validated(goalSchema, result));
    },

    async deleteGoal(id: string, goalId: string): Promise<void> {
      await authorized(`${websitePath(id)}/goals/${uid.parse(goalId)}`, { method: 'DELETE' });
    },

    async goalStats(id: string, goalId: string, range: DateRange): Promise<GoalStats> {
      const result = await authorized(`${websitePath(id)}/goals/${uid.parse(goalId)}/stats`, {}, queryRange(range));
      const { num, total } = validated(goalStatsSchema, result);
      return { total, unique: num, rate: total > 0 ? num / total : 0 };
    },

    async retention(id: string, range: DateRange, filters?: ReportFilters): Promise<RetentionRow[]> {
      const result = await authorized(
        `${websitePath(id)}/retention`,
        {},
        { ...queryRange(range), ...queryFilters(filters) },
      );
      return validated(retentionRowSchema.array(), result);
    },

    async journeys(
      id: string,
      range: DateRange,
      options?: { steps?: number; startStep?: string; endStep?: string; filters?: ReportFilters },
    ): Promise<JourneyPath[]> {
      const parsedOptions = journeyOptionsSchema.parse({
        steps: options?.steps,
        startStep: options?.startStep,
        endStep: options?.endStep,
      });
      const query: Record<string, string> = {
        ...queryRange(range),
        ...queryFilters(options?.filters),
        steps: String(parsedOptions.steps),
        ...(parsedOptions.startStep ? { startStep: parsedOptions.startStep } : {}),
        ...(parsedOptions.endStep ? { endStep: parsedOptions.endStep } : {}),
      };
      const result = await authorized(`${websitePath(id)}/journeys`, {}, query);
      return validated(journeyPathSchema.array(), result);
    },

    async attribution(
      id: string,
      range: DateRange,
      options: {
        model: 'first-click' | 'last-click';
        type: 'path' | 'event';
        step: string;
        currency?: string;
        filters?: ReportFilters;
      },
    ): Promise<AttributionResult> {
      const parsedOptions = attributionOptionsSchema.parse({
        model: options.model, type: options.type, step: options.step, currency: options.currency,
      });
      const result = await authorized(`${websitePath(id)}/attribution`, {}, {
        ...queryRange(range),
        ...queryFilters(options.filters),
        ...(parsedOptions.currency ? { currency: parsedOptions.currency } : {}),
        model: parsedOptions.model,
        type: parsedOptions.type,
        step: parsedOptions.step,
      });
      return validated(attributionSchema, result);
    },

    async breakdown(
      id: string,
      range: DateRange,
      fields: string[],
      filters?: ReportFilters,
    ): Promise<BreakdownRow[]> {
      const parsedFields = [...new Set(breakdownFieldsSchema.parse(fields))];
      const result = await authorized(`${websitePath(id)}/breakdown`, {}, {
        ...queryRange(range),
        ...queryFilters(filters),
        fields: JSON.stringify(parsedFields),
      });
      return validated(breakdownRowSchema.array(), result);
    },

    annotations(id: string, range?: DateRange): Promise<Annotation[]> {
      return allPages(
        `${websitePath(id)}/annotations`,
        annotationSchema,
        range ? queryRange(range) : undefined,
      );
    },

    async createAnnotation(id: string, input: AnnotationInput): Promise<Annotation> {
      const parsed = annotationInputSchema.parse(input);
      const result = await authorized(`${websitePath(id)}/annotations`, {
        method: 'POST',
        body: JSON.stringify({
          date: parsed.date,
          allDay: parsed.allDay ?? true,
          note: parsed.note,
        }),
      });
      return validated(annotationSchema, result);
    },

    async deleteAnnotation(id: string, annotationId: string): Promise<void> {
      await authorized(`${websitePath(id)}/annotations/${uid.parse(annotationId)}`, { method: 'DELETE' });
    },

    segments(websiteId: string, type: 'segment' | 'cohort' = 'segment'): Promise<WebsiteSegment[]> {
      return allPages(`${websitePath(websiteId)}/segments`, websiteSegmentSchema, {
        type: websiteSegmentTypeSchema.parse(type),
      });
    },

    async createSegment(websiteId: string, input: WebsiteSegmentInput): Promise<WebsiteSegment> {
      const parsed = websiteSegmentInputSchema.parse(input);
      const blocked = parsed.filters?.find(rule => (UNFILTERABLE_DIMENSIONS as readonly string[]).includes(rule.name));
      if (blocked) throw new RangeError(`The analytics engine cannot filter segments by ${blocked.name}.`);
      // Umami keeps only real filter columns when it applies a segment, so any other name would silently do nothing.
      const unknown = parsed.filters?.find(rule => !(FILTER_DIMENSIONS as readonly string[]).includes(rule.name));
      if (unknown) throw new RangeError(`Unknown filter "${unknown.name}".`);
      if (parsed.sessionPropertyFilters?.length) filterQueryParams({ properties: parsed.sessionPropertyFilters });
      parsed.filters = parsed.filters?.map(rule => ({ ...rule, operator: normalizeSegmentOperator(rule.operator) }));
      const result = await authorized(`${websitePath(websiteId)}/segments`, {
        method: 'POST',
        body: JSON.stringify({
          type: parsed.type,
          name: parsed.name,
          parameters: {
            ...(parsed.filters?.length ? { filters: parsed.filters } : {}),
            ...(parsed.match ? { match: parsed.match } : {}),
            ...(parsed.dateRange ? { dateRange: parsed.dateRange } : {}),
            ...(parsed.action ? { action: parsed.action } : {}),
            ...(parsed.sessionPropertyFilters?.length
              ? {
                sessionPropertyFilters: parsed.sessionPropertyFilters.map(item => ({
                  propertyName: item.name,
                  dataType: PROPERTY_DATA_TYPE_CODES[item.dataType],
                  operator: item.operator,
                  value: item.value,
                })),
              }
              : {}),
          },
        }),
      });
      return validated(websiteSegmentSchema, result);
    },

    async deleteSegment(websiteId: string, segmentId: string): Promise<void> {
      try {
        await authorized(`${websitePath(websiteId)}/segments/${uid.parse(segmentId)}`, { method: 'DELETE' });
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 404) return;
        throw error;
      }
    },

    async revenueReport(
      websiteId: string,
      range: DateRange,
      currency = 'USD',
      metricType: RevenueMetricType = 'country',
      filters?: ReportFilters,
    ): Promise<RevenueReport> {
      const path = websitePath(websiteId);
      const parsedCurrency = currencySchema.parse(currency);
      const parsedMetricType = revenueMetricTypeSchema.parse(metricType);
      const baseQuery = {
        ...queryRange(range),
        ...queryFilters(filters),
        currency: parsedCurrency,
      };
      const unit = rangeUnit(range);
      const [statsResult, chart, metrics] = await Promise.all([
        authorized(`${path}/revenue/stats`, {}, baseQuery)
          .then(data => validated(revenueStatsResponseSchema, data)),
        authorized(`${path}/revenue/chart`, {}, { ...baseQuery, unit })
          .then(data => validated(revenueChartSchema, data)),
        authorized(`${path}/revenue/metrics`, {}, { ...baseQuery, type: parsedMetricType })
          .then(data => validated(revenueMetricRowsSchema(parsedMetricType === 'referrer' ? 'Direct' : 'Unknown'), data)),
      ]);
      return {
        currency: parsedCurrency,
        stats: statsResult.stats,
        comparison: statsResult.comparison,
        chart,
        metrics,
      };
    },

    async performanceReport(
      websiteId: string,
      range: DateRange,
      metric: PerformanceMetricKey = 'lcp',
      breakdownType: PerformanceBreakdownType = 'path',
      filters?: ReportFilters,
    ): Promise<PerformanceReport> {
      const path = websitePath(websiteId);
      const parsedMetric = performanceMetricKeySchema.parse(metric);
      const parsedBreakdownType = performanceBreakdownTypeSchema.parse(breakdownType);
      const baseQuery = {
        ...queryRange(range),
        ...queryFilters(filters),
      };
      const unit = rangeUnit(range);
      const [stats, chart, metrics] = await Promise.all([
        authorized(`${path}/performance/stats`, {}, baseQuery)
          .then(data => validated(performanceStatsSchema, data)),
        authorized(`${path}/performance/chart`, {}, { ...baseQuery, unit, metric: parsedMetric })
          .then(data => validated(performanceChartSchema, data)),
        authorized(`${path}/performance/metrics`, {}, { ...baseQuery, metric: parsedMetric, type: parsedBreakdownType })
          .then(data => validated(performanceMetricsResponseSchema, data)),
      ]);
      return {
        metric: parsedMetric,
        stats,
        chart,
        metrics,
      };
    },

    async expandedMetrics(
      websiteId: string,
      range: DateRange,
      type: ReportDimension,
      filters?: ReportFilters,
      limit = 25,
    ): Promise<ExpandedMetricRow[]> {
      const validatedType = reportDimensionSchema.parse(type);
      const parsedLimit = expandedLimitSchema.parse(limit);
      const result = await authorized(`${websitePath(websiteId)}/metrics/expanded`, {}, {
        ...queryRange(range),
        ...queryFilters(filters),
        type: validatedType,
        limit: String(parsedLimit),
      });
      return validated(expandedMetricRowsSchema(validatedType === 'referrer' ? 'Direct' : 'Unknown'), result);
    },

    async eventsFeed(
      websiteId: string,
      range: DateRange,
      options?: { page?: number; pageSize?: number; search?: string; filters?: ReportFilters },
    ): Promise<Page<WebsiteEventRow>> {
      const parsedOptions = sessionOptionsSchema.parse({
        page: options?.page,
        pageSize: options?.pageSize,
        search: options?.search,
      });
      const query: Record<string, string> = {
        ...queryRange(range),
        ...queryFilters(options?.filters),
        page: String(parsedOptions.page),
        pageSize: String(parsedOptions.pageSize),
        ...(parsedOptions.search ? { search: parsedOptions.search } : {}),
      };
      const result = validated(eventsPageSchema, await authorized(`${websitePath(websiteId)}/events`, {}, query));
      return {
        items: result.data,
        total: result.count,
        page: result.page ?? parsedOptions.page,
        limit: result.pageSize ?? parsedOptions.pageSize,
      };
    },

    async sessionStats(websiteId: string, range: DateRange, filters?: ReportFilters): Promise<SessionStats> {
      const result = await authorized(
        `${websitePath(websiteId)}/sessions/stats`,
        {},
        { ...queryRange(range), ...queryFilters(filters) },
      );
      return validated(sessionStatsSchema, result);
    },

    async sessionProperties(websiteId: string, range: DateRange, filters?: ReportFilters): Promise<SessionPropertyStat[]> {
      const result = await authorized(
        `${websitePath(websiteId)}/session-data/properties`,
        {},
        { ...queryRange(range), ...queryFilters(filters) },
      );
      return validated(sessionPropertiesResponseSchema, result);
    },

    async sessionPropertyValues(
      websiteId: string,
      range: DateRange,
      propertyName: string,
      filters?: ReportFilters,
      dataType?: number,
    ): Promise<EventPropertyValue[]> {
      const parsedProperty = filterValueSchema.parse(propertyName);
      const parsedType = dataType === undefined ? undefined : z.number().int().min(1).max(5).parse(dataType);
      const result = await authorized(
        `${websitePath(websiteId)}/session-data/values`,
        {},
        {
          ...queryRange(range),
          ...queryFilters(filters),
          propertyName: parsedProperty,
          ...(parsedType ? { dataType: String(parsedType) } : {}),
        },
      );
      return validated(
        z.union([
          eventPropertyValueSchema.array(),
          z.object({ data: eventPropertyValueSchema.array() }).transform(({ data }) => data),
        ]),
        result,
      );
    },

    async singleSessionProperties(websiteId: string, sessionId: string): Promise<SessionPropertyEntry[]> {
      const result = await authorized(
        `${websitePath(websiteId)}/sessions/${uid.parse(sessionId)}/properties`,
      );
      return validated(singleSessionPropertiesResponseSchema, result);
    },

    links(): Promise<TrackedLink[]> {
      return allPages('links', trackedLinkSchema);
    },

    async createLink(input: TrackedLinkInput): Promise<TrackedLink> {
      const parsed = trackedLinkInputSchema.parse(input);
      const result = await authorized('links', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      return validated(trackedLinkSchema, result);
    },

    async updateLink(linkId: string, input: TrackedLinkUpdateInput): Promise<TrackedLink> {
      const parsed = trackedLinkUpdateInputSchema.parse(input);
      const result = await authorized(`links/${uid.parse(linkId)}`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      return validated(trackedLinkSchema, result);
    },

    async deleteLink(linkId: string): Promise<void> {
      await authorized(`links/${uid.parse(linkId)}`, { method: 'DELETE' });
    },

    linkCharts(ids: string[], range?: DateRange): Promise<EntityChartSeries> {
      return entityCharts('links', ids, range);
    },

    pixels(): Promise<TrackingPixel[]> {
      return allPages('pixels', trackingPixelSchema);
    },

    async createPixel(input: TrackingPixelInput): Promise<TrackingPixel> {
      const parsed = trackingPixelInputSchema.parse(input);
      const result = await authorized('pixels', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      return validated(trackingPixelSchema, result);
    },

    async updatePixel(pixelId: string, input: TrackingPixelUpdateInput): Promise<TrackingPixel> {
      const parsed = trackingPixelUpdateInputSchema.parse(input);
      const result = await authorized(`pixels/${uid.parse(pixelId)}`, {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      return validated(trackingPixelSchema, result);
    },

    async deletePixel(pixelId: string): Promise<void> {
      await authorized(`pixels/${uid.parse(pixelId)}`, { method: 'DELETE' });
    },

    pixelCharts(ids: string[], range?: DateRange): Promise<EntityChartSeries> {
      return entityCharts('pixels', ids, range);
    },
  };
}

export const umami = createUmami({
  url: process.env.UMAMI_URL,
  username: process.env.UMAMI_USERNAME,
  password: process.env.UMAMI_PASSWORD,
  token: process.env.UMAMI_TOKEN,
});
