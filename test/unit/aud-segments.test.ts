import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptySegmentRule, formatSegmentOffset, parseSegmentDate, resolveSegmentField, segmentFieldCatalogue,
  segmentFilterFromRule, segmentOperatorKeys, segmentOperatorsFor, segmentRuleFromFilter, segmentValueMode,
  staticSegmentFields,
} from '../../src/contracts';
import type { CustomField, SegmentFilter, SegmentFilterField } from '../../src/contracts';
import { createMautic } from '../../src/server/mautic';

type Seen = { method: string; path: string; search: string; body: Record<string, unknown> | null };

function client(handler: (seen: Seen) => unknown) {
  const calls: Seen[] = [];
  const api = createMautic({
    url: 'http://marketing-engine.local/',
    username: 'integration',
    password: 'unit-test-password',
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const body = await request.text();
      const seen: Seen = { method: request.method, path: url.pathname, search: url.search, body: body.startsWith('{') ? JSON.parse(body) : null };
      calls.push(seen);
      return Response.json(handler(seen));
    },
  });
  return { api, calls };
}

function definition(alias: string, type: string, object: 'contact' | 'company', options: string[] = []): CustomField {
  return {
    id: 1, label: alias, alias, type, group: 'core', object, defaultValue: '', isRequired: false,
    isPubliclyUpdatable: false, isFixed: false, published: true, options,
  };
}

const catalogue = segmentFieldCatalogue({
  contactFields: [
    definition('email', 'email', 'contact'),
    definition('plan', 'select', 'contact', ['free', 'pro']),
    definition('interests', 'multiselect', 'contact', ['a', 'b']),
    definition('score', 'number', 'contact'),
    definition('renewal', 'date', 'contact'),
    definition('vip', 'boolean', 'contact'),
    definition('notes', 'textarea', 'contact'),
    { ...definition('hidden', 'text', 'contact'), published: false },
  ],
  companyFields: [definition('companyname', 'text', 'company'), definition('companycity', 'text', 'company')],
  pointGroups: [{ id: 4, name: 'Engagement' }],
});

const field = (id: string): SegmentFilterField => {
  const found = catalogue.find(entry => entry.id === id);
  assert.ok(found, `field ${id} is in the catalogue`);
  return found;
};

const ruleFor = (id: string, patch: object = {}) => ({ ...emptySegmentRule(field(id)), ...patch });

test('AUD-04 the catalogue offers every Mautic filter family', () => {
  const keys = new Set(catalogue.map(entry => entry.key));
  const families = [
    'date_added', 'date_identified', 'date_modified', 'last_active', 'owner_id', 'points', 'stage',
    'leadlist', 'tags', 'campaign', 'globalcategory',
    'dnc_bounced', 'dnc_unsubscribed', 'dnc_manual_email', 'dnc_bounced_sms', 'dnc_unsubscribed_sms', 'dnc_manual_sms',
    'device_type', 'device_brand', 'device_os', 'device_model',
    'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term',
    'lead_email_received', 'lead_email_sent', 'lead_email_sent_date', 'lead_email_read_date', 'lead_email_read_count',
    'email_id', 'email_clicked_link_date', 'hit_url', 'hit_url_date', 'hit_url_count', 'url_title', 'referer', 'source',
    'source_id', 'sessions', 'page_id', 'redirect_id', 'lead_asset_download', 'sms_clicked_link', 'sms_clicked_link_date',
    'notification', 'group_points_4',
  ];
  for (const key of families) assert.ok(keys.has(key), `${key} is offered`);
  assert.equal(staticSegmentFields.length, 47);
  assert.equal(new Set(catalogue.map(entry => entry.id)).size, catalogue.length, 'ids are unique');
  assert.ok(catalogue.length >= 55, 'about 55 filters once fields and groups are added');
});

test('AUD-04 contact and company fields come from the field definitions, by type', () => {
  assert.equal(field('lead:plan').kind, 'select');
  assert.deepEqual(field('lead:plan').options, ['free', 'pro']);
  assert.equal(field('lead:interests').kind, 'multiselect');
  assert.equal(field('lead:renewal').kind, 'date');
  assert.equal(field('lead:vip').kind, 'boolean');
  assert.equal(field('lead:notes').kind, 'default');
  assert.equal(field('company:companycity').object, 'company');
  assert.equal(field('lead:group_points_4').label, 'Points (Engagement)');
  assert.ok(!catalogue.some(entry => entry.key === 'hidden'), 'unpublished fields are not offered');
});

