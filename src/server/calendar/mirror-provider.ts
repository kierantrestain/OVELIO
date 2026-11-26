import { z } from 'zod';
import { calendarMirrorRequest } from './connections';
import type { MirrorDestination } from './connections';
import { ProviderResponseError } from './providers';

export type MirrorLocator = MirrorDestination & { id: string; remoteId: string | null };
type EventTimes = { start: Date; end: Date };
type ProviderCopy = { id: string; etag: string };

const googleEvents = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const graphEvents = 'https://graph.microsoft.com/v1.0/me/events';
const graphKey = 'String {06d33fb5-f86d-4854-89bd-5e3a16139e62} Name OvelioAppointmentMirror';
const title = 'OVELIO appointment';
const graphHeaders = { Prefer: 'IdType="ImmutableId"' };
const googleId = (mirror: MirrorLocator) => 'ov' + mirror.id.replaceAll('-', '');
const googleEventUrl = (id: string) => `${googleEvents}/${encodeURIComponent(id)}`;
const graphEventUrl = (id: string) => `${graphEvents}/${encodeURIComponent(id)}`;
const graphTime = (date: Date) => ({ dateTime: date.toISOString().slice(0, -1), timeZone: 'UTC' });

const eventId = z.object({ id: z.string().min(1) });
const graphProperty = z.object({ id: z.string(), value: z.string() });
const graphCopy = eventId.extend({
  '@odata.etag': z.string().min(1),
  attendees: z.array(z.unknown()),
  singleValueExtendedProperties: z.array(graphProperty).optional(),
});
const googleCopy = eventId.extend({
  etag: z.string().optional(),
  status: z.string().optional(),
  attendees: z.array(z.unknown()).optional(),
  attendeesOmitted: z.boolean().optional(),
  extendedProperties: z.object({ private: z.object({ ovelioMirror: z.string().optional() }).optional() }).optional(),
});

function absent(error: unknown) {
  return error instanceof ProviderResponseError && (error.status === 404 || error.status === 410);
}

async function findGoogle(mirror: MirrorLocator): Promise<ProviderCopy | null> {
  try {
    const response = await calendarMirrorRequest(mirror, googleEventUrl(googleId(mirror))
      + '?fields=id,etag,status,attendees,attendeesOmitted,extendedProperties', {});
    const event = googleCopy.parse(await response.json());
    if (event.status === 'cancelled') return null;
    if (!event.etag || event.id !== googleId(mirror) || event.extendedProperties?.private?.ovelioMirror !== mirror.id
      || event.attendees?.length || event.attendeesOmitted) {
      throw new Error('A modified Google Calendar appointment copy requires attention.');
    }
    return { id: event.id, etag: event.etag };
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
}

async function locateGraphId(mirror: MirrorLocator) {
  if (mirror.remoteId) return mirror.remoteId;
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${graphKey}' and ep/value eq '${mirror.id}')`;
  const query = new URLSearchParams({ '$filter': filter, '$select': 'id' });
  const response = await calendarMirrorRequest(mirror, graphEvents + '?' + query, { headers: graphHeaders });
  const { value, '@odata.nextLink': next } = z.object({ value: z.array(eventId), '@odata.nextLink': z.string().optional() })
    .parse(await response.json());
  if (next || value.length > 1) throw new Error('Multiple Microsoft Calendar copies matched this appointment.');
  return value[0]?.id ?? null;
}

async function findGraph(mirror: MirrorLocator): Promise<ProviderCopy | null> {
  const id = await locateGraphId(mirror);
  if (!id) return null;
  try {
    const query = new URLSearchParams({
      '$select': 'id,attendees', '$expand': `singleValueExtendedProperties($filter=id eq '${graphKey}')`,
    });
    const response = await calendarMirrorRequest(mirror, graphEventUrl(id) + '?' + query, { headers: graphHeaders });
    const event = graphCopy.parse(await response.json());
    if (event.id !== id || event.attendees.length
      || !event.singleValueExtendedProperties?.some(property => property.id === graphKey && property.value === mirror.id)) {
      throw new Error('A modified Microsoft Calendar appointment copy requires attention.');
    }
    return { id: event.id, etag: event['@odata.etag'] };
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
}

export function findProviderCopy(mirror: MirrorLocator) {
  return mirror.provider === 'google' ? findGoogle(mirror) : findGraph(mirror);
}

export async function createProviderCopy(mirror: MirrorLocator, times: EventTimes) {
  const google = mirror.provider === 'google';
  const body = google ? {
    id: googleId(mirror), summary: title, start: { dateTime: times.start.toISOString() }, end: { dateTime: times.end.toISOString() },
    transparency: 'opaque', visibility: 'private', reminders: { useDefault: false }, extendedProperties: { private: { ovelioMirror: mirror.id } },
  } : {
    subject: title, start: graphTime(times.start), end: graphTime(times.end), showAs: 'busy', sensitivity: 'private', isReminderOn: false,
    transactionId: mirror.id, singleValueExtendedProperties: [{ id: graphKey, value: mirror.id }],
  };
  const response = await calendarMirrorRequest(mirror, google ? googleEvents + '?sendUpdates=none' : graphEvents, {
    method: 'POST', headers: { ...(!google ? graphHeaders : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return eventId.parse(await response.json()).id;
}

export async function updateProviderCopy(mirror: MirrorLocator, copy: ProviderCopy, times: EventTimes) {
  const google = mirror.provider === 'google';
  const body = google ? {
    start: { dateTime: times.start.toISOString() }, end: { dateTime: times.end.toISOString() }, transparency: 'opaque',
  } : { start: graphTime(times.start), end: graphTime(times.end), showAs: 'busy' };
  await calendarMirrorRequest(mirror, google ? googleEventUrl(copy.id) + '?sendUpdates=none' : graphEventUrl(copy.id), {
    method: 'PATCH', body: JSON.stringify(body), headers: {
      ...(!google ? graphHeaders : {}), 'Content-Type': 'application/json', 'If-Match': copy.etag,
    },
  });
}

export async function deleteProviderCopy(mirror: MirrorLocator, copy: ProviderCopy) {
  const google = mirror.provider === 'google';
  try {
    await calendarMirrorRequest(mirror, google ? googleEventUrl(copy.id) + '?sendUpdates=none' : graphEventUrl(copy.id), {
      method: 'DELETE', headers: { ...(!google ? graphHeaders : {}), 'If-Match': copy.etag },
    });
  } catch (error) {
    if (!absent(error)) throw error;
  }
}
