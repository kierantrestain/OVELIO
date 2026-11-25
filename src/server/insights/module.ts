// Lane module: see docs/rebuild/TRACKER.md for ownership. The lead registers this file once; keep its export shape.
// Analytics & BI (lane 5): read-only reports over events, deals, tasks, messages and campaigns (decision D7).
import { z } from 'zod';
import type { InsightsOptions, ReportKey } from '@/contracts/insights';
import { db } from '../db';
import type { LaneModule } from '../platform/types';
import { route } from '../routes/shared';
import { attribution, lookbackDays } from './attribution';
import { exportKeys, exportReport } from './csv';
import { drill, parseDrill } from './drill';
import { funnels } from './funnels';
import { home } from './home';
import { marketing } from './marketing';
import { dataset, defaultCurrency, parseInsightsQuery } from './params';
import { sales } from './sales';
import { seedInsightsPreview } from './seed';
import { summary } from './summary';

async function options(): Promise<InsightsOptions> {
  const [pipelines, owners, campaigns, sources, currency] = await Promise.all([
    db.query<{ id: string; name: string; currency: string; is_default: boolean }>(
      'SELECT id, name, currency, is_default FROM pipelines WHERE archived_at IS NULL ORDER BY is_default DESC, position, name'),
    db.query<{ id: string; name: string }>('SELECT id, name FROM users WHERE disabled_at IS NULL ORDER BY name'),
    db.query<{ id: string; name: string; status: string }>(
      `SELECT id, name, status FROM marketing_campaigns WHERE status <> 'archived' ORDER BY created_at DESC LIMIT 200`),
    db.query<{ source: string }>(
      `SELECT source FROM (
         SELECT DISTINCT utm->>'source' AS source FROM events WHERE coalesce(utm->>'source', '') <> '' AND type = ANY($1::text[])
         UNION SELECT DISTINCT source FROM deals WHERE source <> '' AND archived_at IS NULL
       ) all_sources ORDER BY lower(source) LIMIT 100`, [['form.submitted', 'contact.created', 'page.viewed']]),
    defaultCurrency(),
  ]);
  return {
    pipelines: pipelines.rows.map(row => ({ id: row.id, name: row.name, currency: row.currency, isDefault: row.is_default })),
    owners: owners.rows,
    campaigns: campaigns.rows,
    sources: sources.rows.map(row => row.source),
    defaultCurrency: currency,
    dataset: dataset(),
  };
}

export const insightsModule: LaneModule = {
  name: 'insights',
  endpoints: [
    route('GET', /^insights\/options$/, async () => options()),
    route('GET', /^insights\/summary$/, async ({ query }) => summary(await parseInsightsQuery(query))),
    route('GET', /^insights\/sales$/, async ({ query }) => sales(await parseInsightsQuery(query))),
    route('GET', /^insights\/marketing$/, async ({ query, user }) => marketing(await parseInsightsQuery(query), user)),
    route('GET', /^insights\/attribution$/, async ({ query }) => attribution(await parseInsightsQuery(query), lookbackDays(query.get('lookbackDays')))),
    route('GET', /^insights\/funnels$/, async ({ query, user }) => funnels(await parseInsightsQuery(query), user)),
    route('GET', /^insights\/drill$/, async ({ query }) => drill(await parseInsightsQuery(query), parseDrill(query), query)),
    route('GET', /^insights\/home$/, async ({ user }) => home(user)),
    route('GET', /^insights\/export\/([a-z-]+)$/, async ({ query, user, params }) => {
      const key = z.enum(exportKeys).parse(params[0]) as ReportKey | 'drill';
      return exportReport(key, await parseInsightsQuery(query), user, query, key === 'drill' ? parseDrill(query) : undefined);
    }),
  ],
  jobHandlers: {},
  async onPlatformEvent() {},
  // Insights has no saved reports yet, so it contributes nothing to global search.
  async search() { return []; },
  async seedPreview(sql) { await seedInsightsPreview(sql); },
};
