// The workspace brand kit: one record, applied to a template's [[brand.*]] placeholders when a design is created.
import { z } from 'zod';
import type { BrandKit, BrandSummary } from '@/contracts/studio';
import { emailFonts, socialNetworks } from '@/contracts/studio';
import { AppError } from '../config';
import { db, transaction } from '../db';
import type { Sql } from '../db';
import { devPreviewCompany, isDevPreviewMode } from '../dev-preview';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Enter a six-digit hex colour such as #2457d6.');
const fonts = emailFonts.map(font => font.value) as [string, ...string[]];

export const brandInput = z.object({
  name: z.string().trim().min(1).max(80),
  logoUrl: z.union([z.url({ protocol: /^https?$/ }).max(500), z.string().regex(/^\/[^\s]*$/).max(500), z.literal('')]),
  logoWidth: z.coerce.number().int().min(40).max(400),
  primary: hex, accent: hex, text: hex, muted: hex, background: hex, surface: hex,
  headingFont: z.enum(fonts), bodyFont: z.enum(fonts),
  website: z.union([z.url({ protocol: /^https?$/ }).max(300), z.literal('')]),
  footerText: z.string().trim().max(400),
  social: z.array(z.object({ network: z.enum(socialNetworks), url: z.url({ protocol: /^https?$/ }).max(300) })).max(8),
  buttonRadius: z.coerce.number().int().min(0).max(30).default(6),
  buttonStyle: z.enum(['filled', 'outline']).default('filled'),
});

export async function workspaceProfile() {
  if (isDevPreviewMode()) return devPreviewCompany();
  const { company } = await import('../reporting');
  return company();
}

export async function defaultBrand(): Promise<BrandKit> {
  const company = await workspaceProfile();
  const accent = /^#[0-9a-f]{6}$/i.test(company.accent ?? '') ? company.accent.toLowerCase() : '#2457d6';
  return {
    name: company.name || 'Your company', logoUrl: '', logoWidth: 140,
    primary: accent, accent: '#f59e0b', text: '#111827', muted: '#6b7280', background: '#f3f4f6', surface: '#ffffff',
    headingFont: emailFonts[0].value, bodyFont: emailFonts[0].value,
    website: company.website || '',
    footerText: `You are receiving this email because you signed up for updates from ${company.name || 'us'}.`,
    social: [], buttonRadius: 6, buttonStyle: 'filled', updatedAt: null,
  };
}

type BrandRow = { id: string; name: string; kit: Partial<BrandKit>; is_default: boolean; updated_at: Date };

async function toBrandSummary(row: BrandRow, fallback?: BrandKit): Promise<BrandSummary> {
  const base = fallback ?? await defaultBrand();
  const updatedAt = new Date(row.updated_at).toISOString();
  return { id: row.id, name: row.name, isDefault: row.is_default, kit: { ...base, ...row.kit, updatedAt }, updatedAt };
}

const brandColumns = 'id, name, kit, is_default, updated_at';

export async function listBrands(client: Sql = db): Promise<BrandSummary[]> {
  const rows = (await client.query<BrandRow>(`SELECT ${brandColumns} FROM studio_brands ORDER BY is_default DESC, lower(name)`)).rows;
  const fallback = await defaultBrand();
  return Promise.all(rows.map(row => toBrandSummary(row, fallback)));
}

/** A brand kit by id, or the default one (computed from the company profile until one is saved). */
export async function getBrand(client: Sql = db, id?: string | null): Promise<BrandKit> {
  const row = (await client.query<BrandRow>(
    id ? `SELECT ${brandColumns} FROM studio_brands WHERE id = $1` : `SELECT ${brandColumns} FROM studio_brands WHERE is_default`, id ? [id] : [])).rows[0];
  if (!row) {
    if (id) throw new AppError(404, 'That brand kit was not found.');
    return defaultBrand();
  }
  return (await toBrandSummary(row)).kit;
}

