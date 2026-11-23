import { setTimeout as wait } from 'node:timers/promises';
import { applySuppressionRemoval, checkRecipient, eraseContact, propagateSuppression, runContactImport, sweepEngineSuppressions, syncContact, syncSegment } from '../src/server/audience';
import { appOrigin, logError, requiredEnv } from '../src/server/config';
import { db } from '../src/server/db';
import { createRelay, runCampaignRefresh, sweepScheduledRefreshes } from '../src/server/delivery';
import { claimJob, enqueueReconciliation, finishJob, maintainJobs } from '../src/server/jobs';
import type { Job } from '../src/server/jobs';
import { listmonk } from '../src/server/listmonk';
import { mautic } from '../src/server/mautic';

let running = true;
let cursor = 0;
let tick = 0;
let priorDelivery = false;
let samplesChecked = false;
const relay = createRelay();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { running = false; });
}

async function run(job: Job) {
  switch (job.kind) {
    case 'contact_sync': return syncContact(job.payload.contactId);
    case 'segment_sync': return syncSegment(job.payload.segmentId, job.payload.page);
    case 'suppress': return propagateSuppression(job.payload.contactId, job.payload.reason);
    case 'unsuppress': return applySuppressionRemoval(job.payload.contactId, job.payload.emailKey);
    case 'erase': return eraseContact(job.payload.contactId);
    case 'contact_import': return runContactImport(job.payload.importId);
    case 'campaign_refresh': return runCampaignRefresh(job.payload.campaignId, job.payload.runId);
  }
}

async function housekeeping() {
  let delivery = false;
  try {
    const config = await listmonk.configureDelivery({
      fromEmail: requiredEnv('SMTP_FROM_EMAIL'),
      publicUrl: appOrigin(),
      smtpHost: requiredEnv('SMTP_GATEWAY_HOST'),
      smtpPort: Number(process.env.SMTP_GATEWAY_PORT) || 2525,
      smtpUser: requiredEnv('SMTP_LISTMONK_USERNAME'),
      smtpPassword: requiredEnv('SMTP_LISTMONK_PASSWORD'),
    });
    if (config.changed) await wait(2500);
    if ((await listmonk.health()).status === 'ready' && !config.needsRestart) {
      delivery = await relay.verify();
      if (!samplesChecked) {
        await listmonk.removeInstallSample();
        samplesChecked = true;
      }
    }
  } catch (error) {
    logError('delivery-setup', error);
  }
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('worker', jsonb_build_object('at', now(), 'delivery', $1::boolean))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [delivery],
  );
  if (delivery && !priorDelivery) console.info('Newsletter delivery connection is ready.');
  priorDelivery = delivery;
  await maintainJobs();
  // Opens, holds and resumes pre-send refreshes for scheduled newsletters (DEL-22).
  try {
    await sweepScheduledRefreshes();
  } catch (error) {
    logError('campaign-refresh-sweep', error);
  }
  try {
    await sweepEngineSuppressions();
  } catch (error) {
    logError('suppression-sweep', error);
  }
  const records = await db.query<{ contact_id: string }>(
    "SELECT contact_id FROM contact_state WHERE consent = 'opted_in' AND contact_id > $1 ORDER BY contact_id LIMIT 20",
    [cursor],
  );
  for (const row of records.rows) {
    const id = Number(row.contact_id);
    try {
      const contact = await mautic.contact(id);
      if (contact.email && await checkRecipient(contact.email)) await enqueueReconciliation(id);
    } catch (error) {
      logError('audience-reconcile', error);
    }
    cursor = id;
  }
  if (records.rows.length < 20) cursor = 0;
}

while (running) {
  try {
    if (Date.now() >= tick) {
      tick = Date.now() + 30_000;
      await housekeeping();
    }
    const job = await claimJob();
    if (!job) {
      await wait(750);
      continue;
    }
    try {
      await run(job);
      await finishJob(job);
    } catch (error) {
      logError('job-' + job.kind, error);
      await finishJob(job, error);
    }
  } catch (error) {
    logError('worker', error);
    await wait(3000);
  }
}

await db.close();
