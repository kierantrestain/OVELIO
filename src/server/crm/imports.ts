// Contact CSV import for CRM › Contacts. Production delegates to the audience import (mapping, dry run, background job;
// src/server/audience.ts). The developer preview has no audience engine, so the same protocol runs in-process
// through directory.upsertContact, which dedupes by email exactly as the engine import does.
import Papa from 'papaparse';
import { z } from 'zod';
import type { ImportMapping, ImportPreview, ImportRun } from '@/contracts';
import { AppError } from '../config';
import { db } from '../db';
import { isDevPreviewMode } from '../dev-preview';
import { findContactByEmail, upsertContact } from '../directory';
import { json, readBody } from '../http';
import { route } from '../routes/shared';
import type { Entry } from '../routes/shared';
import { uuid } from './shared';

const targets: Record<string, string> = {
  email: 'Email', firstName: 'First name', lastName: 'Last name', company: 'Company', phone: 'Phone', position: 'Position',
  city: 'City', country: 'Country', website: 'Website', tags: 'Tags (separated by |)', consent: 'Consent (opted_in)', evidence: 'Consent evidence',
};

type Row = { id: string; file_name: string; status: ImportRun['status']; dry_run: boolean; csv: string; mapping: ImportMapping; evidence: string | null; total: number; processed: number; created: number; updated: number; skipped: number; errors: number; created_at: Date; finished_at: Date | null };

const toRun = (row: Row): ImportRun => ({
  id: row.id, fileName: row.file_name, status: row.status, dryRun: row.dry_run, total: row.total, processed: row.processed, created: row.created,
  updated: row.updated, skipped: row.skipped, errors: row.errors, createdAt: new Date(row.created_at).toISOString(), finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
});

function parse(csv: string) {
  const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy', transformHeader: name => name.trim() });
  const headers = (result.meta.fields ?? []).filter(Boolean);
  if (!headers.length) throw new AppError(400, 'The CSV needs a header row.');
  if (!result.data.length) throw new AppError(400, 'The CSV has no contact rows.');
  if (result.data.length > 5000) throw new AppError(400, 'The preview imports up to 5,000 rows per file.');
  return { headers, rows: result.data };
}

async function record(id: string) {
  const row = (await db.query<Row>('SELECT * FROM contact_imports WHERE id = $1', [id])).rows[0];
  if (!row) throw new AppError(404, 'Import not found.');
  return row;
}

async function previewDraft(csv: string, fileName: string, userId: string, evidence?: string): Promise<{ run: ImportRun; preview: ImportPreview }> {
  const { suggestImportMapping } = await import('../audience');
  const parsed = parse(csv);
  const mapping = suggestImportMapping(parsed.headers, []);
  const row = (await db.query<Row>(
    'INSERT INTO contact_imports (file_name, csv, mapping, evidence, total, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [fileName.slice(0, 200) || 'contacts.csv', csv, JSON.stringify(mapping), evidence?.trim() || null, parsed.rows.length, userId],
  )).rows[0];
  return {
    run: toRun(row),
    preview: {
      headers: parsed.headers, rows: parsed.rows.slice(0, 5).map(item => parsed.headers.map(header => item[header] ?? '')), rowCount: parsed.rows.length, mapping,
      targets: [{ value: 'skip', label: 'Do not import' }, ...Object.entries(targets).map(([value, label]) => ({ value, label }))],
    },
  };
}

