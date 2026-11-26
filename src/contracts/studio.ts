// Email studio contracts (lane 2, docs/rebuild/TRACKER.md §3). Designs live in the shared `designs` table; the studio
// owns kinds 'email' (a whole email) and 'email_block' (a saved, reusable MJML fragment).

export type EmailDesignKind = 'email' | 'email_block';
export type DesignStatus = 'draft' | 'ready' | 'archived';

/** The cross-lane contract row (GET /api/console/studio/designs?kind=email) plus studio extras. */
export type DesignSummary = {
  id: string;
  name: string;
  subject: string;
  kind: EmailDesignKind;
  status: DesignStatus;
  updatedAt: string;
  preheader: string;
  category: string;
  templateKey: string | null;
  /** The brand kit the design uses; null means the workspace default. */
  brandId: string | null;
  version: number;
  createdAt: string;
  updatedBy: string | null;
};

export type CompileIssue = { line: number; message: string; tagName?: string };

export type Design = DesignSummary & {
  /** GrapesJS project data. Empty object until the editor first saves. */
  document: Record<string, unknown>;
  /** MJML (or, for a saved block, an MJML fragment of mj-section/mj-wrapper elements). */
  source: string;
  /** Compiled, sanitised HTML with OVELIO merge tags. */
  html: string;
  /** Engine records this design feeds (a Listmonk newsletter or transactional template). */
  links: DesignLink[];
};

export type DesignLink = { engine: 'listmonk_campaign' | 'listmonk_template' | 'mautic_email'; engineId: string; label: string; syncedAt: string | null };

export type DesignSaveResult = {
  design: DesignSummary;
  html: string;
  errors: CompileIssue[];
  /** Set when this save also stored an automatic version (at most one every 10 minutes of edits). */
  autoVersion: number | null;
};

export type DesignVersion = { version: number; label: string; createdAt: string; createdBy: string | null; automatic: boolean };

export type BrandSocial = { network: SocialNetwork; url: string };
export const socialNetworks = ['website', 'linkedin', 'instagram', 'facebook', 'x', 'youtube', 'tiktok'] as const;
export type SocialNetwork = (typeof socialNetworks)[number];

export type BrandKit = {
  name: string;
  logoUrl: string;
  /** Logo width in pixels inside the 600px email. */
  logoWidth: number;
  primary: string;
  accent: string;
  text: string;
  muted: string;
  background: string;
  surface: string;
  headingFont: string;
  bodyFont: string;
  website: string;
  footerText: string;
  social: BrandSocial[];
  /** Global button style: corner radius in px, and filled (brand colour) or outline. */
  buttonRadius: number;
  buttonStyle: 'filled' | 'outline';
  updatedAt: string | null;
};

export type BrandSummary = { id: string; name: string; isDefault: boolean; kit: BrandKit; updatedAt: string };

/** Email-safe font stacks offered by the brand kit (no web font downloads, so nothing is hotlinked). */
export const emailFonts: { value: string; label: string }[] = [
  { value: "'Helvetica Neue', Helvetica, Arial, sans-serif", label: 'Helvetica / Arial' },
  { value: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", label: 'System UI' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia (serif)' },
  { value: "'Trebuchet MS', Tahoma, sans-serif", label: 'Trebuchet' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", label: 'Palatino (serif)' },
  { value: "'Courier New', Courier, monospace", label: 'Courier (mono)' },
];

export const templateCategories = [
  'Newsletter', 'Announcement', 'Promotion', 'Welcome series', 'Event', 'B2B marketing', 'Product launch', 'Transactional',
] as const;
export type TemplateCategory = (typeof templateCategories)[number];

export type EmailTemplateSummary = {
  key: string;
  name: string;
  category: TemplateCategory;
  description: string;
  subject: string;
  preheader: string;
  /** Marketing templates carry an unsubscribe link and the postal address. */
  marketing: boolean;
  /** Factory output (src/templates/email/factory) is generated per industry and use case; the rest are hand-built. */
  source?: 'curated' | 'factory';
  industry?: string;
  useCase?: string;
};

export type SampleContact = { id: number; name: string; email: string; consent: string; suppressed: boolean };

export type RenderedPreview = { subject: string; preheader: string; html: string; contact: SampleContact | null; unknownTags: string[] };

export type TestSendResult = { to: string; messageId: string | null; status: 'sent' | 'failed' | 'blocked' | 'not_sent' | 'error'; reason: string };

export type SentMessage = {
  id: string;
  to: string;
  subject: string;
  status: 'sent' | 'failed' | 'blocked' | 'not_sent';
  reason: string;
  category: string;
  createdAt: string;
  sentAt: string | null;
  createdBy: string | null;
};

export type StoredMessage = SentMessage & { html: string; text: string; fromEmail: string; fromName: string };

export type EngineExport = {
  engine: 'listmonk' | 'mautic';
  html: string;
  subject: string;
  /** Tags OVELIO does not know (typos); they stay as written so a test shows them. */
  unknownTags: string[];
  /** Notes about tags the engine fills differently (fallbacks, optional attributes). */
  notes: string[];
};

export type AudienceList = {
  id: number;
  name: string;
  subscribers: number | null;
  eligible: number | null;
  excluded: number | null;
  optin: string;
};

export type AudienceEstimate = {
  lists: AudienceList[];
  /** Unique recipients across the chosen lists who will receive the email. */
  eligible: number | null;
  /** Unique subscribers left out: no recorded consent, unsubscribed, bounced or suppressed. */
  excluded: number | null;
  /** True when only the first part of a very large list was counted. */
  sampled: boolean;
  note: string;
};
