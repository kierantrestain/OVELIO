import { randomUUID } from 'node:crypto';
import { AppError } from './config';
import { db } from './db';
import type { Sql } from './db';

export type JobData = {
  contact_sync: { contactId: number };
  segment_sync: { segmentId: number; page: number };
  suppress: { contactId: number; reason: 'unsubscribe' | 'bounce' | 'complaint' | 'erasure' | 'manual' };
  unsuppress: { contactId: number; emailKey: string };
  campaign_refresh: { campaignId: number; runId: string };
  erase: { contactId: number };
  contact_import: { importId: string };
  /** OVELIO 2.0 module jobs, dispatched by name through src/server/platform/jobs.ts. */
  platform: { handler: string; data: unknown };
};
export type Job = {
  [Kind in keyof JobData]: {
    id: string;
    kind: Kind;
    payload: JobData[Kind];
    attempts: number;
    generation: number;
    lease_id: string;
  }
}[keyof JobData];

export async function enqueue<K extends keyof JobData>(kind: K, key: string, data: JobData[K], client: Sql = db) {
  await client.query(
    `INSERT INTO jobs (kind, dedupe_key, payload) VALUES ($1, $2, $3)
     ON CONFLICT (dedupe_key) WHERE status IN ('pending', 'working')
     DO UPDATE SET payload = EXCLUDED.payload, generation = jobs.generation + 1,
       run_at = CASE WHEN jobs.status = 'working' THEN jobs.run_at ELSE now() END,
       attempts = CASE WHEN jobs.status = 'working' THEN jobs.attempts ELSE 0 END`,
    [kind, kind + ':' + key, JSON.stringify(data)],
  );
}

export async function claimJob(): Promise<Job | undefined> {
  const result = await db.query<Job>(
    `UPDATE jobs SET status = 'working', locked_at = now(), lease_id = $1, attempts = attempts + 1
     WHERE id = (
       SELECT id FROM jobs WHERE (status = 'pending' AND run_at <= now()) OR
         (status = 'working' AND locked_at < now() - interval '10 minutes')
       ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING id, kind, payload, attempts, generation, lease_id`,
    [randomUUID()],
  );
  return result.rows[0];
}

export async function finishJob(job: Job, error?: unknown) {
  const delay = Math.min(3600, 2 ** job.attempts * 10);
  await db.query(
    `UPDATE jobs SET
      status = CASE WHEN generation <> $3 THEN 'pending' WHEN $4::text IS NULL THEN 'done'
        WHEN attempts >= 8 THEN 'dead' ELSE 'pending' END,
      attempts = CASE WHEN generation <> $3 THEN 0 ELSE attempts END,
      run_at = CASE WHEN generation <> $3 THEN greatest(run_at, now()) ELSE now() + make_interval(secs => $5) END,
      finished_at = CASE WHEN generation = $3 AND ($4::text IS NULL OR attempts >= 8) THEN now() ELSE NULL END,
      locked_at = NULL, lease_id = NULL, last_error = $4
     WHERE id = $1 AND lease_id = $2`,
    [job.id, job.lease_id, job.generation, error ? (error as Error).name ?? 'Error' : null, delay],
  );
}

export async function maintainJobs() {
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
  // An import that was uploaded and never started holds the whole CSV; keep it a week, then drop it (its issue rows cascade).
  await db.query("DELETE FROM contact_imports WHERE status = 'draft' AND created_at < now() - interval '7 days'");
  // A removal marker only matters while an engine could still show the old entry.
  await db.query("DELETE FROM suppression_removals WHERE removed_at < now() - interval '90 days'");
  await db.query("DELETE FROM jobs WHERE status = 'done' AND finished_at < now() - interval '30 days'");
}

export async function enqueueReconciliation(contactId: number) {
  const key = 'contact_sync:' + contactId;
  await db.query(
    `INSERT INTO jobs (kind, dedupe_key, payload)
     SELECT 'contact_sync', $1, jsonb_build_object('contactId', $2::bigint)
     WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE dedupe_key = $1 AND status = 'dead')
     ON CONFLICT (dedupe_key) WHERE status IN ('pending', 'working') DO NOTHING`,
    [key, contactId],
  );
}

export async function deadJobs() {
  const result = await db.query<{ id: string; kind: string; attempts: number; finished_at: Date }>(
    "SELECT id, kind, attempts, finished_at FROM jobs WHERE status = 'dead' ORDER BY id DESC LIMIT 40",
  );
  return result.rows.map(row => ({ id: row.id, kind: row.kind, attempts: row.attempts, at: row.finished_at.toISOString() }));
}

export async function retryDeadJob(id: string) {
  try {
    const result = await db.query(
      "UPDATE jobs SET status = 'pending', attempts = 0, run_at = now(), finished_at = NULL, last_error = NULL WHERE id = $1 AND status = 'dead' RETURNING id",
      [id],
    );
    if (!result.rows.length) throw new AppError(404, 'This job is no longer waiting for a retry.');
    return { queued: true };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'A newer job for this record is already queued.');
    throw error;
  }
}
