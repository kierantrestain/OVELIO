// The email template factory: validated layout components × brand tokens × content schemas × industry configurations.
// Pure and deterministic: no clocks or randomness, so the same inputs always give byte-identical MJML.
import type { TemplateCategory } from '@/contracts/studio';
import type { EmailTemplate } from '../shared';
import { email, footer, header } from '../shared';
import type { IndustryConfig } from './industries';
import { industries } from './industries';
import { cards, copy, cta, details, hero, offer, quote, signoff, stats } from './layouts';

export type UseCase = 'newsletter' | 'announcement' | 'promotion' | 'welcome' | 'event' | 'launch';

/** A content schema: typed copy for one use case. Required fields are checked before rendering. */
type Content = {
  subject: string; preheader: string; kicker: string; headline: string; intro: string; cta: string; note?: string;
  section: 'cards' | 'stats+cards' | 'quote+cards' | 'offer+cards' | 'details+cards'; signoff?: string;
};

const useCases: { key: UseCase; label: string; category: TemplateCategory }[] = [
  { key: 'newsletter', label: 'Newsletter', category: 'Newsletter' },
  { key: 'announcement', label: 'Announcement', category: 'Announcement' },
  { key: 'promotion', label: 'Promotion', category: 'Promotion' },
  { key: 'welcome', label: 'Welcome', category: 'Welcome series' },
  { key: 'event', label: 'Event invitation', category: 'Event' },
  { key: 'launch', label: 'Product launch', category: 'Product launch' },
];

function content(useCase: UseCase, industry: IndustryConfig): Content {
  const i = industry;
  switch (useCase) {
    case 'newsletter': return {
      subject: `This month at [[brand.name]]`, preheader: `What our ${i.audience} are reading this month.`, kicker: 'Monthly update',
      headline: `This month at our ${i.offering}`, intro: `Hi {{contact.first_name | there}}, here are the stories, numbers and resources worth your time this month.`,
      cta: 'Read more on our website', section: 'stats+cards',
    };
    case 'announcement': return {
      subject: `An update from [[brand.name]]`, preheader: 'What is changing and what it means for you.', kicker: 'Announcement',
      headline: `Changes coming to our ${i.offering}`, intro: `Hi {{contact.first_name | there}}, we are making a few improvements based on what our ${i.audience} told us. Nothing changes in how you work with us today.`,
      cta: 'See the details', section: 'quote+cards', note: 'Questions? Reply to this email and a person will answer.',
    };
    case 'promotion': return {
      subject: `20% off for {{contact.first_name | you}} this week`, preheader: 'Use code THANKYOU20 before Sunday.', kicker: 'This week only',
      headline: `20% off at our ${i.offering}`, intro: `A thank-you for being part of our community, {{contact.first_name | friend}}. Here are a few favourites to start with.`,
      cta: 'Claim the offer', section: 'offer+cards', note: 'Offer ends Sunday at midnight. One use per customer.',
    };
    case 'welcome': return {
      subject: `Welcome to [[brand.name]], {{contact.first_name | there}}`, preheader: 'Three ways to get started.', kicker: 'Welcome',
      headline: `Welcome, {{contact.first_name | friend}}!`, intro: `We are glad you are here. Here are three things our ${i.audience} find most useful in their first week.`,
      cta: 'Get started', section: 'cards', signoff: 'Warm regards,\nThe [[brand.name]] team',
    };
    case 'event': return {
      subject: `You are invited: ${i.event.name}`, preheader: `${i.event.when} · ${i.event.format}`, kicker: i.event.format,
      headline: i.event.name, intro: `Hi {{contact.first_name | there}}, we would love to see you there. Here is what to expect.`,
      cta: 'Save my place', section: 'details+cards', note: 'Places are limited. Can’t make it? Register and we will send you the highlights.',
    };
    case 'launch': return {
      subject: `Introducing ${i.launch.name}`, preheader: i.launch.promise, kicker: 'New',
      headline: `Introducing ${i.launch.name}`, intro: i.launch.promise,
      cta: 'Take a look', section: 'stats+cards',
    };
  }
}

