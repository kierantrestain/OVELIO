// Publishing sanitiser (Lane 3). The builder's HTML is reduced to a safe allow-list before it becomes a public
// snapshot: no <script>, no on* handlers, no javascript: URLs, iframes only from YouTube and Vimeo. Form blocks keep
// their data-ovelio-form binding; OVELIO's own tracker is added after sanitising, at render time.
import sanitizeHtml from 'sanitize-html';

const htmlTags = [
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'caption', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'iframe', 'img', 'ins', 'kbd', 'label', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'picture', 'pre', 'q',
  's', 'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'time', 'tr', 'u', 'ul', 'video',
];
const svgTags = ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'text', 'tspan', 'clippath', 'mask', 'use'];
const svgAttributes = [
  'viewbox', 'viewBox', 'xmlns', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-opacity', 'opacity', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points',
  'transform', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradientUnits', 'preserveaspectratio', 'preserveAspectRatio',
  'clip-path', 'mask', 'font-size', 'font-weight', 'text-anchor', 'width', 'height',
];

const allowedIframeHosts = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com'];

const options: sanitizeHtml.IOptions = {
  allowedTags: [...htmlTags, ...svgTags],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'role', 'aria-*', 'data-*', 'lang', 'dir', 'hidden', 'tabindex', 'width', 'height'],
    a: ['href', 'target', 'rel', 'name'],
    img: ['src', 'alt', 'loading', 'srcset', 'sizes'],
    source: ['src', 'srcset', 'type', 'media'],
    video: ['src', 'poster', 'controls', 'muted', 'loop', 'playsinline'],
    iframe: ['src', 'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
    button: ['type', 'name', 'value'],
    label: ['for'],
    td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'],
    time: ['datetime'], details: ['open'], ol: ['start', 'type'],
    ...Object.fromEntries(svgTags.map(tag => [tag, svgAttributes])),
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'poster', 'srcset'],
  allowProtocolRelative: false,
  allowedIframeHostnames: allowedIframeHosts,
  allowIframeRelativeUrls: false,
  parser: { lowerCaseAttributeNames: false },
  // Links that open a new tab must not hand the opener to the destination.
  transformTags: {
    a: (tagName, attribs) => attribs.target === '_blank'
      ? { tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } }
      : { tagName, attribs },
  },
  exclusiveFilter: frame => frame.tag === 'img' && /^data:/i.test(frame.attribs.src ?? '') && !/^data:image\/(png|jpe?g|gif|webp);/i.test(frame.attribs.src ?? ''),
};

/** The body markup of a page design as safe, publishable HTML. A wrapping <body> element is unwrapped. */
export function sanitizePageHtml(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return sanitizeHtml(body ? body[1] : html, options).trim();
}

/** Page CSS that cannot close its <style> element or run script-like constructs. */
export function sanitizePageCss(css: string): string {
  return css
    .replace(/<\/?\s*(style|script)[^>]*>?/gi, '')
    .replace(/</g, '\\3C ')
    .replace(/expression\s*\(/gi, 'invalid(')
    .replace(/javascript\s*:/gi, 'invalid:')
    .replace(/@import[^;]*;?/gi, '')
    .slice(0, 400_000);
}

/** True when the HTML has a form block not yet linked to a form. */
export function unboundFormBlocks(html: string): number {
  return [...html.matchAll(/data-ovelio-form="([^"]*)"/g)].filter(match => !match[1]).length;
}

export function boundFormIds(html: string): string[] {
  return [...new Set([...html.matchAll(/data-ovelio-form="([0-9a-f-]{36})"/g)].map(match => match[1]))];
}
