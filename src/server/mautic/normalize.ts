import type {
  Asset, Category, Company, Contact, ContactDevice, DncEntry, ContactLinkedCompany,
  ContactNote, CustomField, CustomFieldObject, DynamicContent, FocusItem,
  FormSubmission, LandingPage, MarketingReport, MarketingReportData,
  PointAction, PointTrigger, PointTriggerEvent, Segment, SegmentFilter, Stage,
  Tag, Webhook, WorkflowContact,
} from '../../contracts';
import { UpstreamError } from '../upstream';

export const service = 'audience';
export type ApiRecord = Record<string, unknown>;

export function record(value: unknown): ApiRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {};
}

export function item(value: unknown): ApiRecord {
  const result = record(value);
  if (!positiveId(result.id)) throw new UpstreamError(service, 502);
  return result;
}

export function items(value: unknown): ApiRecord[] {
  if (!value || typeof value !== 'object') throw new UpstreamError(service, 502);
  return Object.values(value).map(item);
}

export function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function number(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function positiveId(value: unknown) {
  const id = number(value);
  return id && id > 0 && Number.isSafeInteger(id) ? id : null;
}

export function requiredId(value: unknown) {
  const id = positiveId(value);
  if (!id) throw new UpstreamError(service, 400, 'Select a valid record.');
  return id;
}

export function flag(value: unknown) {
  return value === true || value === 1 || value === '1';
}

export function date(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function total(response: ApiRecord) {
  const count = number(response.total);
  if (count === null || count < 0 || !Number.isSafeInteger(count)) throw new UpstreamError(service, 502);
  return count;
}

export function published(value: ApiRecord) {
  const now = new Date().toISOString();
  const start = date(value.publishUp);
  const end = date(value.publishDown);
  return flag(value.isPublished) && (!start || start <= now) && (!end || end > now);
}

const coreContactKeys = new Set([
  'email', 'firstname', 'lastname', 'company', 'phone', 'position', 'city', 'country', 'website',
  'id', 'points', 'last_active', 'date_added', 'date_modified', 'date_identified',
]);

function customFieldValues(all: ApiRecord) {
  const values: Record<string, string> = {};
  for (const [alias, raw] of Object.entries(all)) {
    if (coreContactKeys.has(alias)) continue;
    const value = typeof raw === 'string' ? raw
      : typeof raw === 'number' ? String(raw)
        : typeof raw === 'boolean' ? (raw ? '1' : '0')
          : Array.isArray(raw) ? raw.filter(part => typeof part === 'string').join('|') : '';
    if (value.trim()) values[alias] = value;
  }
  return values;
}

// Mautic names its DNC reasons by code: 1 unsubscribed, 2 bounced, 3 manual (Entity/DoNotContact.php:17-32).
// A legacy response can key the collection by channel; the row's own channel wins when it has one.
export function toDncEntries(entries: unknown): DncEntry[] {
  if (!entries || typeof entries !== 'object') return [];
  return Object.entries(entries).map(([key, raw]) => {
    const entry = record(raw);
    const code = number(entry.reason);
    return {
      channel: text(entry.channel) || key,
      reason: code === 1 ? 'unsubscribed' as const : code === 2 ? 'bounced' as const : 'manual' as const,
      comment: text(entry.comments),
      at: date(entry.dateAdded),
    };
  });
}

export function toContact(value: ApiRecord): Contact {
  const fields = record(record(value.fields).all);
  const tags = Object.values(record(value.tags));
  const stage = record(value.stage);
  const entries = value.doNotContact;
  // A legacy response can serialize the collection as an object keyed by channel or ID.
  // A missing collection is a protocol failure because the record drives consent checks.
  if (!entries || typeof entries !== 'object') throw new UpstreamError(service, 502);
  return {
    id: requiredId(value.id),
    email: text(fields.email ?? value.email).trim().toLowerCase(),
    firstName: text(fields.firstname ?? value.firstname),
    lastName: text(fields.lastname ?? value.lastname),
    company: text(fields.company ?? value.company),
    phone: text(fields.phone ?? value.phone),
    position: text(fields.position ?? value.position),
    city: text(fields.city ?? value.city),
    country: text(fields.country ?? value.country),
    website: text(fields.website ?? value.website),
    stageId: positiveId(stage.id),
    stageName: text(stage.name) || null,
    points: number(value.points ?? fields.points) ?? 0,
    createdAt: date(value.dateAdded),
    updatedAt: date(value.dateModified),
    tags: (Array.isArray(value.tags) ? value.tags : tags)
      .map(tag => text(record(tag).tag)).filter(Boolean),
    suppressed: Object.entries(entries).some(([channel, entry]) =>
      channel === 'email' || text(record(entry).channel) === 'email'),
    dnc: toDncEntries(entries),
    customFields: customFieldValues(fields),
  };
}

export function toContactNote(value: ApiRecord): ContactNote {
  return {
    id: requiredId(value.id),
    text: text(value.text),
    type: text(value.type) || 'general',
    dateTime: date(value.dateTime ?? value.dateAdded),
  };
}

function toSegmentFilter(value: unknown): SegmentFilter | null {
  const entry = record(value);
  const field = text(entry.field);
  const operator = text(entry.operator);
  if (!field || !operator) return null;
  // Mautic keeps the value in `properties.filter`; older rows carry it at the top level (Controller/Api/ListApiController.php:71-95).
  const rawFilter = record(entry.properties).filter ?? entry.filter;
  let filter: SegmentFilter['filter'] = '';
  if (Array.isArray(rawFilter)) {
    filter = rawFilter.map(String);
  } else if (typeof rawFilter === 'number' && Number.isFinite(rawFilter)) {
    filter = rawFilter;
  } else if (typeof rawFilter === 'boolean') {
    filter = rawFilter ? 1 : 0;
  } else if (typeof rawFilter === 'string') {
    filter = rawFilter;
  } else if (rawFilter && typeof rawFilter === 'object') {
    // "In the last / next" rows store { interval, unit } (Segment/Decorator/ParseDateFilterValueTrait.php:25-31).
    const span = record(rawFilter);
    const interval = number(span.interval);
    const unit = span.unit === 'day' || span.unit === 'month' || span.unit === 'year' ? span.unit : null;
    if (interval && interval > 0 && unit) filter = { interval, unit };
  }
  const object = entry.object === 'company' ? 'company' : entry.object === 'behaviors' ? 'behaviors' : entry.object === 'lead' ? 'lead' : undefined;
  const type = text(entry.type);
  return {
    glue: entry.glue === 'or' ? 'or' : 'and',
    field,
    ...(object ? { object } : {}),
    ...(type ? { type } : {}),
    operator,
    filter,
  };
}

export function toSegment(value: ApiRecord): Segment {
  const filters = value.filters && typeof value.filters === 'object'
    ? Object.values(value.filters).map(toSegmentFilter).filter((entry): entry is SegmentFilter => entry !== null)
    : undefined;
  // Counts come from `?withCounts`; the build fields are not in the legacy REST serializer (LeadList.php:203-224),
  // so they stay null unless a newer engine adds them.
  const count = number(value.contactCount);
  const builtSeconds = number(value.lastBuiltTime);
  return {
    id: requiredId(value.id),
    name: text(value.name),
    alias: text(value.alias),
    description: text(value.description),
    published: flag(value.isPublished),
    ...(filters !== undefined ? { filters } : {}),
    ...(value.isGlobal !== undefined ? { isGlobal: flag(value.isGlobal) } : {}),
    ...(value.contactCount !== undefined ? { contactCount: count } : {}),
    ...(value.lastBuiltDate !== undefined ? { lastBuiltAt: date(value.lastBuiltDate) } : {}),
    ...(value.lastBuiltTime !== undefined ? { lastBuiltSeconds: builtSeconds } : {}),
  };
}

export function toTag(value: ApiRecord): Tag {
  return {
    id: requiredId(value.id),
    tag: text(value.tag),
    description: text(value.description),
  };
}

export function toStage(value: ApiRecord): Stage {
  return {
    id: requiredId(value.id),
    name: text(value.name),
    description: text(value.description),
    weight: number(value.weight) ?? 0,
    published: published(value),
  };
}

export function toCompany(value: ApiRecord): Company {
  const fields = record(record(value.fields).all);
  return {
    id: requiredId(value.id),
    name: text(fields.companyname ?? value.companyname ?? value.name),
    email: text(fields.companyemail ?? value.companyemail),
    website: text(fields.companywebsite ?? value.companywebsite),
    industry: text(fields.companyindustry ?? value.companyindustry),
    city: text(fields.companycity ?? value.companycity),
    country: text(fields.companycountry ?? value.companycountry),
    score: number(value.score ?? fields.score) ?? 0,
  };
}

export function toPointAction(value: ApiRecord): PointAction {
  return {
    id: requiredId(value.id),
    name: text(value.name),
    description: text(value.description),
    type: text(value.type),
    delta: number(value.delta) ?? 0,
    published: published(value),
    properties: value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)
      ? value.properties as Record<string, unknown> : {},
    repeatable: flag(value.repeatable),
    groupId: positiveId(value.group && typeof value.group === 'object' ? record(value.group).id : value.group),
    groupName: value.group && typeof value.group === 'object' ? text(record(value.group).name) || null : null,
  };
}

export function toPointTrigger(value: ApiRecord): PointTrigger {
  const events: PointTriggerEvent[] = value.events && typeof value.events === 'object'
    ? Object.values(value.events).map(entry => {
        const event = record(entry);
        const id = positiveId(event.id);
        const properties = event.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)
          ? event.properties as Record<string, unknown>
          : undefined;
        return {
          ...(id ? { id } : {}),
          name: text(event.name),
          type: text(event.type),
          ...(properties ? { properties } : {}),
        };
      })
    : [];
  return {
    id: requiredId(value.id),
    name: text(value.name),
    description: text(value.description),
    points: number(value.points) ?? 0,
    published: published(value),
    triggerExistingLeads: flag(value.triggerExistingLeads),
    events,
  };
}

