// Sanitises compiled email HTML (studio output and imported HTML). A real parser (sanitize-html) keeps the email
// structure MJML relies on — <style> blocks, classes, table attributes, every inline style — and removes what could
// run code: <script>, event handler attributes, javascript:/vbscript: URLs, frames, forms and embedded objects.
// Outlook conditional comments are kept verbatim because browsers treat them as inert comments; one that could close
// early (contains "-->") is dropped instead.
import { randomBytes } from 'node:crypto';
import sanitize from 'sanitize-html';
import { mergeTagPattern } from '@/contracts/merge-tags';

const emailTags = [
  'html', 'head', 'body', 'title', 'meta', 'style', 'center', 'font', 'div', 'span', 'p', 'br', 'hr', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'small', 'big', 'blockquote',
  'pre', 'code', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'figure', 'figcaption', 'picture', 'source',
  'abbr', 'address', 'cite', 'del', 'ins', 'mark', 'q', 'time', 'wbr', 'label', 'noscript',
];

const sharedAttributes = [
  'style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'background', 'border', 'dir', 'lang', 'title',
  'role', 'aria-*', 'data-*', 'color', 'face', 'size',
];

/** Comments that MJML and email tools emit for Outlook. Anything else is dropped. */
const conditionalComment = /<!--\[if [^\]]{1,40}\]>[\s\S]*?<!\[endif\]-->|<!--\[if [^\]]{1,40}\]><!-->|<!--<!\[endif\]-->/gi;

const unsafeStyle = /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:/i;

function protect(html: string) {
  const nonce = 'ovkeep' + randomBytes(8).toString('hex');
  const kept: string[] = [];
  const token = (value: string) => {
    kept.push(value);
    return `${nonce}x${kept.length - 1}x`;
  };
  let source = html.replace(conditionalComment, whole => {
    // A conditional comment that contains its own terminator would let the rest render as live HTML.
    const inner = whole.replace(/^<!--/, '').replace(/-->$/, '');
    if (/-->|--!>/.test(inner)) return '';
    return token(whole);
  });
  // Merge tags keep their exact spelling (quotes in a fallback would otherwise be entity-encoded inside attributes).
  source = source.replace(mergeTagPattern, whole => token(whole));
  const restore = (output: string) => output.replace(new RegExp(`${nonce}x(\\d+)x`, 'g'), (_all, index: string) => kept[Number(index)] ?? '');
  return { source, restore };
}

const options: sanitize.IOptions = {
  allowedTags: emailTags,
  allowVulnerableTags: true,
  allowedAttributes: {
    '*': sharedAttributes,
    html: ['xmlns', 'xmlns:v', 'xmlns:o', 'lang', 'dir'],
    meta: ['http-equiv', 'content', 'name', 'charset'],
    style: ['type', 'media'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'srcset', 'sizes', 'loading'],
    source: ['srcset', 'media', 'type'],
    table: ['cellpadding', 'cellspacing', 'border', 'summary'],
    td: ['colspan', 'rowspan', 'nowrap', 'headers', 'scope'],
    th: ['colspan', 'rowspan', 'nowrap', 'scope', 'headers'],
    col: ['span'],
    colgroup: ['span'],
    ol: ['start', 'type'],
    time: ['datetime'],
    abbr: ['title'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'], source: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset', 'background', 'action', 'cite'],
  allowProtocolRelative: false,
  parseStyleAttributes: false,
  exclusiveFilter: frame => frame.tag === 'meta' && /refresh|set-cookie/i.test(frame.attribs['http-equiv'] ?? ''),
  transformTags: {
    '*': (tagName, attribs) => {
      const next = { ...attribs };
      if (next.style && unsafeStyle.test(next.style)) delete next.style;
      if (next.background && !/^(https?:|data:image\/)/i.test(next.background.trim())) delete next.background;
      if (tagName === 'img' && next.src && /^data:/i.test(next.src) && !/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(next.src)) delete next.src;
      if (tagName === 'a' && next.target === '_blank') next.rel = 'noopener noreferrer';
      return { tagName, attribs: next };
    },
  },
};

/** Removes executable content from email HTML while keeping its layout, styles and OVELIO merge tags. */
export function sanitizeEmailHtml(html: string): string {
  const doctype = /^\s*<!doctype html>/i.test(html);
  const { source, restore } = protect(html.replace(/^\s*<!doctype[^>]*>/i, ''));
  const output = restore(sanitize(source, options)).trim();
  return doctype ? '<!doctype html>\n' + output : output;
}

// Listmonk 6.2.0 tags the studio may emit (src/server/studio/convert.ts). Everything else in {{ }} is escaped so a
// newsletter body can never call other Go template functions.
const listmonkTag = /\{\{\s*(?:\.Subscriber\.(?:FirstName|LastName|Name|Email|UUID)|\.Subscriber\.Attribs\.[A-Za-z0-9_]+|\.Campaign\.(?:Name|Subject)|UnsubscribeURL|OptinURL|MessageURL|ManageURL|TrackView)(?:\s*\|\s*default\s+"[^"{}<>\\]{0,80}")?\s*\}\}/g;

/** The marker the studio puts in every newsletter body it exports, so the delivery path can recognise it. */
export const studioMarker = '<!-- ovelio-studio -->';

/**
 * Prepares a studio-exported newsletter body for Listmonk: sanitised like `sanitizeEmailHtml`, allow-listed Listmonk
 * tags kept exactly, and every other `{{` entity-escaped so it renders as text.
 */
export function studioNewsletterBody(html: string): string {
  const nonce = 'ovlm' + randomBytes(8).toString('hex');
  const tags: string[] = [];
  const tokenised = html.replace(listmonkTag, whole => {
    tags.push(whole);
    return `${nonce}x${tags.length - 1}x`;
  });
  const clean = sanitizeEmailHtml(tokenised).replaceAll('{{', '&#123;&#123;');
  const restored = clean.replace(new RegExp(`${nonce}x(\\d+)x`, 'g'), (_all, index: string) => tags[Number(index)] ?? '');
  return restored.includes(studioMarker) ? restored : restored.replace(/<body([^>]*)>/i, `<body$1>${studioMarker}`);
}
