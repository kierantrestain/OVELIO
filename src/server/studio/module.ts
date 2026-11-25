// Lane module: Email Studio (docs/rebuild/TRACKER.md §3). The lead registers this file once; keep its export shape.
import { z } from 'zod';
import type { User } from '@/contracts';
import type { SearchResult } from '@/contracts/platform';
import { mergeTags, renderMergeTags, unknownMergeTags } from '@/contracts/merge-tags';
import type {
  AudienceEstimate, DesignStatus, EmailTemplateSummary, EngineExport, RenderedPreview, SampleContact, SentMessage, StoredMessage, TestSendResult,
} from '@/contracts/studio';
import { emailTemplates, findTemplate, templateSummary } from '@/templates/email';
import { rateLimit } from '../auth';
import { AppError } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { devPreviewContacts, isDevPreviewMode } from '../dev-preview';
import { getContact, searchContacts } from '../directory';
import { json, readBody } from '../http';
import { mergeValues, sendDesign } from '../mailer';
import type { LaneModule } from '../platform/types';
import { route } from '../routes/shared';
import type { Context } from '../routes/shared';
import { applyBrand, brandInput, getBrand, saveBrand, workspaceProfile } from './brand';
import { compileMjml, htmlToMjml } from './compile';
import { fromListmonkHtml, toListmonkHtml, toMauticHtml } from './convert';
import {
  compileDesign, createDesign, duplicateDesign, findLink, getDesign, getVersion, linkDesign, listDesigns, listVersions, restoreVersion,
  saveDesign, saveVersion, setStatus,
} from './designs';
import { studioMarker } from './sanitize';

const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const source = z.string().max(600_000);
const documentData = z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length < 3_000_000, 'The design is too large to save.');
const kind = z.enum(['email', 'email_block']);
const linkEngine = z.enum(['listmonk_campaign', 'listmonk_template', 'mautic_email']);

const createInput = z.object({
  kind: kind.default('email'),
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().max(200).optional(),
  preheader: z.string().trim().max(200).optional(),
  templateKey: z.string().max(60).optional(),
  source: source.optional(),
  /** Imports existing HTML (a Listmonk newsletter or template) as one raw-HTML section. */
  importHtml: z.string().max(600_000).optional(),
  link: z.object({ engine: linkEngine, engineId: z.string().min(1).max(60), label: z.string().max(160).default('') }).optional(),
});

const patchInput = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().max(200).optional(),
  preheader: z.string().trim().max(200).optional(),
  source: source.optional(),
  document: documentData.optional(),
  status: z.enum(['draft', 'ready', 'archived']).optional(),
});

const blankEmail = `<mjml lang="en"><mj-body width="600px" background-color="#f3f4f6"><mj-section background-color="#ffffff" padding="24px 0"><mj-column><mj-text font-size="15px" line-height="1.6" color="#111827" padding="8px 32px">Hi {{contact.first_name | there}}, start writing here.</mj-text></mj-column></mj-section><mj-section background-color="#f3f4f6"><mj-column><mj-text font-size="12px" color="#6b7280" align="center" padding="20px 32px">{{workspace.name}} · {{workspace.address}}<br><a href="{{unsubscribe_url}}" style="color:#6b7280">Unsubscribe</a></mj-text></mj-column></mj-section></mj-body></mjml>`;

let templateCache: { brandKey: string; html: Map<string, string> } | undefined;

/** Thumbnails and gallery previews show example values (Ada, your company) instead of raw merge tags. */
async function withExamples(html: string) {
  const company = await workspaceProfile();
  const values: Record<string, string> = Object.fromEntries(mergeTags.map(tag => [tag.tag, tag.example]));
  Object.assign(values, { 'workspace.name': company.name, 'workspace.address': company.postalAddress || values['workspace.address'], 'workspace.website': company.website || values['workspace.website'], unsubscribe_url: '#' });
  return renderMergeTags(html, values);
}

async function templateHtml(key: string) {
  const template = findTemplate(key);
  if (!template) throw new AppError(404, 'That template was not found.');
  const brand = await getBrand();
  const brandKey = JSON.stringify(brand);
  if (templateCache?.brandKey !== brandKey) templateCache = { brandKey, html: new Map() };
  const cached = templateCache.html.get(key);
  if (cached) return cached;
  const compiled = await compileMjml(applyBrand(template.mjml, brand), { preheader: applyBrand(template.preheader, brand), title: applyBrand(template.subject, brand) });
  const html = await withExamples(compiled.html);
  templateCache.html.set(key, html);
  return html;
}

