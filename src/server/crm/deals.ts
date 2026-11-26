// Deals: board, table, create, edit, move, close, bulk changes, export and the deal page. Creation and stage moves go
// through src/server/records.ts so history and deal.* events are identical whichever lane changes a deal.
import { z } from 'zod';
import type { User } from '@/contracts';
import type { BoardColumn, Deal, DealBoard, DealDetail, DealFilters, DealPage, DealPerson, DealSortKey } from '@/contracts/crm';
import { positionBetween, stageRequirementLabels } from '@/contracts/crm';
import type { StageRequirement } from '@/contracts/crm';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { getCompanies, getContact } from '../directory';
import { audit, emitEvent, listEvents } from '../events';
import { json, readBody } from '../http';
import { mailboxRecordVisible } from '../mailbox-access';
import { createDeal, defaultPipelineId, moveDeal } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import {
  activitySelect, assertUser, csvResponse, currency, dealSelect, isoDate, loadDeal, loadHistory, loadMessages, loadPipeline,
  optionalNumber, taskSelect, team, toActivity, toDeal, toTask, uuid,
} from './shared';
import type { ActivityQueryRow, DealQueryRow, TaskQueryRow } from './shared';
import { buildTimeline } from './timeline';

const contactRef = z.number().int().positive().nullable();

const dealInput = z.object({
  name: z.string().trim().min(1).max(200),
  amount: z.number().min(0).max(1e12).optional(),
  currency: currency.optional(),
  pipelineId: uuid.optional(),
  stageId: uuid.optional(),
  ownerId: uuid.nullable().optional(),
  contactId: contactRef.optional(),
  companyId: contactRef.optional(),
  campaignId: uuid.nullable().optional(),
  expectedCloseDate: isoDate.nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
});

const dealPatch = dealInput.omit({ pipelineId: true, stageId: true }).partial().extend({
  custom: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional(),
  lostReason: z.string().trim().max(300).optional(),
});

/* ── Listing ──────────────────────────────────────────────────────────── */

export function readFilters(query: URLSearchParams, user: User): DealFilters {
  const owner = query.get('ownerId') || undefined;
  const status = query.get('status');
  return {
    pipelineId: query.get('pipelineId') ? uuid.parse(query.get('pipelineId')) : undefined,
    ownerId: owner === 'me' ? user.id : owner === 'none' ? 'none' : owner ? uuid.parse(owner) : undefined,
    status: status === 'won' || status === 'lost' || status === 'all' ? status : status === 'open' ? 'open' : undefined,
    q: query.get('q')?.trim().slice(0, 120) || undefined,
    closeFrom: query.get('closeFrom') ? isoDate.parse(query.get('closeFrom')) : undefined,
    closeTo: query.get('closeTo') ? isoDate.parse(query.get('closeTo')) : undefined,
    minAmount: optionalNumber(query.get('minAmount')),
    maxAmount: optionalNumber(query.get('maxAmount')),
    campaignId: query.get('campaignId') ? uuid.parse(query.get('campaignId')) : undefined,
    stageId: query.get('stageId') ? uuid.parse(query.get('stageId')) : undefined,
    contactId: query.get('contactId') ? Number(query.get('contactId')) : undefined,
    companyId: query.get('companyId') ? Number(query.get('companyId')) : undefined,
  };
}

