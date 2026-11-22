import { z } from 'zod';
import type {
  DateRange,
  FunnelResult,
  FunnelStep,
  Goal,
  GoalInput,
  GoalStats,
  Health,
  Point,
  ReportDimension,
  Traffic,
  Website,
  WebsiteReport,
} from '../../contracts';
import { UpstreamError, upstream } from '../upstream';

const uid = z.uuid();
const count = z.number().int().nonnegative();
const websiteSchema = z.object({ id: uid, name: z.string(), domain: z.string() });
const trafficSchema = z.object({ pageviews: count, visitors: count, visits: count, bounces: count });
const metricRow = z.object({ x: z.string().nullable(), y: count });
const timeSeries = z.object({ x: z.string(), y: count }).array();
const seriesSchema = z.object({ pageviews: timeSeries, sessions: timeSeries });
const statsSchema = trafficSchema.extend({ comparison: trafficSchema });
const utmSchema = z.object({ utm: z.string(), views: count }).array();
const stepSchema = z.object({ type: z.enum(['event', 'path']), value: z.string().trim().min(1).max(500) });
const funnelSchema = stepSchema.extend({ visitors: count }).array();
const goalSchema = z.object({ id: uid, name: z.string(), parameters: stepSchema });
const goalStatsSchema = z.object({ num: count, total: count });
const loginSchema = z.object({ token: z.string().min(1) });
const service = 'tracking';
const pageSize = 100;
const hour = 60 * 60 * 1000;

const utmDimensions = {
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
} as const;
type UtmDimension = keyof typeof utmDimensions;

const reportDimensions: ReportDimension[] = ['path', 'referrer', 'device', 'browser', 'country', 'event', 'utmSource', 'utmMedium', 'utmCampaign'];

const websiteInput = z.object({
  name: z.string().trim().min(1).max(100),
  domain: z.string().trim().toLowerCase().max(500).regex(
    /^(?:localhost(?::[1-9]\d{0,4})?|(?:[a-z0-9_-]{1,63}\.)+[a-z0-9_-]{2,63})$/,
    'Use a hostname such as example.com or localhost:3000.',
  ),
});

const funnelInput = z.object({
  name: z.string().trim().min(1).max(200),
  steps: stepSchema.array().min(2).max(8),
  windowMinutes: z.number().int().min(1).max(10_080),
});

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

function websitePath(id: string) {
  return `websites/${uid.parse(id)}`;
}

function getTraffic(data: Traffic): Traffic {
  const { pageviews, visitors, visits, bounces } = data;
  return { pageviews, visitors, visits, bounces };
}

function mapSeries(rows: { x: string; y: number }[]): Point[] {
  return rows.map(({ x, y }) => ({ label: x, value: y }));
}

function mapGoal(goal: z.output<typeof goalSchema>): Goal {
  return { id: goal.id, name: goal.name, ...goal.parameters };
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

    const suffix = query ? `?${new URLSearchParams(query)}` : '';
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

  async function allPages<T>(path: string, item: z.ZodType<T>): Promise<T[]> {
    const schema = z.object({ data: item.array(), count });
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const result = validated(schema, await authorized(path, {}, { page: String(page), pageSize: String(pageSize) }));
      items.push(...result.data);
      if (!result.data.length || items.length >= result.count) return items;
    }
  }

  async function dimensionData(path: string, dimension: ReportDimension, query: Record<string, string>) {
    if (isUtm(dimension)) {
      const result = await authorized(`${path}/utm/metrics`, {}, { ...query, type: utmDimensions[dimension] });
      return validated(utmSchema, result).map(({ utm, views }) => ({ label: utm, value: views }));
    }
    const result = await authorized(`${path}/metrics`, {}, { ...query, type: dimension, limit: '10' });
    return validated(metricRow.array(), result).map(({ x, y }) => ({
      label: x || (dimension === 'referrer' ? 'Direct' : 'Unknown'),
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

    async report(id: string, range: DateRange, dimensions = reportDimensions): Promise<WebsiteReport> {
      const path = websitePath(id);
      const query = queryRange(range);
      const duration = range.endAt - range.startAt;
      const unit = duration <= 48 * hour ? 'hour' : 'day';
      const [website, stats, series, dimensionEntries] = await Promise.all([
        authorized(path).then(data => validated(websiteSchema, data)),
        available(authorized(`${path}/stats`, {}, { ...query, compare: 'prev' }).then(data => validated(statsSchema, data))),
        available(authorized(`${path}/pageviews`, {}, { ...query, unit }).then(data => validated(seriesSchema, data))),
        Promise.all([...new Set(dimensions)].map(async dimension => [
          dimension,
          await available(dimensionData(path, dimension, query)),
        ] as const)),
      ]);

      return {
        website,
        range,
        current: stats ? getTraffic(stats) : null,
        previous: stats ? getTraffic(stats.comparison) : null,
        pageviews: series ? mapSeries(series.pageviews) : null,
        visitors: series ? mapSeries(series.sessions) : null,
        dimensions: Object.fromEntries(dimensionEntries),
      };
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

    async goals(id: string): Promise<Goal[]> {
      return (await allPages(`${websitePath(id)}/goals`, goalSchema)).map(mapGoal);
    },

    async createGoal(id: string, input: GoalInput): Promise<Goal> {
      const { name, type, value } = stepSchema.extend({ name: z.string().trim().min(1).max(200) }).parse(input);
      const result = await authorized(`${websitePath(id)}/goals`, {
        method: 'POST',
        body: JSON.stringify({ name, parameters: { type, value } }),
      });
      return mapGoal(validated(goalSchema, result));
    },

    async goalStats(id: string, goalId: string, range: DateRange): Promise<GoalStats> {
      const result = await authorized(`${websitePath(id)}/goals/${uid.parse(goalId)}/stats`, {}, queryRange(range));
      const { num, total } = validated(goalStatsSchema, result);
      return { total, unique: num };
    },
  };
}

export const umami = createUmami({
  url: process.env.UMAMI_URL,
  username: process.env.UMAMI_USERNAME,
  password: process.env.UMAMI_PASSWORD,
  token: process.env.UMAMI_TOKEN,
});
