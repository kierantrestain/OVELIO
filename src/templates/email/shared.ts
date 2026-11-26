// Building blocks for the OVELIO email template gallery. Templates are MJML with [[brand.*]] placeholders (filled from
// the brand kit when a design is created, src/server/studio/brand.ts) and OVELIO merge tags (filled at send time).
// Every element is written with explicit attributes and closing tags so the visual editor imports it exactly.
// Images are generated SVG illustrations (data URIs) in brand colours: nothing is hotlinked or copyrighted.
import type { EmailTemplateSummary } from '@/contracts/studio';

export type EmailTemplate = EmailTemplateSummary & { mjml: string };

/** Encodes SVG markup as a data URI. `#` is escaped so `#[[brand.primary_hex]]` becomes a valid colour once filled. */
export function svg(width: number, height: number, body: string) {
  const markup = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>${body}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + markup.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23').replace(/\s+/g, ' ');
}

const P = '#[[brand.primary_hex]]';
const A = '#[[brand.accent_hex]]';
const S = '#[[brand.surface_hex]]';
const B = '#[[brand.background_hex]]';

/** Abstract hero artwork: overlapping shapes in brand colours. */
export function heroArt(variant: number, width = 600, height = 280, label = '') {
  const shapes = [
    `<rect width='${width}' height='${height}' fill='${P}'/><circle cx='${width * 0.82}' cy='${height * 0.3}' r='${height * 0.55}' fill='${A}' opacity='.85'/><circle cx='${width * 0.12}' cy='${height}' r='${height * 0.5}' fill='${S}' opacity='.18'/>`,
    `<rect width='${width}' height='${height}' fill='${B}'/><rect x='${width * 0.08}' y='${height * 0.18}' width='${width * 0.5}' height='${height * 0.64}' rx='18' fill='${P}'/><rect x='${width * 0.46}' y='${height * 0.32}' width='${width * 0.42}' height='${height * 0.5}' rx='18' fill='${A}' opacity='.9'/>`,
    `<rect width='${width}' height='${height}' fill='${P}'/><path d='M0 ${height * 0.7} Q ${width * 0.25} ${height * 0.45} ${width * 0.5} ${height * 0.68} T ${width} ${height * 0.6} V ${height} H0Z' fill='${A}'/><circle cx='${width * 0.78}' cy='${height * 0.28}' r='26' fill='${S}' opacity='.9'/>`,
    `<rect width='${width}' height='${height}' fill='${A}'/><g fill='${P}'>${Array.from({ length: 6 }, (_, i) => `<rect x='${40 + i * (width - 80) / 6}' y='${height * 0.8 - (i + 2) * height * 0.08}' width='${(width - 80) / 6 - 14}' height='${(i + 2) * height * 0.08}' rx='6'/>`).join('')}</g>`,
    `<rect width='${width}' height='${height}' fill='${B}'/><rect x='${width * 0.2}' y='${height * 0.14}' width='${width * 0.6}' height='${height * 0.78}' rx='14' fill='${S}' stroke='${P}' stroke-width='4'/><rect x='${width * 0.26}' y='${height * 0.26}' width='${width * 0.48}' height='${height * 0.3}' rx='8' fill='${P}'/><rect x='${width * 0.26}' y='${height * 0.62}' width='${width * 0.3}' height='12' rx='6' fill='${A}'/><rect x='${width * 0.26}' y='${height * 0.72}' width='${width * 0.4}' height='10' rx='5' fill='${P}' opacity='.35'/>`,
  ];
  const text = label ? `<text x='50%' y='54%' text-anchor='middle' font-family='Helvetica, Arial, sans-serif' font-size='${Math.round(height / 6)}' font-weight='700' fill='${S}'>${label}</text>` : '';
  return svg(width, height, shapes[variant % shapes.length] + text);
}

/** A neutral product or article thumbnail. */
export function thumb(variant: number, width = 260, height = 180) {
  const tones = [[P, A], [A, P], [B, P]];
  const [bg, fg] = tones[variant % tones.length];
  const motif = [
    `<circle cx='${width / 2}' cy='${height / 2}' r='${height / 3}' fill='${fg}'/>`,
    `<rect x='${width * 0.28}' y='${height * 0.22}' width='${width * 0.44}' height='${height * 0.56}' rx='12' fill='${fg}'/>`,
    `<path d='M${width * 0.2} ${height * 0.78} L${width * 0.42} ${height * 0.35} L${width * 0.58} ${height * 0.6} L${width * 0.68} ${height * 0.45} L${width * 0.82} ${height * 0.78}Z' fill='${fg}'/>`,
  ][variant % 3];
  return svg(width, height, `<rect width='${width}' height='${height}' rx='10' fill='${bg}'/>${motif}`);
}

/** A round icon with a short glyph (number or symbol). */
export function badge(glyph: string, filled = true, size = 48) {
  return svg(size, size, `<circle cx='${size / 2}' cy='${size / 2}' r='${size / 2}' fill='${filled ? P : B}'/><text x='50%' y='50%' dy='.35em' text-anchor='middle' font-family='Helvetica, Arial, sans-serif' font-size='${size * 0.42}' font-weight='700' fill='${filled ? S : P}'>${glyph}</text>`);
}

export function head(styles = '') {
  return `<mj-head><mj-style>a { color: [[brand.primary]]; } .ov-footer a { color: [[brand.muted]]; } ${styles}</mj-style></mj-head>`;
}

export const font = `font-family="[[brand.body_font]]"`;
export const headingFont = `font-family="[[brand.heading_font]]"`;

