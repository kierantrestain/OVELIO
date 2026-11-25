// Contact and company reads the CRM screens need beyond src/server/directory.ts: paged listing with sorting and
// filters, company people and a single company. Production asks the audience service (Mautic plus OVELIO's
// suppression truth, the same functions the engine console routes use); the developer preview reads the preview
// directory. Writes still go through directory.ts or the existing engine endpoints.

import type { Company, Contact, ContactSortKey } from '@/contracts';
import type { DirectoryContact } from '@/contracts/platform';
import { AppError } from '../config';
import { devPreviewCompanies, devPreviewContacts, isDevPreviewMode } from '../dev-preview';
import { getContacts, toDirectoryContact } from '../directory';

export type EngineContact = DirectoryContact & { stageId: number | null; updatedAt: string | null; linkedCompanyIds: number[] };

export type ContactListQuery = {
  search?: string;
  page: number;
  limit: number;
  tag?: string;
  segmentId?: number;
  stage?: string;
  orderBy?: ContactSortKey;
  orderByDir?: 'asc' | 'desc';
};

function toEngineContact(contact: Contact & { linkedCompanies?: { id: number }[]; consent?: DirectoryContact['consent'] }): EngineContact {
  return {
    ...toDirectoryContact(contact),
    stageId: contact.stageId ?? null,
    updatedAt: contact.updatedAt ?? null,
    linkedCompanyIds: (contact.linkedCompanies ?? []).map(item => item.id),
  };
}

const sortValue = (contact: Contact, key: ContactSortKey): string | number => {
  switch (key) {
    case 'points': return contact.points ?? 0;
    case 'id': return contact.id;
    case 'createdAt': case 'updatedAt': case 'lastActive': return Date.parse(contact[key === 'lastActive' ? 'updatedAt' : key] ?? '') || 0;
    default: return String(contact[key as keyof Contact] ?? '').toLowerCase();
  }
};

export async function listEngineContacts(query: ContactListQuery): Promise<{ items: EngineContact[]; total: number; page: number; limit: number }> {
  if (isDevPreviewMode()) {
    const q = query.search?.trim().toLowerCase() ?? '';
    const tag = query.tag?.trim().toLowerCase();
    const stage = query.stage?.trim().toLowerCase();
    const filtered = devPreviewContacts().filter(contact => {
      if (q && !`${contact.email} ${contact.firstName} ${contact.lastName} ${contact.company} ${contact.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      if (tag && !contact.tags.some(item => item.toLowerCase() === tag)) return false;
      if (stage && (contact.stageName ?? '').toLowerCase() !== stage) return false;
      if (query.segmentId && !contact.segments.some(segment => segment.id === query.segmentId)) return false;
      return true;
    });
    const key = query.orderBy ?? 'createdAt';
    const direction = query.orderByDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const left = sortValue(a, key);
      const right = sortValue(b, key);
      return (left < right ? -1 : left > right ? 1 : 0) * direction;
    });
    const start = (query.page - 1) * query.limit;
    return { items: filtered.slice(start, start + query.limit).map(toEngineContact), total: filtered.length, page: query.page, limit: query.limit };
  }
  const { contactDirectory } = await import('../audience');
  const search = [query.search?.trim(), query.stage ? `stage:"${query.stage.replace(/"/g, '')}"` : ''].filter(Boolean).join(' ');
  const page = await contactDirectory({
    search: search || undefined, page: query.page, limit: query.limit, tag: query.tag, segmentId: query.segmentId,
    orderBy: query.orderBy, orderByDir: query.orderByDir,
  });
  return { ...page, items: page.items.map(item => toEngineContact(item)) };
}

/** Contacts by id, for an owner-filtered list. Missing ids are left out. */
export async function engineContactsById(ids: number[]): Promise<EngineContact[]> {
  if (isDevPreviewMode()) {
    const wanted = new Set(ids);
    return devPreviewContacts().filter(contact => wanted.has(contact.id)).map(toEngineContact);
  }
  const found = await getContacts(ids);
  return ids.flatMap(id => {
    const contact = found.get(id);
    return contact ? [{ ...contact, stageId: null, updatedAt: null, linkedCompanyIds: [] }] : [];
  });
}

export async function engineCompanies(search?: string): Promise<Company[]> {
  const q = search?.trim().toLowerCase();
  if (isDevPreviewMode()) {
    return devPreviewCompanies()
      .filter(company => !q || `${company.name} ${company.website} ${company.industry} ${company.city}`.toLowerCase().includes(q))
      .slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  const { mautic } = await import('../mautic');
  return mautic.companies({ search: q || undefined });
}

export async function engineCompany(id: number): Promise<Company> {
  const found = (await engineCompanies()).find(company => company.id === id);
  if (!found) throw new AppError(404, 'That company was not found.');
  return found;
}

/** People linked to a company (by company link, or by the company name on the contact). */
export async function companyPeople(company: { id: number; name: string }, limit = 100): Promise<{ items: DirectoryContact[]; total: number }> {
  if (isDevPreviewMode()) {
    const name = company.name.trim().toLowerCase();
    const people = devPreviewContacts().filter(contact => (contact.linkedCompanies ?? []).some(item => item.id === company.id)
      || (name && contact.company.trim().toLowerCase() === name));
    return { items: people.slice(0, limit).map(contact => toDirectoryContact(contact)), total: people.length };
  }
  const { contactDirectory } = await import('../audience');
  const page = await contactDirectory({ search: `company_id:${company.id}`, page: 1, limit: Math.min(limit, 100) });
  return { items: page.items.map(item => toDirectoryContact(item)), total: page.total };
}

/** People counts for several companies; one engine call per company in production, so keep the list short. */
export async function companyPeopleCounts(companies: { id: number; name: string }[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (let start = 0; start < companies.length; start += 6) {
    const batch = companies.slice(start, start + 6);
    const results = await Promise.all(batch.map(company => companyPeople(company, 1).then(page => page.total).catch(() => 0)));
    batch.forEach((company, index) => counts.set(company.id, results[index]));
  }
  return counts;
}
