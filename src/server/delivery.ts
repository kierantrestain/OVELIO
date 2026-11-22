import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import sanitize from 'sanitize-html';
import type { Campaign, CampaignInput, CampaignMetrics, CampaignStartResult, DateRange, Page, SegmentSyncReport, TransactionalEmailInput } from '../contracts';
import { recordActivity } from './activity';
import { checkRecipient, syncContact } from './audience';
import { enqueue } from './jobs';
import { AppError, logError, requiredEnv } from './config';
import { db, transaction } from './db';
import { listmonk } from './listmonk';
import { mautic } from './mautic';

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
  const body = contentType === 'plain' || contentType === 'markdown' ? input.body.trim() : mailContent(input.body, false, true);
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
    if (action === 'pause' && !['scheduled', 'running', 'paused'].includes(current.status)) {
      throw new AppError(409, 'This campaign has no active send or schedule to pause.');
    }
    if (action === 'schedule' && (!sendAt || Date.parse(sendAt) <= Date.now() + 60_000 || !['draft', 'scheduled'].includes(current.status))) {
      throw new AppError(409, 'Schedule a draft email for a time at least one minute in the future.');
    }
    const result = action === 'pause'
      ? current.status === 'scheduled' ? await listmonk.cancelSchedule(id) : await listmonk.pauseCampaign(id)
      : action === 'schedule' && sendAt ? await listmonk.scheduleCampaign(id, sendAt) : await listmonk.startCampaign(id);
    await client.query(
      `INSERT INTO campaign_operations (campaign_id, operation, reference) VALUES ($1, $2, $3)
       ON CONFLICT (campaign_id, operation, reference) DO UPDATE SET recorded_at = now()`,
      [id, action, sendAt ?? ''],
    );
    const descriptions = { start: 'Newsletter send started', pause: 'Newsletter send paused', schedule: 'Newsletter scheduled' };
    await client.query('INSERT INTO activity (description, href) VALUES ($1, $2)', [descriptions[action], '/campaigns']);
    return result;
  });
  return segmentSync?.segments.length ? { ...changed, segmentSync } : changed;
}

export type SegmentSyncDeps = {
  mappings(listIds: number[]): Promise<{ segmentId: number; listId: number }[]>;
  segments(): Promise<{ id: number; name: string; published: boolean }[]>;
  members(segmentId: number, page: number): Promise<{ ids: number[]; total: number; limit: number }>;
  listSubscribers(listId: number, page: number): Promise<Page<{ id: number; email: string; mauticId: number | null }>>;
  syncContact(contactId: number): Promise<void>;
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
      const stale: number[] = [];
      for (let page = 1; ; page++) {
        const result = await deps.listSubscribers(listId, page);
        for (const subscriber of result.items) {
          if (subscriber.mauticId !== null && !members.has(subscriber.mauticId)) stale.push(subscriber.mauticId);
        }
        if (!result.items.length || page * result.limit >= result.total) break;
        if (page >= syncPageLimit) fail('its newsletter list is too large to check before sending.');
      }
      const removedFailures = await inGroups(stale, contactId => deps.syncContact(contactId));
      if (removedFailures.length) {
        logError('campaign-segment-sync', removedFailures[0]);
        fail(`${removedFailures.length} contacts who left the segment could not be removed.`);
      }
      report.segments.push({ segmentId, name: label, members: members.size, removed: stale.length });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logError('campaign-segment-sync', error);
      fail('the audience service did not respond.');
    }
  }
  return report;
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
