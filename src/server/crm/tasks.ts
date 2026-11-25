// Tasks, reminders and logged activities. Tasks are created and completed through records.ts; a reminder is a platform
// job ('crm.task_reminder') at remind_at that stamps reminded_at, which puts the task under "Due reminders".
import { z } from 'zod';
import type { User } from '@/contracts';
import type { CrmTask, TaskPage, TaskView } from '@/contracts/crm';
import { AppError } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { getCompanies, getContacts } from '../directory';
import { audit } from '../events';
import { json, readBody } from '../http';
import { cancelPlatformJob, schedulePlatformJob } from '../platform/jobs';
import { completeTask, createTask, logActivity } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { activitySelect, assertUser, taskSelect, toActivity, toTask, uuid } from './shared';
import type { ActivityQueryRow, TaskQueryRow } from './shared';

const taskType = z.enum(['todo', 'call', 'email', 'meeting', 'follow_up']);
const dateTime = z.iso.datetime({ offset: true }).or(z.iso.datetime());
const recordId = z.number().int().positive().nullable();

const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(5000).optional(),
  type: taskType.optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  dueAt: dateTime.nullable().optional(),
  remindAt: dateTime.nullable().optional(),
  assigneeId: uuid.nullable().optional(),
  contactId: recordId.optional(),
  companyId: recordId.optional(),
  dealId: uuid.nullable().optional(),
});

export const REMINDER_JOB = 'crm.task_reminder';

/** Queues (or replaces) the reminder for an open task, or cancels it. */
export async function syncReminder(task: { id: string; status: string; remind_at: Date | string | null }, client: Sql = db) {
  if (task.status === 'open' && task.remind_at) {
    await schedulePlatformJob(REMINDER_JOB, task.id, { taskId: task.id }, { runAt: new Date(task.remind_at), client });
  } else {
    await cancelPlatformJob(REMINDER_JOB, task.id, client);
  }
}

/** Job handler: marks the reminder as due. Idempotent; ignores tasks completed or rescheduled since it was queued. */
export async function runTaskReminder(data: { taskId: string }) {
  await db.query(
    `UPDATE tasks SET reminded_at = now(), reminder_dismissed_at = NULL
     WHERE id = $1 AND status = 'open' AND remind_at IS NOT NULL AND remind_at <= now() + interval '1 minute'
       AND (reminded_at IS NULL OR reminded_at < remind_at)`, [data.taskId],
  );
}

async function names(rows: TaskQueryRow[]) {
  const contactIds = rows.flatMap(row => row.contact_id ? [Number(row.contact_id)] : []);
  const companyIds = rows.flatMap(row => row.company_id ? [Number(row.company_id)] : []);
  const [contacts, companies] = await Promise.all([
    contactIds.length ? getContacts(contactIds).catch(() => new Map()) : new Map(),
    companyIds.length ? getCompanies(companyIds).catch(() => new Map()) : new Map(),
  ]);
  return {
    contacts: new Map([...contacts].map(([id, contact]) => [id, contact.name as string])),
    companies: new Map([...companies].map(([id, company]) => [id, company.name as string])),
  };
}

export async function mapTasks(rows: TaskQueryRow[]): Promise<CrmTask[]> {
  const lookup = await names(rows);
  const now = Date.now();
  return rows.map(row => toTask(row, lookup, now));
}