export function dealWhere(filters: DealFilters, values: unknown[], options: { archived?: boolean } = {}) {
  const where: string[] = [options.archived ? 'd.archived_at IS NOT NULL' : 'd.archived_at IS NULL'];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll('?', '$' + values.length)); };
  if (filters.pipelineId) add('d.pipeline_id = ?', filters.pipelineId);
  if (filters.ownerId === 'none') where.push('d.owner_id IS NULL');
  else if (filters.ownerId) add('d.owner_id = ?', filters.ownerId);
  if (filters.status && filters.status !== 'all') add('d.status = ?', filters.status);
  if (filters.q) add(`(d.name ILIKE ? OR d.contact_name ILIKE ? OR d.contact_email ILIKE ? OR d.company_name ILIKE ?)`, `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`);
  if (filters.closeFrom) add('d.expected_close_date >= ?', filters.closeFrom);
  if (filters.closeTo) add('d.expected_close_date <= ?', filters.closeTo);
  if (filters.minAmount != null) add('d.amount >= ?', filters.minAmount);
  if (filters.maxAmount != null) add('d.amount <= ?', filters.maxAmount);
  if (filters.campaignId) add('d.campaign_id = ?', filters.campaignId);
  if (filters.stageId) add('d.stage_id = ?', filters.stageId);
  if (filters.contactId) add('(d.contact_id = ? OR EXISTS (SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = d.id AND dc.contact_id = ?))', filters.contactId);
  if (filters.companyId) add('d.company_id = ?', filters.companyId);
  return where;
}

const sortColumns: Record<DealSortKey, string> = {
  name: 'lower(d.name)', amount: 'd.amount', stage: 's.position', owner: 'lower(u.name)', expectedCloseDate: 'd.expected_close_date',
  createdAt: 'd.created_at', updatedAt: 'd.updated_at', probability: 'coalesce(d.probability, s.probability)', company: 'lower(d.company_name)',
};

export async function listDeals(filters: DealFilters, options: { sort?: DealSortKey; dir?: 'asc' | 'desc'; page?: number; limit?: number; archived?: boolean } = {}): Promise<DealPage> {
  const values: unknown[] = [];
  const where = dealWhere(filters, values, { archived: options.archived });
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 10_000);
  const order = `${sortColumns[options.sort ?? 'updatedAt']} ${options.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, d.id`;
  const count = await db.query<{ total: string }>(
    `SELECT count(*) AS total FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id LEFT JOIN users u ON u.id = d.owner_id WHERE ${where.join(' AND ')}`, values,
  );
  const rows = await db.query<DealQueryRow>(
    `${dealSelect} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, values,
  );
  const now = Date.now();
  return { items: rows.rows.map(row => toDeal(row, now)), total: Number(count.rows[0].total), page, limit };
}

export async function dealBoard(filters: DealFilters): Promise<DealBoard> {
  const pipeline = await loadPipeline(filters.pipelineId ?? await defaultPipelineId());
  const status = filters.status ?? 'open';
  const values: unknown[] = [];
  const where = dealWhere({ ...filters, pipelineId: pipeline.id, status }, values);
  const rows = await db.query<DealQueryRow>(`${dealSelect} WHERE ${where.join(' AND ')} ORDER BY d.board_position, d.created_at DESC LIMIT 2000`, values);
  const now = Date.now();
  const deals = rows.rows.map(row => toDeal(row, now));
  const stages = pipeline.stages.filter(stage => status === 'all' || stage.outcome === status || (status === 'open' && stage.outcome === 'open'));
  const columns: BoardColumn[] = stages.map(stage => {
    const inStage = deals.filter(deal => deal.stageId === stage.id);
    return {
      stage, deals: inStage, count: inStage.length,
      total: inStage.reduce((sum, deal) => sum + deal.amount, 0),
      weighted: Math.round(inStage.reduce((sum, deal) => sum + deal.weightedAmount, 0) * 100) / 100,
    };
  });
  return {
    pipeline, columns,
    totals: {
      count: deals.length, total: deals.reduce((sum, deal) => sum + deal.amount, 0),
      weighted: Math.round(deals.reduce((sum, deal) => sum + deal.weightedAmount, 0) * 100) / 100,
    },
  };
}

/* ── Changes ──────────────────────────────────────────────────────────── */

async function companyName(id: number) {
  const company = (await getCompanies([id])).get(id);
  if (!company) throw new AppError(404, 'That company was not found.');
  return company.name;
}

export async function updateDeal(id: string, input: z.infer<typeof dealPatch>, actorId: string | null): Promise<Deal> {
  const current = await loadDeal(id);
  const sets: string[] = [];
  const values: unknown[] = [id];
  const changes: string[] = [];
  const set = (column: string, value: unknown, label: string) => { values.push(value); sets.push(`${column} = $${values.length}`); changes.push(label); };
  if (input.name !== undefined && input.name !== current.name) set('name', input.name, 'name');
  if (input.amount !== undefined && input.amount !== current.amount) set('amount', input.amount, 'value');
  if (input.currency !== undefined && input.currency !== current.currency) set('currency', input.currency, 'currency');
  if (input.probability !== undefined && input.probability !== current.probability) set('probability', input.probability, 'probability');
  if (input.expectedCloseDate !== undefined && input.expectedCloseDate !== current.expectedCloseDate) set('expected_close_date', input.expectedCloseDate, 'expected close date');
  if (input.campaignId !== undefined && input.campaignId !== current.campaignId) set('campaign_id', input.campaignId, 'campaign');
  if (input.lostReason !== undefined && current.status === 'lost') set('lost_reason', input.lostReason, 'lost reason');
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await assertUser(input.ownerId);
    set('owner_id', input.ownerId, 'owner');
  }
  if (input.contactId !== undefined && input.contactId !== current.contactId) {
    const contact = input.contactId ? await getContact(input.contactId) : null;
    if (input.contactId && !contact) throw new AppError(404, 'That contact was not found.');
    set('contact_id', input.contactId, 'contact');
    values.push(contact?.name ?? '', contact?.email ?? '');
    sets.push(`contact_name = $${values.length - 1}`, `contact_email = $${values.length}`);
    if (input.companyId === undefined && !current.companyId && contact?.company) {
      values.push(contact.company);
      sets.push(`company_name = $${values.length}`);
    }
  }
  if (input.companyId !== undefined && input.companyId !== current.companyId) {
    set('company_id', input.companyId, 'company');
    values.push(input.companyId ? await companyName(input.companyId) : '');
    sets.push(`company_name = $${values.length}`);
  }
  if (input.custom) {
    values.push(JSON.stringify({ ...current.custom, ...input.custom }));
    sets.push(`custom = $${values.length}::jsonb`);
    changes.push('custom fields');
  }
  if (!sets.length) return current;
  await transaction(async client => {
    await client.query(`UPDATE deals SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    const after = (await client.query<{ contact_id: string | null; company_id: string | null; campaign_id: string | null; owner_id: string | null; name: string }>(
      'SELECT contact_id, company_id, campaign_id, owner_id, name FROM deals WHERE id = $1', [id])).rows[0];
    await emitEvent({
      type: 'deal.updated', dealId: id, contactId: after.contact_id ? Number(after.contact_id) : null,
      companyId: after.company_id ? Number(after.company_id) : null, campaignId: after.campaign_id, actorId,
      properties: { name: after.name, changes, ownerId: after.owner_id },
    }, client);
    await audit(actorId, 'update', 'deal', id, `${after.name}: ${changes.join(', ')}`, client);
  });
  return loadDeal(id);
}

