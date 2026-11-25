// OVELIO landing-page kit: one set of `ovp-` classes every template, builder block and saved section uses.
// Each template renders the kit CSS with its own theme as concrete values (the page builder's CSS parser drops
// custom properties inside shorthands), so blocks dropped into a page pick up that page's look automatically.
// Everything is self-contained: system font stacks and inline SVG art, no external fonts, images or scripts.

export type Theme = {
  font: string;
  headingFont: string;
  bg: string;
  surface: string;
  alt: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  border: string;
  radius: number;
  heroBg: string;
  heroInk: string;
  heroMuted: string;
  headingWeight: number;
  headingSpacing: string;
};

export const fonts = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
};

export const defaultTheme: Theme = {
  font: fonts.sans, headingFont: fonts.sans, bg: '#ffffff', surface: '#ffffff', alt: '#f5f7fb', ink: '#0f172a', muted: '#475569',
  accent: '#2457d6', accentInk: '#ffffff', accentSoft: '#e8eefc', border: '#e2e8f0', radius: 12,
  heroBg: 'linear-gradient(160deg, #f5f8ff 0%, #ffffff 60%)', heroInk: '#0f172a', heroMuted: '#475569', headingWeight: 750, headingSpacing: '-0.02em',
};

export function theme(overrides: Partial<Theme>): Theme {
  return { ...defaultTheme, ...overrides };
}

