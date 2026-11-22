import type {
  Contact, ContactDetail, ContactInput, DateRange, Health, JourneyEmail, LeadForm,
  Page, Point, Segment, SegmentInput, Workflow, WorkflowInput,
} from '../../contracts';
import { basic, upstream, UpstreamError } from '../upstream';
import {
  date, flag, item, items, published, record, requiredId, service,
  text, toContact, toSegment, total, type ApiRecord,
} from './normalize';
import { managedSteps, toWorkflow, verifySavedWorkflow, workflowPayload } from './workflows';

type Config = { url?: string; username?: string; password?: string; fetch?: typeof fetch };
type SuppressionReason = 'unsubscribe' | 'bounce' | 'complaint' | 'erasure';
type ContactQuery = { page?: number; limit?: number; search?: string; segmentId?: number };
type Where = [column: string, expression: string, value?: string | number];
type JourneyEmailInput = { name: string; subject: string; body: string };
type LeadFormInput = { name: string; message?: string };

const day = 86400000;
const maxPage = 100;
const unsubscribeLink = /<a\s+[^>]*href\s*=\s*["']\{unsubscribe_url\}["']/i;
const suppressionCodes = { unsubscribe: 1, bounce: 2, complaint: 3, erasure: 3 };

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

function contactPayload(input: ContactInput, tags?: string[]) {
  return {
    email: input.email.trim().toLowerCase(),
    firstname: input.firstName,
    lastname: input.lastName,
    company: input.company,
    tags,
    ...(input.firstName === '' || input.lastName === '' || input.company === '' ? { overwriteWithBlank: true } : {}),
  };
}

function wantedTags(tags: string[]) {
  const cleaned = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  if (cleaned.some(tag => tag.startsWith('-'))) throw new UpstreamError(service, 400, 'A tag cannot start with a hyphen.');
  return cleaned;
}

function allowedEmail(dto: ApiRecord) {
  return dto.emailType === 'template' && !flag(dto.sendToDnc) && unsubscribeLink.test(text(dto.customHtml));
}

function toEmail(dto: ApiRecord): JourneyEmail {
  return { id: requiredId(dto.id), name: text(dto.name), subject: text(dto.subject), published: published(dto) };
}

function plainFormMessage(message: string) {
  return message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('{', '&#123;').replaceAll('}', '&#125;');
}

export function createMautic(config: Config = {}) {
  function request(path: string, method = 'GET', input?: object | URLSearchParams) {
    const url = (config.url ?? process.env.MAUTIC_URL ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
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

  async function contact(id: number) {
    return toContact(await get('/contacts', 'contact', id));
  }

  async function segment(id: number) {
    return toSegment(await get('/segments', 'list', id));
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
    return { id, name: text(dto.name), submissions, published: published(dto) };
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

    async contacts({ page = 1, limit = 25, search, segmentId }: ContactQuery = {}): Promise<Page<Contact>> {
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
      try {
        await request(`/contacts/${requiredId(id)}/delete`, 'DELETE');
      } catch (error) {
        if (!(error instanceof UpstreamError) || error.status !== 404) throw error;
      }
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

    async createSegment(input: SegmentInput) {
      return toSegment(await write('/segments/new', 'list', 'POST', {
        name: input.name, description: input.description, isPublished: true,
      }));
    },

    async addToSegment(segmentId: number, contactId: number) {
      await request(`/segments/${requiredId(segmentId)}/contact/${requiredId(contactId)}/add`, 'POST');
    },

    async removeFromSegment(segmentId: number, contactId: number) {
      await request(`/segments/${requiredId(segmentId)}/contact/${requiredId(contactId)}/remove`, 'POST');
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
      const name = input.name.trim();
      if (!name) throw new UpstreamError(service, 400, 'Enter a lead capture form name.');
      const fields = [
        { label: 'First name', type: 'text', alias: 'first_name', mappedObject: 'contact', mappedField: 'firstname', showLabel: true },
        { label: 'Email address', type: 'email', alias: 'email', mappedObject: 'contact', mappedField: 'email', showLabel: true, isRequired: true },
        { label: 'Submit', type: 'button', alias: 'submit' },
      ];
      const dto = await write('/forms/new', 'form', 'POST', {
        name,
        formType: 'standalone',
        postAction: 'message',
        postActionProperty: plainFormMessage(input.message?.trim() || 'Thank you. Your details have been received.'),
        isPublished: true,
        noIndex: true,
        fields,
        actions: [],
      });
      const saved = items(dto.fields);
      if (
        dto.formType !== 'standalone' || !published(dto) || saved.length !== fields.length
        || !fields.every(field => saved.some(current => current.alias === field.alias && current.type === field.type
          && (!field.mappedField || (current.mappedField === field.mappedField && current.mappedObject === 'contact'))
          && (!field.isRequired || flag(current.isRequired))))
      ) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm the published lead capture form and mapped fields.');
      }
      return toForm(dto);
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

    async createEmail(input: JourneyEmailInput) {
      const footer = '<p><a href="{unsubscribe_url}">Unsubscribe from marketing emails</a></p>';
      const customHtml = /<\/body\s*>/i.test(input.body)
        ? input.body.replace(/<\/body\s*>/i, `${footer}</body>`)
        : input.body + footer;
      const dto = await write('/emails/new', 'email', 'POST', {
        name: input.name, subject: input.subject, customHtml, emailType: 'template',
        template: 'mautic_code_mode', language: 'en', isPublished: true, sendToDnc: false,
      });
      if (!allowedEmail(dto) || !published(dto)) {
        throw new UpstreamError(service, 502, 'The engine did not confirm a published automation email with an unsubscribe link.');
      }
      return toEmail(dto);
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

    async setWorkflowEnabled(id: number, enabled: boolean) {
      const current = await get('/campaigns', 'campaign', id);
      if (enabled) {
        const workflow = toWorkflow(current);
        if (!workflow.editable) throw new UpstreamError(service, 409, 'This automation cannot be activated from the step editor.');
        const [source, ...emails] = await Promise.all([
          segment(workflow.segmentId),
          ...workflow.steps.map(step => get('/emails', 'email', step.emailId)),
        ]);
        if (!source.published || emails.some(email => !allowedEmail(email) || !published(email))) {
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
  };
}

export const mautic = createMautic();
