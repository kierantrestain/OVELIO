import { validateWorkflowGraph } from '../../contracts';
import type {
  JourneyEmail, JourneyEmailInput, MarketingMessage, Workflow, WorkflowContact, WorkflowContactRun, WorkflowGraph,
  WorkflowInput, WorkflowRunEntry, WorkflowRunLog,
} from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, number, positiveId, published, record, requiredId, service, text, toWorkflowContact, total, type ApiRecord } from './normalize';
import {
  campaignGraph, eventLogEntries, graphPayload, linearChain, membershipOf, mergeRunEntries, stepsGraph, timelineLogEntries,
  toWorkflow, verifySavedGraph, workflowReferences, type WorkflowReference, type WorkflowReferenceKind,
} from './workflows';
import { allowedEmail, queryPath, withUnsubscribeLink, toEmail } from './helpers';
import type { Client } from './client';

/** AUT-06 fetch caps: rows per REST page, REST rows in all, activity rows per page and activity pages. */
const logPage = 200;
const logCap = 1000;
const activityPage = 100;
const activityPages = 5;

/** Mautic REST path and response key for each referenced record (each bundle's Api controller entityNameOne). */
const referenceEndpoints: Record<WorkflowReferenceKind, [path: string, key: string, noun: string]> = {
  email: ['/emails', 'email', 'email'],
  userEmail: ['/emails', 'email', 'email'],
  segment: ['/segments', 'list', 'segment'],
  stage: ['/stages', 'stage', 'stage'],
  publishedStage: ['/stages', 'stage', 'stage'],
  company: ['/companies', 'company', 'company'],
  user: ['/users', 'user', 'user'],
  form: ['/forms', 'form', 'lead form'],
  pointGroup: ['/points/groups', 'pointGroup', 'point group'],
  campaign: ['/campaigns', 'campaign', 'workflow'],
  page: ['/pages', 'page', 'landing page'],
  dynamicContent: ['/dynamiccontents', 'dynamicContent', 'dynamic content item'],
  focus: ['/focus', 'focus', 'popup or bar'],
  message: ['/messages', 'message', 'marketing message'],
};

/** Why a referenced record blocks activation, or null when it is fine. */
function referenceProblem(reference: WorkflowReference, dto: ApiRecord | null): string | null {
  const noun = referenceEndpoints[reference.kind][2];
  const where = `“${reference.node}”`;
  if (!dto) return `${where} uses ${noun} #${reference.id}, which no longer exists.`;
  switch (reference.kind) {
    case 'email':
      return allowedEmail(dto) && published(dto) ? null : `${where} sends email #${reference.id}. Publish it and include an unsubscribe link.`;
    case 'userEmail':
      return published(dto) ? null : `${where} sends email #${reference.id}. Publish it first.`;
    case 'publishedStage':
      // StageBundle/EventListener/CampaignSubscriber.php:52-56 skips contacts when the stage is unpublished.
      return published(dto) ? null : `${where} moves contacts to stage #${reference.id}, which is unpublished.`;
    case 'form': {
      const fields = Array.isArray(dto.fields) ? dto.fields : Object.values(record(dto.fields));
      const aliases = fields.map(field => text(record(field).alias));
      // FormBundle/EventListener/CampaignSubscriber.php:121-123 reads the field's type, so a missing field breaks the step.
      return reference.field && !aliases.includes(reference.field)
        ? `${where} checks the field “${reference.field}”, which lead form #${reference.id} no longer has.` : null;
    }
    default:
      return null;
  }
}

function asNewGraph(graph: WorkflowGraph): WorkflowGraph {
  const rename = (nodeId: string) => /^\d+$/.test(nodeId) ? `new${nodeId}` : nodeId;
  const ids = new Set(graph.nodes.map(node => node.id));
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      // A jump step names its target by id, so it follows the target's new temporary id.
      const target = node.type === 'campaign.jump_to_event' ? String(node.properties.jumpToEvent ?? '') : '';
      const properties = target && ids.has(target) ? { ...node.properties, jumpToEvent: rename(target) } : node.properties;
      return { ...node, id: rename(node.id), parentId: node.parentId === null ? null : rename(node.parentId), properties };
    }),
  };
}

