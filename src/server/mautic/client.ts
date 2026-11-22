import type { LeadForm, MarketingReport } from '../../contracts';
import { appOrigin } from '../config';
import { basic, upstream, UpstreamError } from '../upstream';
import {
  item, items, published, record, requiredId, service, text, toContact, toFormField,
  toMarketingReport, toSegment, total, type ApiRecord,
} from './normalize';
import { maxPage, queryPath, conditions } from './helpers';
import type { Config, Where } from './helpers';

// Authenticated transport and shared lookups for every Mautic adapter module.
export function createClient(config: Config) {
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
    config,
    baseUrl,
    focusOrigin,
    request,
    list,
    get,
    write,
    remove,
    contact,
    segment,
    reports,
    memberships,
    tally,
    toForm,
  };
}

export type Client = ReturnType<typeof createClient>;