const listing = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** What a deal still lacks before it may enter a stage, as labels; empty when it may move. */
export function missingRequirements(deal: Pick<Deal, 'amount' | 'expectedCloseDate' | 'contactId' | 'companyId'>, required: StageRequirement[]) {
  return required.filter(field => field === 'amount' ? !(deal.amount > 0) : field === 'expected_close_date' ? !deal.expectedCloseDate
    : field === 'contact' ? !deal.contactId : !deal.companyId).map(field => stageRequirementLabels[field]);
}

/** Refuses a move into a stage whose required fields the deal does not have, saying what to add. */
export async function assertStageRequirements(dealId: string, stageId: string) {
  const deal = await loadDeal(dealId);
  if (deal.stageId === stageId) return;
  const stage = (await db.query<{ name: string; required_fields: string[] | string }>('SELECT name, required_fields FROM pipeline_stages WHERE id = $1', [stageId])).rows[0];
  if (!stage) throw new AppError(404, 'That pipeline stage was not found.');
  const required = (Array.isArray(stage.required_fields) ? stage.required_fields : String(stage.required_fields ?? '').replace(/[{}]/g, '').split(',').filter(Boolean)) as StageRequirement[];
  const missing = missingRequirements(deal, required);
  if (missing.length) throw new AppError(409, `Add ${listing(missing)} before moving “${deal.name}” to ${stage.name}.`);
}

