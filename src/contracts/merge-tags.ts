// OVELIO merge tags (lead-owned). Designs store these; the mailer resolves them for native sends, and the email
// studio converts them for the engines (Listmonk `{{ .Subscriber.FirstName }}`, Mautic `{contactfield=firstname}`).
// Syntax: {{contact.first_name}} or with a fallback {{contact.first_name | there}}.

export type MergeTag = { tag: string; label: string; group: 'Contact' | 'Workspace' | 'Links' | 'Date'; example: string };

export const mergeTags: MergeTag[] = [
  { tag: 'contact.first_name', label: 'First name', group: 'Contact', example: 'Ada' },
  { tag: 'contact.last_name', label: 'Last name', group: 'Contact', example: 'Lovelace' },
  { tag: 'contact.full_name', label: 'Full name', group: 'Contact', example: 'Ada Lovelace' },
  { tag: 'contact.email', label: 'Email', group: 'Contact', example: 'ada@example.com' },
  { tag: 'contact.company', label: 'Company', group: 'Contact', example: 'Analytical Engines Ltd' },
  { tag: 'contact.position', label: 'Job title', group: 'Contact', example: 'Head of Research' },
  { tag: 'contact.city', label: 'City', group: 'Contact', example: 'London' },
  { tag: 'contact.country', label: 'Country', group: 'Contact', example: 'United Kingdom' },
  { tag: 'contact.phone', label: 'Phone', group: 'Contact', example: '+44 20 7946 0000' },
  { tag: 'workspace.name', label: 'Your company name', group: 'Workspace', example: 'OVELIO' },
  { tag: 'workspace.address', label: 'Your postal address', group: 'Workspace', example: '1 Example Street, London' },
  { tag: 'workspace.website', label: 'Your website', group: 'Workspace', example: 'https://example.com' },
  { tag: 'unsubscribe_url', label: 'Unsubscribe link', group: 'Links', example: 'https://example.com/u/…' },
  { tag: 'current_year', label: 'Current year', group: 'Date', example: String(new Date().getFullYear()) },
];

export const mergeTagPattern = /\{\{\s*([a-z_]+(?:\.[a-z_]+)?)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Replaces OVELIO merge tags. Values are HTML-escaped unless `html` is false. Unknown tags are kept as written so a
 * typo is visible in a test send instead of silently disappearing.
 */
export function renderMergeTags(template: string, values: Record<string, string | undefined | null>, options: { html?: boolean } = {}) {
  const escape = options.html === false ? (value: string) => value : escapeHtml;
  return template.replace(mergeTagPattern, (whole, tag: string, fallback?: string) => {
    if (!(tag in values)) return whole;
    const value = values[tag];
    const chosen = value && value.trim() ? value : (fallback ?? '').trim();
    return escape(chosen);
  });
}

/** Tags used in a template that OVELIO does not know. */
export function unknownMergeTags(template: string): string[] {
  const known = new Set(mergeTags.map(item => item.tag));
  const found = new Set<string>();
  for (const match of template.matchAll(mergeTagPattern)) if (!known.has(match[1])) found.add(match[1]);
  return [...found];
}
