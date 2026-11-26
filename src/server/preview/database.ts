// Prepares the embedded PGlite database (src/server/db.ts): the same migrations as production, the preview team as
// users (so owner and author references hold), then each lane's labelled sample records when in preview mode.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Sql } from '../db';
import { devPreviewTeam, isDevPreviewMode } from '../dev-preview';

type Raw = {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
};

/** Preview-only HMAC key so consent and suppression keys can be computed without production secrets. */
const PREVIEW_HMAC_KEY = 'ovelio-preview-only-contact-hmac-key-0000000000';

export function migrationsFolder() {
  return path.join(process.cwd(), 'migrations');
}

export async function applyMigrations(raw: Raw) {
  await raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations
    (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const folder = migrationsFolder();
  const names = (await readdir(folder)).filter(file => /^\d+_\w+\.sql$/.test(file)).sort();
  for (const name of names) {
    const sql = await readFile(path.join(folder, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await raw.query<{ sha256: string }>('SELECT sha256 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rows.length) continue;
    await raw.exec('BEGIN');
    try {
      await raw.exec(sql);
      await raw.query('INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)', [name, checksum]);
      await raw.exec('COMMIT');
    } catch (error) {
      await raw.exec('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${name} failed on the embedded database: ${(error as Error).message}`);
    }
  }
  return names;
}

/**
 * Migrates the preview database and loads the preview team and lane sample data. The embedded database is new on
 * every boot; a hosted preview database (`seedOnce`) is seeded the first time only and keeps what people create.
 */
export async function prepareEmbeddedDatabase(raw: Raw, options: { seedOnce?: boolean } = {}) {
  if (!process.env.CONTACT_HMAC_KEY) process.env.CONTACT_HMAC_KEY = PREVIEW_HMAC_KEY;
  await applyMigrations(raw);
  const sql: Sql = {
    query: async <T extends QueryResultRow>(text: string, values?: unknown[]) => {
      const result = await raw.query<T>(text, values?.map(value => value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) ? JSON.stringify(value) : value));
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length, command: '', oid: 0, fields: [] } as QueryResult<T>;
    },
  };
  if (!isDevPreviewMode()) return;
  if (options.seedOnce) {
    const seeded = await raw.query(`SELECT 1 FROM settings WHERE key = 'preview_seeded'`);
    if (seeded.rows.length) return;
  }
  for (const member of devPreviewTeam()) {
    await sql.query(
      `INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, 'preview-sign-in-disabled')
       ON CONFLICT DO NOTHING`,
      [member.id, member.email.toLowerCase(), member.name, member.role],
    );
  }
  const { laneModules } = await import('../platform/modules');
  for (const lane of laneModules) {
    try {
      await lane.seedPreview(sql);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', scope: 'preview-seed', lane: lane.name, error: (error as Error).message }));
    }
  }
  if (options.seedOnce) {
    await raw.query(`INSERT INTO settings (key, value) VALUES ('preview_seeded', to_jsonb(now())) ON CONFLICT (key) DO NOTHING`);
  }
}
