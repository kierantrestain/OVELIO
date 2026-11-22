import { z } from 'zod';
import { pointTriggerEventTypes, segmentOperatorKeys, type CustomFieldObject } from '@/contracts';
import { recordActivity } from '@/server/activity';
import {
  bulkUpdateContacts, clearContactBounces, contactDetail, contactDirectory, contactFields,
  deleteListSafely, deleteSegmentSafely, enqueueSegmentSync, exportContact, exportContacts,
  importContacts, listSuppressions, manualSuppress, requestErasure, resendContactOptin, saveContact,
  sendContactEmail, setConsent, updateMailingList, updateMembership,
} from '@/server/audience';
import { rateLimit } from '@/server/auth';
import { assertDeliveryReady } from '@/server/delivery';
import { json, readBody } from '@/server/http';
import { listmonk } from '@/server/listmonk';
import { mautic } from '@/server/mautic';
import { name, description, email, numberId, url, route, id, page } from './shared';
import type { Entry } from './shared';

const segmentFilter = z.object({
  glue: z.enum(['and', 'or']),
  field: z.string().trim().min(1).max(60),
  object: z.enum(['lead', 'company', 'behaviors']).optional(),
  type: z.string().trim().max(40).optional(),
  operator: z.enum([...segmentOperatorKeys, 'eq', 'neq']),
  filter: z.union([
    z.string().max(300), z.number(), z.array(z.string().max(100)).max(200),
    z.object({ interval: z.number().int().min(1).max(100000), unit: z.enum(['day', 'month', 'year']) }),
  ]),
});

const triggerEvents = z.array(z.object({
  id: numberId.optional(),
  name: z.string().trim().max(120).optional(),
  type: z.enum(pointTriggerEventTypes),
  properties: z.record(z.string().max(40), z.unknown()),
})).max(20);