test('AUD-04 id-based and behaviour filters store the shapes Mautic reads', () => {
  assert.deepEqual(segmentFilterFromRule(ruleFor('lead:tags', { operator: 'in', list: ['3', '5'] }), field('lead:tags'), 0),
    { glue: 'and', field: 'tags', object: 'lead', type: 'tags', operator: 'in', filter: ['3', '5'] });
  assert.deepEqual(segmentFilterFromRule(ruleFor('lead:stage', { operator: '=', text: '2' }), field('lead:stage'), 1),
    { glue: 'and', field: 'stage', object: 'lead', type: 'stage', operator: '=', filter: '2' });
  assert.deepEqual(segmentFilterFromRule(ruleFor('behaviors:lead_email_received', { operator: 'in', list: ['9'], glue: 'or' }), field('behaviors:lead_email_received'), 1),
    { glue: 'or', field: 'lead_email_received', object: 'behaviors', type: 'lead_email_received', operator: 'in', filter: ['9'] });
  assert.deepEqual(segmentFilterFromRule(ruleFor('lead:dnc_bounced', { text: '0' }), field('lead:dnc_bounced'), 0),
    { glue: 'and', field: 'dnc_bounced', object: 'lead', type: 'boolean', operator: '=', filter: 0 });
  assert.deepEqual(segmentFilterFromRule(ruleFor('behaviors:hit_url_count', { operator: 'gte', text: '3' }), field('behaviors:hit_url_count'), 0),
    { glue: 'and', field: 'hit_url_count', object: 'behaviors', type: 'number', operator: 'gte', filter: 3 });
  assert.deepEqual(segmentFilterFromRule(ruleFor('company:companycity', { operator: 'like', text: 'Lon%' }), field('company:companycity'), 0),
    { glue: 'and', field: 'companycity', object: 'company', type: 'text', operator: 'like', filter: 'Lon%' });
  assert.throws(() => segmentFilterFromRule(ruleFor('lead:tags', { operator: 'in' }), field('lead:tags'), 2), /rule 3/);
});

test('AUD-04 segment payloads keep the object, type and value Mautic stores', async () => {
  const filters: SegmentFilter[] = [
    { glue: 'and', field: 'hit_url_date', object: 'behaviors', type: 'datetime', operator: 'inLast', filter: { interval: 7, unit: 'day' } },
    { glue: 'or', field: 'tags', object: 'lead', type: 'tags', operator: 'in', filter: ['3'] },
  ];
  const { api, calls } = client(seen => ({ list: { id: 8, name: 'Active', alias: 'active', isPublished: true, filters: seen.body?.filters } }));
  const created = await api.createSegment({ name: 'Active', filters });
  const sent = calls[0].body?.filters as { object: string; properties: { filter: unknown }; filter: unknown }[];
  assert.equal(sent[0].object, 'behaviors');
  assert.deepEqual(sent[0].properties.filter, { interval: 7, unit: 'day' });
  assert.deepEqual(sent[1].properties.filter, ['3']);
  assert.deepEqual(created.filters?.[0], filters[0]);
});

test('AUD-04 segments made in the Mautic UI read back correctly', async () => {
  const { api } = client(() => ({
    total: 1,
    lists: {
      5: {
        id: 5, name: 'Mautic made', alias: 'mautic-made', isPublished: true,
        filters: {
          0: { glue: 'and', field: 'leadlist', object: 'lead', type: 'leadlist', operator: 'in', properties: { filter: [2, 3], display: '' }, filter: ['stale'] },
          1: { glue: 'or', field: 'dnc_unsubscribed', object: 'lead', type: 'boolean', operator: '=', properties: { filter: true } },
          2: { glue: 'and', field: 'last_active', object: 'lead', type: 'datetime', operator: 'inNext', properties: { filter: { interval: 2, unit: 'month' } } },
          3: { glue: 'and', field: 'city', object: 'lead', type: 'text', operator: 'eq', filter: 'Leeds' },
        },
      },
    },
  }));
  const [segment] = await api.segments();
  assert.deepEqual(segment.filters?.map(entry => entry.filter), [['2', '3'], 1, { interval: 2, unit: 'month' }, 'Leeds']);
  const rule = segmentRuleFromFilter(segment.filters![3], resolveSegmentField(catalogue, segment.filters![3]));
  assert.equal(rule.operator, '=', 'the older eq spelling shows as is equal to');
  const span = segmentRuleFromFilter(segment.filters![2], resolveSegmentField(catalogue, segment.filters![2]));
  assert.deepEqual([span.interval, span.unit], ['2', 'month']);
  assert.deepEqual(resolveSegmentField(catalogue, { field: 'lead_email_read_count', object: 'lead', operator: 'gt', filter: 2 }).object, 'behaviors',
    'a behaviour filter stored under lead still resolves');
  assert.equal(resolveSegmentField(catalogue, { field: 'removed_field', object: 'lead', operator: '=', filter: 'x' }).kind, 'text',
    'a field that no longer exists stays editable');
});

