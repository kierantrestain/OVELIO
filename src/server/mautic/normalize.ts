import type { Contact, Segment } from '../../contracts';
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
    points: number(value.points ?? fields.points) ?? 0,
    createdAt: date(value.dateAdded),
    updatedAt: date(value.dateModified),
    tags: (Array.isArray(value.tags) ? value.tags : tags)
      .map(tag => text(record(tag).tag)).filter(Boolean),
    suppressed: Object.entries(entries).some(([channel, entry]) =>
      channel === 'email' || text(record(entry).channel) === 'email'),
  };
}

export function toSegment(value: ApiRecord): Segment {
  return {
    id: requiredId(value.id),
    name: text(value.name),
    alias: text(value.alias),
    description: text(value.description),
    published: flag(value.isPublished),
  };
}
