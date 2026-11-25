// Server-side, deterministic MJML → HTML compile (mjml 5.4.1, MIT). Fixed options, no minify or beautify, no
// includes: the same source always gives the same HTML. Output is sanitised before it is stored or sent.
import type { CompileIssue } from '@/contracts/studio';
import { sanitizeEmailHtml } from './sanitize';

type Mjml = (input: string, options: Record<string, unknown>) => Promise<{ html: string; errors: { line: number; message: string; tagName?: string }[] }>;
let engine: Promise<Mjml> | undefined;
const load = () => engine ??= import('mjml').then(module => (module.default ?? module) as unknown as Mjml);

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Sets <mj-preview> (inbox preview text) and <mj-title> from the design's fields. */
export function withHead(source: string, head: { preheader?: string; title?: string }) {
  let mjml = source.replace(/<mj-preview>[\s\S]*?<\/mj-preview>/g, '').replace(/<mj-title>[\s\S]*?<\/mj-title>/g, '');
  const extra = (head.title?.trim() ? `<mj-title>${escapeText(head.title.trim())}</mj-title>` : '')
    + (head.preheader?.trim() ? `<mj-preview>${escapeText(head.preheader.trim())}</mj-preview>` : '');
  if (!extra) return mjml;
  if (/<mj-head[^>]*>/.test(mjml)) return mjml.replace(/<mj-head([^>]*)>/, `<mj-head$1>${extra}`);
  mjml = mjml.replace(/<mjml([^>]*)>/, `<mjml$1><mj-head>${extra}</mj-head>`);
  return mjml;
}

export async function compileMjml(source: string, head: { preheader?: string; title?: string } = {}): Promise<{ html: string; errors: CompileIssue[] }> {
  const trimmed = source.trim();
  if (!/^<mjml[\s>]/.test(trimmed)) return { html: '', errors: [{ line: 1, message: 'The design must start with <mjml>.' }] };
  const mjml2html = await load();
  try {
    const result = await mjml2html(withHead(trimmed, head), {
      validationLevel: 'soft', minify: false, beautify: false, keepComments: false, ignoreIncludes: true, fonts: {},
    });
    const errors = result.errors.map(item => ({ line: item.line, message: item.message, tagName: item.tagName }));
    return { html: sanitizeEmailHtml(result.html), errors };
  } catch (error) {
    return { html: '', errors: [{ line: 1, message: `The design could not be compiled: ${(error as Error).message.slice(0, 200)}` }] };
  }
}

/** A saved block is an MJML fragment (sections or wrappers); wrap it so it can be previewed and validated. */
export function wrapFragment(fragment: string) {
  return `<mjml><mj-body width="600px">${fragment}</mj-body></mjml>`;
}

/**
 * Imports existing HTML (a Listmonk newsletter or template) as one editable raw-HTML section, keeping every byte of
 * the body and moving <style> blocks into the head so nothing is lost.
 */
export function htmlToMjml(html: string) {
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1].trim()).filter(Boolean);
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const body = (bodyMatch ? bodyMatch[1] : html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<head[\s\S]*?<\/head>/i, '')).trim();
  const head = styles.length ? `<mj-head>${styles.map(css => `<mj-style>${css.replace(/<\/?mj-/g, '')}</mj-style>`).join('')}</mj-head>` : '';
  return `<mjml>${head}<mj-body width="600px"><mj-raw>${body}</mj-raw></mj-body></mjml>`;
}
