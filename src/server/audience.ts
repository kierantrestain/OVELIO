import type { PoolClient } from 'pg';
import Papa from 'papaparse';
import { z } from 'zod';
import type { Consent, ConsentEvent, Contact, ContactSortKey, ContactView, ContactViewInput, ImportMapping, ImportPreview, ImportRun, ImportStatus, ContactDetail, ContactInput, DncEntry, Subscriber, SuppressionRecord } from '../contracts';
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
const dncReasonFor = (reason: Reason | undefined): DncEntry['reason'] => reason === 'unsubscribe' ? 'unsubscribed' : reason === 'bounce' ? 'bounced' : 'manual';
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

function nativeSuppressed(subscriber: Subscriber | null) {
  return Boolean(subscriber?.blocked || subscriber?.lists.some(list => list.status === 'unsubscribed'));
}

async function suppressKey(key: string, reason: Reason, evidence: string, client: PoolClient, contactId?: number) {
  const inserted = await client.query(
    `INSERT INTO suppressions (email_key, reason, comment) VALUES ($1, $2, $3) ON CONFLICT (email_key) DO NOTHING RETURNING email_key`,
    [key, reason, evidence.slice(0, 500)],
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

export async function manualSuppress(email: string, reason: Reason, evidence: string) {
  const normalized = email.trim().toLowerCase();
  const [contact, subscriber] = await Promise.all([
    mautic.findContact(normalized).catch(() => null),
    listmonk.findSubscriber(normalized).catch(() => null),
  ]);
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    if (contact) await saveState(contact, client);
    await suppressKey(emailKey(normalized), reason, evidence.trim(), client, contact?.id);
  });
  await Promise.all([
    contact && !contact.suppressed ? missingIsOkay(mautic.setSuppressed(contact.id, reason, evidence.trim())) : null,
    subscriber && !subscriber.blocked ? missingIsOkay(listmonk.blockSubscriber(subscriber.id)) : null,
  ]);
  await recordActivity('Email address suppressed', '/audience?tab=Suppressions');
}

