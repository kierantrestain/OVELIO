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
  assert.deepEqual(form, {
    id: 22,
    name: 'Request information',
    description: '',
    submissions: 0,
    published: true,
    fields: [
      { id: 43, label: 'First name', alias: 'first_name', type: 'text', mappedField: 'firstname', isRequired: false },
      { id: 44, label: 'Email address', alias: 'email', type: 'email', mappedField: 'email', isRequired: true },
    ],
  });
});

test('maps extended contact fields, stage info, blanks overwrite, and tag search filter', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/contacts/new') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.phone, '+1-555-0100');
      assert.equal(body.position, 'VP Marketing');
      assert.equal(body.city, 'Austin');
      assert.equal(body.country, 'United States');
      assert.equal(body.website, 'https://example.test');
      assert.equal(body.overwriteWithBlank, undefined);
      return Response.json({
        contact: {
          ...contact(31, 'ada@example.test'),
          fields: {
            all: {
              email: 'ada@example.test', firstname: 'Ada', lastname: 'Lovelace', company: 'Analytical',
              phone: '+1-555-0100', position: 'VP Marketing', city: 'Austin', country: 'United States', website: 'https://example.test',
            },
          },
          stage: { id: 7, name: 'SQL' },
        },
      }, { status: 201 });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/contacts/31/edit') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.phone, '');
      assert.equal(body.overwriteWithBlank, true);
      return Response.json({ contact: contact(31, 'ada@example.test') });
    }
    assert.equal(url.pathname, '/api/contacts');
    assert.equal(url.searchParams.get('search'), 'tag:"vip" "Ada"');
    return Response.json({ total: '1', contacts: [contact(31, 'ada@example.test')] });
  });

  const created = await api.createContact({
    email: 'Ada@example.test', firstName: 'Ada', lastName: 'Lovelace', company: 'Analytical',
    phone: '+1-555-0100', position: 'VP Marketing', city: 'Austin', country: 'United States', website: 'https://example.test',
  });
  assert.equal(created.phone, '+1-555-0100');
  assert.equal(created.position, 'VP Marketing');
  assert.equal(created.city, 'Austin');
  assert.equal(created.country, 'United States');
  assert.equal(created.website, 'https://example.test');
  assert.equal(created.stageId, 7);
  assert.equal(created.stageName, 'SQL');

  const cleared = await api.updateContact(31, { email: 'ada@example.test', phone: '' });
  assert.equal(cleared.phone, '');
  assert.equal(cleared.stageId, null);
  assert.equal(cleared.stageName, null);

  const filtered = await api.contacts({ tag: 'vip', search: 'Ada' });
  assert.equal(filtered.total, 1);
});

