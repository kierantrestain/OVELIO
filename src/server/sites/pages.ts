// Landing pages (Lane 3): create from a template (a designs row of kind 'page'), autosave with an optimistic version,
// version history, publish a sanitised snapshot, A/B variants and the signed-in draft preview.
import type { User } from '@/contracts';
import type { DesignVersion, LandingPageDetail, LandingPageSummary, PageDesign, PagePublication, PageSettings, PageVariant } from '@/contracts/sites';
import { pageTemplate } from '@/templates/pages';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { audit } from '../events';
import type { DomainRow, FormRow, PageRow, VariantRow } from './data';
import { domainsById, iso, pageUrl, requirePage, slugify, uniqueSlug, uuidPattern } from './data';
import { createForm } from './forms';
import { hydratePage, renderDocument } from './render';
import { boundFormIds, sanitizePageCss, sanitizePageHtml, unboundFormBlocks } from './sanitize';

type DesignRow = { id: string; name: string; version: number; document: Record<string, unknown>; source: string; html: string; css: string; updated_at: Date };

const SNAPSHOT_EVERY_MS = 10 * 60_000;

function leadText(html: string) {
  const match = /class="ovp-lead"[^>]*>([^<]{10,300})</.exec(html);
  return match ? match[1].replace(/&amp;/g, '&').trim() : '';
}

export async function insertDesign(client: Sql, input: { name: string; html: string; css: string; templateKey: string | null; category: string; userId: string | null; kind?: 'page' | 'page_section'; document?: Record<string, unknown> }) {
  const design = (await client.query<{ id: string }>(
    `INSERT INTO designs (kind, name, document, source, html, css, template_key, category, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9, $9) RETURNING id`,
    [input.kind ?? 'page', input.name, JSON.stringify(input.document ?? {}), input.html, sanitizePageHtml(input.html), input.css, input.templateKey, input.category, input.userId],
  )).rows[0];
  await client.query(
    `INSERT INTO design_versions (design_id, version, label, document, source, html, css, created_by) VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
    [design.id, input.templateKey ? 'Created from template' : 'Created', JSON.stringify(input.document ?? {}), input.html, sanitizePageHtml(input.html), input.css, input.userId],
  );
  return design.id;
}

export type CreatePageInput = { name: string; templateKey: string; slug?: string; domainId?: string | null; formId?: string | null; createForm?: boolean };

/** Creates a page from a template. When the template has a form block, it is bound to `formId` or to a new form made from the template's suggestion. */
export async function createPage(input: CreatePageInput, user: Pick<User, 'id'> | null, client?: Sql): Promise<{ id: string; formId: string | null }> {
  const template = pageTemplate(input.templateKey);
  if (!template) throw new AppError(404, 'That template was not found.');
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Name the page.');
  const run = async (tx: Sql) => {
    if (input.domainId) await requireDomain(input.domainId, tx);
    const slug = input.slug ? slugify(input.slug) : await uniqueSlug(name, input.domainId ?? null, tx);
    if (input.slug) await assertSlugFree(slug, input.domainId ?? null, null, tx);
    let formId: string | null = null;
    let html = template.html;
    if (template.hasForm) {
      if (input.formId) {
        const exists = await tx.query('SELECT 1 FROM forms WHERE id = $1 AND status <> \'archived\'', [input.formId]);
        if (!exists.rows.length) throw new AppError(404, 'That form was not found.');
        formId = input.formId;
      } else if (input.createForm !== false && template.form) {
        formId = (await createForm({ name: `${name} form`, fields: template.form.fields, settings: template.form.settings, status: 'published' }, user, tx)).id;
      }
      if (formId) html = html.replace(/data-ovelio-form=""/g, `data-ovelio-form="${formId}"`);
    }
    const designId = await insertDesign(tx, { name, html, css: template.css, templateKey: template.key, category: template.category, userId: user?.id ?? null });
    const page = (await tx.query<{ id: string }>(
      `INSERT INTO landing_pages (name, slug, domain_id, design_id, template_key, seo_title, seo_description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
      [name, slug, input.domainId ?? null, designId, template.key, name, leadText(html), user?.id ?? null],
    )).rows[0];
    await audit(user?.id, 'create', 'page', page.id, name, tx);
    return { id: page.id, formId };
  };
  return client ? run(client) : transaction(run);
}