export function campaignsApi(client: Client) {
  const { request, list, get, write, remove, segment } = client;

  /** A referenced record, or null when the engine says it does not exist. */
  async function lookup(kind: WorkflowReferenceKind, id: number): Promise<ApiRecord | null> {
    const [path, key] = referenceEndpoints[kind];
    try {
      const dto = record((await request(`${path}/${requiredId(id)}`))[key]);
      return positiveId(dto.id) ? dto : null;
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) return null;
      throw error;
    }
  }

  /** AUT-06: REST event-log rows, paged until the engine's total or the cap. */
  async function restLog(path: string) {
    const rows: WorkflowRunEntry[] = [];
    let response: ApiRecord = {};
    let complete = false;
    for (let start = 0; start < logCap; start += logPage) {
      response = await request(queryPath(path, new URLSearchParams({ start: String(start), limit: String(logPage) })));
      const available = total(response);
      rows.push(...eventLogEntries(response));
      const raw = response.events;
      const size = Array.isArray(raw) ? raw.length : raw && typeof raw === 'object' ? Object.keys(raw).length : 0;
      if (!size || start + size >= available) {
        complete = true;
        break;
      }
    }
    return { rows, response, complete };
  }

  /** AUT-06: campaign rows from the contact's activity feed, which also covers rows written by cron. */
  async function activityLog(contactId: number) {
    const rows: WorkflowRunEntry[] = [];
    for (let page = 1; page <= activityPages; page += 1) {
      const query = new URLSearchParams({ page: String(page), limit: String(activityPage) });
      query.set('order[0]', 'timestamp');
      query.set('order[1]', 'DESC');
      query.append('filters[includeEvents][]', 'campaign.event');
      query.append('filters[includeEvents][]', 'campaign.event.scheduled');
      const response = await request(queryPath(`/contacts/${requiredId(contactId)}/activity`, query));
      if (!Array.isArray(response.events)) throw new UpstreamError(service, 502);
      rows.push(...timelineLogEntries(response.events));
      const maxPages = number(response.maxPages) ?? page;
      if (response.events.length < activityPage || page >= maxPages) return { rows, complete: true };
    }
    return { rows, complete: false };
  }

  async function activityOrPartial(contactId: number) {
    try {
      return await activityLog(contactId);
    } catch (error) {
      if (error instanceof UpstreamError && error.status !== 401) return { rows: [] as WorkflowRunEntry[], complete: false };
      throw error;
    }
  }

  return {
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
      // A new campaign has no saved events, so every step goes in with a temporary id (CampaignModel.php:226-234).
      const graph = input.graph ? asNewGraph(input.graph) : stepsGraph(input);
      const { payload, expected } = graphPayload(graph, { name: input.name, description: input.description });
      const dto = await write('/campaigns/new', 'campaign', 'POST', payload);
      return verifySavedGraph(dto, expected);
    },

    async updateWorkflow(id: number, input: WorkflowInput) {
      const previous = await get('/campaigns', 'campaign', id);
      const parsed = campaignGraph(previous);
      if (parsed.problem || !parsed.graph.nodes.length) {
        throw new UpstreamError(service, 409, parsed.problem ?? 'This automation cannot be changed from the console.');
      }
      if (flag(previous.isPublished)) {
        throw new UpstreamError(service, 409, 'Pause an editable automation before changing its steps.');
      }
      let graph: WorkflowGraph;
      if (input.graph) {
        // AUT-02: a PUT deletes every saved step it leaves out (CampaignApiController.php:203-219), so only steps the
        // editor deleted on purpose may be missing, and every saved id it sends must still exist.
        const savedIds = new Set(parsed.graph.nodes.map(node => node.id));
        const sentIds = new Set(input.graph.nodes.filter(node => /^\d+$/.test(node.id)).map(node => node.id));
        const removed = new Set(input.removedNodeIds ?? []);
        const dropped = [...savedIds].filter(savedId => !sentIds.has(savedId) && !removed.has(savedId));
        const unknown = [...sentIds].filter(sentId => !savedIds.has(sentId));
        if (dropped.length || unknown.length) {
          throw new UpstreamError(service, 409, 'This automation changed since you opened it. Reload it and try again.');
        }
        graph = input.graph;
      } else {
        if (!linearChain(parsed.graph)) {
          throw new UpstreamError(service, 409, 'This automation has branches. Open it in the canvas editor to change it.');
        }
        graph = stepsGraph(input, parsed.graph);
      }
      const { payload, expected } = graphPayload(graph, { name: input.name, description: input.description, retiredIds: parsed.retiredIds });
      const dto = await write(`/campaigns/${requiredId(id)}/edit`, 'campaign', 'PUT', payload);
      return verifySavedGraph(dto, expected);
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
        const { graph, problem } = campaignGraph(current);
        if (problem || !graph.nodes.length) throw new UpstreamError(service, 409, 'This automation cannot be activated from the console.');
        const blocking = validateWorkflowGraph(graph).find(issue => issue.level === 'error');
        if (blocking) throw new UpstreamError(service, 409, `Fix the workflow before activating it: ${blocking.message}`);
        // AUT-03 / AUT-05: every record a step points at, on every branch, must exist (and be published where the
        // engine needs it). Source segments must be published; unknown steps are left to the engine.
        const references = workflowReferences(graph);
        const unique = [...new Map(references.map(reference => [`${reference.kind}:${reference.id}`, reference])).values()];
        const [sources, records] = await Promise.all([
          Promise.all(graph.segmentIds.map(segmentId => segment(segmentId))),
          Promise.all(unique.map(reference => lookup(reference.kind, reference.id))),
        ]);
        const found = new Map(unique.map((reference, index) => [`${reference.kind}:${reference.id}`, records[index]]));
        const emailProblem = references.some(reference => reference.kind === 'email' && referenceProblem(reference, found.get(`email:${reference.id}`) ?? null));
        if (sources.some(source => !source.published) || emailProblem) {
          throw new UpstreamError(service, 409, 'Publish the audience segment and use published emails with an unsubscribe link.');
        }
        const problems = [...new Set(references
          .map(reference => referenceProblem(reference, found.get(`${reference.kind}:${reference.id}`) ?? null))
          .filter((problem): problem is string => Boolean(problem)))];
        if (problems.length) {
          throw new UpstreamError(service, 409, `Fix the workflow before activating it: ${problems.slice(0, 3).join(' ')}${problems.length > 3 ? ` (${problems.length - 3} more)` : ''}`);
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

    async workflow(id: number): Promise<Workflow> {
      return toWorkflow(await get('/campaigns', 'campaign', id));
    },

    /** Marketing messages for the "Send marketing message" step (ChannelBundle Config/config.php:29-35). */
    async marketingMessages(): Promise<MarketingMessage[]> {
      return (await list('/messages', 'messages'))
        .map(dto => ({ id: requiredId(dto.id), name: text(dto.name) || `Message ${dto.id}`, published: published(dto) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** AUT-06: every workflow step the engine logged for one contact, newest first. */
    async contactWorkflowLog(contactId: number): Promise<WorkflowRunLog> {
      const id = requiredId(contactId);
      const [rest, activity] = await Promise.all([restLog(`/campaigns/events/contact/${id}`), activityOrPartial(id)]);
      return { contactId: id, entries: mergeRunEntries(rest.rows, activity.rows), complete: rest.complete && activity.complete };
    },

    /** AUT-06: one contact in one workflow, with their membership row. */
    async workflowContactLog(workflowId: number, contactId: number): Promise<WorkflowContactRun> {
      const campaignId = requiredId(workflowId);
      const id = requiredId(contactId);
      const [rest, activity] = await Promise.all([
        restLog(`/campaigns/${campaignId}/events/contact/${id}`).catch(error => {
          // EventLogApiController.php:109-119 answers 409 when the contact was never in the workflow.
          if (error instanceof UpstreamError && error.status === 409) return null;
          throw error;
        }),
        activityOrPartial(id),
      ]);
      const entries = mergeRunEntries(rest?.rows ?? [], activity.rows).filter(entry => entry.workflowId === campaignId);
      return {
        contactId: id,
        workflowId: campaignId,
        membership: rest ? membershipOf(rest.response.membership) : null,
        entries,
        complete: (rest?.complete ?? true) && activity.complete,
      };
    },

    async sendEmailToContact(emailId: number, contactId: number): Promise<void> {
      const response = record(await request(`/emails/${requiredId(emailId)}/contact/${requiredId(contactId)}/send`, 'POST'));
      if (response.success === false) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm sending the email.');
      }
    },
  };
}