async function workspaceValues() {
  const company = await workspaceProfile();
  return { name: company.name, address: company.postalAddress ?? '', website: company.website ?? '' };
}

const toSample = (contact: { id: number; name: string; email: string; consent: string; suppressed: boolean }): SampleContact => ({
  id: contact.id, name: contact.name, email: contact.email, consent: contact.consent, suppressed: contact.suppressed,
});

async function render(designId: string, contactId: number | null): Promise<RenderedPreview> {
  const design = await getDesign(designId);
  const contact = contactId ? await getContact(contactId) : null;
  const company = await workspaceProfile();
  const values = mergeValues(contact, contact?.email ?? 'sample@example.com', company);
  return {
    subject: renderMergeTags(design.subject, values, { html: false }),
    preheader: renderMergeTags(design.preheader, values, { html: false }),
    html: renderMergeTags(design.html, values),
    contact: contact ? toSample(contact) : null,
    unknownTags: unknownMergeTags(design.source + design.subject + design.preheader),
  };
}

type MessageRow = {
  id: string; to_email: string; subject: string; status: SentMessage['status']; status_reason: string; category: string; created_at: Date;
  sent_at: Date | null; creator: string | null; html?: string; text_body?: string; from_email?: string; from_name?: string;
};
const toMessage = (row: MessageRow): SentMessage => ({
  id: row.id, to: row.to_email, subject: row.subject, status: row.status, reason: row.status_reason, category: row.category,
  createdAt: new Date(row.created_at).toISOString(), sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null, createdBy: row.creator,
});

/** Who a newsletter to these lists reaches: eligible (consent recorded, not suppressed) versus excluded. */
async function audience(listIds: number[]): Promise<AudienceEstimate> {
  if (isDevPreviewMode()) {
    const { handleDevPreviewConsole } = await import('../dev-preview');
    const response = await handleDevPreviewConsole(new Request('http://preview.local/api/console/lists'), ['lists']);
    const lists = await response.json() as { id: number; name: string; subscriberCount: number | null; optin?: string }[];
    const contacts = devPreviewContacts();
    const reached = new Set<number>();
    const left = new Set<number>();
    const rows = lists.filter(list => listIds.includes(list.id)).map(list => {
      const members = contacts.filter(contact => (contact.mailingListIds ?? []).includes(list.id));
      const ok = members.filter(contact => contact.consent === 'opted_in' && !contact.suppressed);
      ok.forEach(contact => reached.add(contact.id));
      members.filter(contact => !ok.includes(contact)).forEach(contact => left.add(contact.id));
      // Subscribers with no matching contact have no consent record, so they are excluded too.
      const subscribers = Math.max(list.subscriberCount ?? members.length, members.length);
      for (let extra = members.length; extra < subscribers; extra++) left.add(-(list.id * 100_000 + extra));
      return { id: list.id, name: list.name, subscribers, eligible: ok.length, excluded: subscribers - ok.length, optin: list.optin ?? '' };
    });
    for (const id of reached) left.delete(id);
    return { lists: rows, eligible: reached.size, excluded: left.size, sampled: false, note: 'Counted from the sample contacts in this preview.' };
  }
  const { listmonk } = await import('../listmonk');
  const { emailKey } = await import('../config');
  const all = await listmonk.lists();
  const cap = 5000;
  let sampled = false;
  const reached = new Set<string>();
  const left = new Set<string>();
  const rows = [];
  for (const list of all.filter(item => listIds.includes(item.id))) {
    const emails: string[] = [];
    for (let page = 1; emails.length < cap; page++) {
      const batch = await listmonk.listSubscribers(list.id, page, 100);
      emails.push(...batch.items.map(item => item.email.toLowerCase()));
      if (batch.items.length < 100) break;
      if (emails.length >= cap) sampled = true;
    }
    const keys = emails.map(email => emailKey(email));
    const allowed = new Set((await db.query<{ email_key: string }>(
      `SELECT email_key FROM contact_state WHERE email_key = ANY($1::text[]) AND consent = 'opted_in'
       AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email_key = contact_state.email_key)`, [keys])).rows.map(row => row.email_key));
    const ok = keys.filter(key => allowed.has(key));
    ok.forEach(key => reached.add(key));
    keys.filter(key => !allowed.has(key)).forEach(key => left.add(key));
    rows.push({ id: list.id, name: list.name, subscribers: list.subscriberCount, eligible: ok.length, excluded: keys.length - ok.length, optin: list.optin ?? '' });
  }
  for (const key of reached) left.delete(key);
  return {
    lists: rows, eligible: reached.size, excluded: left.size, sampled,
    note: sampled ? `Counted the first ${cap.toLocaleString('en-GB')} subscribers of each large list.` : 'Counted from newsletter subscribers and OVELIO consent records.',
  };
}

