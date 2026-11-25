// The workspace brand kit: one record, applied to a template's [[brand.*]] placeholders when a design is created.
import { z } from 'zod';
import type { BrandKit } from '@/contracts/studio';
import { emailFonts, socialNetworks } from '@/contracts/studio';
import { db } from '../db';
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
    social: [], updatedAt: null,
  };
}

export async function getBrand(client: Sql = db): Promise<BrandKit> {
  const fallback = await defaultBrand();
  const row = (await client.query<{ kit: Partial<BrandKit>; updated_at: Date }>(`SELECT kit, updated_at FROM studio_brand_kits WHERE id = 'default'`)).rows[0];
  if (!row) return fallback;
  return { ...fallback, ...row.kit, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function saveBrand(input: z.infer<typeof brandInput>, userId: string | null): Promise<BrandKit> {
  await db.query(
    `INSERT INTO studio_brand_kits (id, kit, updated_by, updated_at) VALUES ('default', $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET kit = EXCLUDED.kit, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(input), userId],
  );
  return getBrand();
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
    social_left: socialLinks(brand, 'left'),
  };
  return source.replace(/\[\[brand\.([a-z_]+)\]\]/g, (whole, key: string) => values[key] ?? whole);
}