export async function listSuppressions(): Promise<SuppressionRecord[]> {
  const result = await db.query<{
    email_key: string;
    reason: SuppressionRecord['reason'];
    comment: string;
    created_at: Date;
    contact_id: string | null;
  }>(
    `SELECT s.email_key, s.reason, s.comment, s.created_at, cs.contact_id
     FROM suppressions s
     LEFT JOIN contact_state cs ON cs.email_key = s.email_key
     ORDER BY s.created_at DESC
     LIMIT 200`,
  );
  const records: SuppressionRecord[] = [];
  for (const row of result.rows) {
    const contactId = row.contact_id ? Number(row.contact_id) : null;
    let email: string | null = null;
    if (contactId) {
      const contact = await missingIsOkay(mautic.contact(contactId)).catch(() => null);
      if (contact?.email && emailKey(contact.email) === row.email_key) email = contact.email;
    }
    records.push({
      emailKey: row.email_key,
      reason: row.reason,
      at: row.created_at.toISOString(),
      comment: row.comment,
      contactId,
      email,
    });
  }
  return records;
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

// Imports share the lock with everything else that reads or writes consent, but each one also holds a lock for its own address,
// so many imported rows can be written at the same time while any single address is still handled one at a time.
export async function saveContact(input: ConsentInput, id?: number, options: { parallel?: boolean } = {}) {
  const { consent, evidence, ...fields } = input;
  fields.email = fields.email.trim().toLowerCase();
  if (consent === 'opted_in' && !evidence?.trim()) throw new AppError(400, 'Record where and when the contact consented.');
  const value = await transaction(async client => {
    if (options.parallel) {
      await client.query('SELECT pg_advisory_xact_lock_shared(64337002)');
      await client.query('SELECT pg_advisory_xact_lock(64337003, hashtext($1))', [emailKey(fields.email)]);
    } else {
      await client.query('SELECT pg_advisory_xact_lock(64337002)');
    }
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
  const [contact, segments, activity, state, notes, workflowIds, linkedCompanies, devices, consentRows] = await Promise.all([
    mautic.contact(id),
    mautic.contactSegments(id),
    mautic.contactActivity(id),
    getState(id),
    mautic.contactNotes(id).catch(() => []),
    mautic.contactCampaigns(id).catch(() => []),
    mautic.contactCompanies(id).catch(() => []),
    mautic.contactDevices(id).catch(() => []),
    db.query<{ id: string; action: ConsentEvent['action']; evidence: string; created_at: Date }>(
      'SELECT id, action, evidence, created_at FROM consent_events WHERE contact_id = $1 ORDER BY id DESC LIMIT 30',
      [id],
    ),
  ]);
  const key = contact.email ? emailKey(contact.email) : null;
  const held = key ? (await db.query<{ reason: Reason; comment: string; created_at: Date }>(
    'SELECT reason, comment, created_at FROM suppressions WHERE email_key = $1', [key],
  )).rows[0] : undefined;
  const suppressed = contact.suppressed || Boolean(held);
  // Mautic's rows are the engine's view; a suppression OVELIO holds that the engine does not show yet is listed too.
  const dnc: DncEntry[] = [...(contact.dnc ?? [])];
  if (held && !dnc.some(entry => entry.channel === 'email')) {
    dnc.push({ channel: 'email', reason: dncReasonFor(held.reason), comment: held.comment ?? '', at: held.created_at?.toISOString?.() ?? null });
  }
  let mailingListIds: number[] | undefined;
  let newsletterActivity: ContactDetail['newsletterActivity'];
  let subscriberBounces: ContactDetail['subscriberBounces'];
  if (key && state?.email_key === key) {
    try {
      const subscriber = state.subscriber_id ? await listmonk.subscriber(Number(state.subscriber_id)) : await listmonk.findSubscriber(contact.email);
      mailingListIds = subscriber?.lists.filter(list => list.status !== 'unsubscribed').map(list => list.id) ?? [];
      if (subscriber) {
        const [subAct, subBounces] = await Promise.all([
          listmonk.subscriberActivity(subscriber.id).catch(() => ({ views: [], clicks: [] })),
          listmonk.subscriberBounces(subscriber.id).catch(() => []),
        ]);
        newsletterActivity = subAct;
        subscriberBounces = subBounces;
      }
    } catch (error) {
      logError('contact-lists', error);
    }
  }
  const consentHistory: ConsentEvent[] = consentRows.rows.map(row => ({
    id: String(row.id),
    action: row.action,
    evidence: row.evidence,
    at: row.created_at.toISOString(),
  }));
  return {
    ...contact,
    suppressed,
    dnc,
    segments,
    activity,
    notes,
    workflowIds,
    linkedCompanies,
    devices,
    consentHistory,
    mailingListIds,
    newsletterActivity,
    subscriberBounces,
    consent: suppressed ? 'suppressed' : state?.email_key === key ? state.consent : 'unknown',
  };
}

export async function sendContactEmail(contactId: number, emailId: number) {
  const contact = await mautic.contact(contactId);
  if (!contact.email) throw new AppError(409, 'Add an email address before sending.');
  if (!await checkRecipient(contact.email)) {
    throw new AppError(409, 'Record active marketing consent and ensure the contact is not suppressed before sending email.');
  }
  await mautic.sendEmailToContact(emailId, contactId);
  await recordActivity('Direct journey email sent to contact', `/audience/${contactId}`);
  return { sent: true };
}

export async function clearContactBounces(contactId: number) {
  const [contact, state] = await Promise.all([mautic.contact(contactId), getState(contactId)]);
  const subscriber = state?.subscriber_id
    ? await listmonk.subscriber(Number(state.subscriber_id))
    : contact.email ? await listmonk.findSubscriber(contact.email) : null;
  if (subscriber) await listmonk.deleteSubscriberBounces(subscriber.id);
  await recordActivity('Contact bounce records cleared', `/audience/${contactId}`);
  return contactDetail(contactId);
}

export async function contactDirectory(options: { search?: string; page?: number; limit?: number; segmentId?: number; tag?: string; orderBy?: ContactSortKey; orderByDir?: 'asc' | 'desc' }) {
  const page = await mautic.contacts(options);
  const keys = page.items.filter(item => item.email).map(item => emailKey(item.email));
  const muted = await db.query<{ email_key: string }>(`SELECT email_key FROM suppressions WHERE email_key = ANY($1::text[])`, [keys]);
  const blocked = new Set(muted.rows.map(row => row.email_key));
  return { ...page, items: page.items.map(item => ({
    ...item, suppressed: item.suppressed || Boolean(item.email && blocked.has(emailKey(item.email))),
  })) };
}

export async function bulkUpdateContacts(input: {
  ids: number[];
  action: 'add_tag' | 'remove_tag' | 'add_segment' | 'adjust_points';
  tag?: string;
  segmentId?: number;
  points?: number;
}) {
  let updated = 0;
  for (const contactId of input.ids) {
    if (input.action === 'add_tag' && input.tag) {
      const current = await mautic.contact(contactId);
      const nextTags = [...new Set([...current.tags, input.tag.trim()])];
      await mautic.updateContact(contactId, { email: current.email, tags: nextTags });
      updated++;
    } else if (input.action === 'remove_tag' && input.tag) {
      const current = await mautic.contact(contactId);
      const nextTags = current.tags.filter(t => t.toLowerCase() !== input.tag!.trim().toLowerCase());
      await mautic.updateContact(contactId, { email: current.email, tags: nextTags });
      updated++;
    } else if (input.action === 'add_segment' && input.segmentId) {
      await mautic.addToSegment(input.segmentId, contactId);
      await enqueue('contact_sync', String(contactId), { contactId });
      updated++;
    } else if (input.action === 'adjust_points' && input.points) {
      await mautic.adjustPoints(contactId, input.points);
      updated++;
    }
  }
  await recordActivity(`Bulk contact update applied (${updated})`, '/audience');
  return { updated };
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

export async function resendContactOptin(contactId: number) {
  const contact = await mautic.contact(contactId);
  if (!contact.email) throw new AppError(409, 'Add an email address first.');
  if (!await checkRecipient(contact.email)) throw new AppError(409, 'This contact does not have active marketing consent.');
  const subscriber = await listmonk.findSubscriber(contact.email);
  if (!subscriber) throw new AppError(404, 'No synced newsletter subscriber found for this contact.');
  await listmonk.resendOptin(subscriber.id);
}

export async function deleteSegmentSafely(segmentId: number) {
  await mautic.deleteSegment(segmentId);
  await db.query('DELETE FROM segment_lists WHERE segment_id = $1', [segmentId]);
  await recordActivity('Segment deleted', '/audience?tab=Segments');
}

export async function deleteListSafely(listId: number) {
  const mapping = await db.query('SELECT segment_id FROM segment_lists WHERE list_id = $1', [listId]);
  if (mapping.rows.length) {
    throw new AppError(409, 'This mailing list is linked to an audience segment. Delete the segment instead.');
  }
  await listmonk.deleteList(listId);
  await recordActivity('Mailing list deleted', '/audience?tab=Mailing+lists');
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
  if (!state) return;
  // The suppression row is the truth: it can have been removed or replaced since the job was queued.
  const row = (await db.query<{ reason: Reason; comment: string }>(
    'SELECT reason, comment FROM suppressions WHERE email_key = $1', [state.email_key],
  )).rows[0];
  if (!row) return;
  const contact = await missingIsOkay(mautic.contact(id));
  if (contact?.email && emailKey(contact.email) !== state.email_key) return;
  const subscriber = state.subscriber_id ? await listmonk.subscriber(Number(state.subscriber_id))
    : contact?.email ? await listmonk.findSubscriber(contact.email) : null;
  const mirrored = row.reason ?? reason;
  await Promise.all([
    contact && !contact.suppressed ? missingIsOkay(mautic.setSuppressed(id, mirrored, row.comment)) : null,
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
  email: z.email().max(254),
  firstName: optionalText,
  lastName: optionalText,
  company: optionalText,
  phone: optionalText,
  position: optionalText,
  city: optionalText,
  country: optionalText,
  website: z.string().trim().max(300).optional(),
  tags: z.array(z.string().trim().min(1).max(70)).max(30).optional(),
  // Checked against the field definitions when the contact is saved.
  customFields: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
    z.union([z.string().max(5000), z.array(z.string().max(255)).max(100)]),
  ).refine(values => Object.keys(values).length <= 100).optional(),
  consent: z.enum(['opted_in', 'unknown']).optional(),
  evidence: z.string().trim().max(500).optional(),
});

const reservedColumns = new Set([
  'email', 'firstname', 'lastname', 'company', 'phone', 'position', 'city', 'country', 'website', 'tags', 'consent', 'evidence',
]);
const columnKey = (name: string) => name.trim().toLowerCase().replaceAll(/[-_\s]/g, '');

// Published custom contact fields that the CSV import and export can carry, in a stable order.
async function csvCustomFields() {
  const fields = await mautic.fields('contact');
  return fields.filter(field => field.published && !reservedColumns.has(columnKey(field.alias)));
}

/* ── Import: mapping, rows, dry run and the background job ─────────────────── */

const importSliceMs = 45_000;
const importBatch = 40;
const importParallel = 4;
const maxImportRows = 200_000;
const previewRows = 5;

const coreTargetLabels: Record<string, string> = {
  email: 'Email', firstName: 'First name', lastName: 'Last name', company: 'Company', phone: 'Phone', position: 'Position',
  city: 'City', country: 'Country', website: 'Website', tags: 'Tags (separated by |)', consent: 'Consent (opted_in)', evidence: 'Consent evidence',
};
const coreHeaderNames: Record<string, string[]> = {
  email: ['email', 'emailaddress', 'mail'],
  firstName: ['firstname', 'first', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  company: ['company', 'companyname', 'organisation', 'organization'],
  phone: ['phone', 'phonenumber', 'telephone', 'mobile'],
  position: ['position', 'jobtitle', 'title'],
  city: ['city', 'town'],
  country: ['country'],
  website: ['website', 'url', 'web'],
  tags: ['tags', 'tag'],
  consent: ['consent'],
  evidence: ['evidence', 'consentevidence'],
};

type CustomTarget = { alias: string; label: string };

// Suggests a target for each CSV header by name: core fields first, then custom field aliases and labels.
export function suggestImportMapping(headers: string[], custom: CustomTarget[]): ImportMapping {
  const mapping: ImportMapping = {};
  const taken = new Set<string>();
  for (const header of headers) {
    const key = columnKey(header);
    const core = Object.keys(coreHeaderNames).find(name => !taken.has(name) && (coreHeaderNames[name].includes(key) || columnKey(name) === key));
    const field = core ? undefined : custom.find(item => !taken.has('custom:' + item.alias) && (columnKey(item.alias) === key || columnKey(item.label) === key));
    const target = core ?? (field ? 'custom:' + field.alias : undefined);
    if (target) taken.add(target);
    mapping[header] = target ?? 'skip';
  }
  return mapping;
}

function checkMapping(mapping: ImportMapping, headers: string[], custom: CustomTarget[]) {
  const valid = new Set(['skip', ...Object.keys(coreTargetLabels), ...custom.map(item => 'custom:' + item.alias)]);
  const used = new Set<string>();
  for (const header of headers) {
    const target = mapping[header] ?? 'skip';
    if (!valid.has(target)) throw new AppError(400, 'Choose a valid field for each column.');
    if (target === 'skip') continue;
    if (used.has(target)) throw new AppError(400, 'Each field can be filled from one column only.');
    used.add(target);
  }
  if (!used.has('email')) throw new AppError(400, 'Choose which column holds the email address.');
}

type ParsedCsv = { headers: string[]; rows: Record<string, string>[]; malformed: Set<number> };

function parseCsv(csv: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: name => name.trim() });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  if (!headers.length) throw new AppError(400, 'The CSV needs a header row.');
  if (result.errors.some(error => error.type !== 'FieldMismatch')) throw new AppError(400, 'Check the CSV quoting and column formatting.');
  if (!result.data.length) throw new AppError(400, 'The CSV has no contact rows.');
  if (result.data.length > maxImportRows) throw new AppError(400, `Import up to ${maxImportRows.toLocaleString('en')} contacts per file.`);
  return { headers, rows: result.data, malformed: new Set(result.errors.flatMap(error => error.row === undefined ? [] : [error.row])) };
}

type RowOutcome = { outcome: 'created' | 'updated' | 'skipped' | 'error'; message?: string; email: string };
type RowContext = { mapping: ImportMapping; custom: CustomTarget[]; evidence?: string; updateExisting: boolean; dryRun: boolean };

function rowInput(row: Record<string, string>, ctx: RowContext) {
  const picked: Record<string, string> = {};
  const customFields: Record<string, string> = {};
  for (const [header, target] of Object.entries(ctx.mapping)) {
    const value = row[header]?.trim();
    if (!value || target === 'skip') continue;
    if (target.startsWith('custom:')) customFields[target.slice(7)] = value;
    else picked[target] = value;
  }
  const consent = picked.consent?.toLowerCase();
  return contactFields.parse({
    email: picked.email,
    firstName: picked.firstName, lastName: picked.lastName, company: picked.company, phone: picked.phone,
    position: picked.position, city: picked.city, country: picked.country, website: picked.website,
    tags: picked.tags?.split('|').map(tag => tag.trim()).filter(Boolean),
    customFields,
    consent: consent === 'opted_in' || consent === 'optedin' ? 'opted_in' : undefined,
    evidence: picked.evidence || ctx.evidence,
  });
}

// Applies every consent and suppression rule the single-contact save applies. A dry run runs the same checks but writes nothing.
async function importRow(row: Record<string, string>, malformed: boolean, ctx: RowContext): Promise<RowOutcome> {
  let email = (Object.entries(ctx.mapping).find(([, target]) => target === 'email')?.[0] ?? '');
  email = (row[email] ?? '').trim().toLowerCase();
  try {
    if (malformed) throw new AppError(400, 'Column count does not match the header.');
    const input = rowInput(row, ctx);
    email = input.email.trim().toLowerCase();
    if (input.consent === 'opted_in' && !input.evidence?.trim()) throw new AppError(400, 'Record where and when the contact consented.');
    const found = await mautic.findContact(email);
    if (found && !ctx.updateExisting) return { outcome: 'skipped', message: 'This contact already exists, so it was left as it is.', email };
    if (ctx.dryRun) {
      if (input.consent === 'opted_in' && (found?.suppressed || await isSuppressed(emailKey(email)))) {
        throw new AppError(409, 'This email address is suppressed.');
      }
      if (input.customFields) await mautic.checkContactFields(input);
    } else {
      await saveContact(input, undefined, { parallel: true });
    }
    return { outcome: found ? 'updated' : 'created', email };
  } catch (error) {
    const known = error instanceof AppError || error instanceof UpstreamError || error instanceof z.ZodError;
    if (!known) logError('contact-import', error);
    const message = error instanceof AppError || error instanceof UpstreamError ? error.message
      : error instanceof z.ZodError ? 'Check the email and field lengths.' : 'The contact could not be imported.';
    return { outcome: 'error', message, email };
  }
}

type ImportRow = {
  id: string; file_name: string; status: ImportStatus; dry_run: boolean; csv: string; mapping: ImportMapping; evidence: string | null;
  update_existing: boolean; total: number; processed: number; created: number; updated: number; skipped: number; errors: number;
  created_at: Date; finished_at: Date | null;
};
const importColumns = `id, file_name, status, dry_run, csv, mapping, evidence, update_existing, total, processed, created, updated, skipped, errors, created_at, finished_at`;

function toImportRun(row: ImportRow): ImportRun {
  return {
    id: row.id, fileName: row.file_name, status: row.status, dryRun: row.dry_run, total: row.total, processed: row.processed,
    created: row.created, updated: row.updated, skipped: row.skipped, errors: row.errors,
    createdAt: row.created_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

async function importRecord(id: string) {
  const row = (await db.query<ImportRow>(`SELECT ${importColumns} FROM contact_imports WHERE id = $1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'Import not found.');
  return row;
}

async function customTargets(): Promise<CustomTarget[]> {
  return (await csvCustomFields()).map(field => ({ alias: field.alias, label: field.label }));
}

// Step 1: keep the upload and suggest a column mapping. Nothing is written to the audience yet.
export async function createImportDraft(csv: string, fileName: string, userId?: string, evidence?: string): Promise<{ run: ImportRun; preview: ImportPreview }> {
  const parsed = parseCsv(csv);
  const custom = await customTargets();
  const mapping = suggestImportMapping(parsed.headers, custom);
  const stored = await db.query<ImportRow>(
    `INSERT INTO contact_imports (file_name, csv, mapping, evidence, total, created_by) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${importColumns}`,
    [fileName.slice(0, 200) || 'contacts.csv', csv, JSON.stringify(mapping), evidence?.trim() || null, parsed.rows.length, userId ?? null],
  );
  return {
    run: toImportRun(stored.rows[0]),
    preview: {
      headers: parsed.headers,
      rows: parsed.rows.slice(0, previewRows).map(row => parsed.headers.map(header => row[header] ?? '')),
      rowCount: parsed.rows.length,
      mapping,
      targets: [
        { value: 'skip', label: 'Do not import' },
        ...Object.entries(coreTargetLabels).map(([value, label]) => ({ value, label })),
        ...custom.map(item => ({ value: 'custom:' + item.alias, label: item.label + ' (custom)' })),
      ],
    },
  };
}

// Step 2: store the mapping and queue the run, or a dry run that reports without writing.
export async function startImport(id: string, input: { mapping: ImportMapping; dryRun: boolean; updateExisting: boolean; evidence?: string }) {
  const record = await importRecord(id);
  if (record.status === 'queued' || record.status === 'running') throw new AppError(409, 'This import is already running.');
  if (!record.dry_run && record.status === 'done') throw new AppError(409, 'This import has already been run. Upload the file again to repeat it.');
  const parsed = parseCsv(record.csv);
  checkMapping(input.mapping, parsed.headers, await customTargets());
  await transaction(async client => {
    await client.query('DELETE FROM contact_import_issues WHERE import_id = $1', [id]);
    await client.query(
      `UPDATE contact_imports SET status = 'queued', dry_run = $2, mapping = $3, update_existing = $4, evidence = $5,
         total = $6, processed = 0, created = 0, updated = 0, skipped = 0, errors = 0, started_at = NULL, finished_at = NULL WHERE id = $1`,
      [id, input.dryRun, JSON.stringify(input.mapping), input.updateExisting, input.evidence?.trim() || record.evidence, parsed.rows.length],
    );
    await enqueue('contact_import', id + ':0', { importId: id }, client);
  });
  return toImportRun(await importRecord(id));
}

export async function getImport(id: string) {
  return toImportRun(await importRecord(id));
}

export async function listImports(): Promise<ImportRun[]> {
  const result = await db.query<ImportRow>(`SELECT ${importColumns} FROM contact_imports ORDER BY created_at DESC LIMIT 20`);
  return result.rows.map(toImportRun);
}

export async function importIssuesCsv(id: string) {
  await importRecord(id);
  const rows = await db.query<{ row_number: number; outcome: string; email: string; message: string }>(
    'SELECT row_number, outcome, email, message FROM contact_import_issues WHERE import_id = $1 ORDER BY row_number', [id],
  );
  return Papa.unparse({
    fields: ['row', 'result', 'email', 'reason'],
    data: rows.rows.map(row => [row.row_number, row.outcome, row.email, row.message]),
  }, { escapeFormulae: true });
}

// Runs for up to one time slice, saving progress as it goes, then queues itself again until every row is done.
export async function runContactImport(id: string, now: () => number = Date.now) {
  const record = (await db.query<ImportRow>(`SELECT ${importColumns} FROM contact_imports WHERE id = $1`, [id])).rows[0];
  if (!record || (record.status !== 'queued' && record.status !== 'running')) return;
  await db.query("UPDATE contact_imports SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1", [id]);
  const parsed = parseCsv(record.csv);
  const custom = await customTargets();
  const ctx: RowContext = { mapping: record.mapping, custom, evidence: record.evidence ?? undefined, updateExisting: record.update_existing, dryRun: record.dry_run };
  const deadline = now() + importSliceMs;
  let cursor = record.processed;
  while (cursor < parsed.rows.length && now() < deadline) {
    const end = Math.min(cursor + importBatch, parsed.rows.length);
    const outcomes: RowOutcome[] = new Array(end - cursor);
    for (let at = cursor; at < end; at += importParallel) {
      const group = Array.from({ length: Math.min(importParallel, end - at) }, (_, offset) => at + offset);
      const results = await Promise.all(group.map(index => importRow(parsed.rows[index], parsed.malformed.has(index), ctx)));
      results.forEach((result, offset) => { outcomes[group[offset] - cursor] = result; });
    }
    const count = (kind: RowOutcome['outcome']) => outcomes.filter(outcome => outcome.outcome === kind).length;
    const issues = outcomes.flatMap((outcome, offset) => outcome.outcome === 'skipped' || outcome.outcome === 'error'
      ? [{ row: cursor + offset + 2, outcome: outcome.outcome, email: outcome.email.slice(0, 254), message: outcome.message ?? '' }] : []);
    await transaction(async client => {
      if (issues.length) {
        await client.query(
          `INSERT INTO contact_import_issues (import_id, row_number, outcome, email, message)
           SELECT $1, row, outcome, email, message FROM jsonb_to_recordset($2::jsonb) AS x(row integer, outcome text, email text, message text)
           ON CONFLICT (import_id, row_number) DO UPDATE SET outcome = EXCLUDED.outcome, email = EXCLUDED.email, message = EXCLUDED.message`,
          [id, JSON.stringify(issues)],
        );
      }
      await client.query(
        `UPDATE contact_imports SET processed = $2, created = created + $3, updated = updated + $4, skipped = skipped + $5, errors = errors + $6 WHERE id = $1`,
        [id, end, count('created'), count('updated'), count('skipped'), count('error')],
      );
    });
    cursor = end;
  }
  if (cursor < parsed.rows.length) {
    await enqueue('contact_import', id + ':' + cursor, { importId: id });
    return;
  }
  // The upload holds personal data, so a real run drops it; a dry run keeps it for the real run that follows.
  const done = await db.query<{ created: number; updated: number }>(
    `UPDATE contact_imports SET status = 'done', finished_at = now(), csv = CASE WHEN dry_run THEN csv ELSE '' END
     WHERE id = $1 RETURNING created, updated`, [id],
  );
  const changed = (done.rows[0]?.created ?? 0) + (done.rows[0]?.updated ?? 0);
  if (changed && !record.dry_run) await recordActivity(`${changed} contact${changed === 1 ? '' : 's'} imported`, '/audience');
}

// Small synchronous import used by tests and scripts; the console uses the background job above.
export async function importContacts(csv: string, evidence?: string) {
  const parsed = parseCsv(csv);
  if (!parsed.headers.map(columnKey).includes('email')) throw new AppError(400, 'Include an email column in the CSV.');
  const custom = await customTargets();
  const ctx: RowContext = { mapping: suggestImportMapping(parsed.headers, custom), custom, evidence, updateExisting: true, dryRun: false };
  const failed: { row: number; message: string }[] = [];
  let imported = 0;
  for (const [index, row] of parsed.rows.entries()) {
    const result = await importRow(row, parsed.malformed.has(index), ctx);
    if (result.outcome === 'error') failed.push({ row: index + 2, message: result.message ?? '' });
    else imported++;
  }
  if (imported) await recordActivity(`${imported} contact${imported === 1 ? '' : 's'} imported`, '/audience');
  return { imported, failed };
}

/* ── Saved contact list views ──────────────────────────────────────────────── */

type ViewRow = { id: string; name: string; search: string; sort_by: ContactSortKey; sort_dir: 'asc' | 'desc'; created_by: string | null; updated_at: Date };
const toView = (row: ViewRow): ContactView => ({
  id: row.id, name: row.name, search: row.search, sortBy: row.sort_by, sortDir: row.sort_dir, createdBy: row.created_by, updatedAt: row.updated_at.toISOString(),
});
const viewColumns = 'id, name, search, sort_by, sort_dir, created_by, updated_at';

export async function listContactViews(): Promise<ContactView[]> {
  return (await db.query<ViewRow>(`SELECT ${viewColumns} FROM contact_views ORDER BY lower(name)`)).rows.map(toView);
}

export async function saveContactView(input: ContactViewInput, userId?: string, id?: string): Promise<ContactView> {
  try {
    const result = id
      ? await db.query<ViewRow>(
        `UPDATE contact_views SET name = $2, search = $3, sort_by = $4, sort_dir = $5, updated_at = now() WHERE id = $1 RETURNING ${viewColumns}`,
        [id, input.name, input.search, input.sortBy, input.sortDir])
      : await db.query<ViewRow>(
        `INSERT INTO contact_views (name, search, sort_by, sort_dir, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING ${viewColumns}`,
        [input.name, input.search, input.sortBy, input.sortDir, userId ?? null]);
    if (!result.rows[0]) throw new AppError(404, 'View not found.');
    return toView(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new AppError(409, 'A view with this name already exists.');
    throw error;
  }
}

export async function deleteContactView(id: string) {
  await db.query('DELETE FROM contact_views WHERE id = $1', [id]);
}

export async function exportContacts() {
  const custom = await csvCustomFields();
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
      rows.push([
        item.email, item.firstName, item.lastName, item.company,
        item.phone ?? '', item.position ?? '', item.city ?? '', item.country ?? '',
        item.tags.join('|'), consent,
        ...custom.map(field => item.customFields?.[field.alias] ?? ''),
      ]);
    }
    if (page * result.limit >= result.total || !result.items.length) break;
  }
  return Papa.unparse({
    fields: ['email', 'first_name', 'last_name', 'company', 'phone', 'position', 'city', 'country', 'tags', 'consent', ...custom.map(field => field.alias)],
    data: rows,
  }, { escapeFormulae: true });
}

export async function exportContact(id: number) {
  const contact = await contactDetail(id);
  const evidence = await db.query<{ action: string; evidence: string; created_at: Date }>(
    'SELECT action, evidence, created_at FROM consent_events WHERE contact_id = $1 ORDER BY id', [id],
  );
  return { ...contact, consentHistory: evidence.rows };
}

/* ── AUD-08: do-not-contact per channel ───────────────────────────────────── */

const dncToReason: Record<DncEntry['reason'], Reason> = { unsubscribed: 'unsubscribe', bounced: 'bounce', manual: 'manual' };

export type DncRemovalInput = { evidence: string; confirmFixed?: boolean };

// Adds a do-not-contact entry. Email goes through OVELIO (suppressions first, then both engines); SMS is not sent by OVELIO, so it goes to Mautic.
export async function addContactDnc(id: number, channel: 'email' | 'sms', reason: DncEntry['reason'], comment: string) {
  const note = comment.trim();
  const contact = await mautic.contact(id);
  if (channel === 'email') {
    if (!contact.email) throw new AppError(409, 'Add an email address to manage do-not-contact.');
    await manualSuppress(contact.email, dncToReason[reason], note || 'Do not contact added by an operator');
  } else {
    await mautic.addDnc(id, channel, dncToReason[reason], note);
    await recordActivity('Do-not-contact added (' + channel + ')', `/audience/${id}`);
  }
  return contactDetail(id);
}

// Removes an email suppression. It needs typed evidence, is audited, deletes the suppression and reverses both engine mirrors.
// It does not opt the contact in: consent returns to unknown until someone records opt-in.
// A bounce or complaint needs an explicit confirmation that the address was fixed. An erasure is never removed:
// the row is what stops an erased person being added again, and the erase job deletes the contact it would apply to.
export async function removeEmailDnc(id: number, input: DncRemovalInput) {
  const evidence = input.evidence.trim();
  if (!evidence) throw new AppError(400, 'Record why this address can be contacted again.');
  const contact = await mautic.contact(id);
  if (!contact.email) throw new AppError(409, 'Add an email address to manage do-not-contact.');
  const key = emailKey(contact.email);
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    const held = (await client.query<{ reason: Reason }>('SELECT reason FROM suppressions WHERE email_key = $1 FOR UPDATE', [key])).rows[0];
    const engineEntry = contact.dnc?.find(entry => entry.channel === 'email');
    if (!held && !engineEntry && !contact.suppressed) throw new AppError(409, 'This contact has no email do-not-contact entry.');
    const reason: Reason = held?.reason ?? (engineEntry ? dncToReason[engineEntry.reason] : 'manual');
    if (reason === 'erasure') throw new AppError(409, 'An erasure request cannot be undone. The suppression stays so the address is not added again.');
    if ((reason === 'bounce' || reason === 'complaint') && !input.confirmFixed) {
      throw new AppError(409, 'This address was suppressed after a ' + reason + '. Confirm that the address has been fixed before removing it.');
    }
    const state = await saveState(contact, client);
    await client.query('DELETE FROM suppressions WHERE email_key = $1', [key]);
    await client.query(
      `INSERT INTO suppression_removals (email_key, removed_at, reason) VALUES ($1, clock_timestamp(), $2)
       ON CONFLICT (email_key) DO UPDATE SET removed_at = EXCLUDED.removed_at, reason = EXCLUDED.reason`,
      [key, reason],
    );
    await client.query("UPDATE contact_state SET consent = 'unknown', updated_at = now() WHERE contact_id = $1", [state.contact_id]);
    await client.query(
      `INSERT INTO consent_events (contact_id, email_key, action, evidence) VALUES ($1, $2, 'unsuppressed', $3)`,
      [id, key, ((reason === 'bounce' || reason === 'complaint' ? '[address confirmed fixed] ' : '') + evidence).slice(0, 500)],
    );
    await enqueue('unsuppress', key, { contactId: id, emailKey: key }, client);
  });
  await recordActivity('Email do-not-contact removed', `/audience/${id}`);
  return contactDetail(id);
}

export async function removeContactDnc(id: number, channel: 'email' | 'sms', input: DncRemovalInput) {
  if (channel === 'email') return removeEmailDnc(id, input);
  await mautic.removeDnc(id, channel);
  await recordActivity('Do-not-contact removed (' + channel + ')', `/audience/${id}`);
  return contactDetail(id);
}

// Job: reverse the engine mirrors after a removal. The suppression may have come back since (a new unsubscribe), so it checks first.
export async function applySuppressionRemoval(id: number, key: string) {
  if (await isSuppressed(key)) return;
  const contact = await missingIsOkay(mautic.contact(id));
  if (contact?.email && emailKey(contact.email) === key) {
    if (contact.dnc?.some(entry => entry.channel === 'email')) await mautic.removeDnc(id, 'email');
    const subscriber = await listmonk.findSubscriber(contact.email);
    if (subscriber && (subscriber.blocked || nativeSuppressed(subscriber))) await listmonk.unblockSubscriber(subscriber.id);
  }
  await db.query(
    `UPDATE contact_state SET consent = 'unknown', updated_at = now()
     WHERE email_key = $1 AND consent = 'suppressed' AND NOT EXISTS (SELECT 1 FROM suppressions WHERE email_key = $1)`, [key],
  );
}

/* ── X-03: engine-side suppressions flow back into OVELIO ─────────────────── */

type Found = {
  email: string; reason: Reason; at: string | null; evidence: string; contact?: Contact | null; subscriber?: { id: number; blocked: boolean };
};

// Records a suppression that started inside an engine. An engine entry that is not newer than a removal is a leftover
// of that removal, so it is ignored. The check runs under the same lock as the removal.
async function ingestEngineSuppression(found: Found): Promise<'added' | 'known' | 'stale'> {
  const key = emailKey(found.email);
  const outcome = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337002)');
    if (await isSuppressed(key, client)) return 'known' as const;
    const removal = (await client.query<{ removed_at: Date }>('SELECT removed_at FROM suppression_removals WHERE email_key = $1', [key])).rows[0];
    if (removal && (!found.at || Date.parse(found.at) <= new Date(removal.removed_at).getTime())) return 'stale' as const;
    if (found.contact) await saveState(found.contact, client);
    await suppressKey(key, found.reason, found.evidence, client, found.contact?.id);
    return 'added' as const;
  });
  // With a contact, the suppress job mirrors to both engines. Without one, only the newsletter engine knows the address.
  if (outcome === 'added' && !found.contact && found.subscriber && !found.subscriber.blocked) {
    await missingIsOkay(listmonk.blockSubscriber(found.subscriber.id));
  }
  return outcome;
}

const sweepLock = 64337003;
const sweepPage = 50;
const reassertPage = 10;
const skewMargin = 60_000;
type SweepCursor = {
  dncStatId: number; mauticAfter: number; listmonkAfter: number;
  sinceWatermark: string; sinceCycle: string | null; sinceAfter: number;
  reassertAfter: string;
};

// Finds engine-side suppressions and brings OVELIO, Mautic and Listmonk back into agreement. One bounded pass per call,
// in independent lanes. A lane that throws (an engine is down) is logged and skipped; the others still run, and each lane
// saves its own cursor once it has succeeded:
//  - Mautic change feed: new `lead_donotcontact` rows after the last seen id (one tick of latency),
//  - Mautic walk by contact id over every email DNC (the completeness check),
//  - Listmonk rows touched since a stored time (the cycle repeats a margin, so a row changed mid-cycle is seen next time),
//  - Listmonk walk by id over every blocklist or list unsubscribe (bounces can change these without a timestamp), and
//  - a few OVELIO suppressions re-queued for mirroring, so an engine that lost its entry gets it back.
// A session advisory lock on its own pooled connection keeps concurrent workers from running it twice, and no transaction is
// held open across the engine calls.
export async function sweepEngineSuppressions(now = new Date()) {
  const summary = { added: 0, stale: 0, skipped: false, failed: [] as string[] };
  const client = await db.connect();
  let held = false;
  try {
    const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [sweepLock]);
    held = lock.rows[0]?.ok === true;
    if (!held) { summary.skipped = true; return summary; }
    const stored = (await client.query<{ value: Partial<SweepCursor> }>("SELECT value FROM settings WHERE key = 'suppression_sweep'")).rows[0]?.value ?? {};
    const cursor: SweepCursor = {
      dncStatId: stored.dncStatId ?? -1, mauticAfter: stored.mauticAfter ?? 0, listmonkAfter: stored.listmonkAfter ?? 0,
      sinceWatermark: stored.sinceWatermark ?? now.toISOString(), sinceCycle: stored.sinceCycle ?? null, sinceAfter: stored.sinceAfter ?? 0,
      reassertAfter: stored.reassertAfter ?? '',
    };
    const count = (outcome: 'added' | 'known' | 'stale') => { if (outcome === 'added') summary.added++; if (outcome === 'stale') summary.stale++; };
    const save = (patch: Partial<SweepCursor>) => client.query(
      `INSERT INTO settings (key, value) VALUES ('suppression_sweep', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value`, [JSON.stringify(patch)],
    );
    const known = async (keys: string[]) => new Set((await client.query<{ email_key: string }>(
      'SELECT email_key FROM suppressions WHERE email_key = ANY($1::text[])', [keys])).rows.map(row => row.email_key));
    const lane = async (name: string, work: () => Promise<Partial<SweepCursor> | void>) => {
      try {
        const patch = await work();
        if (patch) { Object.assign(cursor, patch); await save(patch); }
      } catch (error) {
        summary.failed.push(name);
        logError('suppression-sweep-' + name, error);
      }
    };
    const fromNewsletter = async (rows: Awaited<ReturnType<typeof listmonk.suppressedSubscribers>>) => {
      const keys = rows.map(row => emailKey(row.email));
      const already = await known(keys);
      for (const [index, row] of rows.entries()) {
        if (already.has(keys[index])) continue;
        try {
          const contact = await mautic.findContact(row.email).catch(() => null);
          count(await ingestEngineSuppression({
            email: row.email, reason: 'unsubscribe', at: row.at, contact, subscriber: row,
            evidence: row.blocked ? 'Newsletter engine blocklist' : 'Newsletter engine list unsubscribe',
          }));
        } catch (error) {
          logError('suppression-sweep-newsletter', error);
        }
      }
    };

    // Mautic change feed. The first run starts at the newest row; the walk below covers what came before.
    await lane('audience-feed', async () => {
      if (cursor.dncStatId < 0) return { dncStatId: (await mautic.dncChanges(0, 1, 'DESC'))[0]?.id ?? 0 };
      const rows = await mautic.dncChanges(cursor.dncStatId, sweepPage);
      if (!rows.length) return;
      // A contact that already has a suppression needs no lookup.
      const covered = new Set((await client.query<{ contact_id: string }>(
        `SELECT cs.contact_id FROM contact_state cs JOIN suppressions s ON s.email_key = cs.email_key WHERE cs.contact_id = ANY($1::bigint[])`,
        [rows.map(row => row.leadId)])).rows.map(row => Number(row.contact_id)));
      for (const row of rows) {
        if (covered.has(row.leadId)) continue;
        try {
          const contact = await missingIsOkay(mautic.contact(row.leadId));
          if (!contact?.email) continue;
          count(await ingestEngineSuppression({
            email: contact.email, reason: dncToReason[row.reason], at: row.at, contact,
            evidence: ('Audience engine do-not-contact (' + row.reason + ')' + (row.comment ? ': ' + row.comment : '')).slice(0, 500),
          }));
        } catch (error) {
          logError('suppression-sweep-audience', error);
        }
      }
      return { dncStatId: rows[rows.length - 1].id };
    });

    // Mautic walk: every contact with an email DNC row, by id.
    await lane('audience-walk', async () => {
      const dnc = await mautic.dncContacts('email', cursor.mauticAfter, sweepPage);
      if (dnc.length) {
        const already = await known(dnc.filter(contact => contact.email).map(contact => emailKey(contact.email)));
        for (const contact of dnc) {
          const entry = contact.dnc?.find(item => item.channel === 'email');
          if (!contact.email || !entry || already.has(emailKey(contact.email))) continue;
          try {
            count(await ingestEngineSuppression({
              email: contact.email, reason: dncToReason[entry.reason], at: entry.at, contact,
              evidence: ('Audience engine do-not-contact (' + entry.reason + ')' + (entry.comment ? ': ' + entry.comment : '')).slice(0, 500),
            }));
          } catch (error) {
            logError('suppression-sweep-audience', error);
          }
        }
      }
      return { mauticAfter: dnc.length < sweepPage ? 0 : dnc[dnc.length - 1].id };
    });

    // Listmonk, changed since the watermark.
    await lane('newsletter-changed', async () => {
      const cycle = cursor.sinceCycle ?? new Date(now.getTime() - skewMargin).toISOString();
      const changed = await listmonk.suppressedSubscribers({ afterId: cursor.sinceAfter, since: cursor.sinceWatermark, limit: sweepPage });
      await fromNewsletter(changed);
      return changed.length < sweepPage
        ? { sinceWatermark: cycle, sinceCycle: null, sinceAfter: 0 }
        : { sinceCycle: cycle, sinceAfter: changed[changed.length - 1].id };
    });

    // Listmonk, the full walk.
    await lane('newsletter-walk', async () => {
      const walk = await listmonk.suppressedSubscribers({ afterId: cursor.listmonkAfter, limit: sweepPage });
      await fromNewsletter(walk);
      return { listmonkAfter: walk.length < sweepPage ? 0 : walk[walk.length - 1].id };
    });

    // OVELIO to the engines. Mirroring is idempotent.
    await lane('mirror', async () => {
      const mirrored = await client.query<{ contact_id: string; reason: Reason; email_key: string }>(
        `SELECT cs.contact_id, s.reason, s.email_key FROM suppressions s JOIN contact_state cs ON cs.email_key = s.email_key
         WHERE s.email_key > $1 ORDER BY s.email_key LIMIT $2`, [cursor.reassertAfter, reassertPage],
      );
      for (const row of mirrored.rows) await enqueue('suppress', row.contact_id, { contactId: Number(row.contact_id), reason: row.reason }, client);
      return { reassertAfter: mirrored.rows.length < reassertPage ? '' : mirrored.rows[mirrored.rows.length - 1].email_key };
    });
    return summary;
  } finally {
    if (held) await client.query('SELECT pg_advisory_unlock($1)', [sweepLock]).catch(() => {});
    client.release();
  }
}