function sectionItems(useCase: UseCase, industry: IndustryConfig) {
  if (useCase === 'promotion') return industry.products;
  if (useCase === 'newsletter') return industry.resources;
  return industry.features;
}

function render(industry: IndustryConfig, useCase: UseCase): string {
  const c = content(useCase, industry);
  for (const field of ['subject', 'preheader', 'kicker', 'headline', 'intro', 'cta'] as const) copy(c[field], 400);
  const listStyle = useCase === 'promotion' && industry.style !== 'commerce' && industry.style !== 'showcase' ? 'commerce' : industry.style;
  const parts = [
    header(useCase === 'newsletter' ? 'Monthly update' : ''),
    hero(industry.style, industry.heroVariant + useCases.findIndex(item => item.key === useCase), c.kicker, c.headline, c.intro),
  ];
  if (c.section === 'stats+cards') parts.push(stats(industry.stats));
  if (c.section === 'quote+cards') parts.push(quote(industry.quote.text, industry.quote.author));
  if (c.section === 'offer+cards') parts.push(offer('THANKYOU20', 'Use this code at checkout. Ends Sunday.'));
  if (c.section === 'details+cards') parts.push(details([['When', industry.event.when], ['Format', industry.event.format], ['Where', industry.event.where]]));
  parts.push(cards(listStyle, sectionItems(useCase, industry).slice(0, listStyle === 'commerce' || listStyle === 'showcase' ? 4 : 3)));
  parts.push(cta(c.cta, c.note ?? '', industry.style === 'bold' || industry.style === 'editorial' ? 'center' : 'left'));
  if (c.signoff) parts.push(signoff(c.signoff));
  parts.push(footer());
  return email(parts.join(''));
}

/** Throws when a generated template breaks a gallery rule; used at generation and in tests. */
export function validateTemplate(template: EmailTemplate) {
  const problems: string[] = [];
  if (!template.mjml.startsWith('<mjml')) problems.push('does not start with <mjml>');
  for (const tag of template.mjml.matchAll(/<mj-image[^>]*>/g)) if (!/ alt="[^"]+"/.test(tag[0])) problems.push('image without alt text');
  if (/src="https?:/.test(template.mjml)) problems.push('hotlinked image');
  if (template.marketing && !template.mjml.includes('{{unsubscribe_url}}')) problems.push('no unsubscribe link');
  if (template.marketing && !template.mjml.includes('{{workspace.address}}')) problems.push('no postal address');
  if (problems.length) throw new Error(`Template ${template.key}: ${problems.join(', ')}`);
  return template;
}

export const factoryIndustries = industries.map(item => ({ key: item.key, label: item.label }));
export const factoryUseCases = useCases.map(item => ({ key: item.key, label: item.label }));

export function generateTemplate(industryKey: string, useCaseKey: string): EmailTemplate {
  const industry = industries.find(item => item.key === industryKey);
  const useCase = useCases.find(item => item.key === useCaseKey);
  if (!industry || !useCase) throw new Error(`No factory template for ${industryKey}/${useCaseKey}.`);
  const c = content(useCase.key, industry);
  return validateTemplate({
    key: `f-${industry.key}-${useCase.key}`, name: `${industry.label} · ${useCase.label}`, category: useCase.category, marketing: true,
    description: `${industry.style[0].toUpperCase()}${industry.style.slice(1)} layout with ${({ cards: 'three highlights', 'stats+cards': 'key numbers and highlights', 'quote+cards': 'a testimonial and highlights', 'offer+cards': 'an offer code and product grid', 'details+cards': 'event details and highlights' })[c.section]}.`, subject: c.subject, preheader: c.preheader,
    industry: industry.key, useCase: useCase.key, source: 'factory', mjml: render(industry, useCase.key),
  });
}

/** Every industry × use case combination (5 × 6 = 30). */
export const factoryTemplates: EmailTemplate[] = industries.flatMap(industry => useCases.map(useCase => generateTemplate(industry.key, useCase.key)));
