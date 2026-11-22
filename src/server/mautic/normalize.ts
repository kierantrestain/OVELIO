import type {
  Asset, Company, Contact, ContactNote, FormField, FormSubmission,
  LandingPage, PointAction, PointTrigger, PointTriggerEvent, Segment,
  SegmentFilter, Stage, Tag, Webhook, WorkflowContact,
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
  const rawFilter = entry.filter ?? record(entry.properties).filter;
  let filter: SegmentFilter['filter'] = '';
  if (Array.isArray(rawFilter)) {
    filter = rawFilter.map(String);
  } else if (typeof rawFilter === 'number' && Number.isFinite(rawFilter)) {
    filter = rawFilter;
  } else if (typeof rawFilter === 'string') {
    filter = rawFilter;
  }
  const object = entry.object === 'company' ? 'company' : entry.object === 'lead' ? 'lead' : undefined;
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
  return {
    id: requiredId(value.id),
    name: text(value.name),
    alias: text(value.alias),
    description: text(value.description),
    published: flag(value.isPublished),
    ...(filters !== undefined ? { filters } : {}),
    ...(value.isGlobal !== undefined ? { isGlobal: flag(value.isGlobal) } : {}),
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

export function toFormField(value: ApiRecord): FormField {
  const id = positiveId(value.id);
  const mappedField = text(value.mappedField);
  const props = record(value.properties);
  const rawList = record(props.list).list ?? props.list ?? record(props.optionlist).list ?? props.optionlist;
  const options = rawList && typeof rawList === 'object'
    ? Object.values(rawList)
        .map(entry => typeof entry === 'string' ? entry : text(record(entry).label) || text(record(entry).value))
        .filter(Boolean)
    : undefined;
  return {
    ...(id ? { id } : {}),
    label: text(value.label),
    alias: text(value.alias),
    type: text(value.type) || 'text',
    ...(mappedField ? { mappedField } : {}),
    isRequired: flag(value.isRequired),
    ...(options?.length ? { options } : {}),
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
