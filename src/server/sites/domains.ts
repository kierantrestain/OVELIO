// Publishing domains (Lane 3). Ownership is proven with a TXT record at _ovelio-verify.<hostname>; routing is checked
// (CNAME for subdomains, A record for apex domains) and reported, so the marketer knows exactly what is missing.
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { User } from '@/contracts';
import type { SiteDomain } from '@/contracts/sites';
import { AppError } from '../config';
import { db } from '../db';
import { audit } from '../events';
import type { DomainRow } from './data';
import { iso, publicOrigin, uuidPattern } from './data';

const hostnamePattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Where custom domains should point: SITES_CNAME_TARGET / SITES_SERVER_IP, else the workspace address. */
export function routingTargets() {
  const appHost = new URL(publicOrigin()).hostname;
  return { cname: process.env.SITES_CNAME_TARGET?.trim() || appHost, ip: process.env.SITES_SERVER_IP?.trim() || '' };
}

function records(row: Pick<DomainRow, 'hostname' | 'kind' | 'verification_token'>): SiteDomain['records'] {
  const target = routingTargets();
  const list: SiteDomain['records'] = [{ type: 'TXT', name: `_ovelio-verify.${row.hostname}`, value: `ovelio-verify=${row.verification_token}`, purpose: 'Proves you own the domain' }];
  if (row.kind === 'subdomain') list.push({ type: 'CNAME', name: row.hostname, value: target.cname, purpose: 'Sends visitors to OVELIO' });
  else list.push({ type: 'A', name: row.hostname, value: target.ip || 'Your OVELIO server’s public IP address (set SITES_SERVER_IP to show it here)', purpose: 'Sends visitors to OVELIO' });
  return list;
}

function toDomain(row: DomainRow & { pages?: string }): SiteDomain {
  return {
    id: row.id, hostname: row.hostname, kind: row.kind, status: row.status, statusDetail: row.status_detail, routingDetail: row.routing_detail,
    verificationToken: row.verification_token, checkedAt: iso(row.checked_at), verifiedAt: iso(row.verified_at), homePageId: row.home_page_id,
    records: records(row), pageCount: Number(row.pages ?? 0),
  };
}

export async function listDomains(): Promise<SiteDomain[]> {
  const rows = await db.query<DomainRow & { pages: string }>(
    `SELECT d.*, (SELECT count(*) FROM landing_pages p WHERE p.domain_id = d.id AND p.status <> 'archived') AS pages FROM site_domains d ORDER BY d.hostname`,
  );
  return rows.rows.map(toDomain);
}

async function requireDomainRow(id: string) {
  const row = uuidPattern.test(id) ? (await db.query<DomainRow>('SELECT * FROM site_domains WHERE id = $1', [id])).rows[0] : undefined;
  if (!row) throw new AppError(404, 'That domain was not found.');
  return row;
}

export async function addDomain(input: { hostname: string; kind?: 'subdomain' | 'custom' }, user: User) {
  const hostname = input.hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!hostnamePattern.test(hostname) || hostname.length > 253) throw new AppError(400, 'Enter a domain such as go.example.com, without https:// or a path.');
  if (hostname === new URL(publicOrigin()).hostname) throw new AppError(400, 'That is OVELIO’s own address. Pages there are published at /s/<page>.');
  const kind = input.kind ?? (hostname.split('.').length > 2 ? 'subdomain' : 'custom');
  const existing = await db.query('SELECT 1 FROM site_domains WHERE hostname = $1', [hostname]);
  if (existing.rows.length) throw new AppError(409, 'That domain is already connected.');
  const row = (await db.query<DomainRow>(
    `INSERT INTO site_domains (hostname, kind, verification_token, status_detail, created_by) VALUES ($1, $2, $3, 'Add the DNS records below, then verify.', $4) RETURNING *`,
    [hostname, kind, randomBytes(16).toString('hex'), user.id],
  )).rows[0];
  await audit(user.id, 'create', 'domain', row.id, hostname);
  return toDomain(row);
}

