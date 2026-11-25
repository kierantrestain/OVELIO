import type { User } from '@/contracts';
import type { PlatformEvent, SearchResult } from '@/contracts/platform';
import type { Sql } from '../db';
import type { Entry } from '../routes/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler = (data: any, context: { attempt: number }) => Promise<void>;

/**
 * Each OVELIO 2.0 lane exposes exactly one module (src/server/<lane>/module.ts) that the lead registers once
 * (src/server/platform/modules.ts). Lanes never edit the registry, the gateway or another lane's module.
 */
export type LaneModule = {
  /** Stable lane name, used in job keys. */
  name: 'crm' | 'studio' | 'sites' | 'journeys' | 'insights';
  /** Console API endpoints under /api/console. They run on PostgreSQL in production and PGlite in the preview. */
  endpoints: Entry[];
  /** Background job handlers, keyed by a lane-prefixed name such as 'flows.step'. */
  jobHandlers: Record<string, JobHandler>;
  /** Called once per platform event (with retries). Must be idempotent. */
  onPlatformEvent: (event: PlatformEvent) => Promise<void>;
  /** Global search results for the command palette (at most 5). */
  search: (query: string, user: User) => Promise<SearchResult[]>;
  /** Labelled sample records for the developer preview. Never runs against a real database. */
  seedPreview: (sql: Sql) => Promise<void>;
};
