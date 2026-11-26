// Deliverability report: sender authentication (SPF, DKIM, DMARC), bounce and complaint rates, suppression growth,
// list hygiene and broken links in a design. Every check reports a measured value or "unavailable" with the reason;
// nothing infers inbox placement from SMTP acceptance.
import { lookup } from 'node:dns';
import { resolveTxt } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import type { Campaign, Page } from '@/contracts';
import type { DeliverabilityCheck, LinkCheck } from '@/contracts/studio';
import { db } from '../db';
import { isDevPreviewMode } from '../dev-preview';

const percent = (value: number) => `${(Math.round(value * 1000) / 10).toLocaleString('en-GB')}%`;

async function txt(host: string): Promise<{ records: string[] } | { error: string }> {
  try {
    return { records: (await resolveTxt(host)).map(row => row.join('')) };
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { records: [] };
    return { error: `DNS lookup failed (${code || 'error'}).` };
  }
}

/** SPF, DKIM and DMARC for the sender domain, reusing the sender settings the Settings DNS check reads. */
export async function authenticationChecks(): Promise<DeliverabilityCheck[]> {
  const { senderDomain } = await import('../reporting');
  const { domain, selector } = await senderDomain();
  const missing = (id: string, label: string, detail: string): DeliverabilityCheck => ({ id, group: 'Authentication', label, status: 'unavailable', value: 'Unavailable', detail });
  if (!domain) return ['spf', 'dkim', 'dmarc'].map(id => missing(id, id.toUpperCase(), 'No sender address is configured (SMTP_FROM_EMAIL), so there is no domain to check.'));
  if (domain.endsWith('.test') || domain.endsWith('.example') || domain.endsWith('.local')) {
    return ['spf', 'dkim', 'dmarc'].map(id => missing(id, id.toUpperCase(), `The sender domain ${domain} is a reserved test domain with no public DNS.`));
  }
  const [spf, dkim, dmarc] = await Promise.all([
    txt(domain), selector ? txt(`${selector}._domainkey.${domain}`) : Promise.resolve(null), txt(`_dmarc.${domain}`),
  ]);
  const checks: DeliverabilityCheck[] = [];
  const find = (result: { records: string[] }, prefix: string) => result.records.find(record => record.toLowerCase().startsWith(prefix));
  if ('error' in spf) checks.push(missing('spf', 'SPF', spf.error));
  else {
    const record = find(spf, 'v=spf1');
    checks.push(record
      ? { id: 'spf', group: 'Authentication', label: 'SPF', status: /[-~]all\b/.test(record) ? 'pass' : 'warn', value: record, detail: /[-~]all\b/.test(record) ? `Published for ${domain}.` : 'Published, but it does not end in ~all or -all, so other senders are not ruled out.' }
      : { id: 'spf', group: 'Authentication', label: 'SPF', status: 'fail', value: 'No record', detail: `${domain} publishes no SPF record. Add one that includes your relay.` });
  }
  if (!dkim) checks.push(missing('dkim', 'DKIM', 'Set SMTP_DKIM_SELECTOR to the selector your relay signs with, so the key can be looked up.'));
  else if ('error' in dkim) checks.push(missing('dkim', 'DKIM', dkim.error));
  else {
    const record = find(dkim, 'v=dkim1') ?? dkim.records.find(item => /\bp=/.test(item));
    checks.push(record
      ? { id: 'dkim', group: 'Authentication', label: 'DKIM', status: 'pass', value: `${selector}._domainkey published`, detail: `${record.slice(0, 60)}…` }
      : { id: 'dkim', group: 'Authentication', label: 'DKIM', status: 'fail', value: 'No key', detail: `No DKIM key at ${selector}._domainkey.${domain}.` });
  }
  if ('error' in dmarc) checks.push(missing('dmarc', 'DMARC', dmarc.error));
  else {
    const record = find(dmarc, 'v=dmarc1');
    const policy = record ? /\bp=(none|quarantine|reject)/i.exec(record)?.[1]?.toLowerCase() : undefined;
    checks.push(record
      ? { id: 'dmarc', group: 'Authentication', label: 'DMARC', status: policy === 'none' || !policy ? 'warn' : 'pass', value: `p=${policy ?? 'missing'}`, detail: policy === 'none' ? 'Monitoring only: receivers are not asked to act on failures.' : record }
      : { id: 'dmarc', group: 'Authentication', label: 'DMARC', status: 'fail', value: 'No record', detail: `No DMARC record at _dmarc.${domain}. Gmail and Yahoo require one for bulk senders.` });
  }
  return checks;
}

