// OVELIO landing-page templates (Lane 3). Self-contained HTML and CSS built from the kit (./kit.ts): system fonts,
// inline SVG art, a form block where the page collects leads, and responsive breakpoints for tablet and mobile.
import type { FormField, FormTemplate, PageTemplate, PageTemplateCategory, PageTemplateSummary } from '@/contracts/sites';
import {
  agenda, art, countdown, ctaBand, faq, features, fonts, footer, formSlot, heroArt, heroCenter, heroForm, kitCss, logos,
  pricing, speakers, split, stats, steps, testimonials, theme,
} from './kit';
import type { Theme } from './kit';
import { buildFactoryTemplates } from './factory';

const field = {
  email: (): FormField => ({ key: 'email', label: 'Work email', type: 'email', required: true, placeholder: 'you@company.com', mapsTo: 'email' }),
  personalEmail: (): FormField => ({ key: 'email', label: 'Email address', type: 'email', required: true, placeholder: 'you@example.com', mapsTo: 'email' }),
  first: (): FormField => ({ key: 'first_name', label: 'First name', type: 'text', required: true, mapsTo: 'firstName', width: 'half' }),
  last: (): FormField => ({ key: 'last_name', label: 'Last name', type: 'text', required: false, mapsTo: 'lastName', width: 'half' }),
  company: (required = false): FormField => ({ key: 'company', label: 'Company', type: 'text', required, mapsTo: 'company' }),
  phone: (required = false): FormField => ({ key: 'phone', label: 'Phone', type: 'phone', required, mapsTo: 'phone' }),
  role: (): FormField => ({ key: 'job_title', label: 'Job title', type: 'text', required: false, mapsTo: 'position' }),
  select: (key: string, label: string, options: string[], required = false): FormField => ({ key, label, type: 'select', required, options, mapsTo: 'none' }),
  message: (label = 'How can we help?'): FormField => ({ key: 'message', label, type: 'textarea', required: false, mapsTo: 'none' }),
};

const consent = (text = 'Yes, send me updates and offers by email. I can unsubscribe at any time.') => ({ enabled: true, text, required: false });

type Definition = {
  key: string; name: string; category: PageTemplateCategory; description: string; theme: Theme;
  form?: FormTemplate; body: (t: Theme) => string; extraCss?: string;
};

