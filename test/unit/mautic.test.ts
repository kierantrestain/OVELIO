import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowInput } from '../../src/contracts';
import { createMautic } from '../../src/server/mautic';
import { UpstreamError } from '../../src/server/upstream';

function client(handler: (request: Request) => Response | Promise<Response>) {
  return createMautic({
    url: 'http://marketing-engine.local/',
    username: 'integration',
    password: 'unit-test-password',
    fetch: async (input, init) => handler(new Request(input, init)),
  });
}

function contact(id: number, email: string, doNotContact: object = [], dateAdded = '2026-10-24T16:09:00+00:00') {
  return {
    id, dateAdded, doNotContact, points: 12,
    fields: { all: { email, firstname: 'Taylor', lastname: 'Hale', company: 'Example Studio' } },
    tags: [{ id: 1, tag: 'Early access' }],
  };
}

const input: WorkflowInput = {
  name: 'Welcome subscribers',
  segmentId: 3,
  steps: [
    { emailId: 4, delayMinutes: 0 },
    { emailId: 5, delayMinutes: 90, condition: 'opened_previous' },
    { emailId: 6, delayMinutes: 0, condition: 'clicked_previous' },
  ],
};

type Id = string | number;
type DraftPayload = {
  lists: { id: number }[];
  events: { id: Id; [key: string]: unknown }[];
  isPublished: boolean;
  canvasSettings: {
    nodes: { id: Id; [key: string]: unknown }[];
    connections: { sourceId: Id; targetId: Id; anchors: { source: string; target: string } }[];
  };
};

function persistCampaign(payload: DraftPayload) {
  const actualIds = new Map(payload.events.map(({ id }, index) => [id, typeof id === 'number' ? id : index + 18]));
  return {
    id: 27,
    ...payload,
    events: payload.events.map(event => ({ ...event, id: actualIds.get(event.id) })),
    canvasSettings: {
      nodes: payload.canvasSettings.nodes.map(node => ({ ...node, id: actualIds.get(node.id) ?? node.id })),
      connections: payload.canvasSettings.connections.map(connection => ({
        ...connection,
        sourceId: actualIds.get(connection.sourceId) ?? connection.sourceId,
        targetId: actualIds.get(connection.targetId),
      })),
    },
  };
}

test('retrieves identified contacts with a selected segment, stable pagination and email-channel suppression', async () => {
  const api = client(request => {
    const url = new URL(request.url);
    assert.equal(request.headers.get('Authorization'), 'Basic ' + Buffer.from('integration:unit-test-password').toString('base64'));
    if (url.pathname === '/api/segments/3') return Response.json({ list: { id: 3, name: 'New leads', alias: 'new-leads' } });
    assert.equal(url.pathname, '/api/contacts');
    assert.equal(url.searchParams.get('search'), 'segment:"new-leads" "Taylor"');
    assert.equal(url.searchParams.get('start'), '100');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.get('orderBy'), 'l.date_added,l.id');
    assert.equal(url.searchParams.get('where[0][col]'), 'l.date_identified');
    return Response.json({
      total: '102',
      contacts: {
        17: contact(17, 'Taylor@example.test', [{ id: 1, channel: 'email', reason: 1 }]),
        19: contact(19, 'Taylor2@example.test', [{ id: 2, channel: 'sms', reason: 1 }]),
      },
    });
  });
  const page = await api.contacts({ page: 2, limit: 500, search: 'Taylor', segmentId: 3 });
  assert.equal(page.total, 102);
  assert.deepEqual(page.items.map(({ id, email, suppressed }) => [id, email, suppressed]), [
    [19, 'taylor2@example.test', false], [17, 'taylor@example.test', true],
  ]);
});

test('fails closed when an exact address has duplicate records or missing consent data', async () => {
  const duplicates = client(request => {
    assert.equal(new URL(request.url).searchParams.get('where[0][val]'), 'person@example.test');
    return Response.json({ total: '2', contacts: [contact(2, 'Person@example.test'), contact(3, 'person@example.test')] });
  });
  await assert.rejects(() => duplicates.findContact('Person@example.test'), { name: 'UpstreamError', status: 409 });
  const missing = client(() => Response.json({ contact: { id: 2, fields: { all: { email: 'person@example.test' } } } }));
  await assert.rejects(() => missing.contact(2), { name: 'UpstreamError', status: 502 });
});

