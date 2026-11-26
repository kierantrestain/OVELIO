import { after } from 'next/server';
import { usesEmbeddedDatabase } from '../db';
import { drainPlatformJobs } from './jobs';

/**
 * The developer preview has no worker process, so a request that queued module jobs (event delivery, automation
 * steps, sequence sends) runs the due ones after its response. Production leaves them to scripts/worker.ts.
 */
export function drainAfterResponse() {
  if (!usesEmbeddedDatabase()) return;
  after(() => drainPlatformJobs().catch(error => console.error(JSON.stringify({ level: 'error', scope: 'preview-jobs', error: (error as Error).message }))));
}
