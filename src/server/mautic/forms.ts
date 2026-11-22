import type { FormSubmission, LeadForm, LeadFormInput, Page } from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, items, published, requiredId, service, text, toFormSubmission, total, type ApiRecord } from './normalize';
import { requiredText } from './helpers';
import {
  buildFormActions, buildFormFields, defaultFormInputFields, postActionPayload, readFormMessage, toFormActions, toFormFields, values,
} from './form-builder';
import type { Client } from './client';

export function formsApi(client: Client) {
  const { request, list, write, remove, get, tally } = client;

  async function toLeadForm(dto: ApiRecord): Promise<LeadForm> {
    const id = requiredId(dto.id);
    const submissions = await tally('/stats/form_submissions', [['form_id', 'eq', id]]).catch(() => null);
    const postAction = text(dto.postAction);
    return {
      id,
      name: text(dto.name),
      description: text(dto.description),
      submissions,
      published: published(dto),
      fields: toFormFields(dto.fields).filter(field => field.type !== 'button'),
      actions: toFormActions(dto.actions),
      ...(postAction ? { postAction, postActionProperty: postAction === 'message' || postAction === 'hideform'
        ? readFormMessage(text(dto.postActionProperty)) : text(dto.postActionProperty) } : {}),
    };
  }

  async function deleteById(formId: number, kind: 'fields' | 'actions', ids: number[]) {
    if (!ids.length) return;
    await remove(`/forms/${formId}/${kind}/delete?${ids.map(id => `${kind}[]=${id}`).join('&')}`);
  }

  return {
    async forms(): Promise<LeadForm[]> {
      const forms = await list('/forms', 'forms');
      const counts: LeadForm[] = [];
      for (let index = 0; index < forms.length; index += 6) {
        counts.push(...await Promise.all(forms.slice(index, index + 6).map(toLeadForm)));
      }
      return counts.sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Console users that a "send an email to users" action can notify. */
    async formActionUsers(): Promise<{ id: number; name: string; email: string }[]> {
      const users = await list('/users', 'users');
      return users.map(user => ({
        id: requiredId(user.id),
        name: `${text(user.firstName)} ${text(user.lastName)}`.trim() || text(user.username),
        email: text(user.email),
      }));
    },

    async createForm(input: LeadFormInput): Promise<LeadForm> {
      const name = requiredText(input.name, 'Enter a lead capture form name.');
      const wantPublished = input.published ?? true;
      const { fields } = buildFormFields(input.fields?.length ? input.fields : defaultFormInputFields, [], true);
      const { actions } = buildFormActions(input.actions ?? []);
      const dto = await write('/forms/new', 'form', 'POST', {
        name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        formType: 'standalone',
        ...postActionPayload(input, undefined, true),
        isPublished: wantPublished,
        noIndex: true,
        fields,
        actions,
      });
      const saved = items(dto.fields);
      if (
        dto.formType !== 'standalone' || (wantPublished && !published(dto)) || saved.length !== fields.length
        || !fields.every(field => saved.some(current => current.alias === field.alias && current.type === field.type
          && (!field.mappedField || (current.mappedField === field.mappedField && current.mappedObject === field.mappedObject))
          && (!field.isRequired || flag(current.isRequired))))
      ) {
        throw new UpstreamError(service, 502, 'The audience engine did not confirm the published lead capture form and mapped fields.');
      }
      return toLeadForm(dto);
    },

    async updateForm(id: number, input: Partial<LeadFormInput>): Promise<LeadForm> {
      const formId = requiredId(id);
      const current = await get('/forms', 'form', formId);
      const payload: ApiRecord = {};
      if (input.name !== undefined) payload.name = requiredText(input.name, 'Enter a lead capture form name.');
      if (input.description !== undefined) payload.description = input.description;
      if (input.published !== undefined) payload.isPublished = input.published;
      // Mautic resets the post-submit action to "return" when a request omits it, so it is always sent.
      Object.assign(payload, postActionPayload(input, current));
      const existingFields = values(current.fields).filter(field => requiredId(field.id));
      let removeFields: number[] = [];
      if (input.fields !== undefined) {
        if (!input.fields.length) throw new UpstreamError(service, 400, 'Add at least one form field.');
        const hadEmail = existingFields.some(field => field.type === 'email' && field.mappedField === 'email');
        const built = buildFormFields(input.fields, existingFields, hadEmail);
        payload.fields = built.fields;
        removeFields = built.remove;
      }
      const existingActions = values(current.actions);
      let removeActions: number[] = [];
      if (input.actions !== undefined) {
        const built = buildFormActions(input.actions, existingActions);
        payload.actions = built.actions;
        removeActions = built.remove;
      }
      const dto = await write(`/forms/${formId}/edit`, 'form', 'PATCH', payload);
      await deleteById(formId, 'fields', removeFields);
      await deleteById(formId, 'actions', removeActions);
      const gone = new Set(removeFields);
      const goneActions = new Set(removeActions);
      const keep = (value: unknown, drop: Set<number>) => values(value).filter(entry => !drop.has(Number(entry.id)));
      return toLeadForm({ ...dto, fields: keep(dto.fields, gone), actions: keep(dto.actions, goneActions) });
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
