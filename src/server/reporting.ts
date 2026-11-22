import { resolveTxt } from 'node:dns/promises';
import type { CompanySettings, Dashboard, DateRange, Health, Settings } from '../contracts';
import { recentActivity } from './activity';
import { team } from './auth';
import { appOrigin, logError } from './config';
import { db } from './db';
import { aggregateEmailMetrics, campaignSummary } from './delivery';
import { deadJobs } from './jobs';
import { listmonk } from './listmonk';
import { mautic } from './mautic';
import { umami } from './umami';

const day = 86_400_000;
export function defaultRange(): DateRange {
  return { startAt: Math.floor(Date.now() / day) * day - 29 * day, endAt: Date.now() };
}

const defaults: CompanySettings = { name: 'OVELIO', website: '', accent: '#275ff0', privacyUrl: '', postalAddress: '' };

export async function company(): Promise<CompanySettings> {
  const result = await db.query<{ value: CompanySettings }>("SELECT value FROM settings WHERE key = 'company'");
  return { ...defaults, ...result.rows[0]?.value };
}

export async function saveCompany(input: CompanySettings) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('company', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(input)],
  );
  return input;
}

type WorkerStatus = { at: string; delivery: boolean };

async function workerHealth() {
  const state = (await db.query<{ value: WorkerStatus }>("SELECT value FROM settings WHERE key = 'worker'")).rows[0]?.value;
  const active = Boolean(state && Date.now() - Date.parse(state.at) < 120_000);
  const health: Health = active ? { status: 'ready' } : { status: 'unavailable', message: 'The job worker has not checked in. Start the background service.' };
  return { health, configured: !!(active && state?.delivery) };
}

function senderEnvironment() {
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? '';
  return {
    fromEmail,
    smtpHost: process.env.SMTP_RELAY_HOST ?? '',
    provider: process.env.SMTP_RELAY_TLS === 'local' ? 'Development inbox' : 'SMTP relay',
    domain: fromEmail.split('@').at(-1)?.toLowerCase() ?? '',
    selector: (process.env.SMTP_DKIM_SELECTOR ?? '').toLowerCase(),
  };
}

export async function senderDomain() {
  const { domain, selector } = senderEnvironment();
  async function hasRecord(host: string, prefix: string) {
    if (!domain || domain.endsWith('.test')) return false;
    try {
      return (await resolveTxt(host)).some(row => row.join('').toLowerCase().startsWith(prefix));
    } catch {
      return false;
    }
  }
  const [spf, dkim, dmarc] = await Promise.all([
    hasRecord(domain, 'v=spf1'), selector ? hasRecord(selector + '._domainkey.' + domain, 'v=dkim1') : false,
    hasRecord('_dmarc.' + domain, 'v=dmarc1'),
  ]);
  return { spf, dkim, dmarc, domain, selector };
}

export async function settings(includeTeam: boolean): Promise<Settings> {
  const [profile, audience, delivery, tracking, worker, users, failedJobs] = await Promise.all([
    company(), mautic.health(), listmonk.health(), umami.health(), workerHealth(), includeTeam ? team() : [],
    includeTeam ? deadJobs() : undefined,
  ]);
  const { fromEmail, smtpHost, provider } = senderEnvironment();
  const verifiedDomain = process.env.SMTP_VERIFIED_DOMAIN?.trim().toLowerCase() ?? '';
  return {
    company: profile, sender: {
      fromEmail, smtpHost, provider, configured: worker.configured,
      verifiedDomain: worker.configured && fromEmail.toLowerCase().endsWith('@' + verifiedDomain) ? verifiedDomain : '',
    },
    health: { audience, delivery, tracking, worker: worker.health },
    trackingOrigin: process.env.TRACKING_ORIGIN ? new URL(process.env.TRACKING_ORIGIN).origin : appOrigin(),
    team: users, failedJobs,
  };
}

async function available<T>(label: string, operation: Promise<T>): Promise<T | null> {
  try {
    return await operation;
  } catch (error) {
    logError(label, error);
    return null;
  }
}

export async function dashboard(): Promise<Dashboard> {
  const range = defaultRange();
  const [contacts, growth, newsletters, workflows, sites, leads, recent, dead] = await Promise.all([
    available('dashboard-contacts', mautic.contacts({ limit: 1 })),
    available('dashboard-contact-growth', mautic.contactGrowth(range)),
    available('dashboard-email', campaignSummary(range)),
    available('dashboard-workflows', mautic.workflows()),
    available('dashboard-sites', umami.websites()),
    available('dashboard-leads', mautic.leadCount(range)),
    recentActivity(),
    db.query("SELECT 1 FROM jobs WHERE status = 'dead' LIMIT 1"),
  ]);
  const site = sites?.[0];
  const [traffic, goals] = site ? await Promise.all([
    available('dashboard-traffic', umami.report(site.id, range, [])),
    available('dashboard-goals', umami.goals(site.id)),
  ]) : [null, null];
  const primary = goals?.[0];
  const conversions = site && primary ? await available('dashboard-conversions', umami.goalStats(site.id, primary.id, range)) : null;
  const alerts = [
    ...(contacts ? [] : [{ label: 'Check audience connection', href: '/settings' }]),
    ...(newsletters ? [] : [{ label: 'Check email delivery connection', href: '/settings' }]),
    ...(sites?.length ? [] : [{ label: sites ? 'Connect a website' : 'Check website tracking connection', href: sites ? '/analytics' : '/settings' }]),
    ...(site && goals?.length === 0 ? [{ label: 'Set a conversion goal', href: '/analytics' }] : []),
    ...(dead.rows.length ? [{ label: 'A background job needs attention', href: '/settings' }] : []),
  ];
  return {
    contacts: contacts?.total ?? null, contactGrowth: growth, activeCampaigns: newsletters?.active ?? null,
    activeWorkflows: workflows?.filter(item => item.enabled).length ?? null, email: newsletters?.email ?? aggregateEmailMetrics([], false),
    emailTrend: newsletters?.trend ?? null, visitors: traffic?.current?.visitors ?? null, websiteName: site?.name,
    traffic: traffic?.pageviews ?? null, leads, conversions: conversions?.unique ?? null, conversionGoal: primary?.name, recent, alerts,
  };
}
