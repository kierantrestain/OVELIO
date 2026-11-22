import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db, transaction } from '../src/server/db';
import { requiredEnv } from '../src/server/config';
import { hashPassword } from '../src/server/password';

const TRANSIENT_CODES = new Set(['57P03', '57P01', '08001', '08006', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);

async function connectWithRetry(attempts = 15, delayMs = 1000) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.connect();
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (attempt >= attempts || !TRANSIENT_CODES.has(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

const folder = new URL('../migrations/', import.meta.url);
const lock = await connectWithRetry();
try {
  await lock.query('SELECT pg_advisory_lock(64337000)');
  await lock.query(`CREATE TABLE IF NOT EXISTS schema_migrations
    (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const name of (await readdir(folder)).filter(file => /^\d+_\w+\.sql$/.test(file)).sort()) {
    const sql = await readFile(new URL(name, folder), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await lock.query<{ sha256: string }>('SELECT sha256 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rows.length) {
      if (existing.rows[0].sha256 !== checksum) throw new Error('An applied migration was modified: ' + name);
      continue;
    }
    await transaction(async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)', [name, checksum]);
    });
    console.info('Applied migration ' + name);
  }
  const users = await lock.query('SELECT 1 FROM users LIMIT 1');
  if (!users.rows.length) {
    const email = requiredEnv('OVELIO_ADMIN_EMAIL').trim().toLowerCase();
    const hash = await hashPassword(requiredEnv('OVELIO_ADMIN_PASSWORD'));
    await lock.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, 'admin', $3)`,
      [email, process.env.OVELIO_ADMIN_NAME || 'Administrator', hash]);
    console.info('Created initial administrator.');
  }
} finally {
  await lock.query('SELECT pg_advisory_unlock(64337000)').catch(() => {});
  lock.release();
  await db.close();
}