async function designsEndpoint({ query }: Context) {
  const items = await listDesigns({ kind: kind.parse(query.get('kind') ?? 'email'), status: query.get('status') ?? undefined, q: query.get('q') ?? undefined });
  return { items };
}

async function seed(sql: Sql) {
  const existing = await sql.query(`SELECT 1 FROM designs WHERE kind = 'email' LIMIT 1`);
  if (existing.rows.length) return;
  const { updatedAt: _updatedAt, ...defaults } = await getBrand(sql);
  void _updatedAt;
  await sql.query(`INSERT INTO studio_brand_kits (id, kit) VALUES ('default', $1) ON CONFLICT (id) DO NOTHING`, [JSON.stringify({
    ...defaults, footerText: 'You are receiving this sample email because you subscribed to OVELIO product news.',
    social: [{ network: 'linkedin', url: 'https://linkedin.example/company/ovelio' }, { network: 'instagram', url: 'https://instagram.example/ovelio' }],
  })]);
  const brand = await getBrand(sql);
  const samples: [string, string][] = [
    ['newsletter-digest', 'Spring product dispatch'], ['event-webinar', 'Webinar invite: email meets analytics'],
    ['welcome-hello', 'Welcome series · day 1'], ['promo-sale', 'Spring sale weekend'], ['tx-receipt', 'Order receipt (sample)'],
  ];
  for (const [key, name] of samples) {
    const template = findTemplate(key)!;
    await createDesign({
      kind: 'email', name, subject: applyBrand(template.subject, brand), preheader: applyBrand(template.preheader, brand),
      source: applyBrand(template.mjml, brand), templateKey: key, category: template.category, userId: null,
    }, sql);
  }
  await createDesign({
    kind: 'email_block', name: 'Sample block: help centre banner', category: 'Saved block', userId: null,
    source: `<mj-section background-color="${brand.background}" padding="16px 0"><mj-column><mj-text align="center" font-size="15px" color="${brand.text}" padding="8px 32px"><strong>Need a hand?</strong> Our help centre answers the most common questions.</mj-text><mj-button href="${brand.website || '#'}" background-color="${brand.primary}" color="#ffffff" border-radius="6px" padding="8px 32px">Visit the help centre</mj-button></mj-column></mj-section>`,
  }, sql);
}