test('adjusts contact points, manages contact notes, and reads active contact campaigns', async () => {
  let points = 12;
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/contacts/9/points/plus/15') {
      points += 15;
      return Response.json({ success: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/contacts/9/points/minus/5') {
      points -= 5;
      return Response.json({ success: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/contacts/9') {
      return Response.json({ contact: { ...contact(9, 'lead@example.test'), points } });
    }
    if (request.method === 'GET' && url.pathname === '/api/contacts/9/notes') {
      assert.equal(url.searchParams.get('limit'), '50');
      return Response.json({
        notes: {
          1: { id: 1, text: 'Initial intro', type: 'call', dateTime: '2026-10-20 10:00:00' },
          2: { id: 2, text: 'Sent proposal', type: 'email', dateTime: '2026-10-21 12:00:00' },
        },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/notes/new') {
      const body = await request.json() as { lead: number; text: string; type: string };
      assert.deepEqual(body, { lead: 9, text: 'Follow up Friday', type: 'general' });
      return Response.json({ note: { id: 3, text: body.text, type: body.type, dateTime: '2026-10-22T09:00:00+00:00' } }, { status: 201 });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/notes/3/delete') {
      return new Response(null, { status: 404 });
    }
    if (request.method === 'GET' && url.pathname === '/api/contacts/9/campaigns') {
      return Response.json({
        campaigns: {
          4: { id: 4, name: 'Welcome', manuallyRemoved: false },
          8: { id: 8, name: 'Old drip', manuallyRemoved: true },
          11: { id: 11, name: 'Upsell', manuallyRemoved: 0 },
        },
      });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  await assert.rejects(() => api.adjustPoints(9, 0), { name: 'UpstreamError', status: 400 });
  await assert.rejects(() => api.adjustPoints(9, 2.5), { name: 'UpstreamError', status: 400 });
  assert.equal((await api.adjustPoints(9, 15)).points, 27);
  assert.equal((await api.adjustPoints(9, -5)).points, 22);

  const notes = await api.contactNotes(9);
  assert.deepEqual(notes.map(note => [note.id, note.type]), [[2, 'email'], [1, 'call']]);
  const createdNote = await api.createContactNote(9, { text: 'Follow up Friday' });
  assert.equal(createdNote.id, 3);
  assert.equal(createdNote.type, 'general');
  await api.deleteContactNote(3);

  assert.deepEqual(await api.contactCampaigns(9), [4, 11]);
});

test('manages segments CRUD with dynamic filters and ignores 404 on delete', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/segments/new') {
      const body = await request.json() as {
        name: string; isPublished: boolean;
        filters: { glue: string; field: string; operator: string; filter: string; properties: { filter: string } }[];
      };
      assert.equal(body.isPublished, false);
      assert.equal(body.filters[0].field, 'country');
      assert.equal(body.filters[0].properties.filter, 'US');
      return Response.json({
        list: {
          id: 14, name: body.name, alias: 'us-leads', description: 'US filter',
          isPublished: false, isGlobal: true, filters: body.filters,
        },
      }, { status: 201 });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/segments/14/edit') {
      const body = await request.json() as { name: string; isPublished: boolean };
      assert.deepEqual(body, { name: 'US enterprise', isPublished: true });
      return Response.json({
        list: {
          id: 14, name: body.name, alias: 'us-leads', description: 'US filter',
          isPublished: true, isGlobal: false,
          filters: [{ glue: 'and', field: 'country', object: 'lead', type: 'country', operator: '=', properties: { filter: 'US' } }],
        },
      });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/segments/14/delete') {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const created = await api.createSegment({
    name: 'US leads',
    published: false,
    filters: [{ glue: 'and', field: 'country', operator: '=', filter: 'US' }],
  });
  assert.equal(created.published, false);
  assert.equal(created.isGlobal, true);
  assert.equal(created.filters?.[0]?.filter, 'US');

  const updated = await api.updateSegment(14, { name: 'US enterprise', published: true });
  assert.equal(updated.name, 'US enterprise');
  assert.equal(updated.published, true);
  assert.equal(updated.isGlobal, false);
  assert.equal(updated.filters?.[0]?.filter, 'US');

  await api.deleteSegment(14);
});

test('manages tags, lifecycle stages, and B2B companies CRUD and contact links', async () => {
  const calls: string[] = [];
  const api = client(async request => {
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    if (url.pathname === '/api/tags') {
      return Response.json({ total: 2, tags: { 2: { id: 2, tag: 'newsletter' }, 1: { id: 1, tag: 'beta', description: 'Beta cohort' } } });
    }
    if (url.pathname === '/api/tags/new') {
      const body = await request.json() as { tag: string; description?: string };
      return Response.json({ tag: { id: 5, ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/tags/5/delete') return Response.json({ tag: { id: 5 } });

    if (url.pathname === '/api/stages') {
      return Response.json({
        total: 2,
        stages: [
          { id: 2, name: 'SQL', description: '', weight: 20, isPublished: true },
          { id: 1, name: 'MQL', description: 'Qualified', weight: 10, isPublished: true },
        ],
      });
    }
    if (url.pathname === '/api/stages/new') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ stage: { id: 3, ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/stages/3/edit') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ stage: { id: 3, name: 'Customer', description: '', weight: 30, isPublished: true, ...body } });
    }
    if (url.pathname === '/api/stages/3/delete') return new Response(null, { status: 204 });
    if (url.pathname === '/api/stages/3/contact/9/add') return Response.json({ success: true });
    if (url.pathname === '/api/stages/3/contact/9/remove') return Response.json({ success: true });

    if (url.pathname === '/api/companies') {
      assert.equal(url.searchParams.get('search'), 'Acme');
      return Response.json({
        total: 1,
        companies: {
          10: {
            id: 10, score: 45,
            fields: {
              all: {
                companyname: 'Acme Corp', companyemail: 'info@acme.test', companywebsite: 'https://acme.test',
                companyindustry: 'Software', companycity: 'London', companycountry: 'UK',
              },
            },
          },
        },
      });
    }
    if (url.pathname === '/api/companies/new') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.companyname, 'Acme Corp');
      assert.equal(body.companyindustry, 'Software');
      return Response.json({ company: { id: 10, score: 0, fields: { all: body } } }, { status: 201 });
    }
    if (url.pathname === '/api/companies/10/edit') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.companycity, 'Berlin');
      return Response.json({ company: { id: 10, score: 10, fields: { all: { companyname: 'Acme Corp', ...body } } } });
    }
    if (url.pathname === '/api/companies/10/contact/9/add') return Response.json({ success: true });
    if (url.pathname === '/api/companies/10/delete') return Response.json({ company: { id: 10 } });
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  await assert.rejects(() => api.createTag('-bad'), { name: 'UpstreamError', status: 400 });
  assert.deepEqual((await api.tags()).map(t => t.tag), ['beta', 'newsletter']);
  assert.equal((await api.createTag('vip', 'Top accounts')).id, 5);
  await api.deleteTag(5);

  assert.deepEqual((await api.stages()).map(s => s.name), ['MQL', 'SQL']);
  const stage = await api.createStage({ name: 'Customer', weight: 30 });
  assert.equal(stage.weight, 30);
  const updatedStage = await api.updateStage(3, { weight: 40 });
  assert.equal(updatedStage.weight, 40);
  await api.setContactStage(9, 3);
  await api.removeContactStage(9, 3);
  await api.deleteStage(3);

  const foundCompanies = await api.companies({ search: 'Acme' });
  assert.equal(foundCompanies[0].name, 'Acme Corp');
  assert.equal(foundCompanies[0].score, 45);
  const createdCompany = await api.createCompany({ name: 'Acme Corp', industry: 'Software', email: 'info@acme.test' });
  assert.equal(createdCompany.industry, 'Software');
  const updatedCompany = await api.updateCompany(10, { city: 'Berlin' });
  assert.equal(updatedCompany.city, 'Berlin');
  await api.addContactToCompany(10, 9);
  await api.deleteCompany(10);

  assert.ok(calls.includes('POST /api/stages/3/contact/9/add'));
  assert.ok(calls.includes('POST /api/companies/10/contact/9/add'));
});

test('manages lead scoring point actions, flattened action types, and point triggers', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (url.pathname === '/api/points') {
      return Response.json({
        total: 1,
        points: { 1: { id: 1, name: 'Email opened', description: 'Open bonus', type: 'email.open', delta: 5, isPublished: true } },
      });
    }
    if (url.pathname === '/api/points/actions/types') {
      return Response.json({
        actionTypes: {
          Email: { 'email.open': 'Opens an email', 'email.send': 'Is sent an email' },
          'form.submit': 'Submits a form',
        },
      });
    }
    if (url.pathname === '/api/points/new') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ point: { id: 2, ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/points/2/edit') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ point: { id: 2, name: 'Form submit', description: '', type: 'form.submit', delta: 20, isPublished: true, ...body } });
    }
    if (url.pathname === '/api/points/2/delete') return Response.json({ point: { id: 2 } });

    if (url.pathname === '/api/points/triggers') {
      return Response.json({
        total: 1,
        triggers: {
          4: {
            id: 4, name: 'Hot lead', description: '50+ points', points: 50, isPublished: true, triggerExistingLeads: true,
            events: [{ id: 8, name: 'Add VIP tag', type: 'lead.changetags', properties: { add_tags: ['hot'] } }],
          },
        },
      });
    }
    if (url.pathname === '/api/points/triggers/new') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ trigger: { id: 5, events: [], ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/points/triggers/5/edit') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ trigger: { id: 5, name: 'SQL threshold', description: '', points: 100, isPublished: true, triggerExistingLeads: false, events: [], ...body } });
    }
    if (url.pathname === '/api/points/triggers/5/delete') return Response.json({ trigger: { id: 5 } });
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const actions = await api.pointActions();
  assert.equal(actions[0].delta, 5);
  const types = await api.pointActionTypes();
  assert.deepEqual(types, {
    'email.open': 'Opens an email',
    'email.send': 'Is sent an email',
    'form.submit': 'Submits a form',
  });
  const createdAction = await api.createPointAction({ name: 'Form submit', type: 'form.submit', delta: 10 });
  assert.equal(createdAction.id, 2);
  const updatedAction = await api.updatePointAction(2, { delta: 20 });
  assert.equal(updatedAction.delta, 20);
  await api.deletePointAction(2);

  const triggers = await api.pointTriggers();
  assert.equal(triggers[0].points, 50);
  assert.equal(triggers[0].triggerExistingLeads, true);
  assert.equal(triggers[0].events[0].type, 'lead.changetags');
  const createdTrigger = await api.createPointTrigger({ name: 'SQL threshold', points: 75 });
  assert.equal(createdTrigger.points, 75);
  const updatedTrigger = await api.updatePointTrigger(5, { points: 100 });
  assert.equal(updatedTrigger.points, 100);
  await api.deletePointTrigger(5);
});

test('reads, updates with unsubscribe/DNC invariants, and deletes journey emails with stats', async () => {
  let dropUnsubscribe = false;
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/emails/4') {
      return Response.json({
        email: {
          id: 4, name: 'Welcome', subject: 'Hi', isPublished: true, emailType: 'template', sendToDnc: false,
          customHtml: '<p>Hello</p><p><a href="{unsubscribe_url}">Unsubscribe</a></p>',
          sentCount: 120, readCount: 64,
        },
      });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/emails/4/edit') {
      const body = await request.json() as { customHtml: string; sendToDnc: boolean; isPublished?: boolean; name: string; subject: string };
      assert.equal(body.sendToDnc, false);
      assert.match(body.customHtml, /href="\{unsubscribe_url\}"/);
      // Must not duplicate unsubscribe link when already present
      assert.equal((body.customHtml.match(/\{unsubscribe_url\}/g) ?? []).length, 1);
      return Response.json({
        email: {
          id: 4, emailType: 'template', isPublished: body.isPublished ?? true, sentCount: 120, readCount: 64, ...body,
          ...(dropUnsubscribe ? { customHtml: '<p>Stripped</p>' } : {}),
        },
      });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/emails/4/delete') {
      return Response.json({ email: { id: 4 } });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const fetched = await api.email(4);
  assert.equal(fetched.sentCount, 120);
  assert.equal(fetched.readCount, 64);
  assert.match(fetched.body ?? '', /Hello/);

  const updated = await api.updateEmail(4, { name: 'Welcome v2', subject: 'Hello again', body: '<p>Updated</p>', published: true });
  assert.equal(updated.name, 'Welcome v2');
  assert.match(updated.body ?? '', /\{unsubscribe_url\}/);

  // Re-submitting HTML that already has {unsubscribe_url} should not add a second link
  await api.updateEmail(4, { name: 'Welcome v3', subject: 'Hello again', body: updated.body ?? '' });

  dropUnsubscribe = true;
  await assert.rejects(
    () => api.updateEmail(4, { name: 'Welcome v4', subject: 'Hi', body: '<p>Hi</p>' }),
    { name: 'UpstreamError', status: 502 },
  );

  await api.deleteEmail(4);
});

test('supports custom form fields, update, delete, and paginated form submissions', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (url.pathname === '/api/stats/form_submissions') {
      return Response.json({ total: '12', stats: [] });
    }
    if (request.method === 'POST' && url.pathname === '/api/forms/new') {
      const body = await request.json() as { fields: Record<string, unknown>[]; name: string; description: string; formType: string; isPublished: boolean };
      assert.equal(body.description, 'Inbound inquiry');
      assert.deepEqual(body.fields.map(f => [f.alias, f.type, f.mappedField]), [
        ['company', 'text', 'company'],
        ['plan', 'select', undefined],
        ['topics', 'checkboxgrp', undefined],
        ['email', 'email', 'email'],
        ['submit', 'button', undefined],
      ]);
      const fields = body.fields.map((field, index) => ({ id: index + 1, ...field }));
      return Response.json({ form: { ...body, id: 30, fields } }, { status: 201 });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/forms/30/edit') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.name, 'Demo inquiry v2');
      return Response.json({ form: { id: 30, name: 'Demo inquiry v2', description: 'Updated', isPublished: true, fields: [] } });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/forms/30/delete') {
      return Response.json({ form: { id: 30 } });
    }
    if (request.method === 'GET' && url.pathname === '/api/forms/30/submissions') {
      assert.equal(url.searchParams.get('start'), '25');
      assert.equal(url.searchParams.get('limit'), '25');
      return Response.json({
        total: 26,
        submissions: [{
          id: 901,
          form: { id: 30 },
          lead: { id: 17 },
          dateSubmitted: '2026-10-24T12:00:00+00:00',
          results: { email: 'ada@example.test', plan: 'Growth' },
        }],
      });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const created = await api.createForm({
    name: 'Demo inquiry',
    description: 'Inbound inquiry',
    fields: [
      { label: 'Company', alias: 'company', type: 'text', mappedField: 'company' },
      { label: 'Plan', alias: 'plan', type: 'select', options: ['Starter', 'Growth'] },
      { label: 'Topics', alias: 'topics', type: 'checkboxgrp', options: ['Product', 'Events'] },
    ],
  });
  assert.equal(created.description, 'Inbound inquiry');
  assert.equal(created.fields?.length, 4);
  assert.deepEqual(created.fields?.[1]?.options, ['Starter', 'Growth']);
  assert.deepEqual(created.fields?.[2]?.options, ['Product', 'Events']);

  const updated = await api.updateForm(30, { name: 'Demo inquiry v2', description: 'Updated' });
  assert.equal(updated.name, 'Demo inquiry v2');

  const submissions = await api.formSubmissions(30, 2);
  assert.equal(submissions.total, 26);
  assert.equal(submissions.page, 2);
  assert.deepEqual(submissions.items[0], {
    id: 901,
    formId: 30,
    contactId: 17,
    dateSubmitted: '2026-10-24T12:00:00.000Z',
    results: { email: 'ada@example.test', plan: 'Growth' },
  });

  await api.deleteForm(30);
});

test('supports multi-action workflows, form triggers, selective publish checks, contacts, and delete', async () => {
  const multiInput: WorkflowInput = {
    name: 'Form onboarding',
    segmentId: 0,
    formId: 22,
    steps: [
      { kind: 'email', emailId: 4, delayMinutes: 0 },
      { kind: 'tags', emailId: 0, delayMinutes: 0, condition: 'opened_previous', addTags: ['engaged'], removeTags: ['cold'] },
      { kind: 'points', emailId: 0, delayMinutes: 15, pointsDelta: 25 },
      { kind: 'segment', emailId: 0, delayMinutes: 0, addSegmentIds: [5], removeSegmentIds: [2] },
      { kind: 'stage', emailId: 0, delayMinutes: 0, stageId: 3 },
    ],
  };

  let saved: ReturnType<typeof persistCampaign>;
  const requestedPaths: string[] = [];
  const api = client(async request => {
    const path = new URL(request.url).pathname;
    requestedPaths.push(`${request.method} ${path}`);
    if (request.method === 'POST' && path === '/api/campaigns/new') {
      const payload = await request.json() as DraftPayload & { forms: { id: number }[] };
      assert.deepEqual(payload.lists, []);
      assert.deepEqual(payload.forms, [{ id: 22 }]);
      assert.equal(payload.canvasSettings.connections[0].sourceId, 'forms');
      assert.deepEqual(payload.events.map(e => e.type), [
        'email.send', 'email.open', 'lead.changetags', 'lead.changepoints', 'lead.changelist', 'stage.change',
      ]);
      assert.deepEqual(payload.events[2].properties, { add_tags: ['engaged'], remove_tags: ['cold'] });
      assert.deepEqual(payload.events[3].properties, { points: 25 });
      assert.deepEqual(payload.events[4].properties, { addToLists: [5], removeFromLists: [2] });
      assert.deepEqual(payload.events[5].properties, { stage: 3 });
      saved = persistCampaign(payload);
      return Response.json({ campaign: saved }, { status: 201 });
    }
    if (request.method === 'GET' && path === '/api/campaigns/27') {
      return Response.json({ campaign: saved });
    }
    if (request.method === 'PUT' && path === '/api/campaigns/27/edit') {
      const payload = await request.json() as DraftPayload;
      saved = persistCampaign(payload);
      return Response.json({ campaign: saved });
    }
    if (request.method === 'GET' && path === '/api/emails/4') {
      return Response.json({
        email: { id: 4, isPublished: true, emailType: 'template', sendToDnc: false, customHtml: '<a href="{unsubscribe_url}">Unsub</a>' },
      });
    }
    if (request.method === 'PATCH' && path === '/api/campaigns/27/edit') {
      const { isPublished } = await request.json() as { isPublished: boolean };
      saved = { ...saved, isPublished };
      return Response.json({ campaign: saved });
    }
    if (request.method === 'GET' && path === '/api/campaigns/27/contacts') {
      return Response.json({
        total: 2,
        contacts: [
          { lead_id: '17', date_added: '2026-10-24 12:00:00', manually_removed: '0' },
          { lead_id: '19', date_added: '2026-10-25 14:30:00', manually_removed: '1' },
        ],
      });
    }
    if (request.method === 'DELETE' && path === '/api/campaigns/27/delete') {
      return Response.json({ campaign: { id: 27 } });
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`);
  });

  // Condition after non-email step must fail before any network request
  await assert.rejects(() => api.createWorkflow({
    name: 'Invalid condition',
    segmentId: 3,
    steps: [
      { kind: 'tags', emailId: 0, delayMinutes: 0, addTags: ['a'] },
      { kind: 'points', emailId: 0, delayMinutes: 0, condition: 'opened_previous', pointsDelta: 5 },
    ],
  }), { name: 'UpstreamError', status: 400 });

  const created = await api.createWorkflow(multiInput);
  assert.equal(created.segmentId, 0);
  assert.equal(created.formId, 22);
  assert.equal(created.editable, true);
  assert.equal(created.steps.length, 5);
  assert.deepEqual(created.steps[1], {
    kind: 'tags', emailId: 0, delayMinutes: 0, condition: 'opened_previous', addTags: ['engaged'], removeTags: ['cold'],
  });
  assert.deepEqual(created.steps[2], { kind: 'points', emailId: 0, delayMinutes: 15, pointsDelta: 25 });
  assert.deepEqual(created.steps[3], { kind: 'segment', emailId: 0, delayMinutes: 0, addSegmentIds: [5], removeSegmentIds: [2] });
  assert.deepEqual(created.steps[4], { kind: 'stage', emailId: 0, delayMinutes: 0, stageId: 3 });

  // Update draft workflow replacing a step
  const updated = await api.updateWorkflow(27, {
    ...multiInput,
    steps: [
      { kind: 'email', emailId: 4, delayMinutes: 0 },
      { kind: 'points', emailId: 0, delayMinutes: 30, pointsDelta: 50 },
    ],
  });
  assert.equal(updated.steps.length, 2);
  assert.deepEqual(updated.steps[1], { kind: 'points', emailId: 0, delayMinutes: 30, pointsDelta: 50 });

  const enabled = await api.setWorkflowEnabled(27, true);
  assert.equal(enabled.enabled, true);
  assert.ok(!requestedPaths.some(entry => entry.includes('/api/segments/')));
  assert.ok(requestedPaths.includes('GET /api/emails/4'));

  const members = await api.workflowContacts(27);
  assert.deepEqual(members, [
    { contactId: 17, dateAdded: '2026-10-24T12:00:00.000Z', manuallyRemoved: false },
    { contactId: 19, dateAdded: '2026-10-25T14:30:00.000Z', manuallyRemoved: true },
  ]);

  await api.deleteWorkflow(27);
});

test('manages assets, landing pages, and webhooks CRUD', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (url.pathname === '/api/assets') {
      return Response.json({
        total: 1,
        assets: [{
          id: 1, title: 'Playbook PDF', alias: 'playbook', description: 'Guide',
          storageLocation: 'remote', remotePath: 'https://cdn.example.test/playbook.pdf',
          downloadCount: 40, uniqueDownloadCount: 31, isPublished: true, downloadUrl: 'https://mautic.test/asset/1:playbook',
        }],
      });
    }
    if (url.pathname === '/api/assets/new') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.storageLocation, 'remote');
      assert.equal(body.file, 'https://cdn.example.test/guide.pdf');
      return Response.json({ asset: { id: 2, alias: 'guide', downloadCount: 0, uniqueDownloadCount: 0, remotePath: body.file, ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/assets/2/edit') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ asset: { id: 2, title: 'Guide v2', alias: 'guide', description: '', storageLocation: 'remote', remotePath: 'https://cdn.example.test/guide.pdf', downloadCount: 0, uniqueDownloadCount: 0, isPublished: true, ...body } });
    }
    if (url.pathname === '/api/assets/2/delete') return Response.json({ asset: { id: 2 } });

    if (url.pathname === '/api/pages') {
      return Response.json({
        total: 1,
        pages: [{ id: 1, title: 'Launch', alias: 'launch', metaDescription: 'Product launch', customHtml: '<h1>Launch</h1>', hits: 100, uniqueHits: 80, isPublished: true }],
      });
    }
    if (url.pathname === '/api/pages/new') {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.template, 'blank');
      return Response.json({ page: { id: 2, alias: 'webinar', hits: 0, uniqueHits: 0, ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/pages/2/edit') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ page: { id: 2, title: 'Webinar v2', alias: 'webinar', metaDescription: '', customHtml: '<h1>Hi</h1>', hits: 0, uniqueHits: 0, isPublished: true, ...body } });
    }
    if (url.pathname === '/api/pages/2/delete') return Response.json({ page: { id: 2 } });

    if (url.pathname === '/api/hooks') {
      return Response.json({
        total: 1,
        hooks: [{ id: 1, name: 'CRM sync', description: '', webhookUrl: 'https://hooks.example.test/crm', triggers: ['mautic.lead_post_save_new'], isPublished: true }],
      });
    }
    if (url.pathname === '/api/hooks/triggers') {
      return Response.json({ triggers: { 'mautic.lead_post_save_new': { label: 'Contact Identified' } } });
    }
    if (url.pathname === '/api/hooks/new') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ hook: { id: 2, ...body } }, { status: 201 });
    }
    if (url.pathname === '/api/hooks/2/edit') {
      const body = await request.json() as Record<string, unknown>;
      return Response.json({ hook: { id: 2, name: 'Slack notify', description: '', webhookUrl: 'https://hooks.example.test/slack', triggers: ['mautic.form_on_submit'], isPublished: false, ...body } });
    }
    if (url.pathname === '/api/hooks/2/delete') return Response.json({ hook: { id: 2 } });
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  await assert.rejects(() => api.createAsset({ title: 'Bad', remotePath: 'javascript:alert(1)' }), { name: 'UpstreamError', status: 400 });
  assert.equal((await api.assets())[0].downloadCount, 40);
  const asset = await api.createAsset({ title: 'Guide', remotePath: 'https://cdn.example.test/guide.pdf' });
  assert.equal(asset.storageLocation, 'remote');
  assert.equal((await api.updateAsset(2, { title: 'Guide v2' })).title, 'Guide v2');
  await api.deleteAsset(2);

  assert.equal((await api.pages())[0].uniqueHits, 80);
  const page = await api.createPage({ title: 'Webinar', alias: 'webinar', customHtml: '<h1>Register</h1>' });
  assert.equal(page.alias, 'webinar');
  assert.equal((await api.updatePage(2, { title: 'Webinar v2' })).title, 'Webinar v2');
  await api.deletePage(2);

  await assert.rejects(() => api.createWebhook({ name: 'Bad', webhookUrl: 'https://hooks.example.test/a', triggers: [] }), { name: 'UpstreamError', status: 400 });
  assert.equal((await api.webhooks())[0].triggers[0], 'mautic.lead_post_save_new');
  assert.ok('mautic.lead_post_save_new' in await api.webhookTriggers());
  const hook = await api.createWebhook({ name: 'Slack notify', webhookUrl: 'https://hooks.example.test/slack', triggers: ['mautic.form_on_submit'] });
  assert.equal(hook.id, 2);
  assert.equal((await api.updateWebhook(2, { published: false })).published, false);
  await api.deleteWebhook(2);
});

test('manages contact and company custom fields CRUD and option list normalization', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/fields/contact') {
      assert.equal(url.searchParams.get('limit'), '100');
      return Response.json({
        fields: {
          11: {
            id: 11, label: 'Plan Tier', alias: 'plan_tier', type: 'select', group: 'core',
            object: 'lead', defaultValue: 'Starter', isRequired: true, isPubliclyUpdatable: true,
            isFixed: false, isPublished: true,
            properties: { list: [{ label: 'Starter', value: 'starter' }, { label: 'Growth', value: 'growth' }] },
          },
          12: {
            id: 12, label: 'Account Region', alias: 'account_region', type: 'select', group: 'core',
            object: 'lead', defaultValue: null, isRequired: false, isPubliclyUpdatable: false,
            isFixed: true, isPublished: true,
            properties: { list: ['NA', 'EMEA', 'APAC'] },
          },
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/fields/company') {
      assert.equal(url.searchParams.get('limit'), '100');
      return Response.json({
        fields: [{
          id: 21, label: 'ARR Band', alias: 'arr_band', type: 'text', group: 'professional',
          object: 'company', defaultValue: '', isRequired: false, isPubliclyUpdatable: false,
          isFixed: false, isPublished: true, properties: [],
        }],
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/fields/contact/new') {
      const body = await request.json() as Record<string, unknown>;
      assert.deepEqual(body, {
        label: 'Lifecycle Track',
        alias: 'lifecycle_track',
        type: 'select',
        group: 'core',
        defaultValue: 'PLG',
        isRequired: true,
        isPubliclyUpdatable: true,
        isPublished: true,
        properties: { list: [{ label: 'PLG', value: 'PLG' }, { label: 'Sales', value: 'Sales' }] },
      });
      return Response.json({
        field: { id: 13, object: 'lead', isFixed: false, ...body },
      }, { status: 201 });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/fields/company/21/edit') {
      const body = await request.json() as Record<string, unknown>;
      assert.deepEqual(body, { label: 'Annual Revenue Band', isRequired: true, isPublished: false });
      return Response.json({
        field: {
          id: 21, label: 'Annual Revenue Band', alias: 'arr_band', type: 'text', group: 'professional',
          object: 'company', defaultValue: '', isRequired: true, isPubliclyUpdatable: false,
          isFixed: false, isPublished: false, properties: {},
        },
      });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/fields/contact/13/delete') {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const contactFields = await api.fields();
  assert.equal(contactFields.length, 2);
  assert.deepEqual(contactFields[0], {
    id: 12, label: 'Account Region', alias: 'account_region', type: 'select', group: 'core',
    object: 'contact', defaultValue: '', isRequired: false, isPubliclyUpdatable: false,
    isFixed: true, published: true, options: ['NA', 'EMEA', 'APAC'],
  });
  assert.deepEqual(contactFields[1].options, ['Starter', 'Growth']);
  assert.equal(contactFields[1].object, 'contact');
  assert.equal(contactFields[1].defaultValue, 'Starter');

  const companyFields = await api.fields('company');
  assert.equal(companyFields[0].object, 'company');
  assert.deepEqual(companyFields[0].options, []);

  const created = await api.createField('contact', {
    label: 'Lifecycle Track', alias: 'lifecycle_track', type: 'select',
    defaultValue: 'PLG', isRequired: true, isPubliclyUpdatable: true, options: ['PLG', 'Sales'],
  });
  assert.equal(created.id, 13);
  assert.deepEqual(created.options, ['PLG', 'Sales']);

  const updated = await api.updateField('company', 21, { label: 'Annual Revenue Band', isRequired: true, published: false });
  assert.equal(updated.label, 'Annual Revenue Band');
  assert.equal(updated.isRequired, true);
  assert.equal(updated.published, false);

  await api.deleteField('contact', 13);
});

test('manages categories CRUD with client-side bundle filter and hex color normalization', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/categories') {
      assert.equal(url.searchParams.get('limit'), '100');
      return Response.json({
        categories: {
          1: { id: 1, title: 'Onboarding', alias: 'onboarding', description: 'Welcome flows', color: '2457d6', bundle: 'email', isPublished: true },
          2: { id: 2, title: 'Events', alias: 'events', description: '', color: '#0ea5e9', bundle: 'campaign', isPublished: true },
          3: { id: 3, title: 'Legacy', alias: 'legacy', description: '', color: 'invalid', bundle: 'email', isPublished: false },
        },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/categories/new') {
      const body = await request.json() as Record<string, unknown>;
      if (body.title === 'Default Color') {
        assert.equal(body.color, '2457d6');
        return Response.json({ category: { id: 4, alias: 'default-color', ...body } }, { status: 201 });
      }
      assert.equal(body.color, 'ff5500');
      return Response.json({ category: { id: 5, alias: 'promos', ...body } }, { status: 201 });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/categories/5/edit') {
      const body = await request.json() as Record<string, unknown>;
      assert.deepEqual(body, { title: 'Seasonal Promos', color: '10b981', isPublished: false });
      return Response.json({
        category: { id: 5, title: 'Seasonal Promos', alias: 'promos', description: '', color: '10b981', bundle: 'email', isPublished: false },
      });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/categories/5/delete') {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const all = await api.categories();
  assert.deepEqual(all.map(c => [c.title, c.color]), [
    ['Events', '#0ea5e9'],
    ['Legacy', ''],
    ['Onboarding', '#2457d6'],
  ]);

  const emailOnly = await api.categories('email');
  assert.deepEqual(emailOnly.map(c => c.title), ['Legacy', 'Onboarding']);

  const defaultCat = await api.createCategory({ title: 'Default Color', bundle: 'global' });
  assert.equal(defaultCat.color, '#2457d6');

  const customCat = await api.createCategory({ title: 'Promos', bundle: 'email', color: '#ff5500' });
  assert.equal(customCat.color, '#ff5500');

  const updated = await api.updateCategory(5, { title: 'Seasonal Promos', color: '#10b981', published: false });
  assert.equal(updated.color, '#10b981');
  assert.equal(updated.published, false);

  await api.deleteCategory(5);
});

test('manages dynamic web content CRUD', async () => {
  const api = client(async request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/dynamiccontents') {
      assert.equal(url.searchParams.get('limit'), '100');
      return Response.json({
        dynamicContents: {
          2: {
            id: 2, name: 'VIP Banner', slotName: 'hero_slot', content: '<p>Welcome back!</p>',
            isCampaignBased: true, isPublished: true, sentCount: 42, dateAdded: '2026-10-20 08:30:00',
          },
        },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/dynamiccontents/new') {
      const body = await request.json() as Record<string, unknown>;
      assert.deepEqual(body, {
        name: 'Pricing CTA',
        slotName: 'pricing_banner',
        content: '<div>Save 20%</div>',
        isCampaignBased: true,
        isPublished: true,
      });
      return Response.json({
        dynamicContent: { id: 3, sentCount: 0, dateAdded: '2026-10-24T10:00:00+00:00', ...body },
      }, { status: 201 });
    }
    if (request.method === 'PATCH' && url.pathname === '/api/dynamiccontents/3/edit') {
      const body = await request.json() as Record<string, unknown>;
      assert.deepEqual(body, { content: '<div>Save 30%</div>', isCampaignBased: false, isPublished: false });
      return Response.json({
        dynamicContent: {
          id: 3, name: 'Pricing CTA', slotName: 'pricing_banner', content: '<div>Save 30%</div>',
          isCampaignBased: false, isPublished: false, sentCount: 5, dateAdded: '2026-10-24T10:00:00+00:00',
        },
      });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/dynamiccontents/3/delete') {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const list = await api.dynamicContents();
  assert.deepEqual(list, [{
    id: 2, name: 'VIP Banner', slotName: 'hero_slot', content: '<p>Welcome back!</p>',
    isCampaignBased: true, published: true, sentCount: 42, dateAdded: '2026-10-20T08:30:00.000Z',
  }]);

  const created = await api.createDynamicContent({
    name: 'Pricing CTA', slotName: 'pricing_banner', content: '<div>Save 20%</div>',
  });
  assert.equal(created.id, 3);
  assert.equal(created.isCampaignBased, true);

  const updated = await api.updateDynamicContent(3, { content: '<div>Save 30%</div>', isCampaignBased: false, published: false });
  assert.equal(updated.content, '<div>Save 30%</div>');
  assert.equal(updated.isCampaignBased, false);
  assert.equal(updated.published, false);

  await api.deleteDynamicContent(3);
});

test('manages focus items CRUD with bar/modal payloads and appOrigin embedScript', async () => {
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://app.ovelio.test/';
  try {
    const api = client(async request => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/api/focus') {
        assert.equal(url.searchParams.get('limit'), '100');
        return Response.json({
          focus: {
            7: {
              id: 7, name: 'Announcement Bar', description: 'Top notice', type: 'link', style: 'bar',
              isPublished: true, form: null,
              properties: {
                when: 'scroll_slight',
                content: { headline: 'New release', tagline: 'Try v2', link_text: 'Read more', link_url: 'https://ovelio.test/v2' },
                colors: { primary: '2457d6', text: '111827', button: '0ea5e9', button_text: 'ffffff' },
              },
            },
          },
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/focus/new') {
        const body = await request.json() as {
          name: string; type: string; style: string; htmlMode: string; form?: number;
          properties: Record<string, unknown>;
        };
        assert.equal(body.htmlMode, 'basic');
        if (body.style === 'bar') {
          assert.equal(body.form, undefined);
          assert.deepEqual(body.properties.bar, {
            allow_hide: 1, push_page: 1, sticky: 1, size: 'large', placement: 'top',
          });
          assert.deepEqual(body.properties.colors, {
            primary: '1d4ed8', text: '111827', button: '2457d6', button_text: 'ffffff',
          });
          return Response.json({ focus: { id: 8, ...body } }, { status: 201 });
        }
        assert.equal(body.type, 'form');
        assert.equal(body.form, 22);
        assert.deepEqual(body.properties.modal, { placement: 'top_right' });
        return Response.json({ focus: { id: 9, ...body } }, { status: 201 });
      }
      if (request.method === 'PATCH' && url.pathname === '/api/focus/9/edit') {
        const body = await request.json() as Record<string, unknown>;
        assert.deepEqual(body, {
          isPublished: false,
          properties: {
            when: 'leave',
            content: { headline: 'Before you go' },
            colors: { primary: '000000' },
          },
        });
        return Response.json({
          focus: {
            id: 9, name: 'Lead Popup', description: '', type: 'form', style: 'modal',
            form: { id: 22 }, isPublished: false,
            properties: {
              when: 'leave',
              content: { headline: 'Before you go', tagline: '', link_text: '', link_url: '' },
              colors: { primary: '000000', text: '111827', button: '2457d6', button_text: 'ffffff' },
            },
          },
        });
      }
      if (request.method === 'DELETE' && url.pathname === '/api/focus/9/delete') {
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    });

    const items = await api.focusItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].primaryColor, '#2457d6');
    assert.equal(items[0].buttonColor, '#0ea5e9');
    assert.equal(items[0].when, 'scroll_slight');
    assert.equal(
      items[0].embedScript,
      '<script src="https://app.ovelio.test/focus/7.js" type="text/javascript" charset="utf-8" async="async"></script>',
    );

    const bar = await api.createFocusItem({
      name: 'Launch Bar', type: 'notice', style: 'bar', primaryColor: '#1d4ed8',
    });
    assert.equal(bar.id, 8);
    assert.equal(bar.headline, 'Launch Bar');
    assert.equal(bar.primaryColor, '#1d4ed8');

    const modal = await api.createFocusItem({
      name: 'Lead Popup', type: 'form', style: 'modal', formId: 22, when: 'scroll_middle',
    });
    assert.equal(modal.id, 9);
    assert.equal(modal.formId, 22);
    assert.equal(
      modal.embedScript,
      '<script src="https://app.ovelio.test/focus/9.js" type="text/javascript" charset="utf-8" async="async"></script>',
    );

    const updated = await api.updateFocusItem(9, {
      published: false, when: 'leave', headline: 'Before you go', primaryColor: '#000000',
    });
    assert.equal(updated.published, false);
    assert.equal(updated.headline, 'Before you go');
    assert.equal(updated.primaryColor, '#000000');
    assert.equal(updated.formId, 22);

    await api.deleteFocusItem(9);
  } finally {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  }
});

test('fetches marketing reports list and normalizes report rows with metadata and fallback', async () => {
  const api = client(request => {
    const url = new URL(request.url);
    if (url.pathname === '/api/reports') {
      assert.equal(url.searchParams.get('limit'), '100');
      return Response.json({
        reports: {
          1: { id: 1, name: 'Email Performance', description: 'Opens and sends', source: 'emails', columns: ['e.id', 'e.name', 'e.sent_count'], system: true },
          2: { id: 2, name: 'Active Contacts', description: '', source: 'leads', columns: { 0: 'l.email', 1: 'l.points' }, system: false },
        },
      });
    }
    if (url.pathname === '/api/reports/1') {
      assert.equal(url.searchParams.get('limit'), '25');
      return Response.json({
        totalResults: '2',
        data: [
          { id: 10, name: 'Welcome', sent_count: 120, notes: null },
          { id: 11, name: 'Newsletter', sent_count: 85, notes: 'Q4' },
        ],
      });
    }
    if (url.pathname === '/api/reports/99') {
      assert.equal(url.searchParams.get('limit'), '50');
      return Response.json({
        totalResults: 1,
        data: [{ email: 'ada@example.test', verified: true }],
      });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const list = await api.reports();
  assert.deepEqual(list.map(r => [r.id, r.name, r.system]), [
    [2, 'Active Contacts', false],
    [1, 'Email Performance', true],
  ]);
  assert.deepEqual(list[0].columns, ['l.email', 'l.points']);

  const data = await api.report(1, 25);
  assert.equal(data.report.name, 'Email Performance');
  assert.equal(data.report.system, true);
  assert.equal(data.totalResults, 2);
  assert.deepEqual(data.columns, ['id', 'name', 'sent_count', 'notes']);
  assert.deepEqual(data.rows[0], { id: 10, name: 'Welcome', sent_count: 120, notes: null });

  const fallback = await api.report(99);
  assert.deepEqual(fallback.report, {
    id: 99, name: 'Report #99', description: '', source: '', columns: ['email', 'verified'], system: false,
  });
  assert.deepEqual(fallback.rows, [{ email: 'ada@example.test', verified: 'true' }]);

  await assert.rejects(() => api.report(1, 0), { name: 'UpstreamError', status: 400 });
});

test('reads contact linked companies, contact devices, and sends direct email to contact', async () => {
  let failSend = false;
  const api = client(request => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/contacts/17/companies') {
      return Response.json({
        companies: [
          { id: '12', companyname: 'Beta LLC', is_primary: '0' },
          { id: '10', companyname: 'Acme Corp', is_primary: '1' },
        ],
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/contacts/17/devices') {
      return Response.json({
        devices: {
          1: { id: 1, device: 'desktop', deviceOsName: 'Mac', deviceOsVersion: '14.5', deviceBrand: 'Apple', dateAdded: '2026-10-20 09:00:00' },
          2: { id: 2, device: 'smartphone', deviceOsName: 'iOS', deviceOsVersion: '', deviceBrand: 'Apple', dateAdded: '2026-10-24T15:30:00+00:00' },
        },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/emails/4/contact/17/send') {
      return Response.json({ success: !failSend });
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  });

  const companies = await api.contactCompanies(17);
  assert.deepEqual(companies, [
    { id: 10, name: 'Acme Corp', isPrimary: true },
    { id: 12, name: 'Beta LLC', isPrimary: false },
  ]);

  const devices = await api.contactDevices(17);
  assert.deepEqual(devices, [
    { id: 2, device: 'smartphone', os: 'iOS', brand: 'Apple', dateAdded: '2026-10-24T15:30:00.000Z' },
    { id: 1, device: 'desktop', os: 'Mac 14.5', brand: 'Apple', dateAdded: '2026-10-20T09:00:00.000Z' },
  ]);

  await api.sendEmailToContact(4, 17);
  failSend = true;
  await assert.rejects(() => api.sendEmailToContact(4, 17), { name: 'UpstreamError', status: 502 });
});
