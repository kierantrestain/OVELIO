import type { PoolClient } from 'pg';
import Papa from 'papaparse';
import { z } from 'zod';
import type { Consent, Contact, ContactDetail, ContactInput, Subscriber } from '../contracts';
import { recordActivity } from './activity';
import { AppError, emailKey, logError } from './config';
import { db, transaction } from './db';
import type { Sql } from './db';
import { enqueue } from './jobs';
import type { JobData } from './jobs';
import { listmonk } from './listmonk';
import { mautic } from './mautic';
import { UpstreamError } from './upstream';

type Reason = JobData['suppress']['reason'];
type State = { contact_id: string; email_key: string; subscriber_id: string | null; consent: Consent };
type Membership = { segment_id: string; list_id: string };
type ConsentInput = ContactInput & { consent?: 'opted_in' | 'unknown'; evidence?: string };
const contactsPerPage = 100;
const stateColumns = 'contact_id, email_key, subscriber_id, consent';

async function getState(contactId: number, client: Sql = db) {
  return (await client.query<State>(`SELECT ${stateColumns} FROM contact_state WHERE contact_id = $1`, [contactId])).rows[0];
}

async function isSuppressed(key: string, client: Sql = db) {
  return !!(await client.query('SELECT 1 FROM suppressions WHERE email_key = $1', [key])).rows.length;
}

async function saveState(contact: Contact, client: PoolClient) {
  const key = emailKey(contact.email);
  const consent: Consent = await isSuppressed(key, client) || contact.suppressed ? 'suppressed' : 'unknown';
  const result = await client.query<State>(
    `INSERT INTO contact_state (contact_id, email_key, consent) VALUES ($1, $2, $3)
     ON CONFLICT (contact_id) DO UPDATE SET
       email_key = EXCLUDED.email_key,
       consent = CASE WHEN EXCLUDED.consent = 'suppressed' OR contact_state.email_key <> EXCLUDED.email_key
         THEN EXCLUDED.consent ELSE contact_state.consent END,
       subscriber_id = CASE WHEN contact_state.email_key = EXCLUDED.email_key THEN contact_state.subscriber_id ELSE NULL END,
       updated_at = now() RETURNING ${stateColumns}`,
    [contact.id, key, consent],
  );
  return result.rows[0];
}

export function nativeSuppressed(subscriber: Subscriber | null) {
  return Boolean(subscriber?.blocked || subscriber?.lists.some(list => list.status === 'unsubscribed'));
}

async function suppressKey(key: string, reason: Reason, evidence: string, client: PoolClient, contactId?: number) {
  const inserted = await client.query(
    `INSERT INTO suppressions (email_key, reason) VALUES ($1, $2) ON CONFLICT (email_key) DO NOTHING RETURNING email_key`,
    [key, reason],
  );
  const rows = await client.query<{ contact_id: string }>(
    `UPDATE contact_state SET consent = 'suppressed', updated_at = now()
     WHERE email_key = $1 RETURNING contact_id`, [key],
  );
  const id = contactId ?? Number(rows.rows[0]?.contact_id);
  if (!id) return;
  if (inserted.rowCount) await client.query(
    `INSERT INTO consent_events (contact_id, email_key, action, evidence) VALUES ($1, $2, 'suppressed', $3)`,
    [id, key, evidence],
  );
  await enqueue('suppress', String(id), { contactId: id, reason }, client);
}

export async function receiveSuppression(email: string, reason: Reason, evidence: string) {
  await transaction(client => suppressKey(emailKey(email), reason, evidence, client));
}

async function optIn(contact: Contact, state: State, evidence: string, client: PoolClient) {
  if (contact.suppressed || state.consent === 'suppressed' || await isSuppressed(state.email_key, client)) {
    throw new AppError(409, 'This email address is suppressed.');
  }
  if (state.consent !== 'opted_in') {
    await client.query("UPDATE contact_state SET consent = 'opted_in', updated_at = now() WHERE contact_id = $1", [contact.id]);
    await client.query(
      `INSERT INTO consent_events (contact_id, email_key, action, evidence) VALUES ($1, $2, 'opted_in', $3)`,
      [contact.id, state.email_key, evidence],
    );
  }
  await enqueue('contact_sync', String(contact.id), { contactId: contact.id }, client);
}

