// Lane module: see docs/rebuild/TRACKER.md for ownership. The lead registers this file once; keep its export shape.
import type { SearchResult } from '@/contracts/platform';
import { db } from '../db';
import type { LaneModule } from '../platform/types';
import { handlePlatformEvent, runStep, STEP_JOB } from './engine';
import { journeyEndpoints } from './routes';
import { seedJourneys } from './seed';

async function search(query: string): Promise<SearchResult[]> {
  const q = `%${query.trim().toLowerCase()}%`;
  const [campaigns, flows] = await Promise.all([
    db.query<{ id: string; name: string; status: string; utm_campaign: string }>(
      `SELECT id, name, status, utm_campaign FROM marketing_campaigns WHERE lower(name) LIKE $1 OR utm_campaign LIKE $1 ORDER BY updated_at DESC LIMIT 3`, [q]),
    db.query<{ id: string; name: string; status: string }>(
      `SELECT id, name, status FROM journey_flows WHERE lower(name) LIKE $1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 3`, [q]),
  ]);
  return [
    ...campaigns.rows.map(row => ({ id: 'campaign:' + row.id, kind: 'campaign' as const, title: row.name, subtitle: `Campaign · ${row.status} · ${row.utm_campaign}`, href: `/marketing/campaigns/${row.id}` })),
    ...flows.rows.map(row => ({ id: 'flow:' + row.id, kind: 'flow' as const, title: row.name, subtitle: `Workflow · ${row.status}`, href: `/automations/flows/${row.id}` })),
  ].slice(0, 5);
}

export const journeysModule: LaneModule = {
  name: 'journeys',
  endpoints: journeyEndpoints,
  jobHandlers: { [STEP_JOB]: runStep },
  onPlatformEvent: handlePlatformEvent,
  search,
  seedPreview: seedJourneys,
};
