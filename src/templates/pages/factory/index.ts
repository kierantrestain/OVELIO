// Page template factory: layout recipes × brand tokens × content schemas × industries. Deterministic: the same kits
// always produce the same templates (keys, HTML, CSS and forms), so gallery entries and created pages are stable.
// Every output is validated (structure, forms, accessibility, sanitising) by src/server/sites/templates.ts.
import type { FormField, FormSettings, PageTemplate, PageTemplateCategory } from '@/contracts/sites';
import { agenda, art, countdown, ctaBand, faq, features, footer, formSlot, heroArt, heroCenter, heroForm, kitCss, logos, pricing, speakers, split, stats, steps, testimonials } from '../kit';
import type { Theme } from '../kit';
import { industries } from './industries';
import { contentSchema } from './schema';
import type { IndustryContent } from './schema';
import { brandTokens } from './tokens';

type Layout = {
  key: string;
  name: string;
  category: PageTemplateCategory;
  description: string;
  fields: (content: IndustryContent) => FormField[];
  settings: (content: IndustryContent) => Partial<FormSettings>;
  render: (content: IndustryContent, theme: Theme) => string;
};

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const f = {
  first: (): FormField => ({ key: 'first_name', label: 'First name', type: 'text', required: true, mapsTo: 'firstName', width: 'half' }),
  last: (): FormField => ({ key: 'last_name', label: 'Last name', type: 'text', required: false, mapsTo: 'lastName', width: 'half' }),
  email: (label = 'Email address'): FormField => ({ key: 'email', label, type: 'email', required: true, placeholder: 'you@example.com', mapsTo: 'email' }),
  company: (): FormField => ({ key: 'company', label: 'Company', type: 'text', required: false, mapsTo: 'company' }),
  phone: (): FormField => ({ key: 'phone', label: 'Phone', type: 'phone', required: false, mapsTo: 'phone' }),
  message: (): FormField => ({ key: 'message', label: 'How can we help?', type: 'textarea', required: false, mapsTo: 'none' }),
};

const consent = { enabled: true, text: 'Yes, email me updates and offers. I can unsubscribe at any time.', required: false };

const art2 = (content: IndustryContent, t: Theme) => art[content.art](t.accent, t.accentSoft);

const formSection = (id: string, title: string, text: string) =>
  `<section class="ovp-section ovp-alt" id="${id}"><div class="ovp-wrap ovp-row"><div><h2 class="ovp-h2">${esc(title)}</h2><p class="ovp-text">${esc(text)}</p></div><div class="ovp-form-card">${formSlot()}</div></div></section>`;

