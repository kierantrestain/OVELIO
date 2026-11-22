import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type {
  Campaign, Contact, ContactDetail, Dashboard, JourneyEmail, MailingList, Page, Segment, Settings, Template, Workflow,
} from '../../src/contracts/index';
import { apiClient, eventually, testEnv } from './client';

const run = promisify(execFile);
const unique = Date.now().toString(36);

type Message = { ID: string; Subject: string; To: { Address: string }[] };

test('real audience, newsletter, suppression and welcome workflows', { timeout: 330000 }, async context => {
  const env = testEnv();
  const api = await apiClient(env);
  const recipient = 'reader-' + unique + '@example.test';
  const unsubscribe = 'withdraw-' + unique + '@example.test';
  const journeyAddress = 'welcome-' + unique + '@example.test';
  const subject = 'Newsletter ' + unique;

  const anonymous = await fetch(env.origin + '/api/console/contacts');
  assert.equal(anonymous.status, 401, 'audience APIs require a session');
  const engine = await fetch(env.origin + '/api/contacts');
  assert.equal(engine.status, 404, 'engine management API is private');
  const crossOrigin = await api.response('/segments', 'POST', { name: 'Rejected origin' }, 'https://invalid.example');
  assert.equal(crossOrigin.status, 403, 'authenticated writes require the configured origin');
  const analyst = {
    email: 'analyst-' + unique + '@example.test', password: 'A test-only account password ' + unique,
    role: 'analyst', name: 'Acceptance analyst',
  };
  await api.get('/settings/team', 'POST', analyst);
  const reports = await apiClient({ ...env, email: analyst.email, password: analyst.password });
  assert.equal((await reports.response('/overview')).status, 200, 'analyst can read reports');
  assert.equal((await reports.response('/segments', 'POST', { name: 'Rejected role' })).status, 403, 'analyst cannot edit audiences');

  await eventually('all four integration connections and SMTP setup', () => api.get<Settings>('/settings'),
    settings => Object.values(settings.health).every(health => health.status === 'ready') && settings.sender.configured);

  const result = await api.get<{ imported: number; failed: unknown[] }>('/contacts/import', 'POST', {
    csv: 'email,first_name,last_name,consent\n' + recipient + ',Ada,Lovelace,opted_in\n'
      + unsubscribe + ',Grace,Hopper,opted_in\n',
    evidence: 'Automated test fixture, verified consent at import',
  });
  assert.equal(result.imported, 2);
  assert.deepEqual(result.failed, []);

  const lookup = async (email: string) => {
    const page = await api.get<{ items: Contact[] }>('/contacts?q=' + encodeURIComponent(email));
    const match = page.items.find(contact => contact.email === email);
    assert.ok(match, 'contact retrieved from the audience engine');
    return match;
  };
  const contacts = await Promise.all([lookup(recipient), lookup(unsubscribe)]);

  const segment = await api.get<Segment>('/segments', 'POST', { name: 'Newsletter readers ' + unique });
  for (const contact of contacts) {
    const updated = await api.get<ContactDetail>('/contacts/' + contact.id + '/segments', 'POST', {
      segmentId: segment.id, member: true,
    });
    assert.ok(updated.segments.some(item => item.id === segment.id), 'native segment membership persisted');
  }
  await api.get('/segments/' + segment.id + '/sync', 'POST');

  const list = await eventually('segment subscribers in the delivery engine', async () => {
    const lists = await api.get<MailingList[]>('/lists');
    return lists.find(item => item.name === segment.name);
  }, item => item?.subscriberCount === 2);
  assert.ok(list);

  const template = await api.get<Template>('/templates', 'POST', {
    name: 'Editorial template ' + unique, body: '<header>Editorial header</header><main>{{ template "content" . }}</main>',
  });
  const campaignBody = {
    name: subject, subject, body: '<h1>News from OVELIO</h1><p>Welcome to the edition.</p>', listIds: [list.id], templateId: template.id,
  };
  const campaign = await api.get<Campaign>('/campaigns', 'POST', campaignBody);
  assert.equal(campaign.status, 'draft');
  const preview = await api.response('/campaigns/' + campaign.id + '/preview');
  assert.ok(preview.ok);
  const rendered = await preview.text();
  assert.match(rendered, /Editorial header/);
  assert.match(rendered, /<main>\s*<h1>News from OVELIO<\/h1>/);

  async function messages() {
    const response = await fetch(env.mailpit + '/api/v1/messages');
    assert.equal(response.status, 200, 'Mailpit API');
    return (await response.json() as { messages: Message[] }).messages ?? [];
  }
  function delivered(messages: Message[], messageSubject: string, address: string) {
    return messages.find(message => message.Subject.includes(messageSubject)
      && message.To.some(target => target.Address === address));
  }
  await api.get('/campaigns/' + campaign.id + '/test', 'POST', { email: recipient });
  await eventually('test newsletter in the development inbox', messages,
    items => Boolean(delivered(items, subject, recipient)));

  await api.get('/campaigns/' + campaign.id + '/start', 'POST');
  const bulk = await eventually('first bulk newsletter in Mailpit', messages,
    items => Boolean(delivered(items, subject, unsubscribe)));
  const mail = delivered(bulk, subject, unsubscribe);
  assert.ok(mail);
  const message = await fetch(env.mailpit + '/api/v1/message/' + mail.ID);
  const { HTML } = await message.json() as { HTML: string };
  const found = HTML.match(/\/subscription\/[a-f0-9-]{36}\/[a-f0-9-]{36}/i);
  assert.ok(found, 'newsletter contains a native unsubscribe link');
  const revoke = await fetch(env.origin + found[0], {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.ok(revoke.ok, 'one-click unsubscribe completed');
  const denied = await api.response('/campaigns/' + campaign.id + '/test', 'POST', { email: unsubscribe });
  assert.ok([400, 409, 422].includes(denied.status), 'unsubscribed recipient is excluded before test send');

  const followup = 'Follow-up ' + unique;
  const next = await api.get<Campaign>('/campaigns', 'POST', { ...campaignBody, name: followup, subject: followup });
  await api.get('/campaigns/' + next.id + '/start', 'POST');
  await eventually('eligible recipient receives the second bulk send', messages,
    items => Boolean(delivered(items, followup, recipient)));
  await eventually('second bulk send finishes', () => api.get<Campaign>('/campaigns/' + next.id),
    value => ['finished', 'completed'].includes(value.status));
  assert.equal(delivered(await messages(), followup, unsubscribe), undefined);

  const journey = await api.get<Segment>('/segments', 'POST', { name: 'New customers ' + unique });
  const welcomeSubject = 'Welcome aboard ' + unique;
  const welcome = await api.get<JourneyEmail>('/journey-emails', 'POST', {
    name: welcomeSubject, subject: welcomeSubject, body: '<h1>Glad you are here</h1>',
  });
  assert.equal(welcome.published, true);
  const workflow = await api.get<Workflow>('/workflows', 'POST', {
    name: 'Welcome sequence ' + unique, segmentId: journey.id, steps: [{ emailId: welcome.id, delayMinutes: 0 }],
  });
  assert.equal(workflow.enabled, false);
  const active = await api.get<Workflow>('/workflows/' + workflow.id + '/status', 'POST', { enabled: true });
  assert.equal(active.enabled, true);

  const added = await api.get<Contact>('/contacts', 'POST', {
    email: journeyAddress, firstName: 'New customer', consent: 'opted_in', evidence: 'Automated acceptance fixture',
  });
  await api.get('/contacts/' + added.id + '/segments', 'POST', { segmentId: journey.id, member: true });
  await api.get('/contacts/' + contacts[1].id + '/segments', 'POST', { segmentId: journey.id, member: true });

  const docker = process.env.OVELIO_TEST_DOCKER ?? 'docker';
  for (const command of ['mautic:segments:update', 'mautic:campaigns:update', 'mautic:campaigns:trigger']) {
    await run(docker, ['compose', 'exec', '-T', '-u', 'www-data', 'mautic', 'php', '/var/www/html/bin/console', command, '--no-interaction'],
      { timeout: 60000 });
  }
  await eventually('native welcome workflow email', messages, items => Boolean(delivered(items, welcomeSubject, journeyAddress)));
  assert.equal(delivered(await messages(), welcomeSubject, unsubscribe), undefined, 'newsletter withdrawal blocks journey sends');

  const campaigns = await api.get<Page<Campaign>>('/campaigns');
  assert.ok(campaigns.items.some(item => item.id === next.id && (item.metrics.sent ?? 0) > 0));
  const summary = await api.get<Dashboard>('/overview');
  assert.ok((summary.contacts ?? 0) >= 3);
  assert.ok((summary.email.sent ?? 0) >= 1);
  assert.ok((summary.activeWorkflows ?? 0) >= 1);

  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/acceptance.json', JSON.stringify({ recipient, subject, workflowName: active.name }), { mode: 0o600 });
  context.diagnostic('Confirmed native contacts, list membership, test and bulk mail, cross-engine unsubscribe and workflow delivery.');
});
