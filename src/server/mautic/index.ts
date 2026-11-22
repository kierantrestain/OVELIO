import type {
  Asset, AssetInput, Category, CategoryInput, Company, CompanyInput, Contact,
  ContactDetail, ContactDevice, ContactInput, ContactLinkedCompany, ContactNote,
  ContactNoteInput, CustomField, CustomFieldInput, CustomFieldObject, DateRange,
  DynamicContent, DynamicContentInput, FocusItem, FocusItemInput, FormSubmission,
  Health, JourneyEmail, JourneyEmailInput, LandingPage, LandingPageInput,
  LeadForm, LeadFormInput, MarketingReport, MarketingReportData, Page, Point,
  PointAction, PointActionInput, PointTrigger, PointTriggerInput, Segment,
  SegmentFilter, SegmentInput, Stage, StageInput, Tag, Webhook, WebhookInput,
  Workflow, WorkflowContact, WorkflowInput,
} from '../../contracts';
import { appOrigin } from '../config';
import { basic, upstream, UpstreamError } from '../upstream';
import {
  date, flag, item, items, number, positiveId, published, record, requiredId, service,
  text, toAsset, toCategory, toCompany, toContact, toContactDevice,
  toContactLinkedCompany, toContactNote, toCustomField, toDynamicContent,
  toFocusItem, toFormField, toFormSubmission, toLandingPage, toMarketingReport,
  toMarketingReportData, toPointAction, toPointTrigger, toSegment, toStage, toTag,
  toWebhook, toWorkflowContact, total, type ApiRecord,
} from './normalize';
import { managedSteps, toWorkflow, verifySavedWorkflow, workflowPayload } from './workflows';

type Config = { url?: string; username?: string; password?: string; fetch?: typeof fetch };
type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'erasure';
type ContactQuery = { page?: number; limit?: number; search?: string; segmentId?: number; tag?: string };
type Where = [column: string, expression: string, value?: string | number];
type NativeFormField = {
  label: string;
  type: string;
  alias: string;
  mappedObject?: 'contact';
  mappedField?: string;
  showLabel?: boolean;
  isRequired?: boolean;
  properties?: Record<string, unknown>;
};

const day = 86400000;
const maxPage = 100;
const unsubscribeLink = /<a\s+[^>]*href\s*=\s*["']\{unsubscribe_url\}["']/i;
const unsubscribeFooter = '<p><a href="{unsubscribe_url}">Unsubscribe from marketing emails</a></p>';
const suppressionCodes = { unsubscribe: 1, bounce: 2, complaint: 3, erasure: 3 };
const defaultFormFields: NativeFormField[] = [
  { label: 'First name', type: 'text', alias: 'first_name', mappedObject: 'contact', mappedField: 'firstname', showLabel: true },
  { label: 'Email address', type: 'email', alias: 'email', mappedObject: 'contact', mappedField: 'email', showLabel: true, isRequired: true },
  { label: 'Submit', type: 'button', alias: 'submit' },
];

function queryPath(path: string, query: URLSearchParams) {
  return `${path}?${query}`;
}

function conditions(query: URLSearchParams, where: Where[]) {
  for (const [index, [column, expression, value]] of where.entries()) {
    query.set(`where[${index}][col]`, column);
    query.set(`where[${index}][expr]`, expression);
    if (value !== undefined) query.set(`where[${index}][val]`, String(value));
  }
  return query;
}

function dates(column: string, range: DateRange): Where[] {
  const start = new Date(Math.ceil(range.startAt / 1000) * 1000).toISOString();
  const end = new Date(Math.floor(range.endAt / 1000) * 1000).toISOString();
  return [
    [column, 'gte', start.slice(0, 19).replace('T', ' ')],
    [column, 'lte', end.slice(0, 19).replace('T', ' ')],
  ];
}

function sortContacts(a: Contact, b: Contact) {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id - a.id;
}

function requiredText(raw: string, message: string) {
  const cleaned = raw.trim();
  if (!cleaned) throw new UpstreamError(service, 400, message);
  return cleaned;
}

function validHttpUrl(raw: string, message: string) {
  const cleaned = raw.trim();
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    return cleaned;
  } catch {
    throw new UpstreamError(service, 400, message);
  }
}