/** Renumbers a column 0, 1, 2… when repeated drops leave no room between two cards. */
async function renumberColumn(stageId: string) {
  await db.query(
    `UPDATE deals SET board_position = ranked.n FROM (
       SELECT id, row_number() OVER (ORDER BY board_position, created_at DESC) - 1 AS n FROM deals WHERE stage_id = $1 AND archived_at IS NULL
     ) ranked WHERE deals.id = ranked.id`, [stageId],
  );
}

async function neighbourPosition(id: string | null | undefined, stageId: string): Promise<number | null> {
  if (!id) return null;
  const row = (await db.query<{ board_position: number; stage_id: string }>('SELECT board_position, stage_id FROM deals WHERE id = $1', [id])).rows[0];
  if (!row || row.stage_id !== stageId) return null;
  return Number(row.board_position);
}

export async function placeDeal(id: string, input: { stageId: string; previousId?: string | null; nextId?: string | null; lostReason?: string }, actorId: string | null) {
  if (input.previousId === id || input.nextId === id) throw new AppError(400, 'A deal cannot be placed next to itself.');
  let previous = await neighbourPosition(input.previousId, input.stageId);
  let next = await neighbourPosition(input.nextId, input.stageId);
  let position = positionBetween(previous, next);
  if (position == null || (previous != null && next != null && previous >= next)) {
    await renumberColumn(input.stageId);
    previous = await neighbourPosition(input.previousId, input.stageId);
    next = await neighbourPosition(input.nextId, input.stageId);
    position = positionBetween(previous, next) ?? 0;
  }
  await assertStageRequirements(id, input.stageId);
  await moveDeal(id, { stageId: input.stageId, boardPosition: position, lostReason: input.lostReason, actorId });
  return loadDeal(id);
}

async function outcomeStage(pipelineId: string, outcome: 'won' | 'lost' | 'open') {
  const pipeline = await loadPipeline(pipelineId);
  const stage = pipeline.stages.find(item => item.outcome === outcome);
  if (!stage) throw new AppError(409, `Add a ${outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : 'open'} stage to the ${pipeline.name} pipeline first.`);
  return stage.id;
}

export async function closeDeal(id: string, outcome: 'won' | 'lost', lostReason: string | undefined, actorId: string | null) {
  const deal = await loadDeal(id);
  const stageId = await outcomeStage(deal.pipelineId, outcome);
  await assertStageRequirements(id, stageId);
  await moveDeal(id, { stageId, lostReason: outcome === 'lost' ? lostReason ?? '' : undefined, actorId });
  return loadDeal(id);
}

async function people(deal: Deal): Promise<DealPerson[]> {
  const extra = await db.query<{ contact_id: string; contact_name: string; contact_email: string; role: string }>(
    'SELECT contact_id, contact_name, contact_email, role FROM deal_contacts WHERE deal_id = $1 ORDER BY contact_name', [deal.id],
  );
  const list: DealPerson[] = deal.contactId ? [{ contactId: deal.contactId, name: deal.contactName, email: deal.contactEmail, role: 'Primary contact', primary: true }] : [];
  for (const row of extra.rows) {
    if (Number(row.contact_id) === deal.contactId) continue;
    list.push({ contactId: Number(row.contact_id), name: row.contact_name, email: row.contact_email, role: row.role, primary: false });
  }
  return list;
}

