import { cookies } from 'next/headers';
import { signIn } from '@/server/auth';
import { AppError, assertOrigin, requiredEnv } from '@/server/config';
import {
  assertPreviewOrigin, DEV_PREVIEW_COOKIE, DEV_PREVIEW_USER, isDevPreviewMode, isLocalDevLoginEnabled, requestOrigin,
} from '@/server/dev-preview';
import { json, respondError } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const lifetime = 12 * 60 * 60;

export async function POST(request: Request) {
  try {
    if (isDevPreviewMode()) {
      assertPreviewOrigin(request);
      const jar = await cookies();
      const secure = requestOrigin(request).startsWith('https:');
      jar.set(DEV_PREVIEW_COOKIE, '1', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: lifetime,
        path: '/',
      });
      return json(DEV_PREVIEW_USER);
    }
    if (isLocalDevLoginEnabled()) {
      assertOrigin(request);
      const user = await signIn(requiredEnv('OVELIO_ADMIN_EMAIL'), requiredEnv('OVELIO_ADMIN_PASSWORD'));
      return json(user);
    }
    throw new AppError(404, 'Developer test sign-in is disabled in this environment.');
  } catch (error) {
    return respondError('dev-sign-in', error);
  }
}
