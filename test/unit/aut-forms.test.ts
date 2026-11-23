import assert from 'node:assert/strict';
import test from 'node:test';
import { formActionSpecs, formActionTypes, formFieldSpecs, formFieldTypes } from '../../src/contracts';
import { createMautic } from '../../src/server/mautic';
import { buildActionProperties, buildFormActions, buildFormFields } from '../../src/server/mautic/form-builder';
import { UpstreamError } from '../../src/server/upstream';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function client(handler: (request: Request, url: URL, body: Body | undefined) => Response | Promise<Response>) {
  return createMautic({
    url: 'http://marketing-engine.local/',
    username: 'integration',
    password: 'unit-test-password',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text();
      return handler(request, new URL(request.url), text ? JSON.parse(text) : undefined);
    },
  });
}

const stored = {
  id: 30, name: 'Stored form', isPublished: true, formType: 'standalone', postAction: 'redirect', postActionProperty: 'https://example.test/thanks',
  fields: [
    { id: 11, label: 'Email', alias: 'email', type: 'email', mappedObject: 'contact', mappedField: 'email', isRequired: true, properties: { placeholder: 'you@example.test' } },
    { id: 12, label: 'Plan', alias: 'plan', type: 'select', properties: { list: { list: [{ label: 'Starter', value: 's1' }, { label: 'Growth', value: 'g2' }] } } },
    { id: 13, label: 'Old', alias: 'old', type: 'text' },
    { id: 14, label: 'Go', alias: 'go', type: 'button' },
  ],
  actions: [
    { id: 71, name: 'Tag', type: 'lead.changetags', order: 1, properties: { add_tags: ['lead'], remove_tags: [] } },
    { id: 72, name: 'Old action', type: 'lead.addutmtags', order: 2, properties: [] },
  ],
};

test('AUT-07 every Mautic field type is described with its properties', () => {
  assert.equal(formFieldTypes.length, 23);
  assert.deepEqual(formFieldSpecs.map(spec => spec.type).sort(), [...formFieldTypes].sort());
  const rating = formFieldSpecs.find(spec => spec.type === 'rating');
  assert.deepEqual(rating?.props.map(prop => prop.key), ['star_count', 'symbol', 'star_color', 'base_color']);
});

test('AUT-07 new field types are sent with the properties Mautic stores', () => {
  const { fields } = buildFormFields([
    { label: 'Email', alias: 'email', type: 'email', mappedField: 'email', isRequired: true, properties: { placeholder: 'a@b.test' }, validation: { blockfreeemail: true } },
    { label: 'Choice', alias: 'choice', type: 'radiogrp', options: ['A', 'B'], helpMessage: 'Pick one' },
    { label: 'Rate', alias: 'rate', type: 'rating', properties: { star_count: '7', symbol: '*' } },
    { label: 'Files', alias: 'files', type: 'file', properties: { allowed_file_extensions: 'pdf, .png', allowed_file_size: '4', public: true } },
    { label: 'Count', alias: 'count', type: 'checkboxgrp', options: ['x'], validation: { minimum: '1' } },
    { label: 'Quiz', alias: 'quiz', type: 'captcha', isRequired: true, defaultValue: 'x', properties: { captcha: '4' } },
    { label: 'Intro', alias: 'intro', type: 'freetext', properties: { text: '<p>Hello</p>' }, mappedField: 'city' },
    { label: 'Hidden', alias: 'src', type: 'hidden', defaultValue: 'ad' },
  ]);
  const by = Object.fromEntries(fields.map(field => [field.alias, field]));
  assert.deepEqual(by.choice.properties, { optionlist: { list: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }] } });
  assert.equal(by.choice.helpMessage, 'Pick one');
  assert.deepEqual(by.rate.properties, { star_count: 7, symbol: '*' });
  assert.deepEqual(by.files.properties, { allowed_file_extensions: ['pdf', 'png'], allowed_file_size: 4, public: true });
  assert.deepEqual(by.count.validation, { minimum: 1 });
  assert.deepEqual(by.email.properties, { placeholder: 'a@b.test' });
  assert.deepEqual(by.email.validation, { blockfreeemail: true });
  assert.equal(by.quiz.isRequired, undefined);
  assert.equal(by.quiz.defaultValue, undefined);
  assert.equal(by.intro.mappedField, undefined);
  assert.equal(by.src.defaultValue, 'ad');
  assert.equal(fields.at(-1)?.type, 'button');
  assert.deepEqual(fields.map(field => field.order), fields.map((_, index) => index + 1));
});

