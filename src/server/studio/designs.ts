// Email designs and saved blocks in the shared `designs` table, with optimistic concurrency on `version` and a version
// history in `design_versions` (explicit "save version", plus one automatic version per 10 minutes of edits).
import type { CompileIssue, Design, DesignLink, DesignSaveResult, DesignStatus, DesignSummary, DesignVersion, EmailDesignKind } from '@/contracts/studio';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { audit } from '../events';
import { compileMjml, wrapFragment } from './compile';

type Row = {
  id: string; kind: EmailDesignKind; name: string; subject: string; preheader: string; document: Record<string, unknown>; source: string;
  html: string; template_key: string | null; category: string; status: DesignStatus; version: number; created_at: Date; updated_at: Date;
  updated_by_name: string | null;
};

const columns = `d.id, d.kind, d.name, d.subject, d.preheader, d.document, d.source, d.html, d.template_key, d.category, d.status, d.version,
  d.created_at, d.updated_at, u.name AS updated_by_name`;
const from = `designs d LEFT JOIN users u ON u.id = d.updated_by`;
export const AUTO_VERSION_MS = 10 * 60_000;

const iso = (value: Date | string) => new Date(value).toISOString();

export function toSummary(row: Row): DesignSummary {
  return {
    id: row.id, name: row.name, subject: row.subject, kind: row.kind, status: row.status, updatedAt: iso(row.updated_at),
    preheader: row.preheader, category: row.category, templateKey: row.template_key, version: Number(row.version),
    createdAt: iso(row.created_at), updatedBy: row.updated_by_name,
  };
}

async function links(id: string): Promise<DesignLink[]> {
  const result = await db.query<{ engine: DesignLink['engine']; engine_id: string; label: string; synced_at: Date | null }>(
    'SELECT engine, engine_id, label, synced_at FROM studio_design_links WHERE design_id = $1 ORDER BY created_at', [id]);
  return result.rows.map(row => ({ engine: row.engine, engineId: row.engine_id, label: row.label, syncedAt: row.synced_at ? iso(row.synced_at) : null }));
}

async function row(id: string, client: Sql = db): Promise<Row> {
  const found = (await client.query<Row>(`SELECT ${columns} FROM ${from} WHERE d.id = $1 AND d.kind IN ('email', 'email_block')`, [id])).rows[0];
  if (!found) throw new AppError(404, 'That email design was not found.');
  return found;
}

export async function getDesign(id: string): Promise<Design> {
  const found = await row(id);
  return { ...toSummary(found), document: found.document ?? {}, source: found.source, html: found.html, links: await links(id) };
}

export async function listDesigns(filter: { kind: EmailDesignKind; status?: string; q?: string; limit?: number }): Promise<DesignSummary[]> {
  const values: unknown[] = [filter.kind];
  let where = 'd.kind = $1';
  if (filter.status === 'all') { /* every status */ } else if (filter.status) {
    values.push(filter.status);
    where += ` AND d.status = $${values.length}`;
  } else where += ` AND d.status <> 'archived'`;
  if (filter.q?.trim()) {
    values.push('%' + filter.q.trim().toLowerCase().replace(/[%_\\]/g, '\\$&') + '%');
    where += ` AND (lower(d.name) LIKE $${values.length} OR lower(d.subject) LIKE $${values.length})`;
  }
  values.push(Math.min(Math.max(filter.limit ?? 200, 1), 500));
  const result = await db.query<Row>(`SELECT ${columns} FROM ${from} WHERE ${where} ORDER BY d.updated_at DESC LIMIT $${values.length}`, values);
  return result.rows.map(toSummary);
}

export async function compileDesign(kind: EmailDesignKind, source: string, head: { preheader?: string; title?: string }) {
  return compileMjml(kind === 'email_block' ? wrapFragment(source) : source, head);
}

