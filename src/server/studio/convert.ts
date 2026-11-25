// Converts OVELIO merge tags (src/contracts/merge-tags.ts) in compiled studio HTML to each engine's syntax, and back
// when an existing Listmonk newsletter or template is imported. Behaviour follows the engine research
// (docs/parity/research/03-listmonk-campaigns-delivery.md); no engine code is copied.
import { mergeTagPattern, unknownMergeTags } from '@/contracts/merge-tags';

export type WorkspaceValues = { name: string; address: string; website: string; year?: string };
export type Converted = { html: string; unknownTags: string[]; notes: string[] };

const quote = (value: string) => value.replace(/["{}<>\\]/g, '').slice(0, 80);

const listmonkFields: Record<string, string> = {
  'contact.first_name': '.Subscriber.FirstName',
  'contact.last_name': '.Subscriber.LastName',
  'contact.full_name': '.Subscriber.Name',
  'contact.email': '.Subscriber.Email',
  'contact.company': '.Subscriber.Attribs.company',
  'contact.position': '.Subscriber.Attribs.position',
  'contact.city': '.Subscriber.Attribs.city',
  'contact.country': '.Subscriber.Attribs.country',
  'contact.phone': '.Subscriber.Attribs.phone',
};

const mauticFields: Record<string, string> = {
  'contact.first_name': 'firstname',
  'contact.last_name': 'lastname',
  'contact.email': 'email',
  'contact.company': 'company',
  'contact.position': 'position',
  'contact.city': 'city',
  'contact.country': 'country',
  'contact.phone': 'phone',
};

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function staticValue(tag: string, workspace: WorkspaceValues): string | undefined {
  if (tag === 'workspace.name') return escapeHtml(workspace.name);
  if (tag === 'workspace.address') return escapeHtml(workspace.address);
  if (tag === 'workspace.website') return escapeHtml(workspace.website);
  if (tag === 'current_year') return workspace.year ?? String(new Date().getFullYear());
  return undefined;
}

/** OVELIO tags → Listmonk Go-template tags (`{{ .Subscriber.FirstName | default "there" }}`, `{{ UnsubscribeURL }}`). */
export function toListmonkHtml(html: string, workspace: WorkspaceValues): Converted {
  const notes = new Set<string>();
  const out = html.replace(mergeTagPattern, (whole, tag: string, fallback?: string) => {
    if (tag === 'unsubscribe_url') return '{{ UnsubscribeURL }}';
    const fixed = staticValue(tag, workspace);
    if (fixed !== undefined) return fixed;
    const field = listmonkFields[tag];
    if (!field) return whole;
    if (field.includes('.Attribs.')) notes.add('Company, job title, city, country and phone come from newsletter subscriber attributes and are blank unless the subscriber record carries them.');
    const fb = fallback?.trim() ? quote(fallback.trim()) : '';
    return fb ? `{{ ${field} | default "${fb}" }}` : `{{ ${field} }}`;
  });
  return { html: out, unknownTags: unknownMergeTags(html), notes: [...notes] };
}

/** OVELIO tags → Mautic tokens (`{contactfield=firstname|there}`, `{unsubscribe_url}`). */
export function toMauticHtml(html: string, workspace: WorkspaceValues): Converted {
  const out = html.replace(mergeTagPattern, (whole, tag: string, fallback?: string) => {
    if (tag === 'unsubscribe_url') return '{unsubscribe_url}';
    const fixed = staticValue(tag, workspace);
    if (fixed !== undefined) return fixed;
    const fb = fallback?.trim() ? '|' + fallback.trim().replace(/[{}|]/g, '') : '';
    if (tag === 'contact.full_name') return `{contactfield=firstname${fb}} {contactfield=lastname}`;
    const field = mauticFields[tag];
    return field ? `{contactfield=${field}${fb}}` : whole;
  });
  return { html: out, unknownTags: unknownMergeTags(html), notes: [] };
}

const fromListmonk: Record<string, string> = {
  '.Subscriber.FirstName': 'contact.first_name',
  '.Subscriber.LastName': 'contact.last_name',
  '.Subscriber.Name': 'contact.full_name',
  '.Subscriber.Email': 'contact.email',
  UnsubscribeURL: 'unsubscribe_url',
};

/** Listmonk tags in an imported newsletter → OVELIO tags. Tracking suffixes are dropped; Listmonk adds them again at send. */
export function fromListmonkHtml(html: string): string {
  return html
    .replace(/\{\{\s*(\.Subscriber\.(?:FirstName|LastName|Name|Email)|UnsubscribeURL)(?:\s*\|\s*default\s+"([^"]*)")?\s*\}\}/g,
      (_all, field: string, fallback?: string) => `{{${fromListmonk[field]}${fallback ? ' | ' + fallback : ''}}}`)
    .replace(/\{\{\s*\.Subscriber\.Attribs\.(company|position|city|country|phone)\s*\}\}/g, (_all, key: string) => `{{contact.${key}}}`)
    .replace(/@TrackLink/g, '')
    .replace(/\{\{\s*TrackView\s*\}\}/g, '');
}