export async function dealDetail(id: string, viewerId: string): Promise<DealDetail> {
  const deal = await loadDeal(id);
  const [pipeline, persons, activities, tasks, history, events, members] = await Promise.all([
    loadPipeline(deal.pipelineId), people(deal),
    db.query<ActivityQueryRow>(`${activitySelect} WHERE a.deal_id = $1 AND ${mailboxRecordVisible('a.mailbox_id', '$2')}
      ORDER BY a.occurred_at DESC LIMIT 200`, [id, viewerId]),
    db.query<TaskQueryRow>(`${taskSelect} WHERE t.deal_id = $1 ORDER BY t.status = 'open' DESC, t.due_at NULLS LAST, t.created_at DESC`, [id]),
    loadHistory(id), listEvents({ dealId: id, limit: 200 }, viewerId), team(),
  ]);
  const messages = await loadMessages({ contactIds: persons.map(person => person.contactId), limit: 30 }, viewerId);
  const mappedActivities = activities.rows.map(toActivity);
  const names = { contacts: new Map(persons.map(person => [person.contactId, person.name])), companies: deal.companyId ? new Map([[deal.companyId, deal.companyName]]) : undefined };
  return {
    deal, pipeline, people: persons, activities: mappedActivities, tasks: tasks.rows.map(row => toTask(row, names)), history, messages,
    timeline: buildTimeline({ activities: mappedActivities, events, messages, team: members }),
  };
}

const dealCsvFields = ['Deal', 'Pipeline', 'Stage', 'Status', 'Value', 'Currency', 'Probability %', 'Weighted value (estimate)', 'Owner', 'Contact', 'Contact email', 'Company', 'Expected close', 'Closed at', 'Lost reason', 'Campaign', 'Source', 'Created'];

