import { randomUUID } from 'node:crypto';
import type {
  Annotation, Asset, BounceRecord, Campaign, Category, Company, CompanySettings, ContactDetail,
  ContactNote, CustomField, CustomFieldObject, Dashboard, DynamicContent, EntityChartSeries,
  EventPropertyStat, EventPropertyValue, ExpandedMetricRow, FocusItem, Goal, JourneyEmail,
  LandingPage, LeadForm, MailingList, MarketingReport, MarketingReportData, MediaItem, Page,
  PerformanceReport, Point, PointAction, PointTrigger, RealtimeReport, ReportDimension,
  RevenueReport, SavedFunnel, Segment, SessionActivityItem, SessionPropertyEntry,
  SessionPropertyStat, SessionStats, Settings, Stage, SuppressionRecord, Tag, Template,
  TrackedLink, TrackingPixel, User, Webhook, Website, WebsiteEventRow, WebsiteReport,
  WebsiteSegment, WebsiteSession, Workflow,
} from '@/contracts';
import { AppError } from './config';
import { json } from './http';

export const DEV_PREVIEW_COOKIE = 'ovelio_dev_preview';

export const DEV_PREVIEW_USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'dev@ovelio.test',
  name: 'Developer Test',
  role: 'admin',
  disabled: false,
};

/**
 * Developer preview mode is strictly disabled in production (`OVELIO_ENV=production`)
 * and in any Docker Compose deployment where the upstream engines are configured.
 * It activates only when explicitly opted-in (`OVELIO_DEV_PREVIEW=true`) or on a
 * standalone Vercel preview without external Mautic/Listmonk/Umami services attached.
 */
export function isDevPreviewMode(): boolean {
  if (process.env.OVELIO_ENV === 'production') return false;
  if (process.env.OVELIO_DEV_PREVIEW === 'true') return true;
  return process.env.VERCEL === '1'
    && !process.env.MAUTIC_URL
    && !process.env.LISTMONK_URL
    && !process.env.UMAMI_URL;
}

export function isLocalDevLoginEnabled(): boolean {
  if (process.env.OVELIO_ENV === 'production') return false;
  return process.env.OVELIO_DEV_LOGIN === 'true' && Boolean(process.env.DATABASE_URL);
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim() || url.host;
  return `${proto}://${host}`;
}

