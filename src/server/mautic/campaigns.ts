import { validateWorkflowGraph } from '../../contracts';
import type { JourneyEmail, JourneyEmailInput, Workflow, WorkflowContact, WorkflowGraph, WorkflowInput } from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, positiveId, published, record, requiredId, service, toWorkflowContact, type ApiRecord } from './normalize';
import { campaignGraph, graphPayload, linearChain, stepsGraph, toWorkflow, verifySavedGraph } from './workflows';
import { allowedEmail, withUnsubscribeLink, toEmail } from './helpers';
import type { Client } from './client';

function asNewGraph(graph: WorkflowGraph): WorkflowGraph {
  const rename = (nodeId: string) => /^\d+$/.test(nodeId) ? `new${nodeId}` : nodeId;
  return {
    ...graph,
    nodes: graph.nodes.map(node => ({ ...node, id: rename(node.id), parentId: node.parentId === null ? null : rename(node.parentId) })),
  };
}

export function campaignsApi(client: Client) {
  const { request, list, get, write, remove, segment } = client;
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
        const emailIds = [...new Set(graph.nodes
          .filter(node => node.type === 'email.send')
          .map(node => positiveId(node.properties.email))
          .filter((emailId): emailId is number => emailId !== null))];
        const [sources, emails] = await Promise.all([
          Promise.all(graph.segmentIds.map(segmentId => segment(segmentId))),
          Promise.all(emailIds.map(emailId => get('/emails', 'email', emailId))),
        ]);
        if (sources.some(source => !source.published) || emails.some(email => !allowedEmail(email) || !published(email))) {
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

    async sendEmailToContact(emailId: number, contactId: number): Promise<void> {
      const response = record(await request(`/emails/${requiredId(emailId)}/contact/${requiredId(contactId)}/send`, 'POST'));
      if (response.success === false) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm sending the email.');
      }
    },
  };
}