/** Updates a brand kit (the default one when no id is given, creating it on first save). */
export async function saveBrand(input: z.infer<typeof brandInput>, userId: string | null, id?: string): Promise<BrandSummary> {
  const target = id ?? (await db.query<{ id: string }>('SELECT id FROM studio_brands WHERE is_default')).rows[0]?.id;
  const row = target
    ? (await db.query<BrandRow>(`UPDATE studio_brands SET name = $2, kit = $3, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING ${brandColumns}`,
      [target, input.name, JSON.stringify(input), userId])).rows[0]
    : (await db.query<BrandRow>(`INSERT INTO studio_brands (name, kit, is_default, updated_by) VALUES ($1, $2, true, $3) RETURNING ${brandColumns}`,
      [input.name, JSON.stringify(input), userId])).rows[0];
  if (!row) throw new AppError(404, 'That brand kit was not found.');
  return toBrandSummary(row);
}

/** A new brand kit, starting as a copy of the default one. The first kit becomes the default. */
export async function createBrand(name: string, userId: string | null, client: Sql = db, kit?: Partial<BrandKit>): Promise<BrandSummary> {
  const { updatedAt: _updatedAt, ...base } = await getBrand(client);
  void _updatedAt;
  const hasDefault = (await client.query('SELECT 1 FROM studio_brands WHERE is_default')).rows.length > 0;
  const row = (await client.query<BrandRow>(`INSERT INTO studio_brands (name, kit, is_default, updated_by) VALUES ($1, $2, $3, $4) RETURNING ${brandColumns}`,
    [name, JSON.stringify({ ...base, ...kit, name: kit?.name ?? name }), !hasDefault, userId])).rows[0];
  return toBrandSummary(row);
}

export async function setDefaultBrand(id: string) {
  await transaction(async client => {
    if (!(await client.query('SELECT 1 FROM studio_brands WHERE id = $1', [id])).rows.length) throw new AppError(404, 'That brand kit was not found.');
    await client.query('UPDATE studio_brands SET is_default = false WHERE is_default AND id <> $1', [id]);
    await client.query('UPDATE studio_brands SET is_default = true WHERE id = $1', [id]);
  });
}