export function assertPreviewOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = requestOrigin(request);
  if (!origin || origin !== expected) {
    throw new AppError(403, 'Open this page from the configured OVELIO address and try again.');
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function dayPoints(values: number[]): Point[] {
  return values.map((value, idx) => ({
    label: new Date(Date.now() - (values.length - 1 - idx) * 86_400_000).toISOString().slice(0, 10),
    value,
  }));
}

type PreviewStore = {
  nextId: number;
  company: CompanySettings;
  team: User[];
  contacts: ContactDetail[];
  segments: Segment[];
  lists: MailingList[];
  tags: Tag[];
  stages: Stage[];
  companies: Company[];
  pointActions: PointAction[];
  pointTriggers: PointTrigger[];
  fields: Record<CustomFieldObject, CustomField[]>;
  categories: Category[];
  suppressions: SuppressionRecord[];
  campaigns: Campaign[];
  templates: Template[];
  media: MediaItem[];
  bounces: BounceRecord[];
  forms: LeadForm[];
  journeyEmails: JourneyEmail[];
  workflows: Workflow[];
  assets: Asset[];
  pages: LandingPage[];
  dynamicContent: DynamicContent[];
  focusItems: FocusItem[];
  webhooks: Webhook[];
  websites: Website[];
  goals: Record<string, Goal[]>;
  funnels: Record<string, SavedFunnel[]>;
  annotations: Record<string, Annotation[]>;
  webSegments: Record<string, WebsiteSegment[]>;
  shares: Record<string, { id: string; name: string; slug: string }[]>;
  links: TrackedLink[];
  pixels: TrackingPixel[];
};

const SITE_ID = '11111111-1111-4111-8111-111111111111';

function createInitialStore(): PreviewStore {
  const segments: Segment[] = [
    {
      id: 1, name: 'Newsletter subscribers', alias: 'newsletter-subscribers',
      description: 'Confirmed opted-in readers synced to the main newsletter list.', published: true,
      filters: [{ glue: 'and', field: 'email', object: 'lead', type: 'email', operator: '!empty', filter: '' }],
    },
    {
      id: 2, name: 'Product-qualified leads', alias: 'product-qualified-leads',
      description: 'Contacts who scored 40+ points from pricing and guide downloads.', published: true,
      filters: [{ glue: 'and', field: 'points', object: 'lead', type: 'number', operator: 'gte', filter: 40 }],
    },
  ];
  const lists: MailingList[] = [
    { id: 1, name: 'Product & marketing dispatch', description: 'Monthly updates and launch notes', type: 'private', optin: 'double', subscriberCount: 4, tags: ['newsletter'] },
    { id: 2, name: 'Release changelog', description: 'Quarterly platform updates', type: 'public', optin: 'double', subscriberCount: 2, tags: ['product'] },
  ];
  const stages: Stage[] = [
    { id: 1, name: 'Subscriber', description: 'Joined newsletter or lead form', weight: 10, published: true },
    { id: 2, name: 'Marketing Qualified', description: 'High engagement across email and guides', weight: 40, published: true },
    { id: 3, name: 'Customer', description: 'Active workspace customer', weight: 100, published: true },
  ];
  const companies: Company[] = [
    { id: 1, name: 'Northbridge Studio', email: 'hello@northbridge.example', website: 'https://northbridge.example', industry: 'Technology', city: 'London', country: 'United Kingdom', score: 85 },
    { id: 2, name: 'Harbourline Retail', email: 'team@harbourline.example', website: 'https://harbourline.example', industry: 'Retail', city: 'Bristol', country: 'United Kingdom', score: 62 },
  ];
  const contacts: ContactDetail[] = [
    {
      id: 1, email: 'claire.bennett@northbridge.example', firstName: 'Claire', lastName: 'Bennett',
      company: 'Northbridge Studio', phone: '+44 20 7946 0101', position: 'Head of Growth',
      city: 'London', country: 'United Kingdom', website: 'https://northbridge.example',
      stageId: 2, stageName: 'Marketing Qualified', points: 68, createdAt: daysAgo(18), updatedAt: daysAgo(1),
      tags: ['vip', 'newsletter'], suppressed: false, consent: 'opted_in',
      consentHistory: [{ id: '1', action: 'opted_in', evidence: 'Website newsletter signup form (double opt-in)', at: daysAgo(18) }],
      segments: [segments[0], segments[1]], mailingListIds: [1, 2], workflowIds: [1],
      linkedCompanies: [{ id: 1, name: 'Northbridge Studio', isPrimary: true }],
      devices: [{ id: 1, device: 'desktop', os: 'macOS 15', brand: 'Apple', dateAdded: daysAgo(2) }],
      notes: [{ id: 1, text: 'Requested enterprise onboarding checklist after spring launch newsletter.', type: 'general', dateTime: daysAgo(3) }],
      activity: [
        { label: 'Opened Spring Product Dispatch', at: daysAgo(1), type: 'email.read' },
        { label: 'Submitted Launch Guide Form', at: daysAgo(4), type: 'form.submitted' },
      ],
      newsletterActivity: {
        views: [{ campaignId: 1, campaignName: 'Spring Product Dispatch', at: daysAgo(1) }],
        clicks: [{ campaignId: 1, campaignName: 'Spring Product Dispatch', url: 'https://ovelio.example/launch', at: daysAgo(1) }],
      },
      subscriberBounces: [],
    },
    {
      id: 2, email: 'daniel.patel@harbourline.example', firstName: 'Daniel', lastName: 'Patel',
      company: 'Harbourline Retail', position: 'Marketing Director', city: 'Bristol', country: 'United Kingdom',
      stageId: 2, stageName: 'Marketing Qualified', points: 54, createdAt: daysAgo(12), updatedAt: daysAgo(2),
      tags: ['newsletter', 'retail'], suppressed: false, consent: 'opted_in',
      consentHistory: [{ id: '2', action: 'opted_in', evidence: 'CSV import with verified opt-in timestamp', at: daysAgo(12) }],
      segments: [segments[0], segments[1]], mailingListIds: [1], workflowIds: [1],
      linkedCompanies: [{ id: 2, name: 'Harbourline Retail', isPrimary: true }],
      devices: [{ id: 2, device: 'mobile', os: 'iOS 18', brand: 'Apple', dateAdded: daysAgo(2) }],
      notes: [], activity: [{ label: 'Clicked pricing overview link', at: daysAgo(2), type: 'page.hit' }],
      newsletterActivity: { views: [{ campaignId: 1, campaignName: 'Spring Product Dispatch', at: daysAgo(2) }], clicks: [] },
      subscriberBounces: [],
    },
    {
      id: 3, email: 'hannah.morris@kestrel.example', firstName: 'Hannah', lastName: 'Morris',
      company: 'Kestrel Digital', position: 'Demand Lead', city: 'Manchester', country: 'United Kingdom',
      stageId: 1, stageName: 'Subscriber', points: 24, createdAt: daysAgo(7), updatedAt: daysAgo(2),
      tags: ['newsletter'], suppressed: false, consent: 'opted_in',
      consentHistory: [{ id: '3', action: 'opted_in', evidence: 'Homepage signup bar', at: daysAgo(7) }],
      segments: [segments[0]], mailingListIds: [1, 2], workflowIds: [],
      linkedCompanies: [], devices: [], notes: [],
      activity: [{ label: 'Confirmed newsletter subscription', at: daysAgo(7), type: 'lead.identified' }],
      newsletterActivity: { views: [], clicks: [] }, subscriberBounces: [],
    },
    {
      id: 4, email: 'sam.okafor@bayside.example', firstName: 'Sam', lastName: 'Okafor',
      company: 'Bayside Media', position: 'Operations Manager', city: 'Edinburgh', country: 'United Kingdom',
      stageId: 1, stageName: 'Subscriber', points: 10, createdAt: daysAgo(4), updatedAt: daysAgo(4),
      tags: ['inbound'], suppressed: false, consent: 'unknown',
      consentHistory: [], segments: [], mailingListIds: [], workflowIds: [],
      linkedCompanies: [], devices: [], notes: [],
      activity: [{ label: 'Imported without recorded email consent', at: daysAgo(4), type: 'lead.created' }],
      newsletterActivity: { views: [], clicks: [] }, subscriberBounces: [],
    },
    {
      id: 5, email: 'bounce.demo@retired-domain.example', firstName: 'Alex', lastName: 'Turner',
      company: 'Retired Co', stageId: null, stageName: null, points: 0,
      createdAt: daysAgo(25), updatedAt: daysAgo(5), tags: [], suppressed: true, consent: 'suppressed',
      consentHistory: [{ id: '4', action: 'suppressed', evidence: 'Permanent SMTP hard bounce', at: daysAgo(5) }],
      segments: [], mailingListIds: [], workflowIds: [],
      linkedCompanies: [], devices: [], notes: [], activity: [],
      newsletterActivity: { views: [], clicks: [] },
      subscriberBounces: [{ id: 1, type: 'hard', source: 'smtp', campaignId: 1, campaignName: 'Spring Product Dispatch', createdAt: daysAgo(5) }],
    },
  ];
  return {
    nextId: 20,
    company: {
      name: 'OVELIO',
      website: 'https://ovelio.example',
      accent: '#2457d6',
      privacyUrl: 'https://ovelio.example/privacy',
      postalAddress: '14 Clerkenwell Green, London EC1R 0DP, United Kingdom',
    },
    team: [
      DEV_PREVIEW_USER,
      { id: '00000000-0000-4000-8000-000000000002', email: 'maya@ovelio.test', name: 'Maya Chen', role: 'marketer', disabled: false },
      { id: '00000000-0000-4000-8000-000000000003', email: 'liam@ovelio.test', name: 'Liam Brooks', role: 'analyst', disabled: false },
    ],
    contacts,
    segments,
    lists,
    tags: [
      { id: 1, tag: 'vip', description: 'Priority customer & partner contacts' },
      { id: 2, tag: 'newsletter', description: 'Opted-in monthly dispatch subscribers' },
      { id: 3, tag: 'retail', description: 'Retail vertical accounts' },
    ],
    stages,
    companies,
    pointActions: [
      { id: 1, name: 'Download product guide', description: 'Award points when a contact downloads an asset', type: 'asset.download', delta: 15, published: true },
      { id: 2, name: 'Submit lead capture form', description: 'Award points on form submission', type: 'form.submit', delta: 20, published: true },
    ],
    pointTriggers: [
      { id: 1, name: 'Promote to Marketing Qualified', description: 'Triggered at 40+ points', points: 40, published: true, triggerExistingLeads: false, events: [] },
    ],
    fields: {
      contact: [
        { id: 1, label: 'First Name', alias: 'firstname', type: 'text', group: 'core', object: 'contact', defaultValue: '', isRequired: false, isPubliclyUpdatable: true, isFixed: true, published: true, options: [] },
        { id: 2, label: 'Email', alias: 'email', type: 'email', group: 'core', object: 'contact', defaultValue: '', isRequired: true, isPubliclyUpdatable: true, isFixed: true, published: true, options: [] },
        { id: 3, label: 'Plan Tier', alias: 'plan_tier', type: 'select', group: 'professional', object: 'contact', defaultValue: 'Starter', isRequired: false, isPubliclyUpdatable: false, isFixed: false, published: true, options: ['Starter', 'Growth', 'Enterprise'] },
      ],
      company: [
        { id: 10, label: 'Company Name', alias: 'companyname', type: 'text', group: 'core', object: 'company', defaultValue: '', isRequired: true, isPubliclyUpdatable: false, isFixed: true, published: true, options: [] },
        { id: 11, label: 'Account Tier', alias: 'account_tier', type: 'select', group: 'professional', object: 'company', defaultValue: 'Mid-Market', isRequired: false, isPubliclyUpdatable: false, isFixed: false, published: true, options: ['SMB', 'Mid-Market', 'Enterprise'] },
      ],
    },
    categories: [
      { id: 1, title: 'Product Launches', alias: 'product-launches', description: 'Launch newsletters, landing pages and sequences', color: '#2457d6', bundle: 'global', published: true },
      { id: 2, title: 'Lifecycle Onboarding', alias: 'lifecycle-onboarding', description: 'Welcome journeys and educational assets', color: '#0d9488', bundle: 'campaign', published: true },
    ],
    suppressions: [
      { emailKey: 'preview-hard-bounce-digest', reason: 'bounce', at: daysAgo(5), contactId: 5, email: 'bounce.demo@retired-domain.example' },
    ],
    campaigns: [
      {
        id: 1, name: 'Spring Product Dispatch', subject: 'What is new in OVELIO this spring',
        body: '<h1>Spring Product Dispatch</h1><p>Explore our unified audience scoring, split newsletter previews, and Core Web Vitals reporting.</p><p><a href="https://ovelio.example/launch">Read the release notes</a></p>',
        altBody: 'Spring Product Dispatch — Read the release notes at https://ovelio.example/launch',
        contentType: 'richtext', tags: ['launch', 'monthly'], listIds: [1], fromEmail: 'hello@ovelio.example',
        templateId: 1, archive: true, archiveSlug: 'spring-product-dispatch', status: 'finished',
        sendAt: daysAgo(3), createdAt: daysAgo(5), toSend: 1240,
        metrics: { sent: 1240, delivered: 1228, opens: 612, clicks: 194, bounces: 12, unsubscribes: 4 },
      },
      {
        id: 2, name: 'Q2 Customer Benchmark Report', subject: '2026 Marketing Automation Benchmark',
        body: '<h2>2026 Benchmark Report</h2><p>Download the full report and compare open rates, conversion funnels, and retention cohorts.</p>',
        contentType: 'html', tags: ['report'], listIds: [1, 2], fromEmail: 'hello@ovelio.example',
        templateId: 1, archive: false, status: 'scheduled',
        sendAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), createdAt: daysAgo(1), toSend: 1380,
        metrics: { sent: 0, delivered: null, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 },
      },
      {
        id: 3, name: 'Summer Webinar Invite', subject: 'Live session: Connecting email and web analytics',
        body: '<p>Join our team for a live walkthrough of unified attribution and double opt-in compliance.</p>',
        contentType: 'richtext', tags: ['webinar'], listIds: [1], fromEmail: 'hello@ovelio.example',
        templateId: 1, archive: false, status: 'draft', sendAt: null, createdAt: daysAgo(0), toSend: 0,
        metrics: { sent: 0, delivered: null, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 },
      },
    ],
    templates: [
      { id: 1, name: 'OVELIO Clean Dispatch', type: 'campaign', isDefault: true, body: '<!doctype html><html><body style="font-family:sans-serif;max-width:600px;margin:24px auto;padding:0 16px;">{{ template "content" . }}<hr /><p style="font-size:12px;color:#666;"><a href="{{ UnsubscribeURL }}">Unsubscribe</a></p></body></html>' },
      { id: 2, name: 'Transactional Receipt', type: 'tx', subject: 'Your workspace notification', isDefault: false, body: '<!doctype html><html><body style="font-family:sans-serif;"><h2>{{ .Tx.Data.heading }}</h2><p>{{ .Tx.Data.message }}</p></body></html>' },
    ],
    media: [
      { id: 1, uuid: '22222222-2222-4222-8222-222222222222', filename: 'spring-header.svg', contentType: 'image/svg+xml', url: '/uploads/spring-header.svg', thumbUrl: null, createdAt: daysAgo(4) },
    ],
    bounces: [
      { id: 1, email: 'bounce.demo@retired-domain.example', subscriberId: 5, type: 'hard', source: 'smtp', campaignName: 'Spring Product Dispatch', createdAt: daysAgo(5) },
    ],
    forms: [
      {
        id: 1, name: 'Product Guide Download', description: 'Captures work email and company for the benchmark guide.',
        published: true, submissions: 86,
        fields: [
          { id: 1, label: 'Work Email', alias: 'email', type: 'email', mappedField: 'email', isRequired: true },
          { id: 2, label: 'First Name', alias: 'first_name', type: 'text', mappedField: 'firstname', isRequired: false },
          { id: 3, label: 'Company', alias: 'company', type: 'text', mappedField: 'company', isRequired: false },
        ],
      },
    ],
    journeyEmails: [
      { id: 1, name: 'Welcome — Day 0', subject: 'Welcome to OVELIO', body: '<p>Thanks for subscribing. Here is your starter guide.</p><p><a href="{unsubscribe_url}">Unsubscribe</a></p>', published: true, sentCount: 318, readCount: 214 },
      { id: 2, name: 'Follow-up — Day 3', subject: 'Three tips to connect campaigns & analytics', body: '<p>See how teams link UTM campaigns with funnel conversion metrics.</p><p><a href="{unsubscribe_url}">Unsubscribe</a></p>', published: true, sentCount: 274, readCount: 162 },
    ],
    workflows: [
      {
        id: 1, name: 'New Subscriber Welcome Sequence', description: 'Sends welcome email, tags contact, and follows up 3 days later.',
        enabled: true, editable: true, segmentId: 1,
        steps: [
          { kind: 'email', emailId: 1, delayMinutes: 0 },
          { kind: 'tags', emailId: 0, delayMinutes: 0, addTags: ['welcomed'] },
          { kind: 'email', emailId: 2, delayMinutes: 4320, condition: 'opened_previous' },
        ],
      },
    ],
    assets: [
      { id: 1, title: '2026 Marketing Benchmark Guide (PDF)', alias: '2026-benchmark-guide', description: 'Industry open rate and conversion benchmarks', storageLocation: 'remote', remotePath: 'https://ovelio.example/guides/2026-benchmark.pdf', downloadUrl: 'https://ovelio.example/asset/1:2026-benchmark-guide', downloadCount: 142, uniqueDownloadCount: 118, published: true },
    ],
    pages: [
      { id: 1, title: 'Spring Launch Overview', alias: 'spring-launch', metaDescription: 'Explore what is new in OVELIO', customHtml: '<main><h1>Spring Launch</h1><p>Unified marketing automation and web analytics.</p></main>', hits: 648, uniqueHits: 512, published: true },
    ],
    dynamicContent: [
      { id: 1, name: 'Homepage Hero Personalisation', slotName: 'hero-cta', content: '<p>Welcome back — explore the Q2 Benchmark Guide.</p>', isCampaignBased: true, published: true, sentCount: 412, dateAdded: daysAgo(10) },
    ],
    focusItems: [
      {
        id: 1, name: 'Spring Benchmark Announcement Bar', description: 'Top announcement bar linking to the benchmark landing page.',
        type: 'link', style: 'bar', headline: '2026 Marketing Benchmark Report is live', tagline: 'Read the latest open rate and funnel data.',
        linkText: 'Read report', linkUrl: 'https://ovelio.example/spring-launch', formId: null,
        primaryColor: '#2457d6', textColor: '#111827', buttonColor: '#2457d6', buttonTextColor: '#ffffff',
        when: 'immediately', published: true,
        embedScript: '<script src="https://ovelio.example/focus/1.js" type="text/javascript" charset="utf-8" async="async"></script>',
      },
    ],
    webhooks: [
      { id: 1, name: 'Data warehouse contact sync', description: 'Streams contact creation events to BI ingestion.', webhookUrl: 'https://hooks.ovelio.example/contacts', triggers: ['mautic.lead_post_save_new'], published: true },
    ],
    websites: [{ id: SITE_ID, name: 'OVELIO Marketing Site', domain: 'ovelio.example' }],
    goals: {
      [SITE_ID]: [
        { id: '33333333-3333-4333-8333-333333333331', name: 'Guide Download Signup', type: 'event', value: 'signed_up' },
        { id: '33333333-3333-4333-8333-333333333332', name: 'Pricing Page View', type: 'path', value: '/pricing' },
      ],
    },
    funnels: {
      [SITE_ID]: [{
        id: '44444444-4444-4444-8444-444444444441', name: 'Launch Acquisition Funnel',
        description: 'Landing page to pricing to signup confirmation',
        windowMinutes: 60,
        steps: [
          { type: 'path', value: '/' },
          { type: 'path', value: '/pricing' },
          { type: 'event', value: 'signed_up' },
        ],
      }],
    },
    annotations: {
      [SITE_ID]: [{ id: '55555555-5555-4555-8555-555555555551', date: daysAgo(3).slice(0, 10), allDay: true, note: 'Sent Spring Product Dispatch newsletter' }],
    },
    webSegments: {
      [SITE_ID]: [{
        id: '66666666-6666-4666-8666-666666666661', name: 'UK Newsletter Visitors', type: 'segment',
        filters: [{ name: 'country', operator: 'eq', value: 'GB' }, { name: 'utmMedium', operator: 'eq', value: 'email' }],
        match: 'all', createdAt: daysAgo(5),
      }],
    },
    shares: { [SITE_ID]: [] },
    links: [
      { id: '77777777-7777-4777-8777-777777777771', name: 'Spring Launch CTA', url: 'https://ovelio.example/spring-launch', slug: 'spring2026', createdAt: daysAgo(5) },
    ],
    pixels: [
      { id: '88888888-8888-4888-8888-888888888881', name: 'Partner Newsletter Pixel', slug: 'partnerpx1', createdAt: daysAgo(6) },
    ],
  };
}

