import { rateLimit, requireUser } from '@/server/auth';
import { assertOrigin } from '@/server/config';
import { assertPreviewOrigin, handleDevPreviewConsole, isDevPreviewMode } from '@/server/dev-preview';
import { json, respondError } from '@/server/http';
import { drainAfterResponse } from '@/server/platform/after';
import { laneModules } from '@/server/platform/modules';
import { overviewEndpoints } from '@/server/routes/overview';
import { audienceEndpoints } from '@/server/routes/audience';
import { campaignsEndpoints } from '@/server/routes/campaigns';
import { automationsEndpoints } from '@/server/routes/automations';
import { analyticsEndpoints } from '@/server/routes/analytics';
import { platformEndpoints } from '@/server/routes/platform';
import { settingsEndpoints } from '@/server/routes/settings';
import type { Entry } from '@/server/routes/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// OVELIO-owned modules (platform and the five lanes) run on PostgreSQL, or on the embedded database in the preview.
const nativeEndpoints: Entry[] = [...platformEndpoints, ...laneModules.flatMap(lane => lane.endpoints)];

// Engine-backed endpoints, matched in order; each module owns one console domain (docs/parity/README.md §3).
const engineEndpoints: Entry[] = [
  ...overviewEndpoints,
  ...audienceEndpoints,
  ...campaignsEndpoints,
  ...automationsEndpoints,
  ...analyticsEndpoints,
  ...settingsEndpoints,
];

function find(entries: Entry[], method: string, path: string) {
  for (const entry of entries) {
    if (entry.method !== method) continue;
    const match = entry.path.exec(path);
    if (match) return { entry, match };
  }
  return null;
}

async function dispatch(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    const joined = path.join('/');
    const preview = isDevPreviewMode();
    const found = find(nativeEndpoints, request.method, joined) ?? (preview ? null : find(engineEndpoints, request.method, joined));
    if (preview) {
      // The preview has no worker process, so due module jobs (event delivery, automation steps) run after each request.
      drainAfterResponse();
      if (request.method !== 'GET') assertPreviewOrigin(request);
      if (!found) {
        await requireUser('analyst');
        return await handleDevPreviewConsole(request, path);
      }
    }
    if (!found) return json({ error: 'This action could not be found.' }, 404);
    const user = await requireUser(found.entry.role);
    if (request.method !== 'GET' && !preview) {
      assertOrigin(request);
      await rateLimit('console:write:' + user.id, 180, 60);
    }
    const result = await found.entry.handler({ request, user, params: found.match.slice(1), query: new URL(request.url).searchParams });
    return result instanceof Response ? result : json(result);
  } catch (error) {
    return respondError('console', error);
  }
}

export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
