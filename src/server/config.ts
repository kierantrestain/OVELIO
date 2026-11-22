import { createHmac, timingSafeEqual } from 'node:crypto';

export class AppError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function appOrigin() {
  const origin = new URL(requiredEnv('APP_ORIGIN'));
  if (process.env.OVELIO_ENV === 'production' && origin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }
  return origin.origin;
}

export function emailKey(email: string) {
  const key = requiredEnv('CONTACT_HMAC_KEY');
  if (key.length < 32) throw new Error('CONTACT_HMAC_KEY must contain at least 32 characters.');
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
}

export function secretsEqual(expected: string, supplied: string) {
  const one = Buffer.from(expected);
  const two = Buffer.from(supplied);
  return one.length === two.length && timingSafeEqual(one, two);
}

export function assertOrigin(request: Request) {
  if (request.headers.get('origin') !== appOrigin()) {
    throw new AppError(403, 'Open this page from the configured OVELIO address and try again.');
  }
}

export function logError(scope: string, error: unknown) {
  const e = error as { name?: string; status?: number; code?: string };
  console.error(JSON.stringify({ level: 'error', scope, error: e?.name ?? 'Unknown', status: e?.status, code: e?.code }));
}
