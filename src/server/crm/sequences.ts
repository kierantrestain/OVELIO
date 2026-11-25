// Sales sequences: timed emails (through the mailer, category 'sales') and tasks for one enrolled contact. Each step
// is a 'crm.sequence_step' platform job at its run time. A reply, unsubscribe, bounce or won deal stops the sequence.
import { z } from 'zod';
import type { PlatformEvent } from '@/contracts/platform';
import type { Sequence, SequenceEnrolment, SequenceStep, StepRun } from '@/contracts/crm';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { getContact } from '../directory';
import { audit, emitEvent } from '../events';
import { json, readBody } from '../http';
import { sendEmail } from '../mailer';
import { schedulePlatformJob } from '../platform/jobs';
import { createTask } from '../records';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { textToHtml } from './people';
import { uuid } from './shared';

export const SEQUENCE_JOB = 'crm.sequence_step';

/**
 * A handler cannot reschedule its own job key (the running job is re-queued at once, ignoring runAt), so every
 * scheduled step gets its own key; `position` lets a stale job notice that the enrolment has moved on.
 */
export async function scheduleStep(enrolmentId: string, position: number, runAt: Date, client: Sql = db) {
  await schedulePlatformJob(SEQUENCE_JOB, `${enrolmentId}:${position}:${runAt.getTime()}`, { enrolmentId, position }, { runAt, client });
}

async function cancelSteps(enrolmentId: string) {
  await db.query(`DELETE FROM jobs WHERE status = 'pending' AND dedupe_key LIKE $1`, [`platform:${SEQUENCE_JOB}:${enrolmentId}:%`]);
}

const stepInput = z.object({
  kind: z.enum(['email', 'task']),
  delayDays: z.number().int().min(0).max(365),
  businessHours: z.boolean().default(false),
  subject: z.string().trim().max(200).default(''),
  body: z.string().trim().max(50_000).default(''),
  taskTitle: z.string().trim().max(300).default(''),
  taskType: z.enum(['todo', 'call', 'email', 'meeting', 'follow_up']).default('todo'),
}).superRefine((step, context) => {
  if (step.kind === 'email' && (!step.subject || !step.body)) context.addIssue({ code: 'custom', message: 'Give every email step a subject and a message.' });
  if (step.kind === 'task' && !step.taskTitle) context.addIssue({ code: 'custom', message: 'Give every task step a title.' });
});

const sequenceInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  steps: z.array(stepInput).min(1).max(20),
});

/** Moves a send into Monday-Friday 09:00-17:00 UTC. */
export function businessTime(at: Date): Date {
  const next = new Date(at);
  for (let guard = 0; guard < 8; guard++) {
    const day = next.getUTCDay();
    const hour = next.getUTCHours();
    if (day === 0 || day === 6 || hour >= 17) {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(9, 0, 0, 0);
      continue;
    }
    if (hour < 9) next.setUTCHours(9, 0, 0, 0);
    return next;
  }
  return next;
}

export function stepRunAt(step: { delayDays: number; businessHours: boolean }, from = new Date()): Date {
  const at = new Date(from.getTime() + step.delayDays * 86_400_000);
  return step.businessHours ? businessTime(at) : at;
}

type StepRow = { id: string; sequence_id: string; position: number; kind: 'email' | 'task'; delay_days: number; business_hours: boolean; subject: string; body: string; task_title: string; task_type: SequenceStep['taskType'] };

const toStep = (row: StepRow): SequenceStep => ({
  id: row.id, position: row.position, kind: row.kind, delayDays: row.delay_days, businessHours: row.business_hours,
  subject: row.subject, body: row.body, taskTitle: row.task_title, taskType: row.task_type,
});

