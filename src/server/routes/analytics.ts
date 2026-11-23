import { z } from 'zod';
import type { PerformanceBreakdownType, PerformanceMetricKey, ReportDimension, ReportFilters, RevenueMetricType } from '@/contracts';
import { ANALYTICS_LIMITS, FILTER_DIMENSIONS, PROPERTY_OPERATORS, SEGMENT_DIMENSION_OPERATORS, filterQueryParams, hasFilters, parseFilterParams } from '@/contracts';
import { AppError } from '@/server/config';
import { recordActivity } from '@/server/activity';
import { json, readBody } from '@/server/http';
import { umami } from '@/server/umami';
import { buildSnippet, getSnippetPreferences, saveSnippetPreferences, snippetOptionsSchema } from '@/server/analytics-snippet';
import { channelReport, channelRulesSchema, classifyVisit, loadChannelRules, saveChannelRules } from '@/server/analytics-channels';
import { apiKeyInput, createApiKey, listApiKeys, revokeApiKey } from '@/server/analytics-events';
import { name, description, timestamp, siteId, requiredUrl, reportDate, route, page, date } from './shared';
import type { Context, Entry } from './shared';

const step = z.object({ type: z.enum(['event', 'path']), value: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength) });

const site = (context: Context) => siteId.parse(context.params[0]);

const filterRuleBody = z.object({
  dimension: z.string().trim().min(1).max(40),
  operator: z.string().trim().min(1).max(10),
  values: z.array(z.string().max(ANALYTICS_LIMITS.filterValueLength)).min(1).max(ANALYTICS_LIMITS.filterValues),
});

const propertyFilterBody = z.object({
  scope: z.enum(['session', 'event']),
  name: z.string().trim().min(1).max(200),
  dataType: z.enum(['string', 'number', 'boolean', 'date', 'array']),
  operator: z.string().trim().min(1).max(10),
  value: z.string().max(ANALYTICS_LIMITS.filterValueLength),
});

/** The filters object the console posts in a request body (the same shape the report URLs spell as query parameters). */
const filtersBody = z.object({
  rules: z.array(filterRuleBody).max(ANALYTICS_LIMITS.filterRules).optional(),
  match: z.enum(['all', 'any']).optional(),
  segment: z.string().trim().max(40).optional(),
  cohort: z.string().trim().max(40).optional(),
  properties: z.array(propertyFilterBody).max(ANALYTICS_LIMITS.propertyFilters).optional(),
});

/** Turns the filter model's RangeError into a 400 with its plain message instead of a server error. */
function checked<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(400, error.message);
    throw error;
  }
}

/** Reads every filter parameter Umami 3.5.0 takes (see parseFilterParams): operators, several values, OR, segments, properties. */
function reportFilters(query: URLSearchParams): ReportFilters | undefined {
  return checked(() => parseFilterParams(query.entries()));
}

