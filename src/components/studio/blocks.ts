// Email studio blocks: OVELIO layouts and content elements, brand header and footer from the brand kit, saved blocks.
// All MJML uses explicit closing tags so GrapesJS parses it exactly.
import type { BrandKit } from '@/contracts/studio';

export type StudioBlock = { id: string; label: string; category: string; media: string; content: string };

const icon = (body: string) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function data(svg: string) {
  return 'data:image/svg+xml;charset=utf-8,' + svg.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');
}

const picture = (brand: BrandKit, w = 600, h = 300) => data(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><rect width='${w}' height='${h}' fill='${brand.background}'/><circle cx='${w * 0.7}' cy='${h * 0.4}' r='${h * 0.32}' fill='${brand.primary}' opacity='.85'/><rect x='${w * 0.12}' y='${h * 0.55}' width='${w * 0.4}' height='${h * 0.28}' rx='12' fill='${brand.accent}'/></svg>`);
const video = (brand: BrandKit) => data(`<svg xmlns='http://www.w3.org/2000/svg' width='600' height='338' viewBox='0 0 600 338'><rect width='600' height='338' fill='${brand.text}'/><circle cx='480' cy='80' r='120' fill='${brand.primary}' opacity='.6'/><circle cx='300' cy='169' r='44' fill='#ffffff'/><path d='M288 147 L322 169 L288 191 Z' fill='${brand.text}'/><text x='300' y='300' text-anchor='middle' font-family='Helvetica, Arial' font-size='18' fill='#ffffff'>Watch the video</text></svg>`);

const text = (brand: BrandKit, content: string, extra = '') => `<mj-text font-family="${escapeHtml(brand.bodyFont)}" font-size="15px" line-height="1.6" color="${brand.text}" padding="8px 32px"${extra}>${content}</mj-text>`;
const button = (brand: BrandKit, label: string) => `<mj-button href="${escapeHtml(brand.website || '#')}" font-family="${escapeHtml(brand.bodyFont)}" background-color="${brand.buttonStyle === 'outline' ? brand.surface : brand.primary}" color="${brand.buttonStyle === 'outline' ? brand.primary : '#ffffff'}" border="${brand.buttonStyle === 'outline' ? `2px solid ${brand.primary}` : 'none'}" font-size="15px" font-weight="600" border-radius="${brand.buttonRadius ?? 6}px" inner-padding="13px 28px" padding="12px 32px" align="left">${label}</mj-button>`;
const section = (brand: BrandKit, inner: string, padding = '16px 0') => `<mj-section background-color="${brand.surface}" padding="${padding}">${inner}</mj-section>`;

function logo(brand: BrandKit, align: 'left' | 'center') {
  return brand.logoUrl
    ? `<mj-image src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" width="${brand.logoWidth}px" align="${align}" padding="0"></mj-image>`
    : `<mj-text align="${align}" font-family="${escapeHtml(brand.headingFont)}" font-size="22px" font-weight="700" color="${brand.primary}" padding="0">${escapeHtml(brand.name)}</mj-text>`;
}