const definitions: Definition[] = [
  // ── Lead generation ──
  {
    key: 'saas-demo', name: 'SaaS demo request', category: 'Lead generation',
    description: 'Split hero with a demo form, social proof, outcomes and FAQ for B2B software.',
    theme: theme({ accent: '#2457d6', accentSoft: '#e7eefc' }),
    form: { name: 'Demo request', fields: [field.first(), field.last(), field.email(), field.company(true), field.select('team_size', 'Team size', ['1–10', '11–50', '51–200', '201–1,000', '1,000+'], true)], settings: { submitLabel: 'Book my demo', successMessage: 'Thanks! We will email you within one working day to pick a time.', tags: ['demo-request'], consent: consent() } },
    body: t => heroForm({ brand: 'Northwind Cloud', links: ['Product', 'Customers', 'Pricing'], eyebrow: 'Revenue operations platform', title: 'See your whole pipeline in one live view', lead: 'Northwind connects your CRM, billing and product data so every team forecasts from the same numbers.', bullets: ['A tailored 30-minute walkthrough', 'Your data model, not a canned demo', 'Pricing and rollout plan included'], formTitle: 'Book a personalised demo', formNote: 'No commitment. Takes less than a minute.' })
      + logos('Trusted by revenue teams at', ['ACME CORP', 'GLOBEX', 'INITECH', 'UMBRELLA', 'HOOLI'])
      + features({ eyebrow: 'Why teams switch', title: 'Forecasts your board can trust', lead: 'Replace spreadsheet roll-ups with a pipeline that updates itself.', items: [{ icon: 'chart', title: 'Live forecasting', text: 'Weighted pipeline and commit numbers that refresh as deals move.' }, { icon: 'bolt', title: 'Set up in a day', text: 'Native connectors for the tools your team already uses.' }, { icon: 'shield', title: 'Enterprise-grade security', text: 'SSO, audit logs and regional data residency as standard.' }] })
      + split({ eyebrow: 'One source of truth', title: 'Every deal, every signal, one dashboard', text: 'Spot slipping deals before they slip. Northwind flags stalled opportunities and the next best action for each rep.', bullets: ['Deal health scoring', 'Rep-level commit tracking', 'Board-ready reports in one click'], art: art.dashboard(t.accent, t.accentSoft), alt: true })
      + testimonials({ title: 'Loved by revenue leaders', items: [{ quote: 'We cut our forecast meeting from two hours to twenty minutes.', name: 'Maya Chen', role: 'VP Sales, Globex' }, { quote: 'The first tool our finance and sales teams both trust.', name: 'Tom Ellis', role: 'CFO, Initech' }, { quote: 'Rollout took a day. The impact showed up the same quarter.', name: 'Priya Nair', role: 'RevOps Lead, Hooli' }] })
      + faq([{ q: 'How long is the demo?', a: 'About 30 minutes, including time for your questions.' }, { q: 'Do I need to prepare anything?', a: 'No. If you share your CRM, we will tailor the walkthrough to it.' }, { q: 'Is there a free trial?', a: 'Yes, a 14-day trial with your own data follows the demo.' }], true)
      + footer('Northwind Cloud'),
  },
  {
    key: 'consultation', name: 'Free consultation', category: 'Lead generation',
    description: 'Calm, trust-led page for advisers and professional firms to book a first call.',
    theme: theme({ headingFont: fonts.serif, accent: '#0f766e', accentSoft: '#dcf3ef', alt: '#f4f8f7', heroBg: 'linear-gradient(180deg, #eef7f5 0%, #ffffff 100%)', headingWeight: 600, headingSpacing: '-0.01em', radius: 8 }),
    form: { name: 'Consultation request', fields: [field.first(), field.last(), field.personalEmail(), field.phone(), field.select('topic', 'What would you like to discuss?', ['Retirement planning', 'Investments', 'Tax efficiency', 'Protection', 'Something else'], true)], settings: { submitLabel: 'Request my free call', successMessage: 'Thank you. An adviser will call you within two working days.', tags: ['consultation'], consent: consent('I agree to be contacted about my enquiry and occasional updates by email.') } },
    body: () => heroForm({ brand: 'Harbour Financial', links: ['Services', 'Approach', 'Reviews'], eyebrow: 'Independent financial advice', title: 'A clear plan for the next chapter of your life', lead: 'Book a free, no-obligation 30-minute consultation with a chartered adviser.', bullets: ['Chartered, fee-transparent advisers', 'Plain-English recommendations', 'Meet online or in person'], formTitle: 'Book your free consultation' })
      + stats([{ value: '25 yrs', label: 'Advising families' }, { value: '£1.2bn', label: 'Assets under advice' }, { value: '4.9/5', label: 'Average client rating' }], true)
      + steps({ title: 'How it works', items: [{ title: 'Tell us your goals', text: 'A relaxed conversation about where you are and where you want to be.' }, { title: 'Receive your plan', text: 'A written plan with clear costs and options, no jargon.' }, { title: 'Review every year', text: 'We adjust your plan as life and markets change.' }] })
      + testimonials({ title: 'What our clients say', items: [{ quote: 'For the first time I understand exactly where my pension stands.', name: 'Helen Price', role: 'Client since 2019' }, { quote: 'Honest, patient advice with no pressure at all.', name: 'David Moss', role: 'Client since 2021' }], alt: true })
      + ctaBand({ title: 'Your first conversation is free', lead: 'No obligation, no sales pitch. Just clear answers.', label: 'Book a consultation' })
      + footer('Harbour Financial', ['Privacy', 'Complaints', 'Regulatory information']),
  },
  {
    key: 'local-quote', name: 'Local service quote', category: 'Lead generation',
    description: 'Bold quote request page for trades and local services with trust badges.',
    theme: theme({ accent: '#ea580c', accentSoft: '#ffedd5', heroBg: 'linear-gradient(135deg, #1c1917 0%, #44403c 100%)', heroInk: '#ffffff', heroMuted: '#e7e5e4', radius: 10 }),
    form: { name: 'Quote request', fields: [field.first(), field.last(), field.phone(true), field.personalEmail(), field.select('service', 'Service needed', ['Kitchen', 'Bathroom', 'Extension', 'Loft conversion', 'Other'], true), field.message('Tell us about the project')], settings: { submitLabel: 'Get my free quote', successMessage: 'Thanks! A project manager will call you today to arrange a visit.', tags: ['quote-request'], consent: consent() } },
    body: () => heroForm({ brand: 'Brickline Builders', eyebrow: 'Free, no-obligation quotes', title: 'Renovations done right, on time and on budget', lead: 'Kitchens, bathrooms and extensions by a fully insured local team with a 10-year guarantee.', bullets: ['Fixed-price quotes within 48 hours', '10-year workmanship guarantee', '4.9★ from 600+ local homeowners'], formTitle: 'Get your free quote' })
      + features({ title: 'Why homeowners choose Brickline', items: [{ icon: 'shield', title: 'Fully insured', text: 'Public liability cover and certified tradespeople on every job.' }, { icon: 'clock', title: 'On schedule', text: 'A dedicated project manager and a weekly progress update.' }, { icon: 'star', title: 'Guaranteed work', text: 'Every project is backed by our 10-year guarantee.' }], alt: true })
      + testimonials({ title: 'Recent projects', items: [{ quote: 'Our kitchen was finished two days early and the site was spotless.', name: 'Sarah Lee', role: 'Kitchen renovation' }, { quote: 'Clear pricing from day one. No surprises at the end.', name: 'James Ward', role: 'Rear extension' }, { quote: 'Friendly, tidy and genuinely skilled. Highly recommended.', name: 'Anita Rao', role: 'Bathroom refit' }] })
      + footer('Brickline Builders'),
  },
  // ── Services ──
  {
    key: 'creative-agency', name: 'Creative agency', category: 'Services',
    description: 'Editorial agency page with services, process, results and a project enquiry form.',
    theme: theme({ ink: '#111111', muted: '#4b5563', accent: '#7c3aed', accentSoft: '#efe7ff', heroBg: 'linear-gradient(135deg, #faf5ff 0%, #ffffff 70%)', headingWeight: 800, headingSpacing: '-0.035em', radius: 4 }),
    form: { name: 'Project enquiry', fields: [field.first(), field.last(), field.email(), field.company(), field.select('budget', 'Budget', ['Under £10k', '£10k–£25k', '£25k–£75k', '£75k+'], true), field.message('Tell us about your project')], settings: { submitLabel: 'Send enquiry', successMessage: 'Thanks for reaching out. We will reply within one working day.', tags: ['agency-enquiry'], consent: consent() } },
    body: t => heroArt({ brand: 'Studio Parallel', links: ['Work', 'Services', 'Contact'], cta: { label: 'Start a project', href: '#contact' }, eyebrow: 'Brand, web and growth design', title: 'We build brands people remember', lead: 'Strategy, identity and websites for ambitious companies, delivered by a senior team in weeks, not months.', actions: [{ label: 'Start a project', href: '#contact' }, { label: 'See our process', href: '#how-it-works', ghost: true }], art: art.blob(t.accent, t.accentSoft) })
      + features({ id: 'services', title: 'What we do', items: [{ icon: 'star', title: 'Brand identity', text: 'Naming, logo systems and guidelines that scale.' }, { icon: 'globe', title: 'Websites', text: 'Fast, accessible marketing sites your team can edit.' }, { icon: 'rocket', title: 'Launch campaigns', text: 'Go-to-market creative across paid, social and email.' }, { icon: 'target', title: 'Conversion design', text: 'Landing pages and experiments that lift results.' }], columns: 2, alt: true })
      + steps({ title: 'Our process', items: [{ title: 'Discover', text: 'Workshops to understand your audience and goals.' }, { title: 'Design', text: 'Concepts, iterations and a system you own.' }, { title: 'Deliver', text: 'Launch support and handover to your team.' }] })
      + stats([{ value: '120+', label: 'Brands launched' }, { value: '38%', label: 'Average conversion lift' }, { value: '9 yrs', label: 'Independent studio' }, { value: '14', label: 'Design awards' }], true)
      + `<section class="ovp-section" id="contact"><div class="ovp-wrap ovp-row"><div><span class="ovp-eyebrow">Contact</span><h2 class="ovp-h2">Tell us what you are building</h2><p class="ovp-text">Share a few details and a partner will reply within one working day with next steps and availability.</p></div><div class="ovp-form-card">${formSlot()}</div></div></section>`
      + footer('Studio Parallel'),
  },
  {
    key: 'business-coaching', name: 'Business coaching', category: 'Services',
    description: 'Warm personal-brand page for coaches with programmes, pricing and a discovery call form.',
    theme: theme({ font: fonts.sans, headingFont: fonts.serif, bg: '#fffdf8', alt: '#fbf5ea', surface: '#ffffff', ink: '#2b2118', muted: '#6b5b4b', accent: '#b45309', accentSoft: '#fdecd2', border: '#efe4d2', heroBg: 'linear-gradient(180deg, #fbf3e4 0%, #fffdf8 100%)', headingWeight: 600, headingSpacing: '-0.01em', radius: 14 }),
    form: { name: 'Discovery call', fields: [field.first(), field.last(), field.personalEmail(), field.select('stage', 'Where is your business today?', ['Idea stage', 'Under £100k revenue', '£100k–£1m revenue', '£1m+ revenue'], true), field.message('What is your biggest challenge right now?')], settings: { submitLabel: 'Book my discovery call', successMessage: 'Wonderful! Check your inbox for a link to choose a time.', tags: ['coaching-lead'], consent: consent() } },
    body: () => heroForm({ brand: 'Grace Okafor Coaching', links: ['About', 'Programmes', 'Stories'], eyebrow: 'Coaching for founders', title: 'Grow a business that gives you your life back', lead: 'One-to-one coaching for founders who want sustainable growth without burning out.', bullets: ['12-week focused programmes', 'Weekly accountability sessions', 'Proven frameworks from 300+ founders'], formTitle: 'Book a free discovery call' })
      + pricing({ title: 'Programmes', lead: 'Choose the support that fits where you are.', plans: [{ name: 'Clarity', price: '£450', period: 'one-off', text: 'A half-day intensive to set direction.', features: ['3-hour strategy session', 'Written 90-day plan', 'Two follow-up emails'], cta: 'Get started' }, { name: 'Momentum', price: '£1,200', period: '/ 12 weeks', text: 'Weekly coaching to build the habits.', features: ['12 weekly sessions', 'Messaging support', 'Quarterly planning template'], cta: 'Apply now', featured: true }, { name: 'Mastermind', price: '£300', period: '/ month', text: 'Peer group of six founders.', features: ['Monthly group session', 'Private community', 'Guest experts'], cta: 'Join the waitlist' }], alt: true })
      + testimonials({ title: 'Founder stories', items: [{ quote: 'I doubled revenue and took my first proper holiday in five years.', name: 'Leah Fox', role: 'Founder, Fox & Fern' }, { quote: 'Grace helped me stop firefighting and start leading.', name: 'Omar Haddad', role: 'CEO, Brightpath' }] })
      + footer('Grace Okafor Coaching'),
  },
  // ── Events ──
  {
    key: 'tech-conference', name: 'Tech conference', category: 'Events',
    description: 'Dark, high-energy conference page with countdown, speakers, agenda and ticket tiers.',
    theme: theme({ bg: '#ffffff', accent: '#e11d48', accentSoft: '#ffe4ea', heroBg: 'linear-gradient(140deg, #0b1020 0%, #1e1b4b 60%, #4c0519 100%)', heroInk: '#ffffff', heroMuted: '#cbd5e1', radius: 10 }),
    form: { name: 'Conference tickets', fields: [field.first(), field.last(), field.email(), field.company(), field.select('ticket', 'Ticket', ['Standard pass', 'VIP pass', 'Virtual pass'], true)], settings: { submitLabel: 'Reserve my ticket', successMessage: 'Your place is reserved! Payment details follow by email.', tags: ['summit-2027'], consent: consent() } },
    body: t => heroArt({ brand: 'SHIFT Summit', links: ['Speakers', 'Agenda', 'Pricing'], cta: { label: 'Get tickets', href: '#register' }, eyebrow: '18–19 March 2027 · London', title: 'The conference for people who ship', lead: 'Two days, 40 speakers and 1,200 builders sharing what actually works in modern product engineering.', actions: [{ label: 'Get your ticket', href: '#register' }, { label: 'View agenda', href: '#agenda', ghost: true }], art: art.stage(t.accent, t.accentSoft) }).replace('<div class="ovp-actions">', countdown('2027-03-18T09:00:00Z') + '<div class="ovp-actions">')
      + speakers({ title: 'Featured speakers', people: [{ name: 'Ines Duarte', role: 'CTO, Lumen' }, { name: 'Kwame Asante', role: 'Head of Platform, Vela' }, { name: 'Sofia Lind', role: 'Staff Engineer, Kitecloud' }, { name: 'Raj Patel', role: 'Founder, Shipfast' }] })
      + agenda({ title: 'Day one highlights', items: [{ time: '09:00', title: 'Opening keynote: Shipping at scale', who: 'Ines Duarte' }, { time: '11:00', title: 'Platform teams that developers love', who: 'Kwame Asante' }, { time: '14:00', title: 'Workshops: reliability, AI tooling, design systems', who: 'Three parallel tracks' }, { time: '17:30', title: 'Community drinks and demos', who: 'Main hall' }], alt: true })
      + pricing({ title: 'Tickets', plans: [{ name: 'Virtual', price: '£99', text: 'Livestream of all keynotes.', features: ['All main-stage talks', 'Recordings for 90 days'], cta: 'Choose virtual' }, { name: 'Standard', price: '£449', text: 'Full in-person access.', features: ['Both days, all tracks', 'Workshops', 'Lunch and drinks'], cta: 'Choose standard', featured: true }, { name: 'VIP', price: '£799', text: 'The complete experience.', features: ['Everything in Standard', 'Speaker dinner', 'Reserved seating'], cta: 'Choose VIP' }] })
      + `<section class="ovp-section ovp-alt" id="register"><div class="ovp-wrap ovp-row"><div><h2 class="ovp-h2">Reserve your place</h2><p class="ovp-text">Early-bird pricing ends 31 January. Group discounts for five or more.</p></div><div class="ovp-form-card">${formSlot()}</div></div></section>`
      + footer('SHIFT Summit', ['Code of conduct', 'Privacy', 'Contact']),
  },
  {
    key: 'community-meetup', name: 'Community meetup', category: 'Events',
    description: 'Friendly RSVP page for meetups, workshops and local events.',
    theme: theme({ font: fonts.rounded, headingFont: fonts.rounded, accent: '#16a34a', accentSoft: '#dcfce7', alt: '#f3faf5', heroBg: 'linear-gradient(180deg, #ecfdf3 0%, #ffffff 100%)', radius: 18 }),
    form: { name: 'Meetup RSVP', fields: [field.first(), field.last(), field.personalEmail(), field.select('dietary', 'Dietary needs', ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Other'])], settings: { submitLabel: 'Save my seat', successMessage: 'You are on the list! We will send a reminder the day before.', tags: ['meetup-rsvp'], consent: consent('Tell me about future meetups by email.') } },
    body: t => heroForm({ brand: 'Bristol Makers', eyebrow: 'Thursday 12 February · 6:30pm', title: 'Build night: hardware, code and pizza', lead: 'An evening of lightning talks and hands-on tinkering for makers of every level. Free entry, limited seats.', bullets: ['Five 7-minute lightning talks', 'Open workbench with tools and kits', 'Pizza and drinks included'], formTitle: 'RSVP for free', extra: '' })
      + split({ eyebrow: 'The venue', title: 'The Old Print Works, Bristol', text: 'Step-free access, bike racks and a five-minute walk from Temple Meads station.', bullets: ['Doors open 6:15pm', 'Talks start 7:00pm', 'Workbench until 9:30pm'], art: art.calendar(t.accent, t.accentSoft), alt: true })
      + faq([{ q: 'Do I need experience?', a: 'Not at all. Beginners are very welcome and mentors are on hand.' }, { q: 'Can I give a talk?', a: 'Yes! Mention it in your RSVP and we will be in touch.' }, { q: 'Is it really free?', a: 'Yes, thanks to our community sponsors.' }])
      + footer('Bristol Makers'),
  },
  // ── Webinars ──
  {
    key: 'live-webinar', name: 'Live webinar registration', category: 'Webinars',
    description: 'Registration page with countdown, takeaways, hosts and a sign-up form.',
    theme: theme({ accent: '#4f46e5', accentSoft: '#e0e7ff', heroBg: 'linear-gradient(135deg, #312e81 0%, #4f46e5 55%, #7c3aed 100%)', heroInk: '#ffffff', heroMuted: '#e0e7ff', radius: 12 }),
    form: { name: 'Webinar registration', fields: [field.first(), field.last(), field.email(), field.company(), field.role()], settings: { submitLabel: 'Save my spot', successMessage: 'You are registered! The joining link is on its way to your inbox.', tags: ['webinar-registrant'], consent: consent() } },
    body: t => heroForm({ brand: 'Pipeline Academy', eyebrow: 'Free live webinar · 26 January, 4pm GMT', title: 'Scaling outbound without burning your domain', lead: 'A 45-minute masterclass on deliverability, sequencing and personalisation that still feels human.', formTitle: 'Register for free', formNote: 'Can’t make it live? Register and we will send the recording.', extra: countdown('2027-01-26T16:00:00Z') })
      + features({ title: 'What you will learn', items: [{ icon: 'mail', title: 'Deliverability first', text: 'The warm-up, authentication and volume rules that protect your domain.' }, { icon: 'target', title: 'Sequences that convert', text: 'The 5-touch cadence our best teams use, with real examples.' }, { icon: 'users', title: 'Personalisation at scale', text: 'How to research 50 accounts a day without sounding robotic.' }] })
      + split({ eyebrow: 'Your hosts', title: 'Learn from operators, not theorists', text: 'Elena and Marcus have built outbound teams from zero to £20m pipeline at three venture-backed companies.', bullets: ['Elena Rossi, VP Growth at Kitecloud', 'Marcus Webb, founder of Pipeline Academy'], art: art.webinar(t.accent, t.accentSoft), alt: true })
      + ctaBand({ title: 'Seats are limited to 500', lead: 'Register now to get the live link and the slides.', label: 'Save my spot', href: '#register' })
      + footer('Pipeline Academy'),
  },
  {
    key: 'masterclass', name: 'Masterclass series', category: 'Webinars',
    description: 'Elegant multi-session masterclass page with curriculum and registration.',
    theme: theme({ headingFont: fonts.serif, bg: '#ffffff', ink: '#14213d', muted: '#4a5568', accent: '#c2410c', accentSoft: '#ffedd5', alt: '#f7f5f2', heroBg: 'linear-gradient(180deg, #14213d 0%, #1f2f55 100%)', heroInk: '#ffffff', heroMuted: '#cbd5e1', headingWeight: 600, headingSpacing: '-0.01em', radius: 6 }),
    form: { name: 'Masterclass registration', fields: [field.first(), field.last(), field.email(), field.select('sessions', 'Which sessions?', ['All three sessions', 'Session 1 only', 'Session 2 only', 'Session 3 only'], true)], settings: { submitLabel: 'Join the masterclass', successMessage: 'Welcome aboard! Calendar invites for each session are on their way.', tags: ['masterclass'], consent: consent() } },
    body: () => heroCenter({ brand: 'The Brand Lab', pill: 'Free · 3 live sessions · February', title: 'The positioning masterclass', lead: 'Three live sessions to sharpen your message, own a category and win the deals you deserve.', body: '<div class="ovp-actions"><a class="ovp-btn" href="#register">Reserve my seat</a><a class="ovp-btn ovp-btn-ghost" href="#agenda">See the curriculum</a></div>' })
      + agenda({ title: 'Curriculum', items: [{ time: 'Session 1', title: 'Find the problem only you solve', who: '3 February · 60 minutes' }, { time: 'Session 2', title: 'Name the category and the enemy', who: '10 February · 60 minutes' }, { time: 'Session 3', title: 'Turn positioning into pipeline', who: '17 February · 75 minutes, with live Q&A' }] })
      + `<section class="ovp-section ovp-alt" id="register"><div class="ovp-wrap ovp-row"><div><h2 class="ovp-h2">Reserve your seat</h2><p class="ovp-text">Every session is recorded. Registrants get the replays and the worksheet pack.</p></div><div class="ovp-form-card">${formSlot()}</div></div></section>`
      + footer('The Brand Lab'),
  },
  // ── Products ──
  {
    key: 'saas-launch', name: 'SaaS product launch', category: 'Products',
    description: 'Product launch page with feature grid, product visual, pricing and free trial sign-up.',
    theme: theme({ accent: '#0ea5e9', accentSoft: '#e0f2fe', ink: '#0b1324', heroBg: 'linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%)', radius: 12 }),
    form: { name: 'Free trial sign-up', fields: [field.first(), field.email(), field.company()], settings: { submitLabel: 'Start free trial', successMessage: 'Your trial workspace is being prepared. Check your inbox to sign in.', tags: ['trial'], consent: consent() } },
    body: t => heroArt({ brand: 'Flowdesk', links: ['Features', 'Pricing', 'FAQ'], cta: { label: 'Start free', href: '#cta' }, eyebrow: 'New · Flowdesk 2.0', title: 'The help desk your customers will thank you for', lead: 'Shared inbox, live chat and a knowledge base in one fast workspace. Set up in ten minutes.', actions: [{ label: 'Start your free trial', href: '#cta' }, { label: 'See pricing', href: '#pricing', ghost: true }], note: '14-day free trial · No credit card required', art: art.dashboard(t.accent, t.accentSoft) })
      + logos('Powering support at 4,000+ companies', ['LUMEN', 'VELA', 'KITECLOUD', 'ORBIT', 'NOVA'])
      + features({ title: 'Everything support needs, nothing it does not', items: [{ icon: 'mail', title: 'Shared inbox', text: 'Email, chat and social in one queue with collision detection.' }, { icon: 'bolt', title: 'Automations', text: 'Route, tag and reply automatically with simple rules.' }, { icon: 'book', title: 'Knowledge base', text: 'Publish help articles that deflect 30% of tickets.' }, { icon: 'chart', title: 'Reporting', text: 'Response times and satisfaction, per team and per agent.' }, { icon: 'users', title: 'Collaboration', text: 'Private notes and mentions keep context in the ticket.' }, { icon: 'shield', title: 'Secure by default', text: 'SOC 2 Type II, SSO and granular permissions.' }] })
      + pricing({ title: 'Simple pricing', lead: 'Per agent, billed monthly. Cancel any time.', plans: [{ name: 'Starter', price: '£15', period: '/ agent', text: 'For small teams getting started.', features: ['Shared inbox', 'Live chat', 'Basic reports'], cta: 'Start free' }, { name: 'Growth', price: '£39', period: '/ agent', text: 'For growing support teams.', features: ['Everything in Starter', 'Automations', 'Knowledge base'], cta: 'Start free', featured: true }, { name: 'Scale', price: '£79', period: '/ agent', text: 'For multi-team operations.', features: ['Everything in Growth', 'SSO and audit log', 'Dedicated success manager'], cta: 'Talk to sales' }], alt: true })
      + ctaBand({ title: 'Try Flowdesk free for 14 days', lead: 'Set up in minutes. Import your history in one click.', label: 'Start free', withForm: true })
      + footer('Flowdesk'),
  },
  {
    key: 'product-preorder', name: 'Product pre-order', category: 'Products',
    description: 'Consumer product page with hero visual, benefits, specs and a pre-order reservation form.',
    theme: theme({ font: fonts.sans, accent: '#0f766e', accentSoft: '#ccfbf1', bg: '#fbfbf9', alt: '#f1f5f3', heroBg: 'linear-gradient(160deg, #ecfdf5 0%, #fbfbf9 70%)', radius: 20, headingSpacing: '-0.03em' }),
    form: { name: 'Pre-order reservation', fields: [field.first(), field.personalEmail(), field.select('colour', 'Colour', ['Glacier', 'Forest', 'Charcoal'], true)], settings: { submitLabel: 'Reserve mine', successMessage: 'Reserved! We will email you before your bottle ships in April.', tags: ['preorder'], consent: consent('Send me launch news and offers by email.') } },
    body: t => heroArt({ brand: 'Tidal', links: ['Features', 'Specs', 'FAQ'], eyebrow: 'Pre-order now · ships April', title: 'The bottle that keeps you on track', lead: 'Tidal glows when it is time to drink and tracks every sip. Keeps drinks cold for 24 hours.', actions: [{ label: 'Reserve yours for £39', href: '#register' }, { label: 'See features', href: '#features', ghost: true }], note: 'Free UK delivery · 30-day returns', art: art.product(t.accent, t.accentSoft) })
      + features({ title: 'Designed for everyday hydration', items: [{ icon: 'clock', title: 'Smart reminders', text: 'A soft glow nudges you when you fall behind your goal.' }, { icon: 'leaf', title: 'Plastic-free', text: 'Recycled stainless steel with a bamboo lid.' }, { icon: 'heart', title: 'Health sync', text: 'Syncs with Apple Health and Google Fit.' }], alt: true })
      + stats([{ value: '24h', label: 'Cold drinks' }, { value: '750ml', label: 'Capacity' }, { value: '30 days', label: 'Battery life' }, { value: '2 yrs', label: 'Warranty' }])
      + `<section class="ovp-section ovp-alt" id="register"><div class="ovp-wrap ovp-row"><div><span class="ovp-eyebrow">Limited first batch</span><h2 class="ovp-h2">Reserve yours today</h2><p class="ovp-text">No payment now. We will email you to confirm your order before it ships.</p></div><div class="ovp-form-card">${formSlot()}</div></div></section>`
      + faq([{ q: 'When will it ship?', a: 'The first batch ships in April. Reservations are fulfilled in order.' }, { q: 'Is it dishwasher safe?', a: 'The bottle is; the smart lid should be wiped clean.' }])
      + footer('Tidal'),
  },
  // ── Waitlists ──
  {
    key: 'app-waitlist', name: 'App waitlist', category: 'Waitlists',
    description: 'Dark, minimal waitlist page with a phone mock-up and an email sign-up.',
    theme: theme({ bg: '#0b0f1a', surface: '#ffffff', alt: '#111827', ink: '#0f172a', muted: '#94a3b8', accent: '#a855f7', accentSoft: '#f3e8ff', border: '#1f2937', heroBg: 'radial-gradient(circle at 30% 20%, #3b0764 0%, #0b0f1a 60%)', heroInk: '#ffffff', heroMuted: '#cbd5e1', radius: 14 }),
    form: { name: 'App waitlist', fields: [field.personalEmail()], settings: { submitLabel: 'Join the waitlist', successMessage: 'You are on the list! We will email your invite as soon as a spot opens.', tags: ['waitlist'], consent: consent('Email me when my invite is ready, plus occasional product news.') } },
    body: t => heroForm({ brand: 'Habitly', eyebrow: 'Coming this spring', title: 'Small habits. Big change.', lead: 'Habitly turns your goals into tiny daily actions and keeps you going with gentle, science-backed nudges.', bullets: ['Early access before public launch', 'Founding-member pricing for life', 'Help shape the roadmap'], formTitle: 'Get early access', formNote: '12,400 people are already waiting.' })
      .replace('<section class="ovp-hero"', '<section class="ovp-hero" style="min-height:92vh"')
      + `<section class="ovp-section" style="background-color:#0b0f1a;color:#ffffff"><div class="ovp-wrap ovp-row"><div class="ovp-media">${art.phone(t.accent, '#1f1532')}</div><div><span class="ovp-eyebrow">How it works</span><h2 class="ovp-h2">Two minutes a day is all it takes</h2><p class="ovp-text" style="color:#cbd5e1">Pick a goal, get a tiny daily action and check in with one tap. Habitly adapts as you go.</p></div></div></section>`
      + footer('Habitly'),
    extraCss: '.ovp-footer{border-top-color:#1f2937;color:#94a3b8;background-color:#0b0f1a;}',
  },
  {
    key: 'beta-access', name: 'Private beta access', category: 'Waitlists',
    description: 'Centred, product-led beta application with qualifying questions.',
    theme: theme({ accent: '#111827', accentInk: '#ffffff', accentSoft: '#f3f4f6', heroBg: 'linear-gradient(180deg, #f9fafb 0%, #ffffff 100%)', radius: 8, headingSpacing: '-0.04em' }),
    form: { name: 'Beta application', fields: [field.first(), field.email(), field.company(true), field.select('role', 'Your role', ['Founder', 'Engineering', 'Product', 'Finance', 'Other'], true), field.select('team_size', 'Team size', ['Just me', '2–10', '11–50', '51+'], true)], settings: { submitLabel: 'Apply for access', successMessage: 'Application received. We invite new teams every Monday.', tags: ['beta-applicant'], consent: consent() } },
    body: () => heroCenter({ brand: 'Ledgerly', pill: 'Private beta · invites weekly', title: 'Close your books in hours, not weeks', lead: 'Ledgerly reconciles transactions, chases receipts and drafts your month-end report automatically.', body: `<div class="ovp-form-card" style="max-width:540px;margin:0 auto 20px auto;text-align:left">${formSlot()}</div>`, note: 'We review every application personally.' })
      + features({ title: 'Built for modern finance teams', items: [{ icon: 'bolt', title: 'Auto-reconciliation', text: '95% of transactions matched without a click.' }, { icon: 'mail', title: 'Receipt chasing', text: 'Polite reminders until every receipt is in.' }, { icon: 'chart', title: 'Month-end in a day', text: 'Draft reports and variance notes generated for you.' }], alt: true })
      + footer('Ledgerly'),
  },
  // ── Lead magnets ──
  {
    key: 'ebook-download', name: 'Ebook download', category: 'Lead magnets',
    description: 'Classic guide download page with cover art, chapter list and a short form.',
    theme: theme({ accent: '#dc2626', accentSoft: '#fee2e2', heroBg: 'linear-gradient(160deg, #fff7ed 0%, #ffffff 65%)', radius: 10 }),
    form: { name: 'Ebook download', fields: [field.first(), field.email(), field.company()], settings: { submitLabel: 'Send me the guide', successMessage: 'Your guide is on its way. Check your inbox in the next few minutes.', tags: ['ebook-email-playbook'], consent: consent() } },
    body: t => heroForm({ brand: 'Growthwise', eyebrow: 'Free ebook · 42 pages', title: 'The 2027 email marketing playbook', lead: 'The frameworks, benchmarks and templates behind 300 high-performing email programmes.', bullets: ['Benchmarks for 12 industries', '25 copy-and-paste templates', 'A 90-day implementation plan'], formTitle: 'Get your free copy', extra: `<div style="max-width:220px">${art.ebook(t.accent, '#0f172a')}</div>` })
      + steps({ title: 'Inside the playbook', items: [{ title: 'Strategy', text: 'Segment, sequence and measure what matters.' }, { title: 'Creative', text: 'Subject lines, layouts and copy that convert.' }, { title: 'Growth', text: 'List growth and re-engagement that lasts.' }], alt: true })
      + testimonials({ title: 'Readers say', items: [{ quote: 'The benchmark tables alone are worth it.', name: 'Nina Brooks', role: 'Head of CRM, Orbit' }, { quote: 'We used the welcome series template and lifted revenue 18%.', name: 'Ben Carter', role: 'Founder, Fieldnote' }] })
      + footer('Growthwise'),
  },
  {
    key: 'checklist-download', name: 'Checklist download', category: 'Lead magnets',
    description: 'Compact, practical checklist offer with preview and benefits.',
    theme: theme({ font: fonts.rounded, headingFont: fonts.rounded, accent: '#0891b2', accentSoft: '#cffafe', alt: '#f0fbfd', heroBg: 'linear-gradient(180deg, #ecfeff 0%, #ffffff 100%)', radius: 16 }),
    form: { name: 'Checklist download', fields: [field.first(), field.personalEmail()], settings: { submitLabel: 'Email me the checklist', successMessage: 'Done! The checklist is in your inbox.', tags: ['launch-checklist'], consent: consent() } },
    body: t => heroArt({ brand: 'Shopwell', eyebrow: 'Free printable checklist', title: 'The 37-point store launch checklist', lead: 'Everything to check before you open your online store, from payments to policies.', actions: [{ label: 'Get the checklist', href: '#register' }], art: art.checklist(t.accent, t.accentSoft) })
      + `<section class="ovp-section ovp-alt" id="register"><div class="ovp-wrap ovp-row"><div><h2 class="ovp-h2">Launch with confidence</h2><p class="ovp-text">Used by 18,000 new store owners. One page, printable, and updated for 2027.</p></div><div class="ovp-form-card">${formSlot()}</div></div></section>`
      + footer('Shopwell'),
  },
  {
    key: 'industry-report', name: 'Industry report', category: 'Lead magnets',
    description: 'Data-led report download with headline stats and key findings.',
    theme: theme({ headingFont: fonts.serif, ink: '#0f172a', accent: '#1d4ed8', accentSoft: '#dbeafe', heroBg: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', heroInk: '#ffffff', heroMuted: '#cbd5e1', headingWeight: 600, radius: 6 }),
    form: { name: 'Report download', fields: [field.first(), field.last(), field.email(), field.company(true), field.role()], settings: { submitLabel: 'Download the report', successMessage: 'Thanks! The full report has been sent to your inbox.', tags: ['state-of-b2b-report'], consent: consent() } },
    body: t => heroForm({ brand: 'Meridian Research', eyebrow: 'State of B2B Buying 2027', title: 'How 2,400 buyers really choose software', lead: 'Our annual survey of decision makers across 14 countries, with the data behind every finding.', formTitle: 'Download the full report' })
      + stats([{ value: '71%', label: 'shortlist before talking to sales' }, { value: '6.8', label: 'stakeholders per purchase' }, { value: '3×', label: 'more trust in peer reviews' }, { value: '44%', label: 'switched vendors in 2026' }], true)
      + split({ eyebrow: 'Key findings', title: 'The buying committee has changed', text: 'Finance and security now join earlier, and most buyers expect pricing on your website.', bullets: ['Self-serve research dominates early stages', 'Security reviews start before the demo', 'Transparent pricing wins shortlists'], art: art.report(t.accent, t.accentSoft) })
      + footer('Meridian Research'),
  },
];

export const blankTemplate: PageTemplate = {
  key: 'blank', name: 'Blank page', category: 'Lead generation', description: 'Start from an empty canvas with the OVELIO kit styles.',
  palette: ['#ffffff', '#2457d6'], hasForm: false,
  html: `<section class="ovp-section"><div class="ovp-wrap"><h1 class="ovp-h1">Your headline</h1><p class="ovp-lead">Drag sections from the left panel to build your page.</p></div></section>`,
  css: kitCss(theme({})),
};

export const pageTemplates: PageTemplate[] = definitions.map(item => ({
  key: item.key, name: item.name, category: item.category, description: item.description,
  palette: [item.theme.accent, item.theme.heroInk === '#ffffff' ? item.theme.ink : item.theme.alt, item.theme.bg],
  hasForm: Boolean(item.form), form: item.form, source: 'curated' as const,
  html: item.body(item.theme), css: kitCss(item.theme) + (item.extraCss ?? ''),
}));

/** Curated templates followed by the factory's generated ones (./factory). */
export const allPageTemplates: PageTemplate[] = [...pageTemplates, ...buildFactoryTemplates()];

export function pageTemplate(key: string): PageTemplate | null {
  if (key === 'blank') return blankTemplate;
  return allPageTemplates.find(item => item.key === key) ?? null;
}

export function pageTemplateSummaries(): PageTemplateSummary[] {
  return pageTemplates.map(({ key, name, category, description, palette, hasForm }) => ({ key, name, category, description, palette, hasForm }));
}
