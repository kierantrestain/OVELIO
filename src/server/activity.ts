import type { Activity } from '../contracts';
import { db } from './db';

export async function recordActivity(description: string, href?: string) {
  await db.query('INSERT INTO activity (description, href) VALUES ($1, $2)', [description, href ?? null]);
}

export async function recentActivity(): Promise<Activity[]> {
  const result = await db.query<{ id: string; description: string; created_at: Date; href: string | null }>(
    'SELECT id, description, created_at, href FROM activity ORDER BY id DESC LIMIT 12',
  );
  return result.rows.map(row => ({
    id: row.id, description: row.description, at: row.created_at.toISOString(), href: row.href ?? undefined,
  }));
}