test('sends native email-channel suppression and verifies persisted state', async () => {
  let posted = false;
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'POST') {
      assert.equal(url.pathname, '/api/contacts/2/dnc/email/add');
      assert.match(request.headers.get('content-type') ?? '', /application\/x-www-form-urlencoded/);
      assert.equal(new URLSearchParams(await request.text()).get('reason'), '2');
      posted = true;
      return Response.json({ contact: contact(2, 'person@example.test') });
    }
    assert.ok(posted);
    assert.equal(url.pathname, '/api/contacts/2');
    return Response.json({ contact: contact(2, 'person@example.test', { email: { id: 6, reason: 2, channel: 'email' } }) });
  });
  await api.setSuppressed(2, 'bounce');
});

test('creates native marketing email and decision nodes and reads the engine-assigned graph', async () => {
  const api = client(async request => {
    assert.equal(request.method, 'POST');
    assert.equal(new URL(request.url).pathname, '/api/campaigns/new');
    const payload = await request.json() as DraftPayload;
    assert.deepEqual(payload.lists, [{ id: 3 }]);
    assert.equal(payload.isPublished, false);
    assert.deepEqual(payload.events.map(event => event.type), [
      'email.send', 'email.open', 'email.send', 'email.click', 'email.send',
    ]);
    assert.deepEqual(payload.events[0].properties, { email: 4, email_type: 'marketing' });
    assert.equal(payload.events[2].triggerInterval, 90);
    assert.equal(payload.events[2].triggerIntervalUnit, 'i');
    assert.deepEqual(payload.canvasSettings.connections.map(edge => edge.anchors.source), [
      'leadsource', 'bottom', 'yes', 'bottom', 'yes',
    ]);
    return Response.json({ campaign: persistCampaign(payload) }, { status: 201 });
  });
  const saved = await api.createWorkflow(input);
  assert.equal(saved.id, 27);
  assert.deepEqual(saved.steps, input.steps);
  assert.equal(saved.enabled, false);
  assert.equal(saved.editable, true);
});

test('rejects conditions without a preceding email and repeated marketing emails before writing', async () => {
  const api = client(() => { throw new Error('no network request expected'); });
  await assert.rejects(
    () => api.createWorkflow({ ...input, steps: [{ emailId: 4, delayMinutes: 0, condition: 'opened_previous' }] }),
    { name: 'UpstreamError', status: 400 },
  );
  await assert.rejects(
    () => api.createWorkflow({ ...input, steps: [...input.steps, { emailId: 4, delayMinutes: 0 }] }),
    { name: 'UpstreamError', status: 400 },
  );
});

test('publishes through the native API and verifies server-side publication', async () => {
  let saved: ReturnType<typeof persistCampaign>;
  let permitPublish = false;
  const api = client(async request => {
    const path = new URL(request.url).pathname;
    if (path === '/api/campaigns/new') {
      saved = persistCampaign(await request.json() as DraftPayload);
      return Response.json({ campaign: saved }, { status: 201 });
    }
    if (path === '/api/campaigns/27') return Response.json({ campaign: saved });
    if (path === '/api/segments/3') return Response.json({ list: { id: 3, isPublished: true } });
    if (path.startsWith('/api/emails/')) {
      return Response.json({ email: {
        id: Number(path.split('/').at(-1)), isPublished: true, emailType: 'template', sendToDnc: false,
        customHtml: '<p><a href="{unsubscribe_url}">Unsubscribe</a></p>',
      } });
    }
    assert.equal(path, '/api/campaigns/27/edit');
    assert.equal(request.method, 'PATCH');
    const { isPublished } = await request.json() as { isPublished: boolean };
    saved = { ...saved, isPublished: permitPublish && isPublished };
    return Response.json({ campaign: saved });
  });
  await api.createWorkflow(input);
  await assert.rejects(() => api.setWorkflowEnabled(27, true), { name: 'UpstreamError', status: 502 });
  permitPublish = true;
  assert.equal((await api.setWorkflowEnabled(27, true)).enabled, true);
  assert.equal((await api.setWorkflowEnabled(27, false)).enabled, false);
});

