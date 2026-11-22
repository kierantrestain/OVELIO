import { z } from 'zod';
import type {
  CustomFieldObject, PerformanceBreakdownType, PerformanceMetricKey, ReportDimension, ReportFilters,
  RevenueMetricType, Role, User,
} from '@/contracts';
import { recordActivity } from '@/server/activity';
import {
  bulkUpdateContacts, clearContactBounces, contactDetail, contactDirectory, contactFields, deleteListSafely,
  deleteSegmentSafely, enqueueSegmentSync, exportContact, exportContacts, importContacts, listSuppressions,
  manualSuppress, requestErasure, resendContactOptin, saveContact, sendContactEmail, setConsent,
  updateMailingList, updateMembership,
} from '@/server/audience';
import { addUser, changeUser, rateLimit, requireUser } from '@/server/auth';
import { assertOrigin, emailKey } from '@/server/config';
import {
  approvedCampaign, assertDeliveryReady, changeCampaign, mailContent, sendTest, sendTransactional, testSmtpRelay,
} from '@/server/delivery';
import { json, readBody, respondError } from '@/server/http';
import { retryDeadJob } from '@/server/jobs';
import { listmonk } from '@/server/listmonk';
import { mautic } from '@/server/mautic';
import { dashboard, defaultRange, saveCompany, senderDomain, settings } from '@/server/reporting';
import { umami } from '@/server/umami';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(1000).optional();
const subject = z.string().trim().min(1).max(160);
const html = z.string().trim().min(1).max(160_000);
const email = z.email().max(254);
const numberId = z.coerce.number().int().min(1).max(2_147_483_647);
const timestamp = z.coerce.number().int().min(0);
const roles = z.enum(['admin', 'marketer', 'analyst']);
const address = z.object({ email });
const siteId = z.uuid();
const url = z.url({ protocol: /^https?$/ }).max(500).or(z.literal(''));
const requiredUrl = z.url({ protocol: /^https?$/ }).max(500);
const company = z.object({
  name, website: url, accent: z.string().regex(/^#[0-9a-f]{6}$/i, 'Enter a six-digit hex colour.'),
  privacyUrl: url, postalAddress: z.string().trim().max(300),
});
const campaign = z.object({
  name, subject, body: html, listIds: z.array(numberId).min(1).max(50),
  altBody: z.string().max(100_000).optional(),
  contentType: z.enum(['html', 'richtext', 'markdown', 'plain']).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  archive: z.boolean().optional(),
  fromEmail: email.optional(), templateId: numberId.optional(),
});
const segmentFilter = z.object({
  glue: z.enum(['and', 'or']),
  field: z.string().trim().min(1).max(60),
  object: z.enum(['lead', 'company']).optional(),
  type: z.string().trim().max(40).optional(),
  operator: z.string().trim().min(1).max(40),
  filter: z.union([z.string().max(300), z.number(), z.array(z.string().max(100)).max(30)]),
});
const workflowStep = z.object({
  kind: z.enum(['email', 'tags', 'points', 'segment', 'stage']).optional(),
  emailId: z.number().int().min(0).max(2_147_483_647).default(0),
  delayMinutes: z.number().int().min(0).max(525_600),
  condition: z.enum(['opened_previous', 'clicked_previous']).optional(),
  addTags: z.array(z.string().trim().min(1).max(70)).max(20).optional(),
  removeTags: z.array(z.string().trim().min(1).max(70)).max(20).optional(),
  pointsDelta: z.number().int().min(-10000).max(10000).optional(),
  addSegmentIds: z.array(numberId).max(20).optional(),
  removeSegmentIds: z.array(numberId).max(20).optional(),
  stageId: numberId.optional(),
});
const workflow = z.object({
  name, description,
  segmentId: z.number().int().min(0).max(2_147_483_647).default(0),
  formId: numberId.optional(),
  steps: z.array(workflowStep).min(1).max(12),
}).refine(input => input.segmentId > 0 || (input.formId ?? 0) > 0, 'Select a trigger segment or lead form.')
  .refine(input => !input.steps[0].condition, 'The first step starts when a contact triggers the workflow.');
const formField = z.object({
  label: z.string().trim().min(1).max(100),
  alias: z.string().trim().regex(/^[a-z][a-z0-9_]{0,59}$/, 'Use lowercase letters, numbers and underscores for field aliases.'),
  type: z.enum(['text', 'email', 'textarea', 'select', 'checkboxgrp']),
  mappedField: z.string().trim().max(60).optional(),
  isRequired: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
});
const step = z.object({ type: z.enum(['event', 'path']), value: z.string().trim().min(1).max(200) });
const reportDate = z.object({ startAt: timestamp, endAt: timestamp }).refine(
  values => values.endAt > values.startAt && values.endAt - values.startAt <= 366 * 86_400_000,
  'Choose a date range of up to one year.',
);
const filterKeys: ReportDimension[] = [
  'path', 'referrer', 'title', 'query', 'hostname', 'channel', 'device', 'browser', 'os',
  'screen', 'country', 'region', 'city', 'language', 'event', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
];

type Context = {
  request: Request;
  user: User;
  params: string[];
  query: URLSearchParams;
};
type Handler = (context: Context) => Promise<unknown>;
type Entry = { method: string; path: RegExp; role: Role; handler: Handler };
const route = (method: string, path: RegExp, handler: Handler, role: Role = 'analyst'): Entry => ({ method, path, role, handler });
const id = (context: Context) => numberId.parse(context.params[0]);
const site = (context: Context) => siteId.parse(context.params[0]);
const page = (query: URLSearchParams) => z.coerce.number().int().min(1).max(100000).parse(query.get('page') ?? 1);
const date = (query: URLSearchParams) => query.has('startAt') || query.has('endAt')
  ? reportDate.parse({ startAt: query.get('startAt') ?? undefined, endAt: query.get('endAt') ?? undefined })
  : defaultRange();
function reportFilters(query: URLSearchParams): ReportFilters | undefined {
  const filters: ReportFilters = {};
  let hasAny = false;
  for (const key of filterKeys) {
    const val = query.get(key)?.trim();
    if (val) {
      filters[key] = val.slice(0, 300);
      hasAny = true;
    }
  }
  return hasAny ? filters : undefined;
}

const endpoints: Entry[] = [
  /* ── Overview ────────────────────────────────────────────────────────────── */
  route('GET', /^overview$/, dashboard),

  /* ── Audience: Contacts, Notes, Consent, Suppressions, Bulk ──────────────── */
  route('GET', /^contacts$/, async ({ query }) => contactDirectory({
    search: z.string().trim().max(128).optional().parse(query.get('q') ?? undefined),
    page: page(query),
    segmentId: query.has('segmentId') ? numberId.parse(query.get('segmentId')) : undefined,
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
  }))), 201), 'marketer'),
  route('PATCH', /^point-triggers\/(\d+)$/, async context => mautic.updatePointTrigger(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, points: z.number().int().min(1).max(100000).optional(), published: z.boolean().optional(), triggerExistingLeads: z.boolean().optional(),
  }))), 'marketer'),
  route('DELETE', /^point-triggers\/(\d+)$/, async context => {
    await mautic.deletePointTrigger(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),

  /* ── Campaigns, Templates, Media, Bounces & Transactional (Listmonk) ─────── */
  route('GET', /^campaigns$/, async ({ query }) => {
    const statusParam = query.get('status')?.trim();
    const statuses = statusParam && statusParam !== 'all' ? [statusParam] : undefined;
    const search = z.string().trim().max(120).optional().parse(query.get('q') ?? undefined);
    return listmonk.campaigns({ page: page(query), status: statuses, query: search });
  }),
  route('GET', /^campaigns\/running$/, async () => listmonk.runningCampaignStats()),
  route('POST', /^campaigns$/, async ({ request }) => {
    const made = await listmonk.createCampaign(approvedCampaign(await readBody(request, campaign)));
    await recordActivity('Newsletter draft created', '/campaigns');
    return json(made, 201);
  }, 'marketer'),
  route('GET', /^campaigns\/(\d+)$/, async context => listmonk.campaign(id(context))),
  route('PATCH', /^campaigns\/(\d+)$/, async context => listmonk.updateCampaign(id(context), approvedCampaign(await readBody(context.request, campaign))), 'marketer'),
  route('DELETE', /^campaigns\/(\d+)$/, async context => {
    await listmonk.deleteCampaign(id(context));
    await recordActivity('Newsletter deleted', '/campaigns');
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/clone$/, async context => {
    const body = await readBody(context.request, z.object({ name: name.optional() })).catch(() => ({ name: undefined }));
    const cloned = await listmonk.cloneCampaign(id(context), body.name);
    await recordActivity('Newsletter cloned', `/campaigns/${cloned.id}`);
    return json(cloned, 201);
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/cancel$/, async context => {
    const cancelled = await listmonk.cancelCampaign(id(context));
    await recordActivity('Newsletter cancelled', `/campaigns/${cancelled.id}`);
    return cancelled;
  }, 'marketer'),
  route('PATCH', /^campaigns\/(\d+)\/archive$/, async context => {
    const input = await readBody(context.request, z.object({
      archive: z.boolean(),
      archiveSlug: z.string().trim().regex(/^[a-z0-9-]*$/i, 'Use letters, numbers and dashes for archive slugs.').max(120).optional(),
    }));
    const updated = await listmonk.updateCampaignArchive(id(context), input);
    await recordActivity(input.archive ? 'Newsletter published to public archive' : 'Newsletter removed from public archive', `/campaigns/${updated.id}`);
    return updated;
  }, 'marketer'),
  route('GET', /^campaigns\/(\d+)\/preview$/, async context => new Response(await listmonk.previewCampaign(id(context)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }), 'marketer'),
  route('GET', /^campaigns\/(\d+)\/analytics$/, async context => {
    const campaignId = id(context);
    const range = date(context.query);
    const [views, clicks, bounces, links] = await Promise.all([
      listmonk.campaignTrend([campaignId], range, 'views').catch(() => null),
      listmonk.campaignTrend([campaignId], range, 'clicks').catch(() => null),
      listmonk.campaignTrend([campaignId], range, 'bounces').catch(() => null),
      listmonk.campaignLinks([campaignId], range).catch(() => []),
    ]);
    return { views, clicks, bounces, links };
  }),
  route('GET', /^campaigns\/(\d+)\/analytics\/export$/, async context => {
    const campaignId = id(context);
    const range = date(context.query);
    const metric = z.enum(['views', 'clicks', 'links', 'bounces']).parse(context.query.get('type') ?? 'views');
    let csv: string;
    if (metric === 'views' || metric === 'clicks') {
      csv = await listmonk.exportCampaignAnalytics(metric, [campaignId], range);
    } else if (metric === 'links') {
      const rows = await listmonk.campaignLinks([campaignId], range);
      csv = ['url,count', ...rows.map(r => `"${r.url.replaceAll('"', '""')}",${r.count}`)].join('\n') + '\n';
    } else {
      const pageData = await listmonk.bounces({ campaignId, page: 1, limit: 100 });
      csv = ['id,email,type,source,created_at', ...pageData.items.map(b =>
        `${b.id},"${b.email.replaceAll('"', '""')}","${b.type.replaceAll('"', '""')}","${b.source.replaceAll('"', '""')}","${b.createdAt ?? ''}"`,
      )].join('\n') + '\n';
    }
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="campaign-${campaignId}-${metric}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/test$/, async context => {
    const { email: targetEmail } = await readBody(context.request, address);
    await rateLimit('test:' + context.user.id, 8, 60);
    await rateLimit('test:repeat:' + id(context) + ':' + emailKey(targetEmail), 1, 30);
    await sendTest(id(context), targetEmail);
    return json({ queued: true }, 202);
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/schedule$/, async context => {
    const { sendAt } = await readBody(context.request, z.object({ sendAt: z.iso.datetime({ offset: true }) }));
    await rateLimit('send:' + context.user.id, 10, 60);
    return changeCampaign(id(context), 'schedule', sendAt);
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/start$/, async context => {
    await rateLimit('send:' + context.user.id, 10, 60);
    return changeCampaign(id(context), 'start');
  }, 'marketer'),
  route('POST', /^campaigns\/(\d+)\/pause$/, async context => changeCampaign(id(context), 'pause'), 'marketer'),
  route('GET', /^templates$/, async ({ query }) => {
    const kind = z.enum(['campaign', 'tx', 'all']).optional().parse(query.get('type') ?? undefined);
    return kind ? listmonk.templates({ type: kind }) : listmonk.templates();
  }, 'marketer'),
  route('POST', /^templates$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      name, body: html, type: z.enum(['campaign', 'tx']).optional(), subject: subject.optional(),
    }));
    const body = input.type === 'tx' ? input.body : mailContent(input.body, true);
    return json(await listmonk.createTemplate({ ...input, body }), 201);
  }, 'marketer'),
  route('PATCH', /^templates\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({
      name, body: html, type: z.enum(['campaign', 'tx']).optional(), subject: subject.optional(),
    }));
    const body = input.type === 'tx' ? input.body : mailContent(input.body, true);
    return listmonk.updateTemplate(id(context), { ...input, body });
  }, 'marketer'),
  route('DELETE', /^templates\/(\d+)$/, async context => {
    await listmonk.deleteTemplate(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^templates\/(\d+)\/default$/, async context => {
    await listmonk.setDefaultTemplate(id(context));
    return { isDefault: true };
  }, 'marketer'),
  route('GET', /^templates\/(\d+)\/preview$/, async context => new Response(await listmonk.previewTemplate(id(context)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }), 'marketer'),
  route('POST', /^templates\/preview$/, async ({ request }) => {
    const input = await readBody(request, z.object({ body: html, type: z.enum(['campaign', 'tx']).optional() }));
    return new Response(await listmonk.previewTemplateBody(input.body, input.type), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }, 'marketer'),
  route('DELETE', /^media\/(\d+)$/, async context => {
    await listmonk.deleteMedia(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^bounces$/, async ({ query }) => listmonk.bounces({
    page: page(query),
    campaignId: query.has('campaignId') ? numberId.parse(query.get('campaignId')) : undefined,
  }), 'marketer'),
  route('DELETE', /^bounces\/(\d+)$/, async context => {
    await listmonk.deleteBounce(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('POST', /^bounces\/blocklist$/, async ({ request }) => {
    const { ids } = await readBody(request, z.object({ ids: z.array(numberId).min(1).max(100) }));
    await listmonk.blocklistBounced(ids);
    return { blocklisted: ids.length };
  }, 'marketer'),
  route('POST', /^tx$/, async ({ request, user }) => {
    const input = await readBody(request, z.object({
      email, templateId: numberId, subject: subject.optional(),
      data: z.record(z.string(), z.unknown()).optional(),
    }));
    await rateLimit('tx:' + user.id, 15, 60);
    await sendTransactional(input);
    return json({ queued: true }, 202);
  }, 'marketer'),

  /* ── Automations: Workflows, Journey Emails, Forms, Assets, Pages, Webhooks */
  route('GET', /^forms$/, async () => mautic.forms(), 'marketer'),
  route('POST', /^forms$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      name, description, message: z.string().trim().max(500).optional(),
      published: z.boolean().optional(), fields: z.array(formField).min(1).max(20).optional(),
    }));
    return json(await mautic.createForm(input), 201);
  }, 'marketer'),
  route('PATCH', /^forms\/(\d+)$/, async context => mautic.updateForm(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, message: z.string().trim().max(500).optional(),
    published: z.boolean().optional(), fields: z.array(formField).min(1).max(20).optional(),
  }))), 'marketer'),
  route('DELETE', /^forms\/(\d+)$/, async context => {
    await mautic.deleteForm(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^forms\/(\d+)\/submissions$/, async context => mautic.formSubmissions(id(context), page(context.query)), 'marketer'),
  route('GET', /^journey-emails$/, async () => mautic.emails(), 'marketer'),
  route('POST', /^journey-emails$/, async ({ request }) => {
    const input = await readBody(request, z.object({ name, subject, body: html, published: z.boolean().optional() }));
    return json(await mautic.createEmail({ ...input, body: mailContent(input.body) }), 201);
  }, 'marketer'),
  route('PATCH', /^journey-emails\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({ name, subject, body: html, published: z.boolean().optional() }));
    return mautic.updateEmail(id(context), { ...input, body: mailContent(input.body) });
  }, 'marketer'),
  route('DELETE', /^journey-emails\/(\d+)$/, async context => {
    await mautic.deleteEmail(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^workflows$/, async () => mautic.workflows(), 'marketer'),
  route('POST', /^workflows$/, async ({ request }) => json(await mautic.createWorkflow(await readBody(request, workflow)), 201), 'marketer'),
  route('PATCH', /^workflows\/(\d+)$/, async context => mautic.updateWorkflow(id(context), await readBody(context.request, workflow)), 'marketer'),
  route('DELETE', /^workflows\/(\d+)$/, async context => {
    await mautic.deleteWorkflow(id(context));
    await recordActivity('Automation deleted', '/automations');
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^workflows\/(\d+)\/contacts$/, async context => mautic.workflowContacts(id(context)), 'marketer'),
  route('POST', /^workflows\/(\d+)\/status$/, async context => {
    const { enabled } = await readBody(context.request, z.object({ enabled: z.boolean() }));
    if (enabled) await assertDeliveryReady();
    const result = await mautic.setWorkflowEnabled(id(context), enabled);
    await recordActivity(result.enabled ? 'Automation activated' : 'Automation paused', '/automations');
    return result;
  }, 'marketer'),
  route('GET', /^assets$/, async () => mautic.assets(), 'marketer'),
  route('POST', /^assets$/, async ({ request }) => json(await mautic.createAsset(await readBody(request, z.object({
    title: name, description, remotePath: requiredUrl, published: z.boolean().optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^assets\/(\d+)$/, async context => mautic.updateAsset(id(context), await readBody(context.request, z.object({
    title: name.optional(), description, remotePath: requiredUrl.optional(), published: z.boolean().optional(),
  }))), 'marketer'),
  route('DELETE', /^assets\/(\d+)$/, async context => {
    await mautic.deleteAsset(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^pages$/, async () => mautic.pages(), 'marketer'),
  route('POST', /^pages$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      title: name, alias: z.string().trim().max(120).optional(),
      metaDescription: z.string().trim().max(300).optional(),
      customHtml: html, published: z.boolean().optional(),
    }));
    return json(await mautic.createPage({ ...input, customHtml: mailContent(input.customHtml) }), 201);
  }, 'marketer'),
  route('PATCH', /^pages\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({
      title: name.optional(), alias: z.string().trim().max(120).optional(),
      metaDescription: z.string().trim().max(300).optional(),
      customHtml: html.optional(), published: z.boolean().optional(),
    }));
    return mautic.updatePage(id(context), {
      ...input,
      ...(input.customHtml !== undefined ? { customHtml: mailContent(input.customHtml) } : {}),
    });
  }, 'marketer'),
  route('DELETE', /^pages\/(\d+)$/, async context => {
    await mautic.deletePage(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^webhooks$/, async () => mautic.webhooks(), 'admin'),
  route('GET', /^webhooks\/triggers$/, async () => mautic.webhookTriggers(), 'admin'),
  route('POST', /^webhooks$/, async ({ request }) => json(await mautic.createWebhook(await readBody(request, z.object({
    name, description, webhookUrl: requiredUrl, triggers: z.array(z.string().trim().min(1).max(120)).min(1).max(30),
    published: z.boolean().optional(),
  }))), 201), 'admin'),
  route('PATCH', /^webhooks\/(\d+)$/, async context => mautic.updateWebhook(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, webhookUrl: requiredUrl.optional(),
    triggers: z.array(z.string().trim().min(1).max(120)).min(1).max(30).optional(), published: z.boolean().optional(),
  }))), 'admin'),
  route('DELETE', /^webhooks\/(\d+)$/, async context => {
    await mautic.deleteWebhook(id(context));
    return new Response(null, { status: 204 });
  }, 'admin'),
  route('GET', /^dynamic-content$/, async () => mautic.dynamicContents(), 'marketer'),
  route('POST', /^dynamic-content$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      name,
      slotName: z.string().trim().regex(/^[a-z0-9_-]{1,80}$/i, 'Use letters, numbers, underscores or dashes for slot names.'),
      content: html,
      isCampaignBased: z.boolean().optional(),
      published: z.boolean().optional(),
    }));
    return json(await mautic.createDynamicContent(input), 201);
  }, 'marketer'),
  route('PATCH', /^dynamic-content\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({
      name: name.optional(),
      slotName: z.string().trim().regex(/^[a-z0-9_-]{1,80}$/i, 'Use letters, numbers, underscores or dashes for slot names.').optional(),
      content: html.optional(),
      isCampaignBased: z.boolean().optional(),
      published: z.boolean().optional(),
    }));
    return mautic.updateDynamicContent(id(context), input);
  }, 'marketer'),
  route('DELETE', /^dynamic-content\/(\d+)$/, async context => {
    await mautic.deleteDynamicContent(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^focus-items$/, async () => mautic.focusItems(), 'marketer'),
  route('POST', /^focus-items$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      name, description,
      type: z.enum(['form', 'notice', 'link']),
      style: z.enum(['bar', 'modal', 'notification', 'page']),
      headline: z.string().trim().max(200).optional(),
      tagline: z.string().trim().max(400).optional(),
      linkText: z.string().trim().max(120).optional(),
      linkUrl: url.optional(),
      formId: numberId.nullable().optional(),
      primaryColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      textColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      buttonColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      buttonTextColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      when: z.enum(['immediately', 'scroll_slight', 'scroll_middle', 'scroll_bottom', 'leave']).optional(),
      published: z.boolean().optional(),
    }));
    return json(await mautic.createFocusItem(input), 201);
  }, 'marketer'),
  route('PATCH', /^focus-items\/(\d+)$/, async context => {
    const input = await readBody(context.request, z.object({
      name: name.optional(), description,
      type: z.enum(['form', 'notice', 'link']).optional(),
      style: z.enum(['bar', 'modal', 'notification', 'page']).optional(),
      headline: z.string().trim().max(200).optional(),
      tagline: z.string().trim().max(400).optional(),
      linkText: z.string().trim().max(120).optional(),
      linkUrl: url.optional(),
      formId: numberId.nullable().optional(),
      primaryColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      textColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      buttonColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      buttonTextColor: z.string().trim().regex(/^#?[0-9a-f]{6}$/i).optional(),
      when: z.enum(['immediately', 'scroll_slight', 'scroll_middle', 'scroll_bottom', 'leave']).optional(),
      published: z.boolean().optional(),
    }));
    return mautic.updateFocusItem(id(context), input);
  }, 'marketer'),
  route('DELETE', /^focus-items\/(\d+)$/, async context => {
    await mautic.deleteFocusItem(id(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^reports$/, async () => mautic.reports()),
  route('GET', /^reports\/(\d+)$/, async context => {
    const limit = context.query.has('limit') ? z.coerce.number().int().min(1).max(200).parse(context.query.get('limit')) : 50;
    return mautic.report(id(context), limit);
  }),

  /* ── Analytics: Websites, Realtime, Sessions, Goals, Funnels, Insights ──── */
  route('GET', /^websites$/, async () => umami.websites()),
  route('POST', /^websites$/, async ({ request }) => {
    const added = await umami.createWebsite(await readBody(request, z.object({ name, domain: z.string().trim().min(1).max(255) })));
    await recordActivity('Website connected', '/analytics');
    return json(added, 201);
  }, 'marketer'),
  route('PATCH', /^websites\/([0-9a-f-]+)$/i, async context => umami.updateWebsite(site(context), await readBody(context.request, z.object({
    name, domain: z.string().trim().min(1).max(255),
  }))), 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteWebsite(site(context));
    await recordActivity('Website disconnected', '/analytics');
    return new Response(null, { status: 204 });
  }, 'admin'),
  route('POST', /^websites\/([0-9a-f-]+)\/reset$/i, async context => {
    await umami.resetWebsite(site(context));
    await recordActivity('Website analytics reset', '/analytics');
    return { reset: true };
  }, 'admin'),
  route('GET', /^websites\/([0-9a-f-]+)\/export$/i, async context => new Response(
    JSON.stringify(await umami.exportWebsite(site(context), date(context.query)), null, 2),
    {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="ovelio-analytics-${site(context)}.json"`,
        'Cache-Control': 'no-store',
      },
    },
  ), 'admin'),
  route('GET', /^websites\/([0-9a-f-]+)\/shares$/i, async context => umami.shares(site(context)), 'marketer'),
  route('POST', /^websites\/([0-9a-f-]+)\/shares$/i, async context => {
    const input = await readBody(context.request, z.object({ name }));
    return json(await umami.createShare(site(context), input.name), 201);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/shares\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteShare(siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/report$/i, async context =>
    umami.report(site(context), date(context.query), undefined, reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/metrics\/expanded$/i, async context => {
    const dim = z.enum([
      'path', 'entry', 'exit', 'title', 'query', 'hostname', 'referrer', 'channel',
      'device', 'browser', 'os', 'screen', 'country', 'region', 'city', 'language', 'event',
      'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
    ]).parse(context.query.get('type') ?? 'path') as ReportDimension;
    const limit = context.query.has('limit') ? z.coerce.number().int().min(1).max(100).parse(context.query.get('limit')) : 25;
    return umami.expandedMetrics(site(context), date(context.query), dim, reportFilters(context.query), limit);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/events$/i, async context => umami.eventsFeed(site(context), date(context.query), {
    page: page(context.query),
    pageSize: 25,
    search: z.string().trim().max(120).optional().parse(context.query.get('q') ?? undefined),
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/segments$/i, async context => {
    const type = z.enum(['segment', 'cohort']).parse(context.query.get('type') ?? 'segment');
    return umami.segments(site(context), type);
  }),
  route('POST', /^websites\/([0-9a-f-]+)\/segments$/i, async context => {
    const input = await readBody(context.request, z.object({
      name,
      type: z.enum(['segment', 'cohort']),
      filters: z.array(z.object({
        name: z.string().trim().min(1).max(40),
        operator: z.enum(['eq', 'neq', 'c', 'nc', 's', 'ns']),
        value: z.string().trim().min(1).max(300),
      })).max(20).optional(),
      match: z.enum(['all', 'any']).optional(),
      dateRange: z.string().trim().max(40).optional(),
      action: z.object({ type: z.enum(['path', 'event']), value: z.string().trim().min(1).max(200) }).optional(),
    }));
    return json(await umami.createSegment(site(context), input), 201);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/segments\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteSegment(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/revenue$/i, async context => {
    const currency = z.string().trim().regex(/^[A-Z]{3}$/).parse((context.query.get('currency') ?? 'USD').toUpperCase());
    const metricType = z.enum(['country', 'region', 'referrer', 'channel']).parse(context.query.get('type') ?? 'country') as RevenueMetricType;
    return umami.revenueReport(site(context), date(context.query), currency, metricType, reportFilters(context.query));
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/performance$/i, async context => {
    const metric = z.enum(['lcp', 'inp', 'cls', 'fcp', 'ttfb']).parse(context.query.get('metric') ?? 'lcp') as PerformanceMetricKey;
    const breakdownType = z.enum(['path', 'title', 'device', 'browser']).parse(context.query.get('type') ?? 'path') as PerformanceBreakdownType;
    return umami.performanceReport(site(context), date(context.query), metric, breakdownType, reportFilters(context.query));
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/realtime$/i, async context => umami.realtime(site(context))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions$/i, async context => umami.sessions(site(context), date(context.query), {
    page: page(context.query),
    pageSize: 25,
    search: z.string().trim().max(120).optional().parse(context.query.get('q') ?? undefined),
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/stats$/i, async context =>
    umami.sessionStats(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/properties$/i, async context =>
    umami.sessionProperties(site(context), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/properties\/values$/i, async context => {
    const propertyName = z.string().trim().min(1).max(200).parse(context.query.get('propertyName'));
    return umami.sessionPropertyValues(site(context), date(context.query), propertyName);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/weekly$/i, async context =>
    umami.weeklyTraffic(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/([0-9a-f-]+)\/activity$/i, async context =>
    umami.sessionActivity(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/sessions\/([0-9a-f-]+)\/properties$/i, async context =>
    umami.singleSessionProperties(site(context), siteId.parse(context.params[1]))),
  route('GET', /^websites\/([0-9a-f-]+)\/events\/properties$/i, async context =>
    umami.eventProperties(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/events\/values$/i, async context => {
    const eventName = z.string().trim().min(1).max(200).parse(context.query.get('event'));
    const propertyName = z.string().trim().min(1).max(200).parse(context.query.get('propertyName'));
    return umami.eventPropertyValues(site(context), date(context.query), eventName, propertyName);
  }),
  route('POST', /^websites\/([0-9a-f-]+)\/funnel$/i, async context => {
    const data = await readBody(context.request, z.object({
      startAt: timestamp, endAt: timestamp, steps: z.array(step).min(2).max(8),
      windowMinutes: z.number().int().min(1).max(1440).optional(),
    }));
    return umami.funnel(site(context), reportDate.parse(data), data.steps, data.windowMinutes);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/funnels$/i, async context => umami.funnels(site(context))),
  route('POST', /^websites\/([0-9a-f-]+)\/funnels$/i, async context => {
    const input = await readBody(context.request, z.object({
      name, description, steps: z.array(step).min(2).max(8), windowMinutes: z.number().int().min(1).max(10_080),
    }));
    return json(await umami.createFunnel(site(context), input), 201);
  }, 'marketer'),
  route('PATCH', /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)$/i, async context => {
    const input = await readBody(context.request, z.object({
      name, description, steps: z.array(step).min(2).max(8), windowMinutes: z.number().int().min(1).max(10_080),
    }));
    return umami.updateFunnel(site(context), siteId.parse(context.params[1]), input);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteFunnel(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)\/stats$/i, async context =>
    umami.funnelStats(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/goals$/i, async context => umami.goals(site(context))),
  route('POST', /^websites\/([0-9a-f-]+)\/goals$/i, async context => {
    const input = await readBody(context.request, z.object({ name, type: step.shape.type, value: step.shape.value }));
    return json(await umami.createGoal(site(context), input), 201);
  }, 'marketer'),
  route('PATCH', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context => {
    const input = await readBody(context.request, z.object({ name, type: step.shape.type, value: step.shape.value }));
    return umami.updateGoal(site(context), siteId.parse(context.params[1]), input);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteGoal(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context =>
    umami.goalStats(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/retention$/i, async context =>
    umami.retention(site(context), date(context.query), reportFilters(context.query))),
  route('GET', /^websites\/([0-9a-f-]+)\/journeys$/i, async context => umami.journeys(site(context), date(context.query), {
    steps: context.query.has('steps') ? z.coerce.number().int().min(2).max(7).parse(context.query.get('steps')) : 3,
    startStep: context.query.get('startStep')?.trim() || undefined,
    endStep: context.query.get('endStep')?.trim() || undefined,
    filters: reportFilters(context.query),
  })),
  route('GET', /^websites\/([0-9a-f-]+)\/attribution$/i, async context => umami.attribution(site(context), date(context.query), {
    model: z.enum(['first-click', 'last-click']).parse(context.query.get('model') ?? 'first-click'),
    type: z.enum(['path', 'event']).parse(context.query.get('type') ?? 'path'),
    step: z.string().trim().min(1).max(300).parse(context.query.get('step')),
  })),
  route('POST', /^websites\/([0-9a-f-]+)\/breakdown$/i, async context => {
    const data = await readBody(context.request, z.object({
      startAt: timestamp, endAt: timestamp,
      fields: z.array(z.string().trim().min(1).max(40)).min(1).max(4),
      filters: z.record(z.string(), z.string().max(300)).optional(),
    }));
    return umami.breakdown(site(context), reportDate.parse(data), data.fields, data.filters as ReportFilters | undefined);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/annotations$/i, async context =>
    umami.annotations(site(context), context.query.has('startAt') ? date(context.query) : undefined)),
  route('POST', /^websites\/([0-9a-f-]+)\/annotations$/i, async context => {
    const input = await readBody(context.request, z.object({
      date: z.string().trim().min(1).max(40), allDay: z.boolean().optional(), note: z.string().trim().min(1).max(500),
    }));
    return json(await umami.createAnnotation(site(context), input), 201);
  }, 'marketer'),
  route('DELETE', /^websites\/([0-9a-f-]+)\/annotations\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteAnnotation(site(context), siteId.parse(context.params[1]));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^links$/, async () => umami.links()),
  route('GET', /^links\/charts$/, async ({ query }) => {
    const ids = (query.get('ids') ?? '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 20).map(v => siteId.parse(v));
    return umami.linkCharts(ids, query.has('startAt') ? date(query) : undefined);
  }),
  route('POST', /^links$/, async ({ request }) => json(await umami.createLink(await readBody(request, z.object({
    name, url: requiredUrl, slug: z.string().trim().min(8).max(100).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^links\/([0-9a-f-]+)$/i, async context => umami.updateLink(site(context), await readBody(context.request, z.object({
    name: name.optional(), url: requiredUrl.optional(), slug: z.string().trim().min(8).max(100).optional(),
  }))), 'marketer'),
  route('DELETE', /^links\/([0-9a-f-]+)$/i, async context => {
    await umami.deleteLink(site(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),
  route('GET', /^pixels$/, async () => umami.pixels()),
  route('GET', /^pixels\/charts$/, async ({ query }) => {
    const ids = (query.get('ids') ?? '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 20).map(v => siteId.parse(v));
    return umami.pixelCharts(ids, query.has('startAt') ? date(query) : undefined);
  }),
  route('POST', /^pixels$/, async ({ request }) => json(await umami.createPixel(await readBody(request, z.object({
    name, slug: z.string().trim().min(8).max(100).optional(),
  }))), 201), 'marketer'),
  route('PATCH', /^pixels\/([0-9a-f-]+)$/i, async context => umami.updatePixel(site(context), await readBody(context.request, z.object({
    name: name.optional(), slug: z.string().trim().min(8).max(100).optional(),
  }))), 'marketer'),
  route('DELETE', /^pixels\/([0-9a-f-]+)$/i, async context => {
    await umami.deletePixel(site(context));
    return new Response(null, { status: 204 });
  }, 'marketer'),

  /* ── Settings, Team, SMTP Diagnostics & Maintenance ─────────────────────── */
  route('GET', /^settings$/, async ({ user }) => settings(user.role === 'admin')),
  route('PATCH', /^settings$/, async ({ request }) => {
    const input = await readBody(request, z.object({ company }));
    await saveCompany(input.company);
    return settings(true);
  }, 'admin'),
  route('GET', /^settings\/sender-domain$/, senderDomain, 'admin'),
  route('POST', /^settings\/smtp\/test$/, async ({ request, user }) => {
    const { email: targetEmail } = await readBody(request, address);
    await rateLimit('smtp-test:' + user.id, 5, 60);
    await testSmtpRelay(targetEmail);
    return { sent: true };
  }, 'admin'),
  route('POST', /^settings\/maintenance$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      action: z.enum(['gc_unconfirmed', 'gc_orphan', 'gc_blocklisted', 'gc_analytics']),
      beforeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }));
    const cutoffIso = input.beforeDate
      ? new Date(input.beforeDate + 'T00:00:00.000Z').toISOString()
      : new Date(Date.now() - 90 * 86_400_000).toISOString();
    if (input.action === 'gc_unconfirmed') return listmonk.cleanupUnconfirmed(input.beforeDate ? cutoffIso : new Date().toISOString());
    if (input.action === 'gc_orphan') return listmonk.cleanupSubscribers('orphan');
    if (input.action === 'gc_blocklisted') return listmonk.cleanupSubscribers('blocklisted');
    await listmonk.cleanupAnalytics('all', cutoffIso);
    return { count: 0 };
  }, 'admin'),
  route('POST', /^settings\/jobs\/(\d+)\/retry$/, async context => retryDeadJob(context.params[0]), 'admin'),
  route('POST', /^settings\/team$/, async ({ request }) => {
    const input = await readBody(request, z.object({ name, email, role: roles, password: z.string().min(14).max(128) }));
    return json(await addUser(input), 201);
  }, 'admin'),
  route('PATCH', /^settings\/team\/([0-9a-f-]+)$/i, async context => {
    const input = await readBody(context.request, z.object({
      role: roles.optional(), password: z.string().min(14).max(128).optional(), disabled: z.boolean().optional(),
    }));
    return changeUser(siteId.parse(context.params[0]), input);
  }, 'admin'),
];

async function dispatch(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    for (const entry of endpoints) {
      if (entry.method !== request.method) continue;
      const match = entry.path.exec(path.join('/'));
      if (!match) continue;
      const user = await requireUser(entry.role);
      if (request.method !== 'GET') {
        assertOrigin(request);
        await rateLimit('console:write:' + user.id, 180, 60);
      }
      const result = await entry.handler({ request, user, params: match.slice(1), query: new URL(request.url).searchParams });
      return result instanceof Response ? result : json(result);
    }
    return json({ error: 'This action could not be found.' }, 404);
  } catch (error) {
    return respondError('console', error);
  }
}

export { dispatch as GET, dispatch as POST, dispatch as PATCH, dispatch as DELETE };
