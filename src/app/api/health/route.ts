import { logError } from '@/server/config';
import { db } from '@/server/db';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The commit this build came from, so a deployment can be matched to the repository. */
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.OVELIO_COMMIT || '').slice(0, 40) || null;

export async function GET() {
  try {
    await db.query('SELECT 1 FROM users LIMIT 1');
    return json({ status: 'ready', commit });
  } catch (error) {
    logError('health', error);
    return json({ status: 'unavailable', commit }, 503);
  }
}
