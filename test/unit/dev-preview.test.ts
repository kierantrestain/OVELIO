import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  devPreviewCompany, handleDevPreviewConsole, isDevPreviewMode, isLocalDevLoginEnabled,
} from '../../src/server/dev-preview';

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  try {
    const out = run();
    if (out && typeof (out as Promise<void>).then === 'function') {
      return (out as Promise<void>).finally(restore);
    }
    restore();
  } catch (err) {
    restore();
    throw err;
  }
}

test('developer preview mode is strictly gated off in production and real engine deployments', () => {
  withEnv({
    OVELIO_ENV: 'production',
    OVELIO_DEV_PREVIEW: 'true',
    OVELIO_DEV_LOGIN: 'true',
    VERCEL: '1',
    MAUTIC_URL: undefined,
    LISTMONK_URL: undefined,
    UMAMI_URL: undefined,
    DATABASE_URL: 'postgresql://local',
  }, () => {
    assert.equal(isDevPreviewMode(), false);
    assert.equal(isLocalDevLoginEnabled(), false);
  });

  withEnv({
    OVELIO_ENV: undefined,
    OVELIO_DEV_PREVIEW: undefined,
    OVELIO_DEV_LOGIN: undefined,
    VERCEL: undefined,
    MAUTIC_URL: 'http://mautic',
    LISTMONK_URL: 'http://listmonk:9000',
    UMAMI_URL: 'http://umami:3000',
    DATABASE_URL: 'postgresql://local',
  }, () => {
    assert.equal(isDevPreviewMode(), false);
    assert.equal(isLocalDevLoginEnabled(), false);
  });

  withEnv({
    OVELIO_ENV: undefined,
    OVELIO_DEV_PREVIEW: undefined,
    VERCEL: '1',
    MAUTIC_URL: undefined,
    LISTMONK_URL: undefined,
    UMAMI_URL: undefined,
    DATABASE_URL: 'postgresql://neon.example/db',
  }, () => {
    assert.equal(isDevPreviewMode(), true);
  });

  withEnv({
    OVELIO_ENV: undefined,
    OVELIO_DEV_PREVIEW: undefined,
    VERCEL: '1',
    MAUTIC_URL: 'https://mautic.example.com',
    LISTMONK_URL: undefined,
    UMAMI_URL: undefined,
  }, () => {
    assert.equal(isDevPreviewMode(), false);
  });

  withEnv({
    OVELIO_ENV: undefined,
    OVELIO_DEV_LOGIN: 'true',
    DATABASE_URL: 'postgresql://local',
  }, () => {
    assert.equal(isLocalDevLoginEnabled(), true);
  });
});

test('developer preview console serves interactive data across all six sections', async () => {
  assert.equal(devPreviewCompany().name, 'OVELIO');

  const get = (path: string) => handleDevPreviewConsole(new Request('https://ovelio.vercel.app/api/console/' + path), path.split('?')[0].split('/'));
  const post = (path: string, body: unknown) => handleDevPreviewConsole(new Request('https://ovelio.vercel.app/api/console/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://ovelio.vercel.app' },
    body: JSON.stringify(body),
  }), path.split('/'));

  const overview = await (await get('overview')).json() as { contacts: number; visitors: number };
  assert.ok(overview.contacts >= 5);
  assert.ok(overview.visitors > 0);

  const createdContact = await post('contacts', { email: 'preview-new@example.test', firstName: 'Preview' });
  assert.equal(createdContact.status, 201);
  const contacts = await (await get('contacts?q=preview-new')).json() as { items: { email: string }[] };
  assert.equal(contacts.items.length, 1);

  const campaigns = await (await get('campaigns')).json() as { items: unknown[] };
  assert.ok(campaigns.items.length >= 3);

  const workflows = await (await get('workflows')).json() as unknown[];
  assert.ok(workflows.length >= 1);

  const websites = await (await get('websites')).json() as { id: string }[];
  assert.equal(websites.length, 1);
  const report = await (await get(`websites/${websites[0].id}/report`)).json() as { current: { pageviews: number } };
  assert.ok(report.current.pageviews > 0);

  const perf = await (await get(`websites/${websites[0].id}/performance?metric=lcp&type=path`)).json() as { metric: string; stats: { count: number } };
  assert.equal(perf.metric, 'lcp');
  assert.ok(perf.stats.count > 0);

  const reports = await (await get('reports')).json() as { id: number }[];
  assert.ok(reports.length >= 3);

  const settings = await (await get('settings')).json() as { team: unknown[] };
  assert.ok(settings.team.length >= 3);
});
