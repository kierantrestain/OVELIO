// Duplicate contacts: detection (same email ignoring case, or same name at the same company) and merging. A merge
// fills the survivor's engine record first, then moves every OVELIO association in one transaction, then deletes the
// duplicate from the engine.
import { z } from 'zod';
import type { CrmContact } from '@/contracts/crm';
import type { DirectoryContact } from '@/contracts/platform';
import { AppError } from '../config';
import { transaction } from '../db';
import { deleteContact, getContact, listAllContacts, mergeContactFields } from '../directory';
import { audit, emitEvent } from '../events';
import { readBody } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { enrichContacts } from './lists';

export type DuplicateGroup = { key: string; reason: string; contacts: CrmContact[] };

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export function groupDuplicates(contacts: DirectoryContact[]): { key: string; reason: string; ids: number[] }[] {
  const groups = new Map<string, { reason: string; ids: number[] }>();
  const add = (key: string, reason: string, id: number) => {
    const group = groups.get(key) ?? { reason, ids: [] };
    if (!group.ids.includes(id)) group.ids.push(id);
    groups.set(key, group);
  };
  for (const contact of contacts) {
    if (contact.email) add('email:' + norm(contact.email), 'Same email address', contact.id);
    const name = norm(`${contact.firstName} ${contact.lastName}`);
    if (name && contact.company.trim()) add(`name:${name}|${norm(contact.company)}`, 'Same name and company', contact.id);
  }
  const seen = new Set<string>();
  return [...groups.entries()].filter(([, group]) => group.ids.length > 1).flatMap(([key, group]) => {
    const signature = [...group.ids].sort((a, b) => a - b).join(',');
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [{ key, reason: group.reason, ids: group.ids }];
  });
}

export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const contacts = await listAllContacts();
  const groups = groupDuplicates(contacts);
  const byId = new Map(contacts.map(contact => [contact.id, contact]));
  const enriched = new Map((await enrichContacts(groups.flatMap(group => group.ids).map(id => ({ ...byId.get(id)!, stageId: null, updatedAt: null, linkedCompanyIds: [] }))))
    .map(contact => [contact.id, contact]));
  return groups.map(group => ({ key: group.key, reason: group.reason, contacts: group.ids.map(id => enriched.get(id)!).filter(Boolean) }));
}

/** Moves every OVELIO record of the duplicate to the survivor. One transaction: all or nothing. */
export async function moveAssociations(survivor: DirectoryContact, duplicate: DirectoryContact, actorId: string | null) {
  return transaction(async client => {
    const moved: Record<string, number> = {};
    const run = async (label: string, sql: string, values: unknown[]) => { moved[label] = (await client.query(sql, values)).rowCount ?? 0; };
    const [S, D] = [survivor.id, duplicate.id];
    await run('deals', 'UPDATE deals SET contact_id = $1, contact_name = $3, contact_email = $4, updated_at = now() WHERE contact_id = $2', [S, D, survivor.name, survivor.email]);
    await client.query(
      `INSERT INTO deal_contacts (deal_id, contact_id, contact_name, contact_email, role)
       SELECT deal_id, $1, $3, $4, role FROM deal_contacts WHERE contact_id = $2 ON CONFLICT (deal_id, contact_id) DO NOTHING`, [S, D, survivor.name, survivor.email]);
    await run('deal people', 'DELETE FROM deal_contacts WHERE contact_id = $1', [D]);
    await run('tasks', 'UPDATE tasks SET contact_id = $1, updated_at = now() WHERE contact_id = $2', [S, D]);
    await run('activities', 'UPDATE activities SET contact_id = $1 WHERE contact_id = $2', [S, D]);
    await client.query(`INSERT INTO record_owners (object, record_id, owner_id) SELECT 'contact', $1, owner_id FROM record_owners WHERE object = 'contact' AND record_id = $2 ON CONFLICT DO NOTHING`, [S, D]);
    await client.query(`DELETE FROM record_owners WHERE object = 'contact' AND record_id = $1`, [D]);
    await run('identity links', 'UPDATE identity_links SET contact_id = $1 WHERE contact_id = $2', [S, D]);
    await run('events', 'UPDATE events SET contact_id = $1 WHERE contact_id = $2', [S, D]);
    await run('messages', 'UPDATE messages SET contact_id = $1 WHERE contact_id = $2', [S, D]);
    await client.query('UPDATE crm_mailbox_messages SET contact_id = $1 WHERE contact_id = $2', [S, D]);
    // A sequence both are active in keeps the survivor's enrolment; the duplicate's stops.
    await client.query(
      `UPDATE crm_sequence_enrolments d SET status = 'stopped', stopped_reason = $3, finished_at = now(), next_run_at = NULL
       WHERE d.contact_id = $2 AND d.status = 'active' AND EXISTS (
         SELECT 1 FROM crm_sequence_enrolments s WHERE s.contact_id = $1 AND s.sequence_id = d.sequence_id AND s.status = 'active')`,
      [S, D, `Merged into ${survivor.email}; the surviving contact's enrolment continues.`]);
    await run('sequence enrolments', 'UPDATE crm_sequence_enrolments SET contact_id = $1, contact_email = $3, contact_name = $4 WHERE contact_id = $2', [S, D, survivor.email, survivor.name]);
    await audit(actorId, 'merge', 'contact', String(S), `Merged contact ${D} (${duplicate.email}) into ${S} (${survivor.email})`, client);
    await emitEvent({
      type: 'contact.updated', contactId: S, actorId, entityType: 'contact', entityId: String(S),
      properties: { mergedContactId: D, mergedEmail: duplicate.email, moved },
    }, client);
    return moved;
  });
}

export async function mergeContacts(survivorId: number, duplicateId: number, actorId: string | null) {
  if (survivorId === duplicateId) throw new AppError(400, 'Choose two different contacts to merge.');
  const [survivor, duplicate] = await Promise.all([getContact(survivorId), getContact(duplicateId)]);
  if (!survivor || !duplicate) throw new AppError(404, 'One of these contacts no longer exists.');
  const merged = await mergeContactFields(survivorId, duplicateId);
  const moved = await moveAssociations(merged, duplicate, actorId);
  try {
    await deleteContact(duplicateId);
  } catch (error) {
    throw new AppError(502, `Deals, tasks and activities now belong to ${merged.email}, but the audience engine did not delete the duplicate: ${(error as Error).message}`);
  }
  return { survivor: merged, moved };
}

export const duplicateEndpoints: Entry[] = [
  route('GET', /^crm\/duplicates$/, async () => findDuplicates(), 'marketer'),
  route('POST', /^crm\/duplicates\/merge$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({ survivorId: z.number().int().positive(), duplicateIds: z.array(z.number().int().positive()).min(1).max(20) }));
    const results = [];
    for (const duplicateId of input.duplicateIds) results.push(await mergeContacts(input.survivorId, duplicateId, user.id));
    return { survivor: results.at(-1)!.survivor, merged: input.duplicateIds.length, moved: results.map(result => result.moved) };
  }, 'marketer'),
];
