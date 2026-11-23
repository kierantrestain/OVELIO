// AUT-07 and AUT-08: building and reading the field, action and post-submit payloads of Mautic forms.
import {
  formActionSpecs, formFieldSpecs,
  type FormAction, type FormActionInput, type FormActionPropertySpec, type FormField, type FormFieldOptions,
  type FormFieldPropertySpec, type FormFieldTypeSpec, type FormPostAction, type LeadFormInput,
} from '../../contracts';
import { UpstreamError } from '../upstream';
import { flag, number, positiveId, record, service, text, type ApiRecord } from './normalize';

type Payload = Record<string, unknown>;

const fieldSpecs = new Map<string, FormFieldTypeSpec>(formFieldSpecs.map(spec => [spec.type, spec]));
const actionSpecs = new Map(formActionSpecs.map(spec => [spec.type as string, spec]));

function reject(message: string): never {
  throw new UpstreamError(service, 400, message);
}

export function values(value: unknown): ApiRecord[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).map(record);
}

/* ── Post-submit behaviour ─────────────────────────────────────────────────── */

export function plainFormMessage(message: string) {
  return message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('{', '&#123;').replaceAll('}', '&#125;');
}

export function readFormMessage(message: string) {
  return message.replaceAll('&#123;', '{').replaceAll('&#125;', '}').replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

const defaultMessage = 'Thank you. Your details have been received.';

/**
 * Mautic's form API resets `postAction` to "return" whenever a request leaves it out
 * (FormApiController::processForm), so every edit resends the current value.
 */
export function postActionPayload(input: Partial<LeadFormInput>, current?: ApiRecord, creating = false): Payload {
  const currentAction = text(current?.postAction) || 'message';
  const wanted = input.postAction ?? (input.message !== undefined && currentAction !== 'hideform' && currentAction !== 'redirect' ? 'message' : currentAction);
  if (wanted === 'redirect') {
    const raw = (input.redirectUrl ?? (currentAction === 'redirect' ? text(current?.postActionProperty) : '')).trim();
    let url: URL | undefined;
    try { url = new URL(raw); } catch { /* reported below */ }
    if (!url || !['http:', 'https:'].includes(url.protocol)) reject('Enter a web address that starts with http:// or https:// to redirect to.');
    return { postAction: 'redirect', postActionProperty: url.toString() };
  }
  if (wanted === 'return') return { postAction: 'return', postActionProperty: '' };
  if (wanted === 'hideform') {
    return { postAction: 'hideform', postActionProperty: plainFormMessage(input.message?.trim() || text(current?.postActionProperty) || defaultMessage) };
  }
  const keep = !creating && currentAction === 'message' ? readFormMessage(text(current?.postActionProperty)) : '';
  return { postAction: 'message', postActionProperty: plainFormMessage(input.message?.trim() || keep || defaultMessage) };
}

/* ── Fields ────────────────────────────────────────────────────────────────── */

function coerceProperty(spec: FormFieldPropertySpec, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (spec.kind === 'boolean') return flag(raw) || raw === 'true';
  if (spec.kind === 'number') return number(raw) ?? undefined;
  if (spec.kind === 'list') {
    const list = Array.isArray(raw) ? raw : String(raw).split(',');
    const cleaned = list.map(entry => String(entry).trim().replace(/^\./, '')).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  return String(raw).trim() || undefined;
}

function shapeProps(specs: FormFieldPropertySpec[], store: 'properties' | 'validation', given: Payload | undefined): Payload {
  const known = new Map(specs.filter(spec => (spec.store ?? 'properties') === store).map(spec => [spec.key, spec]));
  const shaped: Payload = {};
  for (const [key, raw] of Object.entries(given ?? {})) {
    const spec = known.get(key);
    if (!spec) { shaped[key] = raw; continue; }
    const value = coerceProperty(spec, raw);
    if (value !== undefined) shaped[key] = value;
  }
  return shaped;
}

/** Keeps the stored value of a choice whose label did not change, so forms built in Mautic keep their values. */
function choiceList(options: string[], previous: ApiRecord | undefined) {
  const holder = record(previous?.optionlist).list !== undefined ? record(previous?.optionlist) : record(previous?.list);
  const values = new Map<string, string>();
  if (holder.list && typeof holder.list === 'object') {
    for (const entry of Object.values(holder.list)) {
      const pair = record(entry);
      if (text(pair.label)) values.set(text(pair.label), text(pair.value) || text(pair.label));
    }
  }
  return { list: options.map(option => ({ label: option, value: values.get(option) ?? option })) };
}

function readChoices(properties: ApiRecord): string[] | undefined {
  const holder = record(properties.optionlist).list !== undefined ? record(properties.optionlist) : record(properties.list);
  const raw = holder.list ?? undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const found = Object.values(raw)
    .map(entry => typeof entry === 'string' ? entry : text(record(entry).label) || text(record(entry).value))
    .filter(Boolean);
  return found.length ? found : undefined;
}

const aliasPattern = /^[a-z][a-z0-9_]{0,59}$/;

export type BuiltFields = { fields: Payload[]; remove: number[]; };

function cleanAlias(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function buildField(input: FormFieldOptions, existing: ApiRecord | undefined, position: number): Payload {
  const type = input.type || text(existing?.type);
  const spec = fieldSpecs.get(type);
  const label = input.label?.trim();
  if (!label) reject('Enter a label for each form field.');
  if (!spec && !existing) reject(`The form field type "${type}" is not supported.`);
  const alias = existing ? text(existing.alias) : cleanAlias(input.alias ?? '');
  if (!existing && (!alias || !aliasPattern.test(alias) || (alias === 'submit' && type !== 'button'))) {
    reject('Use a unique valid alias for each form field.');
  }

  const payload: Payload = { label, alias, type, order: position + 1 };
  if (existing) payload.id = positiveId(existing.id);
  const allowed = spec ?? { mappable: true, required: true, defaultValue: true, helpMessage: true, showLabel: true, props: [] } as unknown as FormFieldTypeSpec;
  if (allowed.showLabel && input.showLabel !== undefined) payload.showLabel = input.showLabel;
  else if (allowed.showLabel) payload.showLabel = true;
  if (allowed.required && input.isRequired !== undefined) payload.isRequired = input.isRequired;
  if (allowed.required && input.isRequired && input.validationMessage !== undefined) payload.validationMessage = input.validationMessage;
  if (allowed.defaultValue && input.defaultValue !== undefined) payload.defaultValue = input.defaultValue;
  if (allowed.helpMessage && input.helpMessage !== undefined) payload.helpMessage = input.helpMessage;
  for (const key of ['labelAttributes', 'inputAttributes', 'containerAttributes', 'fieldWidth'] as const) {
    if (input[key] !== undefined) payload[key] = input[key];
  }
  for (const key of ['saveResult', 'alwaysDisplay', 'showWhenValueExists', 'isReadOnly', 'isAutoFill'] as const) {
    if (input[key] !== undefined) payload[key] = input[key];
  }
  if (input.showAfterXSubmissions !== undefined) payload.showAfterXSubmissions = input.showAfterXSubmissions;

  const mappedField = allowed.mappable ? input.mappedField?.trim() || (type === 'email' && !existing ? 'email' : '') : '';
  if (mappedField) {
    payload.mappedObject = input.mappedObject ?? (type === 'companyLookup' ? 'company' : 'contact');
    payload.mappedField = mappedField;
  } else if (existing && allowed.mappable && input.mappedField !== undefined) {
    payload.mappedObject = null;
    payload.mappedField = null;
  }

  const properties = shapeProps(allowed.props, 'properties', input.properties);
  if (allowed.choices) {
    const options = input.options?.map(option => option.trim()).filter(Boolean);
    const key = allowed.choices;
    if (options?.length) {
      delete properties.list;
      delete properties.optionlist;
      properties[key] = choiceList(options, record(existing?.properties));
    } else if (type !== 'country' && !readChoices(properties) && !properties.syncList) {
      reject(`Add at least one choice for the field "${label}".`);
    }
  }
  if (Object.keys(properties).length || existing) payload.properties = properties;
  const validation = shapeProps(allowed.props, 'validation', input.validation);
  if (Object.keys(validation).length || existing) payload.validation = validation;
  if (input.parent !== undefined) payload.parent = input.parent;
  if (input.conditions !== undefined) payload.conditions = input.conditions;
  return payload;
}

/**
 * Turns the console's fields into the Mautic payload. Existing fields keep their ids (matched by id, then by alias),
 * fields that were removed come back in `remove`, and the submit button is always kept.
 */
export function buildFormFields(input: FormFieldOptions[], existing: ApiRecord[] = [], forceEmail = existing.length === 0): BuiltFields {
  const byId = new Map(existing.map(field => [positiveId(field.id), field]));
  const byAlias = new Map(existing.map(field => [text(field.alias), field]));
  const seen = new Set<string>();
  const used = new Set<number>();
  const fields: Payload[] = [];
  let hasEmail = false;
  let button: Payload | undefined;

  for (const field of input) {
    const match = (field.id ? byId.get(field.id) : undefined) ?? (field.id ? undefined : byAlias.get(cleanAlias(field.alias ?? '')));
    if (field.id && !match) reject('A form field no longer exists. Reload the form and try again.');
    const matchId = positiveId(match?.id);
    if (matchId && used.has(matchId)) reject('Use a unique valid alias for each form field.');
    if (matchId) used.add(matchId);
    const built = buildField(field, match, fields.length);
    const alias = String(built.alias);
    if (seen.has(alias)) reject('Use a unique valid alias for each form field.');
    seen.add(alias);
    if (built.type === 'email' && built.mappedField === 'email') hasEmail = true;
    if (built.type === 'button') button = built;
    else fields.push(built);
  }

  if (forceEmail && !hasEmail) {
    const alias = seen.has('email') ? 'contact_email' : 'email';
    if (seen.has(alias)) reject('Include an email field mapped to the contact email.');
    const match = byAlias.get(alias);
    if (match && positiveId(match.id)) used.add(positiveId(match.id) as number);
    fields.push({
      ...(match ? { id: positiveId(match.id) } : {}),
      label: 'Email address', type: 'email', alias, mappedObject: 'contact', mappedField: 'email', showLabel: true, isRequired: true,
      order: fields.length + 1,
    });
  }

  const currentButton = existing.find(field => text(field.type) === 'button');
  if (button) {
    button.order = fields.length + 1;
    fields.push(button);
    if (positiveId(button.id)) used.add(positiveId(button.id) as number);
  } else if (currentButton) {
    used.add(positiveId(currentButton.id) as number);
    fields.push({ id: positiveId(currentButton.id), label: text(currentButton.label) || 'Submit', alias: text(currentButton.alias) || 'submit', type: 'button', order: fields.length + 1 });
  } else {
    fields.push({ label: 'Submit', alias: 'submit', type: 'button', order: fields.length + 1 });
  }

  const remove = existing.map(field => positiveId(field.id)).filter((id): id is number => id !== null && !used.has(id));
  return { fields, remove };
}

export const defaultFormInputFields: FormFieldOptions[] = [
  { label: 'First name', type: 'text', alias: 'first_name', mappedField: 'firstname' },
  { label: 'Email address', type: 'email', alias: 'email', mappedField: 'email', isRequired: true },
];

export function toFormField(value: ApiRecord): FormField {
  const id = positiveId(value.id);
  const properties = record(value.properties);
  const validation = record(value.validation);
  const options = readChoices(properties);
  const textOf = (key: string) => text(value[key]);
  const flagOf = (key: string) => value[key] === null || value[key] === undefined ? undefined : flag(value[key]);
  const rest = (...keys: string[]): Payload => Object.fromEntries(keys.flatMap(key => {
    const found = value[key] === null || value[key] === undefined || value[key] === '' ? undefined : value[key];
    return found === undefined ? [] : [[key, found]];
  }));
  const after = number(value.showAfterXSubmissions);
  return {
    ...(id ? { id } : {}),
    label: textOf('label'),
    alias: textOf('alias'),
    type: textOf('type') || 'text',
    ...(textOf('mappedField') ? { mappedField: textOf('mappedField') } : {}),
    ...(textOf('mappedObject') ? { mappedObject: textOf('mappedObject') } : {}),
    isRequired: flag(value.isRequired),
    ...(flagOf('showLabel') !== undefined ? { showLabel: flagOf('showLabel') } : {}),
    ...rest('defaultValue', 'helpMessage', 'validationMessage', 'labelAttributes', 'inputAttributes', 'containerAttributes', 'fieldWidth'),
    ...(flagOf('saveResult') !== undefined ? { saveResult: flagOf('saveResult') } : {}),
    ...(flagOf('alwaysDisplay') !== undefined ? { alwaysDisplay: flagOf('alwaysDisplay') } : {}),
    ...(flagOf('showWhenValueExists') !== undefined ? { showWhenValueExists: flagOf('showWhenValueExists') } : {}),
    ...(flagOf('isReadOnly') !== undefined ? { isReadOnly: flagOf('isReadOnly') } : {}),
    ...(flagOf('isAutoFill') !== undefined ? { isAutoFill: flagOf('isAutoFill') } : {}),
    ...(after !== null ? { showAfterXSubmissions: after } : {}),
    ...(options ? { options } : {}),
    ...(Object.keys(properties).length ? { properties } : {}),
    ...(Object.keys(validation).length ? { validation } : {}),
    ...(value.parent ? { parent: value.parent as string } : {}),
    ...(value.conditions && Object.keys(record(value.conditions)).length ? { conditions: value.conditions } : {}),
  };
}

/* ── Submit actions ────────────────────────────────────────────────────────── */

const emailPattern = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const tokenPattern = /^\{[^{}\s]+\}$/;

function idList(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw];
  const ids = list.map(entry => positiveId(entry));
  if (ids.some(id => id === null)) reject('Choose valid records for the form action.');
  return [...new Set(ids as number[])];
}

function emailList(raw: unknown, label: string): string {
  const parts = String(raw ?? '').split(',').map(part => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (!emailPattern.test(part) && !tokenPattern.test(part)) reject(`Enter valid email addresses for "${label}".`);
  }
  return parts.join(', ');
}

function shapeActionValue(spec: FormActionPropertySpec, raw: unknown): unknown {
  switch (spec.kind) {
    case 'boolean': return flag(raw) || raw === 'true';
    case 'number': {
      const parsed = number(raw);
      if (parsed === null) return undefined;
      if (!Number.isInteger(parsed)) reject(`Enter a whole number for "${spec.label}".`);
      return parsed;
    }
    case 'ids': return idList(raw);
    case 'tags': {
      const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
      return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))];
    }
    case 'emails': return emailList(raw, spec.label);
    case 'select': {
      if (spec.choices) {
        const value = String(raw ?? '');
        if (!spec.choices.some(choice => choice.value === value)) reject(`Choose a value for "${spec.label}".`);
        return value;
      }
      const id = positiveId(typeof raw === 'object' && raw ? (raw as Payload).email : raw);
      return id ?? undefined;
    }
    default: return String(raw ?? '').trim();
  }
}