test('creates a published template email with a native unsubscribe link inside its body', async () => {
  const api = client(async request => {
    assert.equal(new URL(request.url).pathname, '/api/emails/new');
    const body = await request.json() as { customHtml: string; sendToDnc: boolean; isPublished: boolean };
    assert.equal(body.sendToDnc, false);
    assert.equal(body.isPublished, true);
    assert.match(body.customHtml, /href="\{unsubscribe_url\}".*<\/p><\/body>/);
    return Response.json({ email: { id: 4, ...body } }, { status: 201 });
  });
  const email = await api.createEmail({ name: 'Welcome', subject: 'Thanks for joining', body: '<html><body><p>Welcome</p></body></html>' });
  assert.equal(email.published, true);
});

test('counts contact growth through a stable cursor and includes empty dates', async () => {
  let visited = 0;
  const api = client(request => {
    const query = new URL(request.url).searchParams;
    assert.equal(query.get('where[1][val]'), '2026-10-23 00:00:00');
    assert.equal(query.get('where[2][val]'), '2026-10-25 23:59:59');
    if (++visited === 1) {
      assert.equal(query.get('where[3][val]'), null);
      return Response.json({ contacts: Array.from({ length: 100 }, (_, index) => ({ id: 101 - index, dateAdded: '2026-10-24T16:09:00+00:00' })) });
    }
    assert.equal(query.get('where[3][val]'), '2');
    return Response.json({ contacts: [{ id: 1, dateAdded: '2026-10-23T16:09:00+00:00' }] });
  });
  const growth = await api.contactGrowth({ startAt: Date.parse('2026-10-23'), endAt: Date.parse('2026-10-26') - 1 });
  assert.deepEqual(growth, [
    { label: '2026-10-23', value: 1 }, { label: '2026-10-24', value: 100 }, { label: '2026-10-25', value: 0 },
  ]);
  assert.equal(visited, 2);
});

test('uses the engine form submission count and rejects unavailable statistics', async () => {
  const range = { startAt: Date.parse('2026-10-01'), endAt: Date.parse('2026-10-31') };
  const api = client(request => {
    const url = new URL(request.url);
    assert.equal(url.pathname, '/api/stats/form_submissions');
    assert.equal(url.searchParams.get('where[0][col]'), 'date_submitted');
    assert.equal(url.searchParams.get('where[0][val]'), '2026-10-01 00:00:00');
    return Response.json({ total: '85', stats: [] });
  });
  assert.equal(await api.leadCount(range), 85);
  const unavailable = client(() => Response.json({ availableTables: [] }));
  await assert.rejects(() => unavailable.leadCount(range), UpstreamError);
});

test('creates a published lead capture form with mapped contact fields and no subscription action', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (url.pathname === '/api/stats/form_submissions') {
      assert.equal(url.searchParams.get('where[0][val]'), '22');
      return Response.json({ total: '0', stats: [] });
    }
    assert.equal(url.pathname, '/api/forms/new');
    assert.equal(request.method, 'POST');
    const input = await request.json() as {
      fields: { type: string; mappedObject?: string; mappedField?: string; isRequired?: boolean }[];
      formType: string;
      isPublished: boolean;
      name: string;
      actions: unknown[];
      postAction: string;
      postActionProperty: string;
    };
    assert.equal(input.formType, 'standalone');
    assert.equal(input.isPublished, true);
    assert.equal(input.postAction, 'message');
    assert.equal(input.postActionProperty, 'Thanks &amp; &lt;welcome&gt;. &#123;formfield=name&#125;');
    assert.deepEqual(input.actions, []);
    assert.deepEqual(input.fields.map(({ type, mappedObject, mappedField, isRequired }) => [type, mappedObject, mappedField, isRequired]), [
      ['text', 'contact', 'firstname', undefined], ['email', 'contact', 'email', true], ['button', undefined, undefined, undefined],
    ]);
    const fields = input.fields.map((field, index) => ({ id: index + 43, ...field }));
    return Response.json({ form: { ...input, id: 22, fields } }, { status: 201 });
  });
  const form = await api.createForm({ name: 'Request information', message: 'Thanks & <welcome>. {formfield=name}' });
  assert.deepEqual(form, { id: 22, name: 'Request information', submissions: 0, published: true });
});
