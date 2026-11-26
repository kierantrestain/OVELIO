// OVELIO-native forms (Lane 3): definitions, server-side validation of submitted values and the submissions list.
import { z } from 'zod';
import type { User } from '@/contracts';
import type { FormDetail, FormField, FormSettings, FormSubmissionRow, FormSummary } from '@/contracts/sites';
import { contactFieldTargets, formStepCount, ruleMatches } from '@/contracts/sites';
import { AppError } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { getContacts } from '../directory';
import { audit } from '../events';
import type { FormRow } from './data';
import { defaultFormSettings, formSettings, iso, uuidPattern } from './data';

const fieldKey = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Field keys use lowercase letters, numbers and underscores, starting with a letter.');
const mapping = z.union([z.enum(contactFieldTargets), z.literal('none'), z.custom<`custom:${string}`>(value => typeof value === 'string' && /^custom:[a-z][a-z0-9_]{0,63}$/.test(value), 'Custom field aliases use lowercase letters, numbers and underscores.')]);

export const fieldSchema = z.object({
  key: fieldKey,
  label: z.string().trim().min(1, 'Give every field a label.').max(200),
  type: z.enum(['text', 'email', 'phone', 'number', 'textarea', 'select', 'radio', 'checkbox', 'checkboxes', 'date', 'url', 'hidden']),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  help: z.string().max(300).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  validation: z.object({
    minLength: z.number().int().min(0).max(5000).optional(),
    maxLength: z.number().int().min(1).max(5000).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().max(200).refine(value => { try { new RegExp(value); return true; } catch { return false; } }, 'Enter a valid regular expression.').optional(),
    message: z.string().max(200).optional(),
  }).optional(),
  mapsTo: mapping.default('none'),
  defaultValue: z.string().max(500).optional(),
  width: z.enum(['full', 'half']).optional(),
  step: z.number().int().min(0).max(9).optional(),
  showIf: z.array(z.object({
    field: fieldKey,
    operator: z.enum(['equals', 'not_equals', 'contains', 'checked', 'not_checked', 'not_empty']),
    value: z.string().max(200).optional(),
  })).max(5).optional(),
  skipIfKnown: z.boolean().optional(),
});

export const settingsSchema = z.object({
  submitLabel: z.string().trim().min(1).max(60),
  afterSubmit: z.enum(['message', 'redirect', 'page']),
  successMessage: z.string().trim().max(1000),
  redirectUrl: z.url({ protocol: /^https?$/ }).max(500).or(z.literal('')),
  thankYouPageId: z.uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  consent: z.object({ enabled: z.boolean(), text: z.string().trim().max(600), required: z.boolean() }),
  confirmationDesignId: z.uuid().nullable(),
  notifyUserId: z.uuid().nullable(),
  steps: z.array(z.object({ title: z.string().trim().max(80) })).max(10),
}).partial();

export const formInput = z.object({
  name: z.string().trim().min(1, 'Name the form.').max(120),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  fields: z.array(fieldSchema).max(60).optional(),
  settings: settingsSchema.optional(),
});

function checkDefinition(fields: FormField[], settings: Partial<FormSettings>) {
  const keys = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.key)) throw new AppError(400, `Two fields use the key “${field.key}”. Each field needs its own key.`);
    keys.add(field.key);
    if (['select', 'radio', 'checkboxes'].includes(field.type) && !field.options?.length) throw new AppError(400, `Add at least one option to “${field.label}”.`);
  }
  const stepCount = formStepCount(settings);
  for (const [index, field] of fields.entries()) {
    if ((field.step ?? 0) >= stepCount) throw new AppError(400, `“${field.label}” is on a step that no longer exists. Choose one of the form’s steps.`);
    for (const rule of field.showIf ?? []) {
      const source = fields.findIndex(other => other.key === rule.field);
      if (source < 0 || source >= index) throw new AppError(400, `“${field.label}” can only depend on a field above it.`);
      if ((fields[source].step ?? 0) > (field.step ?? 0)) throw new AppError(400, `“${field.label}” depends on a field from a later step.`);
      if (['equals', 'not_equals', 'contains'].includes(rule.operator) && !rule.value?.trim()) throw new AppError(400, `Enter the value “${field.label}” depends on.`);
    }
    if (field.mapsTo === 'email' && (field.showIf?.length || field.skipIfKnown)) throw new AppError(400, 'The email field identifies the contact, so it is always shown.');
    if (field.skipIfKnown && (field.mapsTo === 'none' || field.mapsTo.startsWith('custom:'))) throw new AppError(400, `“${field.label}” can be skipped for known contacts only when it fills a contact field.`);
  }
  const ordered = fields.map(field => field.step ?? 0);
  if (ordered.some((step, index) => index > 0 && step < ordered[index - 1])) throw new AppError(400, 'Keep each step’s fields together, in step order.');
  const targets = fields.filter(field => field.mapsTo !== 'none' && !field.mapsTo.startsWith('custom:')).map(field => field.mapsTo);
  const duplicate = targets.find((target, index) => targets.indexOf(target) !== index);
  if (duplicate) throw new AppError(400, `Two fields fill the contact’s ${duplicate}. Map each contact field once.`);
  if (fields.length && !fields.some(field => field.mapsTo === 'email' && field.type === 'email')) {
    throw new AppError(400, 'Add an email field mapped to the contact’s email, so each submission creates or updates a contact.');
  }
  if (settings.afterSubmit === 'redirect' && !settings.redirectUrl) throw new AppError(400, 'Enter the address to send people to after they submit.');
  if (settings.afterSubmit === 'page' && !settings.thankYouPageId) throw new AppError(400, 'Choose the thank-you page.');
}