const globalPreview = globalThis as typeof globalThis & { ovelioPreviewStore?: PreviewStore };
function store(): PreviewStore {
  globalPreview.ovelioPreviewStore ??= createInitialStore();
  return globalPreview.ovelioPreviewStore;
}

export function devPreviewCompany(): CompanySettings {
  return store().company;
}

export function devPreviewMediaList(): MediaItem[] {
  return store().media;
}

export function devPreviewMediaUpload(filename: string, contentType: string): MediaItem {
  const s = store();
  const item: MediaItem = {
    id: s.nextId++,
    uuid: randomUUID(),
    filename,
    contentType,
    url: '/uploads/' + encodeURIComponent(filename),
    thumbUrl: null,
    createdAt: new Date().toISOString(),
  };
  s.media.unshift(item);
  return item;
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function previewDashboard(s: PreviewStore): Dashboard {
  return {
    contacts: s.contacts.length,
    contactGrowth: dayPoints([1, 2, 1, 3, 2, 4, 3, 2, 5, 4, 3, 6, 4, 5]),
    activeCampaigns: s.campaigns.filter(c => c.status === 'running' || c.status === 'scheduled').length,
    runningCampaigns: [],
    activeWorkflows: s.workflows.filter(w => w.enabled).length,
    email: { sent: 1240, delivered: 1228, opens: 612, clicks: 194, bounces: 12, unsubscribes: 4 },
    emailTrend: dayPoints([42, 58, 94, 180, 126, 74, 38]),
    emailClicksTrend: dayPoints([12, 18, 31, 64, 39, 20, 10]),
    emailBouncesTrend: dayPoints([1, 0, 2, 5, 2, 1, 1]),
    visitors: 4820,
    activeVisitors: 14,
    websiteName: s.websites[0]?.name,
    traffic: dayPoints([510, 640, 590, 720, 810, 680, 870, 920, 760, 845, 910, 980, 890, 1040]),
    leads: s.forms.reduce((sum, f) => sum + (f.submissions ?? 0), 0),
    conversions: 142,
    conversionGoal: s.goals[SITE_ID]?.[0]?.name ?? 'Guide Download Signup',
    recent: [
      { id: '1', description: 'Spring Product Dispatch finished sending (1,240 recipients)', at: daysAgo(1), href: '/campaigns/1' },
      { id: '2', description: 'Claire Bennett reached Marketing Qualified stage (68 pts)', at: daysAgo(1), href: '/audience/1' },
      { id: '3', description: 'New Subscriber Welcome Sequence delivered 18 emails', at: daysAgo(2), href: '/automations' },
    ],
    alerts: [],
  };
}

function previewReport(site: Website, query: URLSearchParams): WebsiteReport {
  const endAt = Number(query.get('endAt')) || Date.now();
  const startAt = Number(query.get('startAt')) || endAt - 30 * 86_400_000;
  const dimensions: Partial<Record<ReportDimension, Point[]>> = {
    path: [{ label: '/', value: 3820 }, { label: '/pricing', value: 1940 }, { label: '/spring-launch', value: 1480 }, { label: '/guides', value: 910 }],
    entry: [{ label: '/', value: 2940 }, { label: '/spring-launch', value: 1120 }, { label: '/pricing', value: 760 }],
    exit: [{ label: '/pricing', value: 1620 }, { label: '/', value: 1410 }, { label: '/guides', value: 890 }],
    title: [{ label: 'OVELIO — Marketing. Connected.', value: 3820 }, { label: 'Pricing', value: 1940 }, { label: 'Spring Launch', value: 1480 }],
    referrer: [{ label: 'Direct', value: 2180 }, { label: 'google.com', value: 1490 }, { label: 'linkedin.com', value: 640 }, { label: 'github.com', value: 510 }],
    channel: [{ label: 'Direct', value: 2180 }, { label: 'Organic Search', value: 1490 }, { label: 'Email', value: 740 }, { label: 'Referral', value: 410 }],
    country: [{ label: 'GB', value: 2410 }, { label: 'US', value: 1320 }, { label: 'DE', value: 540 }, { label: 'CA', value: 310 }],
    region: [{ label: 'London', value: 1420 }, { label: 'California', value: 610 }, { label: 'Bristol', value: 490 }],
    city: [{ label: 'London', value: 1420 }, { label: 'San Francisco', value: 380 }, { label: 'Manchester', value: 340 }],
    device: [{ label: 'desktop', value: 3420 }, { label: 'mobile', value: 1240 }, { label: 'tablet', value: 160 }],
    browser: [{ label: 'Chrome', value: 2980 }, { label: 'Safari', value: 1140 }, { label: 'Firefox', value: 420 }, { label: 'Edge', value: 280 }],
    os: [{ label: 'macOS', value: 2160 }, { label: 'Windows', value: 1340 }, { label: 'iOS', value: 890 }, { label: 'Android', value: 430 }],
    language: [{ label: 'en-GB', value: 2540 }, { label: 'en-US', value: 1580 }, { label: 'de-DE', value: 460 }],
    screen: [{ label: '1440x900', value: 1680 }, { label: '1920x1080', value: 1420 }, { label: '390x844', value: 840 }],
    event: [{ label: 'signed_up', value: 142 }, { label: 'guide_download', value: 86 }, { label: 'pricing_toggle', value: 214 }],
    utmSource: [{ label: 'newsletter', value: 740 }, { label: 'linkedin', value: 410 }, { label: 'partner', value: 220 }],
    utmMedium: [{ label: 'email', value: 740 }, { label: 'social', value: 410 }, { label: 'referral', value: 220 }],
    utmCampaign: [{ label: 'spring_dispatch', value: 612 }, { label: 'q2_benchmark', value: 320 }],
    utmContent: [{ label: 'hero_cta', value: 390 }, { label: 'footer_link', value: 140 }],
    utmTerm: [{ label: 'marketing_automation', value: 290 }],
    hostname: [{ label: site.domain, value: 4820 }],
    query: [{ label: '?utm_campaign=spring_dispatch', value: 612 }],
  };
  return {
    website: site,
    range: { startAt, endAt },
    current: { pageviews: 11480, visitors: 4820, visits: 6190, bounces: 2104, totaltime: 942800 },
    previous: { pageviews: 9840, visitors: 4120, visits: 5280, bounces: 1980, totaltime: 790200 },
    activeVisitors: 14,
    pageviews: dayPoints([620, 740, 690, 810, 920, 780, 960, 1020, 880, 940, 1060, 1140, 980, 1180]),
    visitors: dayPoints([290, 340, 310, 380, 410, 360, 440, 460, 390, 420, 470, 510, 450, 530]),
    eventsSeries: dayPoints([18, 22, 19, 31, 28, 24, 35, 38, 29, 34, 41, 44, 37, 46]),
    dimensions,
  };
}

function previewReports(): MarketingReport[] {
  return [
    { id: 1, name: 'All Emails', description: 'Delivery and read summary for journey emails', source: 'email.stats', columns: ['date_sent', 'date_read', 'subject', 'email_address'], system: true },
    { id: 2, name: 'Downloads of all Assets', description: 'Asset download totals across guides and PDFs', source: 'asset.downloads', columns: ['title', 'downloads', 'unique_downloads'], system: true },
    { id: 3, name: 'Submissions of published Forms', description: 'Recent lead capture form submissions', source: 'form.submissions', columns: ['form_name', 'submitted_at', 'email'], system: true },
  ];
}

function previewReportData(id: number): MarketingReportData {
  const reports = previewReports();
  const report = reports.find(r => r.id === id) ?? reports[0];
  if (report.id === 2) {
    return {
      report, totalResults: 1, columns: ['title', 'downloads', 'unique_downloads'],
      rows: [{ title: '2026 Marketing Benchmark Guide (PDF)', downloads: 142, unique_downloads: 118 }],
    };
  }
  if (report.id === 3) {
    return {
      report, totalResults: 2, columns: ['form_name', 'submitted_at', 'email'],
      rows: [
        { form_name: 'Product Guide Download', submitted_at: daysAgo(1).slice(0, 19).replace('T', ' '), email: 'claire.bennett@northbridge.example' },
        { form_name: 'Product Guide Download', submitted_at: daysAgo(2).slice(0, 19).replace('T', ' '), email: 'daniel.patel@harbourline.example' },
      ],
    };
  }
  return {
    report, totalResults: 2, columns: ['date_sent', 'date_read', 'subject', 'email_address'],
    rows: [
      { date_sent: daysAgo(2).slice(0, 19).replace('T', ' '), date_read: daysAgo(2).slice(0, 19).replace('T', ' '), subject: 'Welcome to OVELIO', email_address: 'claire.bennett@northbridge.example' },
      { date_sent: daysAgo(3).slice(0, 19).replace('T', ' '), date_read: '', subject: 'Three tips to connect campaigns & analytics', email_address: 'daniel.patel@harbourline.example' },
    ],
  };
}

export async function handleDevPreviewConsole(request: Request, segmentsPath: string[]): Promise<Response> {
  const s = store();
  const method = request.method;
  const fullPath = segmentsPath.join('/');
  const query = new URL(request.url).searchParams;

  // Overview
  if (method === 'GET' && fullPath === 'overview') return json(previewDashboard(s));

  // Contacts
  if (method === 'GET' && fullPath === 'contacts') {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const tag = (query.get('tag') ?? '').trim().toLowerCase();
    const segId = Number(query.get('segment') || 0);
    const filtered = s.contacts.filter(c => {
      if (q && !`${c.email} ${c.firstName} ${c.lastName} ${c.company}`.toLowerCase().includes(q)) return false;
      if (tag && !c.tags.some(t => t.toLowerCase() === tag)) return false;
      if (segId && !c.segments.some(seg => seg.id === segId)) return false;
      return true;
    });
    return json({ items: filtered, total: filtered.length, page: 1, limit: 25 } satisfies Page<ContactDetail>);
  }
  if (method === 'POST' && fullPath === 'contacts') {
    const body = await readJson<Partial<ContactDetail> & { evidence?: string }>(request);
    const email = (body.email ?? '').trim().toLowerCase();
    if (!email) throw new AppError(400, 'Enter a valid email address.');
    const created: ContactDetail = {
      id: s.nextId++,
      email,
      firstName: body.firstName ?? '',
      lastName: body.lastName ?? '',
      company: body.company ?? '',
      phone: body.phone ?? '',
      position: body.position ?? '',
      city: body.city ?? '',
      country: body.country ?? '',
      website: body.website ?? '',
      stageId: null,
      stageName: null,
      points: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: body.tags ?? [],
      suppressed: false,
      consent: body.consent === 'opted_in' ? 'opted_in' : 'unknown',
      consentHistory: body.consent === 'opted_in'
        ? [{ id: String(s.nextId++), action: 'opted_in', evidence: body.evidence || 'Developer preview', at: new Date().toISOString() }]
        : [],
      segments: [], mailingListIds: [], workflowIds: [], linkedCompanies: [], devices: [],
      notes: [], activity: [{ label: 'Contact created in preview', at: new Date().toISOString(), type: 'lead.created' }],
      newsletterActivity: { views: [], clicks: [] }, subscriberBounces: [],
    };
    s.contacts.unshift(created);
    return json(created, 201);
  }
  if (method === 'POST' && fullPath === 'contacts/bulk') {
    const body = await readJson<{ ids?: number[]; action?: string; tag?: string; segmentId?: number; points?: number }>(request);
    let updated = 0;
    for (const cid of body.ids ?? []) {
      const c = s.contacts.find(item => item.id === cid);
      if (!c) continue;
      if (body.action === 'add_tag' && body.tag) c.tags = [...new Set([...c.tags, body.tag.trim()])];
      if (body.action === 'remove_tag' && body.tag) c.tags = c.tags.filter(t => t.toLowerCase() !== body.tag!.toLowerCase());
      if (body.action === 'adjust_points' && typeof body.points === 'number') c.points += body.points;
      if (body.action === 'add_segment' && body.segmentId) {
        const seg = s.segments.find(item => item.id === body.segmentId);
        if (seg && !c.segments.some(x => x.id === seg.id)) c.segments.push(seg);
      }
      updated++;
    }
    return json({ updated });
  }
  if (method === 'POST' && fullPath === 'contacts/import') {
    return json({ imported: 1, failed: [] }, 201);
  }
  if (method === 'GET' && fullPath === 'contacts/export') {
    const csv = ['email,first_name,last_name,company,consent', ...s.contacts.map(c => `${c.email},${c.firstName},${c.lastName},${c.company},${c.consent}`)].join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  }

  let m: RegExpExecArray | null;
  if ((m = /^contacts\/(\d+)$/.exec(fullPath))) {
    const cid = Number(m[1]);
    const contact = s.contacts.find(c => c.id === cid);
    if (!contact) throw new AppError(404, 'Contact not found.');
    if (method === 'GET') return json(contact);
    if (method === 'PATCH') {
      const patch = await readJson<Partial<ContactDetail>>(request);
      Object.assign(contact, patch, { updatedAt: new Date().toISOString() });
      return json(contact);
    }
    if (method === 'DELETE') {
      s.contacts = s.contacts.filter(c => c.id !== cid);
      return json({ queued: true }, 202);
    }
  }
  if ((m = /^contacts\/(\d+)\/export$/.exec(fullPath)) && method === 'GET') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    return new Response(JSON.stringify(contact, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }
  if ((m = /^contacts\/(\d+)\/consent$/.exec(fullPath)) && method === 'POST') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    const body = await readJson<{ action: 'opted_in' | 'suppressed'; evidence: string }>(request);
    contact.consent = body.action;
    contact.suppressed = body.action === 'suppressed';
    contact.consentHistory = [{ id: String(s.nextId++), action: body.action, evidence: body.evidence, at: new Date().toISOString() }, ...(contact.consentHistory ?? [])];
    return json(contact);
  }
  if ((m = /^contacts\/(\d+)\/segments$/.exec(fullPath)) && method === 'POST') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    const body = await readJson<{ segmentId: number; member: boolean }>(request);
    const seg = s.segments.find(x => x.id === body.segmentId);
    if (seg) {
      contact.segments = body.member
        ? [...contact.segments.filter(x => x.id !== seg.id), seg]
        : contact.segments.filter(x => x.id !== seg.id);
    }
    return json(contact);
  }
  if ((m = /^contacts\/(\d+)\/lists$/.exec(fullPath)) && method === 'POST') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    const body = await readJson<{ listId: number; member: boolean }>(request);
    const current = contact.mailingListIds ?? [];
    contact.mailingListIds = body.member ? [...new Set([...current, body.listId])] : current.filter(id => id !== body.listId);
    return json(contact);
  }
  if (/^contacts\/(\d+)\/(resend-optin|send-email)$/.test(fullPath) && method === 'POST') return json({ sent: true });
  if ((m = /^contacts\/(\d+)\/points$/.exec(fullPath)) && method === 'POST') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    const { delta } = await readJson<{ delta: number }>(request);
    contact.points += Number(delta) || 0;
    return json(contact);
  }
  if ((m = /^contacts\/(\d+)\/stage$/.exec(fullPath)) && method === 'POST') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    const { stageId } = await readJson<{ stageId: number | null }>(request);
    const st = stageId ? s.stages.find(x => x.id === stageId) : null;
    contact.stageId = st?.id ?? null;
    contact.stageName = st?.name ?? null;
    return json(contact);
  }
  if ((m = /^contacts\/(\d+)\/notes$/.exec(fullPath))) {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    if (method === 'GET') return json(contact.notes ?? []);
    if (method === 'POST') {
      const body = await readJson<{ text: string; type?: string }>(request);
      const note: ContactNote = { id: s.nextId++, text: body.text, type: body.type ?? 'general', dateTime: new Date().toISOString() };
      contact.notes = [note, ...(contact.notes ?? [])];
      return json(note, 201);
    }
  }
  if ((m = /^notes\/(\d+)$/.exec(fullPath)) && method === 'DELETE') {
    const nid = Number(m[1]);
    for (const c of s.contacts) c.notes = (c.notes ?? []).filter(n => n.id !== nid);
    return new Response(null, { status: 204 });
  }
  if ((m = /^contacts\/(\d+)\/bounces$/.exec(fullPath)) && method === 'DELETE') {
    const contact = s.contacts.find(c => c.id === Number(m![1]));
    if (!contact) throw new AppError(404, 'Contact not found.');
    contact.subscriberBounces = [];
    return json(contact);
  }

  // Custom fields
  if ((m = /^fields\/(contact|company)$/.exec(fullPath))) {
    const obj = m[1] as CustomFieldObject;
    if (method === 'GET') return json(s.fields[obj]);
    if (method === 'POST') {
      const body = await readJson<Partial<CustomField>>(request);
      const item: CustomField = {
        id: s.nextId++, label: body.label ?? 'Custom Field',
        alias: body.alias || (body.label ?? 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        type: body.type ?? 'text', group: body.group ?? 'core', object: obj,
        defaultValue: body.defaultValue ?? '', isRequired: Boolean(body.isRequired),
        isPubliclyUpdatable: Boolean(body.isPubliclyUpdatable), isFixed: false,
        published: body.published ?? true, options: body.options ?? [],
      };
      s.fields[obj].push(item);
      return json(item, 201);
    }
  }
  if ((m = /^fields\/(contact|company)\/(\d+)$/.exec(fullPath))) {
    const obj = m[1] as CustomFieldObject;
    const fid = Number(m[2]);
    if (method === 'PATCH') {
      const item = s.fields[obj].find(f => f.id === fid);
      if (!item) throw new AppError(404, 'Field not found.');
      Object.assign(item, await readJson<Partial<CustomField>>(request));
      return json(item);
    }
    if (method === 'DELETE') {
      s.fields[obj] = s.fields[obj].filter(f => f.id !== fid);
      return new Response(null, { status: 204 });
    }
  }

  // Categories
  if (fullPath === 'categories') {
    if (method === 'GET') {
      const bundle = query.get('bundle')?.trim();
      return json(bundle ? s.categories.filter(c => c.bundle === bundle) : s.categories);
    }
    if (method === 'POST') {
      const body = await readJson<Partial<Category>>(request);
      const item: Category = {
        id: s.nextId++, title: body.title ?? 'Category',
        alias: (body.title ?? 'category').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        description: body.description ?? '', color: body.color ?? '#2457d6',
        bundle: body.bundle ?? 'global', published: body.published ?? true,
      };
      s.categories.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^categories\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') {
      const item = s.categories.find(x => x.id === id);
      if (!item) throw new AppError(404, 'Category not found.');
      Object.assign(item, await readJson<Partial<Category>>(request));
      return json(item);
    }
    if (method === 'DELETE') { s.categories = s.categories.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  // Suppressions, Segments, Lists, Tags, Stages, Companies, Scoring
  if (fullPath === 'suppressions') {
    if (method === 'GET') return json(s.suppressions);
    if (method === 'POST') {
      const body = await readJson<{ email: string; reason: SuppressionRecord['reason'] }>(request);
      s.suppressions.unshift({ emailKey: 'preview-' + s.nextId++, reason: body.reason ?? 'unsubscribe', at: new Date().toISOString(), email: body.email });
      return json({ suppressed: true }, 201);
    }
  }
  if (fullPath === 'segments') {
    if (method === 'GET') return json(s.segments);
    if (method === 'POST') {
      const body = await readJson<Partial<Segment>>(request);
      const seg: Segment = { id: s.nextId++, name: body.name ?? 'Segment', alias: 'seg-' + s.nextId, description: body.description ?? '', published: body.published ?? true, filters: body.filters ?? [] };
      s.segments.push(seg);
      return json(seg, 201);
    }
  }
  if ((m = /^segments\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.segments.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.segments = s.segments.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if (/^segments\/(\d+)\/sync$/.test(fullPath) && method === 'POST') return json({ queued: true }, 202);

  if (fullPath === 'lists') {
    if (method === 'GET') return json(s.lists);
    if (method === 'POST') {
      const body = await readJson<Partial<MailingList>>(request);
      const list: MailingList = { id: s.nextId++, name: body.name ?? 'Mailing list', description: body.description ?? '', type: body.type ?? 'private', optin: body.optin ?? 'double', subscriberCount: 0, tags: body.tags ?? [] };
      s.lists.push(list);
      return json(list, 201);
    }
  }
  if ((m = /^lists\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.lists.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.lists = s.lists.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'tags') {
    if (method === 'GET') return json(s.tags);
    if (method === 'POST') {
      const body = await readJson<{ tag: string; description?: string }>(request);
      const item: Tag = { id: s.nextId++, tag: body.tag, description: body.description };
      s.tags.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^tags\/(\d+)$/.exec(fullPath)) && method === 'DELETE') { s.tags = s.tags.filter(x => x.id !== Number(m![1])); return new Response(null, { status: 204 }); }

  if (fullPath === 'stages') {
    if (method === 'GET') return json(s.stages);
    if (method === 'POST') {
      const body = await readJson<Partial<Stage>>(request);
      const item: Stage = { id: s.nextId++, name: body.name ?? 'Stage', description: body.description ?? '', weight: body.weight ?? 10, published: body.published ?? true };
      s.stages.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^stages\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.stages.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.stages = s.stages.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'companies') {
    if (method === 'GET') return json({ items: s.companies, total: s.companies.length, page: 1, limit: 25 } satisfies Page<Company>);
    if (method === 'POST') {
      const body = await readJson<Partial<Company>>(request);
      const item: Company = { id: s.nextId++, name: body.name ?? 'Company', email: body.email ?? '', website: body.website ?? '', industry: body.industry ?? 'Technology', city: body.city ?? '', country: body.country ?? '', score: 0 };
      s.companies.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^companies\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.companies.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.companies = s.companies.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if (/^companies\/(\d+)\/contacts$/.test(fullPath) && method === 'POST') return json({ linked: true });

  if (fullPath === 'point-actions/types' && method === 'GET') {
    return json({ 'asset.download': 'Downloads an asset', 'form.submit': 'Submits a form', 'email.open': 'Opens an email', 'page.hit': 'Visits a landing page' });
  }
  if (fullPath === 'point-actions') {
    if (method === 'GET') return json(s.pointActions);
    if (method === 'POST') {
      const body = await readJson<Partial<PointAction>>(request);
      const item: PointAction = { id: s.nextId++, name: body.name ?? 'Score rule', description: body.description ?? '', type: body.type ?? 'form.submit', delta: body.delta ?? 10, published: body.published ?? true };
      s.pointActions.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^point-actions\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.pointActions.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.pointActions = s.pointActions.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if (fullPath === 'point-triggers') {
    if (method === 'GET') return json(s.pointTriggers);
    if (method === 'POST') {
      const body = await readJson<Partial<PointTrigger>>(request);
      const item: PointTrigger = { id: s.nextId++, name: body.name ?? 'Score trigger', description: body.description ?? '', points: body.points ?? 50, published: body.published ?? true, triggerExistingLeads: Boolean(body.triggerExistingLeads), events: [] };
      s.pointTriggers.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^point-triggers\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.pointTriggers.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.pointTriggers = s.pointTriggers.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  // Campaigns, Templates, Media, Bounces, Transactional
  if (fullPath === 'campaigns') {
    if (method === 'GET') {
      const status = query.get('status')?.trim();
      const q = (query.get('q') ?? '').trim().toLowerCase();
      const items = s.campaigns.filter(c => (!status || status === 'all' || c.status === status) && (!q || `${c.name} ${c.subject}`.toLowerCase().includes(q)));
      return json({ items, total: items.length, page: 1, limit: 25 } satisfies Page<Campaign>);
    }
    if (method === 'POST') {
      const body = await readJson<Partial<Campaign>>(request);
      const item: Campaign = {
        id: s.nextId++, name: body.name ?? 'Newsletter draft', subject: body.subject ?? 'Newsletter',
        body: body.body ?? '<p>Draft</p>', altBody: body.altBody, contentType: body.contentType ?? 'richtext',
        tags: body.tags ?? [], listIds: body.listIds ?? [1], fromEmail: body.fromEmail ?? 'hello@ovelio.example',
        templateId: body.templateId ?? 1, archive: Boolean(body.archive), status: 'draft', sendAt: null,
        createdAt: new Date().toISOString(), toSend: 0,
        metrics: { sent: 0, delivered: null, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 },
      };
      s.campaigns.unshift(item);
      return json(item, 201);
    }
  }
  if (fullPath === 'campaigns/running' && method === 'GET') return json([]);
  if ((m = /^campaigns\/(\d+)$/.exec(fullPath))) {
    const cid = Number(m[1]);
    const item = s.campaigns.find(c => c.id === cid);
    if (!item) throw new AppError(404, 'Newsletter not found.');
    if (method === 'GET') return json(item);
    if (method === 'PATCH') { Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.campaigns = s.campaigns.filter(c => c.id !== cid); return new Response(null, { status: 204 }); }
  }
  if ((m = /^campaigns\/(\d+)\/clone$/.exec(fullPath)) && method === 'POST') {
    const src = s.campaigns.find(c => c.id === Number(m![1]));
    if (!src) throw new AppError(404, 'Not found.');
    const body = await readJson<{ name?: string }>(request);
    const cloned: Campaign = { ...src, id: s.nextId++, name: body.name || `${src.name} (Copy)`, status: 'draft', sendAt: null, createdAt: new Date().toISOString(), metrics: { sent: 0, delivered: null, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0 } };
    s.campaigns.unshift(cloned);
    return json(cloned, 201);
  }
  if ((m = /^campaigns\/(\d+)\/archive$/.exec(fullPath)) && method === 'PATCH') {
    const item = s.campaigns.find(c => c.id === Number(m![1]));
    if (!item) throw new AppError(404, 'Not found.');
    const body = await readJson<{ archive: boolean; archiveSlug?: string }>(request);
    item.archive = body.archive;
    item.archiveSlug = body.archiveSlug || undefined;
    return json(item);
  }
  if ((m = /^campaigns\/(\d+)\/(start|pause|cancel|schedule)$/.exec(fullPath)) && method === 'POST') {
    const item = s.campaigns.find(c => c.id === Number(m![1]));
    if (!item) throw new AppError(404, 'Not found.');
    const op = m[2];
    if (op === 'start') item.status = 'running';
    if (op === 'pause') item.status = item.status === 'scheduled' ? 'draft' : 'paused';
    if (op === 'cancel') item.status = 'cancelled';
    if (op === 'schedule') {
      const body = await readJson<{ sendAt: string }>(request);
      item.status = 'scheduled';
      item.sendAt = body.sendAt;
    }
    return json(item);
  }
  if ((m = /^campaigns\/(\d+)\/preview$/.exec(fullPath)) && method === 'GET') {
    const item = s.campaigns.find(c => c.id === Number(m![1]));
    return new Response(item?.body ?? '<p>Preview</p>', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if ((m = /^campaigns\/(\d+)\/analytics$/.exec(fullPath)) && method === 'GET') {
    return json({
      views: dayPoints([40, 82, 145, 190, 95, 42, 18]),
      clicks: dayPoints([12, 29, 54, 62, 24, 9, 4]),
      bounces: dayPoints([2, 4, 3, 2, 1, 0, 0]),
      links: [{ url: 'https://ovelio.example/launch', count: 128 }, { url: 'https://ovelio.example/pricing', count: 66 }],
    });
  }
  if (/^campaigns\/(\d+)\/analytics\/export$/.test(fullPath) && method === 'GET') {
    return new Response('date,count\n2026-11-20,190\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  }
  if (/^campaigns\/(\d+)\/test$/.test(fullPath) && method === 'POST') return json({ queued: true }, 202);

  if (fullPath === 'templates') {
    if (method === 'GET') {
      const type = query.get('type');
      return json(type && type !== 'all' ? s.templates.filter(t => t.type === type) : s.templates);
    }
    if (method === 'POST') {
      const body = await readJson<Partial<Template>>(request);
      const item: Template = { id: s.nextId++, name: body.name ?? 'Template', body: body.body ?? '', type: body.type ?? 'campaign', subject: body.subject, isDefault: false };
      s.templates.push(item);
      return json(item, 201);
    }
  }
  if (fullPath === 'templates/preview' && method === 'POST') {
    const body = await readJson<{ body?: string }>(request);
    return new Response(body.body ?? '<p>Template preview</p>', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if ((m = /^templates\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.templates.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.templates = s.templates.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if ((m = /^templates\/(\d+)\/default$/.exec(fullPath)) && method === 'POST') {
    const id = Number(m[1]);
    for (const t of s.templates) t.isDefault = t.id === id;
    return json({ default: true });
  }
  if ((m = /^templates\/(\d+)\/preview$/.exec(fullPath)) && method === 'GET') {
    const item = s.templates.find(x => x.id === Number(m![1]));
    return new Response(item?.body ?? '<p>Preview</p>', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if ((m = /^media\/(\d+)$/.exec(fullPath)) && method === 'DELETE') { s.media = s.media.filter(x => x.id !== Number(m![1])); return new Response(null, { status: 204 }); }
  if (fullPath === 'bounces' && method === 'GET') return json({ items: s.bounces, total: s.bounces.length, page: 1, limit: 25 } satisfies Page<BounceRecord>);
  if ((m = /^bounces\/(\d+)$/.exec(fullPath)) && method === 'DELETE') { s.bounces = s.bounces.filter(x => x.id !== Number(m![1])); return new Response(null, { status: 204 }); }
  if (fullPath === 'bounces/blocklist' && method === 'POST') return json({ blocklisted: true });
  if (fullPath === 'tx' && method === 'POST') return json({ queued: true }, 202);

  // Automations: Forms, Journey Emails, Workflows, Assets, Pages, DWC, Focus, Webhooks, Reports
  if (fullPath === 'forms') {
    if (method === 'GET') return json(s.forms);
    if (method === 'POST') {
      const body = await readJson<Partial<LeadForm>>(request);
      const id = s.nextId++;
      const item: LeadForm = { id, name: body.name ?? 'Lead form', description: body.description ?? '', published: true, submissions: 0, fields: body.fields ?? [] };
      s.forms.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^forms\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.forms.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.forms = s.forms.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if ((m = /^forms\/(\d+)\/submissions$/.exec(fullPath)) && method === 'GET') {
    return json({ items: [{ id: 1, formId: Number(m[1]), contactId: 1, dateSubmitted: daysAgo(1), results: { email: 'claire.bennett@northbridge.example', company: 'Northbridge Studio' } }], total: 1, page: 1, limit: 25 });
  }
  if (fullPath === 'journey-emails') {
    if (method === 'GET') return json(s.journeyEmails);
    if (method === 'POST') {
      const body = await readJson<Partial<JourneyEmail>>(request);
      const item: JourneyEmail = { id: s.nextId++, name: body.name ?? 'Journey email', subject: body.subject ?? 'Hello', body: body.body ?? '<p>Email</p>', published: true, sentCount: 0, readCount: 0 };
      s.journeyEmails.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^journey-emails\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.journeyEmails.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.journeyEmails = s.journeyEmails.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if (fullPath === 'workflows') {
    if (method === 'GET') return json(s.workflows);
    if (method === 'POST') {
      const body = await readJson<Partial<Workflow>>(request);
      const item: Workflow = { id: s.nextId++, name: body.name ?? 'Workflow', description: body.description ?? '', enabled: false, editable: true, segmentId: body.segmentId ?? 1, formId: body.formId, steps: body.steps ?? [] };
      s.workflows.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^workflows\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.workflows.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.workflows = s.workflows.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if ((m = /^workflows\/(\d+)\/status$/.exec(fullPath)) && method === 'POST') {
    const item = s.workflows.find(x => x.id === Number(m![1]));
    if (!item) throw new AppError(404, 'Not found.');
    const body = await readJson<{ enabled: boolean }>(request);
    item.enabled = Boolean(body.enabled);
    return json(item);
  }
  if (/^workflows\/(\d+)\/contacts$/.test(fullPath) && method === 'GET') {
    return json(s.contacts.slice(0, 2).map(c => ({ contactId: c.id, dateAdded: c.createdAt, manuallyRemoved: false })));
  }

  if (fullPath === 'assets') {
    if (method === 'GET') return json(s.assets);
    if (method === 'POST') {
      const body = await readJson<Partial<Asset>>(request);
      const id = s.nextId++;
      const item: Asset = { id, title: body.title ?? 'Asset', alias: 'asset-' + id, description: body.description ?? '', storageLocation: 'remote', remotePath: body.remotePath ?? '', downloadUrl: `https://ovelio.example/asset/${id}:asset-${id}`, downloadCount: 0, uniqueDownloadCount: 0, published: body.published ?? true };
      s.assets.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^assets\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.assets.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.assets = s.assets.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'pages') {
    if (method === 'GET') return json(s.pages);
    if (method === 'POST') {
      const body = await readJson<Partial<LandingPage>>(request);
      const id = s.nextId++;
      const alias = body.alias || 'page-' + id;
      const item: LandingPage = { id, title: body.title ?? 'Landing page', alias, metaDescription: body.metaDescription ?? '', customHtml: body.customHtml ?? '<h1>Landing Page</h1>', hits: 0, uniqueHits: 0, published: body.published ?? true };
      s.pages.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^pages\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.pages.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.pages = s.pages.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'dynamic-content') {
    if (method === 'GET') return json(s.dynamicContent);
    if (method === 'POST') {
      const body = await readJson<Partial<DynamicContent>>(request);
      const item: DynamicContent = { id: s.nextId++, name: body.name ?? 'Slot', slotName: body.slotName ?? 'slot-' + s.nextId, content: body.content ?? '<p>Content</p>', isCampaignBased: body.isCampaignBased ?? true, published: body.published ?? true, sentCount: 0, dateAdded: new Date().toISOString() };
      s.dynamicContent.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^dynamic-content\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.dynamicContent.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.dynamicContent = s.dynamicContent.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'focus-items') {
    if (method === 'GET') return json(s.focusItems);
    if (method === 'POST') {
      const body = await readJson<Partial<FocusItem>>(request);
      const id = s.nextId++;
      const item: FocusItem = {
        id, name: body.name ?? 'Announcement Bar', description: body.description ?? '', type: body.type ?? 'notice',
        style: body.style ?? 'bar', headline: body.headline ?? body.name ?? 'Announcement', tagline: body.tagline ?? '',
        linkText: body.linkText ?? '', linkUrl: body.linkUrl ?? '', formId: body.formId ?? null,
        primaryColor: body.primaryColor ?? '#2457d6', textColor: body.textColor ?? '#111827',
        buttonColor: body.buttonColor ?? '#2457d6', buttonTextColor: body.buttonTextColor ?? '#ffffff',
        when: body.when ?? 'immediately', published: body.published ?? true,
        embedScript: `<script src="https://ovelio.example/focus/${id}.js" type="text/javascript" charset="utf-8" async="async"></script>`,
      };
      s.focusItems.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^focus-items\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.focusItems.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.focusItems = s.focusItems.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'webhooks/triggers' && method === 'GET') {
    return json({ 'mautic.lead_post_save_new': 'Contact created', 'mautic.lead_post_save_update': 'Contact updated', 'mautic.form_on_submit': 'Lead form submitted', 'mautic.email_on_open': 'Email opened' });
  }
  if (fullPath === 'webhooks') {
    if (method === 'GET') return json(s.webhooks);
    if (method === 'POST') {
      const body = await readJson<Partial<Webhook>>(request);
      const item: Webhook = { id: s.nextId++, name: body.name ?? 'Webhook', description: body.description ?? '', webhookUrl: body.webhookUrl ?? '', triggers: body.triggers ?? [], published: body.published ?? true };
      s.webhooks.push(item);
      return json(item, 201);
    }
  }
  if ((m = /^webhooks\/(\d+)$/.exec(fullPath))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { const item = s.webhooks.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.webhooks = s.webhooks.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  if (fullPath === 'reports' && method === 'GET') return json(previewReports());
  if ((m = /^reports\/(\d+)$/.exec(fullPath)) && method === 'GET') return json(previewReportData(Number(m[1])));

  // Analytics: Websites & all Umami endpoints
  if (fullPath === 'websites') {
    if (method === 'GET') return json(s.websites);
    if (method === 'POST') {
      const body = await readJson<{ name: string; domain: string }>(request);
      const created: Website = { id: randomUUID(), name: body.name, domain: body.domain };
      s.websites.push(created);
      return json(created, 201);
    }
  }
  if ((m = /^websites\/([0-9a-f-]+)$/i.exec(fullPath))) {
    const wid = m[1];
    if (method === 'PATCH') { const item = s.websites.find(w => w.id === wid); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.websites = s.websites.filter(w => w.id !== wid); return new Response(null, { status: 204 }); }
  }
  if (/^websites\/([0-9a-f-]+)\/reset$/i.test(fullPath) && method === 'POST') return json({ reset: true });
  if (/^websites\/([0-9a-f-]+)\/export$/i.test(fullPath) && method === 'GET') {
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), mode: 'developer-preview' }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  }
  if ((m = /^websites\/([0-9a-f-]+)\/shares$/i.exec(fullPath))) {
    const wid = m[1];
    s.shares[wid] ??= [];
    if (method === 'GET') return json(s.shares[wid]);
    if (method === 'POST') {
      const body = await readJson<{ name: string }>(request);
      const item = { id: randomUUID(), name: body.name, slug: 'share-' + s.nextId++ };
      s.shares[wid].push(item);
      return json(item, 201);
    }
  }
  if ((m = /^websites\/([0-9a-f-]+)\/shares\/([0-9a-f-]+)$/i.exec(fullPath)) && method === 'DELETE') {
    s.shares[m[1]] = (s.shares[m[1]] ?? []).filter(x => x.id !== m![2]);
    return new Response(null, { status: 204 });
  }
  if ((m = /^websites\/([0-9a-f-]+)\/report$/i.exec(fullPath)) && method === 'GET') {
    const site = s.websites.find(w => w.id === m![1]) ?? s.websites[0];
    return json(previewReport(site, query));
  }
  if (/^websites\/([0-9a-f-]+)\/metrics\/expanded$/i.test(fullPath) && method === 'GET') {
    const rows: ExpandedMetricRow[] = [
      { name: '/', pageviews: 3820, visitors: 2410, visits: 2940, bounces: 882, totaltime: 412000 },
      { name: '/pricing', pageviews: 1940, visitors: 1290, visits: 1510, bounces: 420, totaltime: 268000 },
      { name: '/spring-launch', pageviews: 1480, visitors: 1020, visits: 1180, bounces: 310, totaltime: 189000 },
    ];
    return json(rows);
  }
  if (/^websites\/([0-9a-f-]+)\/events$/i.test(fullPath) && method === 'GET') {
    const items: WebsiteEventRow[] = [
      { id: randomUUID(), sessionId: '99999999-9999-4999-8999-999999999991', urlPath: '/spring-launch', pageTitle: 'Spring Launch', eventName: 'signed_up', eventType: 2, referrerDomain: 'google.com', country: 'GB', device: 'desktop', browser: 'Chrome', createdAt: daysAgo(0) },
      { id: randomUUID(), sessionId: '99999999-9999-4999-8999-999999999991', urlPath: '/pricing', pageTitle: 'Pricing', eventName: null, eventType: 1, referrerDomain: 'google.com', country: 'GB', device: 'desktop', browser: 'Chrome', createdAt: daysAgo(0) },
    ];
    return json({ items, total: items.length, page: 1, limit: 25 } satisfies Page<WebsiteEventRow>);
  }
  if ((m = /^websites\/([0-9a-f-]+)\/segments$/i.exec(fullPath))) {
    const wid = m[1];
    s.webSegments[wid] ??= [];
    if (method === 'GET') {
      const type = query.get('type') ?? 'segment';
      return json(s.webSegments[wid].filter(item => item.type === type));
    }
    if (method === 'POST') {
      const body = await readJson<Partial<WebsiteSegment>>(request);
      const item: WebsiteSegment = { id: randomUUID(), name: body.name ?? 'Segment', type: body.type ?? 'segment', filters: body.filters ?? [], match: body.match ?? 'all', dateRange: body.dateRange, action: body.action, createdAt: new Date().toISOString() };
      s.webSegments[wid].push(item);
      return json(item, 201);
    }
  }
  if ((m = /^websites\/([0-9a-f-]+)\/segments\/([0-9a-f-]+)$/i.exec(fullPath)) && method === 'DELETE') {
    s.webSegments[m[1]] = (s.webSegments[m[1]] ?? []).filter(x => x.id !== m![2]);
    return new Response(null, { status: 204 });
  }
  if (/^websites\/([0-9a-f-]+)\/revenue$/i.test(fullPath) && method === 'GET') {
    const currency = (query.get('currency') ?? 'USD').toUpperCase();
    const rev: RevenueReport = {
      currency,
      stats: { sum: 28450, count: 194, uniqueCount: 162, totalSessions: 6190, average: 146.65, arpu: 175.62 },
      comparison: { sum: 24100, count: 168, uniqueCount: 141, totalSessions: 5280, average: 143.45, arpu: 170.92 },
      chart: dayPoints([3100, 4200, 3850, 4900, 4150, 3950, 4300]),
      metrics: [{ name: 'GB', sum: 14200, count: 96 }, { name: 'US', sum: 9450, count: 64 }, { name: 'DE', sum: 4800, count: 34 }],
    };
    return json(rev);
  }
  if (/^websites\/([0-9a-f-]+)\/performance$/i.test(fullPath) && method === 'GET') {
    const metric = (query.get('metric') ?? 'lcp') as PerformanceReport['metric'];
    const perf: PerformanceReport = {
      metric,
      stats: {
        lcp: { p50: 1180, p75: 1640, p95: 2490 },
        inp: { p50: 68, p75: 112, p95: 195 },
        cls: { p50: 0.02, p75: 0.05, p95: 0.11 },
        fcp: { p50: 760, p75: 1040, p95: 1620 },
        ttfb: { p50: 145, p75: 230, p95: 440 },
        count: 4210,
      },
      chart: dayPoints([1520, 1610, 1590, 1680, 1620, 1600, 1640]),
      metrics: [
        { name: '/', count: 1820, p50: 1090, p75: 1520, p95: 2310 },
        { name: '/pricing', count: 1190, p50: 1210, p75: 1690, p95: 2540 },
        { name: '/spring-launch', count: 840, p50: 1280, p75: 1760, p95: 2680 },
      ],
    };
    return json(perf);
  }
  if (/^websites\/([0-9a-f-]+)\/realtime$/i.test(fullPath) && method === 'GET') {
    const rt: RealtimeReport = {
      visitors: 14, pageviews: 42, events: 9,
      countries: [{ label: 'GB', value: 7 }, { label: 'US', value: 4 }, { label: 'DE', value: 3 }],
      urls: [{ label: '/', value: 18 }, { label: '/pricing', value: 14 }, { label: '/spring-launch', value: 10 }],
      referrers: [{ label: 'Direct', value: 21 }, { label: 'google.com', value: 13 }, { label: 'linkedin.com', value: 8 }],
      series: [{ label: '10m ago', value: 6 }, { label: '5m ago', value: 11 }, { label: 'Now', value: 14 }],
      recent: [{ type: 'pageview', path: '/pricing', eventName: null, country: 'GB', browser: 'Chrome', device: 'desktop', createdAt: new Date().toISOString() }],
    };
    return json(rt);
  }
  if (/^websites\/([0-9a-f-]+)\/sessions$/i.test(fullPath) && method === 'GET') {
    const items: WebsiteSession[] = [
      { id: '99999999-9999-4999-8999-999999999991', hostname: 'ovelio.example', browser: 'Chrome', os: 'macOS', device: 'desktop', screen: '1440x900', language: 'en-GB', country: 'GB', region: 'London', city: 'London', firstAt: daysAgo(2), lastAt: daysAgo(0), visits: 3, views: 9, events: 2 },
      { id: '99999999-9999-4999-8999-999999999992', hostname: 'ovelio.example', browser: 'Safari', os: 'iOS', device: 'mobile', screen: '390x844', language: 'en-US', country: 'US', region: 'California', city: 'San Francisco', firstAt: daysAgo(1), lastAt: daysAgo(0), visits: 1, views: 4, events: 1 },
    ];
    return json({ items, total: items.length, page: 1, limit: 25 } satisfies Page<WebsiteSession>);
  }
  if (/^websites\/([0-9a-f-]+)\/sessions\/stats$/i.test(fullPath) && method === 'GET') {
    return json({ pageviews: 11480, visitors: 4820, visits: 6190, countries: 24, events: 442 } satisfies SessionStats);
  }
  if (/^websites\/([0-9a-f-]+)\/sessions\/properties$/i.test(fullPath) && method === 'GET') {
    return json([{ propertyName: 'plan_interest', total: 318 }, { propertyName: 'ab_variant', total: 1240 }] satisfies SessionPropertyStat[]);
  }
  if (/^websites\/([0-9a-f-]+)\/sessions\/properties\/values$/i.test(fullPath) && method === 'GET') {
    return json([{ value: 'growth', total: 192 }, { value: 'enterprise', total: 126 }] satisfies EventPropertyValue[]);
  }
  if (/^websites\/([0-9a-f-]+)\/sessions\/weekly$/i.test(fullPath) && method === 'GET') {
    return json(Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => Math.max(0, Math.round(Math.sin((h - 6) / 4) * 20 + (d < 5 ? 18 : 8))))));
  }
  if (/^websites\/([0-9a-f-]+)\/sessions\/([0-9a-f-]+)\/activity$/i.test(fullPath) && method === 'GET') {
    const items: SessionActivityItem[] = [
      { id: randomUUID(), createdAt: daysAgo(0), urlPath: '/', urlQuery: null, referrerDomain: 'google.com', eventName: null, eventType: 1, pageTitle: 'OVELIO' },
      { id: randomUUID(), createdAt: daysAgo(0), urlPath: '/pricing', urlQuery: null, referrerDomain: null, eventName: 'signed_up', eventType: 2, pageTitle: 'Pricing' },
    ];
    return json(items);
  }
  if (/^websites\/([0-9a-f-]+)\/sessions\/([0-9a-f-]+)\/properties$/i.test(fullPath) && method === 'GET') {
    return json([{ propertyName: 'plan_interest', value: 'growth', dataType: 1 }] satisfies SessionPropertyEntry[]);
  }
  if (/^websites\/([0-9a-f-]+)\/events\/properties$/i.test(fullPath) && method === 'GET') {
    return json([{ eventName: 'signed_up', propertyName: 'plan', total: 142 }] satisfies EventPropertyStat[]);
  }
  if (/^websites\/([0-9a-f-]+)\/events\/values$/i.test(fullPath) && method === 'GET') {
    return json([{ value: 'Growth', total: 88 }, { value: 'Starter', total: 54 }] satisfies EventPropertyValue[]);
  }
  if (/^websites\/([0-9a-f-]+)\/funnel$/i.test(fullPath) && method === 'POST') {
    const body = await readJson<{ steps: { value: string }[] }>(request);
    return json((body.steps ?? []).map((st, i) => ({ label: st.value, visitors: Math.max(12, Math.round(1200 / (i + 1.6))) })));
  }
  if ((m = /^websites\/([0-9a-f-]+)\/funnels$/i.exec(fullPath))) {
    const wid = m[1];
    s.funnels[wid] ??= [];
    if (method === 'GET') return json(s.funnels[wid]);
    if (method === 'POST') {
      const body = await readJson<Omit<SavedFunnel, 'id'>>(request);
      const item: SavedFunnel = { id: randomUUID(), ...body };
      s.funnels[wid].push(item);
      return json(item, 201);
    }
  }
  if ((m = /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)$/i.exec(fullPath))) {
    const [wid, fid] = [m[1], m[2]];
    if (method === 'PATCH') { const item = (s.funnels[wid] ?? []).find(f => f.id === fid); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.funnels[wid] = (s.funnels[wid] ?? []).filter(f => f.id !== fid); return new Response(null, { status: 204 }); }
  }
  if ((m = /^websites\/([0-9a-f-]+)\/funnels\/([0-9a-f-]+)\/stats$/i.exec(fullPath)) && method === 'GET') {
    const funnel = (s.funnels[m[1]] ?? []).find(f => f.id === m![2]);
    return json((funnel?.steps ?? []).map((st, i) => ({ label: st.value, visitors: Math.max(18, Math.round(2400 / Math.pow(2.1, i))) })));
  }
  if ((m = /^websites\/([0-9a-f-]+)\/goals$/i.exec(fullPath))) {
    const wid = m[1];
    s.goals[wid] ??= [];
    if (method === 'GET') return json(s.goals[wid]);
    if (method === 'POST') {
      const body = await readJson<Omit<Goal, 'id'>>(request);
      const item: Goal = { id: randomUUID(), ...body };
      s.goals[wid].push(item);
      return json(item, 201);
    }
  }
  if ((m = /^websites\/([0-9a-f-]+)\/goals\/([0-9a-f-]+)$/i.exec(fullPath))) {
    const [wid, gid] = [m[1], m[2]];
    if (method === 'GET') return json({ total: 142, unique: 128 });
    if (method === 'PATCH') { const item = (s.goals[wid] ?? []).find(g => g.id === gid); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.goals[wid] = (s.goals[wid] ?? []).filter(g => g.id !== gid); return new Response(null, { status: 204 }); }
  }
  if (/^websites\/([0-9a-f-]+)\/retention$/i.test(fullPath) && method === 'GET') {
    return json([
      { date: daysAgo(7).slice(0, 10), day: 0, visitors: 420, returnVisitors: 420, percentage: 100 },
      { date: daysAgo(7).slice(0, 10), day: 1, visitors: 420, returnVisitors: 168, percentage: 40 },
      { date: daysAgo(7).slice(0, 10), day: 7, visitors: 420, returnVisitors: 92, percentage: 21.9 },
    ]);
  }
  if (/^websites\/([0-9a-f-]+)\/journeys$/i.test(fullPath) && method === 'GET') {
    return json([
      { items: ['/', '/pricing', 'signed_up'], count: 84 },
      { items: ['/spring-launch', '/pricing', 'signed_up'], count: 58 },
    ]);
  }
  if (/^websites\/([0-9a-f-]+)\/attribution$/i.test(fullPath) && method === 'GET') {
    return json({
      referrer: [{ label: 'google.com', value: 64 }, { label: 'linkedin.com', value: 28 }],
      paidAds: [{ label: 'google_ads', value: 18 }],
      utmSource: [{ label: 'newsletter', value: 52 }, { label: 'linkedin', value: 28 }],
      utmMedium: [{ label: 'email', value: 52 }, { label: 'social', value: 28 }],
      utmCampaign: [{ label: 'spring_dispatch', value: 44 }],
      utmContent: [{ label: 'hero_cta', value: 31 }],
      utmTerm: [],
      total: { pageviews: 412, visitors: 142, visits: 186 },
    });
  }
  if (/^websites\/([0-9a-f-]+)\/breakdown$/i.test(fullPath) && method === 'POST') {
    return json([
      { path: '/pricing', browser: 'Chrome', visitors: 840, views: 1210, visits: 980 },
      { path: '/spring-launch', browser: 'Safari', visitors: 410, views: 590, visits: 470 },
    ]);
  }
  if ((m = /^websites\/([0-9a-f-]+)\/annotations$/i.exec(fullPath))) {
    const wid = m[1];
    s.annotations[wid] ??= [];
    if (method === 'GET') return json(s.annotations[wid]);
    if (method === 'POST') {
      const body = await readJson<{ date: string; allDay?: boolean; note: string }>(request);
      const item: Annotation = { id: randomUUID(), date: body.date, allDay: body.allDay ?? true, note: body.note };
      s.annotations[wid].push(item);
      return json(item, 201);
    }
  }
  if ((m = /^websites\/([0-9a-f-]+)\/annotations\/([0-9a-f-]+)$/i.exec(fullPath)) && method === 'DELETE') {
    s.annotations[m[1]] = (s.annotations[m[1]] ?? []).filter(x => x.id !== m![2]);
    return new Response(null, { status: 204 });
  }

  if (fullPath === 'links') {
    if (method === 'GET') return json(s.links);
    if (method === 'POST') {
      const body = await readJson<{ name: string; url: string; slug?: string }>(request);
      const item: TrackedLink = { id: randomUUID(), name: body.name, url: body.url, slug: body.slug || 'link' + s.nextId++ + 'abcd', createdAt: new Date().toISOString() };
      s.links.push(item);
      return json(item, 201);
    }
  }
  if (fullPath === 'links/charts' && method === 'GET') {
    const ids = (query.get('ids') ?? '').split(',').filter(Boolean);
    const out: EntityChartSeries = {};
    for (const lid of ids) out[lid] = dayPoints([14, 22, 19, 31, 28, 36, 42]);
    return json(out);
  }
  if ((m = /^links\/([0-9a-f-]+)$/i.exec(fullPath))) {
    const id = m[1];
    if (method === 'PATCH') { const item = s.links.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.links = s.links.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }
  if (fullPath === 'pixels') {
    if (method === 'GET') return json(s.pixels);
    if (method === 'POST') {
      const body = await readJson<{ name: string; slug?: string }>(request);
      const item: TrackingPixel = { id: randomUUID(), name: body.name, slug: body.slug || 'px' + s.nextId++ + 'abcdef', createdAt: new Date().toISOString() };
      s.pixels.push(item);
      return json(item, 201);
    }
  }
  if (fullPath === 'pixels/charts' && method === 'GET') {
    const ids = (query.get('ids') ?? '').split(',').filter(Boolean);
    const out: EntityChartSeries = {};
    for (const pid of ids) out[pid] = dayPoints([48, 62, 55, 81, 74, 92, 108]);
    return json(out);
  }
  if ((m = /^pixels\/([0-9a-f-]+)$/i.exec(fullPath))) {
    const id = m[1];
    if (method === 'PATCH') { const item = s.pixels.find(x => x.id === id); if (!item) throw new AppError(404, 'Not found.'); Object.assign(item, await readJson(request)); return json(item); }
    if (method === 'DELETE') { s.pixels = s.pixels.filter(x => x.id !== id); return new Response(null, { status: 204 }); }
  }

  // Settings
  if (fullPath === 'settings') {
    const payload = (): Settings => ({
      company: s.company,
      sender: { fromEmail: 'hello@ovelio.example', provider: 'Preview sandbox', smtpHost: 'sandbox.local', configured: true, verifiedDomain: 'ovelio.example' },
      health: {
        audience: { status: 'ready', message: 'Interactive developer preview' },
        delivery: { status: 'ready', message: 'Interactive developer preview' },
        tracking: { status: 'ready', message: 'Interactive developer preview' },
        worker: { status: 'ready', message: 'Interactive developer preview' },
      },
      trackingOrigin: requestOrigin(request),
      team: s.team,
      failedJobs: [],
    });
    if (method === 'GET') return json(payload());
    if (method === 'PATCH') {
      const body = await readJson<{ company?: CompanySettings }>(request);
      if (body.company) s.company = { ...s.company, ...body.company };
      return json(payload());
    }
  }
  if (fullPath === 'settings/sender-domain' && method === 'GET') {
    return json({ domain: 'ovelio.example', selector: 'ovelio', spf: true, dkim: true, dmarc: true });
  }
  if (fullPath === 'settings/smtp/test' && method === 'POST') return json({ sent: true });
  if (fullPath === 'settings/maintenance' && method === 'POST') return json({ count: 0 });
  if (/^settings\/jobs\/(\d+)\/retry$/.test(fullPath) && method === 'POST') return json({ queued: true });
  if (fullPath === 'settings/team' && method === 'POST') {
    const body = await readJson<{ name: string; email: string; role: User['role'] }>(request);
    const created: User = { id: randomUUID(), name: body.name, email: body.email.toLowerCase(), role: body.role, disabled: false };
    s.team.push(created);
    return json(created, 201);
  }
  if ((m = /^settings\/team\/([0-9a-f-]+)$/i.exec(fullPath)) && method === 'PATCH') {
    const member = s.team.find(u => u.id === m![1]);
    if (!member) throw new AppError(404, 'Team account not found.');
    const body = await readJson<{ role?: User['role']; disabled?: boolean }>(request);
    if (body.role) member.role = body.role;
    if (typeof body.disabled === 'boolean') member.disabled = body.disabled;
    return json(member);
  }

  return json({ error: 'This action could not be found.' }, 404);
}
