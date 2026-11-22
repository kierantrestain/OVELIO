import { z } from 'zod';
import { rateLimit } from '@/server/auth';
import { receiveSuppression } from '@/server/audience';
import { AppError, requiredEnv, secretsEqual } from '@/server/config';
import { json, readBody, respondError } from '@/server/http';

export async function POST(request: Request) {
  try {
    const secret = requiredEnv('SUPPRESSION_WEBHOOK_SECRET');
    if (secret.length < 32 || !secretsEqual('Bearer ' + secret, request.headers.get('authorization') ?? '')) {
      throw new AppError(401, 'This delivery receipt could not be authenticated.');
    }
    await rateLimit('verified-delivery-receipts', 1200, 60);
    const { email, reason } = await readBody(request, z.object({
      email: z.email().max(254), reason: z.enum(['unsubscribe', 'bounce', 'complaint']),
    }), 4096);
    await receiveSuppression(email, reason, 'Verified delivery receipt');
    return json({ accepted: true }, 202);
  } catch (error) {
    return respondError('delivery-receipt', error);
  }
}