export async function createForm(input: z.input<typeof formInput>, user: Pick<User, 'id'> | null, client: Sql = db): Promise<{ id: string }> {
  const parsed = formInput.parse(input);
  const fields = parsed.fields ?? [{ key: 'email', label: 'Email address', type: 'email', required: true, mapsTo: 'email' }];
  const settings = { ...defaultFormSettings(), ...(parsed.settings ?? {}) };
  checkDefinition(fields, settings);
  const row = (await client.query<{ id: string }>(
    `INSERT INTO forms (name, description, status, fields, settings, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [parsed.name, parsed.description ?? '', parsed.status ?? 'published', JSON.stringify(fields), JSON.stringify(settings), user?.id ?? null],
  )).rows[0];
  await audit(user?.id, 'create', 'form', row.id, parsed.name, client);
  return row;
}

export async function updateForm(id: string, input: z.input<typeof formInput> | Partial<z.input<typeof formInput>>, user: User) {
  const current = await requireForm(id);
  const parsed = formInput.partial().parse(input);
  const fields = parsed.fields ?? current.fields;
  const settings = { ...formSettings(current), ...(parsed.settings ?? {}) };
  checkDefinition(fields, settings);
  await db.query(
    `UPDATE forms SET name = $2, description = $3, status = $4, fields = $5, settings = $6, updated_by = $7, updated_at = now() WHERE id = $1`,
    [id, parsed.name ?? current.name, parsed.description ?? current.description, parsed.status ?? current.status, JSON.stringify(fields), JSON.stringify(settings), user.id],
  );
  return getFormDetail(id);
}

export async function requireForm(id: string, client: Sql = db): Promise<FormRow> {
  const row = uuidPattern.test(id) ? (await client.query<FormRow>('SELECT * FROM forms WHERE id = $1', [id])).rows[0] : undefined;
  if (!row) throw new AppError(404, 'That form was not found.');
  return row;
}

type CountRow = { form_id: string; total: string; last_at: Date | null };

async function submissionCounts(ids: string[]) {
  if (!ids.length) return new Map<string, CountRow>();
  const rows = await db.query<CountRow>(
    `SELECT form_id, count(*) FILTER (WHERE status = 'accepted') AS total, max(created_at) AS last_at FROM form_submissions WHERE form_id = ANY($1::uuid[]) GROUP BY form_id`, [ids],
  );
  return new Map(rows.rows.map(row => [row.form_id, row]));
}

const toSummary = (row: FormRow, counts: Map<string, CountRow>): FormSummary => ({
  id: row.id, name: row.name, status: row.status, description: row.description, fieldCount: row.fields.length,
  submissions: Number(counts.get(row.id)?.total ?? 0), lastSubmissionAt: iso(counts.get(row.id)?.last_at), updatedAt: iso(row.updated_at)!,
});

export async function listForms(filter: { status?: string; q?: string } = {}): Promise<FormSummary[]> {
  const rows = await db.query<FormRow>(
    `SELECT * FROM forms WHERE ($1::text IS NULL AND status <> 'archived' OR status = $1) AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%') ORDER BY updated_at DESC LIMIT 500`,
    [filter.status || null, filter.q?.trim() || null],
  );
  const counts = await submissionCounts(rows.rows.map(row => row.id));
  return rows.rows.map(row => toSummary(row, counts));
}

export async function getFormDetail(id: string): Promise<FormDetail> {
  const row = await requireForm(id);
  const [counts, pages] = await Promise.all([
    submissionCounts([id]),
    db.query<{ id: string; name: string }>(
      `SELECT p.id, p.name FROM landing_pages p JOIN designs d ON d.id = p.design_id WHERE p.status <> 'archived' AND (d.source LIKE '%' || $1 || '%' OR p.published_html LIKE '%' || $1 || '%') ORDER BY p.name`, [id],
    ),
  ]);
  return { ...toSummary(row, counts), fields: row.fields, settings: formSettings(row), pages: pages.rows };
}

export async function duplicateForm(id: string, user: User) {
  const row = await requireForm(id);
  return createForm({ name: `Copy of ${row.name}`.slice(0, 120), description: row.description, fields: row.fields, settings: formSettings(row), status: 'draft' }, user);
}

export async function deleteForm(id: string, user: User) {
  const row = await requireForm(id);
  const used = await db.query(`SELECT 1 FROM landing_pages p JOIN designs d ON d.id = p.design_id WHERE p.status = 'published' AND p.published_html LIKE '%' || $1 || '%' LIMIT 1`, [id]);
  if (used.rows.length) throw new AppError(409, 'A published page uses this form. Archive the form instead, or remove it from the page first.');
  const submissions = await db.query('SELECT 1 FROM form_submissions WHERE form_id = $1 LIMIT 1', [id]);
  if (submissions.rows.length) {
    await db.query(`UPDATE forms SET status = 'archived', updated_at = now() WHERE id = $1`, [id]);
    await audit(user.id, 'archive', 'form', id, row.name);
    return { archived: true };
  }
  await db.query('DELETE FROM forms WHERE id = $1', [id]);
  await audit(user.id, 'delete', 'form', id, row.name);
  return { archived: false };
}

// ── Validation of submitted values ────────────────────────────────────────────────────────────────────────────

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Answers = Record<string, string | string[]>;

/** Validates submitted values against the form definition. Returns clean values and per-field errors. */
export function validateAnswers(fields: FormField[], raw: Record<string, unknown>, known: ReadonlySet<string> = new Set()): { values: Answers; errors: Record<string, string>; hidden: string[] } {
  const values: Answers = {};
  const errors: Record<string, string> = {};
  const hidden: string[] = [];
  for (const field of fields) {
    // Conditional and progressively skipped fields are judged on the answers above them; hidden ones are never
    // required and never stored, whatever the browser sent.
    if ((field.skipIfKnown && known.has(field.key)) || !(field.showIf ?? []).every(rule => ruleMatches(rule, values))) {
      hidden.push(field.key);
      continue;
    }
    const input = raw[field.key];
    if (field.type === 'checkboxes') {
      const list = (Array.isArray(input) ? input : input == null || input === '' ? [] : [input]).map(item => String(item).trim()).filter(Boolean).slice(0, 100);
      const invalid = list.find(item => !(field.options ?? []).includes(item));
      if (invalid) errors[field.key] = `Choose from the listed options for ${field.label}.`;
      else if (field.required && !list.length) errors[field.key] = `Choose at least one option for ${field.label}.`;
      values[field.key] = list;
      continue;
    }
    const value = (Array.isArray(input) ? String(input[0] ?? '') : input == null ? '' : String(input)).trim().slice(0, 5000);
    if (field.type === 'hidden') { values[field.key] = (value || field.defaultValue || '').slice(0, 500); continue; }
    if (field.type === 'checkbox') {
      const checked = ['yes', 'on', 'true', '1'].includes(value.toLowerCase());
      if (field.required && !checked) errors[field.key] = `Tick ${field.label} to continue.`;
      values[field.key] = checked ? 'yes' : 'no';
      continue;
    }
    if (!value) {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      values[field.key] = '';
      continue;
    }
    const rule = field.validation ?? {};
    if (field.type === 'email' && !emailPattern.test(value)) errors[field.key] = 'Enter a valid email address.';
    else if (field.type === 'phone' && !/^[+()\d\s.-]{6,25}$/.test(value)) errors[field.key] = 'Enter a valid phone number.';
    else if (field.type === 'url' && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(value)) errors[field.key] = 'Enter a full web address starting with https://.';
    else if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) errors[field.key] = 'Enter a valid date.';
    else if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) errors[field.key] = 'Enter a number.';
      else if (rule.min != null && number < rule.min) errors[field.key] = rule.message || `Enter ${rule.min} or more.`;
      else if (rule.max != null && number > rule.max) errors[field.key] = rule.message || `Enter ${rule.max} or less.`;
    } else if ((field.type === 'select' || field.type === 'radio') && !(field.options ?? []).includes(value)) errors[field.key] = `Choose one of the options for ${field.label}.`;
    if (!errors[field.key]) {
      if (rule.minLength && value.length < rule.minLength) errors[field.key] = rule.message || `Enter at least ${rule.minLength} characters.`;
      else if (rule.maxLength && value.length > rule.maxLength) errors[field.key] = rule.message || `Enter no more than ${rule.maxLength} characters.`;
      else if (rule.pattern && value.length <= 500 && !new RegExp(`^(?:${rule.pattern})$`).test(value)) errors[field.key] = rule.message || `Check the format of ${field.label}.`;
    }
    values[field.key] = field.type === 'email' ? value.toLowerCase() : value;
  }
  return { values, errors, hidden };
}

