// The one way OVELIO modules read and create people and companies (docs/rebuild/TRACKER.md §2).
// Production: Mautic is the master record and OVELIO's contact_state/suppressions hold consent (src/server/audience.ts).
// Developer preview: the in-memory preview directory in src/server/dev-preview.ts.
// Never call Mautic contact endpoints directly from a new module; extend this file instead.

import type { Contact, ContactDetail } from '@/contracts';
import type { ContactUpsert, DirectoryCompany, DirectoryContact } from '@/contracts/platform';
import { AppError } from './config';
import {
  devPreviewAdjustPoints, devPreviewCompanies, devPreviewContacts, devPreviewCreateCompany, devPreviewLinkCompany,
  devPreviewSuppressed, devPreviewTagContact, devPreviewUpsertContact, isDevPreviewMode,
} from './dev-preview';

const preview = () => isDevPreviewMode();

export function toDirectoryContact(contact: Contact | ContactDetail): DirectoryContact {
  const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email;
  const detail = contact as Partial<ContactDetail>;
  return {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    name,
    company: contact.company ?? '',
    phone: contact.phone ?? '',
    position: contact.position ?? '',
    tags: contact.tags ?? [],
    stageName: contact.stageName ?? null,
    points: contact.points ?? 0,
    consent: detail.consent ?? (contact.suppressed ? 'suppressed' : 'unknown'),
    suppressed: Boolean(contact.suppressed),
    createdAt: contact.createdAt ?? null,
  };
}

function toDirectoryCompany(company: { id: number; name: string; website?: string; industry?: string; city?: string; country?: string }): DirectoryCompany {
  return { id: company.id, name: company.name, website: company.website ?? '', industry: company.industry ?? '', city: company.city ?? '', country: company.country ?? '' };
}

async function engines() {
  const [{ mautic }, audience] = await Promise.all([import('./mautic'), import('./audience')]);
  return { mautic, audience };
}

export async function searchContacts(query: string, limit = 10): Promise<DirectoryContact[]> {
  const q = query.trim().toLowerCase();
  if (preview()) {
    return devPreviewContacts()
      .filter(item => !q || `${item.email} ${item.firstName} ${item.lastName} ${item.company}`.toLowerCase().includes(q))
      .slice(0, limit)
      .map(toDirectoryContact);
  }
  const { audience } = await engines();
  const page = await audience.contactDirectory({ search: q || undefined, limit, page: 1 });
  return page.items.map(toDirectoryContact);
}

