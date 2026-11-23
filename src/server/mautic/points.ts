import { pointTriggerEventTypes } from '../../contracts';
import type { PointAction, PointActionInput, PointTrigger, PointTriggerEventInput, PointTriggerInput } from '../../contracts';
import { UpstreamError } from '../upstream';
import { items, record, requiredId, service, text, toPointAction, toPointTrigger, type ApiRecord } from './normalize';
import { requiredText } from './helpers';
import type { Client } from './client';

const eventLabels: Record<string, string> = {
  'lead.changelists': 'Change segments',
  'lead.changetags': 'Change tags',
  'lead.changestage': 'Change lifecycle stage',
  'email.send': 'Send email to contact',
  'email.send_to_user': 'Send email to user',
  'campaign.changecampaign': 'Change campaigns',
  'plugin.leadpush': 'Push contact to integration',
};

const coreActionTypes: Record<string, string> = {
  'email.open': 'Opens an email', 'email.send': 'Is sent an email', 'form.submit': 'Submits a form',
  'page.hit': 'Visits a landing page', 'url.hit': 'Visits a tracked URL', 'asset.download': 'Downloads an asset',
};

const ids = (value: unknown, message: string) => {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const result = list.map(entry => Number(entry));
  if (result.some(entry => !Number.isSafeInteger(entry) || entry < 1)) throw new UpstreamError(service, 400, message);
  return [...new Set(result)];
};

const names = (value: unknown, message: string) => {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  if (list.some(entry => typeof entry !== 'string' || entry.length > 70 || entry.startsWith('-'))) {
    throw new UpstreamError(service, 400, message);
  }
  return [...new Set((list as string[]).map(entry => entry.trim()).filter(Boolean))];
};

// Builds the event the trigger endpoint expects: a type plus the properties for that type, keyed as Mautic's own forms key them.
export function triggerEventPayload(event: PointTriggerEventInput) {
  const type = event.type;
  if (!(pointTriggerEventTypes as readonly string[]).includes(type)) {
    throw new UpstreamError(service, 400, 'Choose a valid trigger event type.');
  }
  const raw = event.properties ?? {};
  let properties: Record<string, unknown>;
  switch (type) {
    case 'lead.changelists': {
      const addToLists = ids(raw.addToLists, 'Choose valid segments.');
      const removeFromLists = ids(raw.removeFromLists, 'Choose valid segments.');
      if (!addToLists.length && !removeFromLists.length) throw new UpstreamError(service, 400, 'Choose at least one segment to add or remove.');
      properties = { addToLists, removeFromLists };
      break;
    }
    case 'lead.changetags': {
      const add_tags = names(raw.add_tags, 'Enter valid tag names.');
      const remove_tags = names(raw.remove_tags, 'Enter valid tag names.');
      if (!add_tags.length && !remove_tags.length) throw new UpstreamError(service, 400, 'Choose at least one tag to add or remove.');
      properties = { add_tags, remove_tags };
      break;
    }
    case 'lead.changestage': {
      const [addstage] = ids(raw.addstage, 'Choose a lifecycle stage.');
      if (!addstage) throw new UpstreamError(service, 400, 'Choose a lifecycle stage.');
      properties = { addstage };
      break;
    }
    case 'email.send': {
      const [email] = ids(raw.email, 'Choose an email to send.');
      if (!email) throw new UpstreamError(service, 400, 'Choose an email to send.');
      properties = { email };
      break;
    }
    case 'email.send_to_user': {
      const useremail = raw.useremail && typeof raw.useremail === 'object' ? (raw.useremail as Record<string, unknown>).email : raw.email;
      const [email] = ids(useremail, 'Choose an email to send.');
      if (!email) throw new UpstreamError(service, 400, 'Choose an email to send.');
      const user_id = ids(raw.user_id, 'Enter valid user ids.');
      const to_owner = raw.to_owner === true || raw.to_owner === 1 || raw.to_owner === '1';
      const addresses = (key: string) => {
        const value = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
        if (value.length > 500) throw new UpstreamError(service, 400, 'Shorten the recipient list.');
        return value;
      };
      if (!user_id.length && !to_owner && !addresses('to')) {
        throw new UpstreamError(service, 400, 'Choose who receives the email: a user, the contact owner or an address.');
      }
      properties = { useremail: { email }, user_id, to_owner, to: addresses('to'), cc: addresses('cc'), bcc: addresses('bcc') };
      break;
    }
    case 'campaign.changecampaign': {
      const addTo = ids(raw.addTo, 'Choose valid campaigns.');
      const removeFrom = ids(raw.removeFrom, 'Choose valid campaigns.');
      if (!addTo.length && !removeFrom.length) throw new UpstreamError(service, 400, 'Choose at least one campaign to add to or remove from.');
      properties = { addTo, removeFrom };
      break;
    }
    default: {
      const integration = typeof raw.integration === 'string' ? raw.integration.trim() : '';
      if (!integration || integration.length > 100) throw new UpstreamError(service, 400, 'Enter the integration name.');
      properties = { integration };
    }
  }
  const eventId = event.id === undefined ? undefined : requiredId(event.id);
  return {
    ...(eventId ? { id: eventId } : {}),
    name: event.name?.trim() || eventLabels[type],
    type,
    properties,
  };
}

