import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export function testEnv() {
  const file = process.env.OVELIO_TEST_ENV_FILE ?? '.env';
  if (existsSync(file)) process.loadEnvFile(file);
  const origin = process.env.OVELIO_TEST_ORIGIN ?? process.env.APP_ORIGIN;
  const email = process.env.OVELIO_ADMIN_EMAIL;
  const password = process.env.OVELIO_ADMIN_PASSWORD;
  if (!origin || !email || !password) throw new Error('Generate a test environment and start the Compose stack first.');
  return { origin, email, password, mailpit: 'http://localhost:' + (process.env.MAILPIT_PORT ?? '8025') };
}

export async function apiClient(environment = testEnv()) {
  const { origin, email, password } = environment;
  const login = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, 'OVELIO sign-in');
  const session = login.headers.getSetCookie().find(cookie => cookie.startsWith('ovelio_session='))?.split(';', 1)[0];
  assert.ok(session, 'authenticated session cookie');
  return {
    async response(path: string, method = 'GET', data?: unknown, requestOrigin = origin) {
      return fetch(origin + '/api/console' + path, {
        method,
        headers: { origin: requestOrigin, cookie: session, ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    },
    async get<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
      const result = await this.response(path, method, data);
      assert.ok(result.ok, method + ' ' + path + ' (' + result.status + ') ' + (result.ok ? '' : await result.text()));
      return result.json() as Promise<T>;
    },
  };
}

export async function eventually<T>(
  label: string, action: () => Promise<T>, ready: (value: T) => boolean, timeout = 60000,
) {
  const end = Date.now() + timeout;
  let lastError: unknown;
  do {
    try {
      const result = await action();
      if (ready(result)) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  } while (Date.now() < end);
  assert.fail(label + ' was not observed within ' + timeout + 'ms'
    + (lastError instanceof Error ? ' (' + lastError.message + ')' : ''));
}