test('AUD-05 there are 24 operators and each field type offers its own table', () => {
  assert.equal(segmentOperatorKeys.length, 24);
  const values = (id: string) => segmentOperatorsFor(field(id)).map(choice => choice.value);
  assert.deepEqual(values('lead:dnc_bounced'), ['=', '!=']);
  assert.deepEqual(values('lead:tags'), ['in', '!in', 'in_all', '!in_all', 'empty', '!empty']);
  assert.deepEqual(values('lead:plan'), ['=', '!=', 'empty', '!empty', 'regexp', '!regexp', 'in', '!in']);
  assert.deepEqual(values('lead:owner_id'), ['=', '!=', 'empty', '!empty']);
  assert.deepEqual(values('lead:stage'), ['=', '!=', 'empty', '!empty']);
  assert.deepEqual(values('behaviors:lead_email_received'), ['in', '!in', 'in_all', '!in_all']);
  assert.deepEqual(values('behaviors:hit_url_count'), ['=', 'gt', 'gte', 'lt', 'lte']);
  assert.deepEqual(values('behaviors:hit_url'), ['=', '!=', 'like', '!like', 'regexp', '!regexp', 'startsWith', 'endsWith', 'contains']);
  assert.ok(values('lead:email').includes('regexp') && values('lead:email').includes('in') && !values('lead:email').includes('gt'));
  assert.ok(values('lead:points').includes('gte') && values('lead:points').includes('!empty') && !values('lead:points').includes('in'));
  assert.ok(!values('lead:tags').includes('like'), 'tags offer no text operators');
});

test('AUD-05 date fields offer relative-date operators', () => {
  const dated = segmentOperatorsFor(field('lead:renewal'));
  assert.ok(dated.some(choice => choice.value === 'inLast') && dated.some(choice => choice.value === 'inNext'));
  assert.equal(dated.find(choice => choice.value === 'gt')?.label, 'is more recent than');
  assert.equal(dated.find(choice => choice.value === 'lt')?.label, 'is older than');
  const behaviour = segmentOperatorsFor(field('behaviors:email_clicked_link_date')).map(choice => choice.value);
  assert.deepEqual(behaviour, ['=', '!=', 'gt', 'gte', 'lt', 'lte', 'inLast', 'inNext']);
  assert.ok(!segmentOperatorsFor(field('lead:email')).some(choice => choice.value === 'inLast'), 'text fields have no relative dates');
});

test('AUD-05 operators Mautic hides are never offered but still read', () => {
  for (const entry of catalogue) {
    const values = segmentOperatorsFor(entry).map(choice => choice.value);
    for (const hidden of ['between', '!between', 'date']) assert.ok(!values.includes(hidden), `${entry.id} hides ${hidden}`);
  }
  const stored: SegmentFilter = { glue: 'and', field: 'points', object: 'lead', type: 'number', operator: 'between', filter: ['10', '20'] };
  const rule = segmentRuleFromFilter(stored, field('lead:points'));
  assert.deepEqual([rule.text, rule.text2], ['10', '20']);
  const kept = segmentOperatorsFor(field('lead:points'), 'between').find(choice => choice.value === 'between');
  assert.equal(kept?.valid, false);
  assert.deepEqual(segmentFilterFromRule(rule, field('lead:points'), 0).filter, ['10', '20']);
});

