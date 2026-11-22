const base = process.env.UMAMI_URL;
const password = process.env.UMAMI_PASSWORD;
if (!base || !password || password.length < 14 || password === 'umami') {
  throw new Error('Generate a unique analytics engine password.');
}

async function post(path, body, authorization) {
  return fetch(new URL(path, base), {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}

const username = 'admin';
const configured = await post('/api/auth/login', { username, password });
if (configured.ok) process.exit(0);
const bootstrap = await post('/api/auth/login', { username, password: 'umami' });
if (!bootstrap.ok) throw new Error('Analytics engine login failed. Use the password provisioned for this database.');
const { token } = await bootstrap.json();
if (!token) throw new Error('Analytics engine returned no bootstrap token.');
const reset = await post('/api/me/password', { currentPassword: 'umami', newPassword: password }, 'Bearer ' + token);
if (!reset.ok || !(await post('/api/auth/login', { username, password })).ok) {
  throw new Error('Unable to update and verify the analytics engine password.');
}
console.info('Configured analytics engine authentication.');
