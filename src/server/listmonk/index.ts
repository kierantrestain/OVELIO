import { readFileSync } from 'node:fs';
import type {
  BounceRecord, Campaign, CampaignArchiveInput, CampaignInput, CampaignLinkStat, DateRange, Health, MailingList,
  MailingListInput, MaintenanceResult, MediaItem, Page, Point, RunningCampaignStat, Subscriber, SubscriberActivity,
  SubscriberBounce, SubscriberInput, Template, TemplateInput, TransactionalEmailInput,
} from '../../contracts';
import { basic, upstream, upstreamResponse, UpstreamError } from '../upstream';

const service = 'delivery';
const footer = '<!-- ovelio:unsubscribe --><p style="font-size:12px"><a href="{{ UnsubscribeURL }}">Unsubscribe</a></p><!-- /ovelio:unsubscribe -->';
const plainFooter = '\n\nUnsubscribe: {{ UnsubscribeURL }}';
const pixel = '<!-- ovelio:open -->{{ TrackView }}<!-- /ovelio:open -->';
const contentSlot = '{{ template "content" . }}';
const hasUnsubscribe = /href\s*=\s*["']\s*{{\s*UnsubscribeURL\b/i;
const hasPlainUnsubscribe = /{{\s*UnsubscribeURL\b/;
const hasOpenTracking = /{{\s*TrackView\b/;
const links = /(<a\b[^>]*?\shref\s*=\s*)(["'])(https?:\/\/[^"'<>\s{}]+)\2/gi;
const contentTypes = new Set<string>(['html', 'richtext', 'markdown', 'plain']);
const analyticsExportTypes = new Set(['views', 'clicks']);
const analyticsCleanupTypes = new Set(['all', 'views', 'clicks']);
const subscriberCleanupTypes = new Set(['orphan', 'blocklisted']);
const emailKey = (email: string) => email.trim().toLowerCase();

type Options = { url?: string; username?: string; password?: string; passwordFile?: string; fetch?: typeof fetch };
type Pagination = { page?: number; limit?: number };
type CampaignContentType = NonNullable<CampaignInput['contentType']>;
type NativePage<T> = { results?: T[] | null; total?: number; page?: number; per_page?: number };
type NativeList = {
  id: number;
  name: string;
  description?: string | null;
  type?: string;
  optin?: string;
  subscriber_count?: number;
  tags?: string[] | null;
  subscription_status?: string;
};
type NativeSubscriber = {
  id: number;
  email: string;
  name: string;
  status: string;
  attribs?: Record<string, unknown> | null;
  lists?: NativeList[] | null;
};
type NativeCampaign = {
  id: number;
  name: string;
  subject: string;
  body: string;
  altbody?: string | null;
  status: string;
  type?: string;
  from_email?: string;
  template_id?: number | null;
  content_type?: string;
  tags?: string[] | null;
  archive?: boolean;
  archive_slug?: string | null;
  messenger?: string;
  send_at?: string | null;
  created_at?: string | null;
  to_send?: number;
  sent?: number;
  views?: number;
  clicks?: number;
  bounces?: number;
  lists?: { id: number; name: string }[] | null;
};
type NativeRunningStat = {
  id: number;
  status: string;
  to_send?: number;
  sent?: number;
  rate?: number;
  net_rate?: number;
  started_at?: string | null;
};
type NativeTemplate = {
  id: number;
  name: string;
  type: string;
  subject?: string;
  body?: string;
  is_default?: boolean;
};
type NativeMedia = {
  id: number;
  uuid: string;
  filename: string;
  content_type?: string;
  url: string;
  thumb_url?: string | null;
  created_at?: string | null;
};
type NativeBounce = {
  id: number;
  email: string;
  subscriber_id?: number;
  type?: string;
  source?: string;
  campaign?: { id?: number; name?: string } | null;
  created_at?: string | null;
};
type NativeSubscriberView = {
  campaign_id?: number | string | null;
  campaign_name?: string | null;
  created_at?: string | null;
};
type NativeSubscriberClick = {
  campaign_id?: number | string | null;
  campaign_name?: string | null;
  url?: string | null;
  created_at?: string | null;
};
type NativeSubscriberActivity = {
  campaign_views?: NativeSubscriberView[] | null;
  link_clicks?: NativeSubscriberClick[] | null;
};
type NativeSubscriberBounce = {
  id?: number | string | null;
  type?: string | null;
  source?: string | null;
  campaign?: { id?: number | string | null; name?: string | null } | null;
  created_at?: string | null;
};
type NativeSettings = Record<string, unknown> & {
  smtp?: Array<Record<string, unknown>>;
  'privacy.disable_tracking'?: boolean;
  'bounce.enabled'?: boolean;
};
type DeliveryOptions = {
  smtpHost: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromEmail: string;
  publicUrl: string;
  tls?: 'none' | 'STARTTLS' | 'TLS';
  force?: boolean;
};

function listFromNative(list: NativeList): MailingList {
  return {
    id: list.id,
    name: list.name,
    description: list.description ?? '',
    type: list.type,
    optin: list.optin,
    tags: list.tags ?? [],
    subscriberCount: list.subscriber_count ?? null,
  };
}

function listPayload(input: MailingListInput) {
  return {
    name: input.name,
    description: input.description ?? '',
    type: input.type ?? 'private',
    optin: input.optin ?? 'double',
    tags: input.tags ?? [],
  };
}

function subscriberFromNative(subscriber: NativeSubscriber): Subscriber {
  return {
    id: subscriber.id,
    email: subscriber.email,
    blocked: subscriber.status === 'blocklisted',
    lists: (subscriber.lists ?? []).map((list) => ({ id: list.id, status: list.subscription_status ?? 'unknown' })),
  };
}

function removedAdditions(body: string) {
  return body
    .replace(footer, '')
    .replace(pixel, '')
    .replace(plainFooter, '')
    .replace(links, (_match, before: string, quote: string, url: string) =>
      before + quote + url.replace(/@TrackLink$/, '') + quote);
}

function beforeBodyClose(body: string, addition: string) {
  if (!addition) return body;
  const closingTag = /<\/body\s*>/i;
  if (closingTag.test(body)) return body.replace(closingTag, (closing) => addition + closing);
  return body + addition;
}

function emailBody(body: string, outerTemplate = '', trackLinks = true) {
  const tracked = trackLinks
    ? body.replace(links, (_match, before: string, quote: string, url: string) =>
      before + quote + (url.endsWith('@TrackLink') ? url : url.replace(/&amp;|&#38;/gi, '&') + '@TrackLink') + quote)
    : body;
  const unsubscribe = hasUnsubscribe.test(tracked + outerTemplate) ? '' : footer;
  const open = hasOpenTracking.test(tracked + outerTemplate) ? '' : pixel;
  return beforeBodyClose(tracked, unsubscribe + open);
}

function normalizeContentType(value?: string | null): CampaignContentType | undefined {
  return value && contentTypes.has(value) ? value as CampaignContentType : undefined;
}

function templatePayload(input: TemplateInput) {
  const type = input.type ?? 'campaign';
  if (type === 'tx') {
    return {
      name: input.name,
      type: 'tx' as const,
      subject: input.subject ?? '',
      body: input.body,
    };
  }
  const body = /{{\s*template\s+"content"\s+\.\s*}}/.test(input.body)
    ? input.body
    : beforeBodyClose(input.body, contentSlot);
  return {
    name: input.name,
    type: 'campaign' as const,
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    body: emailBody(body),
  };
}

function templateFromNative(template: NativeTemplate, fallbackBody = ''): Template {
  return {
    id: template.id,
    name: template.name,
    body: removedAdditions(template.body ?? fallbackBody),
    type: template.type,
    subject: template.subject || undefined,
    isDefault: Boolean(template.is_default),
  };
}

function mediaFromNative(item: NativeMedia): MediaItem {
  return {
    id: item.id,
    uuid: item.uuid,
    filename: item.filename,
    contentType: item.content_type ?? 'application/octet-stream',
    url: item.url,
    thumbUrl: item.thumb_url || null,
    createdAt: item.created_at ?? null,
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function bounceFromNative(bounce: NativeBounce): BounceRecord {
  return {
    id: bounce.id,
    email: bounce.email,
    subscriberId: bounce.subscriber_id ?? 0,
    type: bounce.type ?? 'hard',
    source: bounce.source ?? '',
    campaignName: bounce.campaign?.name || null,
    createdAt: bounce.created_at ?? null,
  };
}

function subscriberActivityFromNative(raw: NativeSubscriberActivity | null | undefined): SubscriberActivity {
  const data = raw && typeof raw === 'object' ? raw : {};
  const views = Array.isArray(data.campaign_views)
    ? data.campaign_views
      .filter((item): item is NativeSubscriberView => item !== null && typeof item === 'object')
      .map((item) => ({
        campaignId: num(item.campaign_id),
        campaignName: str(item.campaign_name),
        at: str(item.created_at),
      }))
    : [];
  const clicks = Array.isArray(data.link_clicks)
    ? data.link_clicks
      .filter((item): item is NativeSubscriberClick => item !== null && typeof item === 'object')
      .map((item) => ({
        campaignId: num(item.campaign_id),
        campaignName: str(item.campaign_name),
        url: str(item.url),
        at: str(item.created_at),
      }))
    : [];
  return { views, clicks };
}

function subscriberBounceFromNative(bounce: NativeSubscriberBounce): SubscriberBounce {
  const parsedCampaignId = num(bounce.campaign?.id);
  return {
    id: num(bounce.id),
    type: str(bounce.type) || 'hard',
    source: str(bounce.source),
    campaignId: parsedCampaignId > 0 ? parsedCampaignId : null,
    campaignName: str(bounce.campaign?.name) || null,
    createdAt: str(bounce.created_at) || null,
  };
}

function withPagination(options: Pagination) {
  return new URLSearchParams({ page: String(options.page ?? 1), per_page: String(options.limit ?? 30) });
}

function safeId(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new UpstreamError(service, 400, 'Choose a valid item.');
  return id;
}

function mappedPage<Raw, Result>(data: NativePage<Raw>, options: Pagination, map: (raw: Raw) => Result): Page<Result> {
  return {
    items: (data.results ?? []).map(map),
    total: data.total ?? 0,
    page: data.page || options.page || 1,
    limit: data.per_page || options.limit || 30,
  };
}

function trackedCount(count: number | undefined, tracked: boolean) {
  if (count === undefined || (!tracked && count === 0)) return null;
  return count;
}

function campaignFromNative(campaign: NativeCampaign, settings: NativeSettings = {}): Campaign {
  const tracking = settings['privacy.disable_tracking'] === false;
  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    body: removedAdditions(campaign.body ?? ''),
    altBody: campaign.altbody || undefined,
    contentType: normalizeContentType(campaign.content_type),
    tags: campaign.tags ?? [],
    archive: Boolean(campaign.archive),
    archiveSlug: str(campaign.archive_slug) || undefined,
    status: campaign.status,
    sendAt: campaign.send_at ?? null,
    createdAt: campaign.created_at ?? null,
    toSend: campaign.to_send ?? null,
    listIds: (campaign.lists ?? []).filter((list) => list.id > 0).map((list) => list.id),
    fromEmail: campaign.from_email || undefined,
    templateId: campaign.template_id || undefined,
    metrics: {
      sent: campaign.sent ?? null,
      delivered: null,
      opens: trackedCount(campaign.views, tracking),
      clicks: trackedCount(campaign.clicks, tracking),
      bounces: trackedCount(campaign.bounces, settings['bounce.enabled'] === true),
      unsubscribes: null,
    },
  };
}

function isStatus(error: unknown, ...statuses: number[]) {
  return error instanceof UpstreamError && statuses.includes(error.status);
}

// The settings API replaces passwords with bullets when reading and keeps existing secrets
// when a masked value is omitted on a subsequent settings write.
function clearMaskedSecrets(value: unknown): unknown {
  if (typeof value === 'string') return /^•+$/.test(value) ? '' : value;
  if (Array.isArray(value)) return value.map(clearMaskedSecrets);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clearMaskedSecrets(item)]));
  }
  return value;
}

export function createListmonk(options: Options) {
  const { fetch: transport } = options;
  let password = options.password;

  function auth() {
    if (!password && options.passwordFile) {
      try {
        password = readFileSync(options.passwordFile, 'utf8').trim();
      } catch {
        throw new UpstreamError(service, 503, 'Check the delivery engine setup and credential file.');
      }
    }
    if (!options.url || !options.username || !password) {
      throw new UpstreamError(service, 503, 'Configure the email delivery connection.');
    }
    return { Authorization: basic(options.username, password) };
  }

  async function request<T>(path: string, method = 'GET', body?: unknown) {
    const result = await upstream<{ data: T }>(service, options.url ?? '', path, {
      fetch: transport,
      headers: auth(),
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!result || !Object.hasOwn(result, 'data')) throw new UpstreamError(service, 502);
    return result.data;
  }

  const settings = () => request<NativeSettings>('/api/settings');
  const metricSettings = () => settings().catch((): NativeSettings => ({}));
  const nativeTemplates = () => request<NativeTemplate[] | null>('/api/templates');
  const nativeCampaign = (id: number) => request<NativeCampaign>(`/api/campaigns/${safeId(id)}`);
  const nativeSubscriber = (id: number) => request<NativeSubscriber>(`/api/subscribers/${safeId(id)}`);

  async function findNativeSubscriber(email: string) {
    const address = emailKey(email);
    const limit = 50;
    // Search uses Listmonk's parameterized text search. Match the normalized email exactly.
    for (let page = 1; ; page++) {
      const query = withPagination({ page, limit });
      query.set('search', address);
      const result = await request<NativePage<NativeSubscriber>>(`/api/subscribers?${query}`);
      const matches = result.results ?? [];
      const subscriber = matches.find((entry) => emailKey(entry.email) === address);
      if (subscriber) return subscriber;
      if (matches.length < limit || page * limit >= (result.total ?? 0)) return null;
    }
  }

  async function campaignPayload(input: CampaignInput) {
    const existing = await nativeTemplates() ?? [];
    const template = input.templateId
      ? existing.find((item) => item.id === input.templateId && item.type === 'campaign')
      : existing.find((item) => item.is_default && item.type === 'campaign');
    if (input.templateId && !template) throw new UpstreamError(service, 400, 'Choose an available newsletter template.');
    const contentType = input.contentType ?? 'html';
    const body = contentType === 'html' || contentType === 'richtext'
      ? emailBody(input.body, template?.body)
      : contentType === 'plain'
        ? (hasPlainUnsubscribe.test(input.body) ? input.body : input.body + plainFooter)
        : input.body;
    return {
      name: input.name,
      subject: input.subject,
      body,
      ...(input.altBody !== undefined ? { altbody: input.altBody } : {}),
      lists: input.listIds.map(safeId),
      from_email: input.fromEmail ?? '',
      template_id: template?.id ?? null,
      content_type: contentType,
      tags: input.tags ?? [],
      archive: Boolean(input.archive),
      type: 'regular',
      messenger: 'email',
    };
  }

  async function setCampaignStatus(id: number, status: 'draft' | 'running' | 'scheduled' | 'paused' | 'cancelled') {
    return request<NativeCampaign>(`/api/campaigns/${safeId(id)}/status`, 'PUT', { status });
  }

  async function getCampaign(id: number): Promise<Campaign> {
    const [campaign, metrics] = await Promise.all([nativeCampaign(id), metricSettings()]);
    return campaignFromNative(campaign, metrics);
  }

  return {
    async health(): Promise<Health> {
      try {
        await request<boolean>('/api/health');
        return { status: 'ready' };
      } catch (error) {
        const message = isStatus(error, 401, 403)
          ? 'Check the delivery API account and credentials.'
          : 'Check the delivery engine URL and service status.';
        return { status: 'unavailable', message };
      }
    },

    async lists(): Promise<MailingList[]> {
      const all: MailingList[] = [];
      const limit = 100;
      for (let page = 1; ; page++) {
        const query = withPagination({ page, limit });
        const data = await request<NativePage<NativeList>>(`/api/lists?${query}`);
        const rows = data.results ?? [];
        all.push(...rows.map(listFromNative));
        if (rows.length < limit || all.length >= (data.total ?? 0)) return all;
      }
    },

    async createList(input: MailingListInput): Promise<MailingList> {
      return listFromNative(await request<NativeList>('/api/lists', 'POST', listPayload(input)));
    },

    async updateList(id: number, input: MailingListInput): Promise<MailingList> {
      return listFromNative(await request<NativeList>(`/api/lists/${safeId(id)}`, 'PUT', listPayload(input)));
    },

    async deleteList(id: number): Promise<void> {
      await request<boolean>(`/api/lists/${safeId(id)}`, 'DELETE');
    },

    async subscriber(id: number): Promise<Subscriber | null> {
      try {
        return subscriberFromNative(await nativeSubscriber(id));
      } catch (error) {
        // This pinned release reports a missing subscriber ID as HTTP 400.
        if (isStatus(error, 400, 404) && Number.isSafeInteger(id) && id > 0) return null;
        throw error;
      }
    },

    async findSubscriber(email: string): Promise<Subscriber | null> {
      const subscriber = await findNativeSubscriber(email);
      return subscriber ? subscriberFromNative(subscriber) : null;
    },

    async upsertSubscriber(input: SubscriberInput, knownId?: number): Promise<Subscriber> {
      const email = emailKey(input.email);
      let existing: NativeSubscriber | null = null;
      if (knownId !== undefined) {
        try {
          existing = await nativeSubscriber(knownId);
        } catch (error) {
          if (!isStatus(error, 400, 404) || !Number.isSafeInteger(knownId) || knownId < 1) throw error;
        }
      }
      existing ??= await findNativeSubscriber(email);
      const lists = [...new Set(input.lists)].map(safeId);
      const name = input.name.trim();
      const profile = { email, name, attribs: { mautic_id: input.mauticId }, preconfirm_subscriptions: true };
      if (!existing) {
        try {
          return subscriberFromNative(await request<NativeSubscriber>('/api/subscribers', 'POST', { ...profile, lists }));
        } catch (error) {
          if (!isStatus(error, 409)) throw error;
          existing = await findNativeSubscriber(email);
          if (!existing) throw error;
        }
      }

      const id = existing.id;
      const linkedId = existing.attribs?.mautic_id;
      if (linkedId !== undefined && String(linkedId) !== String(input.mauticId)) {
        throw new UpstreamError(service, 409, 'This address already belongs to a different contact.');
      }
      const current = subscriberFromNative(existing);
      if (current.blocked || current.lists.some((list) => list.status === 'unsubscribed')) return current;
      const allLists = [...new Set([...current.lists.map((list) => list.id), ...lists])];
      if (email === emailKey(existing.email) && (!name || name === existing.name) && linkedId === input.mauticId &&
          lists.every((id) => current.lists.some((list) => list.id === id && list.status === 'confirmed'))) {
        return current;
      }

      // PUT with status omitted preserves a concurrent block. Including all existing list IDs
      // preserves unsubscribed rows through Listmonk's native subscription update.
      return subscriberFromNative(await request<NativeSubscriber>(`/api/subscribers/${id}`, 'PUT', {
        ...profile, lists: allLists, attribs: { ...existing.attribs, mautic_id: input.mauticId },
      }));
    },

    async removeSubscriberFromLists(id: number, listIds: number[]) {
      if (!listIds.length) return;
      const subscriber = await nativeSubscriber(id);
      const removable = (subscriber.lists ?? [])
        .filter((list) => listIds.includes(list.id) && list.subscription_status !== 'unsubscribed')
        .map((list) => list.id);
      if (!removable.length) return;
      await request<boolean>('/api/subscribers/lists', 'PUT', {
        ids: [safeId(id)], action: 'remove', target_list_ids: removable,
      });
    },

    async blockSubscriber(id: number) {
      await request<boolean>(`/api/subscribers/${safeId(id)}/blocklist`, 'PUT');
    },

    async deleteSubscriber(id: number) {
      await request<boolean>(`/api/subscribers/${safeId(id)}`, 'DELETE');
    },

    async resendOptin(subscriberId: number): Promise<void> {
      await request<boolean>(`/api/subscribers/${safeId(subscriberId)}/optin`, 'POST');
    },

    async subscriberActivity(subscriberId: number): Promise<SubscriberActivity> {
      const data = await request<NativeSubscriberActivity | null>(`/api/subscribers/${safeId(subscriberId)}/activity`);
      return subscriberActivityFromNative(data);
    },

    async subscriberBounces(subscriberId: number): Promise<SubscriberBounce[]> {
      const data = await request<NativeSubscriberBounce[] | NativePage<NativeSubscriberBounce> | null>(
        `/api/subscribers/${safeId(subscriberId)}/bounces`,
      );
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : []);
      return rows
        .filter((item): item is NativeSubscriberBounce => item !== null && typeof item === 'object')
        .map(subscriberBounceFromNative);
    },

    async deleteSubscriberBounces(subscriberId: number): Promise<void> {
      try {
        await request<boolean>(`/api/subscribers/${safeId(subscriberId)}/bounces`, 'DELETE');
      } catch (error) {
        if (isStatus(error, 404)) return;
        throw error;
      }
    },

    async ensureTestSubscriber(email: string): Promise<Subscriber> {
      const address = emailKey(email);
      const existing = await findNativeSubscriber(address);
      if (existing) return subscriberFromNative(existing);
      try {
        return subscriberFromNative(await request<NativeSubscriber>('/api/subscribers', 'POST', {
          email: address, name: 'Newsletter test recipient', lists: [],
        }));
      } catch (error) {
        if (!isStatus(error, 409)) throw error;
        const subscriber = await findNativeSubscriber(address);
        if (!subscriber) throw error;
        return subscriberFromNative(subscriber);
      }
    },

    async campaigns(options: Pagination & { status?: string[]; query?: string } = {}): Promise<Page<Campaign>> {
      const query = withPagination(options);
      for (const status of options.status ?? []) query.append('status', status);
      if (options.query?.trim()) query.set('query', options.query.trim());
      const [data, metrics] = await Promise.all([
        request<NativePage<NativeCampaign>>(`/api/campaigns?${query}`), metricSettings(),
      ]);
      return mappedPage(data, options, (campaign) => campaignFromNative(campaign, metrics));
    },

    /** Removes the untouched sample draft that a fresh newsletter-engine install seeds. Idempotent. */
    async removeInstallSample(): Promise<boolean> {
      const data = await request<NativePage<NativeCampaign>>('/api/campaigns?status=draft&per_page=50');
      const sample = data.results?.find(item => item.name === 'Test campaign' && /^Welcome to listmonk$/i.test(item.subject));
      if (!sample) return false;
      await request(`/api/campaigns/${safeId(sample.id)}`, 'DELETE');
      return true;
    },

    async campaign(id: number): Promise<Campaign> {
      return getCampaign(id);
    },

    async createCampaign(input: CampaignInput): Promise<Campaign> {
      const payload = await campaignPayload(input);
      return campaignFromNative(await request<NativeCampaign>('/api/campaigns', 'POST', payload));
    },

    async updateCampaign(id: number, input: CampaignInput): Promise<Campaign> {
      const payload = await campaignPayload(input);
      return campaignFromNative(await request<NativeCampaign>(`/api/campaigns/${safeId(id)}`, 'PUT', payload));
    },

    async updateCampaignArchive(id: number, input: CampaignArchiveInput): Promise<Campaign> {
      const campaignId = safeId(id);
      await request<unknown>(`/api/campaigns/${campaignId}/archive`, 'PUT', {
        archive: input.archive,
        ...(input.archiveSlug !== undefined ? { archive_slug: input.archiveSlug } : {}),
      });
      return getCampaign(campaignId);
    },

    async deleteCampaign(id: number): Promise<void> {
      await request<boolean>(`/api/campaigns/${safeId(id)}`, 'DELETE');
    },

    async scheduleCampaign(id: number, sendAt: string): Promise<Campaign> {
      const when = new Date(sendAt);
      if (!Number.isFinite(when.valueOf()) || when.valueOf() <= Date.now()) {
        throw new UpstreamError(service, 400, 'Choose a future send time.');
      }
      const current = await nativeCampaign(id);
      if (current.status !== 'draft' && current.status !== 'paused' && current.status !== 'scheduled') {
        throw new UpstreamError(service, 409, 'Only a draft, paused, or scheduled newsletter can be scheduled.');
      }
      await request<NativeCampaign>(`/api/campaigns/${id}`, 'PUT', {
        lists: (current.lists ?? []).filter((list) => list.id > 0).map((list) => list.id),
        send_at: when.toISOString(),
      });
      if (current.status === 'scheduled') return campaignFromNative(await nativeCampaign(id));
      return campaignFromNative(await setCampaignStatus(id, 'scheduled'));
    },

    async startCampaign(id: number): Promise<Campaign> {
      return campaignFromNative(await setCampaignStatus(id, 'running'));
    },

    async pauseCampaign(id: number): Promise<Campaign> {
      return campaignFromNative(await setCampaignStatus(id, 'paused'));
    },

    async cancelSchedule(id: number): Promise<Campaign> {
      return campaignFromNative(await setCampaignStatus(id, 'draft'));
    },

    async cancelCampaign(id: number): Promise<Campaign> {
      return campaignFromNative(await setCampaignStatus(id, 'cancelled'));
    },

    async cloneCampaign(id: number, name?: string): Promise<Campaign> {
      const current = await nativeCampaign(id);
      const cloneName = name?.trim() || `${current.name} (Copy)`;
      return campaignFromNative(await request<NativeCampaign>('/api/campaigns', 'POST', {
        name: cloneName,
        subject: current.subject,
        body: current.body,
        ...(current.altbody ? { altbody: current.altbody } : {}),
        lists: (current.lists ?? []).filter((list) => list.id > 0).map((list) => list.id),
        from_email: current.from_email ?? '',
        template_id: current.template_id ?? null,
        content_type: current.content_type ?? 'html',
        tags: current.tags ?? [],
        archive: Boolean(current.archive),
        type: current.type ?? 'regular',
        messenger: current.messenger ?? 'email',
      }));
    },

    async runningCampaignStats(): Promise<RunningCampaignStat[]> {
      const rows = await request<NativeRunningStat[] | null>('/api/campaigns/running/stats');
      return (rows ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        toSend: row.to_send ?? 0,
        sent: row.sent ?? 0,
        rate: row.rate ?? 0,
        netRate: row.net_rate ?? 0,
        startedAt: row.started_at ?? null,
      }));
    },

    async testCampaign(id: number, email: string) {
      const [campaign, subscriber] = await Promise.all([nativeCampaign(id), findNativeSubscriber(email)]);
      if (!subscriber) throw new UpstreamError(service, 400, 'Choose a test recipient in your audience.');
      if (subscriber.status === 'blocklisted' || subscriber.lists?.some((list) => list.subscription_status === 'unsubscribed')) {
        throw new UpstreamError(service, 409, 'This contact has opted out of email.');
      }
      const query = new URLSearchParams();
      if (campaign.template_id) query.set('template_id', String(campaign.template_id));
      await request<boolean>(`/api/campaigns/${id}/test?${query}`, 'POST', {
        name: campaign.name,
        subject: campaign.subject,
        body: campaign.body,
        from_email: campaign.from_email ?? '',
        content_type: campaign.content_type ?? 'html',
        messenger: 'email',
        template_id: campaign.template_id,
        lists: (campaign.lists ?? []).filter((list) => list.id > 0).map((list) => list.id),
        subscribers: [subscriber.email],
      });
    },

    async previewCampaign(id: number): Promise<string> {
      const response = await upstreamResponse(service, options.url ?? '', `/api/campaigns/${safeId(id)}/preview`, {
        headers: { ...auth(), Accept: 'text/html, text/plain' }, fetch: transport,
      });
      return response.text();
    },

    async templates(options?: boolean | { type?: 'campaign' | 'tx' | 'all' }): Promise<Template[]> {
      const mode = typeof options === 'boolean' ? (options ? 'all' : 'campaign') : (options?.type ?? 'campaign');
      return (await nativeTemplates() ?? [])
        .filter((template) => mode === 'all' || template.type === mode)
        .map((template) => templateFromNative(template));
    },

    async allTemplates(): Promise<Template[]> {
      return (await nativeTemplates() ?? []).map((template) => templateFromNative(template));
    },

    async createTemplate(input: TemplateInput): Promise<Template> {
      const payload = templatePayload(input);
      const out = await request<NativeTemplate>('/api/templates', 'POST', payload);
      return templateFromNative(out, payload.body);
    },

    async updateTemplate(id: number, input: TemplateInput): Promise<Template> {
      const payload = templatePayload(input);
      const out = await request<NativeTemplate>(`/api/templates/${safeId(id)}`, 'PUT', payload);
      return templateFromNative(out, payload.body);
    },

    async deleteTemplate(id: number): Promise<void> {
      await request<boolean>(`/api/templates/${safeId(id)}`, 'DELETE');
    },

    async setDefaultTemplate(id: number): Promise<void> {
      await request<unknown>(`/api/templates/${safeId(id)}/default`, 'PUT');
    },

    async previewTemplate(id: number): Promise<string> {
      const response = await upstreamResponse(service, options.url ?? '', `/api/templates/${safeId(id)}/preview`, {
        headers: { ...auth(), Accept: 'text/html, text/plain' },
        fetch: transport,
      });
      return response.text();
    },

    async previewTemplateBody(body: string, type: 'campaign' | 'tx' = 'campaign'): Promise<string> {
      const response = await upstreamResponse(service, options.url ?? '', '/api/templates/preview', {
        method: 'POST',
        headers: { ...auth(), Accept: 'text/html, text/plain' },
        body: JSON.stringify({ body, template_type: type }),
        fetch: transport,
      });
      return response.text();
    },

    async media(): Promise<MediaItem[]> {
      const data = await request<NativeMedia[] | NativePage<NativeMedia> | null>('/api/media');
      if (!data) return [];
      const items = Array.isArray(data) ? data : (data.results ?? []);
      return items.map(mediaFromNative);
    },

    async uploadMedia(filename: string, contentType: string, bytes: Uint8Array): Promise<MediaItem> {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
      const response = await upstreamResponse(service, options.url ?? '', '/api/media', {
        method: 'POST',
        headers: auth(),
        body: form,
        fetch: transport,
      });
      let result: { data?: NativeMedia };
      try {
        result = await response.json() as { data?: NativeMedia };
      } catch {
        throw new UpstreamError(service, 502);
      }
      if (!result || !Object.hasOwn(result, 'data') || !result.data) throw new UpstreamError(service, 502);
      return mediaFromNative(result.data);
    },

    async deleteMedia(id: number): Promise<void> {
      await request<boolean>(`/api/media/${safeId(id)}`, 'DELETE');
    },

    async bounces(options: Pagination & { campaignId?: number } = {}): Promise<Page<BounceRecord>> {
      const query = withPagination(options);
      if (options.campaignId !== undefined) query.set('campaign_id', String(safeId(options.campaignId)));
      const data = await request<NativePage<NativeBounce>>(`/api/bounces?${query}`);
      return mappedPage(data, options, bounceFromNative);
    },

    async deleteBounce(id: number): Promise<void> {
      await request<boolean>(`/api/bounces/${safeId(id)}`, 'DELETE');
    },

    async blocklistBounced(ids: number[]): Promise<void> {
      if (!ids.length) return;
      await request<boolean>('/api/bounces/blocklist', 'PUT', { ids: ids.map(safeId) });
    },

    async sendTransactional(input: TransactionalEmailInput & { fromEmail: string }): Promise<void> {
      const email = emailKey(input.email);
      if (!email) throw new UpstreamError(service, 400, 'Enter a valid recipient email address.');
      await request<boolean>('/api/tx', 'POST', {
        subscriber_email: email,
        template_id: safeId(input.templateId),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        from_email: input.fromEmail,
        data: input.data ?? {},
        content_type: 'html',
        messenger: 'email',
      });
    },

    async campaignTrend(ids: number[], range: DateRange, metric: 'views' | 'clicks' | 'bounces' = 'views'): Promise<Point[] | null> {
      const flags = await metricSettings();
      if (metric === 'bounces' ? flags['bounce.enabled'] !== true : flags['privacy.disable_tracking'] !== false) return null;
      const counts = new Map<string, number>();
      const from = new Date(range.startAt).toISOString();
      const to = new Date(range.endAt).toISOString();
      // Batch native date-bucketed counts to keep URLs short on long-running installations.
      for (let offset = 0; offset < ids.length; offset += 100) {
        const query = new URLSearchParams({ from, to });
        for (const id of ids.slice(offset, offset + 100)) query.append('id', String(safeId(id)));
        const rows = await request<Array<{ timestamp: string; count: number }>>(`/api/campaigns/analytics/${metric}?${query}`);
        for (const { timestamp, count } of rows) counts.set(timestamp, (counts.get(timestamp) ?? 0) + count);
      }
      return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
    },

    async campaignLinks(ids: number[], range: DateRange): Promise<CampaignLinkStat[]> {
      if (!ids.length) return [];
      const flags = await metricSettings();
      if (flags['privacy.disable_tracking'] !== false) return [];
      const counts = new Map<string, number>();
      const from = new Date(range.startAt).toISOString();
      const to = new Date(range.endAt).toISOString();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const query = new URLSearchParams({ from, to });
        for (const id of ids.slice(offset, offset + 100)) query.append('id', String(safeId(id)));
        const rows = await request<Array<{ url: string; count: number }> | null>(`/api/campaigns/analytics/links?${query}`);
        for (const { url, count } of rows ?? []) counts.set(url, (counts.get(url) ?? 0) + count);
      }
      return [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([url, count]) => ({ url, count }));
    },

    async exportCampaignAnalytics(
      type: 'views' | 'clicks',
      _ids: number[],
      range: DateRange,
    ): Promise<string> {
      if (!analyticsExportTypes.has(type)) {
        throw new UpstreamError(service, 400, 'Choose a valid analytics export type.');
      }
      const query = new URLSearchParams({
        since: new Date(range.startAt).toISOString(),
      });
      const response = await upstreamResponse(service, options.url ?? '', `/api/maintenance/analytics/${type}/export?${query}`, {
        headers: { ...auth(), Accept: 'text/csv, text/plain' },
        fetch: transport,
      });
      return response.text();
    },

    async configureDelivery(input: DeliveryOptions): Promise<{ changed: boolean; needsRestart: boolean }> {
      const existing = await settings();
      const current = existing.smtp?.find((entry) => entry.name === 'email-ovelio');
      const publicUrl = input.publicUrl.replace(/\/$/, '');
      const tlsType = input.tls ?? 'none';
      // Go's PLAIN client requires TLS for non-loopback hosts. The private SMTP gateway also accepts LOGIN.
      const authProtocol = input.smtpUser ? (tlsType === 'none' ? 'login' : 'plain') : 'none';
      const bounceActions = {
        soft: { count: 2, action: 'none' },
        hard: { count: 1, action: 'blocklist' },
        complaint: { count: 1, action: 'blocklist' },
      };
      const smtp = {
        name: 'email-ovelio',
        ...(current?.uuid ? { uuid: current.uuid } : {}),
        enabled: true,
        host: input.smtpHost,
        port: input.smtpPort,
        username: input.smtpUser ?? '',
        password: input.smtpPassword ?? '',
        auth_protocol: authProtocol,
        tls_type: tlsType,
        tls_skip_verify: false,
        hello_hostname: '',
        max_conns: 4,
        max_msg_retries: 0,
        idle_timeout: '15s',
        wait_timeout: '10s',
        msg_retry_delay: '1s',
        email_headers: [],
        from_addresses: [],
      };
      const configuredBounceActions = existing['bounce.actions'] as Partial<typeof bounceActions> | undefined;
      const bounceConfigured = Object.entries(bounceActions).every(([name, { count, action }]) => {
        const saved = configuredBounceActions?.[name as keyof typeof bounceActions];
        return saved?.count === count && saved.action === action;
      });
      const applied = existing.smtp?.length === 1 && current?.enabled === true &&
        current.host === smtp.host && current.port === smtp.port && current.username === smtp.username &&
        current.tls_type === smtp.tls_type && current.auth_protocol === smtp.auth_protocol &&
        existing['app.root_url'] === publicUrl && existing['app.from_email'] === input.fromEmail &&
        existing['privacy.unsubscribe_header'] === true && existing['bounce.enabled'] === true &&
        existing['privacy.allow_blocklist'] === true && existing['privacy.allow_preferences'] === false &&
        existing['bounce.webhooks_enabled'] === true && bounceConfigured;
      if (applied && !input.force) return { changed: false, needsRestart: false };

      const preserved = clearMaskedSecrets(existing) as NativeSettings;
      const result = await request<true | { needs_restart?: boolean }>('/api/settings', 'PUT', {
        ...preserved,
        smtp: [smtp],
        'app.site_name': 'OVELIO',
        'app.root_url': publicUrl,
        'app.from_email': input.fromEmail,
        'app.check_updates': false,
        'app.enable_public_subscription_page': false,
        'privacy.unsubscribe_header': true,
        'privacy.allow_blocklist': true,
        'privacy.allow_preferences': false,
        'privacy.allow_wipe': false,
        'privacy.allow_export': false,
        'bounce.enabled': true,
        'bounce.webhooks_enabled': true,
        'bounce.actions': bounceActions,
      });
      return { changed: true, needsRestart: result !== true && result.needs_restart === true };
    },

    async testSmtp(toEmail: string, smtpPassword?: string): Promise<void> {
      const target = emailKey(toEmail);
      if (!target) throw new UpstreamError(service, 400, 'Enter a recipient email address for the SMTP test.');
      const existing = await settings();
      const entry = existing.smtp?.find((item) => item.name === 'email-ovelio')
        ?? existing.smtp?.find((item) => item.enabled === true);
      if (!entry) throw new UpstreamError(service, 400, 'Configure an SMTP server before testing delivery.');
      const sanitized = clearMaskedSecrets(entry) as Record<string, unknown>;
      await request<unknown>('/api/settings/smtp/test', 'POST', {
        ...sanitized,
        ...(smtpPassword ? { password: smtpPassword } : {}),
        email: target,
      });
    },

    async cleanupSubscribers(type: 'orphan' | 'blocklisted'): Promise<MaintenanceResult> {
      if (!subscriberCleanupTypes.has(type)) {
        throw new UpstreamError(service, 400, 'Choose a valid subscriber cleanup type.');
      }
      const data = await request<{ count?: number } | null>(`/api/maintenance/subscribers/${type}`, 'DELETE');
      return { count: data?.count ?? 0 };
    },

    async cleanupUnconfirmed(beforeDate?: string): Promise<MaintenanceResult> {
      const when = beforeDate ? new Date(beforeDate) : new Date();
      if (!Number.isFinite(when.valueOf())) {
        throw new UpstreamError(service, 400, 'Choose a valid cutoff date.');
      }
      const query = new URLSearchParams({ before_date: when.toISOString() });
      const data = await request<{ count?: number } | null>(`/api/maintenance/subscriptions/unconfirmed?${query}`, 'DELETE');
      return { count: data?.count ?? 0 };
    },

    async cleanupAnalytics(type: 'all' | 'views' | 'clicks', beforeDate: string): Promise<void> {
      if (!analyticsCleanupTypes.has(type)) {
        throw new UpstreamError(service, 400, 'Choose a valid analytics cleanup type.');
      }
      const when = new Date(beforeDate);
      if (!Number.isFinite(when.valueOf())) {
        throw new UpstreamError(service, 400, 'Choose a valid cutoff date.');
      }
      const query = new URLSearchParams({ before_date: when.toISOString() });
      await request<boolean>(`/api/maintenance/analytics/${type}?${query}`, 'DELETE');
    },
  };
}

export const listmonk = createListmonk({
  url: process.env.LISTMONK_URL,
  username: process.env.LISTMONK_USERNAME,
  password: process.env.LISTMONK_PASSWORD,
  passwordFile: process.env.LISTMONK_PASSWORD_FILE,
});
