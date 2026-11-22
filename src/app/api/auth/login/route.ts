import { z } from 'zod';
import { signIn } from '@/server/auth';
import { AppError, assertOrigin } from '@/server/config';
import { isDevPreviewMode } from '@/server/dev-preview';
import { json, readBody, respondError } from '@/server/http';

export async function POST(request: Request) {
  try {
    if (isDevPreviewMode()) {
      throw new AppError(400, 'This preview deployment is not connected to live marketing engines. Use "Sign in as test developer" below to test OVELIO.');
    }
    assertOrigin(request);
    const { email, password } = await readBody(
      request,
      z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }),
      4096,
    );
    return json(await signIn(email, password));
  } catch (error) {
    return respondError('sign-in', error);
  }
}
