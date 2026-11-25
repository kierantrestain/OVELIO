import { randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import sanitize from 'sanitize-html';
import type { Campaign, CampaignInput, CampaignMetrics, CampaignStartResult, DateRange, Page, PreSendRefreshState, SegmentSyncReport, TransactionalEmailInput } from '../contracts';
import { recordActivity } from './activity';
import { checkRecipient, syncContact } from './audience';
import { enqueue } from './jobs';
import { AppError, logError, requiredEnv } from './config';
import { db, transaction } from './db';
import { listmonk } from './listmonk';
import { mautic } from './mautic';
import { studioMarker, studioNewsletterBody } from './studio/sanitize';

const metricKeys: Exclude<keyof CampaignMetrics, 'unavailable'>[] = ['sent', 'delivered', 'opens', 'clicks', 'bounces', 'unsubscribes'];
const contentSlot = '{{ template "content" . }}';
const contentMarker = 'OVELIO_NEWSLETTER_CONTENT_SLOT';
const spacing = /^\d+(?:\.\d+)?(?:px|rem|em|%)?(?:\s+\d+(?:\.\d+)?(?:px|rem|em|%)?){0,3}$/;

// Listmonk 6.2.0 merge tags that are safe to keep (subscriber and campaign fields, plus link functions).
const mergeTag = new RegExp(
  '\\{\\{\\s*(\\.Subscriber\\.(?:FirstName|LastName|Name|Email|UUID)|\\.Subscriber\\.Attribs\\.[A-Za-z0-9_]+'
  + '|\\.Campaign\\.(?:Name|Subject)|UnsubscribeURL|OptinURL|MessageURL|ManageURL)\\s*\\}\\}', 'g');

export function mailContent(body: string, template = false, mergeTags = false) {
  let source = template ? body.replaceAll(contentSlot, contentMarker) : body;
  // Allow-listed tags are swapped for unguessable plain-text tokens, sanitised, then restored in canonical form.
  const nonce = 'ovtag' + randomBytes(9).toString('hex');
  const tags: string[] = [];
  if (mergeTags) {
    source = source.replace(mergeTag, (_all, name: string) => {
      tags.push(`{{ ${name} }}`);
      return `${nonce}x${tags.length - 1}x`;
    });
  }
  const output = sanitize(source.replaceAll('{{', '&#123;&#123;'), {
    allowedTags: [...sanitize.defaults.allowedTags, 'img', 'center', 'font', 'hr', 'header', 'section', 'tfoot', 'main'],
    allowedAttributes: {
      '*': ['style', 'align', 'width', 'height', 'valign', 'bgcolor', 'lang', 'dir'],
      a: ['href', 'name', 'target', 'title'],
      img: ['src', 'alt', 'title'],
      table: ['cellpadding', 'cellspacing', 'border', 'role'],
      td: ['colspan', 'rowspan'],
      th: ['scope', 'colspan', 'rowspan'],
      font: ['face', 'color', 'size'],
    },
    allowedStyles: {
      '*': {
        color: [/^[a-zA-Z]+$|^#[0-9a-fA-F]{3,8}$/],
        'background-color': [/^[a-zA-Z]+$|^#[0-9a-fA-F]{3,8}$/],
        'font-size': [/^[\d.]+(?:px|rem|em|%)$/],
        'font-family': [/^[\w ,'-]+$/],
        'font-weight': [/^(?:bold|normal|[1-9]00)$/],
        'line-height': [/^[\d.]+(?:px|rem|em|%)?$/],
        'text-align': [/^(?:left|center|right|justify)$/],
        'text-decoration': [/^(?:underline|none|line-through)$/],
        padding: [spacing],
        margin: [spacing],
        width: [/^[\d.]+(?:px|rem|em|%)$/],
        'max-width': [/^[\d.]+(?:px|rem|em|%)$/],
        height: [/^[\d.]+(?:px|rem|em|%)$/],
        border: [/^[\w\s.#]+$/],
        'border-radius': [/^[\d.]+(?:px|rem|em|%)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
  });
  if (!output.trim()) throw new AppError(400, 'Enter email content.');
  let safe = output.replaceAll('{{', '&#123;&#123;');
  if (tags.length) safe = safe.replace(new RegExp(`${nonce}x(\\d+)x`, 'g'), (_all, index: string) => tags[Number(index)] ?? '');
  return template ? safe.replaceAll(contentMarker, contentSlot) : safe;
}

export function approvedCampaign(input: CampaignInput): CampaignInput {
  const approved = requiredEnv('SMTP_FROM_EMAIL');
  if (input.fromEmail && input.fromEmail.toLowerCase() !== approved.toLowerCase()) {
    throw new AppError(400, 'Choose the configured sender email address.');
  }
  const contentType = input.contentType ?? 'html';
  // Email studio exports keep their responsive <style> blocks and Outlook comments; they get the studio's own
  // parser-based sanitiser and Listmonk tag allow-list instead of the plainer body sanitiser.
  const body = contentType === 'plain' || contentType === 'markdown' ? input.body.trim()
    : input.body.includes(studioMarker) ? studioNewsletterBody(input.body) : mailContent(input.body, false, true);
  if (!body) throw new AppError(400, 'Enter email content.');
  return { ...input, fromEmail: approved, contentType, body };
}

export async function assertDeliveryReady() {
  const result = await db.query("SELECT 1 FROM settings WHERE key = 'worker' AND (value->>'delivery')::boolean IS TRUE AND (value->>'at')::timestamptz > now() - interval '2 minutes'");
  if (!result.rows.length) throw new AppError(503, 'Delivery is being configured. Check connection health in Settings.');
}

export async function sendTest(id: number, email: string) {
  await assertDeliveryReady();
  if (!await checkRecipient(email)) throw new AppError(409, 'Choose a contact with recorded email consent for the test.');
  await listmonk.ensureTestSubscriber(email);
  await listmonk.testCampaign(id, email);
  await recordActivity('Newsletter test queued', '/campaigns');
}

export async function sendTransactional(input: TransactionalEmailInput) {
  await assertDeliveryReady();
  if (!await checkRecipient(input.email)) {
    throw new AppError(409, 'Choose an audience contact with active email consent.');
  }
  await listmonk.ensureTestSubscriber(input.email);
  await listmonk.sendTransactional({ ...input, fromEmail: requiredEnv('SMTP_FROM_EMAIL') });
  await recordActivity('Transactional email queued', '/campaigns?tab=Transactional');
}

export async function testSmtpRelay(email: string) {
  await assertDeliveryReady();
  if (!await checkRecipient(email)) {
    throw new AppError(409, 'Choose an opted-in audience contact for the SMTP diagnostic test.');
  }
  await listmonk.testSmtp(email, requiredEnv('SMTP_LISTMONK_PASSWORD'));
  await recordActivity('SMTP diagnostic email sent', '/settings?view=connections');
}

export async function changeCampaign(id: number, action: 'start' | 'pause' | 'schedule', sendAt?: string): Promise<CampaignStartResult> {
  if (action !== 'pause') await assertDeliveryReady();
  // Recipients must equal current segment membership when sending begins, so refresh the mirrored lists first.
  // A failed refresh stops here: nothing has been started or scheduled yet.
  let segmentSync: SegmentSyncReport | undefined;
  if (action !== 'pause') {
    const before = await listmonk.campaign(id);
    if (['draft', 'paused', 'scheduled'].includes(before.status)) segmentSync = await syncCampaignSegments(before.listIds);
  }
  const changed = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [64338, String(id)]);
    const current = await listmonk.campaign(id);
    if (action === 'start' && ['running', 'finished'].includes(current.status)) return current;
    if (action === 'pause' && current.status === 'paused') return current;
    if (action === 'schedule' && current.status === 'scheduled' && current.sendAt && sendAt
      && Date.parse(current.sendAt) === Date.parse(sendAt)) return current;
    if (action === 'start' && !['draft', 'paused', 'scheduled'].includes(current.status)) {
      throw new AppError(409, 'This campaign cannot be sent in its current status.');
    }
    if (action === 'pause' && current.status === 'draft') {
      // A newsletter held for its pre-send refresh is a draft: pausing it cancels the hold and the pending send.
      const held = await client.query(
        "UPDATE scheduled_refreshes SET state = 'cancelled', message = 'Cancelled by you.', progress = NULL, updated_at = now() WHERE campaign_id = $1 AND state = 'held' RETURNING 1", [id]);
      if (held.rowCount) {
        await client.query('INSERT INTO activity (description, href) VALUES ($1, $2)', ['Held newsletter send cancelled', '/campaigns']);
        return current;
      }
    }
    if (action === 'pause' && !['scheduled', 'running', 'paused'].includes(current.status)) {
      throw new AppError(409, 'This campaign has no active send or schedule to pause.');
    }
    if (action === 'schedule' && (!sendAt || Date.parse(sendAt) <= Date.now() + 60_000 || !['draft', 'scheduled'].includes(current.status))) {
      throw new AppError(409, 'Schedule a draft email for a time at least one minute in the future.');
    }
    const result = action === 'pause'
      ? current.status === 'scheduled' ? await listmonk.cancelSchedule(id) : await listmonk.pauseCampaign(id)
      : action === 'schedule' && sendAt ? await listmonk.scheduleCampaign(id, sendAt) : await listmonk.startCampaign(id);
    // Any manual start or pause ends a pending pre-send refresh. A new schedule is registered after this commits.
    if (action !== 'schedule') {
      await client.query(
        "UPDATE scheduled_refreshes SET state = 'cancelled', message = 'Changed by you.', progress = NULL, updated_at = now() WHERE campaign_id = $1 AND state IN ('waiting', 'refreshing', 'held')", [id]);
    }
    await client.query(
      `INSERT INTO campaign_operations (campaign_id, operation, reference) VALUES ($1, $2, $3)
       ON CONFLICT (campaign_id, operation, reference) DO UPDATE SET recorded_at = now()`,
      [id, action, sendAt ?? ''],
    );
    const descriptions = { start: 'Newsletter send started', pause: 'Newsletter send paused', schedule: 'Newsletter scheduled' };
    await client.query('INSERT INTO activity (description, href) VALUES ($1, $2)', [descriptions[action], '/campaigns']);
    return result;
  });
  if (action === 'schedule' && changed.status === 'scheduled' && (changed.sendAt ?? sendAt)) {
    // The sweep also finds scheduled campaigns, so a failure here only delays the record.
    await registerRefresh(id, (changed.sendAt ?? sendAt)!).catch(error => logError('campaign-refresh-register', error));
  }
  return segmentSync?.segments.length ? { ...changed, segmentSync } : changed;
}

export type SegmentSyncDeps = {
  mappings(listIds: number[]): Promise<{ segmentId: number; listId: number }[]>;
  segments(): Promise<{ id: number; name: string; published: boolean }[]>;
  members(segmentId: number, page: number): Promise<{ ids: number[]; total: number; limit: number }>;
  listSubscribers(listId: number, page: number): Promise<Page<{ id: number; email: string; mauticId: number | null }>>;
  syncContact(contactId: number): Promise<void>;
  /** Authoritative check against the segment itself. A contact that no longer exists is not a member. */
  isMember(contactId: number, segmentId: number): Promise<boolean>;
  /** Takes one subscriber off the mirror list. A subscriber that no longer exists counts as removed. */
  removeFromList(subscriberId: number, listId: number): Promise<void>;
  /** Queues the normal background segment sync for segments too large to refresh inline. */
  deferSync(segmentId: number): Promise<void>;
};

const segmentSyncDeps: SegmentSyncDeps = {
  async mappings(listIds) {
    const rows = await db.query<{ segment_id: string; list_id: string }>(
      'SELECT segment_id, list_id FROM segment_lists WHERE list_id = ANY($1::bigint[]) ORDER BY segment_id', [listIds]);
    return rows.rows.map(row => ({ segmentId: Number(row.segment_id), listId: Number(row.list_id) }));
  },
  segments: () => mautic.segments(),
  async members(segmentId, page) {
    const result = await mautic.contacts({ segmentId, page, limit: 100 });
    return { ids: result.items.map(item => item.id), total: result.total, limit: result.limit };
  },
  listSubscribers: (listId, page) => listmonk.listSubscribers(listId, page, 100),
  syncContact,
  async isMember(contactId, segmentId) {
    try {
      return (await mautic.contactSegments(contactId)).some(segment => segment.id === segmentId && segment.published);
    } catch (error) {
      if ((error as { status?: number }).status === 404) return false;
      throw error;
    }
  },
  async removeFromList(subscriberId, listId) {
    try {
      await listmonk.removeSubscriberFromLists(subscriberId, [listId]);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  },
  deferSync: segmentId => enqueue('segment_sync', segmentId + ':1', { segmentId, page: 1 }),
};
// Segments up to this size are refreshed inside the start request; larger ones keep the pre-Phase 1 behaviour
// (start from the last background sync) so a big audience never blocks or stalls a send.
export const inlineSyncLimit = 1000;
const syncPageLimit = 200;
const syncParallel = 5;

async function inGroups<T>(items: T[], work: (item: T) => Promise<void>) {
  const failures: unknown[] = [];
  for (let at = 0; at < items.length; at += syncParallel) {
    const results = await Promise.allSettled(items.slice(at, at + syncParallel).map(work));
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
  }
  return failures;
}

export type StaleEntry = { subscriberId: number; mauticId: number | null };

/**
 * Takes mirror-list subscribers off the list when they are no longer in the segment. `syncContact` may do this, but it
 * returns early for contacts without consent state, deleted contacts and changed emails, so removal never relies on it:
 * each entry is re-checked against the segment and the subscription is removed directly. A subscriber without a contact
 * id cannot be in the segment, so it is removed. Entries that are still members are kept (paging can drift).
 */
export async function removeStale(entries: StaleEntry[], segmentId: number, listId: number,
  deps: Pick<SegmentSyncDeps, 'syncContact' | 'isMember' | 'removeFromList'>) {
  const done: StaleEntry[] = [];
  let removed = 0;
  let failed = 0;
  for (let at = 0; at < entries.length; at += syncParallel) {
    const group = entries.slice(at, at + syncParallel);
    const results = await Promise.allSettled(group.map(async entry => {
      if (entry.mauticId !== null) {
        // Propagates consent and re-adds a contact that is still a member; its own failure is not decisive.
        await deps.syncContact(entry.mauticId).catch(error => logError('campaign-segment-sync', error));
        if (await deps.isMember(entry.mauticId, segmentId)) return false;
      }
      await deps.removeFromList(entry.subscriberId, listId);
      return true;
    }));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failed++;
        logError('campaign-segment-sync', result.reason);
      } else {
        done.push(group[index]);
        if (result.value) removed++;
      }
    });
  }
  return { done, removed, failed };
}

/**
 * Brings every segment-backed list of a campaign up to date before it starts. Segment members are added to
 * the list, and list subscribers that have left the segment are removed. Any failure throws, so the caller never starts.
 */
export async function syncCampaignSegments(listIds: number[], deps: SegmentSyncDeps = segmentSyncDeps): Promise<SegmentSyncReport> {
  const mapped = listIds.length ? await deps.mappings(listIds) : [];
  if (!mapped.length) return { segments: [] };
  const known = await deps.segments();
  const report: SegmentSyncReport = { segments: [] };
  for (const { segmentId, listId } of mapped) {
    const segment = known.find(item => item.id === segmentId);
    const label = segment?.name ?? 'Segment ' + segmentId;
    if (!segment?.published) {
      throw new AppError(409, `The segment "${label}" is no longer published, so its recipients cannot be refreshed. The newsletter was not started.`);
    }
    const fail = (detail: string): never => {
      throw new AppError(502, `Could not refresh the segment "${label}": ${detail} The newsletter was not started.`);
    };
    try {
      const members = new Set<number>();
      let deferred = false;
      for (let page = 1; ; page++) {
        const result = await deps.members(segmentId, page);
        if (page === 1 && result.total > inlineSyncLimit) {
          await deps.deferSync(segmentId);
          report.segments.push({ segmentId, name: label, members: result.total, removed: 0, deferred: true });
          deferred = true;
          break;
        }
        for (const contactId of result.ids) members.add(contactId);
        if (!result.ids.length || page * result.limit >= result.total) break;
      }
      if (deferred) continue;
      const failed = await inGroups([...members], contactId => deps.syncContact(contactId));
      if (failed.length) {
        logError('campaign-segment-sync', failed[0]);
        fail(`${failed.length} of ${members.size} contacts could not be updated.`);
      }
      const stale: StaleEntry[] = [];
      for (let page = 1; ; page++) {
        const result = await deps.listSubscribers(listId, page);
        for (const subscriber of result.items) {
          if (subscriber.mauticId === null || !members.has(subscriber.mauticId)) stale.push({ subscriberId: subscriber.id, mauticId: subscriber.mauticId });
        }
        if (!result.items.length || page * result.limit >= result.total) break;
        if (page >= syncPageLimit) fail('its newsletter list is too large to check before sending.');
      }
      const outcome = await removeStale(stale, segmentId, listId, deps);
      if (outcome.failed) fail(`${outcome.failed} contacts who left the segment could not be removed.`);
      report.segments.push({ segmentId, name: label, members: members.size, removed: outcome.removed });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logError('campaign-segment-sync', error);
      fail('the audience service did not respond.');
    }
  }
  return report;
}

/* ── Pre-send refresh for scheduled campaigns (DEL-22) ──────────────────────── */

// Listmonk starts a scheduled campaign on its next scan (every 5 s) once send_at has passed, and a scheduled campaign
// can only go back to draft, never be edited in flight (refs/listmonk internal/core/campaigns.go:250-303,
// queries/campaigns.sql:186, cmd/init.go:615). So the refresh must finish before send_at, or the campaign is held.

/** The refresh opens this long before `send_at`. */
export const refreshLeadMs = 10 * 60_000;
/** A refresh still unfinished this close to `send_at` moves the campaign back to draft. Must exceed the worker tick (30 s) plus Listmonk's scan (5 s). */
export const holdMarginMs = 2 * 60_000;
const refreshBudgetMs = 20_000;
const refreshMaxErrors = 3;
const refreshBatch = 100;
const refreshScanPages = 5000;
const refreshActive: RefreshState[] = ['waiting', 'refreshing', 'held'];

export type RefreshState = PreSendRefreshState | 'cancelled';
type SegmentProgress = {
  segmentId: number; listId: number; name: string;
  /** members: sync every segment member. scan: find list subscribers that left. remove: take them off the list. */
  phase: 'members' | 'scan' | 'remove' | 'done';
  page: number; members: number; removed: number;
};
export type RefreshRecord = {
  campaignId: number; sendAt: string; state: RefreshState;
  /** Changes on every (re)schedule. Work carrying an older run id is stale and stops. */
  runId: string;
  progress: SegmentProgress[] | null; errors: number; message: string; updatedAt: string;
};
export type CampaignRefreshJob = { campaignId: number; runId: string };

export type RefreshStore = {
  get(campaignId: number): Promise<RefreshRecord | undefined>;
  byCampaigns(campaignIds: number[]): Promise<RefreshRecord[]>;
  active(): Promise<RefreshRecord[]>;
  /** Starts a new run when the send time differs or the last run is over; an active run for the same time is left alone. */
  register(campaignId: number, sendAt: string): Promise<void>;
  /** Changes a record only while it still belongs to this run and is in one of the `from` states. Returns false if not. */
  update(record: Pick<RefreshRecord, 'campaignId' | 'runId'>, patch: Partial<Pick<RefreshRecord, 'state' | 'progress' | 'errors' | 'message'>>, from?: RefreshState[]): Promise<boolean>;
  cancel(campaignId: number, message: string): Promise<void>;
  remember(runId: string, segmentId: number, ids: number[]): Promise<void>;
  notMembers(runId: string, segmentId: number, ids: number[]): Promise<number[]>;
  rememberStale(runId: string, segmentId: number, entries: StaleEntry[]): Promise<void>;
  staleBatch(runId: string, segmentId: number, limit: number): Promise<StaleEntry[]>;
  forgetStale(runId: string, segmentId: number, subscriberIds: number[]): Promise<void>;
  clear(runId: string): Promise<void>;
  prune(): Promise<void>;
  /** Runs `work` only if no other worker is advancing this campaign. The lock is released if the worker dies. */
  lock<T>(campaignId: number, work: () => Promise<T>): Promise<T | undefined>;
};

export type RefreshDeps = {
  store: RefreshStore;
  now(): number;
  /** Undefined when the campaign no longer exists. */
  campaign(id: number): Promise<Campaign | undefined>;
  scheduled(): Promise<Campaign[]>;
  hold(id: number): Promise<unknown>;
  resume(id: number): Promise<unknown>;
  pause(id: number): Promise<unknown>;
  /** Serialises with `changeCampaign`, so a user action and a hold or resume never interleave. */
  locked<T>(id: number, work: () => Promise<T>): Promise<T>;
  sync: Pick<SegmentSyncDeps, 'mappings' | 'segments' | 'members' | 'listSubscribers' | 'syncContact' | 'isMember' | 'removeFromList'>;
  activity(description: string, href: string): Promise<void>;
  queue(job: CampaignRefreshJob): Promise<void>;
  budgetMs?: number;
  /** Most pages one slice may process (default: only the time budget limits a slice). */
  maxSteps?: number;
};

class Superseded extends Error {}
class RefreshFailure extends Error {
  constructor(message: string, readonly permanent = false) { super(message); }
}

type RefreshRow = {
  campaign_id: string; send_at: Date; state: RefreshState; run_id: string; progress: SegmentProgress[] | null;
  errors: number; message: string; updated_at: Date;
};
const refreshColumns = 'campaign_id, send_at, state, run_id, progress, errors, message, updated_at';
const toRecord = (row: RefreshRow): RefreshRecord => ({
  campaignId: Number(row.campaign_id), sendAt: row.send_at.toISOString(), state: row.state, runId: row.run_id,
  progress: row.progress, errors: row.errors, message: row.message, updatedAt: row.updated_at.toISOString(),
});

export const refreshStore: RefreshStore = {
  async get(campaignId) {
    const result = await db.query<RefreshRow>(`SELECT ${refreshColumns} FROM scheduled_refreshes WHERE campaign_id = $1`, [campaignId]);
    return result.rows[0] ? toRecord(result.rows[0]) : undefined;
  },
  async byCampaigns(campaignIds) {
    if (!campaignIds.length) return [];
    const result = await db.query<RefreshRow>(`SELECT ${refreshColumns} FROM scheduled_refreshes WHERE campaign_id = ANY($1::bigint[])`, [campaignIds]);
    return result.rows.map(toRecord);
  },
  async active() {
    const result = await db.query<RefreshRow>(
      `SELECT ${refreshColumns} FROM scheduled_refreshes WHERE state = ANY($1::text[]) ORDER BY send_at LIMIT 200`, [refreshActive]);
    return result.rows.map(toRecord);
  },
  async register(campaignId, sendAt) {
    await transaction(async client => {
      const before = await client.query<{ run_id: string }>('SELECT run_id FROM scheduled_refreshes WHERE campaign_id = $1 FOR UPDATE', [campaignId]);
      const changed = await client.query(
        `INSERT INTO scheduled_refreshes (campaign_id, send_at, state, run_id) VALUES ($1, $2, 'waiting', $3)
         ON CONFLICT (campaign_id) DO UPDATE SET send_at = EXCLUDED.send_at, state = 'waiting', run_id = EXCLUDED.run_id,
           progress = NULL, errors = 0, message = '', updated_at = now()
         WHERE scheduled_refreshes.send_at <> EXCLUDED.send_at OR scheduled_refreshes.state NOT IN ('waiting', 'refreshing', 'held')
         RETURNING 1`,
        [campaignId, sendAt, randomUUID()],
      );
      if (changed.rowCount && before.rows[0]) await client.query('DELETE FROM scheduled_refresh_contacts WHERE run_id = $1', [before.rows[0].run_id]);
    });
  },
  async update(record, patch, from = refreshActive) {
    const values: unknown[] = [record.campaignId, record.runId, from];
    const sets: string[] = [];
    const set = (column: string, value: unknown, cast = '') => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
    if (patch.state !== undefined) set('state', patch.state);
    if (patch.progress !== undefined) set('progress', patch.progress === null ? null : JSON.stringify(patch.progress), '::jsonb');
    if (patch.errors !== undefined) set('errors', patch.errors);
    if (patch.message !== undefined) set('message', patch.message);
    const result = await db.query(
      `UPDATE scheduled_refreshes SET ${[...sets, 'updated_at = now()'].join(', ')}
       WHERE campaign_id = $1 AND run_id = $2 AND state = ANY($3::text[]) RETURNING 1`, values);
    return Boolean(result.rowCount);
  },
  async cancel(campaignId, message) {
    await db.query(
      `UPDATE scheduled_refreshes SET state = 'cancelled', message = $2, progress = NULL, updated_at = now()
       WHERE campaign_id = $1 AND state = ANY($3::text[])`, [campaignId, message, refreshActive]);
  },
  async remember(runId, segmentId, ids) {
    if (!ids.length) return;
    await db.query(
      `INSERT INTO scheduled_refresh_contacts (run_id, segment_id, kind, contact_id)
       SELECT $1, $2, 'member', unnest($3::bigint[]) ON CONFLICT DO NOTHING`, [runId, segmentId, ids]);
  },
  async notMembers(runId, segmentId, ids) {
    if (!ids.length) return [];
    const result = await db.query<{ id: string }>(
      `SELECT id FROM unnest($3::bigint[]) AS id WHERE NOT EXISTS (
         SELECT 1 FROM scheduled_refresh_contacts WHERE run_id = $1 AND segment_id = $2 AND contact_id = id AND kind = 'member')`,
      [runId, segmentId, ids]);
    return result.rows.map(row => Number(row.id));
  },
  async rememberStale(runId, segmentId, entries) {
    if (!entries.length) return;
    await db.query(
      `INSERT INTO scheduled_refresh_contacts (run_id, segment_id, kind, contact_id, mautic_id)
       SELECT $1, $2, 'stale', subscriber, NULLIF(contact, 0)
       FROM unnest($3::bigint[], $4::bigint[]) AS entry(subscriber, contact) ON CONFLICT DO NOTHING`,
      [runId, segmentId, entries.map(entry => entry.subscriberId), entries.map(entry => entry.mauticId ?? 0)]);
  },
  async staleBatch(runId, segmentId, limit) {
    const result = await db.query<{ contact_id: string; mautic_id: string | null }>(
      `SELECT contact_id, mautic_id FROM scheduled_refresh_contacts WHERE run_id = $1 AND segment_id = $2 AND kind = 'stale'
       ORDER BY contact_id LIMIT $3`, [runId, segmentId, limit]);
    return result.rows.map(row => ({ subscriberId: Number(row.contact_id), mauticId: row.mautic_id === null ? null : Number(row.mautic_id) }));
  },
  async forgetStale(runId, segmentId, subscriberIds) {
    await db.query("DELETE FROM scheduled_refresh_contacts WHERE run_id = $1 AND segment_id = $2 AND kind = 'stale' AND contact_id = ANY($3::bigint[])", [runId, segmentId, subscriberIds]);
  },
  async clear(runId) {
    await db.query('DELETE FROM scheduled_refresh_contacts WHERE run_id = $1', [runId]);
  },
  async prune() {
    await db.query(
      `DELETE FROM scheduled_refresh_contacts c WHERE NOT EXISTS (
         SELECT 1 FROM scheduled_refreshes r WHERE r.run_id = c.run_id AND r.state IN ('refreshing', 'held'))`);
    await db.query("DELETE FROM scheduled_refreshes WHERE state NOT IN ('waiting', 'refreshing', 'held') AND updated_at < now() - interval '60 days'");
  },
  async lock(campaignId, work) {
    const client = await db.connect();
    let held = false;
    try {
      const got = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', [64339, String(campaignId)]);
      held = got.rows[0]?.ok === true;
      if (!held) return undefined;
      return await work();
    } finally {
      if (held) await client.query('SELECT pg_advisory_unlock($1, hashtext($2))', [64339, String(campaignId)]).catch(() => {});
      client.release();
    }
  },
};

/** The same per-campaign lock `changeCampaign` takes. */
async function lockedCampaign<T>(id: number, work: () => Promise<T>): Promise<T> {
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [64338, String(id)]);
    return work();
  });
}

async function readCampaign(id: number) {
  try {
    return await listmonk.campaign(id);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}

const refreshDeps: RefreshDeps = {
  store: refreshStore,
  now: () => Date.now(),
  campaign: readCampaign,
  async scheduled() {
    const items: Campaign[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await listmonk.campaigns({ page, limit: 100, status: ['scheduled'] });
      items.push(...batch.items);
      if (!batch.items.length || items.length >= batch.total) break;
    }
    return items;
  },
  hold: id => listmonk.cancelSchedule(id),
  resume: id => listmonk.resumeSchedule(id),
  pause: id => listmonk.pauseCampaign(id),
  locked: lockedCampaign,
  sync: segmentSyncDeps,
  activity: recordActivity,
  queue: job => enqueue('campaign_refresh', String(job.campaignId), job),
};

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16) + ' UTC';
const href = (id: number) => `/campaigns/${id}`;
const sentence = (text: string) => /[.!?]$/.test(text) ? text : text + '.';

/** Starts (or restarts) the pre-send refresh for a campaign scheduled at `sendAt`. Safe to repeat. */
export async function registerRefresh(campaignId: number, sendAt: string, deps: RefreshDeps = refreshDeps) {
  await deps.store.register(campaignId, new Date(sendAt).toISOString());
}

/** Forgets a refresh, for example when the newsletter is deleted. */
export async function forgetRefresh(campaignId: number) {
  await db.query('DELETE FROM scheduled_refreshes WHERE campaign_id = $1', [campaignId]);
}

async function holdForRefresh(record: RefreshRecord, deps: RefreshDeps) {
  return deps.locked(record.campaignId, async () => {
    const campaign = await deps.campaign(record.campaignId);
    if (campaign?.status !== 'scheduled') return false;
    await deps.hold(record.campaignId);
    const message = 'The send time is close and the segment is still refreshing, so this newsletter was moved back to draft. It starts as soon as the refresh finishes.';
    await deps.store.update(record, { state: 'held', message }, ['refreshing']);
    await deps.activity(`Scheduled newsletter "${campaign.name}" is held while its recipients finish refreshing`, href(record.campaignId));
    return true;
  });
}

async function failRefresh(record: RefreshRecord, reason: string, deps: RefreshDeps) {
  await deps.locked(record.campaignId, async () => {
    const campaign = await deps.campaign(record.campaignId);
    // Nothing may send from a half-refreshed list: unschedule it, or pause it if it already started.
    if (campaign?.status === 'scheduled') await deps.hold(record.campaignId);
    else if (campaign?.status === 'running') await deps.pause(record.campaignId);
    const message = `Recipients could not be refreshed before the scheduled send: ${sentence(reason)} The newsletter was not sent. Fix the problem, then schedule it again.`;
    await deps.store.update(record, { state: 'failed', message, progress: null }, ['refreshing', 'held']);
    await deps.activity(`Scheduled newsletter "${campaign?.name ?? record.campaignId}" was not sent: its recipients could not be refreshed`, href(record.campaignId));
  });
  await deps.store.clear(record.runId);
}

async function syncAll(ids: number[], deps: RefreshDeps) {
  let pending = ids;
  for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
    const failed: number[] = [];
    for (let at = 0; at < pending.length; at += syncParallel) {
      const group = pending.slice(at, at + syncParallel);
      const results = await Promise.allSettled(group.map(id => deps.sync.syncContact(id)));
      results.forEach((result, index) => { if (result.status === 'rejected') failed.push(group[index]); });
    }
    pending = failed;
  }
  return pending.length;
}

async function planRefresh(campaign: Campaign, deps: RefreshDeps): Promise<SegmentProgress[]> {
  const mapped = campaign.listIds.length ? await deps.sync.mappings(campaign.listIds) : [];
  if (!mapped.length) return [];
  const known = await deps.sync.segments();
  return mapped.map(({ segmentId, listId }) => {
    const segment = known.find(item => item.id === segmentId);
    const name = segment?.name ?? 'Segment ' + segmentId;
    if (!segment?.published) throw new RefreshFailure(`the segment "${name}" is no longer published.`, true);
    return { segmentId, listId, name, phase: 'members', page: 1, members: 0, removed: 0 };
  });
}

async function advanceSegment(record: RefreshRecord, segment: SegmentProgress, deps: RefreshDeps) {
  const { store, sync } = deps;
  const label = `"${segment.name}"`;
  if (segment.phase === 'members') {
    const result = await sync.members(segment.segmentId, segment.page);
    await store.remember(record.runId, segment.segmentId, result.ids);
    const failed = await syncAll(result.ids, deps);
    if (failed) throw new RefreshFailure(`${failed} contacts of ${label} could not be updated.`);
    segment.members += result.ids.length;
    if (!result.ids.length || segment.page * result.limit >= result.total) Object.assign(segment, { phase: 'scan', page: 1 });
    else segment.page++;
  } else if (segment.phase === 'scan') {
    const result = await sync.listSubscribers(segment.listId, segment.page);
    const seen = result.items.flatMap(item => item.mauticId === null ? [] : [item.mauticId]);
    const outside = new Set(await store.notMembers(record.runId, segment.segmentId, seen));
    // A subscriber without a contact id cannot be in the segment, so it is stale too.
    const stale = result.items.filter(item => item.mauticId === null || outside.has(item.mauticId));
    await store.rememberStale(record.runId, segment.segmentId, stale.map(item => ({ subscriberId: item.id, mauticId: item.mauticId })));
    if (!result.items.length || segment.page * result.limit >= result.total) Object.assign(segment, { phase: 'remove', page: 1 });
    else if (segment.page >= refreshScanPages) throw new RefreshFailure(`its newsletter list ${label} is too large to check before sending.`);
    else segment.page++;
  } else if (segment.phase === 'remove') {
    const batch = await store.staleBatch(record.runId, segment.segmentId, refreshBatch);
    if (!batch.length) {
      segment.phase = 'done';
      return;
    }
    const outcome = await removeStale(batch, segment.segmentId, segment.listId, sync);
    await store.forgetStale(record.runId, segment.segmentId, outcome.done.map(entry => entry.subscriberId));
    segment.removed += outcome.removed;
    if (outcome.failed) throw new RefreshFailure(`${outcome.failed} contacts who left ${label} could not be removed.`);
  }
}

/** Does a time-boxed slice of the refresh. Returns true once every segment is finished. */
async function refreshSlice(record: RefreshRecord, campaign: Campaign, deps: RefreshDeps) {
  const deadline = deps.now() + (deps.budgetMs ?? refreshBudgetMs);
  const progress = record.progress ?? await planRefresh(campaign, deps);
  const save = async () => {
    if (!await deps.store.update(record, { progress, errors: 0 }, ['refreshing', 'held'])) throw new Superseded();
  };
  if (!record.progress) await save();
  let steps = 0;
  for (const segment of progress) {
    while (segment.phase !== 'done') {
      if (deps.now() >= deadline || steps++ >= (deps.maxSteps ?? Infinity)) return false;
      await advanceSegment(record, segment, deps);
      await save();
    }
  }
  return true;
}

async function finishRefresh(record: RefreshRecord, deps: RefreshDeps) {
  await deps.locked(record.campaignId, async () => {
    const campaign = await deps.campaign(record.campaignId);
    const sendMs = Date.parse(record.sendAt);
    const now = deps.now();
    if (record.state === 'held') {
      if (campaign?.status !== 'draft' || !campaign.sendAt) {
        await deps.store.cancel(record.campaignId, 'The schedule was changed while the refresh was running.');
        return;
      }
      await deps.resume(record.campaignId);
      const late = now > sendMs;
      const minutes = Math.max(1, Math.round((now - sendMs) / 60_000));
      const message = late
        ? `Sent late: the segment refresh finished ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} after the scheduled time (${clock(sendMs)}), so sending started immediately. The refresh runs 10 minutes before the send time, and this segment needed longer.`
        : '';
      await deps.store.update(record, { state: late ? 'late' : 'ready', message, progress: null }, ['held']);
      await deps.activity(late
        ? `Newsletter "${campaign.name}" started late: its segment refresh finished after the scheduled time`
        : `Held newsletter "${campaign.name}" is back on its schedule: recipients are refreshed`, href(record.campaignId));
    } else if (campaign?.status === 'scheduled') {
      await deps.store.update(record, { state: 'ready', message: '', progress: null }, ['refreshing']);
    }
  });
  await deps.store.clear(record.runId);
}

/**
 * Worker job: advances one campaign's pre-send refresh by a time-boxed slice. Idempotent (every step can be
 * repeated), resumable from the saved cursor, and exclusive per campaign across workers.
 */
export async function runCampaignRefresh(campaignId: number, runId: string, deps: RefreshDeps = refreshDeps) {
  await deps.store.lock(campaignId, async () => {
    let record = await deps.store.get(campaignId);
    if (!record || record.runId !== runId || (record.state !== 'refreshing' && record.state !== 'held')) return;
    const campaign = await deps.campaign(campaignId);
    if (!campaign) {
      await deps.store.cancel(campaignId, 'The newsletter no longer exists.');
      await deps.store.clear(runId);
      return;
    }
    const sendMs = Date.parse(record.sendAt);
    if (campaign.sendAt && Date.parse(campaign.sendAt) !== sendMs && ['scheduled', 'draft'].includes(campaign.status)) {
      await deps.store.register(campaignId, campaign.sendAt); // Rescheduled elsewhere: start a fresh run for the new time.
      await deps.store.clear(runId);
      return;
    }
    const expected = record.state === 'held' ? 'draft' : 'scheduled';
    if (campaign.status !== expected || (expected === 'draft' && !campaign.sendAt)) {
      if (record.state === 'refreshing' && ['running', 'finished'].includes(campaign.status)) {
        const message = 'Sending began before the recipient refresh finished, so recipients come from the last sync. Check the worker is running.';
        await deps.store.update(record, { state: 'missed', message, progress: null }, ['refreshing']);
        await deps.activity(`Scheduled newsletter "${campaign.name}" started before its recipients were refreshed`, href(campaignId));
      } else {
        await deps.store.cancel(campaignId, 'The schedule was changed while the refresh was running.');
      }
      await deps.store.clear(runId);
      return;
    }
    if (record.errors >= refreshMaxErrors) {
      await failRefresh(record, 'the audience service kept failing.', deps);
      return;
    }
    if (record.state === 'refreshing' && deps.now() >= sendMs - holdMarginMs) {
      if (!await holdForRefresh(record, deps)) return;
      record = { ...record, state: 'held' };
    }
    try {
      if (!await refreshSlice(record, campaign, deps)) {
        await deps.queue({ campaignId, runId });
        return;
      }
    } catch (error) {
      if (error instanceof Superseded) return;
      logError('campaign-refresh', error);
      const failure = error instanceof RefreshFailure ? error : undefined;
      const errors = record.errors + 1;
      if (failure?.permanent || errors >= refreshMaxErrors) {
        await failRefresh(record, failure?.message ?? 'the audience service did not respond.', deps);
      } else {
        await deps.store.update(record, { errors }, ['refreshing', 'held']); // The next sweep tries again.
      }
      return;
    }
    await finishRefresh(record, deps);
  });
}

/**
 * Worker housekeeping (every tick): finds scheduled campaigns, opens each refresh `refreshLeadMs` before its send
 * time, holds campaigns whose refresh is running out of time, and queues the work. Idempotent.
 */
export async function sweepScheduledRefreshes(deps: RefreshDeps = refreshDeps) {
  const { store } = deps;
  try {
    const scheduled = (await deps.scheduled()).filter(item => item.sendAt);
    const records = new Map((await store.byCampaigns(scheduled.map(item => item.id))).map(item => [item.campaignId, item]));
    for (const item of scheduled) {
      const known = records.get(item.id);
      if (!known || Date.parse(known.sendAt) !== Date.parse(item.sendAt!)) await store.register(item.id, item.sendAt!);
    }
  } catch (error) {
    logError('campaign-refresh-discover', error);
  }
  for (const found of await store.active()) {
    try {
      let record = found;
      const sendMs = Date.parse(record.sendAt);
      const now = deps.now();
      if (record.state === 'waiting') {
        if (now < sendMs - refreshLeadMs) continue;
        if (!await store.update(record, { state: 'refreshing' }, ['waiting'])) continue;
        record = { ...record, state: 'refreshing' };
      }
      // Done here, not in the job, so a busy job queue cannot delay it past the send time.
      if (record.state === 'refreshing' && now >= sendMs - holdMarginMs) await holdForRefresh(record, deps);
      await deps.queue({ campaignId: record.campaignId, runId: record.runId });
    } catch (error) {
      logError('campaign-refresh-sweep', error);
    }
  }
  await store.prune().catch(error => logError('campaign-refresh-prune', error));
}

/** Attaches each campaign's pre-send refresh state for the console. */
export async function withPreSendRefresh<T extends Campaign>(items: T[], read: (ids: number[]) => Promise<RefreshRecord[]> = ids => refreshStore.byCampaigns(ids)): Promise<T[]> {
  const ids = items.filter(item => item.sendAt || item.status === 'draft').map(item => item.id);
  if (!ids.length) return items;
  let records: Map<number, RefreshRecord>;
  try {
    records = new Map((await read(ids)).map(record => [record.campaignId, record]));
  } catch (error) {
    logError('campaign-refresh-read', error);
    return items;
  }
  return items.map(item => {
    const record = records.get(item.id);
    if (!record || record.state === 'cancelled') return item;
    if (refreshActive.includes(record.state) && !['scheduled', 'draft'].includes(item.status)) return item;
    const sendMs = Date.parse(record.sendAt);
    return {
      ...item,
      preSendRefresh: {
        state: record.state as PreSendRefreshState, sendAt: record.sendAt,
        refreshFrom: new Date(sendMs - refreshLeadMs).toISOString(), message: record.message, updatedAt: record.updatedAt,
      },
    };
  });
}

/* ── Unsubscribe handling (DEL-07) and per-campaign counts (DEL-21) ─────────── */

export type UnsubscribeScope = 'lists' | 'everything' | 'preferences';
const truthy = (value: string | null) => value === 'true' || value === '1' || value === 'on';

/**
 * Decides what an unsubscribe POST means. A bare one-click POST (RFC 8058 sends only List-Unsubscribe=One-Click)
 * leaves the campaign's lists. Blocklisting everything needs an explicit field, and the preferences page sends manage.
 */
export function unsubscribeRequest(form: URLSearchParams): { scope: UnsubscribeScope; body: URLSearchParams } {
  if (truthy(form.get('blocklist')) || truthy(form.get('everything'))) {
    return { scope: 'everything', body: new URLSearchParams({ blocklist: 'true' }) };
  }
  if (truthy(form.get('manage'))) {
    const body = new URLSearchParams({ manage: 'true', name: (form.get('name') ?? '').slice(0, 256) });
    for (const list of form.getAll('l').slice(0, 100)) if (/^[A-Fa-f0-9-]{36}$/.test(list)) body.append('l', list);
    return { scope: 'preferences', body };
  }
  return { scope: 'lists', body: new URLSearchParams() };
}

type UnsubscribeOptions = {
  base?: string;
  transport?: typeof fetch;
  record?: (campaign: string, subscriber: string, scope: 'lists' | 'everything') => Promise<void>;
};

async function recordUnsubscribe(campaign: string, subscriber: string, scope: 'lists' | 'everything') {
  await db.query(
    `INSERT INTO campaign_unsubscribes (campaign_uuid, subscriber_uuid, scope) VALUES ($1, $2, $3)
     ON CONFLICT (campaign_uuid, subscriber_uuid) DO UPDATE
     SET scope = CASE WHEN EXCLUDED.scope = 'everything' THEN 'everything' ELSE campaign_unsubscribes.scope END`,
    [campaign, subscriber, scope],
  );
}

/** Forwards an unsubscribe to Listmonk and, once it succeeds, counts it against the campaign. */
export async function unsubscribe(ids: { campaign: string; subscriber: string }, form: URLSearchParams, options: UnsubscribeOptions = {}) {
  const base = options.base ?? process.env.LISTMONK_URL;
  if (!base) return { status: 503, error: 'Unsubscribe is temporarily unavailable.' };
  const { scope, body } = unsubscribeRequest(form);
  try {
    const response = await (options.transport ?? fetch)(new URL('/subscription/' + ids.campaign + '/' + ids.subscriber, base), {
      method: 'POST', body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      return { status: response.status === 404 ? 404 : response.status === 400 ? 400 : 502, error: 'The unsubscribe request could not be completed. Check the link and try again.' };
    }
    if (scope !== 'preferences') {
      try {
        await (options.record ?? recordUnsubscribe)(ids.campaign, ids.subscriber, scope);
      } catch (error) {
        // The unsubscribe has already happened, so a counting failure must not turn it into an error page.
        logError('campaign-unsubscribe-count', error);
      }
    }
    return {
      status: response.status, scope, body: await response.text(),
      contentType: response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
    };
  } catch {
    return { status: 503, error: 'Unsubscribe is temporarily unavailable. Please try again.' };
  }
}

async function countUnsubscribes(uuids: string[]) {
  const rows = await db.query<{ campaign_uuid: string; total: string }>(
    'SELECT campaign_uuid, count(*) AS total FROM campaign_unsubscribes WHERE campaign_uuid = ANY($1::uuid[]) GROUP BY campaign_uuid', [uuids]);
  return new Map(rows.rows.map(row => [row.campaign_uuid, Number(row.total)]));
}

/** Fills in the unsubscribe count that Listmonk does not keep per campaign. Leaves the reason in place if the count cannot be read. */
export async function withUnsubscribeCounts<T extends Campaign>(items: T[], count: (uuids: string[]) => Promise<Map<string, number>> = countUnsubscribes): Promise<T[]> {
  const uuids = items.flatMap(item => item.uuid ? [item.uuid] : []);
  if (!uuids.length) return items;
  let counts: Map<string, number>;
  try {
    counts = await count(uuids);
  } catch (error) {
    logError('campaign-unsubscribe-count', error);
    return items;
  }
  return items.map(item => {
    if (!item.uuid) return item;
    const unavailable = { ...item.metrics.unavailable };
    delete unavailable.unsubscribes;
    return { ...item, metrics: { ...item.metrics, unsubscribes: counts.get(item.uuid) ?? 0, unavailable } };
  });
}

export function aggregateEmailMetrics(items: { metrics: CampaignMetrics }[], complete = true): CampaignMetrics {
  const values = metricKeys.map(key => {
    const counts = items.map(item => item.metrics[key]);
    const tracked = key !== 'delivered';
    const total = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
    return [key, complete && (counts.length ? counts.every(count => count !== null) : tracked) ? total : null] as const;
  });
  return {
    ...Object.fromEntries(values) as Omit<CampaignMetrics, 'unavailable'>,
    unavailable: {
      delivered: 'Needs delivery feedback from your email provider. Listmonk only records sent and bounced.',
      ...(values.some(([key, value]) => key === 'unsubscribes' && value === null)
        ? { unsubscribes: 'Unsubscribes could not be counted for every newsletter right now.' } : {}),
    },
  };
}

const summaryPageLimit = 100;
const summaryMaxPages = 50;

/** Reads every campaign page by page. `complete` is false only if the safety limit stopped the read early. */
export async function allCampaigns(read: (options: { page: number; limit: number }) => Promise<Page<Campaign>> = async options => {
  const batch = await listmonk.campaigns(options);
  return { ...batch, items: await withUnsubscribeCounts(batch.items) };
}) {
  const items: Campaign[] = [];
  let total = 0;
  for (let page = 1; page <= summaryMaxPages; page++) {
    const batch = await read({ page, limit: summaryPageLimit });
    total = batch.total;
    items.push(...batch.items);
    if (!batch.items.length || items.length >= total) break;
  }
  return { items, total, complete: items.length >= total };
}

export async function campaignSummary(range: DateRange) {
  const [campaigns, active, running] = await Promise.all([
    allCampaigns(),
    listmonk.campaigns({ limit: 1, status: ['running', 'scheduled'] }),
    listmonk.runningCampaignStats().catch(() => []),
  ]);
  const ids = campaigns.complete ? campaigns.items.map(item => item.id) : null;
  const [trend, clicksTrend, bouncesTrend] = ids
    ? await Promise.all([
      listmonk.campaignTrend(ids, range, 'views').catch(() => null),
      listmonk.campaignTrend(ids, range, 'clicks').catch(() => null),
      listmonk.campaignTrend(ids, range, 'bounces').catch(() => null),
    ])
    : [null, null, null];
  return {
    active: active.total,
    running,
    email: aggregateEmailMetrics(campaigns.items, campaigns.complete),
    trend,
    clicksTrend,
    bouncesTrend,
  };
}

export function createRelay() {
  const host = requiredEnv('SMTP_RELAY_HOST');
  const mode = requiredEnv('SMTP_RELAY_TLS');
  if (!['starttls', 'smtps', 'local'].includes(mode)
      || (mode === 'local' && (host !== 'mailpit' || process.env.OVELIO_ENV === 'production'))) {
    throw new Error('The relay requires encrypted SMTP outside the private Mailpit service.');
  }
  const user = process.env.SMTP_RELAY_USERNAME;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_RELAY_PORT) || (mode === 'smtps' ? 465 : 587),
    secure: mode === 'smtps',
    requireTLS: mode === 'starttls',
    ignoreTLS: mode === 'local',
    auth: user ? { user, pass: requiredEnv('SMTP_RELAY_PASSWORD') } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 30000,
  });
}
