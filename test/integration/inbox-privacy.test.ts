import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { InboxConversation, MailboxOverview } from '../../src/contracts/crm';
import { apiClient, testEnv } from './client';
import { fixtureSql } from './database';

type Api = Awaited<ReturnType<typeof apiClient>>;

test('INB-01 mailbox ownership and sharing apply across authenticated console surfaces', { timeout: 120_000 }, async context => {
  const env = testEnv();
  const admin = await apiClient(env);
  const tag = randomUUID().slice(0, 12);
  const users: string[] = [];
  const mailboxId = randomUUID();
  const otherMailboxId = randomUUID();
  const threadId = 'provider-thread-' + tag;
  const privateSubject = 'Private thread ' + tag;
  const privateBody = 'Private snippet ' + tag;
  const otherSubject = 'Different mailbox ' + tag;
  const gatewaySubject = 'Shared gateway message ' + tag;
  const contactEmail = 'inbox-contact-' + tag + '@example.test';
  const mailboxEmail = 'inbox-owner-mailbox-' + tag + '@example.test';
  const fixture: { contactId?: number; dealId?: string; seeded: boolean } = { seeded: false };

  context.after(async () => {
    if (fixture.seeded) {
      await fixtureSql(
        'DELETE FROM events WHERE contact_id = :contact; DELETE FROM activities WHERE contact_id = :contact;\n'
        + 'DELETE FROM messages WHERE contact_id = :contact; DELETE FROM deals WHERE id = :\'deal\';\n',
        { contact: fixture.contactId!, deal: fixture.dealId! },
      );
    }
    for (const user of users) await fixtureSql('DELETE FROM users WHERE id = :\'id\';', { id: user });
    if (fixture.contactId) assert.equal((await admin.response('/contacts/' + fixture.contactId, 'DELETE')).status, 202);
  });

  async function marketer(label: string) {
    const credentials = { email: 'inbox-' + label + '-' + tag + '@example.test', password: 'Fixture mailbox password ' + tag };
    const user = await admin.get<{ id: string }>('/settings/team', 'POST', { ...credentials, name: 'Mailbox fixture ' + label, role: 'marketer' });
    users.push(user.id);
    return { ...user, credentials, api: await apiClient({ ...env, ...credentials }) };
  }

  const [owner, member, outsider] = await Promise.all(['owner', 'member', 'outsider'].map(marketer));
  const { id: contactId } = await admin.get<{ id: number }>('/contacts', 'POST', { email: contactEmail, firstName: 'Mailbox fixture' });
  fixture.contactId = contactId;
  const company = await admin.get<{ id: number }>('/crm/lookup/companies', 'POST', { name: 'Mailbox fixture ' + tag, contactId });
  const { id: dealId } = await outsider.api.get<{ id: string }>('/sales/deals', 'POST', { name: 'Mailbox fixture ' + tag, contactId, companyId: company.id });
  fixture.dealId = dealId;
  await admin.get('/crm/owners', 'POST', { object: 'contact', ids: [contactId], ownerId: outsider.id });

  await fixtureSql(`
    BEGIN;
    INSERT INTO crm_mailboxes (id, user_id, provider, email, refresh_token_enc)
    VALUES (:'mailbox', :'owner', 'google', :'mailbox_email', 'fixture-unused'),
      (:'other_mailbox', :'outsider', 'microsoft', :'other_email', 'fixture-unused');
    INSERT INTO messages (id, contact_id, category, status, to_email, from_email, subject, html, text_body, provider_message_id, source, created_by, sent_at, created_at, mailbox_id)
    VALUES (:'message', :contact, 'sales', 'sent', :'contact_email', :'mailbox_email', :'private_subject', '<p>Fixture</p>',
      :'private_body', 'msg-1', 'mailbox:' || :'mailbox', :'owner', now() - interval '2 minutes', now() - interval '2 minutes', :'mailbox'),
      (gen_random_uuid(), :contact, 'sales', 'sent', :'contact_email', 'gateway@example.test', :'gateway_subject', '<p>Fixture</p>',
       '', NULL, 'sales:' || :'owner', :'owner', now() - interval '1 hour', now() - interval '1 hour', NULL);
    INSERT INTO activities (id, contact_id, company_id, deal_id, type, direction, subject, body, occurred_at, mailbox_id, message_id, author_id)
    VALUES (:'activity', :contact, :company, :'deal', 'email', 'outbound', :'private_subject', :'private_body',
      now() - interval '2 minutes', :'mailbox', :'message', :'owner');
    INSERT INTO crm_mailbox_messages
      (mailbox_id, provider_message_id, thread_id, contact_id, direction, subject, snippet, from_email, to_emails, activity_id)
    VALUES (:'mailbox', 'msg-1', :'thread', :contact, 'outbound', :'private_subject', :'private_body', :'mailbox_email', :'contact_email', :'activity'),
      (:'mailbox', 'msg-2', :'thread', :contact, 'inbound', :'private_subject', :'private_body', :'contact_email', :'mailbox_email', NULL),
      (:'other_mailbox', 'msg-1', :'thread', :contact, 'inbound', :'other_subject', 'Second mailbox', :'contact_email', :'other_email', NULL);
    INSERT INTO events (type, contact_id, deal_id, entity_type, entity_id, mailbox_id, properties)
    VALUES ('activity.logged', :contact, :'deal', 'activity', :'activity', :'mailbox', jsonb_build_object('subject', :'private_subject')),
      ('email.replied', :contact, :'deal', 'mailbox', :'mailbox', :'mailbox', jsonb_build_object('subject', :'private_subject'));
    COMMIT;
  `, {
    mailbox: mailboxId, owner: owner.id, mailbox_email: mailboxEmail, other_mailbox: otherMailboxId, outsider: outsider.id,
    other_email: 'inbox-other-' + tag + '@example.test', message: randomUUID(), activity: randomUUID(), contact: contactId,
    company: company.id, deal: dealId, contact_email: contactEmail, private_subject: privateSubject, private_body: privateBody,
    gateway_subject: gatewaySubject, thread: threadId, other_subject: otherSubject,
  });
  fixture.seeded = true;

  const findPrivate = '?q=' + encodeURIComponent(privateSubject);
  const events = '/platform/events?contactId=' + contactId + '&types=email.replied,activity.logged';
  const membersPath = '/mailboxes/' + mailboxId + '/members';
  const thread = (mailbox: string) => '/sales/inbox/thread?' + new URLSearchParams({ mailboxId: mailbox, threadId });
  const message = '/sales/inbox/message?' + new URLSearchParams({ mailboxId, messageId: 'msg-1' });
  const attachment = '/sales/inbox/attachment?' + new URLSearchParams({ mailboxId, messageId: 'msg-1', attachmentId: '0' });
  const team = '/sales/inbox/team?' + new URLSearchParams({ mailboxId, threadId });
  const contentPaths = ['/sales/inbox', '/sales/inbox' + findPrivate, '/sales/inbox/threads' + findPrivate, '/sales/inbox/export' + findPrivate,
    '/crm/activities?contactId=' + contactId, '/crm/contacts/' + contactId + '/profile', '/crm/companies/' + company.id + '/profile',
    '/sales/deals/' + dealId, events];

  async function assertContents(api: Api, visible: boolean) {
    await Promise.all(contentPaths.map(async path => {
      const response = await api.response(path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
      if (path.startsWith('/sales/inbox/export')) assert.match(response.headers.get('content-type') ?? '', /^text\/csv/);
      const body = await response.text();
      assert.equal(body.includes(privateSubject), visible, path);
      if (!visible) assert.ok(!body.includes(privateBody), path);
    }));
    const detail = await api.response(thread(mailboxId));
    assert.equal(detail.status, visible ? 200 : 404, 'thread access uses the mailbox and provider thread together');
    const body = await detail.text();
    assert.equal(body.includes(privateBody), visible);
    assert.ok(!body.includes(otherSubject), 'identical provider thread IDs in other mailboxes cannot bleed into this thread');
    const full = await api.response(message);
    assert.equal(full.status, visible ? 200 : 404, 'the full-body endpoint enforces mailbox membership');
    assert.equal((await full.text()).includes(privateBody), visible);
    assert.equal((await api.response(team)).status, visible ? 200 : 404, 'team inbox metadata follows the same boundary');
    if (!visible) {
      assert.equal((await api.response(attachment)).status, 404, 'file downloads fail before loading provider credentials');
      assert.equal((await api.response(thread(mailboxId), 'PATCH', { read: true })).status, 404);
    }
  }

  await context.test('INB-02 record ownership and administrator privileges do not grant mailbox content', async () => {
    await Promise.all([assertContents(owner.api, true), assertContents(member.api, false), assertContents(outsider.api, false), assertContents(admin, false)]);
    assert.equal((await owner.api.response(thread(otherMailboxId))).status, 404);
    const [adminMailboxes, outsiderMailboxes] = await Promise.all([admin.get<MailboxOverview>('/mailboxes'), outsider.api.get<MailboxOverview>('/mailboxes')]);
    assert.ok(adminMailboxes.mailboxes.some(mailbox => mailbox.id === mailboxId), 'administrators see connection metadata');
    assert.ok(!JSON.stringify(adminMailboxes).includes('fixture-unused'), 'connection metadata omits provider credentials');
    assert.ok(!outsiderMailboxes.mailboxes.some(mailbox => mailbox.id === mailboxId), 'unrelated marketers cannot list the connection');
    for (const api of [admin, outsider.api]) {
      assert.ok([403, 404].includes((await api.response(membersPath, 'PATCH', { userIds: [outsider.id] })).status), 'only the mailbox owner can grant access');
    }
    const shared = await outsider.api.get<InboxConversation[]>('/sales/inbox?q=' + encodeURIComponent(gatewaySubject));
    assert.ok(shared.some(item => item.subject === gatewaySubject), 'shared gateway activity is still visible');
    const search = await outsider.api.get('/platform/search' + findPrivate);
    assert.ok(!JSON.stringify(search).includes(privateSubject));
    const contactExport = await admin.response('/contacts/' + contactId + '/export');
    assert.equal(contactExport.status, 200);
    assert.ok(!(await contactExport.text()).includes(privateSubject));
    const insights = '?metric=emails_sent&ownerId=' + owner.id;
    for (const api of [owner.api, admin]) {
      for (const path of ['/insights/drill' + insights, '/insights/export/drill' + insights]) {
        const response = await api.response(path);
        assert.equal(response.status, 200, path);
        const text = await response.text();
        assert.ok(text.includes(gatewaySubject), path);
        assert.ok(!text.includes(privateSubject), 'workspace reporting excludes connected-mailbox content');
      }
    }
  });

  await context.test('INB-03 owner sharing and member removal apply to existing sessions', async () => {
    const updated = await owner.api.get<{ members: { userId: string }[] }>(membersPath, 'PATCH', { userIds: [member.id] });
    assert.deepEqual(updated.members.map(item => item.userId), [member.id]);
    await assertContents(member.api, true);
    const snapshot = await member.api.get<{ unread: boolean; readVersion: string }>(thread(mailboxId));
    assert.ok(snapshot.unread);
    assert.deepEqual(await member.api.get(thread(mailboxId), 'PATCH', { read: true, through: snapshot.readVersion }), { unread: false });
    assert.equal((await owner.api.get<{ unread: boolean }>(thread(mailboxId))).unread, true, 'read markers are per viewer');
    await owner.api.get(team, 'PATCH', { assigneeId: member.id, status: 'pending' });
    const queue = '/sales/inbox/threads' + findPrivate + '&status=pending';
    assert.equal((await member.api.get<unknown[]>(queue + '&assignment=mine')).length, 1);
    assert.deepEqual(await outsider.api.get(queue), []);

    await admin.get('/settings/team/' + member.id, 'PATCH', { role: 'analyst' });
    assert.equal((await member.api.response('/sales/inbox')).status, 403);
    assert.ok(!JSON.stringify(await member.api.get(events)).includes(privateSubject), 'analysts cannot read mailbox events through platform APIs');
    await admin.get('/settings/team/' + member.id, 'PATCH', { role: 'marketer' });

    await owner.api.get(membersPath, 'PATCH', { userIds: [] });
    await assertContents(member.api, false);
    assert.equal((await owner.api.get<unknown[]>(queue + '&assignment=unassigned')).length, 1);
    await owner.api.get(membersPath, 'PATCH', { userIds: [member.id] });
  });

  await context.test('INB-04 disabled owners, connection revocation and disconnection close content access', async () => {
    await admin.get('/settings/team/' + owner.id, 'PATCH', { disabled: true });
    assert.equal((await owner.api.response('/sales/inbox')).status, 401);
    await assertContents(member.api, false);
    await admin.get('/settings/team/' + owner.id, 'PATCH', { disabled: false });
    const reconnectedOwner = await apiClient({ ...env, ...owner.credentials });

    await fixtureSql("UPDATE crm_mailboxes SET status = 'revoked' WHERE id = :'id';", { id: mailboxId });
    await assertContents(reconnectedOwner, false);
    assert.equal((await admin.response('/mailboxes/' + mailboxId, 'DELETE')).status, 204);
    await assertContents(reconnectedOwner, false);
    await assertContents(member.api, false);
  });
});
