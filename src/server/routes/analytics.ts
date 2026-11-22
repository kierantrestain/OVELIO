import { z } from 'zod';
import type { PerformanceBreakdownType, PerformanceMetricKey, ReportDimension, ReportFilters, RevenueMetricType } from '@/contracts';
import { ANALYTICS_LIMITS, SEGMENT_DIMENSION_OPERATORS, UNFILTERABLE_DIMENSIONS } from '@/contracts';
import { AppError } from '@/server/config';
import { recordActivity } from '@/server/activity';
import { json, readBody } from '@/server/http';
import { umami } from '@/server/umami';
import { name, description, timestamp, siteId, requiredUrl, reportDate, route, page, date } from './shared';
import type { Context, Entry } from './shared';

const step = z.object({ type: z.enum(['event', 'path']), value: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength) });

const filterKeys: ReportDimension[] = [
  'path', 'referrer', 'title', 'query', 'hostname', 'device', 'browser', 'os',
  'country', 'region', 'city', 'language', 'event', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
];

const site = (context: Context) => siteId.parse(context.params[0]);

function reportFilters(query: URLSearchParams): ReportFilters | undefined {
  const filters: ReportFilters = {};
  let hasAny = false;
  // Umami 3.5.0 cannot filter by these; say so instead of returning an unfiltered report.
  for (const key of UNFILTERABLE_DIMENSIONS) {
    if (query.get(key)?.trim()) throw new AppError(400, `The analytics engine cannot filter by ${key}.`);
  }
  for (const key of filterKeys) {
    const val = query.get(key)?.trim();
    if (val) {
      filters[key] = val.slice(0, ANALYTICS_LIMITS.filterValueLength);
      hasAny = true;
    }
  }
  return hasAny ? filters : undefined;
}