export async function listSequences(ids?: string[]): Promise<Sequence[]> {
  const rows = await db.query<{ id: string; name: string; description: string; status: Sequence['status']; created_at: Date; updated_at: Date; active: string; completed: string; stopped: string }>(
    `SELECT s.id, s.name, s.description, s.status, s.created_at, s.updated_at,
       count(e.id) FILTER (WHERE e.status = 'active') AS active, count(e.id) FILTER (WHERE e.status = 'completed') AS completed,
       count(e.id) FILTER (WHERE e.status = 'stopped') AS stopped
     FROM crm_sequences s LEFT JOIN crm_sequence_enrolments e ON e.sequence_id = s.id
     ${ids ? 'WHERE s.id = ANY($1::uuid[])' : ''} GROUP BY s.id ORDER BY s.status = 'archived', lower(s.name)`, ids ? [ids] : [],
  );
  const steps = rows.rows.length ? await db.query<StepRow>('SELECT * FROM crm_sequence_steps WHERE sequence_id = ANY($1::uuid[]) ORDER BY position', [rows.rows.map(row => row.id)]) : { rows: [] as StepRow[] };
  return rows.rows.map(row => ({
    id: row.id, name: row.name, description: row.description, status: row.status,
    steps: steps.rows.filter(step => step.sequence_id === row.id).map(toStep),
    counts: { active: Number(row.active), completed: Number(row.completed), stopped: Number(row.stopped) },
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

async function loadSequence(id: string) {
  const [found] = await listSequences([id]);
  if (!found) throw new AppError(404, 'That sequence was not found.');
  return found;
}

export async function saveSequence(input: z.infer<typeof sequenceInput>, actorId: string, id?: string) {
  const sequenceId = await transaction(async client => {
    const saved = id
      ? await client.query<{ id: string }>('UPDATE crm_sequences SET name = $2, description = $3, status = coalesce($4, status), updated_at = now() WHERE id = $1 RETURNING id',
        [id, input.name, input.description, input.status ?? null])
      : await client.query<{ id: string }>('INSERT INTO crm_sequences (name, description, status, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [input.name, input.description, input.status ?? 'active', actorId]);
    if (!saved.rows[0]) throw new AppError(404, 'That sequence was not found.');
    const sequence = saved.rows[0].id;
    await client.query('DELETE FROM crm_sequence_steps WHERE sequence_id = $1', [sequence]);
    for (const [position, step] of input.steps.entries()) {
      await client.query(
        `INSERT INTO crm_sequence_steps (sequence_id, position, kind, delay_days, business_hours, subject, body, task_title, task_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [sequence, position, step.kind, step.delayDays, step.businessHours, step.subject, step.body, step.taskTitle, step.taskType],
      );
    }
    await audit(actorId, id ? 'update' : 'create', 'sequence', sequence, input.name, client);
    return sequence;
  });
  return loadSequence(sequenceId);
}

type EnrolmentRow = {
  id: string; sequence_id: string; sequence_name: string; contact_id: string; contact_name: string; contact_email: string; status: SequenceEnrolment['status'];
  next_position: number; step_count: string; next_run_at: Date | null; stopped_reason: string; sender_name: string | null; enrolled_at: Date; finished_at: Date | null;
};

export async function enrolmentsFor(filter: { contactId?: number; sequenceId?: string; id?: string }): Promise<SequenceEnrolment[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.contactId) { values.push(filter.contactId); where.push(`e.contact_id = $${values.length}`); }
  if (filter.sequenceId) { values.push(filter.sequenceId); where.push(`e.sequence_id = $${values.length}`); }
  if (filter.id) { values.push(filter.id); where.push(`e.id = $${values.length}`); }
  const rows = await db.query<EnrolmentRow>(
    `SELECT e.id, e.sequence_id, s.name AS sequence_name, e.contact_id, e.contact_name, e.contact_email, e.status, e.next_position,
       (SELECT count(*) FROM crm_sequence_steps st WHERE st.sequence_id = e.sequence_id) AS step_count, e.next_run_at, e.stopped_reason,
       u.name AS sender_name, e.enrolled_at, e.finished_at
     FROM crm_sequence_enrolments e JOIN crm_sequences s ON s.id = e.sequence_id LEFT JOIN users u ON u.id = e.sender_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.enrolled_at DESC LIMIT 300`, values,
  );
  const runs = rows.rows.length ? await db.query<{ enrolment_id: string; position: number; kind: StepRun['kind']; status: StepRun['status']; reason: string; message_id: string | null; task_id: string | null; ran_at: Date }>(
    'SELECT enrolment_id, position, kind, status, reason, message_id, task_id, ran_at FROM crm_sequence_step_runs WHERE enrolment_id = ANY($1::uuid[]) ORDER BY position',
    [rows.rows.map(row => row.id)],
  ) : { rows: [] };
  return rows.rows.map(row => ({
    id: row.id, sequenceId: row.sequence_id, sequenceName: row.sequence_name, contactId: Number(row.contact_id), contactName: row.contact_name,
    contactEmail: row.contact_email, status: row.status, nextPosition: row.next_position, stepCount: Number(row.step_count),
    nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null, stoppedReason: row.stopped_reason, senderName: row.sender_name ?? '',
    enrolledAt: new Date(row.enrolled_at).toISOString(), finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    runs: runs.rows.filter(run => run.enrolment_id === row.id).map(run => ({
      position: run.position, kind: run.kind, status: run.status, reason: run.reason, messageId: run.message_id, taskId: run.task_id,
      ranAt: new Date(run.ran_at).toISOString(),
    })),
  }));
}

export async function enrol(sequenceId: string, contactIds: number[], sender: string, dealId: string | null = null) {
  const sequence = await loadSequence(sequenceId);
  if (sequence.status !== 'active') throw new AppError(409, 'Activate the sequence before enrolling contacts.');
  const results: { contactId: number; status: 'enrolled' | 'already_active' | 'not_found' | 'no_email' }[] = [];
  for (const contactId of contactIds) {
    const contact = await getContact(contactId);
    if (!contact) { results.push({ contactId, status: 'not_found' }); continue; }
    if (!contact.email) { results.push({ contactId, status: 'no_email' }); continue; }
    const runAt = stepRunAt(sequence.steps[0]);
    const created = await transaction(async client => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO crm_sequence_enrolments (sequence_id, contact_id, contact_email, contact_name, next_run_at, sender_id, deal_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (sequence_id, contact_id) WHERE status = 'active' DO NOTHING RETURNING id`,
        [sequenceId, contactId, contact.email, contact.name, runAt.toISOString(), sender, dealId],
      );
      if (!row.rows[0]) return null;
      await scheduleStep(row.rows[0].id, 0, runAt, client);
      await emitEvent({ type: 'sequence.enrolled', contactId, entityType: 'sequence', entityId: sequenceId, actorId: sender, dealId, properties: { sequenceName: sequence.name, enrolmentId: row.rows[0].id } }, client);
      return row.rows[0].id;
    });
    results.push({ contactId, status: created ? 'enrolled' : 'already_active' });
  }
  return { results };
}

async function finish(enrolmentId: string, status: 'completed' | 'stopped', reason = '') {
  const row = (await db.query<{ contact_id: string; sequence_id: string; name: string; deal_id: string | null }>(
    `UPDATE crm_sequence_enrolments e SET status = $2, stopped_reason = $3, finished_at = now(), next_run_at = NULL
     FROM crm_sequences s WHERE e.id = $1 AND e.status = 'active' AND s.id = e.sequence_id RETURNING e.contact_id, e.sequence_id, s.name, e.deal_id`,
    [enrolmentId, status, reason])).rows[0];
  await cancelSteps(enrolmentId);
  if (!row) return;
  await emitEvent({
    type: status === 'completed' ? 'sequence.completed' : 'sequence.stopped', contactId: Number(row.contact_id), entityType: 'sequence',
    entityId: row.sequence_id, dealId: row.deal_id, properties: { sequenceName: row.name, enrolmentId, reason },
    idempotencyKey: `sequence.${status}:${enrolmentId}`,
  });
}

export async function stopEnrolment(id: string, reason: string) {
  await finish(id, 'stopped', reason);
}

/** Job handler: runs the enrolment's next step, records the result, and queues the step after it. */
export async function runSequenceStep(data: { enrolmentId: string; position?: number }) {
  const enrolment = (await db.query<{ id: string; sequence_id: string; contact_id: string; contact_email: string; next_position: number; sender_id: string | null; deal_id: string | null; status: string; seq_status: string }>(
    `SELECT e.id, e.sequence_id, e.contact_id, e.contact_email, e.next_position, e.sender_id, e.deal_id, e.status, s.status AS seq_status
     FROM crm_sequence_enrolments e JOIN crm_sequences s ON s.id = e.sequence_id WHERE e.id = $1`, [data.enrolmentId])).rows[0];
  if (!enrolment || enrolment.status !== 'active') return;
  if (data.position != null && data.position !== enrolment.next_position) return;
  if (enrolment.seq_status !== 'active') {
    // Paused: wait a day and check again, so resuming needs no catch-up step.
    const later = new Date(Date.now() + 86_400_000);
    await db.query('UPDATE crm_sequence_enrolments SET next_run_at = $2 WHERE id = $1', [enrolment.id, later.toISOString()]);
    await scheduleStep(enrolment.id, enrolment.next_position, later);
    return;
  }
  const steps = (await db.query<StepRow>('SELECT * FROM crm_sequence_steps WHERE sequence_id = $1 ORDER BY position', [enrolment.sequence_id])).rows.map(toStep);
  const step = steps[enrolment.next_position];
  if (!step) return finish(enrolment.id, 'completed');
  const contactId = Number(enrolment.contact_id);
  const already = await db.query('SELECT 1 FROM crm_sequence_step_runs WHERE enrolment_id = $1 AND position = $2', [enrolment.id, step.position]);
  if (!already.rows[0]) {
    let status: StepRun['status'] = 'skipped';
    let reason = '';
    let messageId: string | null = null;
    let taskId: string | null = null;
    if (step.kind === 'email') {
      const sender = enrolment.sender_id ? (await db.query<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = $1', [enrolment.sender_id])).rows[0] : undefined;
      const result = await sendEmail({
        to: enrolment.contact_email, subject: step.subject, html: textToHtml(step.body), category: 'sales', source: `sequence:${enrolment.sequence_id}`,
        contactId, replyTo: sender?.email, fromName: sender?.name, createdBy: enrolment.sender_id, idempotencyKey: `sequence:${enrolment.id}:${step.position}`,
      });
      status = result.status;
      reason = result.reason;
      messageId = result.messageId;
    } else {
      const task = await createTask({ title: step.taskTitle, type: step.taskType, contactId, dealId: enrolment.deal_id, assigneeId: enrolment.sender_id, dueAt: new Date(), source: `sequence:${enrolment.sequence_id}`, actorId: enrolment.sender_id });
      status = 'task_created';
      taskId = task.id;
    }
    await db.query(
      `INSERT INTO crm_sequence_step_runs (enrolment_id, step_id, position, kind, status, reason, message_id, task_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (enrolment_id, position) DO NOTHING`, [enrolment.id, step.id, step.position, step.kind, status, reason, messageId, taskId],
    );
    if (status === 'blocked') return finish(enrolment.id, 'stopped', reason);
  }
  const next = steps[enrolment.next_position + 1];
  if (!next) {
    await db.query('UPDATE crm_sequence_enrolments SET next_position = next_position + 1 WHERE id = $1', [enrolment.id]);
    return finish(enrolment.id, 'completed');
  }
  const runAt = stepRunAt(next);
  await db.query('UPDATE crm_sequence_enrolments SET next_position = next_position + 1, next_run_at = $2 WHERE id = $1', [enrolment.id, runAt.toISOString()]);
  await scheduleStep(enrolment.id, enrolment.next_position + 1, runAt);
}

const stopReasons: Partial<Record<PlatformEvent['type'], string>> = {
  'email.replied': 'The contact replied.',
  'email.unsubscribed': 'The contact unsubscribed.',
  'email.bounced': 'An email to the contact bounced.',
  'deal.won': 'The contact’s deal was won.',
};

/** Stops active enrolments for the contact (and, for a won deal, everyone on it). Safe to repeat. */
export async function stopOnEvent(event: PlatformEvent) {
  const reason = stopReasons[event.type];
  if (!reason) return;
  const contactIds = new Set<number>(event.contactId ? [event.contactId] : []);
  if (event.type === 'deal.won' && event.dealId) {
    const people = await db.query<{ contact_id: string }>(
      'SELECT contact_id FROM deals WHERE id = $1 AND contact_id IS NOT NULL UNION SELECT contact_id FROM deal_contacts WHERE deal_id = $1', [event.dealId]);
    for (const row of people.rows) contactIds.add(Number(row.contact_id));
  }
  if (!contactIds.size) return;
  const active = await db.query<{ id: string }>(`SELECT id FROM crm_sequence_enrolments WHERE status = 'active' AND contact_id = ANY($1::bigint[])`, [[...contactIds]]);
  for (const row of active.rows) await finish(row.id, 'stopped', reason);
}

export const sequenceEndpoints: Entry[] = [
  route('GET', /^sales\/sequences$/, async () => listSequences(), 'marketer'),
  route('POST', /^sales\/sequences$/, async ({ request, user }) => json(await saveSequence(await readBody(request, sequenceInput), user.id), 201), 'marketer'),
  route('PATCH', /^sales\/sequences\/([0-9a-f-]{36})$/, async ({ request, params, user }) => saveSequence(await readBody(request, sequenceInput), user.id, uuid.parse(params[0])), 'marketer'),
  route('POST', /^sales\/sequences\/([0-9a-f-]{36})\/status$/, async ({ request, params, user }) => {
    const id = uuid.parse(params[0]);
    const { status } = await readBody(request, z.object({ status: z.enum(['active', 'paused', 'archived']) }));
    await db.query('UPDATE crm_sequences SET status = $2, updated_at = now() WHERE id = $1', [id, status]);
    if (status === 'archived') {
      const active = await db.query<{ id: string }>(`SELECT id FROM crm_sequence_enrolments WHERE sequence_id = $1 AND status = 'active'`, [id]);
      for (const row of active.rows) await finish(row.id, 'stopped', 'The sequence was archived.');
    }
    await audit(user.id, status, 'sequence', id);
    return loadSequence(id);
  }, 'marketer'),
  route('GET', /^sales\/sequences\/([0-9a-f-]{36})\/enrolments$/, async ({ params }) => enrolmentsFor({ sequenceId: uuid.parse(params[0]) }), 'marketer'),
  route('GET', /^sales\/enrolments$/, async ({ query }) => enrolmentsFor({ contactId: query.get('contactId') ? Number(query.get('contactId')) : undefined }), 'marketer'),
  route('POST', /^sales\/sequences\/([0-9a-f-]{36})\/enrol$/, async ({ request, params, user }) => {
    const input = await readBody(request, z.object({ contactIds: z.array(z.number().int().positive()).min(1).max(200), dealId: uuid.nullable().optional() }));
    return enrol(uuid.parse(params[0]), input.contactIds, user.id, input.dealId ?? null);
  }, 'marketer'),
  route('POST', /^sales\/enrolments\/([0-9a-f-]{36})\/stop$/, async ({ params, user }) => {
    await stopEnrolment(uuid.parse(params[0]), `Stopped by ${user.name}.`);
    return (await enrolmentsFor({ id: uuid.parse(params[0]) }))[0];
  }, 'marketer'),
];
