// Contact and company profiles for CRM: ownership (record_owners), deals, tasks, activities, OVELIO messages, platform
// events, 1:1 sales email through the mailer, and typeahead lookups for the deal and task forms.
import { z } from 'zod';
import type { CompanyProfile, ContactProfile, CrmCompany, SalesEmailResult, TeamMember } from '@/contracts/crm';
import { AppError } from '../config';
import { db } from '../db';
import { createCompany, getContact, linkContactToCompany, searchCompanies, searchContacts } from '../directory';
import { audit, emitEvent, listEvents } from '../events';
import { json, readBody } from '../http';
import { sendEmail } from '../mailer';
import { logActivity } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { listDeals } from './deals';
import { companyPeople, engineCompany } from './engine';
import { activitySelect, assertUser, loadMessages, taskSelect, team, toActivity, uuid } from './shared';
import type { ActivityQueryRow, TaskQueryRow } from './shared';
import { mapTasks } from './tasks';
import { buildTimeline } from './timeline';

export async function ownerOf(object: 'contact' | 'company', id: number): Promise<TeamMember | null> {
  const row = await db.query<TeamMember>(
    `SELECT u.id, u.name, u.email FROM record_owners o JOIN users u ON u.id = o.owner_id WHERE o.object = $1 AND o.record_id = $2`, [object, id],
  );
  return row.rows[0] ?? null;
}

export async function assignOwner(object: 'contact' | 'company', ids: number[], ownerId: string | null, actorId: string | null) {
  await assertUser(ownerId);
  const owner = ownerId ? (await team()).get(ownerId) : null;
  let changed = 0;
  for (const id of ids) {
    const before = await db.query<{ owner_id: string }>('SELECT owner_id FROM record_owners WHERE object = $1 AND record_id = $2', [object, id]);
    const previous = before.rows[0]?.owner_id ?? null;
    if (previous === ownerId) continue;
    if (ownerId) {
      await db.query(
        `INSERT INTO record_owners (object, record_id, owner_id) VALUES ($1, $2, $3)
         ON CONFLICT (object, record_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = now()`, [object, id, ownerId],
      );
    } else {
      await db.query('DELETE FROM record_owners WHERE object = $1 AND record_id = $2', [object, id]);
    }
    if (object === 'contact') {
      await emitEvent({
        type: 'contact.owner_changed', contactId: id, actorId, entityType: 'contact', entityId: String(id),
        properties: { fromOwnerId: previous, ownerId, ownerName: owner?.name ?? '' },
      });
    }
    await audit(actorId, 'assign_owner', object, String(id), owner ? `Owner: ${owner.name}` : 'Owner removed');
    changed++;
  }
  return { updated: changed };
}

export async function ownersFor(object: 'contact' | 'company', ids: number[]): Promise<Map<number, TeamMember>> {
  if (!ids.length) return new Map();
  const rows = await db.query<TeamMember & { record_id: string }>(
    `SELECT o.record_id, u.id, u.name, u.email FROM record_owners o JOIN users u ON u.id = o.owner_id
     WHERE o.object = $1 AND o.record_id = ANY($2::bigint[])`, [object, ids],
  );
  return new Map(rows.rows.map(row => [Number(row.record_id), { id: row.id, name: row.name, email: row.email }]));
}

export async function contactProfile(id: number): Promise<ContactProfile> {
  const contact = await getContact(id);
  if (!contact) throw new AppError(404, 'That contact was not found.');
  const [owner, deals, tasks, activities, messages, events, members] = await Promise.all([
    ownerOf('contact', id),
    listDeals({ contactId: id, status: 'all' }, { limit: 100, sort: 'updatedAt' }),
    db.query<TaskQueryRow>(`${taskSelect} WHERE t.contact_id = $1 OR t.deal_id IN (SELECT id FROM deals WHERE contact_id = $1)
      ORDER BY t.status = 'open' DESC, t.due_at NULLS LAST LIMIT 200`, [id]),
    db.query<ActivityQueryRow>(`${activitySelect} WHERE a.contact_id = $1 ORDER BY a.occurred_at DESC LIMIT 200`, [id]),
    loadMessages({ contactIds: [id], limit: 50 }),
    listEvents({ contactId: id, limit: 200 }),
    team(),
  ]);
  const mapped = activities.rows.map(toActivity);
  const { enrolmentsFor } = await import('./sequences');
  return {
    contactId: id, owner, deals: deals.items, tasks: await mapTasks(tasks.rows), activities: mapped, messages, events,
    enrolments: await enrolmentsFor({ contactId: id }), consent: contact.consent,
    timeline: buildTimeline({ activities: mapped, events, messages, team: members }),
  };
}

