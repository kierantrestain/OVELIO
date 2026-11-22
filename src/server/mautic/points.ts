import { pointTriggerEventTypes } from '../../contracts';
import type { PointAction, PointActionInput, PointTrigger, PointTriggerEventInput, PointTriggerInput } from '../../contracts';
import { UpstreamError } from '../upstream';
import { record, requiredId, service, toPointAction, toPointTrigger, type ApiRecord } from './normalize';
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

export function pointsApi(client: Client) {
  const { request, list, get, write, remove } = client;
  return {
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