export function toFormSubmission(value: ApiRecord, fallbackFormId: number): FormSubmission {
  const rawResults = record(value.results);
  const results: Record<string, string> = {};
  for (const [key, entry] of Object.entries(rawResults)) {
    if (entry === null || entry === undefined) continue;
    results[key] = Array.isArray(entry) ? entry.map(String).join(', ') : String(entry);
  }
  return {
    id: requiredId(value.id),
    formId: positiveId(record(value.form).id) ?? positiveId(value.formId) ?? fallbackFormId,
    contactId: positiveId(record(value.lead).id) ?? positiveId(value.contactId),
    dateSubmitted: date(value.dateSubmitted),
    results,
  };
}

export function toWorkflowContact(value: ApiRecord): WorkflowContact {
  return {
    contactId: requiredId(value.lead_id ?? value.leadId ?? value.contactId ?? value.id),
    dateAdded: date(value.date_added ?? value.dateAdded),
    manuallyRemoved: flag(value.manually_removed ?? value.manuallyRemoved),
  };
}

export function toAsset(value: ApiRecord): Asset {
  const downloadUrl = text(value.downloadUrl);
  return {
    id: requiredId(value.id),
    title: text(value.title),
    alias: text(value.alias),
    description: text(value.description),
    storageLocation: text(value.storageLocation) || 'local',
    remotePath: text(value.remotePath),
    downloadCount: number(value.downloadCount) ?? 0,
    uniqueDownloadCount: number(value.uniqueDownloadCount) ?? 0,
    published: published(value),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
}

export function toLandingPage(value: ApiRecord): LandingPage {
  return {
    id: requiredId(value.id),
    title: text(value.title),
    alias: text(value.alias),
    metaDescription: text(value.metaDescription),
    customHtml: text(value.customHtml),
    hits: number(value.hits) ?? 0,
    uniqueHits: number(value.uniqueHits) ?? 0,
    published: published(value),
  };
}

export function toWebhook(value: ApiRecord): Webhook {
  const triggers = value.triggers && typeof value.triggers === 'object'
    ? Object.values(value.triggers).map(text).filter(Boolean)
    : [];
  return {
    id: requiredId(value.id),
    name: text(value.name),
    description: text(value.description),
    webhookUrl: text(value.webhookUrl),
    triggers,
    published: published(value),
  };
}

export function normalizeColor(value: unknown): string {
  const cleaned = text(value).trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(cleaned) ? `#${cleaned}` : '';
}

export function toCustomField(value: ApiRecord, fallbackObject: CustomFieldObject = 'contact'): CustomField {
  const props = record(value.properties);
  const rawList = props.list;
  const options = rawList && typeof rawList === 'object'
    ? Object.values(rawList)
        .map(entry => typeof entry === 'string' ? entry : text(record(entry).label) || text(record(entry).value))
        .filter(Boolean)
    : [];
  const rawObject = text(value.object);
  const object: CustomFieldObject = rawObject === 'company'
    ? 'company'
    : rawObject === 'contact' || rawObject === 'lead'
      ? 'contact'
      : fallbackObject;
  const rawDefault = value.defaultValue;
  const defaultValue = typeof rawDefault === 'string'
    ? rawDefault
    : typeof rawDefault === 'number' || typeof rawDefault === 'boolean'
      ? String(rawDefault)
      : '';
  return {
    id: requiredId(value.id),
    label: text(value.label),
    alias: text(value.alias),
    type: text(value.type) || 'text',
    group: text(value.group) || 'core',
    object,
    defaultValue,
    isRequired: flag(value.isRequired),
    isPubliclyUpdatable: flag(value.isPubliclyUpdatable),
    isFixed: flag(value.isFixed),
    published: flag(value.isPublished),
    options,
  };
}

export function toCategory(value: ApiRecord): Category {
  return {
    id: requiredId(value.id),
    title: text(value.title),
    alias: text(value.alias),
    description: text(value.description),
    color: normalizeColor(value.color),
    bundle: text(value.bundle),
    published: flag(value.isPublished),
  };
}

export function toDynamicContent(value: ApiRecord): DynamicContent {
  return {
    id: requiredId(value.id),
    name: text(value.name),
    slotName: text(value.slotName),
    content: text(value.content),
    isCampaignBased: flag(value.isCampaignBased),
    published: published(value),
    sentCount: number(value.sentCount) ?? 0,
    dateAdded: date(value.dateAdded),
  };
}

export function toFocusItem(value: ApiRecord, origin = ''): FocusItem {
  const id = requiredId(value.id);
  const props = record(value.properties);
  const content = record(props.content);
  const colors = record(props.colors);
  const base = origin.replace(/\/+$/, '');
  return {
    id,
    name: text(value.name),
    description: text(value.description),
    type: text(value.type) || 'notice',
    style: text(value.style) || 'bar',
    headline: text(content.headline),
    tagline: text(content.tagline),
    linkText: text(content.link_text),
    linkUrl: text(content.link_url),
    formId: positiveId(value.form) ?? positiveId(record(value.form).id),
    primaryColor: normalizeColor(colors.primary) || '#2457d6',
    textColor: normalizeColor(colors.text) || '#111827',
    buttonColor: normalizeColor(colors.button) || '#2457d6',
    buttonTextColor: normalizeColor(colors.button_text) || '#ffffff',
    when: text(props.when) || 'immediately',
    published: published(value),
    embedScript: `<script src="${base}/focus/${id}.js" type="text/javascript" charset="utf-8" async="async"></script>`,
  };
}

export function toMarketingReport(value: ApiRecord): MarketingReport {
  const columns = value.columns && typeof value.columns === 'object'
    ? Object.values(value.columns).map(text).filter(Boolean)
    : [];
  return {
    id: requiredId(value.id),
    name: text(value.name),
    description: text(value.description),
    source: text(value.source),
    columns,
    system: flag(value.system),
  };
}

function toReportCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
}

