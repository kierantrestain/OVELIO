import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

export type Sql = { query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>> };

const globalPg = globalThis as typeof globalThis & { ovelioPool?: pg.Pool };

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  globalPg.ovelioPool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 30000,
  });
  return globalPg.ovelioPool;
}

export const db: Sql & { connect: () => Promise<PoolClient>; close: () => Promise<void> } = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values?: unknown[]) => getPool().query<T>(sql, values),
  connect: () => getPool().connect(),
  close: async () => {
    await globalPg.ovelioPool?.end();
    delete globalPg.ovelioPool;
  },
};

export async function transaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
