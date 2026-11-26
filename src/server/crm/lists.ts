// CRM › Contacts and CRM › Companies lists. Engine fields (name, stage, tags, score, consent) come from the audience
// engine through engine.ts; ownership, open deals and last activity come from OVELIO's tables. Filters on OVELIO data
// pick candidate ids first; filters that can only be checked per record scan at most 500 engine records and say so.
import { z } from 'zod';
import type { User } from '@/contracts';
import type { CrmCompany, CrmCompanyPage, CrmContact, CrmContactPage, CrmContactSort } from '@/contracts/crm';
import { db } from '../db';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { companyPeopleCounts, engineCompanies, engineContactsById, listEngineContacts } from './engine';
import type { EngineContact } from './engine';
import { ownersFor } from './people';
import { isoDate, uuid } from './shared';

const SCAN_LIMIT = 500;

export type ContactListFilters = {
  q?: string; ownerId?: string; stage?: string; tag?: string; segmentId?: number; hasOpenDeal?: 'yes' | 'no';
  activityAfter?: string; activityBefore?: string; consent?: 'opted_in' | 'unknown' | 'suppressed';
};

export function readContactFilters(query: URLSearchParams, user: User): ContactListFilters {
  const owner = query.get('ownerId') || undefined;
  return {
    q: query.get('q')?.trim().slice(0, 200) || undefined,
    ownerId: owner === 'me' ? user.id : owner === 'none' ? 'none' : owner ? uuid.parse(owner) : undefined,
    stage: query.get('stage')?.trim().slice(0, 80) || undefined,
    tag: query.get('tag')?.trim().slice(0, 70) || undefined,
    segmentId: query.get('segmentId') ? Number(query.get('segmentId')) : undefined,
    hasOpenDeal: query.get('hasOpenDeal') === 'yes' ? 'yes' : query.get('hasOpenDeal') === 'no' ? 'no' : undefined,
    activityAfter: query.get('activityAfter') ? isoDate.parse(query.get('activityAfter')) : undefined,
    activityBefore: query.get('activityBefore') ? isoDate.parse(query.get('activityBefore')) : undefined,
    consent: z.enum(['opted_in', 'unknown', 'suppressed']).optional().parse(query.get('consent') || undefined),
  };
}

/** Contact ids that satisfy the OVELIO-side filters, or null when none of them is set. */
async function candidateIds(filters: ContactListFilters): Promise<number[] | null> {
  const sets: Set<number>[] = [];
  const ids = async (sql: string, values: unknown[]) => new Set((await db.query<{ id: string }>(sql, values)).rows.map(row => Number(row.id)));
  if (filters.ownerId && filters.ownerId !== 'none') {
    sets.push(await ids(`SELECT record_id AS id FROM record_owners WHERE object = 'contact' AND owner_id = $1`, [filters.ownerId]));
  }
  if (filters.hasOpenDeal === 'yes') {
    sets.push(await ids(`SELECT contact_id AS id FROM deals WHERE status = 'open' AND archived_at IS NULL AND contact_id IS NOT NULL
      UNION SELECT dc.contact_id FROM deal_contacts dc JOIN deals d ON d.id = dc.deal_id WHERE d.status = 'open' AND d.archived_at IS NULL`, []));
  }
  if (filters.activityAfter || filters.activityBefore) {
    sets.push(await ids(`SELECT contact_id AS id FROM activities WHERE contact_id IS NOT NULL GROUP BY contact_id
      HAVING ($1::date IS NULL OR max(occurred_at) >= $1::date) AND ($2::date IS NULL OR max(occurred_at) < $2::date)`,
    [filters.activityAfter ?? null, filters.activityBefore ?? null]));
  }
  if (!sets.length) return null;
  const [first, ...rest] = sets;
  return [...first].filter(id => rest.every(set => set.has(id)));
}