async function requireDomain(id: string, client: Sql) {
  const row = (await client.query<DomainRow>('SELECT * FROM site_domains WHERE id = $1', [id])).rows[0];
  if (!row) throw new AppError(404, 'That domain was not found.');
  return row;
}

async function assertSlugFree(slug: string, domainId: string | null, pageId: string | null, client: Sql) {
  if (!/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/.test(slug)) throw new AppError(400, 'Use lowercase letters, numbers and hyphens for the page address.');
  const clash = await client.query(
    `SELECT 1 FROM landing_pages WHERE slug = $1 AND coalesce(domain_id::text, '') = coalesce($2::text, '') AND id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')`,
    [slug, domainId, pageId],
  );
  if (clash.rows.length) throw new AppError(409, `Another page already uses the address “${slug}” on this domain.`);
}

type PageMetric = { views: number; visitors: number; conversions: number };

/** Views, unique visitors and converting visitors per page over the last `days` days, from the events table. */
export async function pageMetrics(ids: string[], days = 30): Promise<Map<string, PageMetric>> {
  if (!ids.length) return new Map();
  const rows = await db.query<{ entity_id: string; views: string; visitors: string; conversions: string }>(
    `SELECT entity_id,
       count(*) FILTER (WHERE type = 'page.viewed') AS views,
       count(DISTINCT visitor_id) FILTER (WHERE type = 'page.viewed') AS visitors,
       count(DISTINCT coalesce(visitor_id, id::text)) FILTER (WHERE type = 'page.converted') AS conversions
     FROM events WHERE entity_type = 'page' AND entity_id = ANY($1::text[]) AND type IN ('page.viewed', 'page.converted')
       AND occurred_at >= now() - make_interval(days => $2)
     GROUP BY entity_id`,
    [ids, days],
  );
  return new Map(rows.rows.map(row => [row.entity_id, { views: Number(row.views), visitors: Number(row.visitors), conversions: Number(row.conversions) }]));
}

export const rate = (conversions: number, visitors: number) => visitors > 0 ? Math.round((conversions / visitors) * 1000) / 10 : null;

type ListRow = PageRow & { design_version: number; design_updated_at: Date };

function toSummary(row: ListRow, domains: Map<string, DomainRow>, metrics: Map<string, PageMetric>): LandingPageSummary {
  const domain = row.domain_id ? domains.get(row.domain_id) ?? null : null;
  const metric = metrics.get(row.id) ?? { views: 0, visitors: 0, conversions: 0 };
  return {
    id: row.id, name: row.name, slug: row.slug, status: row.status, url: pageUrl(row, domain), domainId: row.domain_id, domain: domain?.hostname ?? null,
    templateKey: row.template_key, designId: row.design_id, publishedAt: iso(row.published_at), publishedVersion: row.published_version,
    updatedAt: iso(row.design_updated_at > row.updated_at ? row.design_updated_at : row.updated_at)!,
    hasDraftChanges: row.status === 'published' && row.published_version !== row.design_version,
    views: metric.views, visitors: metric.visitors, conversions: metric.conversions, conversionRate: rate(metric.conversions, metric.visitors),
  };
}

export async function listPages(filter: { status?: string; q?: string } = {}): Promise<LandingPageSummary[]> {
  const rows = await db.query<ListRow>(
    `SELECT p.*, d.version AS design_version, d.updated_at AS design_updated_at FROM landing_pages p JOIN designs d ON d.id = p.design_id
     WHERE ($1::text IS NULL AND p.status <> 'archived' OR p.status = $1) AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%' OR p.slug ILIKE '%' || $2 || '%')
     ORDER BY greatest(p.updated_at, d.updated_at) DESC LIMIT 500`,
    [filter.status || null, filter.q?.trim() || null],
  );
  const [domains, metrics] = await Promise.all([domainsById(rows.rows.map(row => row.domain_id)), pageMetrics(rows.rows.map(row => row.id))]);
  return rows.rows.map(row => toSummary(row, domains, metrics));
}