export async function deleteBrand(id: string) {
  const row = (await db.query<{ is_default: boolean }>('SELECT is_default FROM studio_brands WHERE id = $1', [id])).rows[0];
  if (!row) return;
  if (row.is_default) throw new AppError(409, 'Make another brand kit the default before deleting this one.');
  await db.query('DELETE FROM studio_brands WHERE id = $1', [id]);
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function setAttribute(tag: string, name: string, value: string) {
  const existing = new RegExp(` ${name}="[^"]*"`);
  return existing.test(tag) ? tag.replace(existing, ` ${name}="${value}"`) : tag.replace(/^<mj-button/, `<mj-button ${name}="${value}"`);
}

/**
 * Re-themes MJML from one brand kit to another (global styles): every colour and font of the old kit becomes the new
 * kit's in one pass, so values never chain, and buttons take the new radius and filled or outline style.
 */
export function rethemeSource(source: string, from: BrandKit, to: BrandKit) {
  const pairs = new Map<string, string>();
  const add = (a: string, b: string) => { if (a && b && !pairs.has(a.toLowerCase())) pairs.set(a.toLowerCase(), b); };
  for (const key of ['primary', 'accent', 'text', 'muted', 'background', 'surface'] as const) {
    add(from[key], to[key]);
    add('%23' + from[key].slice(1), '%23' + to[key].slice(1));
  }
  for (const key of ['headingFont', 'bodyFont'] as const) {
    add(from[key], to[key]);
    add(from[key].replace(/'/g, '&#39;'), to[key].replace(/'/g, '&#39;'));
  }
  if (from.logoUrl && to.logoUrl) add(from.logoUrl, to.logoUrl);
  const pattern = new RegExp([...pairs.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|'), 'gi');
  const themed = source.replace(pattern, match => pairs.get(match.toLowerCase()) ?? match);
  return themed.replace(/<mj-button\b[^>]*>/g, tag => {
    let next = setAttribute(tag, 'border-radius', `${to.buttonRadius}px`);
    if (from.buttonStyle === to.buttonStyle) return next;
    // Only buttons in the kit's own button style switch; deliberately different buttons keep their colours.
    const background = /background-color="([^"]*)"/.exec(next)?.[1]?.toLowerCase();
    if (to.buttonStyle === 'outline' && background === to.primary.toLowerCase()) {
      next = setAttribute(setAttribute(setAttribute(next, 'background-color', to.surface), 'color', to.primary), 'border', `2px solid ${to.primary}`);
    } else if (to.buttonStyle === 'filled' && background === to.surface.toLowerCase() && next.includes(`border="2px solid ${to.primary}"`)) {
      next = setAttribute(setAttribute(setAttribute(next, 'background-color', to.primary), 'color', '#ffffff'), 'border', 'none');
    }
    return next;
  });
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (value: string) => escapeHtml(value).replace(/'/g, '&#39;');

const socialLabel: Record<string, string> = {
  website: 'Website', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok',
};

/** Social links as text links: they render in every client, unlike hotlinked or embedded icon images. */
export function socialLinks(brand: BrandKit, align = 'center') {
  if (!brand.social.length) return '';
  const links = brand.social.map(item => `<a href="${attr(item.url)}" style="color:${brand.muted};text-decoration:underline">${socialLabel[item.network]}</a>`).join(' &nbsp;·&nbsp; ');
  return `<mj-text align="${align}" font-size="13px" color="${brand.muted}" padding="4px 24px">${links}</mj-text>`;
}

export function logoBlock(brand: BrandKit, align: 'left' | 'center' = 'left') {
  if (brand.logoUrl) {
    return `<mj-image src="${attr(brand.logoUrl)}" alt="${attr(brand.name)}" width="${brand.logoWidth}px" align="${align}" padding="0" href="${attr(brand.website || '#')}" />`;
  }
  return `<mj-text align="${align}" font-family="${attr(brand.headingFont)}" font-size="22px" font-weight="700" color="${brand.primary}" padding="0" letter-spacing="-0.3px">${escapeHtml(brand.name)}</mj-text>`;
}

/** Replaces [[brand.*]] placeholders. Colours also have a `_hex` form (no #) for use inside SVG data URIs. */
export function applyBrand(source: string, brand: BrandKit) {
  const values: Record<string, string> = {
    name: escapeHtml(brand.name),
    primary: brand.primary, accent: brand.accent, text: brand.text, muted: brand.muted, background: brand.background, surface: brand.surface,
    primary_hex: brand.primary.slice(1), accent_hex: brand.accent.slice(1), text_hex: brand.text.slice(1), surface_hex: brand.surface.slice(1),
    background_hex: brand.background.slice(1), muted_hex: brand.muted.slice(1),
    heading_font: attr(brand.headingFont), body_font: attr(brand.bodyFont),
    website: attr(brand.website || '{{workspace.website}}'),
    footer: escapeHtml(brand.footerText),
    logo_block: logoBlock(brand, 'left'),
    logo_block_center: logoBlock(brand, 'center'),
    social: socialLinks(brand, 'center'),
    button_radius: `${brand.buttonRadius ?? 6}px`,
    button_bg: brand.buttonStyle === 'outline' ? brand.surface : brand.primary,
    button_text: brand.buttonStyle === 'outline' ? brand.primary : '#ffffff',
    button_border: brand.buttonStyle === 'outline' ? `2px solid ${brand.primary}` : 'none',
    social_left: socialLinks(brand, 'left'),
  };
  return source.replace(/\[\[brand\.([a-z_]+)\]\]/g, (whole, key: string) => values[key] ?? whole);
}
