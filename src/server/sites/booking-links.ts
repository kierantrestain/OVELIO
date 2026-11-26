import { bookingSlug } from '../calendar/booking';
import { AppError, appOrigin } from '../config';
import { db } from '../db';
import type { Sql } from '../db';
import { uuidPattern } from './data';
import { escapeHtml } from './render';

// Operates on sanitised page snapshots. The binding is on an anchor, not its child content.
const bookingAnchor = /<a\b([^>]*?\sdata-ovelio-booking="([^"]*)"[^>]*)>([\s\S]*?)<\/a>/g;
const bindingAttributes = /\s+(?:data-ovelio-booking|href|target|rel)="[^"]*"/gi;

function bindingIds(html: string) {
  return [...new Set([...html.matchAll(bookingAnchor)].map(match => match[2]))];
}

async function activeSlugs(ids: string[], client: Sql) {
  const valid = ids.filter(id => uuidPattern.test(id));
  if (!valid.length) return new Map<string, string>();
  const { rows } = await client.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM calendar_booking_types WHERE active AND id = ANY($1::uuid[])', [valid],
  );
  return new Map(rows.filter(row => bookingSlug.safeParse(row.slug).success).map(row => [row.id, row.slug]));
}

export async function assertBookingLinksLive(html: string, client: Sql) {
  const ids = bindingIds(html);
  if (!ids.length) return;
  if (ids.some(id => !uuidPattern.test(id))) throw new AppError(409, 'Choose a booking type for each booking button before publishing.');
  if ((await activeSlugs(ids, client)).size !== ids.length) {
    throw new AppError(409, 'A booking button uses an inactive or removed booking type. Choose an active type before publishing.');
  }
}

export async function hydrateBookingLinks(html: string, customDomain = false) {
  const ids = bindingIds(html);
  if (!ids.length) return html;
  const slugs = await activeSlugs(ids, db);
  const origin = customDomain && slugs.size && process.env.APP_ORIGIN ? appOrigin() : '';
  return html.replace(bookingAnchor, (_whole, attributes: string, id: string, label: string) => {
    const slug = slugs.get(id);
    if (!slug || (customDomain && !origin)) return '';
    const href = escapeHtml(`${origin}/book/${slug}`);
    return `<a href="${href}"${attributes.replace(bindingAttributes, '')}>${label}</a>`;
  });
}