const timeUnit = (value: unknown) => typeof value === 'string' && /^[A-Za-z]$/.test(value) ? value : 'H';

// Builds the `properties` a point action stores, keyed as the engine's own subscribers read them. An empty list means "any".
export function pointActionProperties(type: string, raw: Record<string, unknown> = {}): Record<string, unknown> {
  switch (type) {
    case 'email.open':
    case 'email.send': return { emails: ids(raw.emails, 'Choose valid emails.') };
    case 'form.submit': return { forms: ids(raw.forms, 'Choose valid forms.') };
    case 'page.hit': return { pages: ids(raw.pages, 'Choose valid pages.') };
    case 'asset.download': return { assets: ids(raw.assets, 'Choose valid assets.') };
    case 'url.hit': {
      const page_url = typeof raw.page_url === 'string' ? raw.page_url.trim() : '';
      if (!page_url || page_url.length > 500) throw new UpstreamError(service, 400, 'Enter the URL that earns points.');
      const hits = raw.page_hits === undefined || raw.page_hits === '' ? 0 : Number(raw.page_hits);
      if (!Number.isSafeInteger(hits) || hits < 0) throw new UpstreamError(service, 400, 'Enter a whole number of hits.');
      const span = (key: string) => {
        const value = raw[key] === undefined || raw[key] === '' || raw[key] === null ? '' : String(raw[key]).trim();
        if (value && !/^\d{1,6}$/.test(value)) throw new UpstreamError(service, 400, 'Enter whole numbers for the time limits.');
        return value;
      };
      return {
        page_url, page_hits: hits, first_time: raw.first_time === true || raw.first_time === 1 || raw.first_time === '1',
        accumulative_time: span('accumulative_time'), accumulative_time_unit: timeUnit(raw.accumulative_time_unit),
        returns_within: span('returns_within'), returns_within_unit: timeUnit(raw.returns_within_unit),
        returns_after: span('returns_after'), returns_after_unit: timeUnit(raw.returns_after_unit),
      };
    }
    default:
      // Types added by plugins carry their own keys; pass simple values through untouched.
      return Object.fromEntries(Object.entries(raw).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value)));
  }
}

const groupId = (value: unknown) => {
  if (value === null) return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new UpstreamError(service, 400, 'Choose a valid point group.');
  return id;
};

export function pointsApi(client: Client) {
  const { request, list, get, write, remove } = client;
  return {
    async pointActions(): Promise<PointAction[]> {
      return (await list('/points', 'points')).map(toPointAction).sort((a, b) => a.name.localeCompare(b.name));
    },

    async pointGroups(): Promise<{ id: number; name: string }[]> {
      const response = await request('/points/groups?limit=200');
      return items(response.pointGroups).map(group => ({ id: requiredId(group.id), name: text(group.name) || `Group ${group.id}` }));
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
      // The six core types always show, even if the engine's list omits one (EmailBundle PointSubscriber registers email.send).
      for (const [key, label] of Object.entries(coreActionTypes)) flat[key] ??= label;
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
        properties: pointActionProperties(type, input.properties),
        repeatable: input.repeatable ?? false,
        ...(input.groupId !== undefined ? { group: groupId(input.groupId) } : {}),
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
      if (input.repeatable !== undefined) payload.repeatable = input.repeatable;
      if (input.groupId !== undefined) payload.group = groupId(input.groupId);
      if (input.properties !== undefined) {
        const type = input.type ?? text(record(await get('/points', 'point', id)).type);
        payload.properties = pointActionProperties(type, input.properties);
      }
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
        ...(input.events?.length ? { events: input.events.map(event => triggerEventPayload({ ...event, id: undefined })) } : {}),
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
      if (input.events === undefined) {
        // A PATCH without events leaves the trigger's events as they are.
        return toPointTrigger(await write(`/points/triggers/${requiredId(id)}/edit`, 'trigger', 'PATCH', payload));
      }
      // Mautic only removes events that are missing from a PUT, so replace the whole trigger.
      const current = toPointTrigger(await get('/points/triggers', 'trigger', id));
      const known = new Set(current.events.map(event => event.id));
      const events = input.events.map(event => triggerEventPayload({ ...event, id: event.id && known.has(event.id) ? event.id : undefined }));
      return toPointTrigger(await write(`/points/triggers/${requiredId(id)}/edit`, 'trigger', 'PUT', {
        name: current.name,
        description: current.description,
        points: current.points,
        isPublished: current.published,
        triggerExistingLeads: current.triggerExistingLeads,
        ...payload,
        events,
      }));
    },

    async deletePointTrigger(id: number): Promise<void> {
      await remove(`/points/triggers/${requiredId(id)}/delete`);
    },
  };
}
