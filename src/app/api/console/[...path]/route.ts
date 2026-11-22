import { z } from 'zod';
import type { Role, User } from '@/contracts';
import { recordActivity } from '@/server/activity';
import {
  contactDetail, contactDirectory, contactFields, enqueueSegmentSync, exportContact, exportContacts,
  importContacts, requestErasure, saveContact, setConsent, updateMailingList, updateMembership,
} from '@/server/audience';
import { addUser, changeUser, rateLimit, requireUser } from '@/server/auth';
import { assertOrigin, emailKey } from '@/server/config';
import { approvedCampaign, assertDeliveryReady, changeCampaign, mailContent, sendTest } from '@/server/delivery';
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
const company = z.object({
  name, website: url, accent: z.string().regex(/^#[0-9a-f]{6}$/i, 'Enter a six-digit hex colour.'),
  privacyUrl: url, postalAddress: z.string().trim().max(300),
});
const campaign = z.object({
  name, subject, body: html, listIds: z.array(numberId).min(1).max(50),
  fromEmail: email.optional(), templateId: numberId.optional(),
});
const workflow = z.object({
  name, description, segmentId: numberId,
  steps: z.array(z.object({
    emailId: numberId, delayMinutes: z.number().int().min(0).max(525_600),
    condition: z.enum(['opened_previous', 'clicked_previous']).optional(),
  })).min(1).max(12),
}).refine(input => !input.steps[0].condition, 'The first step starts when a contact joins the segment.');
const step = z.object({ type: z.enum(['event', 'path']), value: z.string().trim().min(1).max(200) });
const reportDate = z.object({ startAt: timestamp, endAt: timestamp }).refine(
  values => values.endAt > values.startAt && values.endAt - values.startAt <= 366 * 86_400_000,
  'Choose a date range of up to one year.',
);

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

const endpoints: Entry[] = [
  route('GET', /^overview$/, dashboard),
  route('GET', /^contacts$/, async ({ query }) => contactDirectory({
    search: z.string().trim().max(128).optional().parse(query.get('q') ?? undefined),
    page: page(query), segmentId: query.has('segmentId') ? numberId.parse(query.get('segmentId')) : undefined,
  }), 'marketer'),
  route('POST', /^contacts$/, async ({ request }) => {
    const contact = await saveContact(await readBody(request, contactFields));
    await recordActivity('Contact saved', '/audience');
    return json(contact, 201);
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
    const email = input.email ?? (await mautic.contact(contactId)).email;
    return saveContact({ ...input, email }, contactId);
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
  route('GET', /^segments$/, async () => mautic.segments(), 'marketer'),
  route('POST', /^segments$/, async ({ request }) => json(await mautic.createSegment(await readBody(request, z.object({ name, description }))), 201), 'marketer'),
  route('POST', /^segments\/(\d+)\/sync$/, async context => {
    await enqueueSegmentSync(id(context));
    return json({ queued: true }, 202);
  }, 'marketer'),
  route('GET', /^lists$/, async () => listmonk.lists(), 'marketer'),
  route('POST', /^lists$/, async ({ request }) => json(await listmonk.createList(await readBody(request, z.object({ name }))), 201), 'marketer'),
  route('GET', /^campaigns$/, async ({ query }) => listmonk.campaigns({ page: page(query) })),
  route('POST', /^campaigns$/, async ({ request }) => {
    const made = await listmonk.createCampaign(approvedCampaign(await readBody(request, campaign)));
    await recordActivity('Newsletter draft created', '/campaigns');
    return json(made, 201);
  }, 'marketer'),
  route('GET', /^campaigns\/(\d+)$/, async context => listmonk.campaign(id(context))),
  route('PATCH', /^campaigns\/(\d+)$/, async context => listmonk.updateCampaign(id(context), approvedCampaign(await readBody(context.request, campaign))), 'marketer'),
  route('GET', /^campaigns\/(\d+)\/preview$/, async context => new Response(await listmonk.previewCampaign(id(context)), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  }), 'marketer'),
  route('POST', /^campaigns\/(\d+)\/test$/, async context => {
    const { email } = await readBody(context.request, address);
    await rateLimit('test:' + context.user.id, 8, 60);
    await rateLimit('test:repeat:' + id(context) + ':' + emailKey(email), 1, 30);
    await sendTest(id(context), email);
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
  route('GET', /^templates$/, async () => listmonk.templates(), 'marketer'),
  route('POST', /^templates$/, async ({ request }) => {
    const input = await readBody(request, z.object({ name, body: html }));
    return json(await listmonk.createTemplate({ ...input, body: mailContent(input.body) }), 201);
  }, 'marketer'),
  route('GET', /^forms$/, async () => mautic.forms(), 'marketer'),
  route('POST', /^forms$/, async ({ request }) => {
    const input = await readBody(request, z.object({ name, message: z.string().trim().max(500).optional() }));
    return json(await mautic.createForm(input), 201);
  }, 'marketer'),
  route('GET', /^journey-emails$/, async () => mautic.emails(), 'marketer'),
  route('POST', /^journey-emails$/, async ({ request }) => {
    const input = await readBody(request, z.object({ name, subject, body: html }));
    return json(await mautic.createEmail({ ...input, body: mailContent(input.body) }), 201);
  }, 'marketer'),
  route('GET', /^workflows$/, async () => mautic.workflows(), 'marketer'),
  route('POST', /^workflows$/, async ({ request }) => json(await mautic.createWorkflow(await readBody(request, workflow)), 201), 'marketer'),
  route('PATCH', /^workflows\/(\d+)$/, async context => mautic.updateWorkflow(id(context), await readBody(context.request, workflow)), 'marketer'),
  route('POST', /^workflows\/(\d+)\/status$/, async context => {
    const { enabled } = await readBody(context.request, z.object({ enabled: z.boolean() }));
    if (enabled) await assertDeliveryReady();
    const result = await mautic.setWorkflowEnabled(id(context), enabled);
    await recordActivity(result.enabled ? 'Automation activated' : 'Automation paused', '/automations');
    return result;
  }, 'marketer'),
  route('GET', /^websites$/, async () => umami.websites()),
  route('POST', /^websites$/, async ({ request }) => {
    const added = await umami.createWebsite(await readBody(request, z.object({ name, domain: z.string().trim().min(1).max(255) })));
    await recordActivity('Website connected', '/analytics');
    return json(added, 201);
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/report$/i, async context => umami.report(site(context), date(context.query))),
  route('POST', /^websites\/([0-9a-f-]+)\/funnel$/i, async context => {
    const data = await readBody(context.request, z.object({
      startAt: timestamp, endAt: timestamp, steps: z.array(step).min(2).max(8),
      windowMinutes: z.number().int().min(1).max(1440).optional(),
    }));
    return umami.funnel(site(context), reportDate.parse(data), data.steps, data.windowMinutes);
  }),
  route('GET', /^websites\/([0-9a-f-]+)\/goals$/i, async context => umami.goals(site(context))),
  route('POST', /^websites\/([0-9a-f-]+)\/goals$/i, async context => {
    const input = await readBody(context.request, z.object({ name, type: step.shape.type, value: step.shape.value }));
    return json(await umami.createGoal(site(context), input), 201);
  }, 'marketer'),
  route('GET', /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i, async context =>
    umami.goalStats(site(context), siteId.parse(context.params[1]), date(context.query))),
  route('GET', /^settings$/, async ({ user }) => settings(user.role === 'admin')),
  route('PATCH', /^settings$/, async ({ request }) => {
    const input = await readBody(request, z.object({ company }));
    await saveCompany(input.company);
    return settings(true);
  }, 'admin'),
  route('GET', /^settings\/sender-domain$/, senderDomain, 'admin'),
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
