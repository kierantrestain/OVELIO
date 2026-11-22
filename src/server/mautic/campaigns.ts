import type { JourneyEmail, JourneyEmailInput, Workflow, WorkflowContact, WorkflowInput } from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, published, record, requiredId, service, toWorkflowContact, type ApiRecord } from './normalize';
import { managedSteps, toWorkflow, verifySavedWorkflow, workflowPayload } from './workflows';
import { allowedEmail, withUnsubscribeLink, toEmail } from './helpers';
import type { Client } from './client';

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

    async sendEmailToContact(emailId: number, contactId: number): Promise<void> {
      const response = record(await request(`/emails/${requiredId(emailId)}/contact/${requiredId(contactId)}/send`, 'POST'));
      if (response.success === false) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm sending the email.');
      }
    },
  };
}