export async function updateDomain(id: string, input: { homePageId?: string | null }, user: User) {
  const row = await requireDomainRow(id);
  if (input.homePageId) {
    const page = await db.query('SELECT 1 FROM landing_pages WHERE id = $1 AND domain_id = $2', [input.homePageId, id]);
    if (!page.rows.length) throw new AppError(400, 'Choose a page published on this domain as its home page.');
  }
  const updated = (await db.query<DomainRow>('UPDATE site_domains SET home_page_id = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, input.homePageId ?? null])).rows[0];
  await audit(user.id, 'update', 'domain', id, row.hostname);
  return toDomain(updated);
}

export async function removeDomain(id: string, user: User) {
  const row = await requireDomainRow(id);
  await db.query('DELETE FROM site_domains WHERE id = $1', [id]);
  await audit(user.id, 'delete', 'domain', id, row.hostname);
}

type Resolver = { resolveTxt: (name: string) => Promise<string[][]>; resolveCname: (name: string) => Promise<string[]>; resolve4: (name: string) => Promise<string[]> };

const dnsCode = (error: unknown) => (error as { code?: string }).code ?? 'ERROR';
const explain = (code: string, name: string, type: string) => code === 'ENOTFOUND' || code === 'ENODATA'
  ? `No ${type} record found at ${name}.`
  : code === 'ETIMEOUT' || code === 'ECONNREFUSED' ? `The DNS lookup for ${name} timed out. Try again in a minute.` : `The DNS lookup for ${name} failed (${code}).`;

/** Checks the TXT (ownership) and CNAME/A (routing) records and stores a clear status. */
export async function verifyDomain(id: string, user: User | null, resolver: Resolver = dns) {
  const row = await requireDomainRow(id);
  const txtName = `_ovelio-verify.${row.hostname}`;
  const expected = `ovelio-verify=${row.verification_token}`;
  let status: DomainRow['status'] = 'failed';
  let detail: string;
  try {
    const found = (await resolver.resolveTxt(txtName)).map(parts => parts.join(''));
    if (found.includes(expected)) {
      status = 'verified';
      detail = 'Ownership verified with the TXT record.';
    } else {
      detail = found.length ? `The TXT record at ${txtName} is “${found[0].slice(0, 80)}”; expected “${expected}”.` : `No TXT record found at ${txtName}.`;
    }
  } catch (error) {
    detail = explain(dnsCode(error), txtName, 'TXT');
  }
  const target = routingTargets();
  let routing: string;
  try {
    if (row.kind === 'subdomain') {
      const cnames = (await resolver.resolveCname(row.hostname)).map(name => name.replace(/\.$/, '').toLowerCase());
      routing = cnames.includes(target.cname.toLowerCase()) ? `CNAME points to ${target.cname}.` : `CNAME points to ${cnames[0] ?? 'nothing'}; expected ${target.cname}.`;
    } else {
      const addresses = await resolver.resolve4(row.hostname);
      routing = target.ip ? (addresses.includes(target.ip) ? `A record points to ${target.ip}.` : `A record points to ${addresses.join(', ') || 'nothing'}; expected ${target.ip}.`) : `A record points to ${addresses.join(', ')}.`;
    }
  } catch (error) {
    routing = explain(dnsCode(error), row.hostname, row.kind === 'subdomain' ? 'CNAME' : 'A');
  }
  const updated = (await db.query<DomainRow>(
    `UPDATE site_domains SET status = $2, status_detail = $3, routing_detail = $4, checked_at = now(),
       verified_at = CASE WHEN $2 = 'verified' THEN coalesce(verified_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, detail, routing],
  )).rows[0];
  if (user) await audit(user.id, 'verify', 'domain', id, `${row.hostname}: ${status}`);
  return toDomain(updated);
}

/** For the reverse proxy's on-demand TLS check: only verified domains get certificates. */
export async function isVerifiedDomain(hostname: string) {
  const row = await db.query(`SELECT 1 FROM site_domains WHERE hostname = $1 AND status = 'verified'`, [hostname.trim().toLowerCase()]);
  return row.rows.length > 0;
}
