// Per-user workspace module (Product Engineering): notifications, starred and recent records, and preferences.
// Registered in ./modules.ts as the 'workspace' lane, so platform events reach the notification producers.
import { z } from 'zod';
import type { OverviewLayout, Preferences, RecordKind, RecordMark, RecordMarks } from '@/contracts/workspace';
import { recordKinds, recordRoutes } from '@/contracts/workspace';
import { AppError } from '../config';
import { db } from '../db';
import { getCompanies, getContact } from '../directory';
import { readBody } from '../http';
import { route } from '../routes/shared';
import { listNotifications, markNotificationsRead, notifyFromEvent, runTaskReminderNotification, TASK_REMINDER_JOB } from './notifications';
import type { LaneModule } from './types';

const uuid = /^[0-9a-f-]{36}$/;
const kind = z.enum(recordKinds);
const recordId = z.string().trim().min(1).max(64).regex(/^[0-9a-f-]{36}$|^\d{1,18}$/);

/** The record's current name, read from its owning table, or null when it does not exist. */
async function recordLabel(type: RecordKind, id: string): Promise<string | null> {
  const one = async (sql: string) => (await db.query<{ name: string }>(sql, [id])).rows[0]?.name ?? null;
  switch (type) {
    case 'deal': return uuid.test(id) ? one('SELECT name FROM deals WHERE id = $1') : null;
    case 'campaign': return uuid.test(id) ? one('SELECT name FROM marketing_campaigns WHERE id = $1') : null;
    case 'page': return uuid.test(id) ? one('SELECT name FROM landing_pages WHERE id = $1') : null;
    case 'flow': return uuid.test(id) ? one('SELECT name FROM journey_flows WHERE id = $1') : null;
    case 'contact': {
      const contact = /^\d+$/.test(id) ? await getContact(Number(id)).catch(() => null) : null;
      return contact ? (`${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.email) : null;
    }
    case 'company': return /^\d+$/.test(id) ? (await getCompanies([Number(id)]).catch(() => new Map())).get(Number(id))?.name ?? null : null;
  }
}

type MarkRow = { kind: RecordKind; record_id: string; label: string; href: string; at: Date };
const toMark = (row: MarkRow): RecordMark => ({ kind: row.kind, recordId: row.record_id, label: row.label, href: row.href, at: new Date(row.at).toISOString() });

async function marks(userId: string): Promise<RecordMarks> {
  const rows = (await db.query<MarkRow & { mark: string }>(
    `SELECT mark, kind, record_id, label, href, at FROM user_record_marks WHERE user_id = $1 ORDER BY at DESC LIMIT 60`, [userId])).rows;
  return { starred: rows.filter(row => row.mark === 'star').map(toMark), recent: rows.filter(row => row.mark === 'recent').slice(0, 10).map(toMark) };
}

async function saveMark(userId: string, mark: 'star' | 'recent', type: RecordKind, id: string) {
  const label = await recordLabel(type, id);
  if (!label) throw new AppError(404, 'That record no longer exists.');
  const href = recordRoutes.find(item => item.kind === type)!.href(id);
  await db.query(
    `INSERT INTO user_record_marks (user_id, mark, kind, record_id, label, href) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, mark, kind, record_id) DO UPDATE SET label = EXCLUDED.label, at = now()`,
    [userId, mark, type, id, label.slice(0, 200), href],
  );
  if (mark === 'recent') {
    await db.query(`DELETE FROM user_record_marks WHERE user_id = $1 AND mark = 'recent' AND (kind, record_id) NOT IN (
      SELECT kind, record_id FROM user_record_marks WHERE user_id = $1 AND mark = 'recent' ORDER BY at DESC LIMIT 20)`, [userId]);
  }
}

const markInput = z.object({ kind, recordId });
const layout = z.object({ order: z.array(z.string().max(40)).max(30), hidden: z.array(z.string().max(40)).max(30) });
const preferenceInput = z.object({ density: z.enum(['comfortable', 'compact']).optional(), overview: layout.nullable().optional() });

async function preferences(userId: string): Promise<Preferences> {
  const rows = (await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM user_preferences WHERE user_id = $1`, [userId])).rows;
  const value = (key: string) => rows.find(row => row.key === key)?.value;
  return { density: value('density') === 'compact' ? 'compact' : 'comfortable', overview: (value('overview') as OverviewLayout | undefined) ?? null };
}

export const workspaceModule: LaneModule = {
  name: 'workspace',
  endpoints: [
    route('GET', /^platform\/notifications$/, async ({ user }) => listNotifications(user.id)),
    route('POST', /^platform\/notifications\/read$/, async ({ request, user }) => {
      const input = await readBody(request, z.object({ ids: z.array(z.uuid()).max(100).optional() }));
      await markNotificationsRead(user.id, input.ids);
      return listNotifications(user.id);
    }),
    route('GET', /^platform\/marks$/, async ({ user }) => marks(user.id)),
    route('POST', /^platform\/marks\/(star|recent)$/, async ({ request, user, params }) => {
      const input = await readBody(request, markInput);
      await saveMark(user.id, params[0] as 'star' | 'recent', input.kind, input.recordId);
      return marks(user.id);
    }),
    route('DELETE', /^platform\/marks\/star\/(deal|contact|company|campaign|page|flow)\/([0-9a-f-]{36}|\d{1,18})$/, async ({ user, params }) => {
      await db.query(`DELETE FROM user_record_marks WHERE user_id = $1 AND mark = 'star' AND kind = $2 AND record_id = $3`, [user.id, params[0], params[1]]);
      return marks(user.id);
    }),
    route('GET', /^platform\/preferences$/, async ({ user }) => preferences(user.id)),
    route('PATCH', /^platform\/preferences$/, async ({ request, user }) => {
      const input = await readBody(request, preferenceInput);
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        await db.query(`INSERT INTO user_preferences (user_id, key, value) VALUES ($1, $2, $3)
          ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [user.id, key, JSON.stringify(value)]);
      }
      return preferences(user.id);
    }),
  ],
  jobHandlers: { [TASK_REMINDER_JOB]: data => runTaskReminderNotification(data) },
  onPlatformEvent: notifyFromEvent,
  search: async () => [],
  seedPreview: async () => {},
};