async function previewRun(id: string, input: { mapping: ImportMapping; dryRun: boolean; updateExisting: boolean; evidence?: string }) {
  const current = await record(id);
  if (!current.dry_run && current.status === 'done') throw new AppError(409, 'This import has already been run. Upload the file again to repeat it.');
  const parsed = parse(current.csv);
  const used = Object.values(input.mapping).filter(target => target !== 'skip');
  if (!used.includes('email')) throw new AppError(400, 'Choose which column holds the email address.');
  if (new Set(used).size !== used.length) throw new AppError(400, 'Each field can be filled from one column only.');
  await db.query('DELETE FROM contact_import_issues WHERE import_id = $1', [id]);
  const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
  for (const [index, row] of parsed.rows.entries()) {
    const values: Record<string, string> = {};
    for (const [header, target] of Object.entries(input.mapping)) if (target !== 'skip' && row[header]?.trim()) values[target] = row[header].trim();
    const email = (values.email ?? '').toLowerCase();
    const issue = async (outcome: 'skipped' | 'error', message: string) => {
      counts[outcome === 'skipped' ? 'skipped' : 'errors']++;
      await db.query('INSERT INTO contact_import_issues (import_id, row_number, outcome, email, message) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [id, index + 2, outcome, email.slice(0, 254), message]);
    };
    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await issue('error', 'Enter a valid email address.'); continue; }
      const consent = ['opted_in', 'optedin'].includes((values.consent ?? '').toLowerCase()) ? 'opted_in' as const : undefined;
      const evidence = values.evidence || input.evidence || current.evidence || undefined;
      if (consent && !evidence) { await issue('error', 'Record where and when the contact consented.'); continue; }
      const existing = await findContactByEmail(email);
      if (existing && !input.updateExisting) { await issue('skipped', 'This contact already exists, so it was left as it is.'); continue; }
      if (!input.dryRun) {
        await upsertContact({
          email, firstName: values.firstName, lastName: values.lastName, company: values.company, phone: values.phone, position: values.position,
          city: values.city, country: values.country, website: values.website, tags: values.tags?.split('|').map(tag => tag.trim()).filter(Boolean),
          consent, evidence, source: 'CSV import',
        });
      }
      counts[existing ? 'updated' : 'created']++;
    } catch (error) {
      await issue('error', (error as Error).message.slice(0, 200));
    }
  }
  const done = (await db.query<Row>(
    `UPDATE contact_imports SET status = 'done', dry_run = $2, mapping = $3, update_existing = $4, processed = total, created = $5, updated = $6,
       skipped = $7, errors = $8, started_at = now(), finished_at = now(), csv = CASE WHEN $2 THEN csv ELSE '' END WHERE id = $1 RETURNING *`,
    [id, input.dryRun, JSON.stringify(input.mapping), input.updateExisting, counts.created, counts.updated, counts.skipped, counts.errors],
  )).rows[0];
  return toRun(done);
}

const startInput = z.object({
  mapping: z.record(z.string().max(200), z.string().max(80)), dryRun: z.boolean(), updateExisting: z.boolean(), evidence: z.string().trim().max(500).optional(),
});

export const importEndpoints: Entry[] = [
  route('POST', /^crm\/imports$/, async ({ request, user }) => {
    const body = await readBody(request, z.object({ csv: z.string().min(1).max(25_000_000), fileName: z.string().trim().max(200).optional(), evidence: z.string().trim().max(500).optional() }), 26_000_000);
    if (isDevPreviewMode()) return json(await previewDraft(body.csv, body.fileName ?? 'contacts.csv', user.id, body.evidence), 201);
    const { createImportDraft } = await import('../audience');
    return json(await createImportDraft(body.csv, body.fileName ?? 'contacts.csv', user.id, body.evidence), 201);
  }, 'marketer'),
  route('POST', /^crm\/imports\/([0-9a-f-]{36})\/start$/, async ({ request, params }) => {
    const input = await readBody(request, startInput);
    if (isDevPreviewMode()) return json(await previewRun(uuid.parse(params[0]), input), 202);
    const { startImport } = await import('../audience');
    return json(await startImport(uuid.parse(params[0]), input), 202);
  }, 'marketer'),
  route('GET', /^crm\/imports\/([0-9a-f-]{36})$/, async ({ params }) => toRun(await record(uuid.parse(params[0]))), 'marketer'),
  route('GET', /^crm\/imports\/([0-9a-f-]{36})\/issues$/, async ({ params }) => {
    const id = uuid.parse(params[0]);
    if (!isDevPreviewMode()) {
      const { importIssuesCsv } = await import('../audience');
      return new Response(await importIssuesCsv(id), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const rows = await db.query<{ row_number: number; outcome: string; email: string; message: string }>('SELECT row_number, outcome, email, message FROM contact_import_issues WHERE import_id = $1 ORDER BY row_number', [id]);
    return new Response(Papa.unparse({ fields: ['row', 'result', 'email', 'reason'], data: rows.rows.map(row => [row.row_number, row.outcome, row.email, row.message]) }, { escapeFormulae: true }),
      { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
  }, 'marketer'),
];
