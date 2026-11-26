import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import type { Campaign, Contact, Goal, Page, Website, WebsiteReport, Workflow } from '../../src/contracts/index';
import { apiClient, testEnv } from './client';

const mode = process.argv[2];
if (mode !== 'persisted' && mode !== 'isolated') throw new Error('Specify persisted or isolated.');
const state = JSON.parse(await readFile('test-results/acceptance.json', 'utf8')) as {
  recipient: string; subject: string; workflowName: string;
};
const analytics = JSON.parse(await readFile('test-results/analytics-receipt.json', 'utf8')) as { website: Website; goalId: string };
const env = testEnv();
const api = await apiClient(env);
const [contacts, campaigns, workflows, websites] = await Promise.all([
  api.get<Page<Contact>>('/contacts?q=' + encodeURIComponent(state.recipient)),
  api.get<Page<Campaign>>('/campaigns'),
  api.get<Workflow[]>('/workflows'),
  api.get<Website[]>('/websites'),
]);
const included = mode === 'persisted';
assert.equal(contacts.items.some(item => item.email === state.recipient), included, 'audience isolation or persistence');
assert.equal(campaigns.items.some(item => item.subject === state.subject), included, 'newsletter isolation or persistence');
assert.equal(workflows.some(item => item.name === state.workflowName), included, 'automation isolation or persistence');
assert.equal(websites.some(item => item.id === analytics.website.id), included, 'website isolation or persistence');

// OVELIO 2.0 records (test/integration/records.test.ts): present after restart and restore, absent elsewhere.
const records = JSON.parse(await readFile('test-results/records.json', 'utf8')) as { dealId: string; designId: string; pageId: string; flowId: string; mediaPath: string };
const checks: [string, string][] = [
  ['deal', '/sales/deals/' + records.dealId], ['email design', '/studio/designs/' + records.designId],
  ['published page', '/sites/pages/' + records.pageId], ['native flow', '/journeys/flows/' + records.flowId],
];
for (const [label, path] of checks) {
  const response = await api.response(path);
  assert.equal(response.ok, included, label + ' isolation or persistence (' + response.status + ')');
  if (included && label !== 'deal' && label !== 'email design') assert.equal((await response.json() as { status: string }).status, 'published', label + ' stays published');
}
const media = await fetch(env.origin + records.mediaPath);
assert.equal(media.ok, included, 'uploaded media isolation or persistence (' + media.status + ')');
if (included) assert.equal(media.headers.get('content-type'), 'image/png', 'media keeps its sniffed type');

if (included) {
  const [goals, report] = await Promise.all([
    api.get<Goal[]>('/websites/' + analytics.website.id + '/goals'),
    api.get<WebsiteReport>('/websites/' + analytics.website.id + '/report'),
  ]);
  assert.ok(goals.some(goal => goal.id === analytics.goalId), 'conversion goal persisted');
  assert.ok((report.current?.pageviews ?? 0) > 0, 'tracked browser visit persisted');
} else {
  assert.ok(process.env.OVELIO_PRIMARY_TEST_PASSWORD, 'first installation test password');
  const invalid = await fetch(env.origin + '/api/auth/login', {
    method: 'POST',
    headers: { origin: env.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: env.email, password: process.env.OVELIO_PRIMARY_TEST_PASSWORD }),
  });
  assert.equal(invalid.status, 401, 'second installation rejects the first administrator password');
}
console.info('Verified ' + mode + ' application data.');