const toVariant = (row: VariantRow): PageVariant => ({
  id: row.id, key: row.key, name: row.name, designId: row.design_id, weight: row.weight, publishedAt: iso(row.published_at), publishedVersion: row.published_version,
});

export async function getPage(id: string): Promise<LandingPageDetail> {
  const page = await requirePage(id);
  const row = (await db.query<ListRow>(
    'SELECT p.*, d.version AS design_version, d.updated_at AS design_updated_at FROM landing_pages p JOIN designs d ON d.id = p.design_id WHERE p.id = $1', [id],
  )).rows[0];
  const [domains, metrics, variants, funnels, redirects] = await Promise.all([
    domainsById([page.domain_id]), pageMetrics([id]),
    db.query<VariantRow>('SELECT * FROM page_variants WHERE page_id = $1 ORDER BY key', [id]),
    db.query<{ id: string; name: string; position: number }>('SELECT f.id, f.name, s.position FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id WHERE s.page_id = $1 AND f.status <> \'archived\'', [id]),
    db.query<{ id: string; from_slug: string; hostname: string | null; hits: number }>(
      'SELECT r.id, r.from_slug, d.hostname, r.hits FROM page_redirects r LEFT JOIN site_domains d ON d.id = r.domain_id WHERE r.page_id = $1 ORDER BY r.created_at DESC', [id]),
  ]);
  return {
    ...toSummary(row, domains, metrics),
    seoTitle: page.seo_title, seoDescription: page.seo_description, ogImageUrl: page.og_image_url, canonicalUrl: page.canonical_url,
    faviconUrl: page.favicon_url, noindex: page.noindex, utmDefaults: page.utm_defaults ?? {}, abEnabled: page.ab_enabled, controlWeight: page.control_weight,
    redirects: redirects.rows.map(row => ({ id: row.id, from: row.hostname ? `https://${row.hostname}/${row.from_slug}` : `/s/${row.from_slug}`, hits: row.hits })),
    variants: variants.rows.map(toVariant), funnels: funnels.rows.map(item => ({ id: item.id, name: item.name, stepIndex: item.position })),
  };
}

export async function updatePageSettings(id: string, input: Partial<PageSettings>, user: User) {
  const page = await requirePage(id);
  const next = {
    name: input.name?.trim() || page.name,
    slug: input.slug !== undefined ? slugify(input.slug) : page.slug,
    domainId: input.domainId !== undefined ? input.domainId : page.domain_id,
  };
  if (next.domainId) await requireDomain(next.domainId, db);
  if (next.slug !== page.slug || next.domainId !== page.domain_id) {
    await assertSlugFree(next.slug, next.domainId, id, db);
    // A page that has been live keeps its old address working with a permanent redirect.
    if (page.published_at) {
      await db.query(
        `INSERT INTO page_redirects (domain_id, from_slug, page_id) VALUES ($1, $2, $3)
         ON CONFLICT ((coalesce(domain_id::text, '')), from_slug) DO UPDATE SET page_id = EXCLUDED.page_id, hits = 0, created_at = now()`,
        [page.domain_id, page.slug, id]);
    }
    await db.query(`DELETE FROM page_redirects WHERE coalesce(domain_id::text, '') = coalesce($1::text, '') AND from_slug = $2`, [next.domainId, next.slug]);
  }
  await db.query(
    `UPDATE landing_pages SET name = $2, slug = $3, domain_id = $4, seo_title = coalesce($5, seo_title), seo_description = coalesce($6, seo_description),
       og_image_url = coalesce($7, og_image_url), canonical_url = coalesce($8, canonical_url), favicon_url = coalesce($9, favicon_url),
       noindex = coalesce($10, noindex), utm_defaults = coalesce($11::jsonb, utm_defaults), ab_enabled = coalesce($12, ab_enabled),
       control_weight = coalesce($13, control_weight), updated_by = $14, updated_at = now() WHERE id = $1`,
    [id, next.name, next.slug, next.domainId, input.seoTitle ?? null, input.seoDescription ?? null, input.ogImageUrl ?? null, input.canonicalUrl ?? null,
      input.faviconUrl ?? null, input.noindex ?? null, input.utmDefaults ? JSON.stringify(input.utmDefaults) : null, input.abEnabled ?? null,
      input.controlWeight ?? null, user.id],
  );
  if (input.name && input.name.trim() !== page.name) await db.query('UPDATE designs SET name = $2 WHERE id = $1', [page.design_id, input.name.trim()]);
  return getPage(id);
}

