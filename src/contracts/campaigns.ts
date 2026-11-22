/* ── Newsletters, Lists, Templates, Media & Bounces (Listmonk) ─────────────── */

export type MailingList = {
  id: number;
  name: string;
  description?: string;
  type?: 'private' | 'public' | string;
  optin?: 'single' | 'double' | string;
  subscriberCount: number | null;
  tags: string[];
};

export type MailingListInput = {
  name: string;
  description?: string;
  type?: 'private' | 'public';
  optin?: 'single' | 'double';
  tags?: string[];
};

export type Subscriber = {
  id: number;
  email: string;
  name?: string;
  blocked: boolean;
  lists: { id: number; status: 'unconfirmed' | 'confirmed' | 'unsubscribed' | string }[];
};

export type SubscriberInput = {
  email: string;
  name: string;
  mauticId: number;
  lists: number[];
};

export type Template = {
  id: number;
  name: string;
  body: string;
  type?: 'campaign' | 'tx' | string;
  subject?: string;
  isDefault?: boolean;
};

export type TemplateInput = {
  name: string;
  body: string;
  type?: 'campaign' | 'tx';
  subject?: string;
};

export type CampaignMetrics = {
  sent: number | null;
  delivered: number | null;
  opens: number | null;
  clicks: number | null;
  bounces: number | null;
  unsubscribes: number | null;
  /** Why a null metric cannot be counted yet. Shown instead of a blank or a zero. */
  unavailable?: Partial<Record<'delivered' | 'unsubscribes', string>>;
};

export type CampaignInput = {
  name: string;
  subject: string;
  body: string;
  altBody?: string;
  contentType?: 'html' | 'richtext' | 'markdown' | 'plain';
  tags?: string[];
  listIds: number[];
  fromEmail?: string;
  templateId?: number;
  archive?: boolean;
};

export type CampaignArchiveInput = {
  archive: boolean;
  archiveSlug?: string;
};

export type Campaign = CampaignInput & {
  id: number;
  /** Listmonk's public campaign identifier, used in unsubscribe links. */
  uuid?: string;
  status: string;
  sendAt: string | null;
  createdAt: string | null;
  toSend?: number | null;
  archiveSlug?: string;
  metrics: CampaignMetrics;
};

export type RunningCampaignStat = {
  id: number;
  status: string;
  toSend: number;
  sent: number;
  rate: number;
  netRate: number;
  startedAt: string | null;
};

export type CampaignLinkStat = {
  url: string;
  count: number;
};

export type MediaItem = {
  id: number;
  uuid: string;
  filename: string;
  contentType: string;
  url: string;
  thumbUrl: string | null;
  createdAt: string | null;
};

export type BounceRecord = {
  id: number;
  email: string;
  subscriberId: number;
  type: 'hard' | 'soft' | 'complaint' | string;
  source: string;
  campaignName: string | null;
  createdAt: string | null;
};

export type TransactionalEmailInput = {
  email: string;
  templateId: number;
  subject?: string;
  data?: Record<string, unknown>;
};

export type MaintenanceResult = {
  count: number;
};

/** What a pre-send segment refresh did, shown after a newsletter starts. */
export type SegmentSyncReport = {
  /** `deferred`: the segment was too large to refresh inline, so it started from its last sync and refreshes in the background. */
  segments: { segmentId: number; name: string; members: number; removed: number; deferred?: boolean }[];
};

export type CampaignStartResult = Campaign & { segmentSync?: SegmentSyncReport };