/** The kit stylesheet for a theme. Desktop-first breakpoints match the builder's Tablet (992px) and Mobile (480px) views. */
export function kitCss(t: Theme): string {
  const r = t.radius;
  return `body{margin:0;font-family:${t.font};color:${t.ink};background-color:${t.bg};line-height:1.6;-webkit-font-smoothing:antialiased;}
img,svg{max-width:100%;}
.ovp-wrap{max-width:1120px;margin-left:auto;margin-right:auto;padding-left:24px;padding-right:24px;}
.ovp-nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:20px;padding-bottom:20px;}
.ovp-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:-0.01em;color:inherit;text-decoration:none;}
.ovp-mark{width:30px;height:30px;border-radius:${Math.min(r, 10)}px;background-color:${t.accent};display:inline-block;}
.ovp-nav-links{display:flex;align-items:center;gap:24px;font-size:15px;}
.ovp-nav-links a{color:inherit;text-decoration:none;opacity:0.85;}
.ovp-hero{background:${t.heroBg};color:${t.heroInk};padding-bottom:88px;}
.ovp-hero-grid{display:grid;grid-template-columns:1.1fr 0.9fr;gap:56px;align-items:center;padding-top:48px;}
.ovp-hero-center{text-align:center;max-width:820px;margin-left:auto;margin-right:auto;padding-top:64px;}
.ovp-hero-center .ovp-actions{justify-content:center;}
.ovp-hero .ovp-lead{color:${t.heroMuted};}
.ovp-eyebrow{display:inline-block;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${t.accent};margin-bottom:14px;}
.ovp-hero .ovp-eyebrow{color:${t.heroInk === t.ink ? t.accent : t.heroInk};opacity:0.9;}
.ovp-pill{display:inline-block;padding:6px 14px;border-radius:999px;background-color:${t.accentSoft};color:${t.accent};font-size:13px;font-weight:700;margin-bottom:18px;}
.ovp-h1{font-family:${t.headingFont};font-size:clamp(2.2rem, 4.6vw, 3.9rem);line-height:1.06;font-weight:${t.headingWeight};letter-spacing:${t.headingSpacing};margin:0 0 20px 0;}
.ovp-h2{font-family:${t.headingFont};font-size:clamp(1.8rem, 3.2vw, 2.6rem);line-height:1.15;font-weight:${t.headingWeight};letter-spacing:${t.headingSpacing};margin:0 0 14px 0;}
.ovp-h3{font-family:${t.headingFont};font-size:20px;line-height:1.3;font-weight:700;margin:0 0 8px 0;}
.ovp-lead{font-size:clamp(1.05rem, 1.6vw, 1.25rem);color:${t.muted};margin:0 0 28px 0;max-width:640px;}
.ovp-hero-center .ovp-lead{margin-left:auto;margin-right:auto;}
.ovp-text{color:${t.muted};margin:0 0 12px 0;}
.ovp-small{font-size:14px;color:${t.muted};}
.ovp-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;}
.ovp-btn{display:inline-block;padding:14px 26px;border-radius:${r}px;background-color:${t.accent};color:${t.accentInk};font-weight:700;font-size:16px;text-decoration:none;border:2px solid ${t.accent};text-align:center;}
.ovp-btn:hover{opacity:0.92;}
.ovp-btn-ghost{background-color:transparent;color:inherit;border-color:currentColor;}
.ovp-section{padding-top:88px;padding-bottom:88px;}
.ovp-alt{background-color:${t.alt};}
.ovp-dark{background-color:${t.ink};color:${t.bg};}
.ovp-dark .ovp-text,.ovp-dark .ovp-lead{color:${t.bg};opacity:0.8;}
.ovp-head{text-align:center;max-width:720px;margin:0 auto 48px auto;}
.ovp-head .ovp-lead{margin-left:auto;margin-right:auto;margin-bottom:0;}
.ovp-grid-2{display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:28px;}
.ovp-grid-3{display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:28px;}
.ovp-grid-4{display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:24px;}
.ovp-row{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;}
.ovp-card{background-color:${t.surface};color:${t.ink};border:1px solid ${t.border};border-radius:${r + 4}px;padding:28px;box-shadow:0 1px 2px rgba(15,23,42,0.04);}
.ovp-form-card{background-color:${t.surface};color:${t.ink};border:1px solid ${t.border};border-radius:${r + 6}px;padding:32px;box-shadow:0 24px 60px rgba(15,23,42,0.14);}
.ovp-form-card .ovp-h3{font-size:22px;}
.ovp-icon{width:48px;height:48px;border-radius:${r}px;background-color:${t.accentSoft};color:${t.accent};display:flex;align-items:center;justify-content:center;margin-bottom:18px;}
.ovp-checks{list-style:none;padding:0;margin:0 0 28px 0;display:grid;gap:10px;}
.ovp-checks li{display:flex;gap:10px;align-items:flex-start;}
.ovp-check{flex:none;width:22px;height:22px;border-radius:999px;background-color:${t.accentSoft};color:${t.accent};font-size:13px;font-weight:800;line-height:22px;text-align:center;}
.ovp-logos{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:20px 48px;padding-top:36px;padding-bottom:36px;}
.ovp-logo{font-weight:800;font-size:20px;letter-spacing:0.02em;color:${t.muted};opacity:0.75;}
.ovp-logos-title{text-align:center;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${t.muted};margin:0;padding-top:40px;}
.ovp-stat{text-align:center;}
.ovp-stat-value{font-family:${t.headingFont};font-size:clamp(2rem, 3.4vw, 2.8rem);font-weight:800;color:${t.accent};line-height:1.1;}
.ovp-stat-label{color:${t.muted};font-size:15px;}
.ovp-quote{font-size:17px;margin:0 0 20px 0;}
.ovp-person{display:flex;align-items:center;gap:12px;}
.ovp-avatar{flex:none;width:44px;height:44px;border-radius:999px;background-color:${t.accent};color:${t.accentInk};font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;}
.ovp-avatar-lg{width:84px;height:84px;font-size:26px;margin:0 auto 14px auto;}
.ovp-name{font-weight:700;}
.ovp-role{font-size:14px;color:${t.muted};}
.ovp-plan{display:flex;flex-direction:column;}
.ovp-plan-featured{border:2px solid ${t.accent};box-shadow:0 24px 50px rgba(15,23,42,0.12);}
.ovp-price{font-family:${t.headingFont};font-size:44px;font-weight:800;line-height:1.1;margin:12px 0 4px 0;}
.ovp-price small{font-size:16px;font-weight:600;color:${t.muted};}
.ovp-plan .ovp-checks{flex:1;margin-top:20px;}
.ovp-faq{max-width:760px;margin:0 auto;display:grid;gap:12px;}
.ovp-faq details{background-color:${t.surface};border:1px solid ${t.border};border-radius:${r}px;padding:18px 22px;}
.ovp-faq summary{cursor:pointer;font-weight:700;font-size:17px;}
.ovp-faq details p{margin:12px 0 0 0;color:${t.muted};}
.ovp-steps{counter-reset:none;}
.ovp-step-num{width:40px;height:40px;border-radius:999px;border:2px solid ${t.accent};color:${t.accent};font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:16px;}
.ovp-agenda{max-width:820px;margin:0 auto;display:grid;gap:12px;}
.ovp-agenda-row{display:grid;grid-template-columns:120px 1fr;gap:20px;padding:20px 24px;background-color:${t.surface};border:1px solid ${t.border};border-radius:${r}px;}
.ovp-time{font-weight:800;color:${t.accent};}
.ovp-countdown{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 28px 0;}
.ovp-hero-center .ovp-countdown{justify-content:center;}
.ovp-cd-box{min-width:78px;padding:12px 10px;border-radius:${r}px;background-color:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.28);text-align:center;}
.ovp-cd-num{display:block;font-size:30px;font-weight:800;line-height:1.1;}
.ovp-cd-label{display:block;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.8;}
.ovp-cta{text-align:center;border-radius:${r + 8}px;padding:64px 32px;background:${t.heroBg};color:${t.heroInk};}
.ovp-cta .ovp-lead{margin-left:auto;margin-right:auto;color:${t.heroMuted};}
.ovp-cta .ovp-actions{justify-content:center;}
.ovp-art{width:100%;height:auto;display:block;}
.ovp-media{border-radius:${r + 6}px;overflow:hidden;}
.ovp-video{position:relative;padding-top:56.25%;border-radius:${r + 4}px;overflow:hidden;background-color:#0b1020;}
.ovp-video iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;}
.ovp-img{display:block;width:100%;height:auto;border-radius:${r}px;}
.ovp-form-slot{min-height:40px;}
.ovp-footer{padding-top:40px;padding-bottom:40px;border-top:1px solid ${t.border};font-size:14px;color:${t.muted};}
.ovp-footer-inner{display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;align-items:center;}
.ovp-footer a{color:inherit;text-decoration:none;margin-left:20px;}
.ovf-submit{background-color:${t.accent};color:${t.accentInk};border-radius:${r}px;}
.ovf input:focus,.ovf select:focus,.ovf textarea:focus{border-color:${t.accent};box-shadow:0 0 0 3px ${t.accentSoft};}
@media (max-width: 992px){.ovp-hero-grid{grid-template-columns:1fr;gap:40px;}.ovp-row{grid-template-columns:1fr;gap:36px;}.ovp-grid-3{grid-template-columns:repeat(2, minmax(0, 1fr));}.ovp-grid-4{grid-template-columns:repeat(2, minmax(0, 1fr));}.ovp-nav-links{display:none;}.ovp-section{padding-top:64px;padding-bottom:64px;}}
@media (max-width: 480px){.ovp-wrap{padding-left:18px;padding-right:18px;}.ovp-grid-2{grid-template-columns:1fr;}.ovp-grid-3{grid-template-columns:1fr;}.ovp-grid-4{grid-template-columns:1fr 1fr;gap:16px;}.ovp-hero{padding-bottom:56px;}.ovp-hero-grid{padding-top:24px;}.ovp-section{padding-top:52px;padding-bottom:52px;}.ovp-form-card{padding:22px;}.ovp-card{padding:22px;}.ovp-agenda-row{grid-template-columns:1fr;gap:4px;}.ovp-cta{padding:44px 20px;}.ovp-btn{display:block;width:100%;}.ovp-footer a{margin-left:0;margin-right:16px;}}
`;
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────────────────────────

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('');

export function nav(brand: string, links: string[], cta?: { label: string; href: string }) {
  return `<header class="ovp-wrap ovp-nav"><a class="ovp-brand" href="#top"><span class="ovp-mark"></span>${esc(brand)}</a>`
    + `<nav class="ovp-nav-links">${links.map(link => `<a href="#${link.toLowerCase().replace(/[^a-z]+/g, '-')}">${esc(link)}</a>`).join('')}`
    + `${cta ? `<a class="ovp-btn" href="${cta.href}">${esc(cta.label)}</a>` : ''}</nav></header>`;
}

/** The form block: the published page renders the bound OVELIO form inside it. */
export const formSlot = (formId = '') => `<div class="ovp-form-slot" data-ovelio-form="${formId}"></div>`;

export const checks = (items: string[]) => `<ul class="ovp-checks">${items.map(item => `<li><span class="ovp-check">✓</span><span>${esc(item)}</span></li>`).join('')}</ul>`;

export function heroForm(input: { brand: string; links?: string[]; eyebrow: string; title: string; lead: string; bullets?: string[]; formTitle: string; formNote?: string; extra?: string }) {
  return `<section class="ovp-hero" id="top">${nav(input.brand, input.links ?? [])}<div class="ovp-wrap ovp-hero-grid"><div>`
    + `<span class="ovp-eyebrow">${esc(input.eyebrow)}</span><h1 class="ovp-h1">${esc(input.title)}</h1><p class="ovp-lead">${esc(input.lead)}</p>`
    + `${input.bullets ? checks(input.bullets) : ''}${input.extra ?? ''}</div>`
    + `<div class="ovp-form-card" id="register"><h2 class="ovp-h3">${esc(input.formTitle)}</h2>${input.formNote ? `<p class="ovp-small">${esc(input.formNote)}</p>` : ''}${formSlot()}</div>`
    + `</div></section>`;
}

export function heroArt(input: { brand: string; links?: string[]; cta?: { label: string; href: string }; eyebrow: string; title: string; lead: string; actions: { label: string; href: string; ghost?: boolean }[]; art: string; note?: string }) {
  return `<section class="ovp-hero" id="top">${nav(input.brand, input.links ?? [], input.cta)}<div class="ovp-wrap ovp-hero-grid"><div>`
    + `<span class="ovp-eyebrow">${esc(input.eyebrow)}</span><h1 class="ovp-h1">${esc(input.title)}</h1><p class="ovp-lead">${esc(input.lead)}</p>`
    + `<div class="ovp-actions">${input.actions.map(action => `<a class="ovp-btn${action.ghost ? ' ovp-btn-ghost' : ''}" href="${action.href}">${esc(action.label)}</a>`).join('')}</div>`
    + `${input.note ? `<p class="ovp-small" style="margin-top:16px">${esc(input.note)}</p>` : ''}</div><div class="ovp-media">${input.art}</div></div></section>`;
}

export function heroCenter(input: { brand: string; links?: string[]; pill?: string; title: string; lead: string; body?: string; note?: string }) {
  return `<section class="ovp-hero" id="top">${nav(input.brand, input.links ?? [])}<div class="ovp-wrap"><div class="ovp-hero-center">`
    + `${input.pill ? `<span class="ovp-pill">${esc(input.pill)}</span>` : ''}<h1 class="ovp-h1">${esc(input.title)}</h1><p class="ovp-lead">${esc(input.lead)}</p>`
    + `${input.body ?? ''}${input.note ? `<p class="ovp-small">${esc(input.note)}</p>` : ''}</div></div></section>`;
}

export function logos(title: string, names: string[]) {
  return `<section class="ovp-alt"><p class="ovp-logos-title">${esc(title)}</p><div class="ovp-wrap ovp-logos">${names.map(name => `<span class="ovp-logo">${esc(name)}</span>`).join('')}</div></section>`;
}

const iconPaths: Record<string, string> = {
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 100-6M22 21c0-3-2-5-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="M12 2l3 7 7 .6-5.3 4.7L18.4 22 12 18l-6.4 4 1.7-7.7L2 9.6 9 9z"/>',
  heart: '<path d="M12 21s-8-5-8-11a5 5 0 019-3 5 5 0 019 3c0 6-8 11-8 11z" transform="translate(-1 0)"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book: '<path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z"/>',
  leaf: '<path d="M5 19c0-9 6-15 15-15 0 9-6 15-15 15zM5 19l7-7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  play: '<polygon points="7,4 20,12 7,20"/>',
  rocket: '<path d="M5 15c-1 1-2 4-2 6 2 0 5-1 6-2M9 15l-3-3c1-4 5-9 12-9 0 7-5 11-9 12z"/><circle cx="15" cy="9" r="1.5"/>',
};

export const icon = (name: string) => `<div class="ovp-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] ?? iconPaths.star}</svg></div>`;

export function features(input: { id?: string; eyebrow?: string; title: string; lead?: string; items: { icon: string; title: string; text: string }[]; alt?: boolean; columns?: 2 | 3 | 4 }) {
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="${input.id ?? 'features'}"><div class="ovp-wrap"><div class="ovp-head">`
    + `${input.eyebrow ? `<span class="ovp-eyebrow">${esc(input.eyebrow)}</span>` : ''}<h2 class="ovp-h2">${esc(input.title)}</h2>${input.lead ? `<p class="ovp-lead">${esc(input.lead)}</p>` : ''}</div>`
    + `<div class="ovp-grid-${input.columns ?? 3}">${input.items.map(item => `<div class="ovp-card">${icon(item.icon)}<h3 class="ovp-h3">${esc(item.title)}</h3><p class="ovp-text">${esc(item.text)}</p></div>`).join('')}</div></div></section>`;
}

export function stats(items: { value: string; label: string }[], alt = false) {
  return `<section class="ovp-section${alt ? ' ovp-alt' : ''}" style="padding-top:56px;padding-bottom:56px"><div class="ovp-wrap ovp-grid-${items.length === 3 ? 3 : 4}">`
    + items.map(item => `<div class="ovp-stat"><div class="ovp-stat-value">${esc(item.value)}</div><div class="ovp-stat-label">${esc(item.label)}</div></div>`).join('')
    + `</div></section>`;
}

export function testimonials(input: { title: string; items: { quote: string; name: string; role: string }[]; alt?: boolean }) {
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="testimonials"><div class="ovp-wrap"><div class="ovp-head"><h2 class="ovp-h2">${esc(input.title)}</h2></div>`
    + `<div class="ovp-grid-${input.items.length === 2 ? 2 : 3}">${input.items.map(item => `<figure class="ovp-card" style="margin:0"><blockquote class="ovp-quote">“${esc(item.quote)}”</blockquote>`
      + `<figcaption class="ovp-person"><span class="ovp-avatar">${initials(item.name)}</span><span><span class="ovp-name">${esc(item.name)}</span><br><span class="ovp-role">${esc(item.role)}</span></span></figcaption></figure>`).join('')}</div></div></section>`;
}

export function pricing(input: { title: string; lead?: string; plans: { name: string; price: string; period?: string; text: string; features: string[]; cta: string; featured?: boolean }[]; alt?: boolean }) {
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="pricing"><div class="ovp-wrap"><div class="ovp-head"><h2 class="ovp-h2">${esc(input.title)}</h2>${input.lead ? `<p class="ovp-lead">${esc(input.lead)}</p>` : ''}</div>`
    + `<div class="ovp-grid-${input.plans.length}">${input.plans.map(plan => `<div class="ovp-card ovp-plan${plan.featured ? ' ovp-plan-featured' : ''}">`
      + `${plan.featured ? '<span class="ovp-pill" style="align-self:flex-start">Most popular</span>' : ''}<h3 class="ovp-h3">${esc(plan.name)}</h3>`
      + `<div class="ovp-price">${esc(plan.price)}${plan.period ? `<small> ${esc(plan.period)}</small>` : ''}</div><p class="ovp-text">${esc(plan.text)}</p>`
      + `${checks(plan.features)}<a class="ovp-btn${plan.featured ? '' : ' ovp-btn-ghost'}" href="#register">${esc(plan.cta)}</a></div>`).join('')}</div></div></section>`;
}

export function faq(items: { q: string; a: string }[], alt = false) {
  return `<section class="ovp-section${alt ? ' ovp-alt' : ''}" id="faq"><div class="ovp-wrap"><div class="ovp-head"><h2 class="ovp-h2">Frequently asked questions</h2></div>`
    + `<div class="ovp-faq">${items.map(item => `<details><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('')}</div></div></section>`;
}

export function steps(input: { title: string; items: { title: string; text: string }[]; alt?: boolean }) {
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="how-it-works"><div class="ovp-wrap"><div class="ovp-head"><h2 class="ovp-h2">${esc(input.title)}</h2></div>`
    + `<div class="ovp-grid-${input.items.length}">${input.items.map((item, index) => `<div><div class="ovp-step-num">${index + 1}</div><h3 class="ovp-h3">${esc(item.title)}</h3><p class="ovp-text">${esc(item.text)}</p></div>`).join('')}</div></div></section>`;
}

export function agenda(input: { title: string; items: { time: string; title: string; who: string }[]; alt?: boolean }) {
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="agenda"><div class="ovp-wrap"><div class="ovp-head"><h2 class="ovp-h2">${esc(input.title)}</h2></div><div class="ovp-agenda">`
    + input.items.map(item => `<div class="ovp-agenda-row"><div class="ovp-time">${esc(item.time)}</div><div><div class="ovp-name">${esc(item.title)}</div><div class="ovp-role">${esc(item.who)}</div></div></div>`).join('')
    + `</div></div></section>`;
}

export function speakers(input: { title: string; people: { name: string; role: string }[]; alt?: boolean }) {
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="speakers"><div class="ovp-wrap"><div class="ovp-head"><h2 class="ovp-h2">${esc(input.title)}</h2></div>`
    + `<div class="ovp-grid-${Math.min(4, input.people.length)}">${input.people.map(person => `<div class="ovp-card" style="text-align:center"><div class="ovp-avatar ovp-avatar-lg">${initials(person.name)}</div><div class="ovp-name">${esc(person.name)}</div><div class="ovp-role">${esc(person.role)}</div></div>`).join('')}</div></div></section>`;
}

export function countdown(isoDate: string) {
  const unit = (name: string, label: string) => `<div class="ovp-cd-box"><span class="ovp-cd-num" data-unit="${name}">00</span><span class="ovp-cd-label">${label}</span></div>`;
  return `<div class="ovp-countdown" data-ovelio-countdown="${isoDate}">${unit('days', 'Days')}${unit('hours', 'Hours')}${unit('minutes', 'Minutes')}${unit('seconds', 'Seconds')}</div>`;
}

export function split(input: { id?: string; eyebrow?: string; title: string; text: string; bullets?: string[]; art: string; reverse?: boolean; alt?: boolean }) {
  const copy = `<div>${input.eyebrow ? `<span class="ovp-eyebrow">${esc(input.eyebrow)}</span>` : ''}<h2 class="ovp-h2">${esc(input.title)}</h2><p class="ovp-text">${esc(input.text)}</p>${input.bullets ? checks(input.bullets) : ''}</div>`;
  const media = `<div class="ovp-media">${input.art}</div>`;
  return `<section class="ovp-section${input.alt ? ' ovp-alt' : ''}" id="${input.id ?? 'details'}"><div class="ovp-wrap ovp-row">${input.reverse ? media + copy : copy + media}</div></section>`;
}

export function ctaBand(input: { title: string; lead: string; label: string; href?: string; withForm?: boolean }) {
  return `<section class="ovp-section" id="cta"><div class="ovp-wrap"><div class="ovp-cta"><h2 class="ovp-h2">${esc(input.title)}</h2><p class="ovp-lead">${esc(input.lead)}</p>`
    + (input.withForm ? `<div class="ovp-form-card" style="max-width:520px;margin:0 auto;text-align:left">${formSlot()}</div>` : `<div class="ovp-actions"><a class="ovp-btn" href="${input.href ?? '#register'}">${esc(input.label)}</a></div>`)
    + `</div></div></section>`;
}

export function footer(brand: string, links: string[] = ['Privacy', 'Terms', 'Contact']) {
  return `<footer class="ovp-footer"><div class="ovp-wrap ovp-footer-inner"><span>© ${new Date().getFullYear()} ${esc(brand)}. All rights reserved.</span>`
    + `<span>${links.map(link => `<a href="#">${esc(link)}</a>`).join('')}</span></div></footer>`;
}

// ── Inline SVG art ──────────────────────────────────────────────────────────────────────────────────────────────

const svg = (body: string, label: string, viewBox = '0 0 560 420') => `<svg class="ovp-art" viewBox="${viewBox}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const art = {
  dashboard: (accent: string, soft: string) => svg(`<rect width="560" height="420" rx="22" fill="#ffffff"/><rect x="0.5" y="0.5" width="559" height="419" rx="22" fill="none" stroke="#e2e8f0"/>`
    + `<rect x="24" y="24" width="130" height="372" rx="12" fill="${soft}"/><rect x="40" y="48" width="70" height="10" rx="5" fill="${accent}"/>`
    + [80, 108, 136, 164].map(y => `<rect x="40" y="${y}" width="96" height="8" rx="4" fill="#cbd5e1"/>`).join('')
    + `<rect x="174" y="24" width="362" height="110" rx="12" fill="#f8fafc"/><rect x="194" y="44" width="90" height="10" rx="5" fill="#94a3b8"/><rect x="194" y="66" width="140" height="26" rx="6" fill="#0f172a"/>`
    + `<path d="M380 112 L410 86 L440 96 L470 64 L516 48" stroke="${accent}" stroke-width="5" fill="none" stroke-linecap="round"/>`
    + `<rect x="174" y="150" width="174" height="246" rx="12" fill="#f8fafc"/><rect x="362" y="150" width="174" height="246" rx="12" fill="#f8fafc"/>`
    + [0, 1, 2, 3, 4].map(i => `<rect x="${196 + i * 30}" y="${360 - (i + 2) * 28}" width="18" height="${(i + 2) * 28}" rx="5" fill="${i === 4 ? accent : '#cbd5e1'}"/>`).join('')
    + `<circle cx="449" cy="262" r="62" fill="none" stroke="#e2e8f0" stroke-width="18"/><circle cx="449" cy="262" r="62" fill="none" stroke="${accent}" stroke-width="18" stroke-dasharray="260 400" transform="rotate(-90 449 262)"/>`, 'Product dashboard illustration'),
  ebook: (accent: string, ink: string) => svg(`<rect x="150" y="30" width="270" height="360" rx="10" fill="${ink}"/><rect x="138" y="22" width="270" height="360" rx="10" fill="${accent}"/>`
    + `<rect x="138" y="22" width="22" height="360" fill="rgba(0,0,0,0.18)"/><rect x="186" y="80" width="180" height="14" rx="7" fill="rgba(255,255,255,0.65)"/>`
    + `<rect x="186" y="110" width="200" height="30" rx="6" fill="#ffffff"/><rect x="186" y="150" width="150" height="30" rx="6" fill="#ffffff"/>`
    + `<circle cx="300" cy="270" r="56" fill="rgba(255,255,255,0.16)"/><path d="M270 285 L295 250 L315 272 L335 240" stroke="#ffffff" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<rect x="186" y="344" width="110" height="10" rx="5" fill="rgba(255,255,255,0.65)"/>`, 'Guide cover illustration'),
  checklist: (accent: string, soft: string) => svg(`<rect x="110" y="20" width="340" height="380" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/><rect x="230" y="8" width="100" height="30" rx="10" fill="${accent}"/>`
    + [0, 1, 2, 3, 4].map(i => `<rect x="150" y="${80 + i * 60}" width="34" height="34" rx="8" fill="${i < 3 ? accent : soft}"/>${i < 3 ? `<path d="M158 ${97 + i * 60} l7 7 l12 -14" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>` : ''}<rect x="200" y="${88 + i * 60}" width="${200 - i * 18}" height="16" rx="8" fill="#cbd5e1"/>`).join(''), 'Checklist illustration'),
  calendar: (accent: string, soft: string) => svg(`<rect x="70" y="50" width="420" height="330" rx="22" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/><rect x="70" y="50" width="420" height="78" rx="22" fill="${accent}"/><rect x="70" y="100" width="420" height="28" fill="${accent}"/>`
    + `<rect x="140" y="30" width="16" height="50" rx="8" fill="#0f172a"/><rect x="404" y="30" width="16" height="50" rx="8" fill="#0f172a"/>`
    + Array.from({ length: 15 }, (_, i) => `<rect x="${100 + (i % 5) * 76}" y="${150 + Math.floor(i / 5) * 70}" width="56" height="50" rx="10" fill="${i === 7 ? accent : soft}"/>`).join(''), 'Event calendar illustration'),
  stage: (accent: string, soft: string) => svg(`<rect width="560" height="420" rx="22" fill="#0b1020"/><circle cx="280" cy="120" r="150" fill="${accent}" opacity="0.35"/><circle cx="420" cy="60" r="90" fill="${soft}" opacity="0.18"/>`
    + `<rect x="60" y="300" width="440" height="20" rx="6" fill="#1e293b"/><rect x="230" y="190" width="100" height="110" rx="10" fill="#1e293b"/><circle cx="280" cy="150" r="34" fill="#f1f5f9"/>`
    + `<rect x="246" y="186" width="68" height="80" rx="16" fill="${accent}"/>` + [0, 1, 2, 3, 4, 5, 6].map(i => `<circle cx="${90 + i * 64}" cy="370" r="18" fill="#334155"/>`).join(''), 'Conference stage illustration'),
  webinar: (accent: string, soft: string) => svg(`<rect x="20" y="30" width="520" height="330" rx="20" fill="#0f172a"/><rect x="36" y="46" width="330" height="298" rx="12" fill="#1e293b"/>`
    + `<circle cx="201" cy="160" r="46" fill="${soft}"/><rect x="141" y="216" width="120" height="96" rx="40" fill="${soft}"/><rect x="56" y="300" width="90" height="26" rx="13" fill="#ef4444"/><circle cx="74" cy="313" r="6" fill="#fff"/>`
    + [0, 1, 2].map(i => `<rect x="382" y="${46 + i * 102}" width="142" height="90" rx="12" fill="#1e293b"/><circle cx="453" cy="${82 + i * 102}" r="20" fill="${i === 1 ? accent : '#475569'}"/>`).join('')
    + `<rect x="180" y="374" width="200" height="16" rx="8" fill="${accent}"/>`, 'Live webinar illustration'),
  phone: (accent: string, soft: string) => svg(`<circle cx="280" cy="210" r="190" fill="${soft}"/><rect x="190" y="20" width="180" height="380" rx="34" fill="#0f172a"/><rect x="202" y="34" width="156" height="352" rx="26" fill="#ffffff"/>`
    + `<rect x="250" y="44" width="60" height="10" rx="5" fill="#0f172a"/><rect x="218" y="76" width="124" height="80" rx="14" fill="${accent}"/>`
    + [0, 1, 2, 3].map(i => `<rect x="218" y="${172 + i * 46}" width="124" height="34" rx="10" fill="#f1f5f9"/><circle cx="236" cy="${189 + i * 46}" r="9" fill="${i === 0 ? accent : '#cbd5e1'}"/>`).join(''), 'Mobile app illustration'),
  product: (accent: string, soft: string) => svg(`<ellipse cx="280" cy="380" rx="150" ry="18" fill="rgba(15,23,42,0.12)"/><circle cx="280" cy="200" r="170" fill="${soft}"/>`
    + `<rect x="225" y="70" width="110" height="300" rx="40" fill="${accent}"/><rect x="243" y="40" width="74" height="44" rx="14" fill="#0f172a"/><rect x="225" y="170" width="110" height="80" fill="rgba(255,255,255,0.22)"/>`
    + `<rect x="246" y="96" width="14" height="240" rx="7" fill="rgba(255,255,255,0.35)"/>`, 'Product illustration'),
  report: (accent: string, soft: string) => svg(`<rect x="60" y="40" width="440" height="340" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/><rect x="92" y="72" width="180" height="16" rx="8" fill="#0f172a"/><rect x="92" y="100" width="260" height="10" rx="5" fill="#cbd5e1"/>`
    + [0, 1, 2, 3, 4, 5].map(i => `<rect x="${100 + i * 58}" y="${330 - [90, 130, 110, 170, 150, 210][i]}" width="36" height="${[90, 130, 110, 170, 150, 210][i]}" rx="8" fill="${i === 5 ? accent : soft}"/>`).join('')
    + `<path d="M118 230 L176 200 L234 214 L292 160 L350 172 L408 112" stroke="${accent}" stroke-width="4" fill="none" stroke-linecap="round"/>`, 'Research report illustration'),
  blob: (accent: string, soft: string) => svg(`<circle cx="300" cy="200" r="170" fill="${soft}"/><circle cx="190" cy="280" r="90" fill="${accent}" opacity="0.85"/><circle cx="400" cy="120" r="60" fill="${accent}" opacity="0.45"/>`
    + `<rect x="200" y="110" width="210" height="150" rx="20" fill="#ffffff"/><rect x="224" y="136" width="120" height="14" rx="7" fill="#0f172a"/><rect x="224" y="162" width="160" height="10" rx="5" fill="#cbd5e1"/><rect x="224" y="182" width="140" height="10" rx="5" fill="#cbd5e1"/><rect x="224" y="214" width="80" height="26" rx="8" fill="${accent}"/>`, 'Abstract illustration'),
};
