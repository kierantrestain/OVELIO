// Event, B2B marketing, Product launch and Transactional templates.
import type { EmailTemplate } from './shared';
import { badge, button, column, divider, email, footer, header, heading, heroArt, image, rows, section, spacer, svg, text, thumb } from './shared';

const avatar = (initials: string) => svg(96, 96, `<circle cx='48' cy='48' r='48' fill='#[[brand.background_hex]]'/><circle cx='48' cy='38' r='17' fill='#[[brand.primary_hex]]'/><path d='M18 84 Q48 52 78 84Z' fill='#[[brand.primary_hex]]'/><text x='86' y='92' text-anchor='end' font-family='Helvetica, Arial' font-size='14' font-weight='700' fill='#[[brand.accent_hex]]'>${initials}</text>`);

const progress = (done: number) => svg(536, 56, [0, 1, 2, 3].map(i => `<circle cx='${28 + i * 160}' cy='20' r='12' fill='${i <= done ? '#[[brand.primary_hex]]' : '#e5e7eb'}'/>${i < 3 ? `<rect x='${40 + i * 160}' y='18' width='136' height='4' fill='${i < done ? '#[[brand.primary_hex]]' : '#e5e7eb'}'/>` : ''}<text x='${28 + i * 160}' y='50' text-anchor='middle' font-family='Helvetica, Arial' font-size='11' fill='#6b7280'>${['Ordered', 'Packed', 'Shipped', 'Delivered'][i]}</text>`).join(''));

const kicker = (label: string, color = '[[brand.primary]]') => text(label.toUpperCase(), { size: 12, color, weight: 700, padding: '28px 32px 0' });

export const campaignTemplates: EmailTemplate[] = [
  {
    key: 'event-webinar', name: 'Webinar invitation', category: 'Event', marketing: true,
    description: 'Date and time panel, two speakers and a registration button.',
    subject: 'You are invited: live webinar on Thursday', preheader: '45 minutes, two experts, your questions answered live.',
    mjml: email(header('Live webinar')
      + section(column(kicker('Free live webinar') + heading('Turning first-time visitors into loyal customers', 28, { padding: '6px 32px 8px' })
        + text('Hi {{contact.first_name | there}}, join us for a practical 45-minute session with real examples and live Q&amp;A.')))
      + section(column(rows([['Date', 'Thursday 12 March'], ['Time', '16:00 GMT · 45 minutes'], ['Where', 'Online — link sent after registration']], { bold: true })), { padding: '4px 0' })
      + section([['Jordan Lee', 'Head of Growth', 'JL'], ['Priya Nair', 'Customer Success Lead', 'PN']].map(([name, role, initials]) => column(
        image(avatar(initials), `Portrait placeholder for ${name}`, { width: 72, padding: '20px 0 6px' }) + text(`<strong>${name}</strong><br><span style="color:[[brand.muted]]">${role}</span>`, { size: 14, align: 'center', padding: '0 12px 12px' }))).join(''))
      + section(column(button('Save my seat', '[[brand.website]]', { align: 'center' }) + text('Cannot make it live? Register anyway and we will send you the recording.', { size: 13, align: 'center', color: '[[brand.muted]]', padding: '0 48px 24px' })))
      + footer()),
  },
  {
    key: 'event-conference', name: 'Conference invitation', category: 'Event', marketing: true,
    description: 'Full-bleed hero, a one-day agenda and venue details for an in-person event.',
    subject: 'Join us in person at [[brand.name]] Live', preheader: 'One day of talks, workshops and good company.',
    mjml: email(header('[[brand.name]] Live')
      + section(column(image(heroArt(0, 600, 260, '[[brand.name]] Live'), 'Event banner')))
      + section(column(heading('One day. Twelve talks. Everyone you want to meet.', 26, { padding: '28px 32px 8px' })
        + text('{{contact.first_name | Hi}}, we would love to see you at our annual gathering of customers, partners and the team behind the product.')))
      + section(column(heading('Agenda', 18, { padding: '20px 32px 0' }) + rows([['09:30', 'Doors open and breakfast'], ['10:30', 'Keynote: the year ahead'], ['12:30', 'Lunch and product clinics'], ['14:00', 'Hands-on workshops'], ['17:00', 'Drinks on the terrace']])))
      + section(column(heading('Venue', 16, { padding: '18px 24px 0' }) + text('The Assembly Rooms, 12 Example Street, London<br>Thursday 14 May · Free for customers', { size: 14, padding: '4px 24px 18px' }), { background: '[[brand.background]]', radius: '8px' }), { padding: '16px 32px' })
      + section(column(button('Register for free') + spacer(12)))
      + footer()),
  },
  {
    key: 'event-reminder', name: 'Event reminder', category: 'Event', marketing: true,
    description: 'A ticket-style card that reminds attendees the event starts tomorrow.',
    subject: 'Reminder: we start tomorrow at 16:00', preheader: 'Your link, the agenda and how to prepare.',
    mjml: email(header('', { center: true })
      + section(column(heading('See you tomorrow, {{contact.first_name | there}}!', 28, { align: 'center', padding: '8px 32px 8px' })
        + text('Here is everything you need for a smooth start.', { align: 'center', padding: '0 48px 20px' })))
      + section(column(text('YOUR TICKET', { size: 12, color: '[[brand.accent]]', weight: 700, padding: '24px 28px 0' })
        + heading('Turning visitors into loyal customers', 22, { color: '#ffffff', padding: '4px 28px 8px' })
        + text('Thursday 12 March · 16:00 GMT<br>Online · 45 minutes', { size: 15, color: '#ffffff', padding: '0 28px 8px' })
        + button('Join the session', '[[brand.website]]', { background: '#ffffff', color: '[[brand.primary]]', padding: '12px 28px 28px' }), { background: '[[brand.primary]]', radius: '12px' }), { padding: '0 40px' })
      + section(column(heading('Before you join', 17, { padding: '28px 32px 4px' }) + text('• Use Chrome, Edge or Safari for the best experience<br>• Bring one question you would like answered<br>• Join five minutes early for a quick sound check', { size: 14, lineHeight: '1.9' }) + spacer(16)))
      + footer()),
  },
  {
    key: 'b2b-case-study', name: 'Customer case study', category: 'B2B marketing', marketing: true,
    description: 'Customer quote, three result metrics and a link to the full story.',
    subject: 'How Northwind cut onboarding time by 60%', preheader: 'A customer story with numbers you can take to your team.',
    mjml: email(header('Customer story')
      + section(column(kicker('Case study') + heading('How Northwind cut onboarding time by 60%', 28, { padding: '6px 32px 8px' })
        + text('{{contact.first_name | Hi}}, teams like yours often ask what results look like in practice. Here is one of our favourite examples.')))
      + section(column(text('“We went from weeks of manual setup to a process our new starters finish on day one. It changed how the whole company onboards.”', { size: 18, heading: true, color: '[[brand.text]]', padding: '24px 28px 8px', lineHeight: '1.5' })
        + text('<strong>Sam Rivera</strong> · Operations Director, Northwind (sample customer)', { size: 13, color: '[[brand.muted]]', padding: '0 28px 24px' }), { background: '[[brand.background]]', radius: '8px' }), { padding: '16px 32px' })
      + section([['60%', 'faster onboarding'], ['3×', 'more campaigns'], ['£40k', 'saved per year']].map(([value, label]) => column(heading(value, 30, { align: 'center', color: '[[brand.primary]]', padding: '16px 8px 0' }) + text(label, { size: 13, align: 'center', color: '[[brand.muted]]', padding: '0 8px 8px' }))).join(''))
      + section(column(button('Read the full story') + spacer(12)))
      + footer()),
  },
  {
    key: 'b2b-report', name: 'Report download', category: 'B2B marketing', marketing: true,
    description: 'Report cover beside key takeaways, with a download button.',
    subject: 'New report: the 2026 benchmark', preheader: 'Benchmarks from 1,200 teams, free to download.',
    mjml: email(header('Research')
      + section(column(image(svg(220, 290, `<rect width='220' height='290' rx='8' fill='#[[brand.primary_hex]]'/><rect x='24' y='30' width='120' height='12' rx='6' fill='#[[brand.accent_hex]]'/><text x='24' y='100' font-family='Helvetica, Arial' font-size='30' font-weight='700' fill='#ffffff'>2026</text><text x='24' y='132' font-family='Helvetica, Arial' font-size='18' fill='#ffffff'>Benchmark</text><text x='24' y='154' font-family='Helvetica, Arial' font-size='18' fill='#ffffff'>report</text><g fill='#[[brand.accent_hex]]'><rect x='24' y='220' width='24' height='40'/><rect x='58' y='200' width='24' height='60'/><rect x='92' y='180' width='24' height='80'/><rect x='126' y='160' width='24' height='100'/></g>`), 'Report cover', { width: 200, padding: '28px 0 16px 32px', align: 'left' }), { width: '42%' })
        + column(kicker('Free download') + heading('The 2026 benchmark report', 24, { padding: '6px 32px 8px' })
          + text('Inside, {{contact.first_name | you}} will find:<br>• Open and click rates by industry<br>• What top performers automate<br>• A one-page planning checklist', { size: 14, lineHeight: '1.8' })
          + button('Download the report'), { width: '58%' }))
      + section(column(divider() + text('No form to fill in — the link takes you straight to the PDF.', { size: 13, color: '[[brand.muted]]', padding: '0 32px 20px' })))
      + footer()),
  },
  {
    key: 'b2b-demo', name: 'Demo invitation', category: 'B2B marketing', marketing: true,
    description: 'A personal sales note with agenda bullets and a booking link.',
    subject: '{{contact.first_name | Hi}}, 20 minutes to see if we are a fit?', preheader: 'A short, no-pressure walkthrough tailored to your team.',
    mjml: email(section(column(spacer(24) + '[[brand.logo_block]]' + spacer(8)
      + text('Hi {{contact.first_name | there}},', { size: 16, padding: '12px 32px 4px' })
      + text('I noticed {{contact.company | your team}} has been exploring [[brand.name]]. Would a short call help? In 20 minutes we would:', { size: 16 })
      + text('1. Look at how you work today<br>2. Show the two or three features that matter most for you<br>3. Agree whether a trial makes sense — no pressure either way', { size: 16, lineHeight: '1.9' })
      + button('Pick a time that suits you')
      + text('Best regards,<br><strong>Jordan Lee</strong><br><span style="color:[[brand.muted]]">Account Executive, [[brand.name]]</span>', { size: 16, padding: '8px 32px 28px' })))
      + footer()),
  },
  {
    key: 'launch-hero', name: 'Product launch', category: 'Product launch', marketing: true,
    description: 'Big reveal with a product illustration and three feature columns.',
    subject: 'Introducing something new from [[brand.name]]', preheader: 'Meet the fastest way to get your work done.',
    mjml: email(header('New')
      + section(column(kicker('Introducing', '[[brand.accent]]') + heading('Meet the new [[brand.name]] app', 34, { align: 'center', color: '#ffffff', padding: '6px 32px 8px' })
        + text('Everything you love, now faster, simpler and in your pocket.', { size: 17, align: 'center', color: '#e5e7eb', padding: '0 48px 20px' })
        + image(heroArt(4, 600, 300), 'Illustration of the new app on a screen')), { background: '[[brand.primary]]' })
      + section([['⚡', 'Twice as fast', 'Pages load in under a second, even on slow connections.'], ['✦', 'Smarter', 'Suggestions that learn from how you work.'], ['☁', 'Always in sync', 'Start on your laptop, finish on your phone.']]
        .map(([icon, title, body]) => column(image(badge(icon), title, { width: 44, padding: '28px 0 8px' }) + heading(title, 16, { align: 'center', padding: '4px 12px 0' }) + text(body, { size: 14, align: 'center', padding: '4px 12px 12px' }))).join(''), { padding: '0 12px' })
      + section(column(button('See it in action', '[[brand.website]]', { align: 'center' }) + spacer(12)))
      + footer()),
  },
  {
    key: 'launch-feature', name: 'Feature spotlight', category: 'Product launch', marketing: true,
    description: 'Before-and-after comparison and three steps to try the new feature.',
    subject: 'New: do in one click what used to take ten', preheader: 'A feature you asked for, live today.',
    mjml: email(header('Feature spotlight')
      + section(column(heading('One click instead of ten', 28, { padding: '28px 32px 8px' })
        + text('Hi {{contact.first_name | there}}, you told us this task took too long. Here is what changed.')))
      + section(column(image(thumb(2, 250, 170), 'Before: many manual steps', { padding: '12px 12px 4px 32px', radius: '8px' }) + text('<strong>Before</strong><br>Ten manual steps and a spreadsheet.', { size: 14, padding: '4px 12px 12px 32px' }))
        + column(image(thumb(0, 250, 170), 'After: one click', { padding: '12px 32px 4px 12px', radius: '8px' }) + text('<strong>After</strong><br>One click, done in seconds.', { size: 14, padding: '4px 32px 12px 12px' })))
      + section(column(divider() + heading('Try it in three steps', 18, { padding: '4px 32px 4px' })
        + text('1. Open any list<br>2. Choose <strong>Bulk actions</strong><br>3. Pick what you need — that is it', { size: 15, lineHeight: '1.9' }) + button('Try it now') + spacer(8)))
      + footer()),
  },
  {
    key: 'launch-changelog', name: 'Release notes', category: 'Product launch', marketing: true,
    description: 'Version badge with New, Improved and Fixed sections.',
    subject: 'Release notes: version 4.2', preheader: 'New dashboards, faster search and 14 fixes.',
    mjml: email(header('Release notes')
      + section(column(text('<span style="background:[[brand.primary]];color:#ffffff;border-radius:999px;padding:4px 12px;font-weight:700;font-size:12px">VERSION 4.2</span>', { padding: '28px 32px 4px' })
        + heading('What is new this month', 28, { padding: '10px 32px 8px' })))
      + [['New', '[[brand.primary]]', 'Custom dashboards you can share with your team<br>Saved searches with alerts'], ['Improved', '[[brand.accent]]', 'Search is three times faster on large accounts<br>Clearer error messages when an import fails'], ['Fixed', '[[brand.muted]]', 'Time zones in scheduled reports<br>Exporting lists with special characters<br>…and 12 smaller fixes']]
        .map(([label, color, body]) => section(column(text(`<span style="color:${color};font-weight:700">● ${label}</span>`, { size: 15, padding: '16px 32px 2px' }) + text(body, { size: 14, padding: '2px 32px 8px 50px', lineHeight: '1.8' })))).join('')
      + section(column(divider() + button('Read the full changelog') + spacer(8)))
      + footer()),
  },
  {
    key: 'tx-receipt', name: 'Order receipt', category: 'Transactional', marketing: false,
    description: 'Order summary with line items, totals and billing details.',
    subject: 'Your receipt for order #10234', preheader: 'Thanks for your order. Here is your receipt.',
    mjml: email(header('Receipt')
      + section(column(heading('Thanks for your order, {{contact.first_name | there}}', 24, { padding: '24px 32px 4px' })
        + text('Order <strong>#10234</strong> · placed on 12 March')))
      + section(column(rows([['Annual plan × 1', '£480.00'], ['Extra seats × 3', '£90.00'], ['Subtotal', '£570.00'], ['VAT (20%)', '£114.00']]) + rows([['Total paid', '£684.00']], { bold: true })))
      + section(column(heading('Billed to', 14, { padding: '16px 24px 0' }) + text('{{contact.full_name}}<br>{{contact.company}}<br>{{contact.email}}', { size: 14, padding: '4px 24px 16px' }), { width: '50%', background: '[[brand.background]]' })
        + column(heading('Payment', 14, { padding: '16px 24px 0' }) + text('Card ending 4242<br>12 March, 10:24', { size: 14, padding: '4px 24px 16px' }), { width: '50%', background: '[[brand.background]]' }), { padding: '16px 32px' })
      + section(column(button('View your invoice') + text('Questions about this charge? Reply to this email and we will help.', { size: 13, color: '[[brand.muted]]', padding: '0 32px 20px' })))
      + footer({ transactional: true })),
  },
  {
    key: 'tx-password', name: 'Password reset', category: 'Transactional', marketing: false,
    description: 'A short security email with one button and an expiry note.',
    subject: 'Reset your password', preheader: 'This link expires in 60 minutes.',
    mjml: email(header('', { center: true })
      + section(column(image(badge('🔒', false, 64), 'Padlock icon', { width: 64, padding: '8px 0' })
        + heading('Reset your password', 26, { align: 'center', padding: '12px 32px 8px' })
        + text('Hi {{contact.first_name | there}}, we received a request to reset the password for {{contact.email}}. Click the button below to choose a new one.', { align: 'center', padding: '0 48px 4px' })
        + button('Choose a new password', '[[brand.website]]', { align: 'center' })
        + text('This link expires in 60 minutes and can be used once. If you did not ask for a reset, you can ignore this email — your password stays the same.', { size: 13, align: 'center', color: '[[brand.muted]]', padding: '4px 48px 28px' })))
      + footer({ transactional: true })),
  },
  {
    key: 'tx-shipping', name: 'Shipping confirmation', category: 'Transactional', marketing: false,
    description: 'Delivery progress tracker, address and a tracking button.',
    subject: 'Your order is on its way', preheader: 'Track your parcel — estimated delivery Friday.',
    mjml: email(header('Order #10234')
      + section(column(heading('Good news — your order has shipped', 24, { padding: '24px 32px 8px' })
        + text('Hi {{contact.first_name | there}}, your parcel left our warehouse today. Estimated delivery: <strong>Friday 14 March</strong>.')
        + image(progress(2), 'Delivery progress: ordered, packed and shipped', { padding: '16px 32px' })))
      + section(column(image(thumb(1, 120, 120), 'Item placeholder', { width: 88, padding: '12px 0 12px 32px', align: 'left' }), { width: '25%' })
        + column(text('<strong>Annual planner, navy</strong><br><span style="color:[[brand.muted]]">Qty 1 · £24.00</span>', { size: 14, padding: '20px 32px 0 8px' }), { width: '75%' }))
      + section(column(rows([['Carrier', 'Example Parcel Co.'], ['Tracking number', 'EX123456789GB'], ['Delivering to', '12 Example Street, London']])))
      + section(column(button('Track my parcel') + spacer(8)))
      + footer({ transactional: true })),
  },
];

