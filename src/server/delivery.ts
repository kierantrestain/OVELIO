import nodemailer from 'nodemailer';
import sanitize from 'sanitize-html';
import type { CampaignInput, CampaignMetrics, DateRange } from '../contracts';
import { recordActivity } from './activity';
import { checkRecipient } from './audience';
import { AppError, requiredEnv } from './config';
import { db, transaction } from './db';
import { listmonk } from './listmonk';

const metricKeys: (keyof CampaignMetrics)[] = ['sent', 'delivered', 'opens', 'clicks', 'bounces', 'unsubscribes'];
const contentSlot = '{{ template "content" . }}';
const contentMarker = 'OVELIO_NEWSLETTER_CONTENT_SLOT';
const spacing = /^\d+(?:\.\d+)?(?:px|rem|em|%)?(?:\s+\d+(?:\.\d+)?(?:px|rem|em|%)?){0,3}$/;

export function mailContent(body: string, template = false) {
  const source = template ? body.replaceAll(contentSlot, contentMarker) : body;
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
  const safe = output.replaceAll('{{', '&#123;&#123;');
  return template ? safe.replaceAll(contentMarker, contentSlot) : safe;
}

export function approvedCampaign(input: CampaignInput): CampaignInput {
  const approved = requiredEnv('SMTP_FROM_EMAIL');
  if (input.fromEmail && input.fromEmail.toLowerCase() !== approved.toLowerCase()) {
    throw new AppError(400, 'Choose the configured sender email address.');
  }
  return { ...input, fromEmail: approved, body: mailContent(input.body) };
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

export async function changeCampaign(id: number, action: 'start' | 'pause' | 'schedule', sendAt?: string) {
  if (action !== 'pause') await assertDeliveryReady();
  return transaction(async client => {
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
}

export function aggregateEmailMetrics(items: { metrics: CampaignMetrics }[], complete = true): CampaignMetrics {
  const values = metricKeys.map(key => {
    const counts = items.map(item => item.metrics[key]);
    const tracked = key !== 'delivered' && key !== 'unsubscribes';
    const total = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
    return [key, complete && (counts.length ? counts.every(count => count !== null) : tracked) ? total : null] as const;
  });
  return Object.fromEntries(values) as CampaignMetrics;
}

export async function campaignSummary(range: DateRange) {
  const campaigns = await listmonk.campaigns({ limit: 100 });
  const active = await listmonk.campaigns({ limit: 1, status: ['running', 'scheduled'] });
  const trend = campaigns.total <= campaigns.items.length ?
    await listmonk.campaignTrend(campaigns.items.map(item => item.id), range).catch(() => null) : null;
  return { active: active.total, email: aggregateEmailMetrics(campaigns.items, campaigns.total <= campaigns.items.length), trend };
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