function bodyFilters(input: z.infer<typeof filtersBody> | undefined): ReportFilters | undefined {
  if (!input) return undefined;
  const filters = input as ReportFilters;
  checked(() => filterQueryParams(filters));
  return hasFilters(filters) ? filters : undefined;
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
        name: z.enum(FILTER_DIMENSIONS),
        operator: z.enum([...SEGMENT_DIMENSION_OPERATORS, 'nc']),
        value: z.string().trim().min(1).max(ANALYTICS_LIMITS.filterValueLength),
      })).max(20).optional(),
      match: z.enum(['all', 'any']).optional(),
      dateRange: z.string().trim().max(40).optional(),
      action: z.object({ type: z.enum(['path', 'event']), value: z.string().trim().min(1).max(ANALYTICS_LIMITS.stepValueLength) }).optional(),
      sessionPropertyFilters: z.array(propertyFilterBody.extend({ scope: z.literal('session') })).max(ANALYTICS_LIMITS.propertyFilters).optional(),
    }));
    for (const property of input.sessionPropertyFilters ?? []) {
      if (!PROPERTY_OPERATORS[property.dataType].includes(property.operator)) {
        throw new AppError(400, `That operator cannot be used on ${property.dataType} properties.`);
      }
    }
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
    umami.sessionProperties(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/properties\/values$/i, async context => {
    const propertyName = z.string().trim().min(1).max(200).parse(context.query.get('propertyName'));
    const dataType = context.query.has('dataType') ? z.coerce.number().int().min(1).max(5).parse(context.query.get('dataType')) : undefined;
    return umami.sessionPropertyValues(site(context), date(context.query), propertyName, reportFilters(context.query), dataType);
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
    lookbackDays: context.query.has('lookbackDays') ? z.coerce.number().int().min(0).max(90).parse(context.query.get('lookbackDays')) : undefined,
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/revenue\/utm$/i, async context => {
    const currency = z.string().trim().regex(/^[A-Z]{3}$/).parse((context.query.get('currency') ?? 'USD').toUpperCase());
    const dimension = z.enum(['utmSource', 'utmMedium', 'utmCampaign']).parse(context.query.get('type') ?? 'utmSource');
    return umami.revenueByUtm(site(context), date(context.query), dimension, currency, reportFilters(context.query));
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/channels$/i, async context => {
    const [{ rules, custom }, rows] = await Promise.all([
      loadChannelRules(),
      umami.breakdown(site(context), date(context.query), ['referrer', 'utmSource', 'utmMedium', 'query'], reportFilters(context.query)),
    ]);
    return { ...channelReport(rules, rows), customRules: custom };
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/snippet$/i, async context => {
    const preferences = await getSnippetPreferences(site(context));
    const origin = z.url({ protocol: /^https?$/ }).catch('').parse(context.query.get('origin') ?? '');
    return { ...preferences, snippet: origin ? buildSnippet(origin, preferences.websiteId, preferences.options) : '' };
  }),
  route('PUT', /^websites\/([0-9a-f-]+)\/snippet$/i, async context => {
    const input = await readBody(context.request, z.object({ options: snippetOptionsSchema, origin: z.url({ protocol: /^https?$/ }) }));
    const saved = await saveSnippetPreferences(site(context), input.options);
    return { ...saved, snippet: buildSnippet(input.origin, saved.websiteId, saved.options) };
  }, 'marketer'),
  route('POST', /^websites\/([0-9a-f-]+)\/breakdown$/i, async context => {
    const data = await readBody(context.request, z.object({
      startAt: timestamp, endAt: timestamp,
      fields: z.array(z.string().trim().min(1).max(40)).min(1).max(ANALYTICS_LIMITS.breakdownFields),
      filters: filtersBody.optional(),
    }));
    return umami.breakdown(site(context), reportDate.parse(data), data.fields, bodyFilters(data.filters));
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
  route('GET', /^channel-rules$/, async () => loadChannelRules()),
  route('PUT', /^channel-rules$/, async context => saveChannelRules((await readBody(context.request, z.object({ rules: channelRulesSchema }))).rules), 'marketer'),
  route('POST', /^channel-rules\/test$/, async context => {
    const input = await readBody(context.request, z.object({
      rules: channelRulesSchema.optional(),
      visit: z.object({
        referrer: z.string().max(300).optional(), utmSource: z.string().max(300).optional(),
        utmMedium: z.string().max(300).optional(), query: z.string().max(2000).optional(),
      }),
    }));
    return classifyVisit(input.rules ?? (await loadChannelRules()).rules, input.visit);
  }),
  route('GET', /^api-keys$/, async () => listApiKeys(), 'admin'),
  route('POST', /^api-keys$/, async context => {
    const created = await createApiKey(await readBody(context.request, apiKeyInput), context.user.id);
    await recordActivity('Events API key created', '/analytics');
    return json(created, 201);
  }, 'admin'),
  route('DELETE', /^api-keys\/([0-9a-f-]+)$/i, async context => {
    await revokeApiKey(site(context));
    await recordActivity('Events API key revoked', '/analytics');
    return new Response(null, { status: 204 });
  }, 'admin'),
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
