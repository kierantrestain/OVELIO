// Conditional content (src/contracts/studio.ts VisibilityRule). Compile wraps each ruled element in marker comments;
// the mailer resolves them per contact at send time, the contact preview does the same, and the Listmonk export turns
// them into Go-template conditionals. Pure functions only (no I/O), so every path gives the same answer.
import type { DirectoryContact } from '@/contracts/platform';
import type { RuleField, VisibilityRule } from '@/contracts/studio';
import { formatRule, parseRule, ruleClassPrefix, ruleFromClass } from '@/contracts/studio';

const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const toB64 = (value: string) => Buffer.from(value).toString('base64url');
const fromB64 = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

/** `<!--ov-if:N:rule-->…<!--/ov-if:N-->`; N pairs the markers, the rule is base64url text. */
export const conditionMarker = /<!--ov-if:(\d+):([A-Za-z0-9_-]+)-->([\s\S]*?)<!--\/ov-if:\1-->/;
export const markerComment = /<!--ov-if:\d+:[A-Za-z0-9_-]+-->|<!--\/ov-if:\d+-->/g;

/** Wraps every MJML element whose css-class carries a rule token in raw marker comments, before MJML compiles it. */
export function expandConditions(mjml: string): string {
  let source = mjml;
  let counter = 0;
  const opening = /<(mj-[a-z-]+)\b([^>]*?)\scss-class="([^"]*\bov-if--[A-Za-z0-9_-]+[^"]*)"([^>]*?)(\/?)>/;
  for (let guard = 0; guard < 500; guard++) {
    const match = opening.exec(source);
    if (!match) break;
    const [whole, name, before, classes, after, selfClosing] = match;
    const tokens = decode(classes).split(/\s+/).filter(Boolean);
    const rule = tokens.map(ruleFromClass).find(Boolean) ?? null;
    const rest = tokens.filter(token => !token.startsWith(ruleClassPrefix));
    const tag = `<${name}${before}${rest.length ? ` css-class="${rest.join(' ')}"` : ''}${after}${selfClosing}>`;
    const start = match.index;
    let end = start + whole.length;
    if (!selfClosing) {
      const scan = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, 'g');
      scan.lastIndex = end;
      let depth = 1;
      for (let next = scan.exec(source); next; next = scan.exec(source)) {
        if (next[2]) continue;
        depth += next[1] ? -1 : 1;
        if (depth === 0) { end = next.index + next[0].length; break; }
      }
    }
    const inner = source.slice(start + whole.length, end);
    if (!rule) { source = source.slice(0, start) + tag + inner + source.slice(end); continue; }
    counter += 1;
    source = source.slice(0, start)
      + `<mj-raw><!--ov-if:${counter}:${toB64(formatRule(rule))}--></mj-raw>${tag}${inner}<mj-raw><!--/ov-if:${counter}--></mj-raw>`
      + source.slice(end);
  }
  return source;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function fieldValue(contact: DirectoryContact, field: RuleField) {
  return { company: contact.company, position: contact.position, stage: contact.stageName ?? '', first_name: contact.firstName, last_name: contact.lastName, email: contact.email }[field] ?? '';
}

/** Whether a contact sees a block. Unknown recipients (no contact record) match only negated rules. */
export function ruleMatches(rule: VisibilityRule, contact: DirectoryContact | null): boolean {
  let matched = false;
  if (contact) {
    if (rule.kind === 'tag') matched = contact.tags.some(tag => same(tag, rule.value));
    else if (rule.kind === 'field') matched = same(fieldValue(contact, rule.field), rule.value);
    else matched = contact.consent === 'opted_in' && !contact.suppressed;
  }
  return rule.negate ? !matched : matched;
}

function replaceBlocks(html: string, decide: (rule: VisibilityRule | null, content: string) => string) {
  let output = html;
  for (let guard = 0; guard < 500 && conditionMarker.test(output); guard++) {
    output = output.replace(conditionMarker, (_all, _n: string, encoded: string, content: string) => decide(parseRule(fromB64(encoded)), content));
  }
  return output;
}

/** Keeps or removes each conditional block for one contact. Used by the mailer at send time and by the preview. */
export function resolveConditionalBlocks(html: string, contact: DirectoryContact | null): string {
  if (!html.includes('<!--ov-if:')) return html;
  return replaceBlocks(html, (rule, content) => rule && ruleMatches(rule, contact) ? content : '');
}

const goText = (value: string) => value.replace(/["\\{}<>]/g, '').toLowerCase();

const listmonkField: Record<RuleField, string> = {
  first_name: '.Subscriber.FirstName', last_name: '.Subscriber.LastName', email: '.Subscriber.Email',
  company: '.Subscriber.Attribs.company', position: '.Subscriber.Attribs.position', stage: '.Subscriber.Attribs.stage',
};

/**
 * Turns conditional blocks into Listmonk Go-template conditionals. Newsletter recipients always have consent, so
 * consent rules resolve here. Tag and attribute rules read subscriber attributes, which are blank unless set.
 */
export function conditionsToListmonk(html: string): { html: string; notes: string[] } {
  const notes = new Set<string>();
  const output = replaceBlocks(html, (rule, content) => {
    if (!rule) return '';
    if (rule.kind === 'consent') return rule.negate ? '' : content;
    if (rule.kind === 'tag') {
      notes.add('Tag rules read the subscriber attribute "tags" in the newsletter engine; subscribers without it count as untagged.');
      const test = `and .Subscriber.Attribs.tags (has "${goText(rule.value)}" .Subscriber.Attribs.tags)`;
      return `{{ if ${rule.negate ? `not (${test})` : test} }}${content}{{ end }}`;
    }
    if (listmonkField[rule.field].includes('Attribs')) notes.add('Company, job title and stage rules read newsletter subscriber attributes, which are blank unless the subscriber carries them.');
    return `{{ if ${rule.negate ? 'ne' : 'eq'} (lower (print ${listmonkField[rule.field]})) "${goText(rule.value)}" }}${content}{{ end }}`;
  });
  return { html: output, notes: [...notes] };
}

/** Mautic journey emails have no per-contact blocks, so conditional blocks are left out rather than shown to everyone. */
export function stripConditionalBlocks(html: string): { html: string; removed: number } {
  let removed = 0;
  const output = replaceBlocks(html, () => { removed += 1; return ''; });
  return { html: output, removed };
}
