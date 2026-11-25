import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.OVELIO_DEV_PREVIEW = 'true';
delete process.env.DATABASE_URL;

const { db } = await import('../../src/server/db');
const { searchContacts, upsertContact, canEmail } = await import('../../src/server/directory');
const { createDeal, moveDeal, createTask, completeTask, logActivity, resolveCampaignId } = await import('../../src/server/records');
const { sendEmail, readUnsubscribeToken, unsubscribeUrl, setMailTransport } = await import('../../src/server/mailer');
const { listEvents } = await import('../../src/server/events');
const { renderMergeTags, unknownMergeTags } = await import('../../src/contracts/merge-tags');

after(async () => { await db.close(); });

test('PLT-30 a new workspace has a default pipeline with won and lost stages', async () => {
  const stages = await db.query<{ name: string; outcome: string }>(
    `SELECT s.name, s.outcome FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE p.is_default ORDER BY s.position`);
  assert.deepEqual(stages.rows.map(row => row.outcome), ['open', 'open', 'open', 'open', 'won', 'lost']);
});

test('PLT-31 deals keep stage history and closing a deal emits a measured deal.won', async () => {
  const [contact] = await searchContacts('claire');
  assert.ok(contact, 'preview contact exists');
  const deal = await createDeal({ name: 'Northbridge renewal', amount: 12000, contactId: contact.id, source: 'test' });
  assert.equal(deal.contact_email, contact.email);
  assert.equal(deal.status, 'open');
  const won = (await db.query<{ id: string }>(`SELECT id FROM pipeline_stages WHERE outcome = 'won' LIMIT 1`)).rows[0].id;
  const closed = await moveDeal(deal.id, { stageId: won });
  assert.equal(closed.status, 'won');
  assert.ok(closed.closed_at);
  const history = await db.query('SELECT 1 FROM deal_stage_history WHERE deal_id = $1', [deal.id]);
  assert.equal(history.rows.length, 2);
  const events = await listEvents({ dealId: deal.id });
  const wonEvent = events.find(event => event.type === 'deal.won');
  assert.equal(wonEvent?.amount, 12000);
  assert.ok(events.some(event => event.type === 'deal.stage_changed'));
});

test('PLT-32 tasks and activities record events against the contact', async () => {
  const [contact] = await searchContacts('daniel');
  const task = await createTask({ title: 'Call about pricing', type: 'call', contactId: contact.id, dueAt: new Date() });
  await completeTask(task.id, null);
  await completeTask(task.id, null);
  await logActivity({ type: 'call', subject: 'Pricing call', contactId: contact.id, outcome: 'Interested' });
  const events = await listEvents({ contactId: contact.id });
  assert.equal(events.filter(event => event.type === 'task.completed').length, 1, 'completing twice records one event');
  assert.ok(events.some(event => event.type === 'activity.logged'));
});

test('PLT-33 campaigns resolve from linked assets before UTM slugs', async () => {
  const campaign = (await db.query<{ id: string }>(`INSERT INTO marketing_campaigns (name, utm_campaign) VALUES ('Spring launch', 'spring-launch') RETURNING id`)).rows[0];
  await db.query(`INSERT INTO campaign_assets (campaign_id, asset_type, asset_id) VALUES ($1, 'form', 'form-1')`, [campaign.id]);
  assert.equal(await resolveCampaignId({ assets: [{ type: 'form', id: 'form-1' }] }), campaign.id);
  assert.equal(await resolveCampaignId({ utmCampaign: 'Spring-Launch' }), campaign.id);
  assert.equal(await resolveCampaignId({ utmCampaign: 'unknown' }), null);
});

test('PLT-34 merge tags escape values, keep fallbacks and flag unknown tags', () => {
  const html = renderMergeTags('<p>Hi {{contact.first_name | there}}, {{ contact.company }} {{contact.nope}}</p>', { 'contact.first_name': '', 'contact.company': '<b>Acme</b>' });
  assert.equal(html, '<p>Hi there, &lt;b&gt;Acme&lt;/b&gt; {{contact.nope}}</p>');
  assert.deepEqual(unknownMergeTags('{{contact.first_name}} {{contact.nope}}'), ['contact.nope']);
});

test('PLT-35 the mailer blocks unconsented addresses and never reports a preview send as sent', async () => {
  setMailTransport(undefined);
  const { contact } = await upsertContact({ email: 'ada.consented@example.com', firstName: 'Ada', consent: 'opted_in', evidence: 'Unit test', source: 'test' });
  assert.equal((await canEmail(contact.email)).allowed, true);
  const preview = await sendEmail({ to: contact.email, subject: 'Hi {{contact.first_name}}', html: '<p>Hello {{contact.first_name}}</p>', category: 'marketing', source: 'test', idempotencyKey: 'plt35' });
  assert.equal(preview.status, 'not_sent');
  const stored = (await db.query<{ subject: string; html: string }>('SELECT subject, html FROM messages WHERE id = $1', [preview.messageId])).rows[0];
  assert.equal(stored.subject, 'Hi Ada');
  assert.match(stored.html, /Hello Ada/);
  assert.match(stored.html, /\/u\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, 'marketing email carries an unsubscribe link');
  const repeat = await sendEmail({ to: contact.email, subject: 'x', html: 'x', category: 'marketing', source: 'test', idempotencyKey: 'plt35' });
  assert.equal(repeat.duplicate, true);
  const unknown = await sendEmail({ to: 'nobody@example.com', subject: 'x', html: 'x', category: 'marketing', source: 'test' });
  assert.equal(unknown.status, 'blocked');
});

test('PLT-36 a configured transport delivers and the unsubscribe token round-trips', async () => {
  const sent: { to: string; subject: string; headers?: Record<string, string> }[] = [];
  setMailTransport({ sendMail: async (mail: { to: string; subject: string; headers?: Record<string, string> }) => { sent.push(mail); return { messageId: '<m1@test>' }; } } as never);
  const result = await sendEmail({ to: 'ada.consented@example.com', subject: 'Welcome', html: '<p>Hi</p>', category: 'marketing', source: 'test' });
  setMailTransport(undefined);
  assert.equal(result.status, 'sent');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].headers?.['List-Unsubscribe']);
  const events = await listEvents({ types: ['email.sent'] });
  assert.ok(events.some(event => event.entityId === result.messageId));
  const token = unsubscribeUrl('Ada.Consented@example.com').split('/u/')[1];
  assert.equal(readUnsubscribeToken(token), 'ada.consented@example.com');
  assert.equal(readUnsubscribeToken(token.slice(0, -2) + 'xx'), null);
});