export async function enrichContacts(contacts: EngineContact[]): Promise<CrmContact[]> {
  const ids = contacts.map(contact => contact.id);
  if (!ids.length) return [];
  const [owners, deals, activity] = await Promise.all([
    ownersFor('contact', ids),
    db.query<{ contact_id: string; open: string; value: string | null }>(
      `SELECT x.contact_id, count(DISTINCT d.id) AS open, sum(d.amount) AS value FROM (
         SELECT id AS deal_id, contact_id FROM deals WHERE contact_id = ANY($1::bigint[])
         UNION SELECT deal_id, contact_id FROM deal_contacts WHERE contact_id = ANY($1::bigint[])
       ) x JOIN deals d ON d.id = x.deal_id WHERE d.status = 'open' AND d.archived_at IS NULL GROUP BY x.contact_id`, [ids]),
    db.query<{ contact_id: string; at: Date }>(
      `SELECT contact_id, max(at) AS at FROM (
         SELECT contact_id, occurred_at AS at FROM activities WHERE contact_id = ANY($1::bigint[])
         UNION ALL SELECT contact_id, created_at FROM messages WHERE contact_id = ANY($1::bigint[])
       ) x GROUP BY contact_id`, [ids]),
  ]);
  const dealMap = new Map(deals.rows.map(row => [Number(row.contact_id), row]));
  const activityMap = new Map(activity.rows.map(row => [Number(row.contact_id), new Date(row.at).toISOString()]));
  return contacts.map(contact => {
    const owner = owners.get(contact.id);
    const deal = dealMap.get(contact.id);
    return {
      ...contact, ownerId: owner?.id ?? null, ownerName: owner?.name ?? '', openDeals: Number(deal?.open ?? 0),
      openDealValue: Number(deal?.value ?? 0), lastActivityAt: activityMap.get(contact.id) ?? null,
    };
  });
}

const matchesEngineFilters = (contact: EngineContact, filters: ContactListFilters) => {
  const q = filters.q?.toLowerCase();
  if (q && !`${contact.name} ${contact.email} ${contact.company} ${contact.tags.join(' ')}`.toLowerCase().includes(q)) return false;
  if (filters.stage && (contact.stageName ?? '').toLowerCase() !== filters.stage.toLowerCase()) return false;
  if (filters.tag && !contact.tags.some(tag => tag.toLowerCase() === filters.tag!.toLowerCase())) return false;
  return true;
};

const matchesOvelioFilters = (contact: CrmContact, filters: ContactListFilters) => {
  if (filters.ownerId === 'none' && contact.ownerId) return false;
  if (filters.hasOpenDeal === 'no' && contact.openDeals > 0) return false;
  if (filters.consent && contact.consent !== filters.consent) return false;
  return true;
};

function sortContacts(items: CrmContact[], sort: CrmContactSort, dir: 'asc' | 'desc') {
  const value = (contact: CrmContact): string | number => {
    switch (sort) {
      case 'points': return contact.points;
      case 'openDealValue': return contact.openDealValue;
      case 'lastActivity': return contact.lastActivityAt ? Date.parse(contact.lastActivityAt) : 0;
      case 'createdAt': return contact.createdAt ? Date.parse(contact.createdAt) : 0;
      case 'updatedAt': return contact.updatedAt ? Date.parse(contact.updatedAt) : 0;
      case 'email': return contact.email.toLowerCase();
      default: return (contact.lastName || contact.name).toLowerCase();
    }
  };
  const factor = dir === 'asc' ? 1 : -1;
  return items.sort((a, b) => { const left = value(a); const right = value(b); return (left < right ? -1 : left > right ? 1 : 0) * factor; });
}

export async function listCrmContacts(filters: ContactListFilters, options: { page: number; limit: number; sort: CrmContactSort; dir: 'asc' | 'desc' }): Promise<CrmContactPage> {
  const { page, limit, sort, dir } = options;
  const candidates = await candidateIds(filters);
  const needsScan = candidates !== null || filters.ownerId === 'none' || filters.hasOpenDeal === 'no' || Boolean(filters.consent) || sort === 'lastActivity' || sort === 'openDealValue';
  const engineSort = sort === 'lastActivity' || sort === 'openDealValue' ? 'createdAt' : sort;
  if (!needsScan) {
    const result = await listEngineContacts({ search: filters.q, tag: filters.tag, stage: filters.stage, segmentId: filters.segmentId, page, limit, orderBy: engineSort, orderByDir: dir });
    return { items: await enrichContacts(result.items), total: result.total, page, limit };
  }
  let pool: EngineContact[];
  let note: string | undefined;
  if (candidates) {
    const capped = candidates.slice(0, SCAN_LIMIT);
    pool = (await engineContactsById(capped)).filter(contact => matchesEngineFilters(contact, filters));
    if (candidates.length > SCAN_LIMIT) note = `Showing matches among the first ${SCAN_LIMIT} of ${candidates.length} contacts that meet the owner, deal or activity filters.`;
  } else {
    const result = await listEngineContacts({ search: filters.q, tag: filters.tag, stage: filters.stage, segmentId: filters.segmentId, page: 1, limit: SCAN_LIMIT, orderBy: engineSort, orderByDir: dir });
    pool = result.items;
    if (result.total > SCAN_LIMIT) note = `Filtered from the first ${SCAN_LIMIT} of ${result.total} contacts. Narrow the search to include the rest.`;
  }
  const items = sortContacts((await enrichContacts(pool)).filter(contact => matchesOvelioFilters(contact, filters)), sort, dir);
  return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit, note };
}