export const analyticsEndpoints: Entry[] = [
  /* ── Analytics: Websites, Realtime, Sessions, Goals, Funnels, Insights ──── */
  route('GET', /^websites$/, async () => umami.websites()),
  route('POST', /^websites$/, async ({ request }) => {
    const added = await umami.createWebsite(await readBody(request, z.object({ name, domain: z.string().trim().min(1).max(255) })));
    await recordActivity('Website connected', '/analytics');
    return json(added, 201);
  }, 'marketer'),
  route('PATCH', /^websites\/([0-9a-f-]+)$/i, async context => umami.updateWebsite(site(context), await readBody(context.request, z.object({
    name, domain: z.string().trim().min(1).max(255),
  }))), 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteWebsite(site(context));
    await recordActivity('Website disconnected', '/analytics');
    return new Response(null, { status: 204 });
  }, 'admin'),
  route('POST', /^websites\/([0-9a-f-]+)\/reset$/i, async context => {
    await umami.resetWebsite(site(context));
    await recordActivity('Website analytics reset', '/analytics');
    return { reset: true };
  }, 'admin'),
  route('GET', /^websites\/([0-9a-f-]+)\/export$/i, async context => new Response(
    JSON.stringify(await umami.exportWebsite(site(context), date(context.query)), null, 2),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="ovelio-analytics-${site(context)}.json"`,
        'Cache-Control': 'no-store',
      },
    },
  ), 'admin'),
  route('GET', /^websites\/([0-9a-f-]+)\/shares$/i, async context => umami.shares(site(context)), 'marketer'),
  route('POST', /^websites\/([0-9a-f-]+)\/shares$/i, async context => {
    const input = await readBody(context.request, z.object({ name }));
    return json(await umami.createShare(site(context), input.name), 201);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/shares\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteShare(siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/report$/i, async context =>
    umami.report(site(context), date(context.query), undefined, reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/metrics\/expanded$/i, async context => {
    const dim = z.enum([
      'path', 'entry', 'exit', 'title', 'query', 'hostname', 'referrer', 'channel',
      'device', 'browser', 'os', 'screen', 'country', 'region', 'city', 'language', 'event',
      'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
    ]).parse(context.query.get('type') ?? 'path') as ReportDimension;
    const limit = context.query.has('limit') ? z.coerce.number().int().min(1).max(100).parse(context.query.get('limit')) : 25;
    return umami.expandedMetrics(site(context), date(context.query), dim, reportFilters(context.query), limit);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/events$/i, async context => umami.eventsFeed(site(context), date(context.query), {
    page: page(context.query),
    pageSize: 25,
    search: z.string().trim().max(120).optional().parse(context.query.get('q') ?? undefined),
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/segments$/i, async context => {
    const type = z.enum(['segment', 'cohort']).parse(context.query.get('type') ?? 'segment');
    return umami.segments(site(context), type);
  }),
  route('POST', /^websites\/([0-9a-f-]+)\/segments$/i, async context => {
    const input = await readBody(context.request, z.object({
      name,
      type: z.enum(['segment', 'cohort']),
      filters: z.array(z.object({
        name: z.string().trim().min(1).max(40),
        operator: z.enum([...SEGMENT_DIMENSION_OPERATORS, 'nc']),
        value: z.string().trim().min(1).max(ANALYTICS_LIMITS.filterValueLength),
      })).max(20).optional(),
      match: z.enum(['all', 'any']).optional(),
      dateRange: z.string().trim().max(40).optional(),
      action: z.object({ type: z.enum(['path', 'event']), value: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength) }).optional(),
    }));
    return json(await umami.createSegment(site(context), input), 201);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/segments\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteSegment(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/revenue$/i, async context => {
    const currency = z.string().trim().regex(/^[A-Z]{3}$/).parse((context.query.get('currency') ?? 'USD').toUpperCase());
    const metricType = z.enum(['country', 'region', 'referrer', 'channel']).parse(context.query.get('type') ?? 'country') as RevenueMetricType;
    return umami.revenueReport(site(context), date(context.query), currency, metricType, reportFilters(context.query));
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/performance$/i, async context => {
    const metric = z.enum(['lcp', 'inp', 'cls', 'fcp', 'ttfb']).parse(context.query.get('metric') ?? 'lcp') as PerformanceMetricKey;
    const breakdownType = z.enum(['path', 'title', 'device', 'browser']).parse(context.query.get('type') ?? 'path') as PerformanceBreakdownType;
    return umami.performanceReport(site(context), date(context.query), metric, breakdownType, reportFilters(context.query));
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/realtime$/i, async context => umami.realtime(site(context))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions$/i, async context => umami.sessions(site(context), date(context.query), {
    page: page(context.query),
    pageSize: 25,
    search: z.string().trim().max(120).optional().parse(context.query.get('q') ?? undefined),
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/stats$/i, async context =>
    umami.sessionStats(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/properties$/i, async context =>
    umami.sessionProperties(site(context), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/properties\/values$/i, async context => {
    const propertyName = z.string().trim().min(1).max(200).parse(context.query.get('propertyName'));
    return umami.sessionPropertyValues(site(context), date(context.query), propertyName);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/weekly$/i, async context =>
    umami.weeklyTraffic(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/([0-9a-f-]+)\/activity$/i, async context =>
    umami.sessionActivity(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/([0-9a-f-]+)\/properties$/i, async context =>
    umami.singleSessionProperties(site(context), siteId.parse(context.params[1]))),
  route('GET', /^websites\/([0-9a-f-]+)\/events\/properties$/i, async context =>
    umami.eventProperties(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/events\/values$/i, async context => {
    const eventName = z.string().trim().min(1).max(200).parse(context.query.get('event'));
    const propertyName = z.string().trim().min(1).max(200).parse(context.query.get('propertyName'));
    return umami.eventPropertyValues(site(context), date(context.query), eventName, propertyName);
  }),
  route('POST', /^websites\/([0-9a-f-]+)\/funnel$/i, async context => {
    const data = await readBody(context.request, z.object({
      startAt: timestamp, endAt: timestamp, steps: z.array(step).min(2).max(ANALYTICS_LIMITS.funnelSteps),
      windowMinutes: z.number().int().min(1).max(ANALYTICS_LIMITS.funnelWindowMinutes).optional(),
    }));
    return umami.funnel(site(context), reportDate.parse(data), data.steps, data.windowMinutes);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/funnels$/i, async context => umami.funnels(site(context))),
  route('POST', /^websites\/([0-9a-f-]+)\/funnels$/i, async context => {
    const input = await readBody(context.request, z.object({
      name, description, steps: z.array(step).min(2).max(ANALYTICS_LIMITS.funnelSteps), windowMinutes: z.number().int().min(1).max(ANALYTICS_LIMITS.funnelWindowMinutes),
    }));
    return json(await umami.createFunnel(site(context), input), 201);
  }, 'marketer'),
  route('PATCH', /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)$/i, async context => {
    const input = await readBody(context.request, z.object({
      name, description, steps: z.array(step).min(2).max(ANALYTICS_LIMITS.funnelSteps), windowMinutes: z.number().int().min(1).max(ANALYTICS_LIMITS.funnelWindowMinutes),
    }));
    return umami.updateFunnel(site(context), siteId.parse(context.params[1]), input);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteFunnel(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)\/stats$/i, async context =>
    umami.funnelStats(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/goals$/i, async context => umami.goals(site(context))),
  route('POST', /^websites\/([0-9a-f-]+)\/goals$/i, async context => {
    const input = await readBody(context.request, z.object({ name, type: step.shape.type, value: step.shape.value }));
    return json(await umami.createGoal(site(context), input), 201);
  }, 'marketer'),
  route('PATCH', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context => {
    const input = await readBody(context.request, z.object({ name, type: step.shape.type, value: step.shape.value }));
    return umami.updateGoal(site(context), siteId.parse(context.params[1]), input);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteGoal(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context =>
    umami.goalStats(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/retention$/i, async context =>
    umami.retention(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/journeys$/i, async context => umami.journeys(site(context), date(context.query), {
    steps: context.query.has('steps') ? z.coerce.number().int().min(2).max(7).parse(context.query.get('steps')) : 3,
    startStep: context.query.get('startStep')?.trim() || undefined,
    endStep: context.query.get('endStep')?.trim() || undefined,
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/attribution$/i, async context => umami.attribution(site(context), date(context.query), {
    model: z.enum(['first-click', 'last-click']).parse(context.query.get('model') ?? 'first-click'),
    type: z.enum(['path', 'event']).parse(context.query.get('type') ?? 'path'),
    step: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength).parse(context.query.get('step')),
    currency: context.query.has('currency')
      ? z.string().trim().regex(/^[A-Za-z]{3}$/).transform(v => v.toUpperCase()).parse(context.query.get('currency'))
      : undefined,
    filters: reportFilters(context.query),
  })),
  route('POST', /^websites\/([0-9a-f-]+)\/breakdown$/i, async context => {
    const data = await readBody(context.request, z.object({
      startAt: timestamp, endAt: timestamp,
      fields: z.array(z.string().trim().min(1).max(40)).min(1).max(ANALYTICS_LIMITS.breakdownFields),
      filters: z.record(z.string(), z.string().max(ANALYTICS_LIMITS.filterValueLength)).optional(),
    }));
    return umami.breakdown(site(context), reportDate.parse(data), data.fields, data.filters as ReportFilters | undefined);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/annotations$/i, async context =>
    umami.annotations(site(context), context.query.has('startAt') ? date(context.query) : undefined)),
  route('POST', /^websites\/([0-9a-f-]+)\/annotations$/i, async context => {
    const input = await readBody(context.request, z.object({
      date: z.string().trim().min(1).max(40), allDay: z.boolean().optional(), note: z.string().trim().min(1).max(500),
    }));
    return json(await umami.createAnnotation(site(context), input), 201);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/annotations\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteAnnotation(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^links$/, async () => umami.links()),
  route('GET', /^links\/charts$/, async ({ query }) => {
    const ids = (query.get('ids') ?? '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 20).map(v => siteId.parse(v));
    return umami.linkCharts(ids, query.has('startAt') ? date(query) : undefined);
  }),
  route('POST', /^links$/, async ({ request }) => json(await umami.createLink(await readBody(request, z.object({
    name, url: requiredUrl, slug: z.string().trim().min(8).max(100).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^links\/([0-9a-f-]+)$/i, async context => umami.updateLink(site(context), await readBody(context.request, z.object({
    name: name.optional(), url: requiredUrl.optional(), slug: z.string().trim().min(8).max(100).optional(),
  }))), 'marketer'),
  route('DELETE', /^links\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteLink(site(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^pixels$/, async () => umami.pixels()),
  route('GET', /^pixels\/charts$/, async ({ query }) => {
    const ids = (query.get('ids') ?? '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 20).map(v => siteId.parse(v));
    return umami.pixelCharts(ids, query.has('startAt') ? date(query) : undefined);
  }),
  route('POST', /^pixels$/, async ({ request }) => json(await umami.createPixel(await readBody(request, z.object({
    name, slug: z.string().trim().min(8).max(100).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^pixels\/([0-9a-f-]+)$/i, async context => umami.updatePixel(site(context), await readBody(context.request, z.object({
    name: name.optional(), slug: z.string().trim().min(8).max(100).optional(),
  }))), 'marketer'),
  route('DELETE', /^pixels\/([0-9a-f-]+)$/i, async context => {
    await umami.deletePixel(site(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
];