export async function saveContact(input: ConsentInput, id?: number) {
  const { consent, evidence, ...fields } = input;
  fields.email = fields.email.trim().toLowerCase();
  if (consent === 'opted_in' && !evidence?.trim()) throw new AppError(400, 'Record where and when the contact consented.');
  const value = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    const found = await mautic.findContact(fields.email);
    if (found && id && found.id !== id) throw new AppError(409, 'That email address belongs to another contact.');
    if (consent === 'opted_in' && (found?.suppressed || await isSuppressed(emailKey(fields.email), client))) {
      throw new AppError(409, 'This email address is suppressed.');
    }
    if (id || found?.id) {
      const previous = id && found?.id !== id ? await mautic.contact(id) : found;
      if (previous && previous.email.trim().toLowerCase() !== fields.email) {
        const subscribed = await listmonk.findSubscriber(previous.email);
        if (subscribed) await listmonk.blockSubscriber(subscribed.id);
        const previousState = await getState(previous.id, client);
        await suppressKey(emailKey(previous.email), 'unsubscribe', 'Contact email replaced', client, previousState ? undefined : previous.id);
      }
    }
    const existingId = id ?? found?.id;
    const contact = existingId ? await mautic.updateContact(existingId, fields) : await mautic.createContact(fields);
    const state = await saveState(contact, client);
    if (state.consent === 'suppressed') {
      await enqueue('suppress', String(contact.id), { contactId: contact.id, reason: 'unsubscribe' }, client);
    } else if (consent === 'opted_in' && evidence) {
      await optIn(contact, state, evidence.trim(), client);
    } else if (state.consent === 'opted_in') {
      await enqueue('contact_sync', String(contact.id), { contactId: contact.id }, client);
    }
    return { ...contact, suppressed: contact.suppressed || state.consent === 'suppressed' };
  });
  return value;
}

export async function setConsent(id: number, action: 'opted_in' | 'suppressed', evidence: string) {
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    const contact = await mautic.contact(id);
    if (!contact.email) throw new AppError(409, 'Add an email address to manage consent.');
    const state = await saveState(contact, client);
    if (action === 'suppressed') {
      await suppressKey(state.email_key, 'unsubscribe', evidence, client, id);
    } else {
      await optIn(contact, state, evidence, client);
    }
  });
  await recordActivity(action === 'suppressed' ? 'Email marketing consent withdrawn' : 'Email marketing consent recorded', '/audience');
  return contactDetail(id);
}

export async function contactDetail(id: number): Promise<ContactDetail> {
  const [contact, segments, activity, state] = await Promise.all([
    mautic.contact(id), mautic.contactSegments(id), mautic.contactActivity(id), getState(id),
  ]);
  const key = contact.email ? emailKey(contact.email) : null;
  const suppressed = contact.suppressed || Boolean(key && await isSuppressed(key));
  let mailingListIds: number[] | undefined;
  if (key && state?.email_key === key) {
    try {
      const subscriber = state.subscriber_id ? await listmonk.subscriber(Number(state.subscriber_id)) : await listmonk.findSubscriber(contact.email);
      mailingListIds = subscriber?.lists.filter(list => list.status !== 'unsubscribed').map(list => list.id) ?? [];
    } catch (error) {
      logError('contact-lists', error);
    }
  }
  return { ...contact, suppressed, segments, activity, mailingListIds, consent: suppressed ? 'suppressed' : state?.email_key === key ? state.consent : 'unknown' };
}

export async function contactDirectory(options: { search?: string; page?: number; segmentId?: number }) {
  const page = await mautic.contacts(options);
  const keys = page.items.filter(item => item.email).map(item => emailKey(item.email));
  const muted = await db.query<{ email_key: string }>(`SELECT email_key FROM suppressions WHERE email_key = ANY($1::text[])`, [keys]);
  const blocked = new Set(muted.rows.map(row => row.email_key));
  return { ...page, items: page.items.map(item => ({
    ...item, suppressed: item.suppressed || Boolean(item.email && blocked.has(emailKey(item.email))),
  })) };
}