function social(brand: BrandKit) {
  const names: Record<string, string> = { website: 'Website', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' };
  const links = brand.social.length
    ? brand.social.map(item => `<a href="${escapeHtml(item.url)}" style="color:${brand.muted}">${names[item.network]}</a>`).join(' &nbsp;·&nbsp; ')
    : `<a href="${escapeHtml(brand.website || '#')}" style="color:${brand.muted}">Website</a> &nbsp;·&nbsp; <a href="#" style="color:${brand.muted}">LinkedIn</a> &nbsp;·&nbsp; <a href="#" style="color:${brand.muted}">Instagram</a>`;
  return `<mj-text align="center" font-size="13px" color="${brand.muted}" padding="8px 32px">${links}</mj-text>`;
}

export function studioBlocks(brand: BrandKit): StudioBlock[] {
  const col = (inner: string) => `<mj-column>${inner}</mj-column>`;
  const heading = `<mj-text font-family="${escapeHtml(brand.headingFont)}" font-size="26px" font-weight="700" line-height="1.25" color="${brand.text}" padding="16px 32px 4px">Your headline here</mj-text>`;
  const paragraph = text(brand, 'Hi {{contact.first_name | there}}, write something your readers will want to read.');
  const img = (w = 600, h = 300) => `<mj-image src="${picture(brand, w, h)}" alt="Describe this image" padding="0"></mj-image>`;
  return [
    { id: 'ov-1col', label: '1 column', category: 'Layout', media: icon('<rect x="3" y="5" width="18" height="14" rx="2"/>'), content: section(brand, col(heading + paragraph)) },
    { id: 'ov-2col', label: '2 columns', category: 'Layout', media: icon('<rect x="3" y="5" width="8" height="14" rx="2"/><rect x="13" y="5" width="8" height="14" rx="2"/>'), content: section(brand, col(text(brand, 'Left column text.')) + col(text(brand, 'Right column text.'))) },
    { id: 'ov-3col', label: '3 columns', category: 'Layout', media: icon('<rect x="2" y="5" width="6" height="14" rx="1.5"/><rect x="9" y="5" width="6" height="14" rx="1.5"/><rect x="16" y="5" width="6" height="14" rx="1.5"/>'), content: section(brand, [1, 2, 3].map(n => col(text(brand, `<strong>Point ${n}</strong><br>A short supporting line.`, ' align="center"'))).join('')) },
    { id: 'ov-image-text', label: 'Image + text', category: 'Layout', media: icon('<rect x="3" y="5" width="8" height="14" rx="2"/><path d="M14 8h7M14 12h7M14 16h5"/>'), content: section(brand, `<mj-column width="40%">${`<mj-image src="${picture(brand, 260, 200)}" alt="Describe this image" padding="0 0 0 32px"></mj-image>`}</mj-column><mj-column width="60%">${text(brand, '<strong>A clear heading</strong><br>Explain the idea in two or three sentences.')}</mj-column>`) },
    { id: 'ov-heading', label: 'Heading', category: 'Content', media: icon('<path d="M6 4v16M18 4v16M6 12h12"/>'), content: heading },
    { id: 'ov-text', label: 'Text', category: 'Content', media: icon('<path d="M4 6h16M4 10h16M4 14h12M4 18h8"/>'), content: paragraph },
    { id: 'ov-image', label: 'Image', category: 'Content', media: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'), content: img() },
    { id: 'ov-button', label: 'Button', category: 'Content', media: icon('<rect x="3" y="8" width="18" height="8" rx="4"/>'), content: button(brand, 'Call to action') },
    { id: 'ov-divider', label: 'Divider', category: 'Content', media: icon('<path d="M3 12h18"/>'), content: `<mj-divider border-color="#e5e7eb" border-width="1px" padding="16px 32px"></mj-divider>` },
    { id: 'ov-spacer', label: 'Spacer', category: 'Content', media: icon('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>'), content: `<mj-spacer height="24px"></mj-spacer>` },
    { id: 'ov-social', label: 'Social links', category: 'Content', media: icon('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8 11 8-4M8 13l8 4"/>'), content: social(brand) },
    {
      id: 'ov-product', label: 'Product card', category: 'Content', media: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><rect x="7" y="6" width="10" height="7" rx="1"/><path d="M7 16h6"/>'),
      content: section(brand, `<mj-column width="45%"><mj-image src="${picture(brand, 260, 220)}" alt="Product photo" padding="0 0 0 32px" border-radius="8px"></mj-image></mj-column><mj-column width="55%">${text(brand, '<strong style="font-size:18px">Product name</strong><br><span style="color:' + brand.muted + '">A one-line description of what makes it great.</span>')}${text(brand, '<strong>£49.00</strong>', ' padding="0 32px"')}${button(brand, 'Buy now')}</mj-column>`),
    },
    { id: 'ov-video', label: 'Video thumbnail', category: 'Content', media: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'), content: `<mj-image src="${video(brand)}" alt="Play the video" href="https://www.example.com/video" padding="8px 32px" border-radius="8px"></mj-image>` },
    {
      id: 'ov-brand-header', label: 'Brand header', category: 'Brand', media: icon('<rect x="3" y="4" width="18" height="6" rx="1.5"/><path d="M3 14h18M3 18h12"/>'),
      content: `<mj-section background-color="${brand.surface}" padding="24px 0 16px"><mj-column>${logo(brand, 'center')}</mj-column></mj-section>`,
    },
    {
      id: 'ov-brand-footer', label: 'Brand footer', category: 'Brand', media: icon('<path d="M3 6h18M3 10h12"/><rect x="3" y="14" width="18" height="6" rx="1.5"/>'),
      content: `<mj-section background-color="${brand.background}" padding="20px 0"><mj-column>${social(brand)}<mj-text align="center" font-size="12px" line-height="1.6" color="${brand.muted}" padding="8px 40px 20px">${escapeHtml(brand.footerText)}<br>{{workspace.name}} · {{workspace.address}}<br><a href="{{unsubscribe_url}}" style="color:${brand.muted}">Unsubscribe</a></mj-text></mj-column></mj-section>`,
    },
  ];
}
