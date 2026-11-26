import type { AppointmentStatus, CalendarProvider } from '@/contracts/calendar';
import { db } from '../db';
import type { Sql } from '../db';
import { schedulePlatformJob } from '../platform/jobs';
import { CalendarMirrorRevoked } from './connections';
import { createProviderCopy, deleteProviderCopy, findProviderCopy, updateProviderCopy } from './mirror-provider';
import type { MirrorLocator } from './mirror-provider';

export const APPOINTMENT_MIRROR = 'calendar.appointment_mirror';

type MirrorRow = {
  id: string;
  host_id: string;
  provider: CalendarProvider;
  target: string;
  remote_id: string | null;
  applied_revision: number | null;
};
type Meeting = { id: string; host_id: string; starts_at: Date; ends_at: Date; status: AppointmentStatus; revision: number };

export async function queueAppointmentMirror(client: Sql, appointmentId: string, hostId: string) {
  const { rowCount } = await client.query(`SELECT 1 FROM calendar_connections c
    WHERE c.mirror_target IS NOT NULL AND (c.user_id = $2 OR EXISTS (
      SELECT 1 FROM calendar_event_mirrors m WHERE m.appointment_id = $1 AND m.host_id = c.user_id
        AND m.provider = c.provider AND m.target = c.mirror_target)) LIMIT 1`, [appointmentId, hostId]);
  if (rowCount) await schedulePlatformJob(APPOINTMENT_MIRROR, appointmentId, { appointmentId }, { client });
}

const locator = (row: MirrorRow): MirrorLocator => ({
  id: row.id, provider: row.provider, hostId: row.host_id, target: row.target, remoteId: row.remote_id,
});

async function reconcile(meeting: Meeting, row: MirrorRow) {
  try {
    const remove = meeting.status === 'cancelled' || row.host_id !== meeting.host_id;
    if (!remove && row.applied_revision === meeting.revision) return;
    const copy = await findProviderCopy(locator(row));
    if (remove) {
      if (copy) await deleteProviderCopy(locator(row), copy);
      await db.query('DELETE FROM calendar_event_mirrors WHERE id = $1', [row.id]);
      return;
    }
    if (!copy && row.remote_id) {
      // A provider user removed a known copy. A new durable identifier avoids retrying a provider tombstone.
      const result = await db.query<MirrorRow>(`UPDATE calendar_event_mirrors SET id = gen_random_uuid(), remote_id = NULL, applied_revision = NULL
        WHERE id = $1 RETURNING *`, [row.id]);
      row = result.rows[0];
      if (!row) return;
    }
    const times = { start: meeting.starts_at, end: meeting.ends_at };
    if (copy) await updateProviderCopy(locator(row), copy, times);
    const remoteId = copy?.id ?? await createProviderCopy(locator(row), times);
    await db.query('UPDATE calendar_event_mirrors SET remote_id = $2, applied_revision = $3 WHERE id = $1',
      [row.id, remoteId, meeting.revision]);
  } catch (error) {
    if (!(error instanceof CalendarMirrorRevoked)) throw error;
  }
}

export async function runAppointmentMirror(data: { appointmentId: string }) {
  const { rows: [meeting] } = await db.query<Meeting>(
    'SELECT id, host_id, starts_at, ends_at, status, revision FROM calendar_appointments WHERE id = $1', [data.appointmentId]);
  if (!meeting) return;
  if (meeting.status === 'booked') {
    await db.query(`INSERT INTO calendar_event_mirrors (appointment_id, host_id, provider, target)
      SELECT $1, c.user_id, c.provider, c.mirror_target FROM calendar_connections c JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $2 AND c.mirror_target IS NOT NULL AND u.disabled_at IS NULL AND u.role IN ('marketer', 'admin')
       ON CONFLICT (appointment_id, host_id, provider, target) DO NOTHING`, [meeting.id, meeting.host_id]);
  }
  const { rows } = await db.query<MirrorRow>(`SELECT m.* FROM calendar_event_mirrors m JOIN calendar_connections c
    ON c.user_id = m.host_id AND c.provider = m.provider AND c.mirror_target = m.target
    JOIN users u ON u.id = m.host_id WHERE m.appointment_id = $1 AND u.disabled_at IS NULL AND u.role IN ('marketer', 'admin')`, [meeting.id]);
  const results = await Promise.allSettled(rows.map(row => reconcile(meeting, row)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}
