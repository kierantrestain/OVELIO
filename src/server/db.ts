import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { isDevPreviewMode } from './dev-preview';

export type Sql = { query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>> };

/** A connection checked out of the pool (production) or the embedded database (preview and unit tests). */
export type DbClient = Sql & { release: () => void };

// DATE columns come back as 'YYYY-MM-DD' strings from both drivers, so a close date never shifts with the server's time zone.
pg.types.setTypeParser(1082, (value: string) => value);

const globalPg = globalThis as typeof globalThis & {
  ovelioPool?: pg.Pool;
  ovelioEmbedded?: Promise<Embedded>;
  ovelioPreviewReady?: Promise<void>;
};

/**
 * OVELIO uses PostgreSQL through `DATABASE_URL` in every real deployment. Without one, the developer preview
 * (`OVELIO_DEV_PREVIEW`, or a Vercel preview with no engines) and DB-backed unit tests (`OVELIO_EMBEDDED_DB=true`)
 * run the same migrations and SQL on PGlite, an in-process PostgreSQL build. Its data lives in memory and resets
 * when the process restarts, which the preview banner states.
 */
export function usesEmbeddedDatabase(): boolean {
  if (process.env.OVELIO_ENV === 'production') return false;
  if (process.env.OVELIO_PREVIEW_DB === 'embedded' && isDevPreviewMode()) return true;
  if (process.env.DATABASE_URL) return false;
  return process.env.OVELIO_EMBEDDED_DB === 'true' || isDevPreviewMode();
}

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  globalPg.ovelioPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 12,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 30000,
    ssl: /[?&]sslmode=(require|verify-full|verify-ca)/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: !/sslmode=require/.test(process.env.DATABASE_URL) } : undefined,
  });
  return globalPg.ovelioPool;
}

/**
 * A hosted preview (for example Vercel with no engines) may set DATABASE_URL to a managed PostgreSQL so that sample
 * data persists and every serverless instance shares it. That database migrates and seeds itself on first use;
 * full deployments migrate with scripts/migrate.ts instead.
 */
function hostedPreview(): boolean {
  return Boolean(process.env.DATABASE_URL) && isDevPreviewMode();
}

const preparing = new AsyncLocalStorage<boolean>();

async function prepareHostedPreview() {
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock(64337000)');
    const raw = {
      query: async <T>(text: string, params?: unknown[]) => {
        const result = await client.query(text, params);
        return { rows: result.rows as T[], affectedRows: result.rowCount ?? 0 };
      },
      exec: async (text: string) => client.query(text),
    };
    const { prepareEmbeddedDatabase } = await import('./preview/database');
    await preparing.run(true, () => prepareEmbeddedDatabase(raw, { seedOnce: true }));
  } finally {
    await client.query('SELECT pg_advisory_unlock(64337000)').catch(() => {});
    client.release();
  }
}

async function readyPool() {
  if (hostedPreview() && !preparing.getStore()) {
    globalPg.ovelioPreviewReady ??= prepareHostedPreview().catch(error => {
      delete globalPg.ovelioPreviewReady;
      throw error;
    });
    await globalPg.ovelioPreviewReady;
  }
  return getPool();
}

// ---------------------------------------------------------------------------------------------------------------
// Embedded PostgreSQL (PGlite). One connection, so a mutex gives each checked-out client exclusive use; queries made
// with `db.query` while that client is held (inside a transaction callback) join it instead of deadlocking.

type PGliteLike = {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number; fields: { name: string; dataTypeID: number }[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};
type Embedded = { pg: PGliteLike; lock: Mutex };

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}

const held = new AsyncLocalStorage<boolean>();
const sharedClients = new WeakSet<object>();

function toResult<T extends QueryResultRow>(raw: { rows: T[]; affectedRows?: number; fields: { name: string; dataTypeID: number }[] }): QueryResult<T> {
  return {
    rows: raw.rows,
    rowCount: raw.affectedRows || raw.rows.length,
    command: '',
    oid: 0,
    fields: raw.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })) as QueryResult<T>['fields'],
  };
}

async function bootEmbedded(): Promise<Embedded> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const instance = new PGlite({
    parsers: {
      [types.INT8]: (value: string) => value,
      [types.DATE]: (value: string) => value,
    },
  }) as unknown as PGliteLike;
  const embedded: Embedded = { pg: instance, lock: new Mutex() };
  const { prepareEmbeddedDatabase } = await import('./preview/database');
  const release = await embedded.lock.acquire();
  try {
    await held.run(true, () => prepareEmbeddedDatabase(instance));
  } finally {
    release();
  }
  return embedded;
}

function embedded(): Promise<Embedded> {
  globalPg.ovelioEmbedded ??= bootEmbedded().catch(error => {
    delete globalPg.ovelioEmbedded;
    throw error;
  });
  return globalPg.ovelioEmbedded;
}

async function embeddedQuery<T extends QueryResultRow>(sql: string, values?: unknown[]) {
  const target = await embedded();
  const run = async () => toResult<T>(await target.pg.query<T>(sql, normaliseParams(values)));
  if (held.getStore()) return run();
  const release = await target.lock.acquire();
  try {
    return await held.run(true, run);
  } finally {
    release();
  }
}

// node-pg serialises Dates, arrays and objects itself; PGlite needs JSON objects stringified for jsonb parameters.
function normaliseParams(values?: unknown[]) {
  return values?.map(value => value !== null && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? JSON.stringify(value) : value);
}

async function embeddedConnect(): Promise<DbClient> {
  const target = await embedded();
  if (held.getStore()) {
    // Nested checkout inside a held client: share it.
    const shared: DbClient = { query: <T extends QueryResultRow>(sql: string, values?: unknown[]) => embeddedQuery<T>(sql, values), release: () => {} };
    sharedClients.add(shared);
    return shared;
  }
  const release = await target.lock.acquire();
  let released = false;
  return {
    query: <T extends QueryResultRow>(sql: string, values?: unknown[]) => held.run(true, async () => toResult<T>(await target.pg.query<T>(sql, normaliseParams(values)))),
    release: () => {
      if (!released) {
        released = true;
        release();
      }
    },
  };
}

export const db: Sql & { connect: () => Promise<PoolClient>; close: () => Promise<void> } = {
  query: async <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => usesEmbeddedDatabase()
    ? embeddedQuery<T>(sql, values)
    : (await readyPool()).query<T>(sql, values),
  connect: async () => usesEmbeddedDatabase() ? embeddedConnect() as Promise<PoolClient> : (await readyPool()).connect(),
  close: async () => {
    await globalPg.ovelioPool?.end();
    delete globalPg.ovelioPool;
    const current = globalPg.ovelioEmbedded;
    delete globalPg.ovelioEmbedded;
    if (current) await (await current).pg.close().catch(() => {});
  },
};

export async function transaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  // Embedded clients implement the query/release subset of PoolClient that OVELIO uses.
  const poolClient = client as PoolClient;
  // A client shared with an outer embedded transaction must not open a second one.
  if (sharedClients.has(client)) return task(poolClient);
  const body = async () => {
    try {
      await client.query('BEGIN');
      const result = await task(poolClient);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  return usesEmbeddedDatabase() ? held.run(true, body) : body();
}