export const layouts: Layout[] = [
  {
    key: 'lead-capture', name: 'Lead capture', category: 'Lead generation', description: 'Hero with a lead form, social proof, benefits, testimonials and FAQ.',
    fields: () => [f.first(), f.last(), f.email('Work email'), f.company(), f.phone()],
    settings: content => ({ submitLabel: content.cta.label, successMessage: 'Thank you! We will be in touch within one working day.', tags: [`${content.slug}-lead`], consent }),
    render: (c, t) => heroForm({ brand: c.brand, links: c.links, eyebrow: c.eyebrow, title: c.headline, lead: c.lead, bullets: c.bullets, formTitle: c.cta.title })
      + logos(c.logosTitle, c.logos) + features({ title: c.features.title, lead: c.features.lead, items: c.features.items.slice(0, 3) })
      + split({ eyebrow: c.story.eyebrow, title: c.story.title, text: c.story.text, bullets: c.story.bullets, art: art2(c, t), alt: true })
      + testimonials({ title: 'What customers say', items: c.testimonials }) + faq(c.faq, true) + footer(c.brand),
  },
  {
    key: 'product-tour', name: 'Product tour', category: 'Products', description: 'Illustrated hero, feature grid, proof in numbers, pricing and a closing sign-up form.',
    fields: () => [f.first(), f.email(), f.company()],
    settings: content => ({ submitLabel: content.cta.label, successMessage: 'You are in! Check your inbox for the next step.', tags: [`${content.slug}-signup`], consent }),
    render: (c, t) => heroArt({ brand: c.brand, links: c.links, cta: { label: c.cta.label, href: '#cta' }, eyebrow: c.eyebrow, title: c.headline, lead: c.lead,
      actions: [{ label: c.cta.label, href: '#cta' }, { label: 'See pricing', href: '#pricing', ghost: true }], art: art2(c, t) })
      + logos(c.logosTitle, c.logos) + features({ title: c.features.title, lead: c.features.lead, items: c.features.items })
      + stats(c.stats, true) + pricing({ title: 'Simple, transparent pricing', plans: c.plans })
      + ctaBand({ title: c.cta.title, lead: c.cta.lead, label: c.cta.label, withForm: true }) + footer(c.brand),
  },
  {
    key: 'services-story', name: 'Services story', category: 'Services', description: 'Centred hero, process steps, an approach section, testimonials and an enquiry form.',
    fields: () => [f.first(), f.last(), f.email(), f.message()],
    settings: content => ({ submitLabel: 'Send enquiry', successMessage: 'Thanks for getting in touch. We will reply within one working day.', tags: [`${content.slug}-enquiry`], consent }),
    render: (c, t) => heroCenter({ brand: c.brand, links: c.links, pill: c.eyebrow, title: c.headline, lead: c.lead,
      body: `<div class="ovp-actions"><a class="ovp-btn" href="#contact">${esc(c.cta.label)}</a><a class="ovp-btn ovp-btn-ghost" href="#how-it-works">How it works</a></div>` })
      + steps({ title: 'How it works', items: c.steps, alt: true })
      + split({ eyebrow: c.story.eyebrow, title: c.story.title, text: c.story.text, bullets: c.story.bullets, art: art2(c, t), reverse: true })
      + stats(c.stats, true) + testimonials({ title: 'In their words', items: c.testimonials })
      + formSection('contact', c.cta.title, c.cta.lead) + footer(c.brand),
  },
  {
    key: 'event-registration', name: 'Event registration', category: 'Events', description: 'Event hero with countdown, speakers, agenda, ticket tiers and registration.',
    fields: content => [f.first(), f.last(), f.email(), f.company(),
      { key: 'ticket', label: 'Ticket', type: 'select', required: true, options: content.plans.map(plan => plan.name), mapsTo: 'none' }],
    settings: content => ({ submitLabel: 'Reserve my place', successMessage: 'Your place is reserved. Details are on their way by email.', tags: [`${content.slug}-event`], consent }),
    render: (c, t) => heroArt({ brand: c.brand, links: ['Speakers', 'Agenda'], cta: { label: 'Register', href: '#register' }, eyebrow: c.event.eyebrow, title: c.event.title, lead: c.event.lead,
      actions: [{ label: 'Reserve my place', href: '#register' }, { label: 'See the agenda', href: '#agenda', ghost: true }], art: art.calendar(t.accent, t.accentSoft) })
      .replace('<div class="ovp-actions">', countdown(c.event.date) + '<div class="ovp-actions">')
      + speakers({ title: 'Speakers', people: c.event.speakers }) + agenda({ title: 'Agenda', items: c.event.agenda, alt: true })
      + pricing({ title: 'Tickets and options', plans: c.plans }) + formSection('register', 'Reserve your place', c.event.lead) + footer(c.brand),
  },
  {
    key: 'waitlist', name: 'Waitlist', category: 'Waitlists', description: 'Focused, centred waitlist sign-up with three reasons to join.',
    fields: () => [f.email()],
    settings: content => ({ submitLabel: 'Join the waitlist', successMessage: 'You are on the list. We will email you as soon as it opens.', tags: [`${content.slug}-waitlist`], consent: { ...consent, text: 'Email me when it opens, plus occasional news. I can unsubscribe at any time.' } }),
    render: c => heroCenter({ brand: c.brand, pill: c.waitlist.pill, title: c.waitlist.title, lead: c.waitlist.lead,
      body: `<div class="ovp-form-card" style="max-width:520px;margin:0 auto 20px auto;text-align:left">${formSlot()}</div>`, note: c.waitlist.note })
      + features({ title: c.features.title, items: c.features.items.slice(0, 3), alt: true }) + footer(c.brand),
  },
  {
    key: 'lead-magnet', name: 'Lead magnet', category: 'Lead magnets', description: 'Download offer with cover art, what is inside and reader quotes.',
    fields: () => [f.first(), f.email()],
    settings: content => ({ submitLabel: 'Send it to me', successMessage: 'It is on its way. Check your inbox in the next few minutes.', tags: [`${content.slug}-download`], consent }),
    render: (c, t) => heroForm({ brand: c.brand, eyebrow: c.magnet.eyebrow, title: c.magnet.title, lead: c.magnet.lead, bullets: c.magnet.bullets, formTitle: 'Get your free copy',
      extra: `<div style="max-width:200px">${art.ebook(t.accent, '#0f172a')}</div>` })
      + steps({ title: 'What is inside', items: c.magnet.inside, alt: true })
      + testimonials({ title: 'What readers say', items: c.testimonials.slice(0, 2) }) + footer(c.brand),
  },
];

/** Produces every factory template. Throws if an industry kit breaks the content schema (caught by unit tests). */
export function buildFactoryTemplates(): PageTemplate[] {
  const out: PageTemplate[] = [];
  industries.forEach((raw, industryIndex) => {
    const content = contentSchema.parse(raw);
    layouts.forEach((layout, layoutIndex) => {
      const tokens = brandTokens[(industryIndex * 2 + layoutIndex) % brandTokens.length];
      out.push({
        key: `f-${content.slug}-${layout.key}`,
        name: `${layout.name} · ${content.industry}`,
        category: layout.category,
        industry: content.industry,
        source: 'factory',
        description: `${layout.description} Written for ${content.industry === 'SaaS' ? 'SaaS' : content.industry.toLowerCase()}, in the ${tokens.name} style.`,
        palette: [tokens.theme.accent, tokens.theme.heroInk === '#ffffff' ? tokens.theme.ink : tokens.theme.alt, tokens.theme.bg],
        hasForm: true,
        form: { name: `${content.brand} · ${layout.name}`, fields: layout.fields(content), settings: layout.settings(content) },
        html: layout.render(content, tokens.theme),
        css: kitCss(tokens.theme),
      });
    });
  });
  return out;
}