type Bounce = { type: string; createdAt: string | null };
type Suppression = { reason: string; at: string };

async function engineData(): Promise<{ campaigns: Campaign[]; bounces: Bounce[]; suppressions: Suppression[] }> {
  if (isDevPreviewMode()) {
    const { handleDevPreviewConsole } = await import('../dev-preview');
    const get = async <T>(path: string) => (await handleDevPreviewConsole(new Request('http://preview.local/api/console/' + path), path.split('/'))).json() as Promise<T>;
    const [campaigns, bounces, suppressions] = await Promise.all([
      get<Page<Campaign>>('campaigns'), get<Page<Bounce>>('bounces'), get<Suppression[]>('suppressions'),
    ]);
    return { campaigns: campaigns.items, bounces: bounces.items, suppressions };
  }
  const { listmonk } = await import('../listmonk');
  const [campaigns, bounces, suppressions] = await Promise.all([
    listmonk.campaigns({ page: 1, status: ['finished', 'running', 'paused', 'cancelled'] }),
    listmonk.allBounces(),
    db.query<{ reason: string; created_at: Date }>(`SELECT reason, created_at FROM suppressions WHERE created_at > now() - interval '56 days'`),
  ]);
  return { campaigns: campaigns.items, bounces, suppressions: suppressions.rows.map(row => ({ reason: row.reason, at: new Date(row.created_at).toISOString() })) };
}

/** Bounce and complaint rates from sent newsletters, suppression growth and OVELIO's own send outcomes. */
export async function reputationChecks(): Promise<DeliverabilityCheck[]> {
  const checks: DeliverabilityCheck[] = [];
  let data: Awaited<ReturnType<typeof engineData>>;
  try {
    data = await engineData();
  } catch (error) {
    const reason = `The newsletter engine did not answer: ${(error as Error).message.slice(0, 120)}`;
    return ['bounce', 'complaint', 'suppressions'].map(id => ({ id, group: 'Reputation', label: id, status: 'unavailable', value: 'Unavailable', detail: reason }));
  }
  const sentCampaigns = data.campaigns.filter(item => (item.metrics.sent ?? 0) > 0);
  const sent = sentCampaigns.reduce((sum, item) => sum + (item.metrics.sent ?? 0), 0);
  const bounced = sentCampaigns.reduce((sum, item) => sum + (item.metrics.bounces ?? 0), 0);
  const complaints = data.bounces.filter(item => item.type === 'complaint').length;
  if (!sent) {
    const reason = 'No newsletter has been sent yet, so there is nothing to measure.';
    checks.push({ id: 'bounce', group: 'Reputation', label: 'Bounce rate', status: 'unavailable', value: 'Unavailable', detail: reason });
    checks.push({ id: 'complaint', group: 'Reputation', label: 'Complaint rate', status: 'unavailable', value: 'Unavailable', detail: reason });
  } else {
    const bounceRate = bounced / sent;
    const complaintRate = complaints / sent;
    checks.push({ id: 'bounce', group: 'Reputation', label: 'Bounce rate', status: bounceRate < 0.02 ? 'pass' : bounceRate < 0.05 ? 'warn' : 'fail', value: percent(bounceRate),
      detail: `${bounced.toLocaleString('en-GB')} bounces from ${sent.toLocaleString('en-GB')} newsletter emails across ${sentCampaigns.length} ${sentCampaigns.length === 1 ? "send" : "sends"}. Keep it under 2%.` });
    checks.push({ id: 'complaint', group: 'Reputation', label: 'Complaint rate', status: complaintRate < 0.001 ? 'pass' : complaintRate < 0.003 ? 'warn' : 'fail', value: percent(complaintRate),
      detail: `${complaints} spam complaints reported back by mailbox providers. Gmail and Yahoo require under 0.3%; aim for under 0.1%. Providers that do not send complaint reports are not counted.` });
  }
  const now = Date.now();
  const recent = data.suppressions.filter(item => now - Date.parse(item.at) <= 28 * 86_400_000);
  const before = data.suppressions.filter(item => now - Date.parse(item.at) > 28 * 86_400_000 && now - Date.parse(item.at) <= 56 * 86_400_000);
  const byReason = Object.entries(recent.reduce<Record<string, number>>((all, item) => ({ ...all, [item.reason]: (all[item.reason] ?? 0) + 1 }), {}))
    .map(([reason, count]) => `${count} ${reason}`).join(', ');
  checks.push({ id: 'suppressions', group: 'Reputation', label: 'Suppression growth (28 days)', status: recent.length > Math.max(10, before.length * 2) ? 'warn' : 'pass',
    value: `+${recent.length}`, detail: `${byReason || 'No new suppressions'}; ${before.length} in the 28 days before.` });
  const native = await db.query<{ status: string; count: string }>(`SELECT status, count(*) AS count FROM messages WHERE created_at > now() - interval '30 days' AND category <> 'test' GROUP BY status`);
  const counts = Object.fromEntries(native.rows.map(row => [row.status, Number(row.count)]));
  checks.push({ id: 'native', group: 'Reputation', label: 'OVELIO sends (30 days)', status: 'info',
    value: `${counts.sent ?? 0} accepted`, detail: `${counts.blocked ?? 0} blocked by consent or suppression, ${counts.failed ?? 0} failed, ${counts.not_sent ?? 0} not sent. "Accepted" means the relay took the message; it does not show inbox placement.` });
  return checks;
}

