// Lane module: see docs/rebuild/TRACKER.md for ownership. The lead registers this file once; keep its export shape.
// Console API for Sites & Forms under /api/console/sites/… (pages, designs, versions, forms, funnels, domains, stats).
import { z } from 'zod';
import type { SearchResult } from '@/contracts/platform';
import type { PageTemplate, SavedSection } from '@/contracts/sites';
import { pageTemplate, pageTemplateSummaries } from '@/templates/pages';
import { AppError } from '../config';
import { db } from '../db';
import { requestOrigin } from '../dev-preview';
import { readBody } from '../http';
import type { LaneModule } from '../platform/types';
import type { Context } from '../routes/shared';
import { route } from '../routes/shared';
import { iso } from './data';
import { addDomain, listDomains, removeDomain, updateDomain, verifyDomain } from './domains';
import { createForm, deleteForm, duplicateForm, formInput, getFormDetail, listForms, listSubmissions, searchForms, submissionsCsv, updateForm } from './forms';
import { deleteFunnel, funnelStats, getFunnel, listFunnels, pageStats, saveFunnel, searchFunnels } from './funnels';
import {
  addVariant, createPage, deletePage, deleteRedirect, deleteVariant, listPublications, restorePublication, designFor, draftPreview, duplicatePage, getPage, listPages, listVersions, loadDesign,
  publishPage, restoreVersion, saveDesign, saveNamedVersion, searchPages, setPageStatus, updatePageSettings, updateVariant,
} from './pages';
import { seedSites } from './seed';

const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const path = (pattern: string) => new RegExp(`^sites/${pattern.replace(/:id/g, uuid)}$`);
const days = (query: URLSearchParams) => z.coerce.number().int().min(1).max(365).parse(query.get('days') ?? 30);
const variantKey = (query: URLSearchParams) => {
  const key = query.get('variant');
  if (key && !/^[a-h]$/.test(key)) throw new AppError(400, 'Choose variant a to h.');
  return key;
};

const utm = z.object({ source: z.string().max(200), medium: z.string().max(200), campaign: z.string().max(200), term: z.string().max(200), content: z.string().max(200) }).partial();
const optionalUrl = z.url({ protocol: /^https?$/ }).max(500).or(z.literal(''));

const createPageInput = z.object({
  name: z.string().trim().min(1, 'Name the page.').max(120),
  templateKey: z.string().min(1).max(60),
  slug: z.string().trim().max(80).optional(),
  domainId: z.uuid().nullable().optional(),
  formId: z.uuid().nullable().optional(),
  createForm: z.boolean().optional(),
});

const settingsInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80),
  domainId: z.uuid().nullable(),
  seoTitle: z.string().trim().max(120),
  seoDescription: z.string().trim().max(320),
  ogImageUrl: optionalUrl,
  canonicalUrl: optionalUrl,
  faviconUrl: optionalUrl,
  noindex: z.boolean(),
  utmDefaults: utm,
  abEnabled: z.boolean(),
  controlWeight: z.number().int().min(0).max(100),
}).partial();

const designInput = z.object({
  version: z.number().int().min(1),
  document: z.record(z.string(), z.unknown()),
  html: z.string().max(1_500_000),
  css: z.string().max(800_000),
  label: z.string().trim().max(80).optional(),
});

const funnelInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  steps: z.array(z.object({ name: z.string().trim().max(120), pageId: z.uuid() })).max(20).optional(),
});

const sectionInput = z.object({ name: z.string().trim().min(1).max(120), html: z.string().min(1).max(400_000), css: z.string().max(400_000) });

const embedSnippet = (origin: string, formId: string) =>
  `<div data-ovelio-form="${formId}"></div>\n<script src="${origin}/api/public/forms/${formId}/embed.js" async></script>`;

async function savedSections(): Promise<SavedSection[]> {
  const rows = await db.query<{ id: string; name: string; source: string; css: string; updated_at: Date }>(
    `SELECT id, name, source, css, updated_at FROM designs WHERE kind = 'page_section' AND status <> 'archived' ORDER BY updated_at DESC LIMIT 200`,
  );
  return rows.rows.map(row => ({ id: row.id, name: row.name, html: row.source, css: row.css, updatedAt: iso(row.updated_at)! }));
}

const pageId = (context: Context) => context.params[0];

