import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from './config';

const derive = promisify(scrypt);

export async function hashPassword(password: string) {
  if (password.length < 14 || password.length > 128) {
    throw new AppError(400, 'Use a password between 14 and 128 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return salt + ':' + key.toString('hex');
}

export async function verifyPassword(password: string, stored?: string) {
  const [salt, expected] = (stored ?? '00'.repeat(16) + ':' + '00'.repeat(64)).split(':');
  const supplied = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(supplied, Buffer.from(expected, 'hex')) && Boolean(stored);
}