// ---------------------------------------------------------------------------------------------------------------
// Link checks with an SSRF guard: public http(s) only, default ports, every resolved address must be public, no
// redirects followed, short timeouts.

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged by its IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    const list = addresses as { address: string; family: number }[];
    if (!list.length || list.some(item => !isPublicAddress(item.address))) return callback(new Error('resolves to a private or reserved address'), '', 4);
    if ((options as { all?: boolean }).all) return (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function request(url: URL, method: 'HEAD' | 'GET'): Promise<{ code: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method, lookup: guardedLookup, timeout: 4000, headers: { 'user-agent': 'OVELIO link check', accept: '*/*' }, agent: false }, response => {
      resolve({ code: response.statusCode ?? 0, location: response.headers.location });
      response.destroy();
    });
    req.on('timeout', () => req.destroy(new Error('timed out after 4 seconds')));
    req.on('error', reject);
    req.end();
  });
}

export async function checkLink(raw: string): Promise<LinkCheck> {
  let url: URL;
  try { url = new URL(raw); } catch { return { url: raw, status: 'broken', code: null, detail: 'Not a valid address.' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { url: raw, status: 'skipped', code: null, detail: 'Only http and https links are checked.' };
  if (url.port && url.port !== '80' && url.port !== '443') return { url: raw, status: 'skipped', code: null, detail: 'Links on non-standard ports are not checked.' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) return { url: raw, status: 'skipped', code: null, detail: 'Private and reserved addresses are never requested.' };
  try {
    let result = await request(url, 'HEAD');
    if (result.code === 405 || result.code === 501) result = await request(url, 'GET');
    if (result.code >= 200 && result.code < 300) return { url: raw, status: 'ok', code: result.code, detail: 'Reachable.' };
    if (result.code >= 300 && result.code < 400) return { url: raw, status: 'redirect', code: result.code, detail: `Redirects to ${result.location ?? 'another address'} (not followed).` };
    return { url: raw, status: 'broken', code: result.code, detail: result.code === 404 ? 'Page not found.' : `The server answered ${result.code}.` };
  } catch (error) {
    return { url: raw, status: 'unreachable', code: null, detail: `Could not be checked: ${(error as Error).message.slice(0, 120)}` };
  }
}

/** Unique http(s) links and images in a design's HTML, without merge-tag links, at most 25. */
export function designLinks(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replace(/&amp;/g, '&').trim();
    if (/^https?:\/\//i.test(value) && !value.includes('{{')) found.add(value);
  }
  return [...found].slice(0, 25);
}

export async function checkLinks(urls: string[]) {
  const results: LinkCheck[] = [];
  for (let start = 0; start < urls.length; start += 5) results.push(...await Promise.all(urls.slice(start, start + 5).map(checkLink)));
  return results;
}
