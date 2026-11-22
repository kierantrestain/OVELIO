import { signOut } from '@/server/auth';
import { assertOrigin } from '@/server/config';
import { json, respondError } from '@/server/http';

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await signOut();
    return json({ ok: true });
  } catch (error) {
    return respondError('sign-out', error);
  }
}