test('AUT-07 invalid fields are rejected', () => {
  assert.throws(() => buildFormFields([{ label: 'X', alias: 'x', type: 'wizard' }]), UpstreamError);
  assert.throws(() => buildFormFields([{ label: 'Pick', alias: 'pick', type: 'select' }]), UpstreamError);
  assert.throws(() => buildFormFields([{ label: 'A', alias: 'a', type: 'text' }, { label: 'B', alias: 'a', type: 'text' }]), UpstreamError);
});

test('AUT-07 editing a form keeps field ids, choice values and the submit button, and removes dropped fields', async () => {
  const calls: string[] = [];
  const api = client(async (request, url, body) => {
    calls.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/stats/form_submissions') return Response.json({ total: '0', stats: [] });
    if (request.method === 'GET') return Response.json({ form: stored });
    if (request.method === 'PATCH') {
      const fields = body?.fields as Body[];
      assert.deepEqual(fields.map(field => [field.id, field.alias, field.type]), [[11, 'email', 'email'], [12, 'plan', 'select'], [undefined, 'phone', 'tel'], [14, 'go', 'button']]);
      assert.deepEqual(fields[1].properties.list.list, [{ label: 'Starter', value: 's1' }, { label: 'Pro', value: 'Pro' }, { label: 'Growth', value: 'g2' }]);
      assert.equal(body?.postAction, 'redirect');
      assert.equal(body?.postActionProperty, 'https://example.test/thanks');
      return Response.json({ form: { ...stored, fields: fields.map((field, index) => ({ ...field, id: field.id ?? 20 + index })) } });
    }
    return Response.json({ form: stored });
  });
  const form = await api.updateForm(30, { fields: [
    { id: 11, label: 'Email', alias: 'email', type: 'email', mappedField: 'email', isRequired: true },
    { id: 12, label: 'Plan', alias: 'plan', type: 'select', options: ['Starter', 'Pro', 'Growth'] },
    { label: 'Phone', alias: 'phone', type: 'tel' },
  ] });
  assert.deepEqual(form.fields?.map(field => field.alias), ['email', 'plan', 'phone']);
  assert.ok(calls.includes('DELETE /api/forms/30/fields/delete?fields[]=13'));
  assert.equal(calls.filter(call => call.startsWith('DELETE')).length, 1);
});

test('AUT-07 existing forms with unknown plugin field types survive a save', () => {
  const { fields, remove } = buildFormFields(
    [{ id: 5, label: 'Widget', alias: 'widget', type: 'plugin_widget', properties: { custom: 1 } }, { label: 'Email', alias: 'email', type: 'email', mappedField: 'email' }],
    [{ id: 5, label: 'Widget', alias: 'widget', type: 'plugin_widget' }, { id: 6, label: 'Email', alias: 'email', type: 'email', mappedField: 'email' }], false,
  );
  assert.equal(fields[0].id, 5);
  assert.deepEqual(fields[0].properties, { custom: 1 });
  assert.equal(fields[1].id, 6);
  assert.deepEqual(remove, []);
});

test('AUT-08 all thirteen Mautic submit actions are described', () => {
  assert.equal(formActionTypes.length, 13);
  assert.deepEqual(formActionSpecs.map(spec => spec.type).sort(), [...formActionTypes].sort());
});

test('AUT-08 submit actions are sent with their properties', async () => {
  let sent: Body | undefined;
  const api = client(async (request, url, body) => {
    if (url.pathname === '/api/stats/form_submissions') return Response.json({ total: '0', stats: [] });
    sent = body;
    return Response.json({ form: { ...body, id: 40, fields: (body?.fields as Body[]).map((field, index) => ({ ...field, id: index + 1 })),
      actions: (body?.actions as Body[]).map((action, index) => ({ ...action, id: 100 + index })) } }, { status: 201 });
  });
  const form = await api.createForm({ name: 'With actions', actions: [
    { type: 'form.email', name: '', properties: { to: 'team@example.test, {formfield=email}', subject: 'New lead', message: 'Hi', copy_lead: true } },
    { type: 'form.repost', name: 'CRM', properties: { post_url: 'https://hooks.example.test/in', authorization_header: 'Bearer x' } },
    { type: 'email.send.user', name: '', properties: { useremail: { email: '4' }, user_id: ['2', '3'] } },
    { type: 'email.send.lead', name: '', properties: { email: '5' } },
    { type: 'lead.pointschange', name: '', properties: { operator: 'plus', points: '10' } },
    { type: 'lead.changelist', name: '', properties: { addToLists: ['1'] } },
    { type: 'lead.changetags', name: '', properties: { add_tags: ['hot', ' hot '] } },
    { type: 'lead.addutmtags', name: '', properties: {} },
    { type: 'lead.remove_do_not_contact', name: '', properties: {} },
    { type: 'lead.scorecontactscompanies', name: '', properties: { score: 3 } },
    { type: 'lead.updatelead', name: '', properties: { city: 'Austin', empty: '' } },
    { type: 'asset.download', name: '', properties: { asset: '9', message: 'Thanks' } },
  ] });
  const actions = sent?.actions as Body[];
  assert.deepEqual(actions.map(action => action.order), actions.map((_, index) => index + 1));
  assert.equal(actions[0].name, 'Email the submission to people');
  assert.deepEqual(actions[0].properties, { to: 'team@example.test, {formfield=email}', subject: 'New lead', message: 'Hi', copy_lead: true, set_replyto: true, email_to_owner: false, immediately: false });
  assert.deepEqual(actions[1].properties, { post_url: 'https://hooks.example.test/in', authorization_header: 'Bearer x' });
  assert.deepEqual(actions[2].properties, { useremail: { email: 4 }, user_id: [2, 3] });
  assert.deepEqual(actions[3].properties, { email: 5 });
  assert.deepEqual(actions[4].properties, { operator: 'plus', points: 10 });
  assert.deepEqual(actions[5].properties, { addToLists: [1], removeFromLists: [] });
  assert.deepEqual(actions[6].properties, { add_tags: ['hot'], remove_tags: [] });
  assert.deepEqual(actions[9].properties, { score: 3 });
  assert.deepEqual(actions[10].properties, { city: 'Austin' });
  assert.deepEqual(actions[11].properties, { asset: 9, message: 'Thanks' });
  assert.equal(form.actions?.length, 12);
  assert.equal(form.actions?.[0].id, 100);
});