/** The design the builder edits: the control, or variant `key` ('b', 'c'…). */
export async function designFor(pageId: string, variantKey?: string | null): Promise<{ page: PageRow; designId: string; variant: VariantRow | null }> {
  const page = await requirePage(pageId);
  if (!variantKey || variantKey === 'a') return { page, designId: page.design_id, variant: null };
  const variant = (await db.query<VariantRow>('SELECT * FROM page_variants WHERE page_id = $1 AND key = $2', [pageId, variantKey])).rows[0];
  if (!variant) throw new AppError(404, 'That variant was not found.');
  return { page, designId: variant.design_id, variant };
}

export async function loadDesign(designId: string): Promise<PageDesign> {
  const row = (await db.query<DesignRow>('SELECT id, name, version, document, source, html, css, updated_at FROM designs WHERE id = $1', [designId])).rows[0];
  if (!row) throw new AppError(404, 'That design was not found.');
  return { designId: row.id, name: row.name, version: row.version, document: row.document ?? {}, html: row.source || row.html, css: row.css, updatedAt: iso(row.updated_at)! };
}

/** Autosave. Rejects a stale `version` with 409 so two editors never overwrite each other silently. */
export async function saveDesign(designId: string, input: { version: number; document: Record<string, unknown>; html: string; css: string; label?: string }, user: User) {
  return transaction(async client => {
    const updated = (await client.query<{ version: number; updated_at: Date }>(
      `UPDATE designs SET document = $3, source = $4, html = $5, css = $6, version = version + 1, updated_by = $7, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING version, updated_at`,
      [designId, input.version, JSON.stringify(input.document), input.html, sanitizePageHtml(input.html), input.css, user.id],
    )).rows[0];
    if (!updated) {
      const current = (await client.query<{ version: number }>('SELECT version FROM designs WHERE id = $1', [designId])).rows[0];
      if (!current) throw new AppError(404, 'That design was not found.');
      throw new AppError(409, `This page was saved elsewhere (version ${current.version}). Reload to get the latest version before editing.`);
    }
    const last = (await client.query<{ created_at: Date }>('SELECT created_at FROM design_versions WHERE design_id = $1 ORDER BY version DESC LIMIT 1', [designId])).rows[0];
    if (input.label || !last || Date.now() - new Date(last.created_at).getTime() > SNAPSHOT_EVERY_MS) {
      await snapshot(client, designId, input.label || 'Autosave', user.id);
    }
    return { version: updated.version, updatedAt: iso(updated.updated_at)! };
  });
}

async function snapshot(client: Sql, designId: string, label: string, userId: string | null) {
  await client.query(
    `INSERT INTO design_versions (design_id, version, label, document, source, html, css, created_by)
     SELECT id, version, $2, document, source, html, css, $3 FROM designs WHERE id = $1
     ON CONFLICT (design_id, version) DO UPDATE SET label = CASE WHEN design_versions.label = 'Autosave' THEN EXCLUDED.label ELSE design_versions.label END`,
    [designId, label, userId],
  );
}

export async function listVersions(designId: string): Promise<DesignVersion[]> {
  const rows = await db.query<{ version: number; label: string; created_at: Date; name: string | null }>(
    `SELECT v.version, v.label, v.created_at, u.name FROM design_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.design_id = $1 ORDER BY v.version DESC LIMIT 100`, [designId],
  );
  return rows.rows.map(row => ({ version: row.version, label: row.label, createdAt: iso(row.created_at)!, createdBy: row.name }));
}

export async function saveNamedVersion(designId: string, label: string, user: User) {
  await snapshot(db, designId, label.trim().slice(0, 80) || 'Saved version', user.id);
  return listVersions(designId);
}

