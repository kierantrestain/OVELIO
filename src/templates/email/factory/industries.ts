// Industry configurations: vocabulary, sample items and the layout style each industry reads best in.
import type { Item, LayoutStyle } from './layouts';

export type Industry = 'saas' | 'agency' | 'ecommerce' | 'events' | 'services';

export type IndustryConfig = {
  key: Industry;
  label: string;
  style: LayoutStyle;
  heroVariant: number;
  /** What the business sells, e.g. "platform", "studio", "store". */
  offering: string;
  audience: string;
  features: Item[];
  products: Item[];
  resources: Item[];
  stats: { value: string; label: string }[];
  quote: { text: string; author: string };
  event: { name: string; format: string; when: string; where: string };
  launch: { name: string; promise: string };
};

export const industries: IndustryConfig[] = [
  {
    key: 'saas', label: 'SaaS', style: 'bold', heroVariant: 4, offering: 'platform', audience: 'teams',
    features: [
      { title: 'Faster setup', body: 'Connect your tools in minutes with guided imports.' },
      { title: 'Shared dashboards', body: 'Give every team the same live numbers.' },
      { title: 'Smart alerts', body: 'Hear about what changed before your customers do.' },
    ],
    products: [
      { title: 'Starter', body: 'For small teams getting started.', meta: '£19 / month' },
      { title: 'Growth', body: 'Automation and reporting for scale-ups.', meta: '£49 / month' },
      { title: 'Business', body: 'Advanced security and admin controls.', meta: '£99 / month' },
      { title: 'Enterprise', body: 'Dedicated support and custom terms.', meta: 'Talk to us' },
    ],
    resources: [
      { title: 'The onboarding checklist', body: 'Ten steps our fastest-growing customers take in week one.' },
      { title: 'Benchmark: activation rates', body: 'How 400 software teams measure their first-week success.' },
      { title: 'Office hours recording', body: 'Product experts answer your top questions.' },
    ],
    stats: [{ value: '99.98%', label: 'Uptime this quarter' }, { value: '2.1×', label: 'Faster reports' }, { value: '340', label: 'New integrations' }],
    quote: { text: 'We replaced four tools with one and our weekly reporting now takes ten minutes.', author: 'Operations lead at a sample customer' },
    event: { name: 'Product office hours', format: 'Live online session', when: 'Thursday · 16:00 GMT', where: 'Online — the link arrives after you register' },
    launch: { name: 'Workflows 2.0', promise: 'Automate the busywork with a visual builder anyone can use.' },
  },
  {
    key: 'agency', label: 'Agency', style: 'showcase', heroVariant: 2, offering: 'studio', audience: 'clients',
    features: [
      { title: 'Brand strategy', body: 'Positioning that makes the right people lean in.' },
      { title: 'Design systems', body: 'Consistent, accessible design across every channel.' },
      { title: 'Campaign production', body: 'Ideas made real, measured and improved.' },
    ],
    products: [
      { title: 'Retail rebrand', body: 'A new identity rolled out to 60 stores.', meta: 'Case study' },
      { title: 'Launch campaign', body: 'Integrated campaign for a product launch.', meta: 'Case study' },
      { title: 'Design system', body: 'A component library for five product teams.', meta: 'Case study' },
      { title: 'Website relaunch', body: 'Faster, clearer and twice the enquiries.', meta: 'Case study' },
    ],
    resources: [
      { title: 'What we learned this quarter', body: 'Three lessons from recent client work.' },
      { title: 'The brief template we use', body: 'Get better work by asking better questions.' },
      { title: 'Studio playlist', body: 'What the team listens to while making things.' },
    ],
    stats: [{ value: '48', label: 'Projects shipped' }, { value: '12', label: 'Awards' }, { value: '9 yrs', label: 'Average client tenure' }],
    quote: { text: 'They understood our customers better than we did and it shows in every piece.', author: 'Marketing director at a sample client' },
    event: { name: 'Studio open evening', format: 'In person', when: 'Wednesday · 18:30', where: 'Our studio, 12 Example Street' },
    launch: { name: 'Our new service: brand sprints', promise: 'A clear, tested brand direction in two weeks.' },
  },
  {
    key: 'ecommerce', label: 'E-commerce', style: 'commerce', heroVariant: 0, offering: 'store', audience: 'shoppers',
    features: [
      { title: 'Free delivery', body: 'On every order over £40.' },
      { title: '30-day returns', body: 'Changed your mind? No problem.' },
      { title: 'Loyalty points', body: 'Earn on every order, spend on anything.' },
    ],
    products: [
      { title: 'Everyday tote', body: 'Recycled canvas, made to last.', meta: '£28' },
      { title: 'Ceramic mug set', body: 'Hand-glazed, set of two.', meta: '£24' },
      { title: 'Linen throw', body: 'Soft, breathable, four colours.', meta: '£45' },
      { title: 'Desk planner', body: 'Undated, 12 months.', meta: '£16' },
    ],
    resources: [
      { title: 'How to style a small space', body: 'Five ideas from our design team.' },
      { title: 'Care guide: linen', body: 'Keep it soft for years.' },
      { title: 'Behind the makers', body: 'Meet the workshop behind our ceramics.' },
    ],
    stats: [{ value: '4.8★', label: 'Average review' }, { value: '24 h', label: 'Dispatch time' }, { value: '120k', label: 'Happy customers' }],
    quote: { text: 'Beautiful quality, fast delivery and the nicest packaging I have ever opened.', author: 'Verified sample review' },
    event: { name: 'Spring pop-up shop', format: 'In store', when: 'Saturday · 10:00–17:00', where: 'Market Hall, 5 Example Road' },
    launch: { name: 'The Linen Collection', promise: 'Our softest range yet, in four new colours.' },
  },
  {
    key: 'events', label: 'Events', style: 'editorial', heroVariant: 1, offering: 'festival', audience: 'attendees',
    features: [
      { title: 'Forty speakers', body: 'Practitioners sharing what actually worked.' },
      { title: 'Hands-on workshops', body: 'Small groups, real exercises, take-home kits.' },
      { title: 'Evening social', body: 'Meet peers over food and music.' },
    ],
    products: [
      { title: 'Day pass', body: 'All talks on one day.', meta: '£149' },
      { title: 'Full pass', body: 'Both days plus workshops.', meta: '£249' },
      { title: 'Team pass', body: 'Five full passes.', meta: '£990' },
      { title: 'Online pass', body: 'Live stream and recordings.', meta: '£49' },
    ],
    resources: [
      { title: 'This year’s programme', body: 'Every session, speaker and room.' },
      { title: 'Travel and stay', body: 'Partner hotels and how to get here.' },
      { title: 'Last year’s highlights', body: 'The talks everyone is still quoting.' },
    ],
    stats: [{ value: '2', label: 'Days' }, { value: '40', label: 'Speakers' }, { value: '1,200', label: 'Attendees' }],
    quote: { text: 'The most useful two days of my year — I left with a plan, not just notes.', author: 'Sample attendee, last year' },
    event: { name: 'Growth Summit', format: 'In person and online', when: '14–15 May · 09:30', where: 'The Assembly Rooms, London' },
    launch: { name: 'Speaker line-up', promise: 'Forty speakers, three stages, one unforgettable programme.' },
  },
  {
    key: 'services', label: 'Professional services', style: 'minimal', heroVariant: 3, offering: 'practice', audience: 'clients',
    features: [
      { title: 'Plain-language advice', body: 'Clear recommendations without jargon.' },
      { title: 'Fixed fees', body: 'Know the cost before we start.' },
      { title: 'One named adviser', body: 'Someone who knows your situation.' },
    ],
    products: [
      { title: 'Annual review', body: 'A structured look at the year ahead.', meta: 'Fixed fee' },
      { title: 'Advisory retainer', body: 'Ongoing access to your adviser.', meta: 'Monthly' },
      { title: 'Project support', body: 'Help with a specific change.', meta: 'Quoted' },
      { title: 'Workshops', body: 'Training for your team.', meta: 'Half day' },
    ],
    resources: [
      { title: 'Year-end checklist', body: 'Deadlines and decisions for the next quarter.' },
      { title: 'Regulation update', body: 'What the latest changes mean for you.' },
      { title: 'Client question of the month', body: 'Answered by our senior partner.' },
    ],
    stats: [{ value: '25 yrs', label: 'In practice' }, { value: '600+', label: 'Clients advised' }, { value: '98%', label: 'Would recommend us' }],
    quote: { text: 'Straightforward advice and no surprises on the invoice — exactly what we needed.', author: 'Managing director, sample client' },
    event: { name: 'Briefing breakfast', format: 'In person', when: 'Tuesday · 08:00–09:30', where: 'Our offices, 1 Example Square' },
    launch: { name: 'Our client portal', promise: 'Documents, deadlines and messages in one secure place.' },
  },
];