export async function listCrmCompanies(query: URLSearchParams, user: User): Promise<CrmCompanyPage> {
  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(Math.max(Number(query.get('limit') || 25), 1), 100);
  const owner = query.get('ownerId');
  const ownerId = owner === 'me' ? user.id : owner;
  const hasOpenDeal = query.get('hasOpenDeal');
  const sort = query.get('sort') || 'name';
  const dir = query.get('dir') === 'desc' ? -1 : 1;
  const companies = await engineCompanies(query.get('q') ?? undefined);
  const ids = companies.map(company => company.id);
  const [owners, sums, activity] = await Promise.all([
    ownersFor('company', ids),
    db.query<{ company_id: string; open: string; open_value: string | null; won: string | null; currency: string | null }>(
      `SELECT company_id, count(*) FILTER (WHERE status = 'open') AS open, sum(amount) FILTER (WHERE status = 'open') AS open_value,
         sum(amount) FILTER (WHERE status = 'won') AS won, min(currency) AS currency
       FROM deals WHERE company_id = ANY($1::bigint[]) AND archived_at IS NULL GROUP BY company_id`, [ids]),
    db.query<{ company_id: string; at: Date }>(
      `SELECT coalesce(a.company_id, d.company_id) AS company_id, max(a.occurred_at) AS at FROM activities a LEFT JOIN deals d ON d.id = a.deal_id
       WHERE a.company_id = ANY($1::bigint[]) OR d.company_id = ANY($1::bigint[]) GROUP BY 1`, [ids]),
  ]);
  const sumMap = new Map(sums.rows.map(row => [Number(row.company_id), row]));
  const activityMap = new Map(activity.rows.map(row => [Number(row.company_id), new Date(row.at).toISOString()]));
  let rows: CrmCompany[] = companies.map(company => {
    const ownerRow = owners.get(company.id);
    const sum = sumMap.get(company.id);
    return {
      id: company.id, name: company.name, website: company.website, industry: company.industry, city: company.city, country: company.country,
      email: company.email, ownerId: ownerRow?.id ?? null, ownerName: ownerRow?.name ?? '', people: 0, openDeals: Number(sum?.open ?? 0),
      openValue: Number(sum?.open_value ?? 0), wonRevenue: Number(sum?.won ?? 0), currency: sum?.currency ?? 'GBP', lastActivityAt: activityMap.get(company.id) ?? null,
    };
  });
  if (ownerId === 'none') rows = rows.filter(row => !row.ownerId);
  else if (ownerId) rows = rows.filter(row => row.ownerId === ownerId);
  if (hasOpenDeal === 'yes') rows = rows.filter(row => row.openDeals > 0);
  if (hasOpenDeal === 'no') rows = rows.filter(row => row.openDeals === 0);
  const key = (row: CrmCompany): string | number => sort === 'openValue' ? row.openValue : sort === 'wonRevenue' ? row.wonRevenue
    : sort === 'lastActivity' ? (row.lastActivityAt ? Date.parse(row.lastActivityAt) : 0) : row.name.toLowerCase();
  rows.sort((a, b) => { const left = key(a); const right = key(b); return (left < right ? -1 : left > right ? 1 : 0) * dir; });
  const pageRows = rows.slice((page - 1) * limit, page * limit);
  const people = await companyPeopleCounts(pageRows);
  return { items: pageRows.map(row => ({ ...row, people: people.get(row.id) ?? 0 })), total: rows.length, page, limit };
}

const contactSorts = ['createdAt', 'updatedAt', 'lastName', 'email', 'points', 'lastActivity', 'openDealValue'] as const;

export const listEndpoints: Entry[] = [
  route('GET', /^crm\/contacts$/, async ({ query, user }) => listCrmContacts(readContactFilters(query, user), {
    page: Math.max(1, Number(query.get('page') || 1)), limit: Math.min(Math.max(Number(query.get('limit') || 25), 1), 200),
    sort: z.enum(contactSorts).optional().parse(query.get('sort') || undefined) ?? 'createdAt', dir: query.get('dir') === 'asc' ? 'asc' : 'desc',
  }), 'marketer'),
  route('GET', /^crm\/companies$/, async ({ query, user }) => listCrmCompanies(query, user), 'marketer'),
];