export function text(content: string, options: { size?: number; color?: string; align?: string; padding?: string; weight?: number; lineHeight?: string; heading?: boolean } = {}) {
  return `<mj-text ${options.heading ? headingFont : font} font-size="${options.size ?? 15}px" line-height="${options.lineHeight ?? (options.heading ? '1.25' : '1.6')}" color="${options.color ?? '[[brand.text]]'}" align="${options.align ?? 'left'}" padding="${options.padding ?? '8px 32px'}"${options.weight ? ` font-weight="${options.weight}"` : ''}>${content}</mj-text>`;
}

export function heading(content: string, size = 28, options: { align?: string; color?: string; padding?: string } = {}) {
  return text(content, { size, heading: true, weight: 700, align: options.align, color: options.color, padding: options.padding ?? '16px 32px 4px' });
}

export function button(label: string, href = '[[brand.website]]', options: { align?: string; background?: string; color?: string; padding?: string; radius?: string } = {}) {
  // Default buttons follow the brand kit's global button style (filled or outline, corner radius).
  const themed = !options.background;
  return `<mj-button href="${href}" ${font} background-color="${options.background ?? '[[brand.button_bg]]'}" color="${options.color ?? (themed ? '[[brand.button_text]]' : '#ffffff')}" border="${themed ? '[[brand.button_border]]' : 'none'}" font-size="15px" font-weight="600" border-radius="${options.radius ?? '[[brand.button_radius]]'}" inner-padding="13px 28px" padding="${options.padding ?? '16px 32px'}" align="${options.align ?? 'left'}">${label}</mj-button>`;
}

export function image(src: string, alt: string, options: { width?: number; padding?: string; href?: string; radius?: string; align?: string } = {}) {
  return `<mj-image src="${src}" alt="${alt}"${options.width ? ` width="${options.width}px"` : ''} padding="${options.padding ?? '0'}"${options.href ? ` href="${options.href}"` : ''}${options.radius ? ` border-radius="${options.radius}"` : ''} align="${options.align ?? 'center'}"></mj-image>`;
}

export function divider(padding = '16px 32px', color = '#e5e7eb') {
  return `<mj-divider border-color="${color}" border-width="1px" padding="${padding}"></mj-divider>`;
}

export function spacer(height = 16) {
  return `<mj-spacer height="${height}px"></mj-spacer>`;
}

export function section(columns: string, options: { background?: string; padding?: string; radius?: string; fullWidth?: boolean } = {}) {
  return `<mj-section background-color="${options.background ?? '[[brand.surface]]'}" padding="${options.padding ?? '0'}"${options.radius ? ` border-radius="${options.radius}"` : ''}${options.fullWidth ? ' full-width="full-width"' : ''}>${columns}</mj-section>`;
}

export function column(content: string, options: { width?: string; padding?: string; background?: string; align?: string; radius?: string } = {}) {
  return `<mj-column${options.width ? ` width="${options.width}"` : ''} padding="${options.padding ?? '0'}"${options.background ? ` background-color="${options.background}"` : ''}${options.radius ? ` border-radius="${options.radius}"` : ''} vertical-align="${options.align ?? 'top'}">${content}</mj-column>`;
}

/** Brand header: logo (or name) with an optional right-hand note. */
export function header(note = '', options: { background?: string; center?: boolean } = {}) {
  if (options.center) return section(column(`<mj-spacer height="24px"></mj-spacer>[[brand.logo_block_center]]<mj-spacer height="20px"></mj-spacer>`), { background: options.background });
  return section(
    column(`[[brand.logo_block]]`, { width: '60%', padding: '24px 0 20px 32px', align: 'middle' })
    + column(note ? text(note, { size: 13, color: '[[brand.muted]]', align: 'right', padding: '0 32px 0 0' }) : '', { width: '40%', padding: '24px 0 20px', align: 'middle' }),
    { background: options.background },
  );
}

/** Marketing footer: brand footer text, social links, postal address and a working unsubscribe link (required). */
export function footer(options: { background?: string; transactional?: boolean } = {}) {
  const bottom = options.transactional
    ? `{{workspace.name}} · {{workspace.address}}<br>This is a service email about your account, so it is sent even if you unsubscribed from marketing.`
    : `[[brand.footer]]<br>{{workspace.name}} · {{workspace.address}}<br><a href="{{unsubscribe_url}}" style="color:[[brand.muted]]">Unsubscribe</a> · <a href="{{workspace.website}}" style="color:[[brand.muted]]">Visit our website</a>`;
  return section(column(
    `<mj-spacer height="20px"></mj-spacer>[[brand.social]]`
    + `<mj-text css-class="ov-footer" ${font} font-size="12px" line-height="1.6" color="[[brand.muted]]" align="center" padding="8px 40px 28px">${bottom}</mj-text>`,
  ), { background: options.background ?? '[[brand.background]]' });
}

export function email(body: string, options: { background?: string; styles?: string } = {}) {
  return `<mjml lang="en">${head(options.styles)}<mj-body width="600px" background-color="${options.background ?? '[[brand.background]]'}">${body}</mj-body></mjml>`;
}

/** A two-column key/value table (receipts, event details). */
export function rows(items: [string, string][], options: { bold?: boolean; color?: string } = {}) {
  // A plain HTML table inside mj-text: every client renders it and the visual editor keeps it editable.
  return `<mj-text ${font} font-size="14px" line-height="1.5" color="${options.color ?? '[[brand.text]]'}" padding="4px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${items.map(([label, value]) => `<tr><td style="color:[[brand.muted]];padding:7px 0;border-bottom:1px solid #eef0f3">${label}</td><td style="text-align:right;padding:7px 0;border-bottom:1px solid #eef0f3${options.bold ? ';font-weight:700' : ''}">${value}</td></tr>`).join('')}</table></mj-text>`;
}