// ── Submissions ─────────────────────────────────────────────────────────────────────────────────────────────────

type SubmissionDbRow = {
  id: string; created_at: Date; status: FormSubmissionRow['status']; error_detail: string; contact_id: string | null; field_values: Answers;
  page_id: string | null; page_name: string | null; funnel_id: string | null; variant: string | null; utm: FormSubmissionRow['utm']; page_url: string;
  consent_given: boolean; email_status: string | null; email_detail: string;
};

export async function listSubmissions(formId: string, options: { page?: number; limit?: number; status?: string } = {}) {
  const form = await requireForm(formId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 5000);
  const offset = (Math.max(options.page ?? 1, 1) - 1) * limit;
  const [rows, total] = await Promise.all([
    db.query<SubmissionDbRow>(
      `SELECT s.*, p.name AS page_name FROM form_submissions s LEFT JOIN landing_pages p ON p.id = s.page_id
       WHERE s.form_id = $1 AND ($2::text IS NULL OR s.status = $2) ORDER BY s.created_at DESC LIMIT $3 OFFSET $4`,
      [formId, options.status || null, limit, offset],
    ),
    db.query<{ count: string }>('SELECT count(*) FROM form_submissions WHERE form_id = $1 AND ($2::text IS NULL OR status = $2)', [formId, options.status || null]),
  ]);
  const emailKey = form.fields.find(field => field.mapsTo === 'email')?.key ?? 'email';
  const items: FormSubmissionRow[] = rows.rows.map(row => ({
    id: row.id, createdAt: iso(row.created_at)!, status: row.status, errorDetail: row.error_detail, contactId: row.contact_id ? Number(row.contact_id) : null,
    email: String(row.field_values?.[emailKey] ?? ''), values: row.field_values ?? {}, pageId: row.page_id, pageName: row.page_name, funnelId: row.funnel_id,
    variant: row.variant, utm: row.utm ?? {}, pageUrl: row.page_url, consentGiven: row.consent_given, emailStatus: row.email_status, emailDetail: row.email_detail,
  }));
  return { items, total: Number(total.rows[0].count), page: options.page ?? 1, limit, fields: form.fields.map(field => ({ key: field.key, label: field.label })) };
}

