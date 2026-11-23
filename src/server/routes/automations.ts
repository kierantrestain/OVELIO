import { z } from 'zod';
import { maxWorkflowNodes, maxWorkflowSteps } from '@/contracts';
import { recordActivity } from '@/server/activity';
import { assertDeliveryReady, mailContent } from '@/server/delivery';
import { json, readBody } from '@/server/http';
import { mautic } from '@/server/mautic';
import { name, description, subject, html, numberId, url, requiredUrl, route, id, page } from './shared';
import type { Entry } from './shared';

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

const nodeId = z.string().regex(/^(\d{1,10}|new[A-Za-z0-9_-]{0,40})$/, 'Use a saved step id or a temporary id starting with "new".');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Write times as HH:MM.');

// AUT-02: one entry per Mautic event; trigger fields mirror Event.php's trigger_* columns.
const workflowSchedule = z.object({
  mode: z.enum(['immediate', 'interval', 'date', 'optimized']).nullable(),
  interval: z.number().int().min(0).max(1_000_000),
  unit: z.enum(['i', 'h', 'd', 'm', 'y']).nullable(),
  date: z.string().trim().max(40).nullable(),
  hour: clockTime.nullable(),
  restrictedStartHour: clockTime.nullable(),
  restrictedStopHour: clockTime.nullable(),
  restrictedDaysOfWeek: z.array(z.number().int().min(-1).max(6)).max(8),
  window: z.number().int().min(0).max(1_000_000).nullable(),
});

const workflowNode = z.object({
  id: nodeId,
  parentId: nodeId.nullable(),
  branch: z.enum(['yes', 'no']).nullable(),
  eventType: z.enum(['action', 'decision', 'condition']),
  type: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(191),
  description: z.string().max(1000).default(''),
  properties: z.record(z.string(), z.unknown()),
  schedule: workflowSchedule,
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

const workflowGraph = z.object({
  segmentIds: z.array(numberId).max(20),
  formIds: z.array(numberId).max(20),
  allowRestart: z.boolean().default(false),
  nodes: z.array(workflowNode).min(1).max(maxWorkflowNodes),
});

const workflow = z.object({
  name, description,
  segmentId: z.number().int().min(0).max(2_147_483_647).default(0),
  formId: numberId.optional(),
  steps: z.array(workflowStep).max(maxWorkflowSteps).default([]),
  graph: workflowGraph.optional(),
  removedNodeIds: z.array(z.string().regex(/^\d{1,10}$/)).max(maxWorkflowNodes).optional(),
}).refine(input => input.graph || input.segmentId > 0 || (input.formId ?? 0) > 0, 'Select a trigger segment or lead form.')
  .refine(input => input.graph || input.steps.length > 0, 'Add at least one workflow step.')
  .refine(input => input.graph || !input.steps[0]?.condition, 'The first step starts when a contact triggers the workflow.');

const shortText = z.string().max(500);
const formField = z.object({
  id: numberId.optional(),
  label: z.string().trim().min(1).max(100),
  alias: z.string().trim().regex(/^[a-z][a-z0-9_]{0,59}$/, 'Use lowercase letters, numbers and underscores for field aliases.'),
  type: z.string().trim().min(1).max(40),
  mappedObject: z.string().trim().max(30).optional(),
  mappedField: z.string().trim().max(60).optional(),
  isRequired: z.boolean().optional(),
  showLabel: z.boolean().optional(),
  defaultValue: shortText.optional(),
  helpMessage: shortText.optional(),
  validationMessage: shortText.optional(),
  labelAttributes: z.string().max(191).optional(),
  inputAttributes: z.string().max(191).optional(),
  containerAttributes: z.string().max(191).optional(),
  fieldWidth: z.enum(['100%', '75%', '66.66%', '50%', '33.33%', '25%']).optional(),
  saveResult: z.boolean().optional(),
  alwaysDisplay: z.boolean().optional(),
  showWhenValueExists: z.boolean().optional(),
  showAfterXSubmissions: z.number().int().min(0).max(1_000_000).optional(),
  isReadOnly: z.boolean().optional(),
  isAutoFill: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
  parent: z.union([z.string(), z.number()]).nullable().optional(),
  conditions: z.unknown().optional(),
});

const formAction = z.object({
  id: numberId.optional(),
  type: z.string().trim().min(1).max(60),
  name: z.string().trim().max(191).default(''),
  description: z.string().max(1000).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
});

const formBody = {
  message: z.string().trim().max(500).optional(),
  postAction: z.enum(['message', 'redirect', 'return', 'hideform']).optional(),
  redirectUrl: z.string().trim().max(2000).optional(),
  published: z.boolean().optional(),
  fields: z.array(formField).min(1).max(60).optional(),
  actions: z.array(formAction).max(30).optional(),
};

export const automationsEndpoints: Entry[] = [
  /* ── Automations: Workflows, Journey Emails, Forms, Assets, Pages, Webhooks */
  route('GET', /^forms$/, async () => mautic.forms(), 'marketer'),
  route('GET', /^forms\/users$/, async () => mautic.formActionUsers(), 'marketer'),
  route('POST', /^forms$/, async ({ request }) => {
    const input = await readBody(request, z.object({
      name, description, ...formBody,
    }));
    return json(await mautic.createForm(input), 201);
  }, 'marketer'),
  route('PATCH', /^forms\/(\d+)$/, async context => mautic.updateForm(id(context), await readBody(context.request, z.object({
    name: name.optional(), description, ...formBody,
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
];
