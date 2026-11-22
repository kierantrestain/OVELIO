import type { FormSubmission, LeadForm, LeadFormInput, Page } from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, items, published, requiredId, service, toFormSubmission, total, type ApiRecord } from './normalize';
import { defaultFormFields, requiredText, plainFormMessage, buildFormFields } from './helpers';
import type { Client } from './client';

export function formsApi(client: Client) {
  const { request, list, write, remove, toForm } = client;
  return {
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
  };
}