export const sitesModule: LaneModule = {
  name: 'sites',
  endpoints: [
    // Templates and saved sections
    route('GET', path('templates'), async () => ({ items: pageTemplateSummaries() })),
    route('GET', path('templates/([a-z0-9-]{1,60})'), async ({ params }): Promise<PageTemplate> => {
      const template = pageTemplate(params[0]);
      if (!template) throw new AppError(404, 'That template was not found.');
      return template;
    }),
    route('GET', path('sections'), async () => ({ items: await savedSections() }), 'marketer'),
    route('POST', path('sections'), async ({ request, user }) => {
      const input = await readBody(request, sectionInput, 1024 * 1024);
      const row = (await db.query<{ id: string }>(
        `INSERT INTO designs (kind, name, source, html, css, status, created_by, updated_by) VALUES ('page_section', $1, $2, $2, $3, 'ready', $4, $4) RETURNING id`,
        [input.name, input.html, input.css, user.id],
      )).rows[0];
      return { id: row.id };
    }, 'marketer'),
    route('DELETE', path('sections/:id'), async ({ params }) => {
      await db.query(`DELETE FROM designs WHERE id = $1 AND kind = 'page_section'`, [params[0]]);
      return new Response(null, { status: 204 });
    }, 'marketer'),

    // Landing pages
    route('GET', path('pages'), async ({ query }) => ({ items: await listPages({ status: query.get('status') ?? undefined, q: query.get('q') ?? undefined }) })),
    route('POST', path('pages'), async ({ request, user }) => createPage(await readBody(request, createPageInput), user), 'marketer'),
    route('GET', path('pages/:id'), async context => getPage(pageId(context))),
    route('PATCH', path('pages/:id'), async context => updatePageSettings(pageId(context), await readBody(context.request, settingsInput), context.user), 'marketer'),
    route('DELETE', path('pages/:id'), async context => {
      await deletePage(pageId(context), context.user);
      return new Response(null, { status: 204 });
    }, 'marketer'),
    route('POST', path('pages/:id/publish'), async context => publishPage(pageId(context), context.user), 'marketer'),
    route('POST', path('pages/:id/unpublish'), async context => setPageStatus(pageId(context), 'draft', context.user), 'marketer'),
    route('POST', path('pages/:id/archive'), async context => setPageStatus(pageId(context), 'archived', context.user), 'marketer'),
    route('POST', path('pages/:id/duplicate'), async context => duplicatePage(pageId(context), context.user), 'marketer'),
    route('GET', path('pages/:id/design'), async context => {
      const { designId } = await designFor(pageId(context), variantKey(context.query));
      return loadDesign(designId);
    }, 'marketer'),
    route('PATCH', path('pages/:id/design'), async context => {
      const { designId } = await designFor(pageId(context), variantKey(context.query));
      return saveDesign(designId, await readBody(context.request, designInput, 3 * 1024 * 1024), context.user);
    }, 'marketer'),
    route('GET', path('pages/:id/versions'), async context => ({ items: await listVersions((await designFor(pageId(context), variantKey(context.query))).designId) }), 'marketer'),
    route('POST', path('pages/:id/versions'), async context => {
      const { label } = await readBody(context.request, z.object({ label: z.string().trim().max(80) }));
      return { items: await saveNamedVersion((await designFor(pageId(context), variantKey(context.query))).designId, label, context.user) };
    }, 'marketer'),
    route('POST', path('pages/:id/versions/(\\d{1,9})/restore'), async context => {
      const { designId } = await designFor(pageId(context), variantKey(context.query));
      return restoreVersion(designId, Number(context.params[1]), context.user);
    }, 'marketer'),
    route('GET', path('pages/:id/preview'), async context => new Response(await draftPreview(pageId(context), variantKey(context.query)), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    }), 'marketer'),
    route('GET', path('pages/:id/publications'), async context => ({ items: await listPublications(pageId(context)) }), 'marketer'),
    route('POST', path('pages/:id/publications/:id/restore'), async context => restorePublication(pageId(context), context.params[1], context.user), 'marketer'),
    route('DELETE', path('pages/:id/redirects/:id'), async context => {
      await deleteRedirect(pageId(context), context.params[1]);
      return new Response(null, { status: 204 });
    }, 'marketer'),
    route('GET', path('pages/:id/stats'), async context => pageStats(pageId(context), days(context.query))),
    route('POST', path('pages/:id/variants'), async context => addVariant(pageId(context), context.user), 'marketer'),
    route('PATCH', path('pages/:id/variants/([b-h])'), async context => updateVariant(pageId(context), context.params[1],
      await readBody(context.request, z.object({ name: z.string().trim().max(60).optional(), weight: z.number().int().min(0).max(100).optional() }))), 'marketer'),
    route('DELETE', path('pages/:id/variants/([b-h])'), async context => {
      await deleteVariant(pageId(context), context.params[1]);
      return new Response(null, { status: 204 });
    }, 'marketer'),

    // Forms
    route('GET', path('forms'), async ({ query }) => ({ items: await listForms({ status: query.get('status') ?? undefined, q: query.get('q') ?? undefined }) })),
    route('POST', path('forms'), async ({ request, user }) => {
      const created = await createForm(await readBody(request, formInput), user);
      return getFormDetail(created.id);
    }, 'marketer'),
    route('GET', path('forms/:id'), async ({ params }) => getFormDetail(params[0]), 'marketer'),
    route('PATCH', path('forms/:id'), async ({ params, request, user }) => updateForm(params[0], await readBody(request, formInput.partial()), user), 'marketer'),
    route('DELETE', path('forms/:id'), async ({ params, user }) => deleteForm(params[0], user), 'marketer'),
    route('POST', path('forms/:id/duplicate'), async ({ params, user }) => duplicateForm(params[0], user), 'marketer'),
    route('GET', path('forms/:id/submissions'), async ({ params, query }) => listSubmissions(params[0], {
      page: z.coerce.number().int().min(1).max(100000).parse(query.get('page') ?? 1), status: query.get('status') ?? undefined,
    }), 'marketer'),
    route('GET', path('forms/:id/submissions\\.csv'), async ({ params }) => new Response(await submissionsCsv(params[0]), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="form-submissions-${params[0].slice(0, 8)}.csv"`, 'cache-control': 'no-store' },
    }), 'marketer'),
    route('GET', path('forms/:id/embed'), async ({ params, request }) => {
      const origin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : requestOrigin(request);
      return { origin, hostedUrl: `${origin}/f/${params[0]}`, snippet: embedSnippet(origin, params[0]) };
    }, 'marketer'),
    route('GET', path('email-designs'), async () => {
      const rows = await db.query<{ id: string; name: string; subject: string; updated_at: Date }>(
        `SELECT id, name, subject, updated_at FROM designs WHERE kind = 'email' AND status <> 'archived' ORDER BY updated_at DESC LIMIT 200`,
      );
      return { items: rows.rows.map(row => ({ id: row.id, name: row.name, subject: row.subject, updatedAt: iso(row.updated_at) })) };
    }, 'marketer'),

    // Funnels
    route('GET', path('funnels'), async () => ({ items: await listFunnels() })),
    route('POST', path('funnels'), async ({ request, user }) => saveFunnel(null, await readBody(request, funnelInput), user), 'marketer'),
    route('GET', path('funnels/:id'), async ({ params }) => getFunnel(params[0])),
    route('PATCH', path('funnels/:id'), async ({ params, request, user }) => saveFunnel(params[0], await readBody(request, funnelInput), user), 'marketer'),
    route('DELETE', path('funnels/:id'), async ({ params, user }) => {
      await deleteFunnel(params[0], user);
      return new Response(null, { status: 204 });
    }, 'marketer'),
    route('GET', path('funnels/:id/stats'), async ({ params, query }) => funnelStats(params[0], days(query))),

    // Domains
    route('GET', path('domains'), async () => ({ items: await listDomains() }), 'marketer'),
    route('POST', path('domains'), async ({ request, user }) => addDomain(await readBody(request, z.object({ hostname: z.string().trim().min(3).max(253), kind: z.enum(['subdomain', 'custom']).optional() })), user), 'admin'),
    route('PATCH', path('domains/:id'), async ({ params, request, user }) => updateDomain(params[0], await readBody(request, z.object({ homePageId: z.uuid().nullable() })), user), 'admin'),
    route('DELETE', path('domains/:id'), async ({ params, user }) => {
      await removeDomain(params[0], user);
      return new Response(null, { status: 204 });
    }, 'admin'),
    route('POST', path('domains/:id/verify'), async ({ params, user }) => verifyDomain(params[0], user), 'marketer'),
  ],
  jobHandlers: {},
  async onPlatformEvent() {},
  async search(query) {
    const q = query.trim();
    if (q.length < 2) return [];
    const [pages, forms, funnels] = await Promise.all([searchPages(q), searchForms(q), searchFunnels(q)]);
    const results: SearchResult[] = [
      ...pages.map(item => ({ id: 'page:' + item.id, kind: 'page' as const, title: item.name, subtitle: `/s/${item.slug} · ${item.status}`, href: `/studio/page/${item.id}` })),
      ...forms.map(item => ({ id: 'form:' + item.id, kind: 'form' as const, title: item.name, subtitle: `Form · ${item.status}`, href: `/sites/forms/${item.id}` })),
      ...funnels.map(item => ({ id: 'funnel:' + item.id, kind: 'funnel' as const, title: item.name, subtitle: `Funnel · ${item.status}`, href: `/sites/funnels/${item.id}` })),
    ];
    return results.slice(0, 5);
  },
  async seedPreview(sql) {
    await seedSites(sql);
  },
};