export async function updateMembership(contactId: number, segmentId: number, member: boolean) {
  if (member) await mautic.addToSegment(segmentId, contactId);
  else await mautic.removeFromSegment(segmentId, contactId);
  await enqueue('contact_sync', String(contactId), { contactId });
  return contactDetail(contactId);
}

export async function updateMailingList(contactId: number, listId: number, member: boolean) {
  const mapping = await db.query('SELECT segment_id FROM segment_lists WHERE list_id = $1', [listId]);
  if (mapping.rows.length) throw new AppError(409, 'Change membership in the linked segment.');
  const contact = await mautic.contact(contactId);
  if (!contact.email) throw new AppError(409, 'Add an email address to manage newsletter membership.');
  const subscriber = await listmonk.findSubscriber(contact.email);
  if (member) {
    if (!await checkRecipient(contact.email)) throw new AppError(409, 'Record email consent before adding this contact.');
    const joined = await listmonk.upsertSubscriber({
      mauticId: contactId, email: contact.email, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), lists: [listId],
    }, subscriber?.id);
    if (nativeSuppressed(joined)) throw new AppError(409, 'This email address is suppressed.');
    await db.query('UPDATE contact_state SET subscriber_id = $1 WHERE contact_id = $2 AND email_key = $3',
      [joined.id, contactId, emailKey(contact.email)]);
  } else if (subscriber) {
    await listmonk.removeSubscriberFromLists(subscriber.id, [listId]);
  }
  return contactDetail(contactId);
}

export async function requestErasure(id: number) {
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    const contact = await mautic.contact(id);
    if (contact.email) {
      const state = await saveState(contact, client);
      await suppressKey(state.email_key, 'erasure', 'Erasure requested', client, id);
    }
    await enqueue('erase', String(id), { contactId: id }, client);
  });
  await recordActivity('Contact erasure queued', '/audience');
}

async function missingIsOkay<T>(operation: Promise<T>) {
  try {
    return await operation;
  } catch (error) {
    if (!(error instanceof UpstreamError && error.status === 404)) throw error;
    return null;
  }
}

export async function eraseContact(id: number) {
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    const [contact, state] = await Promise.all([missingIsOkay(mautic.contact(id)), getState(id, client)]);
    const subscriber = contact?.email ? await listmonk.findSubscriber(contact.email) : null;
    const subscriberId = subscriber?.id ?? Number(state?.subscriber_id);
    if (subscriberId) await missingIsOkay(listmonk.deleteSubscriber(subscriberId));
    if (contact) await missingIsOkay(mautic.deleteContact(id));
    await client.query('DELETE FROM consent_events WHERE contact_id = $1', [id]);
    await client.query('DELETE FROM contact_state WHERE contact_id = $1', [id]);
  });
}

export async function propagateSuppression(id: number, reason: Reason) {
  const state = await getState(id);
  if (!state || !await isSuppressed(state.email_key)) return;
  const contact = await missingIsOkay(mautic.contact(id));
  if (contact?.email && emailKey(contact.email) !== state.email_key) return;
  const subscriber = state.subscriber_id ? await listmonk.subscriber(Number(state.subscriber_id))
    : contact?.email ? await listmonk.findSubscriber(contact.email) : null;
  await Promise.all([
    contact && !contact.suppressed ? missingIsOkay(mautic.setSuppressed(id, reason)) : null,
    subscriber && !subscriber.blocked ? missingIsOkay(listmonk.blockSubscriber(subscriber.id)) : null,
  ]);
}

export async function enqueueSegmentSync(segmentId: number) {
  const segment = (await mautic.segments()).find(item => item.id === segmentId);
  if (!segment) throw new AppError(404, 'Segment not found.');
  if (!segment.published) throw new AppError(409, 'Publish this segment before synchronising it.');
  await enqueue('segment_sync', segmentId + ':1', { segmentId, page: 1 });
  await recordActivity('Segment synchronisation queued', '/audience');
}