export async function loadTask(id: string): Promise<CrmTask> {
  const row = (await db.query<TaskQueryRow>(`${taskSelect} WHERE t.id = $1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'That task was not found.');
  return (await mapTasks([row]))[0];
}

const viewWhere: Record<TaskView, string> = {
  mine: `t.status = 'open' AND t.assignee_id = $1`,
  today: `t.status = 'open' AND t.due_at >= date_trunc('day', now()) AND t.due_at < date_trunc('day', now()) + interval '1 day'`,
  overdue: `t.status = 'open' AND t.due_at < now()`,
  upcoming: `t.status = 'open' AND (t.due_at IS NULL OR t.due_at >= date_trunc('day', now()) + interval '1 day')`,
  completed: `t.status = 'done'`,
  all: `t.status <> 'cancelled'`,
  reminders: `t.status = 'open' AND t.reminded_at IS NOT NULL AND t.reminder_dismissed_at IS NULL AND t.assignee_id = $1`,
};

export async function listTasks(user: User, query: URLSearchParams): Promise<TaskPage> {
  const view = (z.enum(['mine', 'today', 'overdue', 'upcoming', 'completed', 'all', 'reminders']).optional().parse(query.get('view') || undefined) ?? 'mine') as TaskView;
  const values: unknown[] = [user.id];
  const where = [viewWhere[view], '$1::uuid IS NOT NULL'];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll('?', '$' + values.length)); };
  const assignee = query.get('assigneeId');
  if (assignee && view !== 'mine' && view !== 'reminders') {
    if (assignee === 'none') where.push('t.assignee_id IS NULL');
    else add('t.assignee_id = ?', assignee === 'me' ? user.id : uuid.parse(assignee));
  }
  if (query.get('contactId')) add('t.contact_id = ?', Number(query.get('contactId')));
  if (query.get('companyId')) add('t.company_id = ?', Number(query.get('companyId')));
  if (query.get('dealId')) add('t.deal_id = ?', uuid.parse(query.get('dealId')));
  const q = query.get('q')?.trim();
  if (q) add('(t.title ILIKE ? OR t.notes ILIKE ? OR d.name ILIKE ?)', `%${q.replace(/[%_\\]/g, '\\$&')}%`);
  const order = view === 'completed' ? 't.completed_at DESC' : 't.due_at ASC NULLS LAST, t.priority = \'high\' DESC, t.created_at DESC';
  const rows = await db.query<TaskQueryRow>(`${taskSelect} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`, values);
  const counts = await db.query<Record<TaskView, string>>(
    `SELECT ${Object.entries(viewWhere).map(([key, sql]) => `count(*) FILTER (WHERE ${sql}) AS "${key}"`).join(', ')}
     FROM tasks t`, [user.id],
  );
  const countRow = counts.rows[0];
  return {
    items: await mapTasks(rows.rows), total: rows.rows.length,
    counts: Object.fromEntries(Object.keys(viewWhere).map(key => [key, Number(countRow[key as TaskView] ?? 0)])) as Record<TaskView, number>,
  };
}

export async function saveTask(input: z.infer<typeof taskInput>, actorId: string, id?: string): Promise<CrmTask> {
  await assertUser(input.assigneeId);
  if (input.dueAt && input.remindAt && Date.parse(input.remindAt) > Date.parse(input.dueAt)) {
    throw new AppError(400, 'Set the reminder before the due time.');
  }
  if (!id) {
    const task = await createTask({ ...input, assigneeId: input.assigneeId === undefined ? actorId : input.assigneeId, actorId, source: 'manual' });
    await syncReminder(task);
    return loadTask(task.id);
  }
  const fields: [string, unknown][] = [];
  const map: Record<string, string> = {
    title: 'title', notes: 'notes', type: 'type', priority: 'priority', dueAt: 'due_at', remindAt: 'remind_at',
    assigneeId: 'assignee_id', contactId: 'contact_id', companyId: 'company_id', dealId: 'deal_id',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = input[key as keyof typeof input];
    if (value !== undefined) fields.push([column, value]);
  }
  const values: unknown[] = [id, ...fields.map(([, value]) => value)];
  const updated = await db.query<{ id: string; status: string; remind_at: Date | null }>(
    `UPDATE tasks SET ${fields.map(([column], index) => `${column} = $${index + 2}`).join(', ')}${fields.length ? ',' : ''}
       reminded_at = CASE WHEN $${values.length + 1} THEN NULL ELSE reminded_at END, updated_at = now()
     WHERE id = $1 RETURNING id, status, remind_at`,
    [...values, input.remindAt !== undefined],
  );
  if (!updated.rows[0]) throw new AppError(404, 'That task was not found.');
  await syncReminder(updated.rows[0]);
  await audit(actorId, 'update', 'task', id, input.title ?? '');
  return loadTask(id);
}

const activityInput = z.object({
  type: z.enum(['note', 'call', 'meeting', 'email', 'other']),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().max(20_000).optional(),
  direction: z.enum(['inbound', 'outbound']).nullable().optional(),
  outcome: z.string().trim().max(120).optional(),
  durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  occurredAt: dateTime.optional(),
  contactId: recordId.optional(),
  companyId: recordId.optional(),
  dealId: uuid.nullable().optional(),
});

export const taskEndpoints: Entry[] = [
  route('GET', /^sales\/tasks$/, async ({ user, query }) => listTasks(user, query), 'marketer'),
  route('POST', /^sales\/tasks$/, async ({ request, user }) => json(await saveTask(await readBody(request, taskInput), user.id), 201), 'marketer'),
  route('GET', /^sales\/tasks\/([0-9a-f-]{36})$/, async ({ params }) => loadTask(uuid.parse(params[0])), 'marketer'),
  route('PATCH', /^sales\/tasks\/([0-9a-f-]{36})$/, async ({ request, params, user }) => saveTask(await readBody(request, taskInput.partial()) as z.infer<typeof taskInput>, user.id, uuid.parse(params[0])), 'marketer'),
  route('POST', /^sales\/tasks\/([0-9a-f-]{36})\/complete$/, async ({ params, user }) => {
    const task = await completeTask(uuid.parse(params[0]), user.id);
    await syncReminder(task);
    return loadTask(task.id);
  }, 'marketer'),
  route('POST', /^sales\/tasks\/([0-9a-f-]{36})\/reopen$/, async ({ params }) => {
    const row = (await db.query<{ id: string; status: string; remind_at: Date | null }>(
      `UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = now() WHERE id = $1 RETURNING id, status, remind_at`, [uuid.parse(params[0])])).rows[0];
    if (!row) throw new AppError(404, 'That task was not found.');
    if (row.remind_at && new Date(row.remind_at).getTime() > Date.now()) await syncReminder(row);
    return loadTask(row.id);
  }, 'marketer'),
  route('POST', /^sales\/tasks\/bulk-complete$/, async ({ request, user }) => {
    const { ids } = await readBody(request, z.object({ ids: z.array(uuid).min(1).max(200) }));
    for (const id of ids) await syncReminder(await completeTask(id, user.id));
    return { completed: ids.length };
  }, 'marketer'),
  route('POST', /^sales\/tasks\/([0-9a-f-]{36})\/dismiss-reminder$/, async ({ params }) => {
    await db.query('UPDATE tasks SET reminder_dismissed_at = now() WHERE id = $1', [uuid.parse(params[0])]);
    return loadTask(uuid.parse(params[0]));
  }, 'marketer'),
  route('DELETE', /^sales\/tasks\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const id = uuid.parse(params[0]);
    await cancelPlatformJob(REMINDER_JOB, id);
    const removed = await db.query<{ title: string }>('DELETE FROM tasks WHERE id = $1 RETURNING title', [id]);
    if (removed.rows[0]) await audit(user.id, 'delete', 'task', id, removed.rows[0].title);
    return new Response(null, { status: 204 });
  }, 'marketer'),

  route('GET', /^crm\/activities$/, async ({ query }) => {
    const values: unknown[] = [];
    const where: string[] = [];
    for (const [param, column] of [['contactId', 'a.contact_id'], ['companyId', 'a.company_id'], ['dealId', 'a.deal_id']] as const) {
      const value = query.get(param);
      if (!value) continue;
      values.push(param === 'dealId' ? uuid.parse(value) : Number(value));
      where.push(`${column} = $${values.length}`);
    }
    if (query.get('type')) {
      values.push(query.get('type'));
      where.push(`a.type = $${values.length}`);
    }
    const rows = await db.query<ActivityQueryRow>(`${activitySelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.occurred_at DESC LIMIT 200`, values);
    return rows.rows.map(toActivity);
  }, 'marketer'),
  route('POST', /^crm\/activities$/, async ({ request, user }) => {
    const input = await readBody(request, activityInput);
    const id = await logActivity({ ...input, authorId: user.id });
    const row = (await db.query<ActivityQueryRow>(`${activitySelect} WHERE a.id = $1`, [id])).rows[0];
    return json(toActivity(row), 201);
  }, 'marketer'),
  route('DELETE', /^crm\/activities\/([0-9a-f-]{36})$/, async ({ params, user }) => {
    const id = uuid.parse(params[0]);
    const row = (await db.query<{ author_id: string | null }>('SELECT author_id FROM activities WHERE id = $1', [id])).rows[0];
    if (!row) return new Response(null, { status: 204 });
    if (row.author_id && row.author_id !== user.id && user.role !== 'admin') throw new AppError(403, 'Only the author or an admin can delete this entry.');
    await db.query('DELETE FROM activities WHERE id = $1', [id]);
    await audit(user.id, 'delete', 'activity', id);
    return new Response(null, { status: 204 });
  }, 'marketer'),
];