export const audienceEndpoints: Entry[] = [
  /* ── Audience: Contacts, Notes, Consent, Suppressions, Bulk ──────────────── */
  route('GET', /^contacts$/, async ({ query }) => contactDirectory({
    search: z.string().trim().max(128).optional().parse(query.get('q') ?? undefined),
    page: page(query),
    segmentId: query.has('segmentId') ? numberId.parse(query.get('segmentId')) : undefined,
    limit: query.has('limit') ? z.coerce.number().int().min(1).max(50).parse(query.get('limit')) : undefined,
    tag: z.string().trim().max(70).optional().parse(query.get('tag') ?? undefined),
  }), 'marketer'),
  route('POST', /^contacts$/, async ({ request }) => {
    const contact = await saveContact(await readBody(request, contactFields));
    await recordActivity('Contact saved', '/audience');
    return json(contact, 201);
  }, 'marketer'),
  route('POST', /^contacts\/bulk$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      ids: z.array(numberId).min(1).max(100),
      action: z.enum(['add_tag', 'remove_tag', 'add_segment', 'adjust_points']),
      tag: z.string().trim().min(1).max(70).optional(),
      segmentId: numberId.optional(),
      points: z.number().int().min(-10000).max(10000).refine(v => v !== 0).optional(),
    }));
    return bulkUpdateContacts(input);
  }, 'marketer'),
  route('POST', /^contacts\/import$/, async ({ request }) => {
    const body = await readBody(request, z.object({ csv: z.string().min(1).max(1_000_000), evidence: z.string().trim().max(500).optional() }), 1_200_000);
    return importContacts(body.csv, body.evidence);
  }, 'marketer'),
  route('GET', /^contacts\/export$/, async () => new Response(await exportContacts(), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ovelio-contacts.csv"', 'Cache-Control': 'no-store' },
  }), 'admin'),
  route('GET', /^contacts\/(\d+)$/, async context => contactDetail(id(context)), 'marketer'),
  route('PATCH', /^contacts\/(\d+)$/, async context => {
    const contactId = id(context);
    const input = await readBody(context.request, contactFields.partial());
    const currentEmail = input.email ?? (await mautic.contact(contactId)).email;
    return saveContact({ ...input, email: currentEmail }, contactId);
  }, 'marketer'),
  route('DELETE', /^contacts\/(\d+)$/, async context => {
    await requestErasure(id(context));
    return json({ queued: true }, 202);
  }, 'admin'),
  route('GET', /^contacts\/(\d+)\/export$/, async context => new Response(JSON.stringify(await exportContact(id(context))), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="ovelio-contact.json"', 'Cache-Control': 'no-store' },
  }), 'admin'),
  route('POST', /^contacts\/(\d+)\/consent$/, async context => {
    const { action, evidence } = await readBody(context.request, z.object({
      action: z.enum(['opted_in', 'suppressed']), evidence: z.string().trim().min(1).max(500),
    }));
    return setConsent(id(context), action, evidence);
  }, 'marketer'),
  route('POST', /^contacts\/(\d+)\/segments$/, async context => {
    const { segmentId, member } = await readBody(context.request, z.object({ segmentId: numberId, member: z.boolean() }));
    return updateMembership(id(context), segmentId, member);
  }, 'marketer'),
  route('POST', /^contacts\/(\d+)\/lists$/, async context => {
    const { listId, member } = await readBody(context.request, z.object({ listId: numberId, member: z.boolean() }));
    return updateMailingList(id(context), listId, member);
  }, 'marketer'),
  route('POST', /^contacts\/(\d+)\/resend-optin$/, async context => {
    await resendContactOptin(id(context));
    return { sent: true };
  }, 'marketer'),
  route('POST', /^contacts\/(\d+)\/points$/, async context => {
    const { delta } = await readBody(context.request, z.object({
      delta: z.number().int().min(-10000).max(10000).refine(v => v !== 0, 'Enter a non-zero point adjustment.'),
    }));
    await mautic.adjustPoints(id(context), delta);
    await recordActivity(`Contact score adjusted (${delta > 0 ? '+' : ''}${delta})`, `/audience/${id(context)}`);
    return contactDetail(id(context));
  }, 'marketer'),
  route('POST', /^contacts\/(\d+)\/stage$/, async context => {
    const contactId = id(context);
    const { stageId } = await readBody(context.request, z.object({ stageId: numberId.nullable() }));
    const current = await mautic.contact(contactId);
    if (stageId) await mautic.setContactStage(contactId, stageId);
    else if (current.stageId) await mautic.removeContactStage(contactId, current.stageId);
    await recordActivity('Contact lifecycle stage updated', `/audience/${contactId}`);
    return contactDetail(contactId);
  }, 'marketer'),
  route('GET', /^contacts\/(\d+)\/notes$/, async context => mautic.contactNotes(id(context)), 'marketer'),
  route('POST', /^contacts\/(\d+)\/notes$/, async context => {
    const input = await readBody(context.request, z.object({
      text: z.string().trim().min(1).max(2000),
      type: z.enum(['general', 'email', 'call', 'meeting']).optional(),
    }));
    return json(await mautic.createContactNote(id(context), input), 201);
  }, 'marketer'),
  route('DELETE', /^notes\/(\d+)$/, async context => {
    await mautic.deleteContactNote(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^contacts\/(\d+)\/send-email$/, async context => {
    const { emailId } = await readBody(context.request, z.object({ emailId: numberId }));
    await rateLimit('direct-email:' + context.user.id, 20, 60);
    await assertDeliveryReady();
    return sendContactEmail(id(context), emailId);
  }, 'marketer'),
  route('DELETE', /^contacts\/(\d+)\/bounces$/, async context => clearContactBounces(id(context)), 'marketer'),
  route('GET', /^fields\/(contact|company)$/, async context => mautic.fields(context.params[0] as CustomFieldObject), 'marketer'),
  route('POST', /^fields\/(contact|company)$/, async context => {
    const object = context.params[0] as CustomFieldObject;
    const input = await readBody(context.request, z.object({
      label: name,
      alias: z.string().trim().regex(/^[a-z][a-z0-9_]{0,59}$/, 'Use lowercase letters, numbers and underscores.').optional(),
      type: z.enum([
        'text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'email', 'url', 'tel', 'select', 'multiselect',
        'country', 'region', 'timezone', 'locale',
      ]),
      group: z.enum(['core', 'social', 'personal', 'professional']).optional(),
      defaultValue: z.string().max(300).optional(),
      isRequired: z.boolean().optional(),
      isPubliclyUpdatable: z.boolean().optional(),
      published: z.boolean().optional(),
      options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    }));
    return json(await mautic.createField(object, input), 201);
  }, 'marketer'),
  route('PATCH', /^fields\/(contact|company)\/(\d+)$/, async context => {
    const object = context.params[0] as CustomFieldObject;
    const fieldId = numberId.parse(context.params[1]);
    const input = await readBody(context.request, z.object({
      label: name.optional(),
      group: z.enum(['core', 'social', 'personal', 'professional']).optional(),
      defaultValue: z.string().max(300).optional(),
      isRequired: z.boolean().optional(),
      isPubliclyUpdatable: z.boolean().optional(),
      published: z.boolean().optional(),
      options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    }));
    return mautic.updateField(object, fieldId, input);
  }, 'marketer'),
  route('DELETE', /^fields\/(contact|company)\/(\d+)$/, async context => {
    await mautic.deleteField(context.params[0] as CustomFieldObject, numberId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^categories$/, async ({ query }) => mautic.categories(query.get('bundle')?.trim() || undefined), 'marketer'),
  route('POST', /^categories$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      title: name,
      bundle: z.enum(['global', 'asset', 'campaign', 'email', 'form', 'page', 'point', 'segment', 'stage', 'dynamicContent', 'focus']),
      description,
      color: z.string().trim().regex(/^#?[0-9a-f]{6}$/i, 'Enter a six-digit hex colour.').optional(),
      published: z.boolean().optional(),
    }));
    return json(await mautic.createCategory(input), 201);
  }, 'marketer'),
  route('PATCH', /^categories\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({
      title: name.optional(),
      bundle: z.enum(['global', 'asset', 'campaign', 'email', 'form', 'page', 'point', 'segment', 'stage', 'dynamicContent', 'focus']).optional(),
      description,
      color: z.string().trim().regex(/^#?[0-9a-f]{6}$/i, 'Enter a six-digit hex colour.').optional(),
      published: z.boolean().optional(),
    }));
    return mautic.updateCategory(id(context), input);
  }, 'marketer'),
  route('DELETE', /^categories\/(\d+)$/, async context => {
    await mautic.deleteCategory(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),

  /* ── Audience: Suppressions, Segments, Lists, Tags, Stages, Companies, Scoring */
  route('GET', /^suppressions$/, async () => listSuppressions(), 'marketer'),
  route('POST', /^suppressions$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      email,
      reason: z.enum(['unsubscribe', 'bounce', 'complaint', 'erasure']),
      evidence: z.string().trim().min(1).max(500),
    }));
    await manualSuppress(input.email, input.reason, input.evidence);
    return json({ suppressed: true }, 201);
  }, 'marketer'),
  route('GET', /^segments$/, async () => mautic.segments(), 'marketer'),
  route('GET', /^segment-options$/, async () => mautic.segmentOptions(), 'marketer'),
  route('POST', /^segments$/, async ({ request }) => json(await mautic.createSegment(await readBody(request, z.object({
    name, description, published: z.boolean().optional(), filters: z.array(segmentFilter).max(20).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^segments\/(\d+)$/, async context => mautic.updateSegment(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, published: z.boolean().optional(), filters: z.array(segmentFilter).max(20).optional(),
  }))), 'marketer'),
  route('DELETE', /^segments\/(\d+)$/, async context => {
    await deleteSegmentSafely(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^segments\/(\d+)\/sync$/, async context => {
    await enqueueSegmentSync(id(context));
    return json({ queued: true }, 202);
  }, 'marketer'),
  route('GET', /^lists$/, async () => listmonk.lists(), 'marketer'),
  route('POST', /^lists$/, async ({ request }) => json(await listmonk.createList(await readBody(request, z.object({
    name, description, type: z.enum(['private', 'public']).optional(), optin: z.enum(['single', 'double']).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^lists\/(\d+)$/, async context => listmonk.updateList(id(context), await readBody(context.request, z.object({
    name, description, type: z.enum(['private', 'public']).optional(), optin: z.enum(['single', 'double']).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  }))), 'marketer'),
  route('DELETE', /^lists\/(\d+)$/, async context => {
    await deleteListSafely(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^tags$/, async () => mautic.tags(), 'marketer'),
  route('POST', /^tags$/, async ({ request }) => {
    const input = await readBody(request, z.object({ tag: z.string().trim().min(1).max(70), description }));
    return json(await mautic.createTag(input.tag, input.description), 201);
  }, 'marketer'),
  route('DELETE', /^tags\/(\d+)$/, async context => {
    await mautic.deleteTag(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^stages$/, async () => mautic.stages(), 'marketer'),
  route('POST', /^stages$/, async ({ request }) => json(await mautic.createStage(await readBody(request, z.object({
    name, description, weight: z.number().int().min(0).max(10000).optional(), published: z.boolean().optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^stages\/(\d+)$/, async context => mautic.updateStage(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, weight: z.number().int().min(0).max(10000).optional(), published: z.boolean().optional(),
  }))), 'marketer'),
  route('DELETE', /^stages\/(\d+)$/, async context => {
    await mautic.deleteStage(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^companies$/, async ({ query }) => mautic.companies({
    search: z.string().trim().max(120).optional().parse(query.get('q') ?? undefined),
  }), 'marketer'),
  route('POST', /^companies$/, async ({ request }) => json(await mautic.createCompany(await readBody(request, z.object({
    name, email: email.or(z.literal('')).optional(), website: url.optional(),
    industry: z.string().trim().max(100).optional(), city: z.string().trim().max(100).optional(), country: z.string().trim().max(100).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^companies\/(\d+)$/, async context => mautic.updateCompany(id(context), await readBody(context.request, z.object({
    name: name.optional(), email: email.or(z.literal('')).optional(), website: url.optional(),
    industry: z.string().trim().max(100).optional(), city: z.string().trim().max(100).optional(), country: z.string().trim().max(100).optional(),
  }))), 'marketer'),
  route('DELETE', /^companies\/(\d+)$/, async context => {
    await mautic.deleteCompany(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^companies\/(\d+)\/contacts$/, async context => {
    const { contactId } = await readBody(context.request, z.object({ contactId: numberId }));
    await mautic.addContactToCompany(id(context), contactId);
    return { linked: true };
  }, 'marketer'),
  route('GET', /^point-actions$/, async () => mautic.pointActions(), 'marketer'),
  route('GET', /^point-actions\/types$/, async () => mautic.pointActionTypes(), 'marketer'),
  route('POST', /^point-actions$/, async ({ request }) => json(await mautic.createPointAction(await readBody(request, z.object({
    name, description, type: z.string().trim().min(1).max(80), delta: z.number().int().min(-10000).max(10000), published: z.boolean().optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^point-actions\/(\d+)$/, async context => mautic.updatePointAction(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, type: z.string().trim().min(1).max(80).optional(), delta: z.number().int().min(-10000).max(10000).optional(), published: z.boolean().optional(),
  }))), 'marketer'),
  route('DELETE', /^point-actions\/(\d+)$/, async context => {
    await mautic.deletePointAction(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^point-triggers$/, async () => mautic.pointTriggers(), 'marketer'),
  route('POST', /^point-triggers$/, async ({ request }) => json(await mautic.createPointTrigger(await readBody(request, z.object({
    name, description, points: z.number().int().min(1).max(100000), published: z.boolean().optional(), triggerExistingLeads: z.boolean().optional(),
    events: triggerEvents.optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^point-triggers\/(\d+)$/, async context => mautic.updatePointTrigger(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, points: z.number().int().min(1).max(100000).optional(), published: z.boolean().optional(), triggerExistingLeads: z.boolean().optional(),
    events: triggerEvents.optional(),
  }))), 'marketer'),
  route('DELETE', /^point-triggers\/(\d+)$/, async context => {
    await mautic.deletePointTrigger(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
];