function isBlank(value: unknown) {
  return value === undefined || value === '' || (Array.isArray(value) && !value.length);
}

export function buildActionProperties(type: string, given: Payload = {}): Payload {
  const spec = actionSpecs.get(type);
  if (!spec) return { ...given };
  const properties: Payload = { ...given };
  for (const prop of spec.props) {
    let value = shapeActionValue(prop, given[prop.key]);
    const empty = isBlank(value);
    if (prop.required && empty && prop.kind !== 'boolean') {
      reject(`Complete "${prop.label}" for the "${spec.label}" action.`);
    }
    if (prop.key === 'useremail') value = { email: value };
    if (empty && prop.kind !== 'boolean' && prop.kind !== 'ids' && prop.kind !== 'tags') delete properties[prop.key];
    else properties[prop.key] = value;
  }
  if (type === 'form.repost') {
    const url = String(properties.post_url ?? '');
    let valid = false;
    try { valid = ['http:', 'https:'].includes(new URL(url).protocol); } catch { /* invalid */ }
    if (!valid) reject('Enter a post URL that starts with http:// or https://.');
  }
  if (type === 'form.email') {
    properties.immediately = false;
    if (given.set_replyto === undefined) properties.set_replyto = true;
  }
  if (type === 'lead.pointschange' && !properties.points && properties.points !== 0) reject('Enter the points to change.');
  if (type === 'email.send.user' && !idList(properties.user_id).length) reject('Choose at least one user for the "Send an email to users" action.');
  if (type === 'lead.changelist' && !idList(properties.addToLists).length && !idList(properties.removeFromLists).length) {
    reject('Choose at least one segment to add or remove.');
  }
  if (type === 'lead.changetags' && !(properties.add_tags as unknown[]).length && !(properties.remove_tags as unknown[]).length) {
    reject('Add at least one tag to add or remove.');
  }
  if (type === 'lead.updatelead') {
    for (const [key, value] of Object.entries(properties)) {
      if (value === null || value === undefined || value === '') delete properties[key];
    }
    if (!Object.keys(properties).length) reject('Set at least one contact field value.');
  }
  return properties;
}

