import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { apiClient, testEnv } from './client';

test('JRN-12 the Compose gateway forwards inbound webhook credentials and acknowledges one delivery', async t => {
  const env = testEnv();
  const admin = await apiClient(env);
  const hook = await admin.get<{ id: string; secret: string; url: string }>('/journeys/hooks', 'POST', {
    name: 'Gateway check ' + randomUUID(), emailPath: 'buyer.email',
  });
  t.after(() => admin.response('/journeys/hooks/' + hook.id, 'DELETE').then(() => undefined));
  const url = new URL(new URL(hook.url).pathname, env.origin);
  const data = JSON.stringify({ result: 'synthetic gateway check' });
  const submit = (headers: Record<string, string>) => fetch(url, { method: 'POST', body: data, headers });
  assert.equal((await submit({})).status, 401);
  const signed = { authorization: 'Bearer ' + hook.secret, 'content-type': 'application/json' };
  const accepted = await submit(signed);
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).contactId, null);
  const retried = await submit(signed);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { received: true, duplicate: true });
});