export async function createDesign(input: {
  kind: EmailDesignKind; name: string; subject?: string; preheader?: string; source: string; document?: Record<string, unknown>;
  templateKey?: string | null; category?: string; userId: string | null;
}, client: Sql = db): Promise<Design & { errors: CompileIssue[] }> {
  const compiled = await compileDesign(input.kind, input.source, { preheader: input.preheader, title: input.subject });
  const created = (await client.query<{ id: string }>(
    `INSERT INTO designs (kind, name, subject, preheader, document, source, html, template_key, category, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
    [input.kind, input.name, input.subject ?? '', input.preheader ?? '', JSON.stringify(input.document ?? {}), input.source, compiled.html,
      input.templateKey ?? null, input.category ?? '', input.userId],
  )).rows[0];
  await client.query(
    `INSERT INTO design_versions (design_id, version, label, document, source, html, created_by) VALUES ($1, 1, 'Created', $2, $3, $4, $5)`,
    [created.id, JSON.stringify(input.document ?? {}), input.source, compiled.html, input.userId]);
  const found = await row(created.id, client);
  return { ...toSummary(found), document: found.document ?? {}, source: found.source, html: found.html, links: [], errors: compiled.errors };
}

export type DesignPatch = {
  version: number; name?: string; subject?: string; preheader?: string; source?: string; document?: Record<string, unknown>; status?: DesignStatus;
};

/** Autosave. Rejects a stale `version` with 409 so two tabs never overwrite each other silently. */
export async function saveDesign(id: string, patch: DesignPatch, userId: string | null): Promise<DesignSaveResult> {
  const current = await row(id);
  if (Number(current.version) !== patch.version) {
    throw new AppError(409, `This email was changed somewhere else (now version ${current.version}, you edited version ${patch.version}). Reload to get the latest copy, then reapply your last change.`);
  }
  const next = {
    name: patch.name ?? current.name, subject: patch.subject ?? current.subject, preheader: patch.preheader ?? current.preheader,
    source: patch.source ?? current.source, document: patch.document ?? current.document, status: patch.status ?? current.status,
  };
  const contentChanged = patch.source !== undefined || patch.document !== undefined || patch.subject !== undefined || patch.preheader !== undefined;
  const compiled = contentChanged
    ? await compileDesign(current.kind, next.source, { preheader: next.preheader, title: next.subject })
    : { html: current.html, errors: [] as CompileIssue[] };
  // Keep the last good HTML when the new source does not compile, so a send never goes out blank.
  const html = compiled.html || current.html;
  return transaction(async client => {
    const updated = (await client.query<{ version: number }>(
      `UPDATE designs SET name = $3, subject = $4, preheader = $5, source = $6, document = $7, html = $8, status = $9,
         version = version + 1, updated_by = $10, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING version`,
      [id, patch.version, next.name, next.subject, next.preheader, next.source, JSON.stringify(next.document), html, next.status, userId],
    )).rows[0];
    if (!updated) throw new AppError(409, 'This email was changed somewhere else while saving. Reload to get the latest copy.');
    let autoVersion: number | null = null;
    if (contentChanged) {
      const last = (await client.query<{ created_at: Date }>('SELECT created_at FROM design_versions WHERE design_id = $1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0];
      if (!last || Date.now() - new Date(last.created_at).getTime() >= AUTO_VERSION_MS) {
        autoVersion = Number(updated.version);
        await client.query(
          `INSERT INTO design_versions (design_id, version, label, document, source, html, created_by, automatic)
           VALUES ($1, $2, 'Automatic', $3, $4, $5, $6, true) ON CONFLICT DO NOTHING`,
          [id, autoVersion, JSON.stringify(next.document), next.source, html, userId]);
      }
    }
    const saved = await row(id, client);
    return { design: toSummary(saved), html, errors: compiled.errors, autoVersion };
  });
}

export async function saveVersion(id: string, label: string, userId: string | null): Promise<DesignVersion> {
  const current = await row(id);
  await db.query(
    `INSERT INTO design_versions (design_id, version, label, document, source, html, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (design_id, version) DO UPDATE SET label = EXCLUDED.label, automatic = false, created_at = now()`,
    [id, current.version, label || 'Saved version', JSON.stringify(current.document ?? {}), current.source, current.html, userId]);
  return (await listVersions(id)).find(item => item.version === Number(current.version))!;
}

export async function listVersions(id: string): Promise<DesignVersion[]> {
  await row(id);
  const result = await db.query<{ version: number; label: string; created_at: Date; name: string | null; automatic: boolean }>(
    `SELECT v.version, v.label, v.created_at, u.name, v.automatic FROM design_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.design_id = $1 ORDER BY v.created_at DESC, v.version DESC LIMIT 100`, [id]);
  return result.rows.map(item => ({ version: Number(item.version), label: item.label, createdAt: iso(item.created_at), createdBy: item.name, automatic: item.automatic }));
}

export async function getVersion(id: string, version: number) {
  const found = (await db.query<{ document: Record<string, unknown>; source: string; html: string }>(
    'SELECT document, source, html FROM design_versions WHERE design_id = $1 AND version = $2', [id, version])).rows[0];
  if (!found) throw new AppError(404, 'That version was not found.');
  return found;
}

/** Restores a version as the newest state (the state before the restore is kept as its own version first). */
export async function restoreVersion(id: string, version: number, expected: number, userId: string | null): Promise<Design> {
  const target = await getVersion(id, version);
  const current = await row(id);
  if (Number(current.version) !== expected) throw new AppError(409, 'This email was changed somewhere else. Reload before restoring a version.');
  await db.query(
    `INSERT INTO design_versions (design_id, version, label, document, source, html, created_by) VALUES ($1, $2, 'Before restore', $3, $4, $5, $6)
     ON CONFLICT (design_id, version) DO NOTHING`,
    [id, current.version, JSON.stringify(current.document ?? {}), current.source, current.html, userId]);
  await saveDesign(id, { version: expected, source: target.source, document: target.document }, userId);
  await audit(userId, 'design.restored', 'design', id, `Restored version ${version}`);
  return getDesign(id);
}

export async function duplicateDesign(id: string, userId: string | null) {
  const source = await row(id);
  return createDesign({
    kind: source.kind, name: `${source.name} (copy)`.slice(0, 120), subject: source.subject, preheader: source.preheader, source: source.source,
    document: source.document, templateKey: source.template_key, category: source.category, userId,
  });
}

export async function setStatus(id: string, status: DesignStatus, userId: string | null) {
  await row(id);
  await db.query('UPDATE designs SET status = $2, updated_by = $3, updated_at = now(), version = version + 1 WHERE id = $1', [id, status, userId]);
  await audit(userId, status === 'archived' ? 'design.archived' : 'design.status', 'design', id, status);
  return toSummary(await row(id));
}

export async function linkDesign(id: string, link: { engine: DesignLink['engine']; engineId: string; label: string }) {
  await row(id);
  await db.query(
    `INSERT INTO studio_design_links (engine, engine_id, design_id, label, synced_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (engine, engine_id) DO UPDATE SET design_id = EXCLUDED.design_id, label = EXCLUDED.label, synced_at = now()`,
    [link.engine, link.engineId, id, link.label]);
  return links(id);
}

export async function findLink(engine: string, engineId: string) {
  const found = (await db.query<{ design_id: string }>('SELECT design_id FROM studio_design_links WHERE engine = $1 AND engine_id = $2', [engine, engineId])).rows[0];
  return found?.design_id ?? null;
}