export type BuiltActions = { actions: Payload[]; remove: number[] };

export function buildFormActions(input: FormActionInput[], existing: ApiRecord[] = []): BuiltActions {
  const byId = new Map(existing.map(action => [positiveId(action.id), action]));
  const used = new Set<number>();
  const actions = input.map((action, index) => {
    const spec = actionSpecs.get(action.type);
    if (action.id && !byId.has(action.id)) reject('A form action no longer exists. Reload the form and try again.');
    if (!spec && !action.id) reject(`The form action "${action.type}" is not supported.`);
    if (action.id) {
      if (used.has(action.id)) reject('A form action was listed twice.');
      used.add(action.id);
    }
    return {
      ...(action.id ? { id: action.id } : {}),
      name: action.name?.trim() || spec?.label || action.type,
      ...(action.description ? { description: action.description } : {}),
      type: action.type,
      order: index + 1,
      properties: buildActionProperties(action.type, action.properties),
    };
  });
  const remove = existing.map(action => positiveId(action.id)).filter((id): id is number => id !== null && !used.has(id));
  return { actions, remove };
}

export function toFormAction(value: ApiRecord): FormAction {
  const id = positiveId(value.id);
  const order = number(value.order);
  return {
    ...(id ? { id } : {}),
    type: text(value.type),
    name: text(value.name),
    ...(text(value.description) ? { description: text(value.description) } : {}),
    ...(order !== null ? { order } : {}),
    properties: record(value.properties),
  };
}

export function toFormActions(value: unknown): FormAction[] {
  return values(value).filter(entry => text(entry.type)).map(toFormAction).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function toFormFields(value: unknown): FormField[] {
  return values(value).filter(entry => text(entry.alias)).map(toFormField);
}

export type { FormPostAction };