export const studioModule: LaneModule = {
  name: 'studio',
  endpoints: [
    route('GET', /^studio\/designs$/, designsEndpoint),
    route('POST', /^studio\/designs$/, async ({ request, user }) => {
      const input = await readBody(request, createInput, 4 * 1024 * 1024);
      const brand = await getBrand();
      if (input.templateKey) {
        const template = findTemplate(input.templateKey);
        if (!template) throw new AppError(404, 'That template was not found.');
        return json(await createDesign({
          kind: 'email', name: input.name ?? template.name, subject: applyBrand(template.subject, brand), preheader: applyBrand(template.preheader, brand),
          source: applyBrand(template.mjml, brand), templateKey: template.key, category: template.category, userId: user.id,
        }), 201);
      }
      const mjml = input.importHtml ? htmlToMjml(fromListmonkHtml(input.importHtml)) : input.source ?? (input.kind === 'email' ? blankEmail : '');
      if (!mjml.trim()) throw new AppError(400, 'Add the block content.');
      const created = await createDesign({
        kind: input.kind, name: input.name ?? (input.kind === 'email' ? 'Untitled email' : 'Saved block'), subject: input.subject, preheader: input.preheader,
        source: mjml, category: input.importHtml ? 'Imported' : input.kind === 'email_block' ? 'Saved block' : '', userId: user.id,
      });
      if (input.link) await linkDesign(created.id, input.link);
      return json(created, 201);
    }, 'marketer'),
    route('GET', /^studio\/blocks$/, async () => {
      const result = await db.query<{ id: string; name: string; source: string; html: string }>(
        `SELECT id, name, source, html FROM designs WHERE kind = 'email_block' AND status <> 'archived' ORDER BY updated_at DESC LIMIT 100`);
      return { items: result.rows };
    }, 'marketer'),
    route('GET', new RegExp(`^studio/designs/${uuid}/html$`), async ({ params }) => {
      const found = (await db.query<{ html: string }>(`SELECT html FROM designs WHERE id = $1 AND kind IN ('email', 'email_block')`, [params[0]])).rows[0];
      if (!found) throw new AppError(404, 'That email design was not found.');
      return { html: await withExamples(found.html) };
    }),
    route('GET', new RegExp(`^studio/designs/${uuid}$`), async ({ params }) => getDesign(params[0])),
    route('PATCH', new RegExp(`^studio/designs/${uuid}$`), async ({ params, request, user }) =>
      saveDesign(params[0], await readBody(request, patchInput, 4 * 1024 * 1024), user.id), 'marketer'),
    route('POST', new RegExp(`^studio/designs/${uuid}/duplicate$`), async ({ params, user }) => json(await duplicateDesign(params[0], user.id), 201), 'marketer'),
    route('POST', new RegExp(`^studio/designs/${uuid}/(archive|unarchive|ready)$`), async ({ params, user }) =>
      setStatus(params[0], ({ archive: 'archived', unarchive: 'draft', ready: 'ready' } as Record<string, DesignStatus>)[params[1]], user.id), 'marketer'),
    route('GET', new RegExp(`^studio/designs/${uuid}/versions$`), async ({ params }) => ({ items: await listVersions(params[0]) })),
    route('POST', new RegExp(`^studio/designs/${uuid}/versions$`), async ({ params, request, user }) => {
      const { label } = await readBody(request, z.object({ label: z.string().trim().max(80).default('') }));
      return json(await saveVersion(params[0], label, user.id), 201);
    }, 'marketer'),
    route('GET', new RegExp(`^studio/designs/${uuid}/versions/(\\d+)$`), async ({ params }) => getVersion(params[0], Number(params[1]))),
    route('POST', new RegExp(`^studio/designs/${uuid}/versions/(\\d+)/restore$`), async ({ params, request, user }) => {
      const { version } = await readBody(request, z.object({ version: z.number().int().min(1) }));
      return restoreVersion(params[0], Number(params[1]), version, user.id);
    }, 'marketer'),
    route('POST', /^studio\/compile$/, async ({ request }) => {
      const input = await readBody(request, z.object({ source, kind: kind.default('email'), preheader: z.string().max(200).optional() }), 2 * 1024 * 1024);
      return compileDesign(input.kind, input.source, { preheader: input.preheader });
    }, 'marketer'),
    route('GET', new RegExp(`^studio/designs/${uuid}/render$`), async ({ params, query }) =>
      render(params[0], query.get('contactId') ? z.coerce.number().int().min(1).parse(query.get('contactId')) : null)),
    route('GET', /^studio\/sample-contacts$/, async ({ query }) => {
      const found = await searchContacts(z.string().max(120).parse(query.get('q') ?? ''), 12);
      return { items: found.map(toSample) };
    }, 'marketer'),
    route('POST', new RegExp(`^studio/designs/${uuid}/test$`), async ({ params, request, user }) => {
      const { to } = await readBody(request, z.object({ to: z.array(z.email().max(254)).min(1).max(5) }));
      await rateLimit('studio:test:' + user.id, 20, 60);
      const results: TestSendResult[] = [];
      for (const address of [...new Set(to.map(item => item.trim().toLowerCase()))]) {
        try {
          const sent = await sendDesign(params[0], { to: address, category: 'test', source: 'studio:test', createdBy: user.id });
          results.push({ to: address, messageId: sent.messageId, status: sent.status, reason: sent.reason });
        } catch (error) {
          results.push({ to: address, messageId: null, status: 'error', reason: error instanceof AppError ? error.message : 'The test could not be sent.' });
        }
      }
      return { results };
    }, 'marketer'),
    route('GET', new RegExp(`^studio/designs/${uuid}/messages$`), async ({ params }) => {
      const result = await db.query<MessageRow>(
        `SELECT m.id, m.to_email, m.subject, m.status, m.status_reason, m.category, m.created_at, m.sent_at, u.name AS creator
         FROM messages m LEFT JOIN users u ON u.id = m.created_by WHERE m.design_id = $1 ORDER BY m.created_at DESC LIMIT 50`, [params[0]]);
      return { items: result.rows.map(toMessage) };
    }, 'marketer'),
    route('GET', new RegExp(`^studio/messages/${uuid}$`), async ({ params }): Promise<StoredMessage> => {
      const row = (await db.query<MessageRow>(
        `SELECT m.id, m.to_email, m.subject, m.status, m.status_reason, m.category, m.created_at, m.sent_at, u.name AS creator, m.html, m.text_body,
           m.from_email, m.from_name FROM messages m LEFT JOIN users u ON u.id = m.created_by WHERE m.id = $1 AND m.design_id IS NOT NULL`, [params[0]])).rows[0];
      if (!row) throw new AppError(404, 'That message was not found.');
      return { ...toMessage(row), html: row.html ?? '', text: row.text_body ?? '', fromEmail: row.from_email ?? '', fromName: row.from_name ?? '' };
    }, 'marketer'),
    route('GET', new RegExp(`^studio/designs/${uuid}/export$`), async ({ params, query }): Promise<EngineExport> => {
      const engine = z.enum(['listmonk', 'mautic']).parse(query.get('engine') ?? 'listmonk');
      const design = await getDesign(params[0]);
      if (design.kind !== 'email') throw new AppError(400, 'Only whole emails can be exported.');
      if (!design.html.trim()) throw new AppError(409, 'Save the email so it compiles before exporting it.');
      const workspace = await workspaceValues();
      const converted = engine === 'listmonk' ? toListmonkHtml(design.html, workspace) : toMauticHtml(design.html, workspace);
      const subject = engine === 'listmonk' ? toListmonkHtml(design.subject, workspace).html : toMauticHtml(design.subject, workspace).html;
      const html = engine === 'listmonk' ? converted.html.replace(/<body([^>]*)>/i, `<body$1>${studioMarker}`) : converted.html;
      return { engine, html, subject, unknownTags: converted.unknownTags, notes: converted.notes };
    }, 'marketer'),
    route('POST', new RegExp(`^studio/designs/${uuid}/links$`), async ({ params, request }) =>
      ({ items: await linkDesign(params[0], await readBody(request, z.object({ engine: linkEngine, engineId: z.string().min(1).max(60), label: z.string().max(160).default('') }))) }), 'marketer'),
    route('GET', /^studio\/links$/, async ({ query }) => {
      const designId = await findLink(linkEngine.parse(query.get('engine')), z.string().min(1).max(60).parse(query.get('id')));
      return { designId };
    }),
    route('GET', /^studio\/templates$/, async (): Promise<{ items: EmailTemplateSummary[] }> => ({ items: emailTemplates.map(templateSummary) })),
    route('GET', /^studio\/templates\/([a-z0-9-]+)\/html$/, async ({ params }) => ({ html: await templateHtml(params[0]) })),
    route('GET', /^studio\/brand$/, async () => getBrand()),
    route('PUT', /^studio\/brand$/, async ({ request, user }) => saveBrand(await readBody(request, brandInput), user.id), 'marketer'),
    route('GET', /^studio\/audience$/, async ({ query }) => {
      const ids = (query.get('listIds') ?? '').split(',').map(Number).filter(id => Number.isInteger(id) && id > 0).slice(0, 20);
      return audience(ids);
    }, 'marketer'),
  ],
  jobHandlers: {},
  async onPlatformEvent() {},
  async search(q: string, user: User): Promise<SearchResult[]> {
    if (user.role === 'analyst') return [];
    const designs = await listDesigns({ kind: 'email', q, limit: 3 });
    const needle = q.trim().toLowerCase();
    const templates = emailTemplates.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(needle)).slice(0, 2);
    return [
      ...designs.map(item => ({ id: 'design:' + item.id, kind: 'email' as const, title: item.name, subtitle: item.subject || 'Email design', href: `/studio/email/${item.id}` })),
      ...templates.map(item => ({ id: 'template:' + item.key, kind: 'template' as const, title: item.name, subtitle: `${item.category} template`, href: `/marketing/templates?template=${item.key}` })),
    ];
  },
  seedPreview: seed,
};

