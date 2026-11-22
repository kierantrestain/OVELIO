import { signOut } from '@/server/auth';
import { buildAuth0LogoutUrl, getAuth0Config } from '@/server/auth0';
import { assertOrigin } from '@/server/config';
import { assertPreviewOrigin, isDevPreviewMode } from '@/server/dev-preview';
import { json, respondError } from '@/server/http';

export async function POST(request: Request) {
  try {
    if (isDevPreviewMode()) assertPreviewOrigin(request);
    else assertOrigin(request);
    const { viaAuth0 } = await signOut();
    const auth0 = viaAuth0 ? getAuth0Config() : null;
    return json({ ok: true, ...(auth0 ? { logoutUrl: buildAuth0LogoutUrl(request, auth0) } : {}) });
  } catch (error) {
    return respondError('sign-out', error);
  }
}