const csvCell = (value: unknown) => {
  let text = Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
  // Spreadsheet apps execute cells that start with these characters as formulas.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function submissionsCsv(formId: string) {
  const { items, fields } = await listSubmissions(formId, { limit: 5000 });
  const contacts = await getContacts(items.map(item => item.contactId ?? 0).filter(Boolean)).catch(() => new Map());
  const header = ['Submitted at', 'Status', ...fields.map(field => field.label), 'Contact id', 'Contact name', 'Consent', 'Page', 'Variant', 'UTM source', 'UTM medium', 'UTM campaign', 'Page URL', 'Confirmation email', 'Detail'];
  const lines = items.map(item => [
    item.createdAt, item.status, ...fields.map(field => item.values[field.key]), item.contactId ?? '', item.contactId ? contacts.get(item.contactId)?.name ?? '' : '',
    item.consentGiven ? 'yes' : 'no', item.pageName ?? '', item.variant ?? '', item.utm.source ?? '', item.utm.medium ?? '', item.utm.campaign ?? '', item.pageUrl,
    item.emailStatus ?? '', item.errorDetail || item.emailDetail,
  ].map(csvCell).join(','));
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

export async function searchForms(q: string) {
  const rows = await db.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM forms WHERE status <> 'archived' AND name ILIKE '%' || $1 || '%' ORDER BY updated_at DESC LIMIT 5`, [q],
  );
  return rows.rows;
}
