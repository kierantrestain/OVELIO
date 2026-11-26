import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
process.env.CONTACT_HMAC_KEY ||= 'test-hmac-key-for-click-tracking';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { clickUrl, readClickToken, trackLinks, unsubscribeUrl } = await import('../../src/server/mailer');
const { judgeExperiment, normalCdf, proportionTest } = await import('../../src/contracts/experiments');
const { flowExperiments } = await import('../../src/server/journeys/experiments');
const { emitEvent } = await import('../../src/server/events');

after(async () => { await db.close(); });

const messageId = '7d4f8a2e-1b3c-4d5e-8f90-123456789abc';

test('PLT-37 click links are signed: a tampered destination is refused, unsubscribe links stay untouched', () => {
  const url = 'https://example.com/pricing?plan=pro&utm_source=email';
  const token = clickUrl(messageId, url).split('/r/')[1];
  assert.deepEqual(readClickToken(token), { messageId, url });
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(`${messageId}\nhttps://evil.example`).toString('base64url');
  assert.equal(readClickToken(`${forged}.${signature}`), null, 'a different destination with the old signature is refused');
  assert.equal(readClickToken(`${payload}.AAAAAAAAAAAAAAAAAAAAAA`), null);
  const unsubscribe = unsubscribeUrl('reader@example.com');
  const html = `<a href="https://example.com/a?x=1&amp;y=2">A</a> <a href='http://example.org/b'>B</a> <a href="${unsubscribe}">Unsubscribe</a> <a href="mailto:hi@example.com">Mail</a>`;
  const tracked = trackLinks(html, messageId, [unsubscribe]);
  const links = [...tracked.matchAll(/href=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(readClickToken(links[0].split('/r/')[1])?.url, 'https://example.com/a?x=1&y=2', 'entities decode before signing');
  assert.equal(readClickToken(links[1].split('/r/')[1])?.url, 'http://example.org/b');
  assert.equal(links[2], unsubscribe);
  assert.equal(links[3], 'mailto:hi@example.com');
});

test('JRN-09 split statistics: normal CDF, two-proportion test and the minimum-sample rule', () => {
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
  const clear = proportionTest(20, 200, 50, 200);
  assert.ok(clear.pValue < 0.001 && clear.difference > 0.14 && clear.interval[0] > 0);
  const outcomes = (arm: 'a' | 'b', n: number, wins: number) => Array.from({ length: n }, (_, index) => ({ arm, success: index < wins, revenue: 0 }));
  assert.equal(judgeExperiment({ metric: 'click', outcomes: [...outcomes('a', 60, 30), ...outcomes('b', 60, 5)] }).verdict, 'collecting');
  assert.equal(judgeExperiment({ metric: 'click', outcomes: [...outcomes('a', 150, 2), ...outcomes('b', 150, 3)] }).verdict, 'inconclusive', 'too few events');
  const close = judgeExperiment({ metric: 'click', outcomes: [...outcomes('a', 300, 30), ...outcomes('b', 300, 36)] });
  assert.equal(close.verdict, 'inconclusive');
  assert.ok(close.pValue! > 0.05);
  assert.equal(judgeExperiment({ metric: 'click', outcomes: [...outcomes('a', 300, 20), ...outcomes('b', 300, 60)] }).verdict, 'b_wins');
});

test('JRN-10 workflow splits are judged on clicks and revenue, never opens, and scanner clicks are excluded', async () => {
  const flow = (await db.query<{ id: string }>(
    `INSERT INTO journey_flows (name, status, graph) VALUES ('Experiment test', 'published', $1) RETURNING id`,
    [JSON.stringify({ nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 }, config: {} }, { id: 'ab', type: 'split', position: { x: 0, y: 100 }, config: { percentA: 50, metric: 'click', windowDays: 14 } }], edges: [] })],
  )).rows[0];
  // 120 contacts per path; path B clicks far more. Opens on path A are plentiful and must not matter.
  for (let index = 0; index < 240; index++) {
    const arm = index % 2 ? 'B' : 'A';
    const contactId = 900_000 + index;
    const enrolment = (await db.query<{ id: string }>(
      `INSERT INTO journey_enrolments (flow_id, version, contact_id, status, trigger_type, entry_key) VALUES ($1, 1, $2, 'completed', 'test', $3) RETURNING id`,
      [flow.id, contactId, `exp:${index}`])).rows[0];
    await db.query(`INSERT INTO journey_step_logs (enrolment_id, seq, node_id, node_type, action, status, detail, at) VALUES ($1, 1, 'ab', 'split', 'A/B split', 'ok', $2, now() - interval '2 days')`,
      [enrolment.id, `Path ${arm} (50% to A, 50% to B).`]);
    // Path A: 24 of 120 click (every tenth index); path B: 60 of 120.
    const clicks = arm === 'B' ? index % 4 !== 1 : index % 10 === 0;
    if (clicks) await emitEvent({ type: 'email.clicked', contactId, source: `flow:${flow.id}`, properties: { suspectedBot: false } });
    if (arm === 'A') {
      await emitEvent({ type: 'email.opened', contactId, source: `flow:${flow.id}` });
      await emitEvent({ type: 'email.clicked', contactId, source: `flow:${flow.id}`, properties: { suspectedBot: true } });
    }
  }
  const [result] = (await flowExperiments(flow.id)).items;
  assert.equal(result.metric, 'click');
  assert.equal(result.arms[0].allocated, 120);
  assert.equal(result.arms[1].allocated, 120);
  assert.equal(result.arms[0].successes, 24, 'scanner clicks and opens are not counted for path A');
  assert.equal(result.verdict, 'b_wins');
  assert.equal(result.excludedScannerClicks, 120);

  await db.query(`UPDATE journey_flows SET graph = jsonb_set(graph, '{nodes,1,config,metric}', '"revenue"') WHERE id = $1`, [flow.id]);
  const [revenue] = (await flowExperiments(flow.id)).items;
  assert.equal(revenue.metric, 'revenue');
  assert.equal(revenue.verdict, 'inconclusive', 'no revenue yet: inconclusive, not a winner');
});
