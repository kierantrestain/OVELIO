// Module-level helpers shared by the Mautic adapter modules.
import type {
  CompanyInput, Contact, ContactInput, CustomField, CustomFieldObject, DateRange, FocusItemInput, JourneyEmail,
  ContactSortKey, SegmentFilter,
} from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, number, published, requiredId, service, text, type ApiRecord } from './normalize';

export type Config = { url?: string; username?: string; password?: string; fetch?: typeof fetch };

export type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'erasure';

export type ContactQuery = {
  page?: number; limit?: number; search?: string; segmentId?: number; tag?: string;
  orderBy?: ContactSortKey; orderByDir?: 'asc' | 'desc';
};

export type Where = [column: string, expression: string, value?: string | number];

export const day = 86400000;

export const maxPage = 100;

// Largest contact page the console asks for; larger pages are fetched from the engine in chunks of maxPage.
export const maxContactPage = 500;

// Sortable contact columns, as Mautic's `orderBy` names them (LeadRepository.php:1064 uses `l.` columns).
export const contactSortColumns: Record<ContactSortKey, string> = {
  createdAt: 'l.date_added', updatedAt: 'l.date_modified', lastActive: 'l.last_active', email: 'l.email',
  firstName: 'l.firstname', lastName: 'l.lastname', company: 'l.company', city: 'l.city', country: 'l.country',
  position: 'l.position', points: 'l.points', id: 'l.id',
};

const searchCommandName = /(?:^|\s)!?([a-z][a-z0-9_]*(?::[a-z]+)?):/i;

// True when the text uses Mautic's `command:value` grammar rather than being plain words.
export function hasSearchCommand(search: string) {
  return searchCommandName.test(search);
}

