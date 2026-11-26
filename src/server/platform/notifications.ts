// In-app notifications (Product Engineering). `notify()` stores one row per recipient; producers below turn platform
// events into notifications. A dedupe key makes every producer safe to retry.
import type { PlatformEvent } from '@/contracts/platform';
import type { AppNotification, NotificationList } from '@/contracts/workspace';
import { db } from '../db';
import type { Sql } from '../db';
import { schedulePlatformJob } from './jobs';

export type NotifyInput = { userIds: (string | null | undefined)[]; kind: string; title: string; body?: string; href?: string | null; dedupeKey?: string };

/** Creates a notification for each distinct recipient. Returns how many were new. */
export async function notify(input: NotifyInput, client: Sql = db): Promise<number> {
  let created = 0;
  for (const userId of new Set(input.userIds.filter((id): id is string => Boolean(id)))) {
    const result = await client.query(
      `INSERT INTO notifications (user_id, kind, title, body, href, dedupe_key) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [userId, input.kind, input.title.slice(0, 200), (input.body ?? '').slice(0, 500), input.href ?? null, input.dedupeKey ?? null],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

type Row = { id: string; kind: string; title: string; body: string; href: string | null; read_at: Date | null; created_at: Date };

export async function listNotifications(userId: string, limit = 30): Promise<NotificationList> {
  const [items, unread] = await Promise.all([
    db.query<Row>(`SELECT id, kind, title, body, href, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]),
    db.query<{ count: string }>(`SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]),
  ]);
  return {
    unread: Number(unread.rows[0]?.count ?? 0),
    items: items.rows.map((row): AppNotification => ({
      id: row.id, kind: row.kind, title: row.title, body: row.body, href: row.href, read: row.read_at != null,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}

/** Marks the given notifications (or all of them) read for this user. */
export async function markNotificationsRead(userId: string, ids?: string[]) {
  if (ids?.length) await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`, [userId, ids]);
  else await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
}

async function admins() {
  return (await db.query<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' AND disabled_at IS NULL`)).rows.map(row => row.id);
}

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const TASK_REMINDER_JOB = 'platform.task_reminder';

/** Turns one platform event into notifications. Idempotent through dedupe keys. */
export async function notifyFromEvent(event: PlatformEvent) {
  const props = event.properties ?? {};
  if (event.type === 'task.created' && event.entityId) {
    const assignee = typeof props.assigneeId === 'string' ? props.assigneeId : null;
    if (assignee && assignee !== event.actorId) {
      await notify({ userIds: [assignee], kind: 'task.assigned', title: `Task assigned to you: ${text(props.title, 'Untitled task')}`,
        body: 'Someone else assigned you this task.', href: '/sales/tasks', dedupeKey: `task.assigned:${event.entityId}` });
    }
    const task = (await db.query<{ remind_at: Date | null }>(`SELECT remind_at FROM tasks WHERE id = $1`, [event.entityId])).rows[0];
    if (task?.remind_at) await schedulePlatformJob(TASK_REMINDER_JOB, event.entityId, { taskId: event.entityId }, { runAt: new Date(task.remind_at) });
    return;
  }
  if (event.type === 'form.submitted' && event.entityId) {
    const form = (await db.query<{ name: string; created_by: string | null }>(`SELECT name, created_by FROM forms WHERE id::text = $1`, [event.entityId])).rows[0];
    const recipients = form?.created_by ? [form.created_by] : await admins();
    await notify({ userIds: recipients, kind: 'form.lead', title: `New lead from ${text(props.formName, form?.name ?? 'a form')}`,
      body: 'A visitor submitted the form.', href: event.contactId ? `/crm/contacts/${event.contactId}` : '/sites/forms', dedupeKey: `form.lead:${event.id}` });
    return;
  }
  if (event.type === 'flow.failed' && event.entityId) {
    const flow = (await db.query<{ name: string; owner_id: string | null; created_by: string | null }>(
      `SELECT name, owner_id, created_by FROM journey_flows WHERE id::text = $1`, [event.entityId])).rows[0];
    const owner = flow?.owner_id ?? flow?.created_by;
    await notify({ userIds: owner ? [owner] : await admins(), kind: 'flow.failed', title: `Workflow failed: ${text(props.flowName, flow?.name ?? 'workflow')}`,
      body: text(props.error, 'A step failed. Open the run history to retry it.'), href: `/automations/flows/${event.entityId}`, dedupeKey: `flow.failed:${event.id}` });
    return;
  }
  if (event.type === 'deal.won' && event.dealId) {
    const deal = (await db.query<{ name: string; owner_id: string | null }>(`SELECT name, owner_id FROM deals WHERE id = $1`, [event.dealId])).rows[0];
    if (!deal?.owner_id) return;
    await notify({ userIds: [deal.owner_id], kind: 'deal.won', title: `Deal won: ${deal.name}`, body: 'Congratulations, the deal closed won.',
      href: `/sales/deals/${event.dealId}`, dedupeKey: `deal.won:${event.dealId}` });
  }
}

/** Job: tells the assignee a task reminder is due; follows the reminder if it moved later. */
export async function runTaskReminderNotification(data: { taskId: string }) {
  const task = (await db.query<{ title: string; status: string; remind_at: Date | null; assignee_id: string | null; created_by: string | null }>(
    `SELECT title, status, remind_at, assignee_id, created_by FROM tasks WHERE id = $1`, [data.taskId])).rows[0];
  if (!task || task.status !== 'open' || !task.remind_at) return;
  const at = new Date(task.remind_at);
  if (at.getTime() > Date.now() + 60_000) {
    await schedulePlatformJob(TASK_REMINDER_JOB, data.taskId, data, { runAt: at });
    return;
  }
  await notify({ userIds: [task.assignee_id ?? task.created_by], kind: 'task.reminder', title: `Reminder: ${task.title}`,
    body: 'This task’s reminder is due.', href: '/sales/tasks', dedupeKey: `task.reminder:${data.taskId}:${at.toISOString()}` });
}
