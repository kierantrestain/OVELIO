import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SNIPPET_OPTIONS } from '../../src/contracts/analytics';
import type { SnippetOptions } from '../../src/contracts/analytics';
import type { Sql } from '../../src/server/db';
import { buildSnippet, getSnippetPreferences, saveSnippetPreferences } from '../../src/server/analytics-snippet';
import {
  DEFAULT_CHANNEL_RULES, channelReport, classifyVisit, loadChannelRules, saveChannelRules,
} from '../../src/server/analytics-channels';

const id = '22b3bfe1-b34f-4472-bc18-123994f2ef31';
const origin = 'https://ovelio.example.test/';

function fakeSql(rows: unknown[] = []) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const sql: Sql = {
    query: (async (text: string, values?: unknown[]) => {
      calls.push({ sql: text, values });
      return { rows, rowCount: rows.length };
    }) as Sql['query'],
  };
  return { sql, calls };
}

test('ANA-05 the default snippet carries only the website id', () => {
  assert.equal(
    buildSnippet(origin, id, DEFAULT_SNIPPET_OPTIONS),
    `<script defer src="https://ovelio.example.test/script.js" data-website-id="${id}"></script>`,
  );
});

test('ANA-05 every tracker option becomes the attribute Umami reads', () => {
  const options: SnippetOptions = {
    domains: ['example.com', 'shop.example.com'], doNotTrack: true, excludeSearch: true, excludeHash: true,
    tag: 'spring', autoTrack: false, hostUrl: 'https://t.example.com/', beforeSend: 'beforeSend', performance: true, consentMode: false,
  };
  const html = buildSnippet(origin, id, options);
  for (const attribute of [
    'data-host-url="https://t.example.com"', 'data-domains="example.com,shop.example.com"', 'data-do-not-track="true"',
    'data-exclude-search="true"', 'data-exclude-hash="true"', 'data-tag="spring"', 'data-auto-track="false"',
    'data-before-send="beforeSend"', 'data-performance="true"',
  ]) assert.ok(html.includes(attribute), attribute);
});

test('ANA-05 consent mode loads nothing until ovelioConsent.grant() and revoke() disables tracking', () => {
  const html = buildSnippet(origin, id, { ...DEFAULT_SNIPPET_OPTIONS, consentMode: true, tag: 'a"</script>' });
  assert.ok(html.includes('ovelioConsent'));
  assert.ok(html.includes('grant:') && html.includes('revoke:'));
  assert.ok(!html.includes('<script defer'));
  assert.ok(html.includes("umami.disabled"));
  assert.equal(html.match(/<\/script>/g)?.length, 1, 'a tag value cannot close the script early');
});

test('ANA-05 saved preferences round-trip and an invalid domain is refused', async () => {
  const { sql, calls } = fakeSql([{ options: { ...DEFAULT_SNIPPET_OPTIONS, tag: 'x' }, updated_at: new Date(0) }]);
  const saved = await saveSnippetPreferences(id, { ...DEFAULT_SNIPPET_OPTIONS, tag: 'x', domains: ['Example.com'] }, sql);
  assert.equal(saved.options.tag, 'x');
  assert.ok(calls[0].sql.includes('INSERT INTO analytics_snippet_preferences'));
  assert.deepEqual(JSON.parse(String(calls[0].values?.[1])).domains, ['example.com']);
  await assert.rejects(saveSnippetPreferences(id, { ...DEFAULT_SNIPPET_OPTIONS, domains: ['bad domain!'] }, sql));
  assert.deepEqual((await getSnippetPreferences(id, fakeSql().sql)).options, DEFAULT_SNIPPET_OPTIONS);
});

test('ANA-07 utm_medium newsletter and email count as Email', () => {
  for (const utmMedium of ['newsletter', 'email', 'e-mail', 'Email']) {
    assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { utmMedium }).channel, 'Email');
  }
});

test('ANA-07 fbclid and other click IDs count as Paid, and Email still wins when it comes first', () => {
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { referrer: 'facebook.com', query: 'fbclid=abc' }).channel, 'Paid');
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { utmMedium: 'cpc' }).channel, 'Paid');
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { utmMedium: 'email', query: 'gclid=1' }).channel, 'Email');
});

test('ANA-07 search, social, direct and other referrers get their defaults', () => {
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { referrer: 'www.google.com' }).channel, 'Organic search');
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { referrer: 'news.ycombinator.com' }).channel, 'Organic social');
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, {}).channel, 'Direct');
  assert.equal(classifyVisit(DEFAULT_CHANNEL_RULES, { referrer: 'blog.example.org' }).channel, 'Referral');
  assert.equal(classifyVisit([], { referrer: 'x.org' }).channel, 'Unclassified');
});

test('ANA-07 rule order decides: the first matching rule wins', () => {
  const rules = [
    { name: 'A', channel: 'Partners', conditions: [{ field: 'referrer' as const, operator: 'contains' as const, values: ['google.'] }] },
    ...DEFAULT_CHANNEL_RULES,
  ];
  assert.deepEqual(classifyVisit(rules, { referrer: 'google.com' }), { channel: 'Partners', rule: 'A' });
});

test('ANA-07 the report groups breakdown rows by channel and says it is breakdown-level', () => {
  const report = channelReport(DEFAULT_CHANNEL_RULES, [
    { referrer: '', utmSource: 'news', utmMedium: 'newsletter', query: '', visits: 6, visitors: 5 },
    { referrer: 'google.com', utmSource: '', utmMedium: '', query: '', visits: 3, visitors: 3 },
    { referrer: '', utmSource: 'x', utmMedium: 'email', query: '', visits: 1, visitors: 1 },
  ]);
  assert.deepEqual(report.rows.map(row => [row.channel, row.visits]), [['Email', 7], ['Organic search', 3]]);
  assert.equal(report.precision, 'breakdown');
  assert.equal(report.rows[0].share, 0.7);
});

test('ANA-07 rules are stored in order, empty storage means the defaults, and bad rules are refused', async () => {
  const { sql, calls } = fakeSql();
  const loaded = await loadChannelRules(sql);
  assert.equal(loaded.custom, false);
  assert.equal(loaded.rules.length, DEFAULT_CHANNEL_RULES.length);
  await saveChannelRules([{ name: 'Z', channel: 'Zed', conditions: [{ field: 'utmSource', operator: 'equals', values: ['z'] }] }], fakeSql().sql);
  const writer = fakeSql();
  await saveChannelRules([{ name: 'Z', channel: 'Zed', conditions: [{ field: 'utmSource', operator: 'equals', values: ['z'] }] }], writer.sql);
  assert.ok(writer.calls[0].sql.includes('WITH ORDINALITY'));
  assert.equal(JSON.parse(String(writer.calls[0].values?.[0]))[0].name, 'Z');
  await assert.rejects(saveChannelRules([{ name: 'Bad', channel: 'X', conditions: [{ field: 'utmSource', operator: 'equals', values: [] }] }], sql));
  assert.equal(calls.length, 1);
});
