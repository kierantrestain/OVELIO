import type {
  Company, CompanyInput, Contact, ContactDetail, ContactDevice, ContactInput, ContactLinkedCompany,
  ContactNote, ContactNoteInput, CustomField, CustomFieldInput, CustomFieldObject, DateRange, Page,
  Point, Segment, Stage, StageInput, Tag, ContactTimeline, TimelineQuery,
} from '../../contracts';
import { UpstreamError } from '../upstream';
import {
  date, flag, item, items, number, positiveId, record, requiredId, service, text, toCompany,
  toContact, toContactDevice, toContactLinkedCompany, toContactNote, toCustomField, toStage, toTag,
  total, type ApiRecord,
} from './normalize';
import { day, maxPage, maxContactPage, contactSortColumns, contactSearch, suppressionCodes, queryPath, conditions, dates, sortContacts, requiredText, contactPayload, companyPayload, wantedTags, fieldObject, customValues } from './helpers';
import type { SuppressionReason, ContactQuery, Where } from './helpers';
import type { Client } from './client';

export function contactsApi(client: Client) {
  const { request, list, write, remove, contact, segment, memberships, tally } = client;

  // Field definitions rarely change, so a long import reads them once every few seconds instead of once per row.
  let definitions: { at: number; fields: CustomField[] } | undefined;
  async function contactFieldDefinitions() {
    if (definitions && Date.now() - definitions.at < 10_000) return definitions.fields;
    const response = await request('/fields/contact?limit=200');
    const fields = items(response.fields).map(entry => toCustomField(entry, 'contact')).filter(field => field.published);
    definitions = { at: Date.now(), fields };
    return fields;
  }

  async function checkedCustomFields(input: ContactInput) {
    const values = input.customFields;
    if (!values || !Object.keys(values).length) return undefined;
    return customValues(values, await contactFieldDefinitions());
  }

  // Mautic's full activity feed: every event type the timeline subscribers report, filtered and paged by the engine.
  async function contactTimeline(id: number, { search, include, exclude, page = 1, limit = 25, dir = 'desc' }: TimelineQuery = {}): Promise<ContactTimeline> {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1) {
      throw new UpstreamError(service, 400, 'Choose a valid timeline page.');
    }
    limit = Math.min(limit, 100);
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    query.set('order[0]', 'timestamp');
    query.set('order[1]', dir === 'asc' ? 'ASC' : 'DESC');
    const word = search?.replace(/[<>]/g, ' ').trim();
    if (word) query.set('filters[search]', word);
    for (const type of include ?? []) query.append('filters[includeEvents][]', type);
    for (const type of exclude ?? []) query.append('filters[excludeEvents][]', type);
    const response = await request(queryPath(`/contacts/${requiredId(id)}/activity`, query));
    if (!Array.isArray(response.events)) throw new UpstreamError(service, 502);
    const types: Record<string, string> = {};
    for (const [key, value] of Object.entries(record(response.types))) if (typeof value === 'string') types[key] = value;
    const events = response.events.map(record).flatMap((event, index) => {
      const at = date(event.timestamp);
      const type = text(event.event);
      const label = text(event.eventLabel) || text(record(event.eventLabel).label) || text(event.eventType) || type;
      const href = text(record(event.eventLabel).href);
      const key = `${type}:${text(event.eventId) || number(event.eventId) || index}:${event.timestamp}`;
      return at && label ? [{ id: key, type, typeLabel: types[type] || text(event.eventType) || type, label, at, ...(/^https?:/.test(href) ? { href } : {}) }] : [];
    });
    return { events, types, total: total(response), page, limit };
  }

  return {
    async contacts({ page = 1, limit = 25, search, segmentId, tag, orderBy, orderByDir }: ContactQuery = {}): Promise<Page<Contact>> {
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1) {
        throw new UpstreamError(service, 400, 'Choose a valid contact page.');
      }
      limit = Math.min(limit, maxContactPage);
      const column = orderBy ? contactSortColumns[orderBy] : undefined;
      if (orderBy && !column) throw new UpstreamError(service, 400, 'Choose a column that can be sorted.');
      const filters = [];
      if (segmentId !== undefined) {
        const source = await segment(segmentId);
        if (!source.alias || /"/.test(source.alias)) throw new UpstreamError(service, 502);
        filters.push(`segment:"${source.alias}"`);
      }
      const cleanTag = tag?.replace(/["<>]/g, ' ').trim();
      if (cleanTag) filters.push(`tag:"${cleanTag}"`);
      const term = contactSearch(search);
      if (term) filters.push(term);
      // Anonymous visitors stay hidden unless the search asks for them.
      const wantsAnonymous = /(^|\s)is:anonymous(\s|$)/i.test(term) && !/(^|\s)!is:anonymous/i.test(term);
      const base = new URLSearchParams({
        orderBy: column ?? 'l.date_added,l.id', orderByDir: (orderByDir ?? 'desc').toUpperCase(),
      });
      if (filters.length) base.set('search', filters.join(' '));
      if (!wantsAnonymous) conditions(base, [['l.date_identified', 'isNotNull']]);
      // The engine may cap one response, so a large page is read in chunks of maxPage.
      const found: Contact[] = [];
      let count = 0;
      const first = (page - 1) * limit;
      while (found.length < limit) {
        const size = Math.min(maxPage, limit - found.length);
        const query = new URLSearchParams(base);
        query.set('start', String(first + found.length));
        query.set('limit', String(size));
        const response = await request(queryPath('/contacts', query));
        const batch = items(response.contacts).map(toContact);
        count = total(response);
        found.push(...batch);
        if (batch.length < size) break;
      }
      return { items: column ? found : found.sort(sortContacts), total: count, page, limit };
    },

    contact,

    // Checks a contact's custom field values against the field definitions without saving anything (used by import dry runs).
    async checkContactFields(input: ContactInput) {
      await checkedCustomFields(input);
    },

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
      const custom = await checkedCustomFields(input);
      return toContact(await write('/contacts/new', 'contact', 'POST', contactPayload(input, tags, custom)));
    },

    async updateContact(id: number, input: ContactInput) {
      const custom = await checkedCustomFields(input);
      let changes: string[] | undefined;
      if (input.tags !== undefined) {
        const tags = wantedTags(input.tags);
        const current = await contact(id);
        changes = [...tags, ...current.tags.filter(tag => !tags.includes(tag)).map(tag => `-${tag}`)];
      }
      return toContact(await write(`/contacts/${requiredId(id)}/edit`, 'contact', 'PATCH', contactPayload(input, changes, custom)));
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

    async contactSegments(id: number): Promise<Segment[]> {
      const ids = await memberships(id);
      return (await Promise.all(ids.map(segment))).sort((a, b) => a.name.localeCompare(b.name));
    },

    async contactSegmentMembership(id: number, segmentId: number) {
      return (await memberships(id)).includes(requiredId(segmentId));
    },

    async contactActivity(id: number): Promise<ContactDetail['activity']> {
      const { events } = await contactTimeline(id, { limit: 25 });
      return events.map(event => ({ at: event.at, label: event.label, type: event.type }));
    },

    contactTimeline,

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
  };
}
