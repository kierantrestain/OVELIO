import { rateLimit, requireUser } from '@/server/auth';
import { assertOrigin } from '@/server/config';
import { assertPreviewOrigin, handleDevPreviewConsole, isDevPreviewMode } from '@/server/dev-preview';
import { json, respondError } from '@/server/http';
import { overviewEndpoints } from '@/server/routes/overview';
import { audienceEndpoints } from '@/server/routes/audience';
import { campaignsEndpoints } from '@/server/routes/campaigns';
import { automationsEndpoints } from '@/server/routes/automations';
import { analyticsEndpoints } from '@/server/routes/analytics';
import { settingsEndpoints } from '@/server/routes/settings';
import type { Entry } from '@/server/routes/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Matched in order; each module owns one console domain (docs/parity/README.md §3).
const endpoints: Entry[] = [
  ...overviewEndpoints,
  ...audienceEndpoints,
  ...campaignsEndpoints,
  ...automationsEndpoints,
  ...analyticsEndpoints,
  ...settingsEndpoints,
];

async function dispatch(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    if (isDevPreviewMode()) {
      await requireUser('analyst');
      if (request.method !== 'GET') assertPreviewOrigin(request);
      return await handleDevPreviewConsole(request, path);
    }
    for (const entry of endpoints) {
      if (entry.method !== request.method) continue;
      const match = entry.path.exec(path.join('/'));
      if (!match) continue;
      const user = await requireUser(entry.role);
      if (request.method !== 'GET') {
        assertOrigin(request);
        await rateLimit('console:write:' + user.id, 180, 60);
      }
      const result = await entry.handler({ request, user, params: match.slice(1), query: new URL(request.url).searchParams });
      return result instanceof Response ? result : json(result);
    }
    return json({ error: 'This action could not be found.' }, 404);
  } catch (error) {
    return respondError('console', error);
  }
}

export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