async function crmCompany(id: number): Promise<CrmCompany> {
  const company = await engineCompany(id);
  const [owner, people, sums] = await Promise.all([
    ownerOf('company', id),
    companyPeople(company, 1),
    db.query<{ open_deals: string; open_value: string | null; won: string | null; currency: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'open') AS open_deals, sum(amount) FILTER (WHERE status = 'open') AS open_value,
         sum(amount) FILTER (WHERE status = 'won') AS won, min(currency) AS currency
       FROM deals WHERE company_id = $1 AND archived_at IS NULL`, [id]),
  ]);
  const row = sums.rows[0];
  return {
    id: company.id, name: company.name, website: company.website, industry: company.industry, city: company.city, country: company.country,
    email: company.email, ownerId: owner?.id ?? null, ownerName: owner?.name ?? '', people: people.total,
    openDeals: Number(row.open_deals), openValue: Number(row.open_value ?? 0), wonRevenue: Number(row.won ?? 0), currency: row.currency ?? 'GBP',
  };
}

export async function companyProfile(id: number): Promise<CompanyProfile> {
  const company = await crmCompany(id);
  const people = await companyPeople(company, 100);
  const [deals, tasks, activities, events, members] = await Promise.all([
    listDeals({ companyId: id, status: 'all' }, { limit: 100, sort: 'updatedAt' }),
    db.query<TaskQueryRow>(`${taskSelect} WHERE t.company_id = $1 OR t.deal_id IN (SELECT id FROM deals WHERE company_id = $1)
      ORDER BY t.status = 'open' DESC, t.due_at NULLS LAST LIMIT 200`, [id]),
    db.query<ActivityQueryRow>(`${activitySelect} WHERE a.company_id = $1 OR a.deal_id IN (SELECT id FROM deals WHERE company_id = $1)
      OR a.contact_id = ANY($2::bigint[]) ORDER BY a.occurred_at DESC LIMIT 200`, [id, people.items.map(person => person.id)]),
    listEvents({ companyId: id, limit: 200 }),
    team(),
  ]);
  const mapped = activities.rows.map(toActivity);
  return {
    company, people: people.items, deals: deals.items, tasks: await mapTasks(tasks.rows), activities: mapped,
    timeline: buildTimeline({ activities: mapped, events, team: members }),
  };
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text from the compose box to simple HTML paragraphs; merge tags survive because braces are not escaped. */
export function textToHtml(body: string) {
  return body.trim().split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n');
}

export async function sendSalesEmail(contactId: number, input: { subject: string; body: string; dealId?: string | null; via?: string }, user: { id: string; email: string; name: string }): Promise<SalesEmailResult> {
  const contact = await getContact(contactId);
  if (!contact) throw new AppError(404, 'That contact was not found.');
  if (!contact.email) throw new AppError(409, 'Add an email address to this contact first.');
  if (input.via && input.via !== 'gateway') {
    const { sendFromMailbox } = await import('./mailboxes');
    return sendFromMailbox(input.via, { contactId, to: contact.email, subject: input.subject, body: input.body, dealId: input.dealId ?? null }, user);
  }
  const result = await sendEmail({
    to: contact.email, subject: input.subject, html: textToHtml(input.body), category: 'sales', source: `sales:${user.id}`,
    contactId, replyTo: user.email, fromName: user.name, createdBy: user.id,
  });
  if (result.status === 'sent') {
    await logActivity({ type: 'email', direction: 'outbound', subject: input.subject, body: input.body.slice(0, 5000), contactId, dealId: input.dealId ?? null, messageId: result.messageId, authorId: user.id });
  }
  return { status: result.status, reason: result.reason, messageId: result.messageId, via: 'gateway' };
}

const recordIds = z.array(z.number().int().positive()).min(1).max(500);

export const peopleEndpoints: Entry[] = [
  route('GET', /^crm\/lookup\/contacts$/, async ({ query }) => searchContacts(query.get('q') ?? '', 10), 'marketer'),
  route('GET', /^crm\/lookup\/companies$/, async ({ query }) => searchCompanies(query.get('q') ?? '', 10), 'marketer'),
  route('POST', /^crm\/lookup\/companies$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({ name: z.string().trim().min(1).max(120), website: z.string().trim().max(200).optional(), contactId: z.number().int().positive().optional() }));
    const company = await createCompany({ name: input.name, website: input.website });
    if (input.contactId) await linkContactToCompany(input.contactId, company.id);
    await audit(user.id, 'create', 'company', String(company.id), company.name);
    return json(company, 201);
  }, 'marketer'),
  route('POST', /^crm\/owners$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({ object: z.enum(['contact', 'company']), ids: recordIds, ownerId: uuid.nullable() }));
    return assignOwner(input.object, input.ids, input.ownerId, user.id);
  }, 'marketer'),
  route('GET', /^crm\/owners$/, async ({ query }) => {
    const object = z.enum(['contact', 'company']).parse(query.get('object'));
    const ids = (query.get('ids') ?? '').split(',').map(Number).filter(id => Number.isInteger(id) && id > 0).slice(0, 500);
    return Object.fromEntries(await ownersFor(object, ids));
  }, 'marketer'),
  route('GET', /^crm\/contacts\/(\d+)\/profile$/, async ({ params }) => contactProfile(Number(params[0])), 'marketer'),
  route('POST', /^crm\/contacts\/(\d+)\/email$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({
      subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(50_000), dealId: uuid.nullable().optional(), via: z.string().max(40).optional(),
    }));
    return sendSalesEmail(Number(params[0]), input, user);
  }, 'marketer'),
  route('GET', /^crm\/companies\/(\d+)\/profile$/, async ({ params }) => companyProfile(Number(params[0])), 'marketer'),
];