test('AUD-05 the value input follows the operator', () => {
  assert.equal(segmentValueMode('empty'), 'none');
  assert.equal(segmentValueMode('!empty'), 'none');
  assert.equal(segmentValueMode('in'), 'multi');
  assert.equal(segmentValueMode('!in_all'), 'multi');
  assert.equal(segmentValueMode('inLast'), 'span');
  assert.equal(segmentValueMode('between'), 'pair');
  assert.equal(segmentValueMode('gt'), 'single');
  assert.equal(segmentValueMode('eq'), 'single', 'the older eq spelling takes one value');
  assert.deepEqual(segmentFilterFromRule(ruleFor('lead:points', { operator: 'empty' }), field('lead:points'), 0).filter, '');
  assert.deepEqual(segmentFilterFromRule(ruleFor('lead:renewal', { operator: 'inLast', interval: '30', unit: 'day' }), field('lead:renewal'), 0).filter,
    { interval: 30, unit: 'day' });
  assert.throws(() => segmentFilterFromRule(ruleFor('lead:renewal', { operator: 'inNext', interval: '0' }), field('lead:renewal'), 0), /whole number/);
  assert.deepEqual(segmentFilterFromRule(ruleFor('lead:email', { operator: 'in', text: 'a@example.com, b@example.com' }), field('lead:email'), 0).filter,
    ['a@example.com', 'b@example.com']);
  assert.throws(() => segmentFilterFromRule(ruleFor('lead:points', { operator: 'gt', text: 'many' }), field('lead:points'), 0), /number/);
});

test('AUD-05 relative dates round-trip through the picker', () => {
  assert.deepEqual(parseSegmentDate('this month'), { mode: 'relative', value: 'this month' });
  assert.deepEqual(parseSegmentDate('anniversary'), { mode: 'relative', value: 'anniversary' });
  assert.deepEqual(parseSegmentDate('-1 week'), { mode: 'offset', amount: 1, unit: 'weeks', direction: 'ago' });
  assert.deepEqual(parseSegmentDate('+3 months'), { mode: 'offset', amount: 3, unit: 'months', direction: 'ahead' });
  assert.deepEqual(parseSegmentDate('2026-03-01'), { mode: 'absolute', value: '2026-03-01' });
  assert.equal(formatSegmentOffset(5, 'days', 'ago'), '-5 days');
  assert.equal(formatSegmentOffset(0, 'weeks', 'ahead'), '+1 weeks');
  const filter = segmentFilterFromRule(ruleFor('lead:date_added', { operator: 'gt', text: formatSegmentOffset(2, 'weeks', 'ago') }), field('lead:date_added'), 0);
  assert.deepEqual([filter.type, filter.filter], ['datetime', '-2 weeks']);
});

test('AUD-06 segments list asks for member counts and keeps what the engine reports', async () => {
  const { api, calls } = client(() => ({
    total: 2,
    lists: {
      1: { id: 1, name: 'Beta', alias: 'beta', isPublished: true, contactCount: 120 },
      2: { id: 2, name: 'Alpha', alias: 'alpha', isPublished: true, contactCount: 0, lastBuiltDate: '2026-11-20 03:00:00', lastBuiltTime: 1.5 },
    },
  }));
  const segments = await api.segments();
  assert.equal(calls[0].path, '/api/segments');
  assert.equal(new URLSearchParams(calls[0].search).get('withCounts'), '1');
  assert.deepEqual(segments.map(segment => [segment.name, segment.contactCount]), [['Alpha', 0], ['Beta', 120]]);
  assert.equal(segments[0].lastBuiltAt, '2026-11-20T03:00:00.000Z');
  assert.equal(segments[0].lastBuiltSeconds, 1.5);
  assert.equal(segments[1].lastBuiltAt, undefined, 'Mautic 7.2.2 does not return the build time over REST');
});

test('AUD-06 there is no REST rebuild, so none is offered', () => {
  const { api } = client(() => ({}));
  const names = Object.keys(api).filter(name => /rebuild|refresh|recount/i.test(name));
  assert.deepEqual(names, []);
});

test('AUD-04 owners and point groups feed the pickers', async () => {
  const { api, calls } = client(seen => seen.path === '/api/contacts/list/owners'
    ? [{ id: 2, firstName: 'Ada', lastName: 'Byron', email: 'ada@example.com' }, { id: 3, firstName: '', lastName: '', email: 'ops@example.com' }]
    : { total: 1, pointGroups: { 4: { id: 4, name: 'Engagement' } } });
  const options = await api.segmentOptions();
  assert.deepEqual(options.owners, [{ id: 2, name: 'Ada Byron' }, { id: 3, name: 'ops@example.com' }]);
  assert.deepEqual(options.pointGroups, [{ id: 4, name: 'Engagement' }]);
  assert.deepEqual(calls.map(call => call.path).sort(), ['/api/contacts/list/owners', '/api/points/groups']);
});
