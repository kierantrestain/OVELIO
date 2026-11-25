// Lane 3 row types, mappers and lookups shared by the console API, the public routes and the preview seed.
import type { FormField, FormSettings, FormStatus, PageStatus } from '@/contracts/sites';
import type { Utm } from '@/contracts/platform';
import { AppError } from '../config';
import { db } from '../db';
import type { Sql } from '../db';

export type PageRow = {
  id: string; name: string; slug: string; domain_id: string | null; design_id: string; template_key: string | null; status: PageStatus;
  published_html: string; published_css: string; published_version: number | null; published_at: Date | null;
  seo_title: string; seo_description: string; og_image_url: string; canonical_url: string; favicon_url: string; noindex: boolean;
  utm_defaults: Utm; ab_enabled: boolean; control_weight: number; created_at: Date; updated_at: Date;
};

export type FormRow = {
  id: string; name: string; description: string; status: FormStatus; fields: FormField[]; settings: Partial<FormSettings>;
  created_at: Date; updated_at: Date;
};

export type DomainRow = {
  id: string; hostname: string; kind: 'subdomain' | 'custom'; verification_token: string; status: 'pending' | 'verified' | 'failed';
  status_detail: string; routing_detail: string; checked_at: Date | null; verified_at: Date | null; home_page_id: string | null;
};

export type VariantRow = {
  id: string; page_id: string; key: string; name: string; design_id: string; weight: number; published_html: string; published_css: string;
  published_version: number | null; published_at: Date | null;
};

export const iso = (value: Date | string | null | undefined) => value == null ? null : new Date(value).toISOString();

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function defaultFormSettings(): FormSettings {
  return {
    submitLabel: 'Submit', afterSubmit: 'message', successMessage: 'Thank you! Your details have been received.', redirectUrl: '',
    thankYouPageId: null, tags: [], consent: { enabled: false, text: 'Yes, email me updates and offers. I can unsubscribe at any time.', required: false },
    confirmationDesignId: null, notifyUserId: null,
  };
}

export function formSettings(row: Pick<FormRow, 'settings'>): FormSettings {
  const base = defaultFormSettings();
  const saved = row.settings ?? {};
  return { ...base, ...saved, consent: { ...base.consent, ...(saved.consent ?? {}) }, tags: saved.tags ?? [] };
}

export function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
}

/** A slug not yet used on the domain, adding -2, -3… to the base when needed. */
export async function uniqueSlug(base: string, domainId: string | null, client: Sql = db, exceptPageId?: string) {
  const root = slugify(base);
  const taken = await client.query<{ slug: string }>(
    `SELECT slug FROM landing_pages WHERE coalesce(domain_id::text, '') = coalesce($1::text, '') AND (slug = $2 OR slug LIKE $2 || '-%') AND id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')`,
    [domainId, root, exceptPageId ?? null],
  );
  const used = new Set(taken.rows.map(row => row.slug));
  if (!used.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) if (!used.has(`${root}-${n}`)) return `${root}-${n}`;
  throw new AppError(409, 'Choose a different address for this page.');
}

export async function getForm(id: string, client: Sql = db): Promise<FormRow | null> {
  if (!uuidPattern.test(id)) return null;
  return (await client.query<FormRow>('SELECT * FROM forms WHERE id = $1', [id])).rows[0] ?? null;
}

export async function requirePage(id: string, client: Sql = db): Promise<PageRow> {
  const row = uuidPattern.test(id) ? (await client.query<PageRow>('SELECT * FROM landing_pages WHERE id = $1', [id])).rows[0] : undefined;
  if (!row) throw new AppError(404, 'That landing page was not found.');
  return row;
}

export async function domainsById(ids: (string | null)[], client: Sql = db): Promise<Map<string, DomainRow>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const rows = await client.query<DomainRow>('SELECT * FROM site_domains WHERE id = ANY($1::uuid[])', [unique]);
  return new Map(rows.rows.map(row => [row.id, row]));
}

/** Where a page is (or will be) published: /s/<slug> on the workspace address, or https://<domain>/<slug>. */
export function pageUrl(page: Pick<PageRow, 'id' | 'slug' | 'domain_id'>, domain?: DomainRow | null) {
  if (page.domain_id && domain) return domain.home_page_id === page.id ? `https://${domain.hostname}/` : `https://${domain.hostname}/${page.slug}`;
  return `/s/${page.slug}`;
}

/** Absolute public address for links in emails and the embed snippet. */
export function publicOrigin() {
  const configured = process.env.APP_ORIGIN;
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall through */ }
  }
  return 'http://localhost:3000';
}