function contactPayload(input: ContactInput, tags?: string[]) {
  const blanks = [
    input.firstName, input.lastName, input.company,
    input.phone, input.position, input.city, input.country, input.website,
  ].some(value => value === '');
  return {
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

function segmentFiltersPayload(filters: SegmentFilter[]) {
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

function companyPayload(input: Partial<CompanyInput>) {
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

function wantedTags(tags: string[]) {
  const cleaned = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  if (cleaned.some(tag => tag.startsWith('-'))) throw new UpstreamError(service, 400, 'A tag cannot start with a hyphen.');
  return cleaned;
}

function cleanTriggers(triggers: string[]) {
  const cleaned = [...new Set(triggers.map(trigger => trigger.trim()).filter(Boolean))];
  if (!cleaned.length) throw new UpstreamError(service, 400, 'Select at least one webhook trigger.');
  return cleaned;
}

function allowedEmail(dto: ApiRecord) {
  return dto.emailType === 'template' && !flag(dto.sendToDnc) && unsubscribeLink.test(text(dto.customHtml));
}

function withUnsubscribeLink(body: string) {
  if (unsubscribeLink.test(body)) return body;
  return /<\/body\s*>/i.test(body)
    ? body.replace(/<\/body\s*>/i, `${unsubscribeFooter}</body>`)
    : body + unsubscribeFooter;
}

function toEmail(dto: ApiRecord): JourneyEmail {
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

function plainFormMessage(message: string) {
  return message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('{', '&#123;').replaceAll('}', '&#125;');
}

function buildFormFields(inputFields: NonNullable<LeadFormInput['fields']>): NativeFormField[] {
  const seen = new Set<string>();
  const built: NativeFormField[] = [];
  let hasMappedEmail = false;

  for (const field of inputFields) {
    const label = requiredText(field.label, 'Enter a label for each form field.');
    const alias = field.alias.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!alias || alias === 'submit' || seen.has(alias)) {
      throw new UpstreamError(service, 400, 'Use a unique valid alias for each form field.');
    }
    seen.add(alias);

    const mappedField = field.mappedField?.trim() || (field.type === 'email' ? 'email' : undefined);
    if (field.type === 'email' && mappedField === 'email') hasMappedEmail = true;

    const options = field.options?.map(option => option.trim()).filter(Boolean);
    const listItems = options?.map(option => ({ label: option, value: option }));
    const properties = listItems?.length
      ? field.type === 'checkboxgrp'
        ? { optionlist: { list: listItems } }
        : { list: { list: listItems } }
      : undefined;

    built.push({
      label,
      type: field.type,
      alias,
      showLabel: true,
      ...(mappedField ? { mappedObject: 'contact' as const, mappedField } : {}),
      ...(field.isRequired ? { isRequired: true } : {}),
      ...(properties ? { properties } : {}),
    });
  }

  if (!hasMappedEmail) {
    const emailAlias = seen.has('email') ? 'contact_email' : 'email';
    if (seen.has(emailAlias)) throw new UpstreamError(service, 400, 'Include an email field mapped to the contact email.');
    built.push({
      label: 'Email address',
      type: 'email',
      alias: emailAlias,
      mappedObject: 'contact',
      mappedField: 'email',
      showLabel: true,
      isRequired: true,
    });
  }

  built.push({ label: 'Submit', type: 'button', alias: 'submit' });
  return built;
}

const focusTypes = new Set<FocusItemInput['type']>(['form', 'notice', 'link']);
const focusStyles = new Set<FocusItemInput['style']>(['bar', 'modal', 'notification', 'page']);

function stripHash(value: string) {
  return value.trim().replace(/^#/, '');
}

function fieldObject(object: CustomFieldObject): CustomFieldObject {
  if (object !== 'contact' && object !== 'company') {
    throw new UpstreamError(service, 400, 'Choose contact or company fields.');
  }
  return object;
}

function focusType(value: FocusItemInput['type']): FocusItemInput['type'] {
  if (!focusTypes.has(value)) throw new UpstreamError(service, 400, 'Choose a valid focus item type.');
  return value;
}

function focusStyle(value: FocusItemInput['style']): FocusItemInput['style'] {
  if (!focusStyles.has(value)) throw new UpstreamError(service, 400, 'Choose a valid focus item style.');
  return value;
}

function focusStyleOptions(style: FocusItemInput['style']) {
  return style === 'bar'
    ? { allow_hide: 1, push_page: 1, sticky: 1, size: 'large', placement: 'top' }
    : { placement: 'top_right' };
}

export function createMautic(config: Config = {}) {
  function baseUrl() {
    return (config.url ?? process.env.MAUTIC_URL ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  }

  function focusOrigin() {
    return process.env.APP_ORIGIN ? appOrigin() : baseUrl();
  }

  function request(path: string, method = 'GET', input?: object | URLSearchParams) {
    const url = baseUrl();
    const username = config.username ?? process.env.MAUTIC_USERNAME;
    const password = config.password ?? process.env.MAUTIC_PASSWORD;
    if (!url || !username || !password) throw new UpstreamError(service, 503, 'Set the audience connection URL and API credentials.');
    return upstream<ApiRecord>(service, url, '/api' + path, {
      fetch: config.fetch,
      method,
      headers: { Authorization: basic(username, password) },
      body: input instanceof URLSearchParams ? input : input === undefined ? undefined : JSON.stringify(input),
    });
  }

  async function list(path: string, key: string, query = new URLSearchParams()) {
    const result: ApiRecord[] = [];
    query.set('orderBy', 'id');
    query.set('orderByDir', 'ASC');
    for (let start = 0; ; start += maxPage) {
      query.set('start', String(start));
      query.set('limit', String(maxPage));
      const response = await request(queryPath(path, query));
      const page = items(response[key]);
      result.push(...page);
      if (!page.length || result.length >= total(response)) return result;
    }
  }

  async function get(path: string, key: string, id: number) {
    return item((await request(`${path}/${requiredId(id)}`))[key]);
  }

  async function write(path: string, key: string, method: 'POST' | 'PATCH' | 'PUT', dto: object) {
    return item((await request(path, method, dto))[key]);
  }

  async function remove(path: string) {
    try {
      await request(path, 'DELETE');
    } catch (error) {
      if (!(error instanceof UpstreamError) || error.status !== 404) throw error;
    }
  }

  async function contact(id: number) {
    return toContact(await get('/contacts', 'contact', id));
  }

  async function segment(id: number) {
    return toSegment(await get('/segments', 'list', id));
  }

  async function reports(): Promise<MarketingReport[]> {
    const response = await request('/reports?limit=100');
    return items(response.reports)
      .map(toMarketingReport)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function memberships(id: number) {
    const response = await request(`/contacts/${requiredId(id)}/segments`);
    return items(response.lists).map(entry => requiredId(entry.id));
  }

  async function tally(path: string, where: Where[]) {
    return total(await request(queryPath(path, conditions(new URLSearchParams({ limit: '1' }), where))));
  }

  async function toForm(dto: ApiRecord): Promise<LeadForm> {
    const id = requiredId(dto.id);
    const submissions = await tally('/stats/form_submissions', [['form_id', 'eq', id]]).catch(() => null);
    const fields = dto.fields && typeof dto.fields === 'object'
      ? Object.values(dto.fields)
          .map(record)
          .filter(field => text(field.type) !== 'button' && text(field.alias))
          .map(toFormField)
      : [];
    return {
      id,
      name: text(dto.name),
      description: text(dto.description),
      submissions,
      published: published(dto),
      fields,
    };
  }

  return {
    async health(): Promise<Health> {
      try {
        const response = await request('/contacts?limit=1&minimal=1');
        total(response);
        items(response.contacts);
        return { status: 'ready' };
      } catch (error) {
        if (error instanceof UpstreamError && (error.status === 401 || error.status === 403)) {
          return { status: 'unavailable', message: 'Check audience API access, credentials and contact permissions.' };
        }
        return { status: 'unavailable', message: 'Check the audience service, REST API settings and connection URL.' };
      }
    },

    async contacts({ page = 1, limit = 25, search, segmentId, tag }: ContactQuery = {}): Promise<Page<Contact>> {
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1) {
        throw new UpstreamError(service, 400, 'Choose a valid contact page.');
      }
      limit = Math.min(limit, maxPage);
      const query = new URLSearchParams({
        start: String((page - 1) * limit), limit: String(limit), orderBy: 'l.date_added,l.id', orderByDir: 'DESC',
      });
      const filters = [];
      if (segmentId !== undefined) {
        const source = await segment(segmentId);
        if (!source.alias || /"/.test(source.alias)) throw new UpstreamError(service, 502);
        filters.push(`segment:"${source.alias}"`);
      }
      const cleanTag = tag?.replace(/["<>]/g, ' ').trim();
      if (cleanTag) filters.push(`tag:"${cleanTag}"`);
      const term = search?.replace(/["<>]/g, ' ').trim();
      if (term) filters.push(`"${term}"`);
      if (filters.length) query.set('search', filters.join(' '));
      conditions(query, [['l.date_identified', 'isNotNull']]);
      const response = await request(queryPath('/contacts', query));
      return { items: items(response.contacts).map(toContact).sort(sortContacts), total: total(response), page, limit };
    },

    contact,

    async findContact(email: string): Promise<Contact | null> {
      const normalized = email.trim().toLowerCase();
      if (!normalized) return null;
      const query = conditions(new URLSearchParams({ limit: '2' }), [['l.email', 'eq', normalized]]);
      const response = await request(queryPath('/contacts', query));
      const matches = items(response.contacts).map(toContact).filter(candidate => candidate.email === normalized);
      if (matches.length > 1 || total(response) > 2) {
        throw new UpstreamError(service, 409, 'More than one contact matches this address. Merge the duplicate contacts first.');
      }
      return matches[0] ?? null;
    },

    async createContact(input: ContactInput) {
      const tags = input.tags && wantedTags(input.tags);
      return toContact(await write('/contacts/new', 'contact', 'POST', contactPayload(input, tags)));
    },

    async updateContact(id: number, input: ContactInput) {
      let changes: string[] | undefined;
      if (input.tags !== undefined) {
        const tags = wantedTags(input.tags);
        const current = await contact(id);
        changes = [...tags, ...current.tags.filter(tag => !tags.includes(tag)).map(tag => `-${tag}`)];
      }
      return toContact(await write(`/contacts/${requiredId(id)}/edit`, 'contact', 'PATCH', contactPayload(input, changes)));
    },

    async deleteContact(id: number) {
      await remove(`/contacts/${requiredId(id)}/delete`);
    },

    async setSuppressed(id: number, reason: SuppressionReason) {
      const code = suppressionCodes[reason];
      if (!code) throw new UpstreamError(service, 400, 'Choose a valid suppression reason.');
      await request(`/contacts/${requiredId(id)}/dnc/email/add`, 'POST', new URLSearchParams({
        reason: String(code), comments: `OVELIO suppression: ${reason}`,
      }));
      if (!(await contact(id)).suppressed) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm the suppression.');
      }
    },

    async adjustPoints(contactId: number, delta: number): Promise<Contact> {
      const id = requiredId(contactId);
      if (!Number.isSafeInteger(delta) || delta === 0) {
        throw new UpstreamError(service, 400, 'Enter a non-zero whole number of points.');
      }
      const direction = delta > 0 ? 'plus' : 'minus';
      const response = record(await request(`/contacts/${id}/points/${direction}/${Math.abs(delta)}`, 'POST'));
      if (response.success === false) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm the point adjustment.');
      }
      return positiveId(record(response.contact).id) ? toContact(item(response.contact)) : contact(id);
    },

    async contactNotes(contactId: number): Promise<ContactNote[]> {
      const response = await request(`/contacts/${requiredId(contactId)}/notes?limit=50`);
      return items(response.notes)
        .map(toContactNote)
        .sort((a, b) => (b.dateTime ?? '').localeCompare(a.dateTime ?? '') || b.id - a.id);
    },

    async createContactNote(contactId: number, input: ContactNoteInput): Promise<ContactNote> {
      const content = requiredText(input.text, 'Enter note text.');
      return toContactNote(await write('/notes/new', 'note', 'POST', {
        lead: requiredId(contactId),
        text: content,
        type: input.type ?? 'general',
      }));
    },

    async deleteContactNote(noteId: number): Promise<void> {
      await remove(`/notes/${requiredId(noteId)}/delete`);
    },

    async contactCampaigns(contactId: number): Promise<number[]> {
      const response = await request(`/contacts/${requiredId(contactId)}/campaigns`);
      return items(response.campaigns)
        .filter(entry => !flag(entry.manuallyRemoved))
        .map(entry => requiredId(entry.id));
    },

    async segments(): Promise<Segment[]> {
      return (await list('/segments', 'lists')).map(toSegment).sort((a, b) => a.name.localeCompare(b.name));
    },

    async contactSegments(id: number): Promise<Segment[]> {
      const ids = await memberships(id);
      return (await Promise.all(ids.map(segment))).sort((a, b) => a.name.localeCompare(b.name));
    },

    async contactSegmentMembership(id: number, segmentId: number) {
      return (await memberships(id)).includes(requiredId(segmentId));
    },

    async contactActivity(id: number): Promise<ContactDetail['activity']> {
      const response = await request(`/contacts/${requiredId(id)}/activity?limit=25`);
      if (!Array.isArray(response.events)) throw new UpstreamError(service, 502);
      return response.events.map(record).flatMap(event => {
        const at = date(event.timestamp);
        const type = text(event.event);
        const label = text(event.eventLabel) || text(record(event.eventLabel).label) || text(event.eventType) || type;
        return at && label ? [{ at, label, type }] : [];
      });
    },

    async createSegment(input: SegmentInput): Promise<Segment> {
      return toSegment(await write('/segments/new', 'list', 'POST', {
        name: input.name,
        description: input.description,
        isPublished: input.published ?? true,
        ...(input.filters !== undefined ? { filters: segmentFiltersPayload(input.filters) } : {}),
      }));
    },

    async updateSegment(id: number, input: Partial<SegmentInput>): Promise<Segment> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = input.name;
      if (input.description !== undefined) payload.description = input.description;
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.filters !== undefined) payload.filters = segmentFiltersPayload(input.filters);
      return toSegment(await write(`/segments/${requiredId(id)}/edit`, 'list', 'PATCH', payload));
    },

    async deleteSegment(id: number): Promise<void> {
      await remove(`/segments/${requiredId(id)}/delete`);
    },

    async addToSegment(segmentId: number, contactId: number) {
      await request(`/segments/${requiredId(segmentId)}/contact/${requiredId(contactId)}/add`, 'POST');
    },

    async removeFromSegment(segmentId: number, contactId: number) {
      await request(`/segments/${requiredId(segmentId)}/contact/${requiredId(contactId)}/remove`, 'POST');
    },

    async tags(): Promise<Tag[]> {
      return (await list('/tags', 'tags')).map(toTag).sort((a, b) => a.tag.localeCompare(b.tag));
    },

    async createTag(tag: string, description?: string): Promise<Tag> {
      const clean = requiredText(tag, 'Enter a tag name.');
      if (clean.startsWith('-')) throw new UpstreamError(service, 400, 'A tag cannot start with a hyphen.');
      return toTag(await write('/tags/new', 'tag', 'POST', {
        tag: clean,
        ...(description !== undefined ? { description } : {}),
      }));
    },

    async deleteTag(id: number): Promise<void> {
      await remove(`/tags/${requiredId(id)}/delete`);
    },

    async stages(): Promise<Stage[]> {
      return (await list('/stages', 'stages'))
        .map(toStage)
        .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name));
    },

    async createStage(input: StageInput): Promise<Stage> {
      const name = requiredText(input.name, 'Enter a lifecycle stage name.');
      const weight = input.weight ?? 0;
      if (!Number.isSafeInteger(weight)) throw new UpstreamError(service, 400, 'Enter a whole number weight.');
      return toStage(await write('/stages/new', 'stage', 'POST', {
        name,
        description: input.description ?? '',
        weight,
        isPublished: input.published ?? true,
      }));
    },

    async updateStage(id: number, input: Partial<StageInput>): Promise<Stage> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a lifecycle stage name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.weight !== undefined) {
        if (!Number.isSafeInteger(input.weight)) throw new UpstreamError(service, 400, 'Enter a whole number weight.');
        payload.weight = input.weight;
      }
      if (input.published !== undefined) payload.isPublished = input.published;
      return toStage(await write(`/stages/${requiredId(id)}/edit`, 'stage', 'PATCH', payload));
    },

    async deleteStage(id: number): Promise<void> {
      await remove(`/stages/${requiredId(id)}/delete`);
    },

    async setContactStage(contactId: number, stageId: number): Promise<void> {
      await request(`/stages/${requiredId(stageId)}/contact/${requiredId(contactId)}/add`, 'POST');
    },

    async removeContactStage(contactId: number, stageId: number): Promise<void> {
      await request(`/stages/${requiredId(stageId)}/contact/${requiredId(contactId)}/remove`, 'POST');
    },

    async companies(query?: { search?: string }): Promise<Company[]> {
      const params = new URLSearchParams();
      const term = query?.search?.replace(/["<>]/g, ' ').trim();
      if (term) params.set('search', term);
      return (await list('/companies', 'companies', params))
        .map(toCompany)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createCompany(input: CompanyInput): Promise<Company> {
      return toCompany(await write('/companies/new', 'company', 'POST', companyPayload(input)));
    },

    async updateCompany(id: number, input: Partial<CompanyInput>): Promise<Company> {
      return toCompany(await write(`/companies/${requiredId(id)}/edit`, 'company', 'PATCH', companyPayload(input)));
    },

    async deleteCompany(id: number): Promise<void> {
      await remove(`/companies/${requiredId(id)}/delete`);
    },

    async addContactToCompany(companyId: number, contactId: number): Promise<void> {
      await request(`/companies/${requiredId(companyId)}/contact/${requiredId(contactId)}/add`, 'POST');
    },

    async pointActions(): Promise<PointAction[]> {
      return (await list('/points', 'points')).map(toPointAction).sort((a, b) => a.name.localeCompare(b.name));
    },

    async pointActionTypes(): Promise<Record<string, string>> {
      const response = await request('/points/actions/types');
      const raw = record(response.actionTypes ?? response);
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') {
          flat[key] = value;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [subKey, subValue] of Object.entries(value as ApiRecord)) {
            if (typeof subValue === 'string') flat[subKey] = subValue;
          }
        }
      }
      return flat;
    },

    async createPointAction(input: PointActionInput): Promise<PointAction> {
      const name = requiredText(input.name, 'Enter a point action name.');
      const type = requiredText(input.type, 'Select a point action type.');
      if (!Number.isSafeInteger(input.delta)) throw new UpstreamError(service, 400, 'Enter a whole number of points.');
      return toPointAction(await write('/points/new', 'point', 'POST', {
        name,
        description: input.description ?? '',
        type,
        delta: input.delta,
        isPublished: input.published ?? true,
      }));
    },

    async updatePointAction(id: number, input: Partial<PointActionInput>): Promise<PointAction> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a point action name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.type !== undefined) payload.type = requiredText(input.type, 'Select a point action type.');
      if (input.delta !== undefined) {
        if (!Number.isSafeInteger(input.delta)) throw new UpstreamError(service, 400, 'Enter a whole number of points.');
        payload.delta = input.delta;
      }
      if (input.published !== undefined) payload.isPublished = input.published;
      return toPointAction(await write(`/points/${requiredId(id)}/edit`, 'point', 'PATCH', payload));
    },

    async deletePointAction(id: number): Promise<void> {
      await remove(`/points/${requiredId(id)}/delete`);
    },

    async pointTriggers(): Promise<PointTrigger[]> {
      return (await list('/points/triggers', 'triggers'))
        .map(toPointTrigger)
        .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name));
    },

    async createPointTrigger(input: PointTriggerInput): Promise<PointTrigger> {
      const name = requiredText(input.name, 'Enter a point trigger name.');
      if (!Number.isSafeInteger(input.points)) throw new UpstreamError(service, 400, 'Enter a whole number point threshold.');
      return toPointTrigger(await write('/points/triggers/new', 'trigger', 'POST', {
        name,
        description: input.description ?? '',
        points: input.points,
        isPublished: input.published ?? true,
        triggerExistingLeads: input.triggerExistingLeads ?? false,
      }));
    },

    async updatePointTrigger(id: number, input: Partial<PointTriggerInput>): Promise<PointTrigger> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a point trigger name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.points !== undefined) {
        if (!Number.isSafeInteger(input.points)) throw new UpstreamError(service, 400, 'Enter a whole number point threshold.');
        payload.points = input.points;
      }
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.triggerExistingLeads !== undefined) payload.triggerExistingLeads = input.triggerExistingLeads;
      return toPointTrigger(await write(`/points/triggers/${requiredId(id)}/edit`, 'trigger', 'PATCH', payload));
    },

    async deletePointTrigger(id: number): Promise<void> {
      await remove(`/points/triggers/${requiredId(id)}/delete`);
    },

    async forms(): Promise<LeadForm[]> {
      const forms = await list('/forms', 'forms');
      const counts: LeadForm[] = [];
      for (let index = 0; index < forms.length; index += 6) {
        counts.push(...await Promise.all(forms.slice(index, index + 6).map(toForm)));
      }
      return counts.sort((a, b) => a.name.localeCompare(b.name));
    },

    async createForm(input: LeadFormInput): Promise<LeadForm> {
      const name = requiredText(input.name, 'Enter a lead capture form name.');
      const wantPublished = input.published ?? true;
      const fields = input.fields?.length ? buildFormFields(input.fields) : defaultFormFields;
      const dto = await write('/forms/new', 'form', 'POST', {
        name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        formType: 'standalone',
        postAction: 'message',
        postActionProperty: plainFormMessage(input.message?.trim() || 'Thank you. Your details have been received.'),
        isPublished: wantPublished,
        noIndex: true,
        fields,
        actions: [],
      });
      const saved = items(dto.fields);
      if (
        dto.formType !== 'standalone' || (wantPublished && !published(dto)) || saved.length !== fields.length
        || !fields.every(field => saved.some(current => current.alias === field.alias && current.type === field.type
          && (!field.mappedField || (current.mappedField === field.mappedField && current.mappedObject === 'contact'))
          && (!field.isRequired || flag(current.isRequired))))
      ) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm the published lead capture form and mapped fields.');
      }
      return toForm(dto);
    },

    async updateForm(id: number, input: Partial<LeadFormInput>): Promise<LeadForm> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a lead capture form name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.message !== undefined) {
        payload.postAction = 'message';
        payload.postActionProperty = plainFormMessage(input.message.trim() || 'Thank you. Your details have been received.');
      }
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.fields !== undefined) {
        if (!input.fields.length) throw new UpstreamError(service, 400, 'Add at least one form field.');
        payload.fields = buildFormFields(input.fields);
      }
      const dto = await write(`/forms/${requiredId(id)}/edit`, 'form', 'PATCH', payload);
      return toForm(dto);
    },

    async deleteForm(id: number): Promise<void> {
      await remove(`/forms/${requiredId(id)}/delete`);
    },

    async formSubmissions(formId: number, page = 1): Promise<Page<FormSubmission>> {
      const id = requiredId(formId);
      if (!Number.isSafeInteger(page) || page < 1) {
        throw new UpstreamError(service, 400, 'Choose a valid submission page.');
      }
      const limit = 25;
      const start = (page - 1) * limit;
      const response = await request(`/forms/${id}/submissions?start=${start}&limit=${limit}`);
      return {
        items: items(response.submissions).map(entry => toFormSubmission(entry, id)),
        total: total(response),
        page,
        limit,
      };
    },

    async leadCount(range: DateRange) {
      return tally('/stats/form_submissions', dates('date_submitted', range));
    },

    async contactGrowth(range: DateRange): Promise<Point[]> {
      const start = new Date(range.startAt).setUTCHours(0, 0, 0, 0);
      const end = new Date(range.endAt).setUTCHours(0, 0, 0, 0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 366 * day) {
        throw new UpstreamError(service, 400, 'Select a valid reporting range of up to 366 days.');
      }
      const countByDate = new Map<string, number>();
      for (let at = start; at <= end; at += day) countByDate.set(new Date(at).toISOString().slice(0, 10), 0);
      const where: Where[] = [['l.date_identified', 'isNotNull'], ...dates('l.date_added', range)];
      let before: number | undefined;
      for (;;) {
        const query = new URLSearchParams({ limit: String(maxPage), minimal: '1', orderBy: 'l.id', orderByDir: 'DESC' });
        const filters: Where[] = before === undefined ? where : [...where, ['l.id', 'lt', before]];
        const response = await request(queryPath('/contacts', conditions(query, filters)));
        const contacts = items(response.contacts);
        for (const dto of contacts) {
          const label = date(dto.dateAdded)?.slice(0, 10);
          if (!label || !countByDate.has(label)) throw new UpstreamError(service, 502);
          countByDate.set(label, (countByDate.get(label) ?? 0) + 1);
        }
        if (contacts.length < maxPage) break;
        const next = Math.min(...contacts.map(dto => requiredId(dto.id)));
        if (before !== undefined && next >= before) throw new UpstreamError(service, 502);
        before = next;
      }
      return Array.from(countByDate, ([label, value]) => ({ label, value }));
    },

    async emails(): Promise<JourneyEmail[]> {
      return (await list('/emails', 'emails')).filter(allowedEmail).map(toEmail).sort((a, b) => a.name.localeCompare(b.name));
    },

    async email(id: number): Promise<JourneyEmail> {
      return toEmail(await get('/emails', 'email', id));
    },

    async createEmail(input: JourneyEmailInput): Promise<JourneyEmail> {
      const wantPublished = input.published ?? true;
      const dto = await write('/emails/new', 'email', 'POST', {
        name: input.name,
        subject: input.subject,
        customHtml: withUnsubscribeLink(input.body),
        emailType: 'template',
        template: 'mautic_code_mode',
        language: 'en',
        isPublished: wantPublished,
        sendToDnc: false,
      });
      if (!allowedEmail(dto) || (wantPublished && !published(dto))) {
        throw new UpstreamError(service, 502, 'The engine did not confirm a published automation email with an unsubscribe link.');
      }
      return toEmail(dto);
    },

    async updateEmail(id: number, input: JourneyEmailInput): Promise<JourneyEmail> {
      const payload: ApiRecord = {
        name: input.name,
        subject: input.subject,
        customHtml: withUnsubscribeLink(input.body),
        emailType: 'template',
        sendToDnc: false,
      };
      if (input.published !== undefined) payload.isPublished = input.published;
      const dto = await write(`/emails/${requiredId(id)}/edit`, 'email', 'PATCH', payload);
      if (!allowedEmail(dto) || (input.published !== undefined && published(dto) !== input.published)) {
        throw new UpstreamError(service, 502, 'The engine did not confirm the automation email update with an unsubscribe link.');
      }
      return toEmail(dto);
    },

    async deleteEmail(id: number): Promise<void> {
      await remove(`/emails/${requiredId(id)}/delete`);
    },

    async workflows(): Promise<Workflow[]> {
      return (await list('/campaigns', 'campaigns')).map(toWorkflow).sort((a, b) => b.id - a.id);
    },

    async createWorkflow(input: WorkflowInput) {
      const dto = await write('/campaigns/new', 'campaign', 'POST', workflowPayload(input));
      return verifySavedWorkflow(dto, input);
    },

    async updateWorkflow(id: number, input: WorkflowInput) {
      const previous = await get('/campaigns', 'campaign', id);
      const steps = managedSteps(previous);
      if (!steps.length || flag(previous.isPublished)) {
        throw new UpstreamError(service, 409, 'Pause an editable automation before changing its steps.');
      }
      const dto = await write(`/campaigns/${requiredId(id)}/edit`, 'campaign', 'PUT', workflowPayload(input, steps));
      return verifySavedWorkflow(dto, input);
    },

    async deleteWorkflow(id: number): Promise<void> {
      await remove(`/campaigns/${requiredId(id)}/delete`);
    },

    async workflowContacts(id: number): Promise<WorkflowContact[]> {
      const response = await request(`/campaigns/${requiredId(id)}/contacts`);
      const raw = response.contacts;
      if (!raw || typeof raw !== 'object') throw new UpstreamError(service, 502);
      return Object.values(raw).map(entry => toWorkflowContact(record(entry)));
    },

    async setWorkflowEnabled(id: number, enabled: boolean) {
      const current = await get('/campaigns', 'campaign', id);
      if (enabled) {
        const workflow = toWorkflow(current);
        if (!workflow.editable) throw new UpstreamError(service, 409, 'This automation cannot be activated from the step editor.');
        const emailSteps = workflow.steps.filter(step => (step.kind ?? 'email') === 'email');
        const [source, ...emails] = await Promise.all([
          workflow.segmentId > 0 ? segment(workflow.segmentId) : Promise.resolve(null),
          ...emailSteps.map(step => get('/emails', 'email', step.emailId)),
        ]);
        if ((source && !source.published) || emails.some(email => !allowedEmail(email) || !published(email))) {
          throw new UpstreamError(service, 409, 'Publish the audience segment and use published emails with an unsubscribe link.');
        }
      }
      await write(`/campaigns/${requiredId(id)}/edit`, 'campaign', 'PATCH', { isPublished: enabled });
      const dto = await get('/campaigns', 'campaign', id);
      const saved = toWorkflow(dto);
      if (flag(dto.isPublished) !== enabled || saved.enabled !== enabled) {
        throw new UpstreamError(service, 502, 'The automation engine did not confirm the new status.');
      }
      return saved;
    },

    async assets(): Promise<Asset[]> {
      return (await list('/assets', 'assets')).map(toAsset).sort((a, b) => a.title.localeCompare(b.title));
    },

    async createAsset(input: AssetInput): Promise<Asset> {
      const title = requiredText(input.title, 'Enter an asset title.');
      const remotePath = validHttpUrl(input.remotePath, 'Enter a valid HTTP or HTTPS asset URL.');
      try {
        return toAsset(await write('/assets/new', 'asset', 'POST', {
          title,
          description: input.description ?? '',
          storageLocation: 'remote',
          file: remotePath,
          isPublished: input.published ?? true,
        }));
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 400) {
          throw new UpstreamError(service, 400, 'Enter a reachable HTTP or HTTPS file URL so its file type can be verified.');
        }
        throw error;
      }
    },

    async updateAsset(id: number, input: Partial<AssetInput>): Promise<Asset> {
      const payload: ApiRecord = {};
      if (input.title !== undefined) payload.title = requiredText(input.title, 'Enter an asset title.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.remotePath !== undefined) {
        payload.storageLocation = 'remote';
        payload.file = validHttpUrl(input.remotePath, 'Enter a valid HTTP or HTTPS asset URL.');
      }
      if (input.published !== undefined) payload.isPublished = input.published;
      try {
        return toAsset(await write(`/assets/${requiredId(id)}/edit`, 'asset', 'PATCH', payload));
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 400) {
          throw new UpstreamError(service, 400, 'Enter a reachable HTTP or HTTPS file URL so its file type can be verified.');
        }
        throw error;
      }
    },

    async deleteAsset(id: number): Promise<void> {
      await remove(`/assets/${requiredId(id)}/delete`);
    },

    async pages(): Promise<LandingPage[]> {
      return (await list('/pages', 'pages')).map(toLandingPage).sort((a, b) => a.title.localeCompare(b.title));
    },

    async createPage(input: LandingPageInput): Promise<LandingPage> {
      const title = requiredText(input.title, 'Enter a landing page title.');
      return toLandingPage(await write('/pages/new', 'page', 'POST', {
        title,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        metaDescription: input.metaDescription ?? '',
        customHtml: input.customHtml,
        template: 'blank',
        isPublished: input.published ?? true,
      }));
    },

    async updatePage(id: number, input: Partial<LandingPageInput>): Promise<LandingPage> {
      const payload: ApiRecord = {};
      if (input.title !== undefined) payload.title = requiredText(input.title, 'Enter a landing page title.');
      if (input.alias !== undefined) payload.alias = input.alias;
      if (input.metaDescription !== undefined) payload.metaDescription = input.metaDescription;
      if (input.customHtml !== undefined) payload.customHtml = input.customHtml;
      if (input.published !== undefined) payload.isPublished = input.published;
      return toLandingPage(await write(`/pages/${requiredId(id)}/edit`, 'page', 'PATCH', payload));
    },

    async deletePage(id: number): Promise<void> {
      await remove(`/pages/${requiredId(id)}/delete`);
    },

    async webhooks(): Promise<Webhook[]> {
      return (await list('/hooks', 'hooks')).map(toWebhook).sort((a, b) => a.name.localeCompare(b.name));
    },

    async webhookTriggers(): Promise<Record<string, unknown>> {
      const response = await request('/hooks/triggers');
      return record(response.triggers ?? response);
    },

    async createWebhook(input: WebhookInput): Promise<Webhook> {
      const name = requiredText(input.name, 'Enter a webhook name.');
      const webhookUrl = validHttpUrl(input.webhookUrl, 'Enter a valid HTTP or HTTPS webhook URL.');
      const triggers = cleanTriggers(input.triggers);
      return toWebhook(await write('/hooks/new', 'hook', 'POST', {
        name,
        description: input.description ?? '',
        webhookUrl,
        triggers,
        isPublished: input.published ?? true,
      }));
    },

    async updateWebhook(id: number, input: Partial<WebhookInput>): Promise<Webhook> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a webhook name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.webhookUrl !== undefined) payload.webhookUrl = validHttpUrl(input.webhookUrl, 'Enter a valid HTTP or HTTPS webhook URL.');
      if (input.triggers !== undefined) payload.triggers = cleanTriggers(input.triggers);
      if (input.published !== undefined) payload.isPublished = input.published;
      return toWebhook(await write(`/hooks/${requiredId(id)}/edit`, 'hook', 'PATCH', payload));
    },

    async deleteWebhook(id: number): Promise<void> {
      await remove(`/hooks/${requiredId(id)}/delete`);
    },

    async fields(object: CustomFieldObject = 'contact'): Promise<CustomField[]> {
      const target = fieldObject(object);
      const response = await request(`/fields/${target}?limit=100`);
      return items(response.fields)
        .map(entry => toCustomField(entry, target))
        .sort((a, b) => a.label.localeCompare(b.label));
    },

    async createField(object: CustomFieldObject, input: CustomFieldInput): Promise<CustomField> {
      const target = fieldObject(object);
      const label = requiredText(input.label, 'Enter a field label.');
      const type = requiredText(input.type, 'Select a field type.');
      const alias = input.alias?.trim();
      const options = input.options?.map(value => value.trim()).filter(Boolean);
      return toCustomField(await write(`/fields/${target}/new`, 'field', 'POST', {
        label,
        ...(alias ? { alias } : {}),
        type,
        group: input.group || 'core',
        ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
        isRequired: input.isRequired ?? false,
        isPubliclyUpdatable: input.isPubliclyUpdatable ?? false,
        isPublished: input.published ?? true,
        ...(options?.length ? { properties: { list: options.map(value => ({ label: value, value })) } } : {}),
      }), target);
    },

    async updateField(object: CustomFieldObject, id: number, input: Partial<CustomFieldInput>): Promise<CustomField> {
      const target = fieldObject(object);
      const payload: ApiRecord = {};
      if (input.label !== undefined) payload.label = requiredText(input.label, 'Enter a field label.');
      if (input.alias !== undefined && input.alias.trim()) payload.alias = input.alias.trim();
      if (input.type !== undefined) payload.type = requiredText(input.type, 'Select a field type.');
      if (input.group !== undefined) payload.group = input.group || 'core';
      if (input.defaultValue !== undefined) payload.defaultValue = input.defaultValue;
      if (input.isRequired !== undefined) payload.isRequired = input.isRequired;
      if (input.isPubliclyUpdatable !== undefined) payload.isPubliclyUpdatable = input.isPubliclyUpdatable;
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.options !== undefined) {
        const options = input.options.map(value => value.trim()).filter(Boolean);
        payload.properties = { list: options.map(value => ({ label: value, value })) };
      }
      return toCustomField(await write(`/fields/${target}/${requiredId(id)}/edit`, 'field', 'PATCH', payload), target);
    },

    async deleteField(object: CustomFieldObject, id: number): Promise<void> {
      await remove(`/fields/${fieldObject(object)}/${requiredId(id)}/delete`);
    },

    async categories(bundle?: string): Promise<Category[]> {
      const response = await request('/categories?limit=100');
      const target = bundle?.trim();
      return items(response.categories)
        .map(toCategory)
        .filter(category => !target || category.bundle === target)
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async createCategory(input: CategoryInput): Promise<Category> {
      const title = requiredText(input.title, 'Enter a category title.');
      const bundle = requiredText(input.bundle, 'Select a category bundle.');
      const color = stripHash(input.color ?? '') || '2457d6';
      return toCategory(await write('/categories/new', 'category', 'POST', {
        title,
        bundle,
        description: input.description ?? '',
        color,
        isPublished: input.published ?? true,
      }));
    },

    async updateCategory(id: number, input: Partial<CategoryInput>): Promise<Category> {
      const payload: ApiRecord = {};
      if (input.title !== undefined) payload.title = requiredText(input.title, 'Enter a category title.');
      if (input.bundle !== undefined) payload.bundle = requiredText(input.bundle, 'Select a category bundle.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.color !== undefined) payload.color = stripHash(input.color);
      if (input.published !== undefined) payload.isPublished = input.published;
      return toCategory(await write(`/categories/${requiredId(id)}/edit`, 'category', 'PATCH', payload));
    },

    async deleteCategory(id: number): Promise<void> {
      await remove(`/categories/${requiredId(id)}/delete`);
    },

    async dynamicContents(): Promise<DynamicContent[]> {
      const response = await request('/dynamiccontents?limit=100');
      return items(response.dynamicContents)
        .map(toDynamicContent)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createDynamicContent(input: DynamicContentInput): Promise<DynamicContent> {
      const name = requiredText(input.name, 'Enter a dynamic content name.');
      const slotName = requiredText(input.slotName, 'Enter a dynamic content slot name.');
      return toDynamicContent(await write('/dynamiccontents/new', 'dynamicContent', 'POST', {
        name,
        slotName,
        content: input.content,
        isCampaignBased: input.isCampaignBased ?? true,
        isPublished: input.published ?? true,
      }));
    },

    async updateDynamicContent(id: number, input: Partial<DynamicContentInput>): Promise<DynamicContent> {
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a dynamic content name.');
      if (input.slotName !== undefined) payload.slotName = requiredText(input.slotName, 'Enter a dynamic content slot name.');
      if (input.content !== undefined) payload.content = input.content;
      if (input.isCampaignBased !== undefined) payload.isCampaignBased = input.isCampaignBased;
      if (input.published !== undefined) payload.isPublished = input.published;
      return toDynamicContent(await write(`/dynamiccontents/${requiredId(id)}/edit`, 'dynamicContent', 'PATCH', payload));
    },

    async deleteDynamicContent(id: number): Promise<void> {
      await remove(`/dynamiccontents/${requiredId(id)}/delete`);
    },

    async focusItems(): Promise<FocusItem[]> {
      const response = await request('/focus?limit=100');
      const origin = focusOrigin();
      return items(response.focus)
        .map(entry => toFocusItem(entry, origin))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async createFocusItem(input: FocusItemInput): Promise<FocusItem> {
      const name = requiredText(input.name, 'Enter a focus item name.');
      const type = focusType(input.type);
      const style = focusStyle(input.style);
      return toFocusItem(await write('/focus/new', 'focus', 'POST', {
        name,
        description: input.description ?? '',
        type,
        style,
        htmlMode: 'basic',
        ...(type === 'form' && input.formId ? { form: requiredId(input.formId) } : {}),
        isPublished: input.published ?? true,
        properties: {
          animate: 1,
          when: input.when ?? 'immediately',
          [style]: focusStyleOptions(style),
          content: {
            headline: input.headline ?? name,
            tagline: input.tagline ?? '',
            link_text: input.linkText ?? '',
            link_url: input.linkUrl ?? '',
            link_new_window: 0,
          },
          colors: {
            primary: stripHash(input.primaryColor ?? '2457d6') || '2457d6',
            text: stripHash(input.textColor ?? '111827') || '111827',
            button: stripHash(input.buttonColor ?? '2457d6') || '2457d6',
            button_text: stripHash(input.buttonTextColor ?? 'ffffff') || 'ffffff',
          },
        },
      }), focusOrigin());
    },

    async updateFocusItem(id: number, input: Partial<FocusItemInput>): Promise<FocusItem> {
      const payload: ApiRecord = {};
      const properties: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a focus item name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.type !== undefined) payload.type = focusType(input.type);
      if (input.style !== undefined) {
        const style = focusStyle(input.style);
        payload.style = style;
        properties[style] = focusStyleOptions(style);
      }
      if (input.formId !== undefined) payload.form = input.formId === null ? null : requiredId(input.formId);
      if (input.published !== undefined) payload.isPublished = input.published;
      if (input.when !== undefined) properties.when = input.when;

      const content: ApiRecord = {};
      if (input.headline !== undefined) content.headline = input.headline;
      if (input.tagline !== undefined) content.tagline = input.tagline;
      if (input.linkText !== undefined) content.link_text = input.linkText;
      if (input.linkUrl !== undefined) content.link_url = input.linkUrl;
      if (Object.keys(content).length) properties.content = content;

      const colors: ApiRecord = {};
      if (input.primaryColor !== undefined) colors.primary = stripHash(input.primaryColor);
      if (input.textColor !== undefined) colors.text = stripHash(input.textColor);
      if (input.buttonColor !== undefined) colors.button = stripHash(input.buttonColor);
      if (input.buttonTextColor !== undefined) colors.button_text = stripHash(input.buttonTextColor);
      if (Object.keys(colors).length) properties.colors = colors;

      if (Object.keys(properties).length) payload.properties = properties;
      return toFocusItem(await write(`/focus/${requiredId(id)}/edit`, 'focus', 'PATCH', payload), focusOrigin());
    },

    async deleteFocusItem(id: number): Promise<void> {
      await remove(`/focus/${requiredId(id)}/delete`);
    },

    reports,

    async report(id: number, limit = 50): Promise<MarketingReportData> {
      const reportId = requiredId(id);
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new UpstreamError(service, 400, 'Choose a valid report row limit.');
      }
      const [response, allReports] = await Promise.all([
        request(`/reports/${reportId}?limit=${limit}`),
        reports().catch(() => [] as MarketingReport[]),
      ]);
      const meta = allReports.find(entry => entry.id === reportId);
      return toMarketingReportData(response, reportId, meta);
    },

    async contactCompanies(contactId: number): Promise<ContactLinkedCompany[]> {
      const response = await request(`/contacts/${requiredId(contactId)}/companies`);
      const raw = response.companies;
      if (!raw || typeof raw !== 'object') throw new UpstreamError(service, 502);
      return Object.values(raw)
        .map(entry => toContactLinkedCompany(record(entry)))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
    },

    async contactDevices(contactId: number): Promise<ContactDevice[]> {
      const response = await request(`/contacts/${requiredId(contactId)}/devices`);
      return items(response.devices)
        .map(toContactDevice)
        .sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || b.id - a.id);
    },

    async sendEmailToContact(emailId: number, contactId: number): Promise<void> {
      const response = record(await request(`/emails/${requiredId(emailId)}/contact/${requiredId(contactId)}/send`, 'POST'));
      if (response.success === false) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm sending the email.');
      }
    },
  };
}

export const mautic = createMautic();
