// OVELIO page-builder block library. Blocks are HTML only: they use the kit classes (src/templates/pages/kit.ts) that
// every page's stylesheet already defines, so a block dropped into a page takes on that page's theme.
import { agenda, art, countdown, ctaBand, faq, features, footer, formSlot, heroArt, heroCenter, heroForm, logos, nav, pricing, speakers, stats, steps, testimonials } from '@/templates/pages/kit';

const accent = '#2457d6';
const soft = '#e8eefc';

const icon = (body: string) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const media = {
  nav: icon('<rect x="3" y="5" width="18" height="4" rx="1"/><path d="M3 13h18M3 17h12"/>'),
  hero: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h7M7 12h10M7 15h4"/>'),
  heroForm: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 9h5M6 12h5"/><rect x="13" y="8" width="5" height="8" rx="1"/>'),
  features: icon('<rect x="3" y="5" width="5" height="5" rx="1"/><rect x="10" y="5" width="5" height="5" rx="1"/><rect x="17" y="5" width="4" height="5" rx="1"/><path d="M3 15h18M3 19h12"/>'),
  quote: icon('<path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/>'),
  pricing: icon('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="2" width="5" height="20" rx="1"/><rect x="16" y="4" width="5" height="16" rx="1"/>'),
  faq: icon('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01"/>'),
  cta: icon('<rect x="3" y="6" width="18" height="12" rx="2"/><rect x="8" y="11" width="8" height="3" rx="1"/>'),
  logos: icon('<circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>'),
  stats: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  footer: icon('<rect x="3" y="15" width="18" height="5" rx="1"/><path d="M3 5h18M3 9h12"/>'),
  steps: icon('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>'),
  agenda: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h4M7 17h7"/>'),
  people: icon('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M17 11a3 3 0 100-6M21 20c0-2-1-4-4-5"/>'),
  columns2: icon('<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/>'),
  columns3: icon('<rect x="2" y="4" width="6" height="16" rx="1"/><rect x="9" y="4" width="6" height="16" rx="1"/><rect x="16" y="4" width="6" height="16" rx="1"/>'),
  heading: icon('<path d="M6 4v16M18 4v16M6 12h12"/>'),
  text: icon('<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>'),
  button: icon('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>'),
  image: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
  video: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>'),
  form: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>'),
  countdown: icon('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
  spacer: icon('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>'),
  divider: icon('<path d="M3 12h18"/>'),
};

export type BlockDefinition = { id: string; label: string; category: string; media: string; content: string | Record<string, unknown>; activate?: boolean };

const section = (inner: string, alt = false) => `<section class="ovp-section${alt ? ' ovp-alt' : ''}"><div class="ovp-wrap">${inner}</div></section>`;

export const blockDefinitions: BlockDefinition[] = [
  { id: 'nav', label: 'Navigation bar', category: 'Sections', media: media.nav, content: nav('Your brand', ['Features', 'Pricing', 'FAQ'], { label: 'Get started', href: '#cta' }) },
  { id: 'hero-form', label: 'Hero with form', category: 'Sections', media: media.heroForm, content: heroForm({ brand: 'Your brand', eyebrow: 'Short eyebrow', title: 'A clear headline that states the outcome', lead: 'One or two sentences on who this is for and why it matters.', bullets: ['First key benefit', 'Second key benefit', 'Third key benefit'], formTitle: 'Get started' }) },
  { id: 'hero-center', label: 'Hero, centred', category: 'Sections', media: media.hero, content: heroCenter({ brand: 'Your brand', pill: 'New', title: 'A bold, centred headline', lead: 'Support the headline with a sentence about the value you deliver.', body: '<div class="ovp-actions"><a class="ovp-btn" href="#cta">Primary action</a><a class="ovp-btn ovp-btn-ghost" href="#features">Learn more</a></div>' }) },
  { id: 'hero-art', label: 'Hero with illustration', category: 'Sections', media: media.hero, content: heroArt({ brand: 'Your brand', eyebrow: 'Eyebrow', title: 'Headline next to an illustration', lead: 'Explain the offer in one or two sentences.', actions: [{ label: 'Primary action', href: '#cta' }], art: art.dashboard(accent, soft) }) },
  { id: 'features', label: 'Features', category: 'Sections', media: media.features, content: features({ title: 'Why choose us', lead: 'Three reasons your visitors care about.', items: [{ icon: 'bolt', title: 'Fast', text: 'Describe the first benefit.' }, { icon: 'shield', title: 'Secure', text: 'Describe the second benefit.' }, { icon: 'users', title: 'Supported', text: 'Describe the third benefit.' }] }) },
  { id: 'testimonials', label: 'Testimonials', category: 'Sections', media: media.quote, content: testimonials({ title: 'What customers say', items: [{ quote: 'A short, specific quote about the result.', name: 'Alex Morgan', role: 'Role, Company' }, { quote: 'Another quote that speaks to a different benefit.', name: 'Sam Lee', role: 'Role, Company' }, { quote: 'A third quote that handles an objection.', name: 'Jo Patel', role: 'Role, Company' }], alt: true }) },
  { id: 'pricing', label: 'Pricing table', category: 'Sections', media: media.pricing, content: pricing({ title: 'Pricing', plans: [{ name: 'Starter', price: '£19', period: '/ month', text: 'For individuals.', features: ['Feature one', 'Feature two'], cta: 'Choose Starter' }, { name: 'Pro', price: '£49', period: '/ month', text: 'For growing teams.', features: ['Everything in Starter', 'Feature three', 'Feature four'], cta: 'Choose Pro', featured: true }, { name: 'Business', price: '£99', period: '/ month', text: 'For organisations.', features: ['Everything in Pro', 'Priority support'], cta: 'Contact us' }] }) },
  { id: 'faq', label: 'FAQ accordion', category: 'Sections', media: media.faq, content: faq([{ q: 'A common question?', a: 'A clear, short answer.' }, { q: 'Another question?', a: 'Another helpful answer.' }, { q: 'One more question?', a: 'Keep answers to two or three sentences.' }]) },
  { id: 'cta', label: 'Call to action', category: 'Sections', media: media.cta, content: ctaBand({ title: 'Ready to get started?', lead: 'Restate the offer and remove the last objection.', label: 'Get started' }) },
  { id: 'cta-form', label: 'Call to action with form', category: 'Sections', media: media.form, content: ctaBand({ title: 'Get your free copy', lead: 'Enter your details and we will email it to you.', label: '', withForm: true }) },
  { id: 'logos', label: 'Logo strip', category: 'Sections', media: media.logos, content: logos('Trusted by teams at', ['ACME', 'GLOBEX', 'INITECH', 'UMBRELLA', 'HOOLI']) },
  { id: 'stats', label: 'Stats', category: 'Sections', media: media.stats, content: stats([{ value: '10k+', label: 'Customers' }, { value: '99.9%', label: 'Uptime' }, { value: '4.9/5', label: 'Rating' }, { value: '24/7', label: 'Support' }]) },
  { id: 'steps', label: 'How it works', category: 'Sections', media: media.steps, content: steps({ title: 'How it works', items: [{ title: 'Sign up', text: 'Describe the first step.' }, { title: 'Set up', text: 'Describe the second step.' }, { title: 'Succeed', text: 'Describe the outcome.' }] }) },
  { id: 'agenda', label: 'Agenda', category: 'Sections', media: media.agenda, content: agenda({ title: 'Agenda', items: [{ time: '09:00', title: 'Session title', who: 'Speaker name' }, { time: '10:00', title: 'Session title', who: 'Speaker name' }] }) },
  { id: 'speakers', label: 'Speakers or team', category: 'Sections', media: media.people, content: speakers({ title: 'Meet the speakers', people: [{ name: 'Alex Morgan', role: 'Role, Company' }, { name: 'Sam Lee', role: 'Role, Company' }, { name: 'Jo Patel', role: 'Role, Company' }] }) },
  { id: 'footer', label: 'Footer', category: 'Sections', media: media.footer, content: footer('Your brand') },

  { id: 'columns-2', label: 'Two columns', category: 'Layout', media: media.columns2, content: section('<div class="ovp-grid-2"><div><h3 class="ovp-h3">Column one</h3><p class="ovp-text">Add text, images or buttons.</p></div><div><h3 class="ovp-h3">Column two</h3><p class="ovp-text">Add text, images or buttons.</p></div></div>') },
  { id: 'columns-3', label: 'Three columns', category: 'Layout', media: media.columns3, content: section('<div class="ovp-grid-3"><div class="ovp-card"><h3 class="ovp-h3">Column one</h3><p class="ovp-text">Text</p></div><div class="ovp-card"><h3 class="ovp-h3">Column two</h3><p class="ovp-text">Text</p></div><div class="ovp-card"><h3 class="ovp-h3">Column three</h3><p class="ovp-text">Text</p></div></div>') },
  { id: 'section', label: 'Empty section', category: 'Layout', media: media.spacer, content: section('<h2 class="ovp-h2">Section heading</h2><p class="ovp-text">Drop blocks here.</p>') },
  { id: 'spacer', label: 'Spacer', category: 'Layout', media: media.spacer, content: '<div style="height:48px"></div>' },
  { id: 'divider', label: 'Divider', category: 'Layout', media: media.divider, content: '<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">' },

  { id: 'heading', label: 'Heading', category: 'Basics', media: media.heading, content: '<h2 class="ovp-h2">Your heading</h2>' },
  { id: 'text', label: 'Text', category: 'Basics', media: media.text, content: '<p class="ovp-text">Double-click to edit this paragraph. Keep sentences short and specific.</p>' },
  { id: 'button', label: 'Button', category: 'Basics', media: media.button, content: '<a class="ovp-btn" href="#">Button label</a>' },
  { id: 'next-step', label: 'Next funnel step button', category: 'Basics', media: media.button, content: '<a class="ovp-btn" href="#ovelio-next-step">Continue</a>' },
  { id: 'image', label: 'Image', category: 'Basics', media: media.image, activate: true, content: { type: 'image', attributes: { class: 'ovp-img', alt: 'Describe this image for screen readers' } } },
  { id: 'video', label: 'Video (YouTube or Vimeo)', category: 'Basics', media: media.video, content: { type: 'ovelio-video' } },
  { id: 'countdown', label: 'Countdown', category: 'Basics', media: media.countdown, content: countdown(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) + 'T09:00:00Z').replace('class="ovp-countdown"', 'class="ovp-countdown" style="color:#0f172a"') },
  { id: 'form', label: 'Form', category: 'Forms', media: media.form, content: `<div class="ovp-form-card" style="max-width:520px">${formSlot()}</div>` },
];
