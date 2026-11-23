import { AppError } from '@/server/config';
import { authenticateApiKey, ingestEvents, serverEventsBody } from '@/server/analytics-events';
import { json, readBody, respondError } from '@/server/http';

export const dynamic = 'force-dynamic';

/** ANA-10: server-to-server events (purchases, sign-ups). Authenticated with an API key an admin created in Analytics settings. */
export async function POST(request: Request) {
  try {
    const key = await authenticateApiKey(request.headers.get('authorization'));
    const events = await readBody(request, serverEventsBody, 512 * 1024);
    const results = await ingestEvents(key, events);
    const failed = results.filter(result => result.status === 'failed').length;
    return json({ accepted: results.filter(r => r.status === 'accepted').length, duplicates: results.filter(r => r.status === 'duplicate').length, failed, results }, failed ? 207 : 200);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return json({ error: error.message }, 401);
    return respondError('events-api', error);
  }
}
