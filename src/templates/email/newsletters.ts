// Newsletter, Announcement, Promotion and Welcome series templates.
import type { EmailTemplate } from './shared';
import { badge, button, column, divider, email, footer, header, heading, heroArt, image, section, spacer, text, thumb } from './shared';

const article = (n: number, title: string, summary: string) => section(
  column(image(thumb(n, 240, 170), `Illustration for ${title}`, { radius: '8px' }), { width: '38%', padding: '12px 0 12px 32px' })
  + column(heading(title, 18, { padding: '12px 32px 2px 20px' }) + text(summary, { size: 14, padding: '2px 32px 4px 20px' })
    + text(`<a href="[[brand.website]]" style="font-weight:600;text-decoration:none">Read more →</a>`, { size: 14, padding: '2px 32px 12px 20px' }), { width: '62%' }),
);

const stat = (value: string, label: string) => column(heading(value, 26, { align: 'center', color: '[[brand.primary]]', padding: '16px 8px 0' })
  + text(label, { size: 13, align: 'center', color: '[[brand.muted]]', padding: '0 8px 16px' }));

export const newsletterTemplates: EmailTemplate[] = [
  {
    key: 'newsletter-digest', name: 'Monthly digest', category: 'Newsletter', marketing: true,
    description: 'Hero headline with three illustrated stories and a closing call to action.',
    subject: 'Your monthly digest from [[brand.name]]', preheader: 'Three stories worth your time this month.',
    mjml: email(header('Monthly digest')
      + section(column(image(heroArt(0), 'Abstract illustration in brand colours')))
      + section(column(heading('This month at [[brand.name]]', 30, { padding: '28px 32px 4px' })
        + text('Hi {{contact.first_name | there}}, here is what we shipped, learned and planned this month. Grab a coffee — it is a good one.'))
      )
      + article(0, 'What we launched', 'A faster setup, cleaner reports and two integrations you asked for.')
      + article(1, 'Customer spotlight', 'How one team cut their weekly reporting time in half.')
      + article(2, 'Coming next', 'A sneak peek at the roadmap and how to join the early access group.')
      + section(column(divider() + button('Read the full digest') + spacer(12)))
      + footer()),
  },
  {
    key: 'newsletter-editorial', name: "Editor's letter", category: 'Newsletter', marketing: true,
    description: 'A long-form personal letter in a serif layout with a pull quote and signature.',
    subject: 'A note from the editor', preheader: 'Some thoughts on the season ahead.',
    mjml: email(header('', { center: true })
      + section(column(heading('Notes on the season ahead', 32, { align: 'center', padding: '24px 48px 8px' })
        + text('Issue 12 · Written by the [[brand.name]] team', { size: 13, align: 'center', color: '[[brand.muted]]', padding: '0 48px 16px' })
        + divider('8px 180px', '[[brand.primary]]')
        + text('Dear {{contact.first_name | reader}},', { size: 17, padding: '16px 48px 4px', lineHeight: '1.8' })
        + text('Every few months we pause to look at what changed, what stayed the same and what we want to do better. This letter is that pause. It is longer than our usual updates, and we hope it is worth the read.', { size: 17, padding: '4px 48px', lineHeight: '1.8' })
        + text('<em style="font-size:22px;line-height:1.5">“The best work happens when you have room to think about it.”</em>', { size: 22, color: '[[brand.primary]]', padding: '20px 64px', align: 'center', heading: true })
        + text('We are making room: fewer, better releases, more time with the people who use what we build, and a clearer plan for the year. Reply to this email and tell us what you would like us to focus on.', { size: 17, padding: '4px 48px', lineHeight: '1.8' })
        + text('Warmly,<br><strong>The [[brand.name]] team</strong>', { size: 17, padding: '16px 48px 32px', lineHeight: '1.8' })))
      + footer(), { styles: 'p { margin: 0; }' }).replace(/\[\[brand\.body_font\]\]/g, "Georgia, 'Times New Roman', serif"),
  },
  {
    key: 'newsletter-roundup', name: 'Weekly roundup', category: 'Newsletter', marketing: true,
    description: 'Dark masthead, a numbered list of links and a row of quick stats.',
    subject: 'The weekly roundup: 5 things worth reading', preheader: 'Five links, three numbers, one minute.',
    mjml: email(section(column(spacer(20) + '[[brand.logo_block_center]]'
      + heading('The weekly roundup', 34, { align: 'center', color: '#ffffff', padding: '20px 32px 4px' })
      + text('Five things worth your time, picked for {{contact.first_name | you}}.', { align: 'center', color: '#e5e7eb', padding: '0 32px 28px' })), { background: '[[brand.text]]' })
      + section(column(['A practical guide to cleaner contact data', 'Five subject lines that doubled our opens', 'What we learned from 1,000 onboarding calls', 'The quiet power of a plain-text email', 'Our favourite tools this week']
        .map((item, i) => text(`<span style="display:inline-block;width:28px;color:[[brand.primary]];font-weight:700">${String(i + 1).padStart(2, '0')}</span><a href="[[brand.website]]" style="color:[[brand.text]];text-decoration:none;font-weight:600">${item}</a>`, { size: 16, padding: '10px 32px' })).join('')
        + divider('20px 32px 8px')), { padding: '16px 0' })
      + section(stat('2.4k', 'New readers') + stat('48%', 'Open rate') + stat('12', 'New guides'), { padding: '0 0 16px' })
      + footer()),
  },
  {
    key: 'announce-update', name: 'Company update', category: 'Announcement', marketing: true,
    description: 'A clear headline, banner and short explanation with one action.',
    subject: 'An update from [[brand.name]]', preheader: 'What is changing and what it means for you.',
    mjml: email(header('Company update')
      + section(column(image(heroArt(2, 600, 240), 'Abstract banner illustration')))
      + section(column(heading('We are growing — here is what that means for you', 28, { padding: '28px 32px 8px' })
        + text('Hi {{contact.first_name | there}},')
        + text('Over the last year more than twice as many teams joined [[brand.name]]. To keep things fast and personal we are opening a new support hub, extending our service hours and adding a dedicated success manager for every account.')
        + text('Nothing changes in how you work with us today. Everything below is extra.')
        + button('See what is new') + spacer(16)))
      + footer()),
  },
  {
    key: 'announce-policy', name: 'Policy change notice', category: 'Announcement', marketing: true,
    description: 'A calm, scannable notice of changes with an effective date and summary box.',
    subject: 'We are updating our terms', preheader: 'A short summary of what changes and when.',
    mjml: email(header('Important update')
      + section(column(heading('We are updating our terms of service', 26, { padding: '24px 32px 8px' })
        + text('Hi {{contact.first_name | there}}, we are making a few changes to our terms. Here is a plain-language summary. The new terms take effect on <strong>1 March</strong>.')))
      + section(column(heading('What is changing', 17, { padding: '18px 24px 4px' })
        + text('• Clearer wording on how we process and store your data<br>• A new section on optional AI-assisted features<br>• Updated contact details for privacy requests', { size: 14, padding: '4px 24px 18px', lineHeight: '1.9' }),
      { background: '[[brand.background]]', radius: '8px' }), { padding: '8px 32px' })
      + section(column(text('You do not need to do anything. If you keep using [[brand.name]] after 1 March, the new terms apply.')
        + button('Read the full terms', '[[brand.website]]', { background: '#ffffff', color: '[[brand.primary]]' })
        + text('Questions? Just reply to this email.', { size: 13, color: '[[brand.muted]]', padding: '0 32px 24px' })))
      + footer()),
  },
  {
    key: 'announce-milestone', name: 'Milestone celebration', category: 'Announcement', marketing: true,
    description: 'A big centred number and a thank-you note to celebrate a milestone.',
    subject: '10,000 thank-yous', preheader: 'We hit a milestone, and you are part of it.',
    mjml: email(header('', { center: true, background: '[[brand.primary]]' })
      + section(column(heading('10,000', 72, { align: 'center', color: '#ffffff', padding: '8px 32px 0' })
        + text('customers and counting', { size: 18, align: 'center', color: '#ffffff', padding: '0 32px 32px' })), { background: '[[brand.primary]]' })
      + section(column(image(heroArt(3, 600, 120), 'Bar chart illustration of growth')))
      + section(column(heading('Thank you, {{contact.first_name | friend}}', 24, { align: 'center', padding: '28px 32px 8px' })
        + text('None of this happens without you. To celebrate, we are hosting a live session next week with the team behind the product, and every customer gets early access to our next release.', { align: 'center', padding: '4px 48px' })
        + button('Join the celebration', '[[brand.website]]', { align: 'center' }) + spacer(12)))
      + footer()),
  },
  {
    key: 'promo-sale', name: 'Seasonal sale', category: 'Promotion', marketing: true,
    description: 'Bold offer banner, coupon code box and a two-by-two product grid.',
    subject: '25% off everything this weekend', preheader: 'Use code SEASON25 at checkout. Ends Sunday.',
    mjml: email(header('Seasonal sale')
      + section(column(heading('25% off everything', 40, { align: 'center', color: '#ffffff', padding: '36px 32px 4px' })
        + text('This weekend only, {{contact.first_name | friend}}.', { size: 17, align: 'center', color: '#ffffff', padding: '0 32px 12px' })
        + text('<span style="display:inline-block;border:2px dashed #ffffff;padding:10px 22px;border-radius:6px;letter-spacing:3px;font-weight:700">SEASON25</span>', { size: 20, align: 'center', color: '#ffffff', padding: '8px 32px 12px' })
        + button('Shop the sale', '[[brand.website]]', { align: 'center', background: '#ffffff', color: '[[brand.primary]]', padding: '8px 32px 36px' })), { background: '[[brand.primary]]' })
      + section([0, 1].map(i => column(image(thumb(i, 250, 200), `Product ${i + 1}`, { padding: '24px 12px 8px', radius: '8px' }) + text(`<strong>Product ${i + 1}</strong><br><span style="color:[[brand.muted]]"><s>£80</s> £60</span>`, { align: 'center', padding: '0 12px 8px' }))).join(''), { padding: '0 20px' })
      + section([2, 0].map((v, i) => column(image(thumb(v + 1, 250, 200), `Product ${i + 3}`, { padding: '8px 12px', radius: '8px' }) + text(`<strong>Product ${i + 3}</strong><br><span style="color:[[brand.muted]]"><s>£120</s> £90</span>`, { align: 'center', padding: '0 12px 16px' }))).join(''), { padding: '0 20px' })
      + footer()),
  },
  {
    key: 'promo-flash', name: 'Flash sale (48 hours)', category: 'Promotion', marketing: true,
    description: 'Dark, urgent layout with a time-left panel and a single strong action.',
    subject: '48 hours only: flash sale', preheader: 'Our biggest discount of the year ends in two days.',
    mjml: email(section(column(spacer(24) + '[[brand.logo_block_center]]'
      + text('FLASH SALE', { size: 14, align: 'center', color: '[[brand.accent]]', weight: 700, padding: '24px 32px 0' })
      + heading('48 hours. 40% off.', 40, { align: 'center', color: '#ffffff', padding: '4px 32px 8px' })
      + text('Our biggest discount of the year, {{contact.first_name | friend}}. When the clock runs out, so does the offer.', { align: 'center', color: '#d1d5db', padding: '0 48px 20px' })), { background: '#0b1020' })
      + section(['48<br><span style="font-size:12px;font-weight:400">HOURS</span>', '40%<br><span style="font-size:12px;font-weight:400">OFF</span>', '1<br><span style="font-size:12px;font-weight:400">CODE: FLASH40</span>']
        .map(value => column(text(value, { size: 30, align: 'center', color: '#ffffff', weight: 700, padding: '18px 8px', lineHeight: '1.1' }), { background: '[[brand.primary]]', padding: '0 6px', radius: '8px' })).join(''), { background: '#0b1020', padding: '0 26px 8px' })
      + section(column(button('Claim 40% off', '[[brand.website]]', { align: 'center', background: '[[brand.accent]]', color: '#111827', padding: '24px 32px 36px' })), { background: '#0b1020' })
      + footer()),
  },
  {
    key: 'promo-loyalty', name: 'Loyalty reward', category: 'Promotion', marketing: true,
    description: 'A reward card with points balance, perks and a redeem button.',
    subject: '{{contact.first_name | You}}, you have a reward waiting', preheader: 'Your points unlocked something new.',
    mjml: email(header('Rewards')
      + section(column(heading('You have earned a reward', 28, { align: 'center', padding: '28px 32px 4px' })
        + text('Thanks for sticking with us, {{contact.first_name | friend}}. Here is what your points unlocked.', { align: 'center', padding: '0 48px 16px' })))
      + section(column(text('YOUR BALANCE', { size: 12, color: '#ffffff', align: 'center', weight: 700, padding: '24px 24px 0' })
        + heading('1,250 points', 36, { align: 'center', color: '#ffffff', padding: '4px 24px 4px' })
        + text('Gold member · next tier at 2,000 points', { size: 13, align: 'center', color: '#ffffff', padding: '0 24px 24px' }), { background: '[[brand.primary]]', radius: '12px' }), { padding: '0 48px' })
      + section(['Free shipping', 'Early access', 'Birthday gift'].map((perk, i) => column(image(badge(['✓', '★', '♥'][i], false), perk, { width: 44, padding: '20px 0 4px' }) + text(perk, { size: 14, align: 'center', weight: 600, padding: '4px 8px 16px' }))).join(''), { padding: '8px 24px' })
      + section(column(button('Redeem my reward', '[[brand.website]]', { align: 'center' }) + spacer(12)))
      + footer()),
  },
  {
    key: 'welcome-hello', name: 'Welcome — day 1', category: 'Welcome series', marketing: true,
    description: 'A warm welcome with three numbered steps to get started.',
    subject: 'Welcome to [[brand.name]], {{contact.first_name | there}}', preheader: 'Three quick steps to get the most out of your first week.',
    mjml: email(header('', { center: true })
      + section(column(image(heroArt(1, 600, 220), 'Welcome illustration')))
      + section(column(heading('Welcome aboard, {{contact.first_name | friend}}!', 30, { align: 'center', padding: '28px 32px 8px' })
        + text('We are glad you are here. These three steps take about five minutes and make everything that follows easier.', { align: 'center', padding: '0 48px 12px' })))
      + [['1', 'Complete your profile', 'Add your details so we can tailor what you see.'], ['2', 'Explore the essentials', 'A two-minute tour of the features most people use first.'], ['3', 'Say hello', 'Reply to this email — a real person reads every message.']]
        .map(([n, title, body]) => section(column(image(badge(n), `Step ${n}`, { width: 44, padding: '14px 0 0 32px', align: 'left' }), { width: '18%' })
          + column(heading(title, 17, { padding: '14px 32px 0 0' }) + text(body, { size: 14, padding: '2px 32px 10px 0' }), { width: '82%' }))).join('')
      + section(column(button('Get started', '[[brand.website]]', { align: 'center' }) + spacer(12)))
      + footer()),
  },
  {
    key: 'welcome-tips', name: 'Getting started tips — day 3', category: 'Welcome series', marketing: true,
    description: 'Four practical tips in a two-column grid with icons.',
    subject: '4 tips our happiest customers swear by', preheader: 'Small habits that save hours.',
    mjml: email(header('Getting started')
      + section(column(heading('Four tips to work smarter', 28, { padding: '24px 32px 4px' })
        + text('Hi {{contact.first_name | there}}, you have had a few days to look around. These tips come from the customers who get the most out of [[brand.name]].')))
      + [[['⚡', 'Use shortcuts', 'Press ⌘K anywhere to jump straight to what you need.'], ['★', 'Save your views', 'Pin the filters you use daily so they are one click away.']],
        [['✉', 'Invite your team', 'Shared work moves faster. Invite colleagues in a click.'], ['↻', 'Automate the boring bits', 'Let a workflow handle the follow-ups you always forget.']]]
        .map(pair => section(pair.map(([icon, title, body]) => column(image(badge(icon, false), title, { width: 44, padding: '18px 0 4px 32px', align: 'left' })
          + heading(title, 16, { padding: '8px 32px 0' }) + text(body, { size: 14, padding: '2px 32px 8px' }))).join(''))).join('')
      + section(column(button('Try a tip now') + spacer(12)))
      + footer()),
  },
  {
    key: 'welcome-checkin', name: 'Personal check-in — day 7', category: 'Welcome series', marketing: true,
    description: 'A plain, personal note from the founder with helpful links.',
    subject: 'How is it going, {{contact.first_name | there}}?', preheader: 'A quick personal check-in after your first week.',
    mjml: email(section(column(spacer(24) + '[[brand.logo_block]]' + spacer(12)
      + text('Hi {{contact.first_name | there}},', { size: 16, padding: '12px 32px 4px' })
      + text('It has been a week since you joined [[brand.name]], so I wanted to check in personally. How is it going so far?', { size: 16 })
      + text('If anything felt confusing or slow, I would genuinely like to hear about it — just hit reply. I read every answer.', { size: 16 })
      + text('A few things people find useful at this stage:', { size: 16 })
      + text('→ <a href="[[brand.website]]">The 10-minute setup checklist</a><br>→ <a href="[[brand.website]]">Answers to the most common questions</a><br>→ <a href="[[brand.website]]">Book a free onboarding call</a>', { size: 16, lineHeight: '2' })
      + text('Thanks for giving us a try,<br><strong>Alex</strong><br><span style="color:[[brand.muted]]">Founder, [[brand.name]]</span>', { size: 16, padding: '12px 32px 28px' })), { padding: '0' })
      + footer()),
  },
];
