import { db } from '@/server/db';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.query('SELECT 1 FROM users LIMIT 1');
    return json({ status: 'ready' });
  } catch {
    return json({ status: 'unavailable' }, 503);
  }
}