export async function syncSegment(segmentId: number, page: number) {
  if (page === 1) {
    const segment = (await mautic.segments()).find(item => item.id === segmentId && item.published);
    if (!segment) throw new AppError(404, 'Published segment not found.');
    await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [64337, segmentId]);
      const exists = await client.query('SELECT list_id FROM segment_lists WHERE segment_id = $1', [segmentId]);
      if (exists.rows.length) return;
      const marker = 'ovelio-segment-' + segmentId;
      const found = (await listmonk.lists()).find(list => list.tags.includes(marker));
      const list = found ?? await listmonk.createList({ name: segment.name, tags: [marker] });
      await client.query('INSERT INTO segment_lists (segment_id, list_id) VALUES ($1, $2)', [segmentId, list.id]);
    });
  }
  const response = await mautic.contacts({ segmentId, page, limit: contactsPerPage });
  await transaction(async client => {
    for (const contact of response.items) await enqueue('contact_sync', String(contact.id), { contactId: contact.id }, client);
    if (page * response.limit < response.total) {
      await enqueue('segment_sync', segmentId + ':' + (page + 1), { segmentId, page: page + 1 }, client);
    }
  });
}

export async function syncContact(id: number) {
  const state = await getState(id);
  if (!state || state.consent === 'unknown') return;
  const contact = await missingIsOkay(mautic.contact(id));
  if (!contact?.email || emailKey(contact.email) !== state.email_key) return;
  const known = state.subscriber_id ? await listmonk.subscriber(Number(state.subscriber_id)) : null;
  const existing = known && emailKey(known.email) === state.email_key ? known : await listmonk.findSubscriber(contact.email);
  if (contact.suppressed || nativeSuppressed(existing)) {
    await receiveSuppression(contact.email, 'unsubscribe', 'Upstream email preferences');
    return;
  }
  if (state.consent === 'suppressed' || await isSuppressed(state.email_key)) return;
  const [segments, mapped] = await Promise.all([
    mautic.contactSegments(id), db.query<Membership>('SELECT segment_id, list_id FROM segment_lists'),
  ]);
  const memberOf = new Set(segments.filter(segment => segment.published).map(segment => segment.id));
  const allManaged = new Set(mapped.rows.map(row => Number(row.list_id)));
  const selected = mapped.rows.filter(row => memberOf.has(Number(row.segment_id))).map(row => Number(row.list_id));
  if (!selected.length && !existing) return;
  const subscriber = await listmonk.upsertSubscriber({
    mauticId: id, email: contact.email, name: [contact.firstName, contact.lastName].filter(Boolean).join(' '), lists: selected,
  }, existing?.id);
  if (nativeSuppressed(subscriber)) {
    await receiveSuppression(contact.email, 'unsubscribe', 'Newsletter preferences');
    return;
  }
  const removed = subscriber.lists.map(list => list.id).filter(listId => allManaged.has(listId) && !selected.includes(listId));
  if (removed.length) await listmonk.removeSubscriberFromLists(subscriber.id, removed);
  await db.query('UPDATE contact_state SET subscriber_id = $1 WHERE contact_id = $2 AND email_key = $3',
    [subscriber.id, id, state.email_key]);
}

export async function checkRecipient(email: string): Promise<boolean> {
  const key = emailKey(email);
  const state = (await db.query<State>(
    `SELECT ${stateColumns} FROM contact_state WHERE email_key = $1 AND consent = 'opted_in'
     AND NOT EXISTS (SELECT 1 FROM suppressions WHERE email_key = $1)`, [key],
  )).rows[0];
  if (!state) return false;
  const [contact, known] = await Promise.all([
    missingIsOkay(mautic.contact(Number(state.contact_id))),
    state.subscriber_id ? listmonk.subscriber(Number(state.subscriber_id)) : null,
  ]);
  if (!contact?.email || emailKey(contact.email) !== key) return false;
  const subscriber = known && emailKey(known.email) === key ? known : await listmonk.findSubscriber(email);
  if (contact.suppressed || nativeSuppressed(subscriber)) {
    await receiveSuppression(email, 'unsubscribe', 'Upstream email preferences');
    return false;
  }
  const stillAllowed = await db.query(`SELECT 1 FROM contact_state WHERE contact_id = $1 AND email_key = $2
    AND consent = 'opted_in' AND NOT EXISTS (SELECT 1 FROM suppressions WHERE email_key = $2)`, [state.contact_id, key]);
  return stillAllowed.rows.length > 0;
}