export const dealEndpoints: Entry[] = [
  route('GET', /^sales\/board$/, async ({ query, user }) => dealBoard(readFilters(query, user)), 'marketer'),
  route('GET', /^sales\/deals$/, async ({ query, user }) => listDeals(readFilters(query, user), {
    sort: z.enum(Object.keys(sortColumns) as [DealSortKey, ...DealSortKey[]]).optional().parse(query.get('sort') || undefined),
    dir: query.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Number(query.get('page') || 1), limit: Number(query.get('limit') || 50), archived: query.get('archived') === 'true',
  }), 'marketer'),
  route('GET', /^sales\/deals\/export$/, async ({ query, user }) => {
    const deals = await listDeals(readFilters(query, user), { limit: 10_000, sort: 'createdAt' });
    return csvResponse(deals.items.map(deal => [
      deal.name, deal.pipelineName, deal.stageName, deal.status, deal.amount, deal.currency, deal.effectiveProbability, deal.weightedAmount,
      deal.ownerName, deal.contactName, deal.contactEmail, deal.companyName, deal.expectedCloseDate, deal.closedAt, deal.lostReason,
      deal.campaignName, deal.sourceLabel, deal.createdAt,
    ]), dealCsvFields, 'ovelio-deals.csv');
  }, 'marketer'),
  route('GET', /^sales\/filter-options$/, async () => {
    const [campaigns, reasons, currencies] = await Promise.all([
      db.query<{ id: string; name: string }>(`SELECT id, name FROM marketing_campaigns WHERE status <> 'archived' ORDER BY lower(name) LIMIT 200`),
      db.query<{ lost_reason: string }>(`SELECT lost_reason FROM deals WHERE lost_reason <> '' GROUP BY lost_reason ORDER BY count(*) DESC LIMIT 20`),
      db.query<{ currency: string }>('SELECT DISTINCT currency FROM deals UNION SELECT DISTINCT currency FROM pipelines'),
    ]);
    return { campaigns: campaigns.rows, lostReasons: reasons.rows.map(row => row.lost_reason), currencies: currencies.rows.map(row => row.currency).sort() };
  }, 'marketer'),
  route('POST', /^sales\/deals$/, async ({ request, user }) => {
    const input = await readBody(request, dealInput);
    await assertUser(input.ownerId);
    const created = await createDeal({ ...input, ownerId: input.ownerId === undefined ? user.id : input.ownerId, source: 'manual', actorId: user.id });
    return json(await loadDeal(created.id), 201);
  }, 'marketer'),
  route('GET', /^sales\/deals\/([0-9a-f-]{36})$/, async ({ params, user }) => dealDetail(uuid.parse(params[0]), user.id), 'marketer'),
  route('PATCH', /^sales\/deals\/([0-9a-f-]{36})$/, async ({ request, params, user }) => updateDeal(uuid.parse(params[0]), await readBody(request, dealPatch), user.id), 'marketer'),
  route('POST', /^sales\/deals\/([0-9a-f-]{36})\/move$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ stageId: uuid, previousId: uuid.nullable().optional(), nextId: uuid.nullable().optional(), lostReason: z.string().trim().max(300).optional() }));
    return placeDeal(uuid.parse(params[0]), input, user.id);
  }, 'marketer'),
  route('POST', /^sales\/deals\/([0-9a-f-]{36})\/close$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ outcome: z.enum(['won', 'lost']), lostReason: z.string().trim().max(300).optional() }));
    return closeDeal(uuid.parse(params[0]), input.outcome, input.lostReason, user.id);
  }, 'marketer'),
  route('POST', /^sales\/deals\/([0-9a-f-]{36})\/reopen$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const input = await readBody(request, z.object({ stageId: uuid.optional() }));
    const deal = await loadDeal(id);
    const stageId = input.stageId ?? await outcomeStage(deal.pipelineId, 'open');
    await assertStageRequirements(id, stageId);
    await moveDeal(id, { stageId, actorId: user.id });
    return loadDeal(id);
  }, 'marketer'),
  route('POST', /^sales\/deals\/([0-9a-f-]{36})\/archive$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const { archived } = await readBody(request, z.object({ archived: z.boolean() }));
    const deal = await loadDeal(id);
    await db.query('UPDATE deals SET archived_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1', [id, archived]);
    await audit(user.id, archived ? 'archive' : 'restore', 'deal', id, deal.name);
    return loadDeal(id);
  }, 'marketer'),
  route('POST', /^sales\/deals\/bulk$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({
      ids: z.array(uuid).min(1).max(200), ownerId: uuid.nullable().optional(), stageId: uuid.optional(),
      status: z.enum(['won', 'lost', 'open']).optional(), lostReason: z.string().trim().max(300).optional(), archive: z.boolean().optional(),
    }));
    const failed: { id: string; error: string }[] = [];
    for (const id of input.ids) {
      try {
        if (input.ownerId !== undefined) await updateDeal(id, { ownerId: input.ownerId }, user.id);
        if (input.stageId) {
          await assertStageRequirements(id, input.stageId);
          await moveDeal(id, { stageId: input.stageId, actorId: user.id });
        }
        if (input.status === 'won' || input.status === 'lost') await closeDeal(id, input.status, input.lostReason, user.id);
        if (input.status === 'open') {
          const deal = await loadDeal(id);
          if (deal.status !== 'open') await moveDeal(id, { stageId: await outcomeStage(deal.pipelineId, 'open'), actorId: user.id });
        }
        if (input.archive !== undefined) await db.query('UPDATE deals SET archived_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1', [id, input.archive]);
      } catch (error) {
        failed.push({ id, error: (error as Error).message });
      }
    }
    return { updated: input.ids.length - failed.length, failed };
  }, 'marketer'),
  route('POST', /^sales\/deals\/([0-9a-f-]{36})\/people$/, async ({ request, params }) => {
    const id = uuid.parse(params[0]);
    const input = await readBody(request, z.object({ contactId: z.number().int().positive(), role: z.string().trim().max(60).default('') }));
    await loadDeal(id);
    const contact = await getContact(input.contactId);
    if (!contact) throw new AppError(404, 'That contact was not found.');
    await db.query(
      `INSERT INTO deal_contacts (deal_id, contact_id, contact_name, contact_email, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (deal_id, contact_id) DO UPDATE SET role = EXCLUDED.role, contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email`,
      [id, contact.id, contact.name, contact.email, input.role],
    );
    return people(await loadDeal(id));
  }, 'marketer'),
  route('DELETE', /^sales\/deals\/([0-9a-f-]{36})\/people\/(\d+)$/, async ({ params }) => {
    await db.query('DELETE FROM deal_contacts WHERE deal_id = $1 AND contact_id = $2', [uuid.parse(params[0]), Number(params[1])]);
    return new Response(null, { status: 204 });
  }, 'marketer'),
];
