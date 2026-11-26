// Template catalogue (Lane MC · Sites): curated templates plus factory output, each validated and checked against the
// publishing sanitiser before the gallery shows it or a page can be created from it.
import type { PageTemplate, PageTemplateSummary } from '@/contracts/sites';
import { allPageTemplates, blankTemplate } from '@/templates/pages';
import { fieldSchema, settingsSchema } from './forms';
import { sanitizePageHtml } from './sanitize';

const placeholderForm = '00000000-0000-4000-8000-000000000000';
const openingTags = (html: string) => (html.match(/<[a-z][a-z0-9]*/gi) ?? []).length;

/** Problems that keep a template out of the catalogue. An empty list means it is publishable as is. */
export function validatePageTemplate(template: PageTemplate): string[] {
  const issues: string[] = [];
  const all = template.html + template.css;
  if (/<script|javascript:|\son[a-z]+\s*=/i.test(all)) issues.push('contains script');
  if (/(?:src|href)="(?:https?:)?\/\//i.test(template.html) || /url\(\s*['"]?(?:https?:)?\/\//i.test(template.css) || /@import/i.test(template.css)) issues.push('loads external resources');
  if (/undefined|\[object Object\]|NaN/.test(template.html)) issues.push('has unfilled content');
  if ((template.html.match(/<h1[\s>]/g) ?? []).length !== 1) issues.push('needs exactly one h1');
  if ((template.html.match(/<svg[^>]*>/g) ?? []).some(tag => !/aria-label|aria-hidden/.test(tag))) issues.push('has an unlabelled illustration');
  if (!template.css.includes('@media (max-width: 992px)') || !template.css.includes('@media (max-width: 480px)')) issues.push('is not responsive');
  const slots = (template.html.match(/data-ovelio-form=""/g) ?? []).length;
  if (template.hasForm !== slots > 0) issues.push('form block and form definition disagree');
  if (template.hasForm) {
    const fields = template.form?.fields ?? [];
    for (const field of fields) if (!fieldSchema.safeParse(field).success) issues.push(`form field ${field.key} is invalid`);
    if (new Set(fields.map(field => field.key)).size !== fields.length) issues.push('form field keys repeat');
    if (!fields.some(field => field.mapsTo === 'email' && field.type === 'email')) issues.push('form has no email field');
    if (!settingsSchema.safeParse(template.form?.settings ?? {}).success) issues.push('form settings are invalid');
  }
  // The sanitiser drops empty attributes, so bind form blocks to a placeholder before comparing structure.
  const bound = template.html.replace(/data-ovelio-form=""/g, `data-ovelio-form="${placeholderForm}"`);
  const clean = sanitizePageHtml(bound);
  if (openingTags(clean) !== openingTags(bound)) issues.push('loses elements when sanitised');
  if ((clean.match(new RegExp(`data-ovelio-form="${placeholderForm}"`, 'g')) ?? []).length !== slots) issues.push('loses its form block when sanitised');
  return issues;
}

let cached: PageTemplate[] | null = null;

export function templateCatalog(): PageTemplate[] {
  cached ??= allPageTemplates.filter(template => {
    const issues = validatePageTemplate(template);
    if (issues.length) console.error(JSON.stringify({ level: 'error', scope: 'sites-templates', template: template.key, issues }));
    return !issues.length;
  });
  return cached;
}

export function catalogTemplate(key: string): PageTemplate | null {
  if (key === 'blank') return blankTemplate;
  return templateCatalog().find(template => template.key === key) ?? null;
}

export function catalogSummaries(): PageTemplateSummary[] {
  return templateCatalog().map(({ key, name, category, description, palette, hasForm, industry, source }) => ({ key, name, category, description, palette, hasForm, industry, source: source ?? 'curated' }));
}