const optionalText = z.string().trim().max(150).optional();
export const contactFields = z.object({
  email: z.email().max(254), firstName: optionalText, lastName: optionalText, company: optionalText,
  tags: z.array(z.string().trim().min(1).max(70)).max(30).optional(),
  consent: z.enum(['opted_in', 'unknown']).optional(), evidence: z.string().trim().max(500).optional(),
});

export async function importContacts(csv: string, evidence?: string) {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true, skipEmptyLines: 'greedy', transformHeader: name => name.trim().toLowerCase().replaceAll(/[-_\s]/g, ''),
  });
  if (!result.meta.fields?.includes('email')) throw new AppError(400, 'Include an email column in the CSV.');
  if (!result.data.length || result.data.length > 500) throw new AppError(400, 'Import between 1 and 500 contacts at a time.');
  if (result.errors.some(error => error.type !== 'FieldMismatch')) throw new AppError(400, 'Check the CSV quoting and column formatting.');
  const failed: { row: number; message: string }[] = [];
  const malformed = new Set(result.errors.map(error => error.row));
  let imported = 0;
  for (const [index, row] of result.data.entries()) {
    try {
      if (malformed.has(index)) throw new AppError(400, 'Column count does not match the header.');
      const optedIn = row.consent?.trim().toLowerCase() === 'opted_in' || row.consent?.trim().toLowerCase() === 'optedin';
      const input = contactFields.parse({
        email: row.email?.trim(), firstName: row.firstname || undefined, lastName: row.lastname || undefined,
        company: row.company || undefined, tags: row.tags?.split('|').map(tag => tag.trim()).filter(Boolean),
        consent: optedIn ? 'opted_in' : undefined, evidence: row.evidence || evidence,
      });
      await saveContact(input);
      imported++;
    } catch (error) {
      const message = error instanceof AppError || error instanceof UpstreamError ? error.message
        : error instanceof z.ZodError ? 'Check the email and field lengths.' : 'The contact could not be imported.';
      if (!(error instanceof AppError || error instanceof UpstreamError || error instanceof z.ZodError)) logError('contact-import', error);
      failed.push({ row: index + 2, message });
    }
  }
  if (imported) await recordActivity(`${imported} contact${imported === 1 ? '' : 's'} imported`, '/audience');
  return { imported, failed };
}

export async function exportContacts() {
  const rows: string[][] = [];
  for (let page = 1; ; page++) {
    const result = await mautic.contacts({ page, limit: contactsPerPage });
    if (result.total > 10000) throw new AppError(413, 'Use the source contact archive to export more than 10,000 contacts.');
    const states = await db.query<{ contact_id: string; email_key: string; consent: Consent }>(
      `SELECT contact_id, email_key, consent FROM contact_state WHERE contact_id = ANY($1::bigint[])`,
      [result.items.map(item => item.id)],
    );
    const lookup = new Map(states.rows.map(state => [Number(state.contact_id), state]));
    for (const item of result.items) {
      const state = lookup.get(item.id);
      const consent = item.suppressed ? 'suppressed' : item.email && state?.email_key === emailKey(item.email) ? state.consent : 'unknown';
      rows.push([item.email, item.firstName, item.lastName, item.company, item.tags.join('|'), consent]);
    }
    if (page * result.limit >= result.total || !result.items.length) break;
  }
  return Papa.unparse({ fields: ['email', 'first_name', 'last_name', 'company', 'tags', 'consent'], data: rows }, { escapeFormulae: true });
}

export async function exportContact(id: number) {
  const contact = await contactDetail(id);
  const evidence = await db.query<{ action: string; evidence: string; created_at: Date }>(
    'SELECT action, evidence, created_at FROM consent_events WHERE contact_id = $1 ORDER BY id', [id],
  );
  return { ...contact, consentHistory: evidence.rows };
}