export async function getContact(id: number): Promise<DirectoryContact | null> {
  if (preview()) {
    const found = devPreviewContacts().find(item => item.id === id);
    return found ? toDirectoryContact(found) : null;
  }
  const { mautic } = await engines();
  try {
    return toDirectoryContact(await mautic.contact(id));
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

/** Looks up several contacts at once. Missing ids are left out of the map. Keep lists small in production (one engine call each). */
export async function getContacts(ids: number[]): Promise<Map<number, DirectoryContact>> {
  const unique = [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
  const found = new Map<number, DirectoryContact>();
  if (preview()) {
    for (const contact of devPreviewContacts()) if (unique.includes(contact.id)) found.set(contact.id, toDirectoryContact(contact));
    return found;
  }
  for (let start = 0; start < unique.length; start += 8) {
    const batch = await Promise.all(unique.slice(start, start + 8).map(id => getContact(id)));
    for (const contact of batch) if (contact) found.set(contact.id, contact);
  }
  return found;
}

export async function findContactByEmail(email: string): Promise<DirectoryContact | null> {
  const normalized = email.trim().toLowerCase();
  if (preview()) {
    const found = devPreviewContacts().find(item => item.email === normalized);
    return found ? toDirectoryContact(found) : null;
  }
  const { mautic } = await engines();
  const found = await mautic.findContact(normalized);
  return found ? toDirectoryContact(found) : null;
}

/**
 * Creates the contact, or updates the one with that email (deduplicated by address). Blank values never overwrite
 * existing ones, tags are added, and consent is recorded only with evidence and never for a suppressed address.
 */
export async function upsertContact(input: ContactUpsert): Promise<{ contact: DirectoryContact; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'Enter a valid email address.');
  if (input.consent === 'opted_in' && !input.evidence?.trim()) throw new AppError(400, 'Record where and when the contact consented.');
  if (preview()) {
    const consent = input.consent === 'opted_in' && !devPreviewSuppressed(email) ? 'opted_in' : undefined;
    const { contact, created } = devPreviewUpsertContact({ ...input, email, consent });
    return { contact: toDirectoryContact(contact), created };
  }
  const { mautic, audience } = await engines();
  const existing = await mautic.findContact(email);
  const fields: Record<string, unknown> = { email };
  for (const key of ['firstName', 'lastName', 'company', 'phone', 'position', 'city', 'country', 'website'] as const) {
    const value = input[key]?.trim();
    if (value) fields[key] = value;
    else if (existing && existing[key]) fields[key] = existing[key];
  }
  if (input.tags?.length) fields.tags = [...new Set([...(existing?.tags ?? []), ...input.tags])];
  if (input.customFields && Object.keys(input.customFields).length) fields.customFields = input.customFields;
  const consent = input.consent === 'opted_in' && !existing?.suppressed ? 'opted_in' as const : undefined;
  const saved = await audience.saveContact({ ...(fields as { email: string }), consent, evidence: consent ? input.evidence : undefined }, existing?.id);
  return { contact: toDirectoryContact(saved), created: !existing };
}

export async function tagContact(id: number, add: string[], remove: string[] = []): Promise<DirectoryContact> {
  if (preview()) {
    const contact = devPreviewTagContact(id, add, remove);
    if (!contact) throw new AppError(404, 'That contact was not found.');
    return toDirectoryContact(contact);
  }
  const { mautic } = await engines();
  const current = await mautic.contact(id);
  const tags = [...new Set([...current.tags.filter(tag => !remove.includes(tag)), ...add])];
  return toDirectoryContact(await mautic.updateContact(id, { email: current.email, tags }));
}

export async function adjustPoints(id: number, delta: number): Promise<DirectoryContact> {
  if (preview()) {
    const contact = devPreviewAdjustPoints(id, delta);
    if (!contact) throw new AppError(404, 'That contact was not found.');
    return toDirectoryContact(contact);
  }
  const { mautic } = await engines();
  return toDirectoryContact(await mautic.adjustPoints(id, delta));
}

/**
 * Whether marketing or sales email may go to this address now: consent recorded and not suppressed.
 * Production re-checks both engines (src/server/audience.ts checkRecipient).
 */
export async function canEmail(email: string): Promise<{ allowed: boolean; reason?: string }> {
  const normalized = email.trim().toLowerCase();
  if (preview()) {
    const contact = devPreviewContacts().find(item => item.email === normalized);
    if (!contact) return { allowed: false, reason: 'No contact has this address.' };
    if (contact.suppressed || contact.consent === 'suppressed') return { allowed: false, reason: 'This address is suppressed.' };
    if (contact.consent !== 'opted_in') return { allowed: false, reason: 'No consent is recorded for this address.' };
    return { allowed: true };
  }
  const { audience } = await engines();
  return await audience.checkRecipient(normalized)
    ? { allowed: true }
    : { allowed: false, reason: 'No consent is recorded, or the address is suppressed.' };
}

export async function searchCompanies(query: string, limit = 10): Promise<DirectoryCompany[]> {
  const q = query.trim().toLowerCase();
  if (preview()) {
    return devPreviewCompanies().filter(item => !q || `${item.name} ${item.website}`.toLowerCase().includes(q)).slice(0, limit).map(toDirectoryCompany);
  }
  const { mautic } = await engines();
  return (await mautic.companies({ search: q || undefined })).slice(0, limit).map(toDirectoryCompany);
}

export async function getCompanies(ids: number[]): Promise<Map<number, DirectoryCompany>> {
  const unique = new Set(ids);
  const all = preview() ? devPreviewCompanies() : await (await engines()).mautic.companies();
  return new Map(all.filter(item => unique.has(item.id)).map(item => [item.id, toDirectoryCompany(item)]));
}

export async function createCompany(input: { name: string; website?: string; industry?: string; city?: string; country?: string; email?: string }): Promise<DirectoryCompany> {
  if (!input.name.trim()) throw new AppError(400, 'Enter a company name.');
  if (preview()) return toDirectoryCompany(devPreviewCreateCompany(input));
  const { mautic } = await engines();
  return toDirectoryCompany(await mautic.createCompany({ ...input, name: input.name.trim() }));
}

export async function linkContactToCompany(contactId: number, companyId: number): Promise<void> {
  if (preview()) return devPreviewLinkCompany(contactId, companyId);
  const { mautic } = await engines();
  await mautic.addContactToCompany(companyId, contactId);
}