export async function restoreVersion(designId: string, version: number, user: User): Promise<PageDesign> {
  await transaction(async client => {
    const source = (await client.query('SELECT 1 FROM design_versions WHERE design_id = $1 AND version = $2', [designId, version])).rows[0];
    if (!source) throw new AppError(404, 'That version was not found.');
    await snapshot(client, designId, 'Before restore', user.id);
    await client.query(
      `UPDATE designs d SET document = v.document, source = v.source, html = v.html, css = v.css, version = d.version + 1, updated_by = $3, updated_at = now()
       FROM design_versions v WHERE d.id = $1 AND v.design_id = $1 AND v.version = $2`,
      [designId, version, user.id],
    );
    await snapshot(client, designId, `Restored version ${version}`, user.id);
  });
  return loadDesign(designId);
}

async function publishableSnapshot(designId: string, client: Sql) {
  const design = (await client.query<DesignRow>('SELECT id, name, version, document, source, html, css, updated_at FROM designs WHERE id = $1', [designId])).rows[0];
  if (!design) throw new AppError(404, 'That design was not found.');
  const html = sanitizePageHtml(design.source || design.html);
  if (!html.replace(/<[^>]+>/g, '').trim() && !/<(img|svg|iframe)/.test(html)) throw new AppError(409, 'Add some content to the page before publishing it.');
  if (unboundFormBlocks(design.source || design.html)) throw new AppError(409, 'A form block is not linked to a form. Select it in the builder and choose a form, then publish again.');
  await assertFormsLive(html, client);
  return { html, css: sanitizePageCss(design.css), version: design.version };
}

/** Every form a snapshot shows must still exist and be published. */
async function assertFormsLive(html: string, client: Sql) {
  const formIds = boundFormIds(html);
  if (formIds.length) {
    const live = await client.query<{ id: string; status: string; name: string }>('SELECT id, status, name FROM forms WHERE id = ANY($1::uuid[])', [formIds]);
    const missing = formIds.filter(formId => !live.rows.some(row => row.id === formId));
    if (missing.length) throw new AppError(409, 'A form used on this page was deleted. Choose another form for the form block.');
    const off = live.rows.find(row => row.status !== 'published');
    if (off) throw new AppError(409, `The form “${off.name}” is not published. Publish it in Sites › Forms, or choose another form.`);
  }
}

const recordPublication = (client: Sql, pageId: string, variantKey: string, snap: { html: string; css: string; version: number | null }, label: string, userId: string | null) => client.query(
  'INSERT INTO page_publications (page_id, variant_key, design_version, html, css, label, published_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
  [pageId, variantKey, snap.version, snap.html, snap.css, label, userId],
);

export async function listPublications(pageId: string): Promise<PagePublication[]> {
  const page = await requirePage(pageId);
  const rows = await db.query<{ id: string; variant_key: string; design_version: number | null; label: string; published_at: Date; name: string | null }>(
    `SELECT p.id, p.variant_key, p.design_version, p.label, p.published_at, u.name FROM page_publications p LEFT JOIN users u ON u.id = p.published_by
     WHERE p.page_id = $1 ORDER BY p.published_at DESC, p.id DESC LIMIT 60`, [pageId],
  );
  const seen = new Set<string>();
  return rows.rows.map(row => {
    const live = page.status === 'published' && !seen.has(row.variant_key);
    seen.add(row.variant_key);
    return { id: row.id, variantKey: row.variant_key, designVersion: row.design_version, label: row.label, publishedAt: iso(row.published_at)!, publishedBy: row.name, live };
  });
}

