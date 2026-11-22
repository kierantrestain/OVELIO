import { z } from 'zod';
import { signIn } from '@/server/auth';
import { assertOrigin } from '@/server/config';
import { json, readBody, respondError } from '@/server/http';

export async function POST(request: Request) {
  try {
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