export function toMarketingReportData(response: ApiRecord, id: number, meta?: MarketingReport): MarketingReportData {
  const rawData = response.data;
  if (rawData !== undefined && (rawData === null || typeof rawData !== 'object')) {
    throw new UpstreamError(service, 502);
  }
  const rawRows = Array.isArray(rawData)
    ? rawData.map(record)
    : rawData
      ? Object.values(rawData).map(record)
      : [];
  const rows = rawRows.map(row => {
    const normalized: Record<string, string | number | null> = {};
    for (const [key, cell] of Object.entries(row)) {
      normalized[key] = toReportCell(cell);
    }
    return normalized;
  });
  const dataColumns = response.dataColumns && typeof response.dataColumns === 'object'
    ? Object.values(response.dataColumns).map(text).filter(Boolean)
    : [];
  const rowColumns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        rowColumns.push(key);
      }
    }
  }
  const columns = rowColumns.length ? rowColumns : dataColumns.length ? dataColumns : (meta?.columns ?? []);
  const report: MarketingReport = meta ?? {
    id,
    name: `Report #${id}`,
    description: '',
    source: '',
    columns,
    system: false,
  };
  return {
    report,
    totalResults: number(response.totalResults) ?? rows.length,
    columns,
    rows,
  };
}

export function toContactLinkedCompany(value: ApiRecord): ContactLinkedCompany {
  const id = positiveId(value.id ?? value.company_id);
  if (!id) throw new UpstreamError(service, 502);
  const fields = record(record(value.fields).all);
  return {
    id,
    name: text(value.companyname ?? value.name ?? fields.companyname),
    isPrimary: flag(value.is_primary ?? value.isPrimary),
  };
}

export function toContactDevice(value: ApiRecord): ContactDevice {
  const osObj = record(value.deviceOs);
  const osName = text(value.deviceOsName ?? value.device_os_name ?? osObj.name);
  const osVersion = text(value.deviceOsVersion ?? value.device_os_version ?? osObj.version);
  const os = text(value.os) || [osName, osVersion].filter(Boolean).join(' ');
  const brand = text(value.deviceBrand ?? value.device_brand ?? value.brand ?? value.deviceModel ?? value.device_model);
  return {
    id: requiredId(value.id),
    device: text(value.device),
    os,
    brand,
    dateAdded: date(value.dateAdded ?? value.date_added),
  };
}
