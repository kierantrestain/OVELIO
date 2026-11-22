// Shared request schemas and helpers for the console API route modules.
import { z } from 'zod';
import type { Role, User } from '@/contracts';
import { defaultRange } from '@/server/reporting';

export const name = z.string().trim().min(1).max(120);

export const description = z.string().trim().max(1000).optional();

export const subject = z.string().trim().min(1).max(160);

export const html = z.string().trim().min(1).max(160_000);

export const email = z.email().max(254);

export const numberId = z.coerce.number().int().min(1).max(2_147_483_647);

export const timestamp = z.coerce.number().int().min(0);

export const address = z.object({ email });

export const siteId = z.uuid();

export const url = z.url({ protocol: /^https?$/ }).max(500).or(z.literal(''));

export const requiredUrl = z.url({ protocol: /^https?$/ }).max(500);

export const company = z.object({
  name, website: url, accent: z.string().regex(/^#[0-9a-f]{6}$/i, 'Enter a six-digit hex colour.'),
  privacyUrl: url, postalAddress: z.string().trim().max(300),
});

export const reportDate = z.object({ startAt: timestamp, endAt: timestamp }).refine(
  values => values.endAt > values.startAt && values.endAt - values.startAt <= 366 * 86_400_000,
  'Choose a date range of up to one year.',
);

export type Context = {
  request: Request;
  user: User;
  params: string[];
  query: URLSearchParams;
};

export type Handler = (context: Context) => Promise<unknown>;

export type Entry = { method: string; path: RegExp; role: Role; handler: Handler };

export const route = (method: string, path: RegExp, handler: Handler, role: Role = 'analyst'): Entry => ({ method, path, role, handler });

export const id = (context: Context) => numberId.parse(context.params[0]);

export const page = (query: URLSearchParams) => z.coerce.number().int().min(1).max(100000).parse(query.get('page') ?? 1);

export const date = (query: URLSearchParams) => query.has('startAt') || query.has('endAt')
  ? reportDate.parse({ startAt: query.get('startAt') ?? undefined, endAt: query.get('endAt') ?? undefined })
  : defaultRange();
