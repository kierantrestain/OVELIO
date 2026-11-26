import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type {
  Campaign, Contact, ContactDetail, Dashboard, ImportPreview, ImportRun, JourneyEmail, MailingList, Page, Segment, Settings,
  Template, Workflow,
} from '../../src/contracts/index';
import { apiClient, eventually, testEnv } from './client';

const run = promisify(execFile);
const unique = Date.now().toString(36);
let primarySession: ReturnType<typeof apiClient> | undefined;

type Message = { ID: string; Subject: string; To: { Address: string }[] };

test('real audience, newsletter, suppression and welcome workflows', { timeout: 330000 }, async context => {
  const env = testEnv();
  const api = await (primarySession ??= apiClient(env));
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

  // AUD-10: upload a draft, start it with the suggested mapping, then follow the background job to the end.
  const evidence = 'Automated test fixture, verified consent at import';
  const draft = await api.get<{ run: ImportRun; preview: ImportPreview }>('/contacts/imports', 'POST', {
    csv: 'email,first_name,last_name,consent\n' + recipient + ',Ada,Lovelace,opted_in\n'
      + unsubscribe + ',Grace,Hopper,opted_in\n',
    fileName: 'acceptance.csv', evidence,
  });
  assert.equal(draft.preview.rowCount, 2);
  assert.equal(draft.preview.mapping.email, 'email', 'the email column is mapped automatically');
  await api.get<ImportRun>('/contacts/imports/' + draft.run.id + '/start', 'POST', {
    mapping: draft.preview.mapping, dryRun: false, updateExisting: true, evidence,
  });
  const result = await eventually('background contact import', () => api.get<ImportRun>('/contacts/imports/' + draft.run.id),
    run => run.status === 'done' || run.status === 'failed', 120000);
  assert.equal(result.status, 'done');
  assert.equal(result.created + result.updated, 2);
  assert.equal(result.skipped + result.errors, 0);

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

test('extended audience, delivery, automation and analytics capabilities across all three engines', { timeout: 240000 }, async context => {
  const env = testEnv();
  const api = await (primarySession ??= apiClient(env));
  const tag = Date.now().toString(36);
  const contactEmail = 'extended-' + tag + '@example.test';

  // Mautic extended: contact fields, points, notes, tags, stages, companies, dynamic segment, scoring, forms, assets, pages, webhooks, multi-action workflow
  const created = await api.get<Contact>('/contacts', 'POST', {
    email: contactEmail,
    firstName: 'Extended',
    lastName: 'Contact',
    company: 'OVELIO Labs',
    phone: '+44 20 7946 0958',
    position: 'Marketing Lead',
    city: 'London',
    country: 'United Kingdom',
    website: 'https://example.test',
    tags: ['vip-' + tag],
    consent: 'opted_in',
    evidence: 'Automated extended acceptance fixture',
  });
  assert.ok(created.id > 0);

  const scored = await api.get<ContactDetail>('/contacts/' + created.id + '/points', 'POST', { delta: 15 });
  assert.ok(scored.points >= 15);
  assert.ok((scored.consentHistory?.length ?? 0) >= 1);

  const note = await api.get<{ id: number }>('/contacts/' + created.id + '/notes', 'POST', {
    text: 'Follow up after product demo', type: 'call',
  });
  assert.ok((await api.get<Array<{ id: number }>>('/contacts/' + created.id + '/notes')).some(item => item.id === note.id));
  assert.equal((await api.response('/notes/' + note.id, 'DELETE')).status, 204);

  const createdTag = await api.get<{ id: number }>('/tags', 'POST', { tag: 'extra-' + tag });
  assert.ok((await api.get<Array<{ id: number }>>('/tags')).some(item => item.id === createdTag.id));
  assert.ok((await api.get<Page<Contact>>('/contacts?tag=' + encodeURIComponent('vip-' + tag))).items.some(item => item.id === created.id));
  assert.equal((await api.response('/tags/' + createdTag.id, 'DELETE')).status, 204);

  const stage = await api.get<{ id: number }>('/stages', 'POST', { name: 'MQL ' + tag, description: 'Qualified', weight: 20, published: true });
  await api.get('/stages/' + stage.id, 'PATCH', { name: 'MQL Updated ' + tag });
  const staged = await api.get<ContactDetail>('/contacts/' + created.id + '/stage', 'POST', { stageId: stage.id });
  assert.equal(staged.stageId, stage.id);
  await api.get('/contacts/' + created.id + '/stage', 'POST', { stageId: null });
  assert.equal((await api.response('/stages/' + stage.id, 'DELETE')).status, 204);

  const company = await api.get<{ id: number }>('/companies', 'POST', {
    name: 'Acme ' + tag, email: 'hello-' + tag + '@acme.test', website: 'https://acme.test', industry: 'Technology', city: 'London',
  });
  await api.get('/companies/' + company.id, 'PATCH', { city: 'Bristol' });
  await api.get('/companies/' + company.id + '/contacts', 'POST', { contactId: created.id });
  assert.equal((await api.response('/companies/' + company.id, 'DELETE')).status, 204);

  const filteredSeg = await api.get<Segment>('/segments', 'POST', {
    name: 'Filtered ' + tag,
    published: true,
    filters: [{ glue: 'and', field: 'email', object: 'lead', type: 'email', operator: 'like', filter: '@example.test' }],
  });
  await api.get('/segments/' + filteredSeg.id, 'PATCH', { name: 'Filtered v2 ' + tag });
  await api.get('/contacts/bulk', 'POST', { ids: [created.id], action: 'add_segment', segmentId: filteredSeg.id });

  const actionTypes = await api.get<Record<string, string>>('/point-actions/types');
  assert.ok(Object.keys(actionTypes).length > 0);
  const pointAction = await api.get<{ id: number }>('/point-actions', 'POST', {
    name: 'Score rule ' + tag, type: Object.keys(actionTypes)[0], delta: 10, published: true,
  });
  const pointTrigger = await api.get<{ id: number }>('/point-triggers', 'POST', {
    name: 'Hot lead ' + tag, points: 50, published: true, triggerExistingLeads: false,
  });
  assert.equal((await api.response('/point-actions/' + pointAction.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/point-triggers/' + pointTrigger.id, 'DELETE')).status, 204);

  const form = await api.get<{ id: number; fields?: unknown[] }>('/forms', 'POST', {
    name: 'Custom Form ' + tag,
    fields: [
      { label: 'Email', alias: 'email', type: 'email', mappedField: 'email', isRequired: true },
      { label: 'Company', alias: 'company', type: 'text', mappedField: 'company' },
    ],
  });
  assert.ok((form.fields?.length ?? 0) >= 2);
  await api.get('/forms/' + form.id, 'PATCH', { name: 'Custom Form v2 ' + tag });
  assert.ok(Array.isArray((await api.get<{ items: unknown[] }>('/forms/' + form.id + '/submissions?page=1')).items));
  assert.equal((await api.response('/forms/' + form.id, 'DELETE')).status, 204);

  const jEmail = await api.get<JourneyEmail>('/journey-emails', 'POST', {
    name: 'Journey ' + tag, subject: 'Journey ' + tag, body: '<p>Welcome</p>',
  });
  await api.get('/journey-emails/' + jEmail.id, 'PATCH', {
    name: 'Journey v2 ' + tag, subject: 'Journey v2 ' + tag, body: '<p>Updated</p>',
  });
  const multiWf = await api.get<Workflow>('/workflows', 'POST', {
    name: 'Multi-step ' + tag,
    segmentId: filteredSeg.id,
    steps: [
      { kind: 'email', emailId: jEmail.id, delayMinutes: 0 },
      { kind: 'tags', emailId: 0, delayMinutes: 0, addTags: ['onboarded-' + tag] },
      { kind: 'points', emailId: 0, delayMinutes: 0, pointsDelta: 5 },
    ],
  });
  assert.equal(multiWf.steps.length, 3);
  assert.ok(Array.isArray(await api.get<unknown[]>('/workflows/' + multiWf.id + '/contacts')));
  assert.equal((await api.response('/workflows/' + multiWf.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/journey-emails/' + jEmail.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/segments/' + filteredSeg.id, 'DELETE')).status, 204);

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const formBody = new FormData();
  formBody.append('file', new Blob([png1x1], { type: 'image/png' }), 'pixel-' + tag + '.png');
  const uploadRes = await api.response('/media', 'POST', formBody);
  assert.equal(uploadRes.status, 201);
  const uploaded = await uploadRes.json() as { id: number; url: string };

  const asset = await api.get<{ id: number }>('/assets', 'POST', {
    title: 'Guide ' + tag, remotePath: 'http://mautic/robots.txt', published: true,
  });
  await api.get('/assets/' + asset.id, 'PATCH', { title: 'Guide v2 ' + tag });
  assert.equal((await api.response('/assets/' + asset.id, 'DELETE')).status, 204);

  const landing = await api.get<{ id: number }>('/pages', 'POST', {
    title: 'Promo ' + tag, metaDescription: 'Promo', customHtml: '<h1>Promo</h1>', published: true,
  });
  await api.get('/pages/' + landing.id, 'PATCH', { title: 'Promo v2 ' + tag });
  assert.equal((await api.response('/pages/' + landing.id, 'DELETE')).status, 204);

  const hook = await api.get<{ id: number }>('/webhooks', 'POST', {
    name: 'Hook ' + tag, webhookUrl: 'https://example.test/hook', triggers: ['mautic.lead_post_save_new'], published: false,
  });
  assert.equal((await api.response('/webhooks/' + hook.id, 'DELETE')).status, 204);

  // Phase 2 Mautic: custom fields, categories, dynamic content, focus items, reports, contact companies/devices
  const customField = await api.get<{ id: number }>('/fields/contact', 'POST', {
    label: 'Tier ' + tag, alias: 'tier_' + tag.slice(-6), type: 'select', group: 'core', options: ['Free', 'Pro'], published: true,
  });
  await api.get('/fields/contact/' + customField.id, 'PATCH', { label: 'Tier v2 ' + tag });
  assert.ok((await api.get<Array<{ id: number }>>('/fields/contact')).some(item => item.id === customField.id));
  assert.equal((await api.response('/fields/contact/' + customField.id, 'DELETE')).status, 204);

  const cat = await api.get<{ id: number }>('/categories', 'POST', {
    title: 'Launch ' + tag, bundle: 'global', color: '#2457d6', published: true,
  });
  await api.get('/categories/' + cat.id, 'PATCH', { title: 'Launch v2 ' + tag });
  assert.ok((await api.get<Array<{ id: number }>>('/categories?bundle=global')).some(item => item.id === cat.id));
  assert.equal((await api.response('/categories/' + cat.id, 'DELETE')).status, 204);

  const dwc = await api.get<{ id: number }>('/dynamic-content', 'POST', {
    name: 'Banner ' + tag, slotName: 'banner-' + tag, content: '<p>Offer</p>', isCampaignBased: true, published: true,
  });
  await api.get('/dynamic-content/' + dwc.id, 'PATCH', { name: 'Banner v2 ' + tag });
  assert.equal((await api.response('/dynamic-content/' + dwc.id, 'DELETE')).status, 204);

  const focus = await api.get<{ id: number; embedScript: string }>('/focus-items', 'POST', {
    name: 'Promo Bar ' + tag, type: 'notice', style: 'bar', headline: 'Hello', tagline: 'Update', when: 'immediately', published: true,
  });
  assert.ok(focus.embedScript.includes('/focus/' + focus.id + '.js'));
  await api.get('/focus-items/' + focus.id, 'PATCH', { headline: 'Hello v2' });
  assert.equal((await api.response('/focus-items/' + focus.id, 'DELETE')).status, 204);

  const reports = await api.get<Array<{ id: number }>>('/reports');
  assert.ok(reports.length > 0);
  const firstReport = await api.get<{ report: { id: number }; rows: unknown[] }>('/reports/' + reports[0].id + '?limit=5');
  assert.equal(firstReport.report.id, reports[0].id);
  assert.ok(Array.isArray(firstReport.rows));

  await api.get('/suppressions', 'POST', {
    email: 'manual-' + tag + '@example.test', reason: 'unsubscribe', evidence: 'Automated suppression fixture',
  });
  assert.ok((await api.get<unknown[]>('/suppressions')).length >= 1);

  // Listmonk extended: list edit/delete, template CRUD/preview/tx, transactional send, campaign clone/archive/analytics/delete, media upload/delete, bounces, SMTP diagnostic, maintenance GC
  const list = await api.get<MailingList>('/lists', 'POST', { name: 'Ext List ' + tag, description: 'Test', type: 'private', optin: 'double' });
  await api.get('/lists/' + list.id, 'PATCH', { name: 'Ext List v2 ' + tag, description: 'Updated' });

  const tpl = await api.get<Template>('/templates', 'POST', { name: 'Ext Tpl ' + tag, type: 'campaign', body: '<div>{{ template "content" . }}</div>' });
  await api.get('/templates/' + tpl.id, 'PATCH', { name: 'Ext Tpl v2 ' + tag, type: 'campaign', body: '<section>{{ template "content" . }}</section>' });
  assert.ok((await api.response('/templates/' + tpl.id + '/preview')).ok);

  const txTpl = await api.get<Template>('/templates', 'POST', {
    name: 'Ext Tx ' + tag, type: 'tx', subject: 'Receipt', body: '<p>Hello {{ .Tx.Data.name }}</p>',
  });
  await api.get('/tx', 'POST', { email: contactEmail, templateId: txTpl.id, subject: 'Tx ' + tag, data: { name: 'Extended' } });

  const camp = await api.get<Campaign>('/campaigns', 'POST', {
    name: 'Ext Camp ' + tag, subject: 'Ext Subj ' + tag, body: '<p>Content</p>',
    listIds: [list.id], templateId: tpl.id, tags: ['ext'], altBody: 'Plain copy',
  });
  const archived = await api.get<Campaign>('/campaigns/' + camp.id + '/archive', 'PATCH', { archive: true, archiveSlug: 'ext-' + tag });
  assert.equal(archived.archive, true);
  assert.equal(archived.archiveSlug, 'ext-' + tag);
  const cloned = await api.get<Campaign>('/campaigns/' + camp.id + '/clone', 'POST', { name: 'Ext Clone ' + tag });
  assert.notEqual(cloned.id, camp.id);
  assert.ok(Array.isArray((await api.get<{ links: unknown[] }>('/campaigns/' + camp.id + '/analytics')).links));
  assert.ok(Array.isArray(await api.get<unknown[]>('/campaigns/running')));
  assert.ok(Array.isArray((await api.get<Page<unknown>>('/bounces?page=1')).items));
  assert.equal((await api.response('/media/' + uploaded.id, 'DELETE')).status, 204);

  await api.get('/settings/smtp/test', 'POST', { email: contactEmail });
  assert.equal(typeof (await api.get<{ count: number }>('/settings/maintenance', 'POST', { action: 'gc_unconfirmed' })).count, 'number');
  assert.equal(typeof (await api.get<{ count: number }>('/settings/maintenance', 'POST', { action: 'gc_blocklisted' })).count, 'number');

  assert.equal((await api.response('/campaigns/' + cloned.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/campaigns/' + camp.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/templates/' + tpl.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/templates/' + txTpl.id, 'DELETE')).status, 204);
  assert.equal((await api.response('/lists/' + list.id, 'DELETE')).status, 204);

  // Umami extended: website CRUD, realtime, sessions/stats/properties, weekly, segments, revenue, performance, expanded metrics, events feed, funnels CRUD, goals CRUD, annotations, shares, retention, journeys, attribution, breakdown, links & pixels CRUD + charts
  const site = await api.get<{ id: string }>('/websites', 'POST', { name: 'Ext Site ' + tag, domain: 'ext-' + tag + '.example.test' });
  await api.get('/websites/' + site.id, 'PATCH', { name: 'Ext Site v2 ' + tag, domain: 'ext-' + tag + '.example.test' });
  const rangeQ = 'startAt=' + (Date.now() - 86_400_000) + '&endAt=' + Date.now();
  assert.equal(typeof (await api.get<{ visitors: number }>('/websites/' + site.id + '/realtime')).visitors, 'number');
  assert.equal((await api.get<number[][]>('/websites/' + site.id + '/sessions/weekly?' + rangeQ)).length, 7);
  assert.ok(Array.isArray((await api.get<Page<unknown>>('/websites/' + site.id + '/sessions?' + rangeQ + '&page=1')).items));
  assert.equal(typeof (await api.get<{ pageviews: number }>('/websites/' + site.id + '/sessions/stats?' + rangeQ)).pageviews, 'number');
  assert.ok(Array.isArray(await api.get<unknown[]>('/websites/' + site.id + '/sessions/properties?' + rangeQ)));
  assert.ok(Array.isArray(await api.get<unknown[]>('/websites/' + site.id + '/metrics/expanded?' + rangeQ + '&type=path')));
  assert.ok(Array.isArray((await api.get<Page<unknown>>('/websites/' + site.id + '/events?' + rangeQ + '&page=1')).items));
  assert.equal((await api.get<{ currency: string }>('/websites/' + site.id + '/revenue?' + rangeQ + '&currency=GBP&type=country')).currency, 'GBP');
  assert.equal((await api.get<{ metric: string }>('/websites/' + site.id + '/performance?' + rangeQ + '&metric=lcp&type=path')).metric, 'lcp');
  assert.ok(Array.isArray(await api.get<unknown[]>('/websites/' + site.id + '/events/properties?' + rangeQ)));
  assert.ok(Array.isArray(await api.get<unknown[]>('/websites/' + site.id + '/retention?' + rangeQ)));
  assert.ok(Array.isArray(await api.get<unknown[]>('/websites/' + site.id + '/journeys?' + rangeQ + '&steps=3')));
  assert.equal(typeof (await api.get<{ total: { pageviews: number } }>('/websites/' + site.id + '/attribution?' + rangeQ + '&model=first-click&type=path&step=%2F')).total.pageviews, 'number');
  assert.ok(Array.isArray(await api.get<unknown[]>('/websites/' + site.id + '/breakdown', 'POST', {
    startAt: Date.now() - 86_400_000, endAt: Date.now(), fields: ['path', 'browser'],
  })));

  const webSeg = await api.get<{ id: string }>('/websites/' + site.id + '/segments', 'POST', {
    name: 'UK Mobile ' + tag, type: 'segment', filters: [{ name: 'country', operator: 'eq', value: 'GB' }], match: 'all',
  });
  assert.ok((await api.get<Array<{ id: string }>>('/websites/' + site.id + '/segments?type=segment')).some(item => item.id === webSeg.id));
  assert.equal((await api.response('/websites/' + site.id + '/segments/' + webSeg.id, 'DELETE')).status, 204);

  const savedFunnel = await api.get<{ id: string }>('/websites/' + site.id + '/funnels', 'POST', {
    name: 'Funnel ' + tag, steps: [{ type: 'path', value: '/' }, { type: 'event', value: 'signup' }], windowMinutes: 60,
  });
  assert.equal((await api.get<unknown[]>('/websites/' + site.id + '/funnels/' + savedFunnel.id + '/stats?' + rangeQ)).length, 2);
  assert.equal((await api.response('/websites/' + site.id + '/funnels/' + savedFunnel.id, 'DELETE')).status, 204);

  const ann = await api.get<{ id: string }>('/websites/' + site.id + '/annotations', 'POST', {
    date: new Date().toISOString().slice(0, 10), allDay: true, note: 'Campaign launch ' + tag,
  });
  assert.equal((await api.response('/websites/' + site.id + '/annotations/' + ann.id, 'DELETE')).status, 204);

  const share = await api.get<{ id: string }>('/websites/' + site.id + '/shares', 'POST', { name: 'Board ' + tag });
  assert.equal((await api.response('/websites/' + site.id + '/shares/' + share.id, 'DELETE')).status, 204);

  const link = await api.get<{ id: string }>('/links', 'POST', { name: 'Link ' + tag, url: 'https://example.test/promo' });
  await api.get('/links/' + link.id, 'PATCH', { name: 'Link v2 ' + tag });
  assert.equal(typeof await api.get<Record<string, unknown>>('/links/charts?ids=' + link.id), 'object');
  assert.equal((await api.response('/links/' + link.id, 'DELETE')).status, 204);

  const pixel = await api.get<{ id: string }>('/pixels', 'POST', { name: 'Pixel ' + tag });
  await api.get('/pixels/' + pixel.id, 'PATCH', { name: 'Pixel v2 ' + tag });
  assert.equal(typeof await api.get<Record<string, unknown>>('/pixels/charts?ids=' + pixel.id), 'object');
  assert.equal((await api.response('/pixels/' + pixel.id, 'DELETE')).status, 204);

  assert.ok((await api.response('/websites/' + site.id + '/export?' + rangeQ)).ok);
  assert.equal((await api.response('/websites/' + site.id, 'DELETE')).status, 204);

  context.diagnostic('Verified full Mautic 7.2.2, Listmonk v6.2.0, and Umami v3.5.0 Phase 1 & Phase 2 APIs end-to-end against live services.');
});
