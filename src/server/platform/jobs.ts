// Named background jobs for OVELIO 2.0 modules: the production worker (scripts/worker.ts) runs them, and the developer
// preview drains due ones after each console request, because a Vercel preview has no long-running worker.
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import type { Sql } from '../db';
import type { Job } from '../jobs';
import { finishJob } from '../jobs';
import type { JobHandler } from './types';

let registry: Promise<Record<string, JobHandler>> | undefined;

async function handlers(): Promise<Record<string, JobHandler>> {
  registry ??= import('./modules').then(({ laneModules, dispatchEvent, deliverEvent }) => {
    const all: Record<string, JobHandler> = { 'event.dispatch': dispatchEvent, 'event.deliver': deliverEvent };
    for (const lane of laneModules) Object.assign(all, lane.jobHandlers);
    return all;
  });
  return registry;
}

/**
 * Queues a named job. A pending job with the same handler and key is replaced (its data updated), so scheduling is
 * idempotent. `runAt` delays it (automation waits, sequence steps, scheduled publishing).
 */
export async function schedulePlatformJob(handler: string, key: string, data: unknown, options: { runAt?: Date; client?: Sql } = {}) {
  const client = options.client ?? db;
  await client.query(
    `INSERT INTO jobs (kind, dedupe_key, payload, run_at) VALUES ('platform', $1, $2, coalesce($3::timestamptz, now()))
     ON CONFLICT (dedupe_key) WHERE status IN ('pending', 'working')
     DO UPDATE SET payload = EXCLUDED.payload, generation = jobs.generation + 1,
       run_at = EXCLUDED.run_at,
       attempts = CASE WHEN jobs.status = 'working' THEN jobs.attempts ELSE 0 END`,
    ['platform:' + handler + ':' + key, JSON.stringify({ handler, data }), options.runAt ? options.runAt.toISOString() : null],
  );
}

export async function cancelPlatformJob(handler: string, key: string, client: Sql = db) {
  await client.query(`DELETE FROM jobs WHERE dedupe_key = $1 AND status = 'pending'`, ['platform:' + handler + ':' + key]);
}

export async function runPlatformJob(payload: { handler: string; data: unknown }, attempt = 1) {
  const handler = (await handlers())[payload.handler];
  if (!handler) throw new Error(`No platform job handler named ${payload.handler}`);
  await handler(payload.data, { attempt });
}

/** Runs due platform jobs in this process. Used by the preview after each request and by DB-backed tests. */
export async function drainPlatformJobs(options: { maxJobs?: number; budgetMs?: number } = {}) {
  const deadline = Date.now() + (options.budgetMs ?? 4000);
  let ran = 0;
  while (ran < (options.maxJobs ?? 25) && Date.now() < deadline) {
    const claimed = await db.query<Job>(
      `UPDATE jobs SET status = 'working', locked_at = now(), lease_id = $1, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs WHERE kind = 'platform' AND ((status = 'pending' AND run_at <= now()) OR
           (status = 'working' AND locked_at < now() - interval '10 minutes'))
         ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1
       ) RETURNING id, kind, payload, attempts, generation, lease_id`,
      [randomUUID()],
    );
    const job = claimed.rows[0];
    if (!job || job.kind !== 'platform') break;
    ran += 1;
    try {
      await runPlatformJob(job.payload, job.attempts);
      await finishJob(job);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', scope: 'platform-job', handler: job.payload.handler, error: (error as Error).message }));
      await finishJob(job, error);
    }
  }
  return ran;
}