/** Rollback: republishes a past snapshot exactly as it was. The design being edited is left alone. */
export async function restorePublication(pageId: string, publicationId: string, user: User) {
  await transaction(async client => {
    const page = await requirePage(pageId, client);
    const row = uuidPattern.test(publicationId)
      ? (await client.query<{ variant_key: string; design_version: number | null; html: string; css: string; label: string; published_at: Date }>(
        'SELECT variant_key, design_version, html, css, label, published_at FROM page_publications WHERE id = $1 AND page_id = $2', [publicationId, pageId])).rows[0]
      : undefined;
    if (!row) throw new AppError(404, 'That published version was not found.');
    await assertFormsLive(row.html, client);
    if (row.variant_key === 'a') {
      await client.query(
        `UPDATE landing_pages SET status = 'published', published_html = $2, published_css = $3, published_version = $4, published_at = now(), updated_by = $5, updated_at = now() WHERE id = $1`,
        [pageId, row.html, row.css, row.design_version, user.id]);
    } else {
      const updated = await client.query('UPDATE page_variants SET published_html = $3, published_css = $4, published_version = $5, published_at = now(), updated_at = now() WHERE page_id = $1 AND key = $2 RETURNING id',
        [pageId, row.variant_key, row.html, row.css, row.design_version]);
      if (!updated.rows.length) throw new AppError(409, 'That variant was removed, so its versions cannot be restored.');
    }
    const when = new Date(row.published_at).toISOString().slice(0, 16).replace('T', ' ');
    await recordPublication(client, pageId, row.variant_key, { html: row.html, css: row.css, version: row.design_version }, `Restored the version published ${when} UTC`, user.id);
    await audit(user.id, 'rollback', 'page', pageId, `${page.name}: ${row.label}`, client);
  });
  return getPage(pageId);
}

export async function publishPage(id: string, user: User) {
  await transaction(async client => {
    const page = await requirePage(id, client);
    const control = await publishableSnapshot(page.design_id, client);
    await client.query(
      `UPDATE landing_pages SET status = 'published', published_html = $2, published_css = $3, published_version = $4, published_at = now(), updated_by = $5, updated_at = now() WHERE id = $1`,
      [id, control.html, control.css, control.version, user.id],
    );
    await snapshot(client, page.design_id, `Published (version ${control.version})`, user.id);
    await recordPublication(client, id, 'a', control, `Published version ${control.version}`, user.id);
    const variants = await client.query<VariantRow>('SELECT * FROM page_variants WHERE page_id = $1', [id]);
    for (const variant of variants.rows) {
      const snap = await publishableSnapshot(variant.design_id, client);
      await client.query('UPDATE page_variants SET published_html = $2, published_css = $3, published_version = $4, published_at = now(), updated_at = now() WHERE id = $1',
        [variant.id, snap.html, snap.css, snap.version]);
      await snapshot(client, variant.design_id, `Published (version ${snap.version})`, user.id);
      await recordPublication(client, id, variant.key, snap, `${variant.name}: published version ${snap.version}`, user.id);
    }
    await audit(user.id, 'publish', 'page', id, page.name, client);
  });
  return getPage(id);
}

export async function setPageStatus(id: string, status: 'draft' | 'archived', user: User) {
  const page = await requirePage(id);
  await db.query('UPDATE landing_pages SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1', [id, status, user.id]);
  await audit(user.id, status === 'draft' ? 'unpublish' : 'archive', 'page', id, page.name);
  return getPage(id);
}

export async function deletePage(id: string, user: User) {
  const page = await requirePage(id);
  await transaction(async client => {
    const variants = await client.query<{ design_id: string }>('SELECT design_id FROM page_variants WHERE page_id = $1', [id]);
    await client.query('DELETE FROM landing_pages WHERE id = $1', [id]);
    await client.query('DELETE FROM designs WHERE id = ANY($1::uuid[])', [[page.design_id, ...variants.rows.map(row => row.design_id)]]);
    await audit(user.id, 'delete', 'page', id, page.name, client);
  });
}

async function copyDesign(client: Sql, designId: string, name: string, userId: string) {
  const source = (await client.query<DesignRow & { template_key: string | null; category: string }>('SELECT * FROM designs WHERE id = $1', [designId])).rows[0];
  if (!source) throw new AppError(404, 'That design was not found.');
  return insertDesign(client, { name, html: source.source || source.html, css: source.css, templateKey: source.template_key, category: source.category, userId, document: source.document });
}

export async function duplicatePage(id: string, user: User) {
  const page = await requirePage(id);
  return transaction(async client => {
    const name = `Copy of ${page.name}`.slice(0, 120);
    const designId = await copyDesign(client, page.design_id, name, user.id);
    const slug = await uniqueSlug(page.slug + '-copy', page.domain_id, client);
    const created = (await client.query<{ id: string }>(
      `INSERT INTO landing_pages (name, slug, domain_id, design_id, template_key, seo_title, seo_description, og_image_url, canonical_url, favicon_url, noindex, utm_defaults, created_by, updated_by)
       SELECT $2, $3, domain_id, $4, template_key, seo_title, seo_description, og_image_url, '', favicon_url, noindex, utm_defaults, $5, $5 FROM landing_pages WHERE id = $1 RETURNING id`,
      [id, name, slug, designId, user.id],
    )).rows[0];
    await audit(user.id, 'duplicate', 'page', created.id, name, client);
    return { id: created.id };
  });
}

