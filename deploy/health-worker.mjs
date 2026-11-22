import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2500 });
try {
  await client.connect();
  const { rows } = await client.query("SELECT value->>'at' AS at FROM settings WHERE key = 'worker'");
  const recent = Date.now() - Date.parse(rows[0]?.at) < 120000;
  if (!recent) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
