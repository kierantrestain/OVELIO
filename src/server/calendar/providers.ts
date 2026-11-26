import { z } from 'zod';
import type { CalendarProvider } from '@/contracts/calendar';

const googleScope = 'https://www.googleapis.com/auth/calendar.freebusy';
const googleWriteScope = 'https://www.googleapis.com/auth/calendar.events.owned';
const graphBase = 'https://graph.microsoft.com/v1.0/me/calendar';
const graphScope = 'https://graph.microsoft.com/Calendars.ReadBasic';
const graphWriteScope = 'https://graph.microsoft.com/Calendars.ReadWrite';
const googleFreeBusy = 'https://www.googleapis.com/calendar/v3/freeBusy';

export const calendarProvider = z.enum(['google', 'microsoft']);

export function calendarProviderConfig(provider: CalendarProvider, mirror = false) {
  if (provider === 'google') return {
    label: 'Google Calendar',
    clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: mirror ? `openid ${googleScope} ${googleWriteScope}` : googleScope,
    extra: { access_type: 'offline', prompt: 'consent select_account' },
  };
  const configured = process.env.MICROSOFT_TENANT_ID?.trim();
  // Graph getSchedule supports work and school accounts.
  const tenant = configured && /^[a-z\d.-]+$/i.test(configured)
    && !['common', 'consumers'].includes(configured.toLowerCase()) ? configured : 'organizations';
  const microsoft = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  return {
    label: 'Microsoft Calendar',
    clientId: process.env.MICROSOFT_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET?.trim() ?? '',
    authorize: microsoft + '/authorize',
    token: microsoft + '/token',
    scopes: `offline_access ${mirror ? graphWriteScope : graphScope}`,
    extra: { prompt: 'select_account', response_mode: 'query' },
  };
}

export class ProviderResponseError extends Error {
  constructor(readonly status: number) { super('The calendar provider declined the request.'); }
}

export function providerNeedsRefresh(error: unknown) {
  return error instanceof ProviderResponseError && error.status === 401;
}

export async function calendarProviderRequest(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new ProviderResponseError(response.status);
  return response;
}

async function providerJson(url: string, init: RequestInit) {
  return await (await calendarProviderRequest(url, init)).json() as unknown;
}

export async function calendarToken(provider: CalendarProvider, params: Record<string, string>, mirror = false) {
  const config = calendarProviderConfig(provider, mirror);
  if (!config.clientId || !config.clientSecret) throw new Error('Calendar OAuth is not configured.');
  const response = await providerJson(config.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      ...(provider === 'microsoft' ? { scope: config.scopes } : {}), ...params,
    }),
  });
  return z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.coerce.number().int().positive().max(86_400),
    scope: z.string().optional(),
  }).parse(response);
}

export async function primaryCalendar(provider: CalendarProvider, accessToken: string, mirror = false) {
  const headers = { Authorization: 'Bearer ' + accessToken };
  if (provider === 'google') {
    const identity = mirror ? z.object({ sub: z.string().min(1) }).parse(
      await providerJson('https://openidconnect.googleapis.com/v1/userinfo', { headers })).sub : null;
    return { ref: 'primary', identity };
  }
  const data = z.object({ id: z.string().min(1).optional(), owner: z.object({ address: z.email() }) }).parse(
    await providerJson(graphBase + (mirror ? '?$select=id,owner' : '?$select=owner'), { headers }));
  if (mirror && !data.id) throw new Error('The primary calendar could not be identified.');
  return { ref: data.owner.address.toLowerCase(), identity: data.id ?? null };
}

export function hasCalendarWriteScope(provider: CalendarProvider, scope = '') {
  const scopes = scope.toLowerCase().split(/\s+/);
  return provider === 'google' ? scopes.includes(googleWriteScope)
    : scopes.includes('calendars.readwrite') || scopes.includes(graphWriteScope.toLowerCase());
}

export type BusyInterval = { startsAt: number; blockedUntil: number };

function interval(start: string, end: string): BusyInterval {
  const startsAt = Date.parse(start);
  const blockedUntil = Date.parse(end);
  if (!Number.isFinite(startsAt) || !Number.isFinite(blockedUntil) || startsAt >= blockedUntil) {
    throw new Error('The calendar provider returned an invalid time interval.');
  }
  return { startsAt, blockedUntil };
}

const googleResult = z.object({
  calendars: z.record(z.string(), z.object({
    busy: z.array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) })),
    errors: z.array(z.unknown()).optional(),
  })),
});

const graphTime = z.object({ dateTime: z.iso.datetime({ local: true }), timeZone: z.literal('UTC') });
const graphResult = z.object({
  value: z.array(z.object({
    scheduleId: z.string(),
    error: z.unknown().optional(),
    scheduleItems: z.array(z.object({ start: graphTime, end: graphTime, status: z.string().min(1) })),
  })),
});

function utcValue(value: string) { return value.endsWith('Z') ? value : value + 'Z'; }

/** Fetches only the connected account's primary calendar and retains only time intervals. */
export async function providerBusy(provider: CalendarProvider, ref: string, token: string, start: number, end: number): Promise<BusyInterval[]> {
  const timeMin = new Date(start).toISOString();
  const timeMax = new Date(end).toISOString();
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  if (provider === 'google') {
    const data = googleResult.parse(await providerJson(googleFreeBusy, {
      method: 'POST', headers, body: JSON.stringify({ timeMin, timeMax, items: [{ id: ref }] }),
    }));
    const entries = Object.values(data.calendars);
    const primary = entries.length === 1 ? entries[0] : undefined;
    if (!primary || primary.errors?.length) throw new Error('Google Calendar availability is unavailable.');
    return primary.busy.map(entry => interval(entry.start, entry.end));
  }

  const data = graphResult.parse(await providerJson(graphBase + '/getSchedule', {
    method: 'POST',
    headers: { ...headers, Prefer: 'outlook.timezone="UTC"' },
    body: JSON.stringify({
      schedules: [ref],
      startTime: { dateTime: timeMin.slice(0, -1), timeZone: 'UTC' },
      endTime: { dateTime: timeMax.slice(0, -1), timeZone: 'UTC' },
      availabilityViewInterval: 15,
    }),
  }));
  const primary = data.value.length === 1 && data.value[0].scheduleId.toLowerCase() === ref ? data.value[0] : undefined;
  if (!primary || primary.error != null) throw new Error('Microsoft Calendar availability is unavailable.');
  return primary.scheduleItems.filter(entry => entry.status !== 'free')
    .map(entry => interval(utcValue(entry.start.dateTime), utcValue(entry.end.dateTime)));
}
