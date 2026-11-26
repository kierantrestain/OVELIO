// The lane registry (lead-owned). Order matters for preview seeding: designs and pages exist before campaigns
// and flows reference them, and CRM deals before analytics reads them.
import { calendarModule } from '../calendar/module';
import { crmModule } from '../crm/module';
import { journeysModule } from '../journeys/module';
import { insightsModule } from '../insights/module';
import { sitesModule } from '../sites/module';
import { revenueModule } from '../revenue/module';
import { studioModule } from '../studio/module';
import { db } from '../db';
import { toEvent, eventColumns } from '../events';
import { schedulePlatformJob } from './jobs';
import { workspaceModule } from './workspace';
import type { LaneModule } from './types';

export const laneModules: LaneModule[] = [studioModule, sitesModule, journeysModule, crmModule, revenueModule, calendarModule, insightsModule, workspaceModule];

/** Fans one stored event out as a separate delivery job per lane, so a failing lane retries alone. */
export async function dispatchEvent(data: { eventId: string }) {
  for (const lane of laneModules) {
    await schedulePlatformJob('event.deliver', `${data.eventId}:${lane.name}`, { eventId: data.eventId, lane: lane.name });
  }
}

/** Delivers one event to one lane. Lane handlers must tolerate a repeat after a retry. */
export async function deliverEvent(data: { eventId: string; lane: LaneModule['name'] }) {
  const lane = laneModules.find(item => item.name === data.lane);
  if (!lane) return;
  const result = await db.query(`SELECT ${eventColumns}, mailbox_id FROM events WHERE id = $1`, [data.eventId]);
  const row = result.rows[0];
  if (!row) return;
  // Mailbox-private events drive CRM reply handling. Workspace workflows and their
  // outbound webhook steps must not receive private message fields.
  if (row.mailbox_id && (lane.name !== 'crm' || row.type !== 'email.replied')) return;
  await lane.onPlatformEvent(toEvent(row as Parameters<typeof toEvent>[0]));
}