export async function addVariant(pageId: string, user: User) {
  const page = await requirePage(pageId);
  return transaction(async client => {
    const used = new Set((await client.query<{ key: string }>('SELECT key FROM page_variants WHERE page_id = $1', [pageId])).rows.map(row => row.key));
    const key = 'bcdefgh'.split('').find(letter => !used.has(letter));
    if (!key) throw new AppError(409, 'A page can have up to seven variants.');
    const designId = await copyDesign(client, page.design_id, `${page.name} · variant ${key.toUpperCase()}`, user.id);
    const variant = (await client.query<VariantRow>(
      'INSERT INTO page_variants (page_id, key, name, design_id, weight) VALUES ($1, $2, $3, $4, 50) RETURNING *', [pageId, key, `Variant ${key.toUpperCase()}`, designId],
    )).rows[0];
    return toVariant(variant);
  });
}

export async function updateVariant(pageId: string, key: string, input: { name?: string; weight?: number }) {
  const updated = await db.query<VariantRow>(
    'UPDATE page_variants SET name = coalesce($3, name), weight = coalesce($4, weight), updated_at = now() WHERE page_id = $1 AND key = $2 RETURNING *',
    [pageId, key, input.name?.trim() || null, input.weight ?? null],
  );
  if (!updated.rows[0]) throw new AppError(404, 'That variant was not found.');
  return toVariant(updated.rows[0]);
}

export async function deleteVariant(pageId: string, key: string) {
  const removed = await db.query<{ design_id: string }>('DELETE FROM page_variants WHERE page_id = $1 AND key = $2 RETURNING design_id', [pageId, key]);
  if (removed.rows[0]) await db.query('DELETE FROM designs WHERE id = $1', [removed.rows[0].design_id]);
}

export async function formsByIds(ids: string[], client: Sql = db): Promise<Map<string, FormRow>> {
  const valid = ids.filter(item => uuidPattern.test(item));
  if (!valid.length) return new Map();
  const rows = await client.query<FormRow>('SELECT * FROM forms WHERE id = ANY($1::uuid[])', [valid]);
  return new Map(rows.rows.map(row => [row.id, row]));
}

/** Signed-in preview of the current, unpublished design. Nothing is tracked. */
export async function draftPreview(pageId: string, variantKey?: string | null) {
  const { page, designId } = await designFor(pageId, variantKey);
  const design = await loadDesign(designId);
  const html = sanitizePageHtml(design.html);
  const forms = await formsByIds(boundFormIds(html));
  return renderDocument({
    title: page.seo_title || page.name, description: page.seo_description, canonicalUrl: '', ogImageUrl: page.og_image_url, faviconUrl: page.favicon_url,
    noindex: true, css: sanitizePageCss(design.css), bodyHtml: hydratePage(html, forms, { pageId: null }, '#'),
    config: { pageId: null, variant: null, funnelId: null, stepIndex: null, utm: {}, track: false },
    banner: `Draft preview of “${page.name}”${variantKey && variantKey !== 'a' ? ` · variant ${variantKey.toUpperCase()}` : ''} · visible only to signed-in team members · form submissions here are real`,
  });
}

export async function searchPages(q: string) {
  const rows = await db.query<{ id: string; name: string; slug: string; status: string }>(
    `SELECT id, name, slug, status FROM landing_pages WHERE status <> 'archived' AND (name ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%') ORDER BY updated_at DESC LIMIT 5`, [q],
  );
  return rows.rows;
}

export async function deleteRedirect(pageId: string, redirectId: string) {
  if (!uuidPattern.test(redirectId)) throw new AppError(404, 'That redirect was not found.');
  await db.query('DELETE FROM page_redirects WHERE id = $1 AND page_id = $2', [redirectId, pageId]);
}