test('AUT-08 actions are validated', () => {
  assert.throws(() => buildActionProperties('form.email', { subject: 'x' }), UpstreamError);
  assert.throws(() => buildActionProperties('form.email', { to: 'not an address' }), UpstreamError);
  assert.throws(() => buildActionProperties('form.repost', { post_url: 'ftp://x.test' }), UpstreamError);
  assert.throws(() => buildActionProperties('lead.pointschange', { operator: 'power', points: 1 }), UpstreamError);
  assert.throws(() => buildActionProperties('lead.changelist', {}), UpstreamError);
  assert.throws(() => buildFormActions([{ type: 'made.up', name: '', properties: {} }]), UpstreamError);
});

test('AUT-08 existing actions are read back, keep their ids on edit and removed ones are deleted', async () => {
  const calls: string[] = [];
  const api = client(async (request, url, body) => {
    calls.push(`${request.method} ${url.pathname}${url.search}`);
    if (url.pathname === '/api/stats/form_submissions') return Response.json({ total: '0', stats: [] });
    if (request.method === 'GET') return Response.json({ form: stored });
    if (request.method === 'PATCH') {
      assert.equal(body?.fields, undefined);
      assert.deepEqual((body?.actions as Body[]).map(action => [action.id, action.type, action.order]), [[71, 'lead.changetags', 1], [undefined, 'lead.changelist', 2]]);
      return Response.json({ form: { ...stored, actions: [stored.actions[0], { id: 73, name: 'Seg', type: 'lead.changelist', order: 2, properties: { addToLists: [3], removeFromLists: [] } }, stored.actions[1]] } });
    }
    return Response.json({ form: stored });
  });
  const form = await api.updateForm(30, { actions: [
    { id: 71, type: 'lead.changetags', name: 'Tag', properties: { add_tags: ['lead', 'vip'] } },
    { type: 'lead.changelist', name: 'Seg', properties: { addToLists: [3] } },
  ] });
  assert.deepEqual(form.actions?.map(action => [action.id, action.type]), [[71, 'lead.changetags'], [73, 'lead.changelist']]);
  assert.ok(calls.includes('DELETE /api/forms/30/actions/delete?actions[]=72'));
});

test('AUT-08 an edit resends the post-submit action so Mautic does not reset it', async () => {
  const bodies: Body[] = [];
  const api = client(async (request, url, body) => {
    if (url.pathname === '/api/stats/form_submissions') return Response.json({ total: '0', stats: [] });
    if (request.method === 'PATCH') { bodies.push(body as Body); return Response.json({ form: stored }); }
    return Response.json({ form: { ...stored, postAction: 'message', postActionProperty: 'Thanks &amp; welcome' } });
  });
  await api.updateForm(30, { name: 'Renamed' });
  assert.equal(bodies[0].postAction, 'message');
  assert.equal(bodies[0].postActionProperty, 'Thanks &amp; welcome');
  await api.updateForm(30, { postAction: 'redirect', redirectUrl: 'https://example.test/done' });
  assert.deepEqual([bodies[1].postAction, bodies[1].postActionProperty], ['redirect', 'https://example.test/done']);
  await assert.rejects(() => api.updateForm(30, { postAction: 'redirect', redirectUrl: 'javascript:alert(1)' }), UpstreamError);
});