// Cleans a contact search for the engine's `search=` parameter. Command searches pass through; plain words are quoted as one phrase.
export function contactSearch(raw: string | undefined) {
  const text = (raw ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!text) return '';
  if (hasSearchCommand(text)) {
    if ((text.match(/"/g) ?? []).length % 2) throw new UpstreamError(service, 400, 'Close the quotation marks in the search.');
    return text;
  }
  return `"${text.replace(/"/g, ' ').trim()}"`;
}

export const unsubscribeLink = /<a\s+[^>]*href\s*=\s*["']\{unsubscribe_url\}["']/i;

export const unsubscribeFooter = '<p><a href="{unsubscribe_url}">Unsubscribe from marketing emails</a></p>';

export const suppressionCodes = { unsubscribe: 1, bounce: 2, complaint: 3, erasure: 3 };

export function queryPath(path: string, query: URLSearchParams) {
  return `${path}?${query}`;
}

export function conditions(query: URLSearchParams, where: Where[]) {
  for (const [index, [column, expression, value]] of where.entries()) {
    query.set(`where[${index}][col]`, column);
    query.set(`where[${index}][expr]`, expression);
    if (value !== undefined) query.set(`where[${index}][val]`, String(value));
  }
  return query;
}

export function dates(column: string, range: DateRange): Where[] {
  const start = new Date(Math.ceil(range.startAt / 1000) * 1000).toISOString();
  const end = new Date(Math.floor(range.endAt / 1000) * 1000).toISOString();
  return [
    [column, 'gte', start.slice(0, 19).replace('T', ' ')],
    [column, 'lte', end.slice(0, 19).replace('T', ' ')],
  ];
}

export function sortContacts(a: Contact, b: Contact) {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id - a.id;
}

export function requiredText(raw: string, message: string) {
  const cleaned = raw.trim();
  if (!cleaned) throw new UpstreamError(service, 400, message);
  return cleaned;
}

export function validHttpUrl(raw: string, message: string) {
  const cleaned = raw.trim();
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    return cleaned;
  } catch {
    throw new UpstreamError(service, 400, message);
  }
}

const realDate = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const coreContactAliases = [
  'email', 'firstname', 'lastname', 'company', 'phone', 'position', 'city', 'country', 'website',
];

const timezones = (() => {
  try {
    return new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  } catch {
    return null;
  }
})();

// Validates custom contact field values against their definitions and returns the strings to send.
// An empty string clears the value. A multiselect is sent pipe-delimited, which is how Mautic stores it.
export function customValues(values: Record<string, string | string[]>, definitions: CustomField[]) {
  const result: Record<string, string> = {};
  for (const [alias, raw] of Object.entries(values)) {
    if (coreContactAliases.includes(alias)) {
      throw new UpstreamError(service, 400, `Use the standard ${alias} field instead of a custom value.`);
    }
    const definition = definitions.find(field => field.alias === alias);
    if (!definition) throw new UpstreamError(service, 400, `Unknown contact field: ${alias}.`);
    const label = definition.label || alias;
    const bad = (message: string) => new UpstreamError(service, 400, `${label}: ${message}`);
    const parts = Array.isArray(raw) ? raw.map(part => part.trim()).filter(Boolean) : null;
    const value = (parts ? parts.join('|') : String(raw)).trim();
    if (!value) {
      if (definition.isRequired) throw bad('this field is required.');
      result[alias] = '';
      continue;
    }
    switch (definition.type) {
      case 'number':
        if (!/^-?\d+(\.\d+)?$/.test(value)) throw bad('enter a number.');
        result[alias] = value;
        break;
      case 'boolean': {
        const normalized = value.toLowerCase();
        if (['1', 'true', 'yes'].includes(normalized)) result[alias] = '1';
        else if (['0', 'false', 'no'].includes(normalized)) result[alias] = '0';
        else throw bad('choose yes or no.');
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !realDate(value)) throw bad('use the date format YYYY-MM-DD.');
        result[alias] = value;
        break;
      case 'datetime': {
        const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/.exec(value);
        if (!match || !realDate(match[1]) || Number(match[2].slice(0, 2)) > 23 || Number(match[2].slice(3)) > 59 || Number(match[3] ?? 0) > 59) throw bad('use the format YYYY-MM-DD HH:MM.');
        result[alias] = `${match[1]} ${match[2]}:${match[3] ?? '00'}`;
        break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) throw bad('enter a valid email address.');
        result[alias] = value;
        break;
      case 'url': {
        let valid = false;
        try {
          valid = /^https?:$/.test(new URL(value).protocol);
        } catch {
          valid = false;
        }
        if (!valid) throw bad('enter a web address starting with http:// or https://.');
        result[alias] = value;
        break;
      }
      case 'tel':
        if (!/^[+\d][\d\s().\-x#]{2,39}$/i.test(value)) throw bad('enter a valid phone number.');
        result[alias] = value;
        break;
      case 'select':
        if (definition.options.length && !definition.options.includes(value)) throw bad('choose one of the listed options.');
        result[alias] = value;
        break;
      case 'multiselect': {
        const chosen = value.split('|').map(part => part.trim()).filter(Boolean);
        if (definition.options.length && chosen.some(part => !definition.options.includes(part))) throw bad('choose only the listed options.');
        result[alias] = chosen.join('|');
        break;
      }
      case 'timezone':
        if (timezones && !timezones.has(value)) throw bad('enter a valid timezone such as Europe/London.');
        result[alias] = value;
        break;
      case 'locale':
        if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(value)) throw bad('use a locale such as en_GB.');
        result[alias] = value;
        break;
      default:
        // text, textarea, country, region and lookup have no fixed list to check against here.
        if (value.length > (definition.type === 'textarea' ? 5000 : 255)) throw bad('this value is too long.');
        result[alias] = value;
    }
  }
  return result;
}

export function contactPayload(input: ContactInput, tags?: string[], custom: Record<string, string> = {}) {
  const blanks = [
    input.firstName, input.lastName, input.company,
    input.phone, input.position, input.city, input.country, input.website,
    ...Object.values(custom),
  ].some(value => value === '');
  return {
    ...custom,
    email: input.email.trim().toLowerCase(),
    firstname: input.firstName,
    lastname: input.lastName,
    company: input.company,
    phone: input.phone,
    position: input.position,
    city: input.city,
    country: input.country,
    website: input.website,
    tags,
    ...(blanks ? { overwriteWithBlank: true } : {}),
  };
}

export function segmentFiltersPayload(filters: SegmentFilter[]) {
  return filters.map(filter => ({
    glue: filter.glue,
    field: filter.field,
    object: filter.object ?? 'lead',
    type: filter.type ?? 'text',
    operator: filter.operator,
    filter: filter.filter,
    properties: { filter: filter.filter },
  }));
}

export function companyPayload(input: Partial<CompanyInput>) {
  const payload: ApiRecord = {};
  if (input.name !== undefined) payload.companyname = requiredText(input.name, 'Enter a company name.');
  if (input.email !== undefined) payload.companyemail = input.email;
  if (input.website !== undefined) payload.companywebsite = input.website;
  if (input.industry !== undefined) payload.companyindustry = input.industry;
  if (input.city !== undefined) payload.companycity = input.city;
  if (input.country !== undefined) payload.companycountry = input.country;
  if (Object.values(payload).some(value => value === '')) payload.overwriteWithBlank = true;
  return payload;
}

export function wantedTags(tags: string[]) {
  const cleaned = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  if (cleaned.some(tag => tag.startsWith('-'))) throw new UpstreamError(service, 400, 'A tag cannot start with a hyphen.');
  return cleaned;
}

export function cleanTriggers(triggers: string[]) {
  const cleaned = [...new Set(triggers.map(trigger => trigger.trim()).filter(Boolean))];
  if (!cleaned.length) throw new UpstreamError(service, 400, 'Select at least one webhook trigger.');
  return cleaned;
}

export function allowedEmail(dto: ApiRecord) {
  return dto.emailType === 'template' && !flag(dto.sendToDnc) && unsubscribeLink.test(text(dto.customHtml));
}

export function withUnsubscribeLink(body: string) {
  if (unsubscribeLink.test(body)) return body;
  return /<\/body\s*>/i.test(body)
    ? body.replace(/<\/body\s*>/i, `${unsubscribeFooter}</body>`)
    : body + unsubscribeFooter;
}

export function toEmail(dto: ApiRecord): JourneyEmail {
  return {
    id: requiredId(dto.id),
    name: text(dto.name),
    subject: text(dto.subject),
    body: text(dto.customHtml),
    published: published(dto),
    sentCount: number(dto.sentCount),
    readCount: number(dto.readCount),
  };
}

export const focusTypes = new Set<FocusItemInput['type']>(['form', 'notice', 'link']);

export const focusStyles = new Set<FocusItemInput['style']>(['bar', 'modal', 'notification', 'page']);

export function stripHash(value: string) {
  return value.trim().replace(/^#/, '');
}

export function fieldObject(object: CustomFieldObject): CustomFieldObject {
  if (object !== 'contact' && object !== 'company') {
    throw new UpstreamError(service, 400, 'Choose contact or company fields.');
  }
  return object;
}

export function focusType(value: FocusItemInput['type']): FocusItemInput['type'] {
  if (!focusTypes.has(value)) throw new UpstreamError(service, 400, 'Choose a valid focus item type.');
  return value;
}

export function focusStyle(value: FocusItemInput['style']): FocusItemInput['style'] {
  if (!focusStyles.has(value)) throw new UpstreamError(service, 400, 'Choose a valid focus item style.');
  return value;
}

export function focusStyleOptions(style: FocusItemInput['style']) {
  return style === 'bar'
    ? { allow_hide: 1, push_page: 1, sticky: 1, size: 'large', placement: 'top' }
    : { placement: 'top_right' };
}
