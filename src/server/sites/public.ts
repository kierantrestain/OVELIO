// Public side of Sites & Forms (Lane 3): serving published pages (with sticky A/B variants and funnel context),
// recording page views and funnel steps, and the form submission pipeline that creates CRM contacts.
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContactUpsert, Utm } from '@/contracts/platform';
import type { SubmitResult } from '@/contracts/sites';
import { AppError } from '../config';
import { db, transaction } from '../db';
import { getContact, upsertContact } from '../directory';
import { emitEvent } from '../events';
import { sendDesign } from '../mailer';
import { createTask, resolveCampaignId } from '../records';
import type { DomainRow, FormRow, PageRow, VariantRow } from './data';
import { formSettings, getForm, pageUrl, uuidPattern } from './data';
import { validateAnswers } from './forms';
import { branchTarget, funnelForPage } from './funnels';
import { formsByIds } from './pages';
import { escapeHtml, hydratePage, renderDocument, renderFormHtml } from './render';
import { boundFormIds } from './sanitize';

export function clientIp(request: Request) {
  return request.headers.get('x-ovelio-client-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown';
}

export function hashIp(ip: string) {
  return createHmac('sha256', process.env.CONTACT_HMAC_KEY || 'ovelio-sites-ip').update('ip:' + ip).digest('hex').slice(0, 32);
}

const cookie = (request: Request, name: string) => {
  const match = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(request.headers.get('cookie') ?? '');
  return match ? decodeURIComponent(match[1]) : null;
};

export function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

export function notFoundPage(message = 'This page is not available. It may have been unpublished or moved.') {
  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found</title>`
    + `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;background:#f8fafc}main{max-width:480px;padding:32px;text-align:center}h1{font-size:28px;margin:0 0 8px}</style>`
    + `</head><body><main><h1>Page not found</h1><p>${escapeHtml(message)}</p></main></body></html>`, 404);
}

// ── Serving ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The published page for an address: /s/<slug> on the workspace, or <slug> (or the home page) on a verified domain. */
export async function findPublishedPage(slug: string, hostname?: string | null): Promise<{ page: PageRow; domain: DomainRow | null } | null> {
  if (hostname) {
    const domain = (await db.query<DomainRow>(`SELECT * FROM site_domains WHERE hostname = $1 AND status = 'verified'`, [hostname.toLowerCase()])).rows[0];
    if (!domain) return null;
    const page = slug
      ? (await db.query<PageRow>(`SELECT * FROM landing_pages WHERE domain_id = $1 AND slug = $2 AND status = 'published'`, [domain.id, slug])).rows[0]
      : domain.home_page_id ? (await db.query<PageRow>(`SELECT * FROM landing_pages WHERE id = $1 AND status = 'published'`, [domain.home_page_id])).rows[0] : undefined;
    return page ? { page, domain } : null;
  }
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const page = (await db.query<PageRow>(`SELECT * FROM landing_pages WHERE domain_id IS NULL AND slug = $1 AND status = 'published'`, [slug])).rows[0];
  return page ? { page, domain: null } : null;
}

/** Picks a variant by weight, sticky per visitor through a cookie. */
export function chooseVariant(page: Pick<PageRow, 'id' | 'ab_enabled' | 'control_weight'>, variants: Pick<VariantRow, 'key' | 'weight' | 'published_version'>[], current: string | null, random = Math.random()) {
  const live = page.ab_enabled ? variants.filter(item => item.published_version != null) : [];
  if (!live.length) return 'a';
  const options = [{ key: 'a', weight: page.control_weight }, ...live.map(item => ({ key: item.key, weight: item.weight }))].filter(item => item.weight > 0);
  if (current && options.some(item => item.key === current)) return current;
  const total = options.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return 'a';
  let point = random * total;
  for (const option of options) {
    point -= option.weight;
    if (point < 0) return option.key;
  }
  return options[options.length - 1].key;
}

export async function servePage(request: Request, slug: string, hostname?: string | null): Promise<Response> {
  const found = await findPublishedPage(slug, hostname);
  if (!found) return (await redirectFor(request, slug, hostname)) ?? notFoundPage();
  const { page, domain } = found;
  const url = new URL(request.url);
  const variants = (await db.query<VariantRow>('SELECT * FROM page_variants WHERE page_id = $1 ORDER BY key', [page.id])).rows;
  const cookieName = `ov_ab_${page.id.slice(0, 8)}`;
  const variant = chooseVariant(page, variants, cookie(request, cookieName));
  const chosen = variant === 'a' ? null : variants.find(item => item.key === variant) ?? null;
  const html = chosen ? chosen.published_html : page.published_html;
  const css = chosen ? chosen.published_css : page.published_css;
  const funnel = await funnelForPage(page.id, url.searchParams.get('fn'));
  const forms = await formsByIds(boundFormIds(html));
  let nextUrl: string | null = null;
  if (funnel?.nextPage) {
    const target = pageUrl(funnel.nextPage, funnel.nextPage.domain);
    nextUrl = `${target}${target.includes('?') ? '&' : '?'}fn=${funnel.funnelId}`;
  }
  const origin = `${request.headers.get('x-forwarded-proto')?.split(',')[0] || url.protocol.replace(':', '')}://${request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host}`;
  const canonical = page.canonical_url || (domain ? pageUrl(page, domain) : `${origin}/s/${page.slug}`);
  const visitor = cookie(request, 'ov_vid');
  const known = new Map<string, Set<string>>();
  for (const form of forms.values()) known.set(form.id, await knownFields(form, visitor));
  const body = hydratePage(html, forms, { pageId: page.id, variant, funnelId: funnel?.funnelId ?? null, stepIndex: funnel?.stepIndex ?? null }, nextUrl, known);
  const document = renderDocument({
    title: page.seo_title || page.name, description: page.seo_description, canonicalUrl: canonical, ogImageUrl: page.og_image_url,
    faviconUrl: page.favicon_url, noindex: page.noindex, css, bodyHtml: body,
    config: { pageId: page.id, variant, funnelId: funnel?.funnelId ?? null, stepIndex: funnel?.stepIndex ?? null, utm: page.utm_defaults ?? {}, track: true },
  });
  const headers: Record<string, string> = {};
  if (page.ab_enabled && variants.length) {
    headers['set-cookie'] = `${cookieName}=${variant}; Max-Age=2592000; Path=/; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`;
  }
  return htmlResponse(document, 200, headers);
}

/** The hosted form page at /f/<formId>. */
export async function serveFormPage(formId: string, request?: Request): Promise<Response> {
  const form = await getForm(formId);
  if (!form || form.status !== 'published') return notFoundPage('This form is not accepting submissions.');
  const known = request ? await knownFields(form, cookie(request, 'ov_vid')) : new Set<string>();
  const formHtml = renderFormHtml(form, { action: `/api/public/forms/${form.id}/submit`, known });
  const css = `body{margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;line-height:1.5}
main{max-width:560px;margin:0 auto;padding:48px 20px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;box-shadow:0 12px 40px rgba(15,23,42,.08)}
h1{font-size:26px;line-height:1.2;margin:0 0 8px}p.lead{margin:0 0 24px;color:#475569}@media (max-width:480px){main{padding:20px 14px}.card{padding:22px}}`;
  return htmlResponse(renderDocument({
    title: form.name, description: form.description, canonicalUrl: '', ogImageUrl: '', faviconUrl: '', noindex: true, css,
    bodyHtml: `<main><div class="card"><h1>${escapeHtml(form.name)}</h1>${form.description ? `<p class="lead">${escapeHtml(form.description)}</p>` : ''}${formHtml}</div></main>`,
    config: { pageId: null, variant: null, funnelId: null, stepIndex: null, utm: {}, track: false },
  }));
}

// ── Tracking ──────────────────────────────────────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const utmSchema = z.object({ source: text(200), medium: text(200), campaign: text(200), term: text(200), content: text(200) }).partial();
export const visitorIdPattern = /^[A-Za-z0-9-]{8,64}$/;

export const trackInput = z.object({
  pageId: z.uuid(),
  variant: z.string().regex(/^[a-h]$/).default('a'),
  funnelId: z.uuid().nullable().optional(),
  stepIndex: z.number().int().min(0).max(100).nullable().optional(),
  visitorId: z.string().regex(visitorIdPattern),
  utm: utmSchema.default({}),
  url: text(500).optional(),
  referrer: text(500).optional(),
});

const cleanUtm = (utm: Utm): Utm => Object.fromEntries(Object.entries(utm).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, String(value).trim().slice(0, 200)]));

async function contactForVisitor(visitorId: string): Promise<number | null> {
  const row = (await db.query<{ contact_id: string }>(`SELECT contact_id FROM identity_links WHERE kind = 'analytics_visitor' AND value = $1`, [visitorId])).rows[0];
  return row ? Number(row.contact_id) : null;
}

const knownValue: Record<string, (contact: NonNullable<Awaited<ReturnType<typeof getContact>>>) => string> = {
  firstName: contact => contact.firstName, lastName: contact => contact.lastName, company: contact => contact.company,
  phone: contact => contact.phone, position: contact => contact.position, email: contact => contact.email,
};

/** Progressive profiling: skipIfKnown fields whose contact value a recognised visitor already has. Values are never revealed. */
export async function knownFields(form: Pick<FormRow, 'fields'>, visitorId: string | null): Promise<Set<string>> {
  const skippable = form.fields.filter(field => field.skipIfKnown && field.mapsTo in knownValue);
  if (!skippable.length || !visitorId || !visitorIdPattern.test(visitorId)) return new Set();
  const contactId = await contactForVisitor(visitorId);
  const contact = contactId ? await getContact(contactId).catch(() => null) : null;
  if (!contact) return new Set();
  return new Set(skippable.filter(field => knownValue[field.mapsTo](contact)?.trim()).map(field => field.key));
}

async function funnelStep(funnelId: string | null | undefined, stepIndex: number | null | undefined, pageId: string) {
  if (!funnelId || stepIndex == null) return null;
  const row = (await db.query<{ total: string }>(
    `SELECT (SELECT count(*) FROM funnel_steps x WHERE x.funnel_id = s.funnel_id) AS total FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id
     WHERE s.funnel_id = $1 AND s.position = $2 AND s.page_id = $3 AND f.status = 'active'`, [funnelId, stepIndex, pageId],
  )).rows[0];
  return row ? { funnelId, stepIndex, last: stepIndex === Number(row.total) - 1 } : null;
}

/** funnel.step_viewed once per visitor and step; funnel.completed once per visitor on the last step. */
async function recordFunnelProgress(step: { funnelId: string; stepIndex: number; last: boolean }, base: { visitorId: string; contactId: number | null; campaignId: string | null; utm: Utm; pageId: string }) {
  await emitEvent({
    type: 'funnel.step_viewed', entityType: 'funnel', entityId: step.funnelId, visitorId: base.visitorId, contactId: base.contactId, campaignId: base.campaignId,
    utm: base.utm, source: 'sites', properties: { stepIndex: step.stepIndex, pageId: base.pageId }, idempotencyKey: `funnel.step:${step.funnelId}:${step.stepIndex}:${base.visitorId}`,
  });
  if (step.last) {
    await emitEvent({
      type: 'funnel.completed', entityType: 'funnel', entityId: step.funnelId, visitorId: base.visitorId, contactId: base.contactId, campaignId: base.campaignId,
      utm: base.utm, source: 'sites', properties: { stepIndex: step.stepIndex, pageId: base.pageId }, idempotencyKey: `funnel.completed:${step.funnelId}:${base.visitorId}`,
    });
  }
}

export async function recordView(raw: unknown) {
  const input = trackInput.parse(raw);
  const page = (await db.query<{ id: string; utm_defaults: Utm }>(`SELECT id, utm_defaults FROM landing_pages WHERE id = $1 AND status = 'published'`, [input.pageId])).rows[0];
  if (!page) throw new AppError(404, 'That page is not published.');
  const utm = cleanUtm(Object.keys(cleanUtm(input.utm)).length ? input.utm : page.utm_defaults ?? {});
  const step = await funnelStep(input.funnelId, input.stepIndex, page.id);
  const [contactId, campaignId] = await Promise.all([
    contactForVisitor(input.visitorId),
    resolveCampaignId({ assets: [{ type: 'page', id: page.id }, ...(step ? [{ type: 'funnel', id: step.funnelId }] : [])], utmCampaign: utm.campaign }),
  ]);
  let referrerHost: string | null = null;
  try { referrerHost = input.referrer ? new URL(input.referrer).hostname : null; } catch { referrerHost = null; }
  let path: string | null = null;
  try { path = input.url ? new URL(input.url).pathname : null; } catch { path = null; }
  await emitEvent({
    type: 'page.viewed', entityType: 'page', entityId: page.id, visitorId: input.visitorId, contactId, campaignId, utm, source: 'sites',
    properties: { variant: input.variant, path, referrer: referrerHost, ...(step ? { funnelId: step.funnelId, stepIndex: step.stepIndex } : {}) },
  });
  if (step) await recordFunnelProgress(step, { visitorId: input.visitorId, contactId, campaignId, utm, pageId: page.id });
  return { recorded: true };
}

// ── Submissions ───────────────────────────────────────────────────────────────────────────────────────────────

const contactKeys = ['email', 'firstName', 'lastName', 'company', 'phone', 'position', 'city', 'country', 'website'] as const;

export type SubmitMeta = { ip: string; cookieVisitorId: string | null; referer: string | null };

export type SubmitOutcome = { status: number; result: SubmitResult };

const one = (value: unknown) => (Array.isArray(value) ? String(value[0] ?? '') : value == null ? '' : String(value)).trim();

/**
 * The submission pipeline: validate → upsert the contact (dedupe by email, consent only when ticked, with evidence)
 * → link the visitor → store the submission → events (form.submitted, page.converted, funnel progress) → follow-up
 * task and confirmation email (the mailer's status is stored and returned, never hidden).
 */
export async function submitForm(formId: string, raw: Record<string, unknown>, meta: SubmitMeta): Promise<SubmitOutcome> {
  const form = await getForm(formId);
  if (!form || form.status !== 'published') return { status: 404, result: { ok: false, error: 'This form is not accepting submissions.', fieldErrors: {} } };
  const settings = formSettings(form);
  const ipHash = hashIp(meta.ip);
  const visitorCandidate = one(raw._vid) || meta.cookieVisitorId || '';
  const visitorId = visitorIdPattern.test(visitorCandidate) ? visitorCandidate : null;
  const utm = cleanUtm({ source: one(raw._utm_source), medium: one(raw._utm_medium), campaign: one(raw._utm_campaign), term: one(raw._utm_term), content: one(raw._utm_content) });
  const pageUrlValue = (one(raw._url) || meta.referer || '').slice(0, 500);
  const pageCandidate = one(raw._page);
  const page = uuidPattern.test(pageCandidate)
    ? (await db.query<{ id: string; name: string }>('SELECT id, name FROM landing_pages WHERE id = $1', [pageCandidate])).rows[0] ?? null
    : null;
  const variant = /^[a-h]$/.test(one(raw._variant)) ? one(raw._variant) : page ? 'a' : null;
  const stepRaw = one(raw._step);
  const step = page && visitorId ? await funnelStep(uuidPattern.test(one(raw._funnel)) ? one(raw._funnel) : null, stepRaw === '' ? null : Number(stepRaw), page.id) : null;

  if (one(raw._website)) {
    // Honeypot: a hidden field people never see. Keep a record and answer like a success so bots learn nothing.
    await db.query(
      `INSERT INTO form_submissions (form_id, field_values, page_id, visitor_id, utm, page_url, status, error_detail, ip_hash) VALUES ($1, '{}', $2, $3, $4, $5, 'spam', 'Hidden honeypot field was filled in.', $6)`,
      [form.id, page?.id ?? null, visitorId, JSON.stringify(utm), pageUrlValue, ipHash],
    );
    return { status: 200, result: { ok: true, message: settings.successMessage, redirect: null, submissionId: 'filtered' } };
  }

  const { values, errors } = validateAnswers(form.fields, raw, await knownFields(form, visitorId));
  const consentGiven = settings.consent.enabled && ['yes', 'on', 'true', '1'].includes(one(raw._consent).toLowerCase());
  if (settings.consent.enabled && settings.consent.required && !consentGiven) errors._consent = 'Tick the box to continue.';
  if (Object.keys(errors).length) {
    return { status: 422, result: { ok: false, error: Object.keys(errors).length === 1 ? Object.values(errors)[0] : 'Check the highlighted fields and try again.', fieldErrors: errors } };
  }

  const emailField = form.fields.find(field => field.mapsTo === 'email');
  const email = emailField ? String(values[emailField.key] ?? '') : '';
  if (!email) return { status: 422, result: { ok: false, error: 'Enter your email address.', fieldErrors: emailField ? { [emailField.key]: 'Enter your email address.' } : {} } };

  const now = new Date();
  const upsert: ContactUpsert = { email, source: `Form: ${form.name}`, tags: settings.tags };
  const customFields: Record<string, string | string[]> = {};
  for (const field of form.fields) {
    const value = values[field.key];
    if (field.mapsTo.startsWith('custom:')) {
      if (Array.isArray(value) ? value.length : value) customFields[field.mapsTo.slice(7)] = value;
    } else if ((contactKeys as readonly string[]).includes(field.mapsTo) && field.mapsTo !== 'email' && typeof value === 'string' && value) {
      (upsert as Record<string, unknown>)[field.mapsTo] = value.slice(0, 200);
    }
  }
  if (Object.keys(customFields).length) upsert.customFields = customFields;
  if (consentGiven) {
    upsert.consent = 'opted_in';
    upsert.evidence = `Form ${form.name} on ${pageUrlValue || 'the hosted form page'} at ${now.toISOString()}`;
  }

  const submissionId = randomUUID();
  let contactId: number;
  try {
    contactId = (await upsertContact(upsert)).contact.id;
  } catch (error) {
    const detail = error instanceof AppError ? error.message : 'The contact directory did not accept the record.';
    await db.query(
      `INSERT INTO form_submissions (id, form_id, field_values, page_id, variant, visitor_id, utm, page_url, status, error_detail, consent_given, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'error', $9, $10, $11)`,
      [submissionId, form.id, JSON.stringify(values), page?.id ?? null, variant, visitorId, JSON.stringify(utm), pageUrlValue, detail.slice(0, 500), consentGiven, ipHash],
    );
    const status = error instanceof AppError && error.status < 500 ? 422 : 502;
    return { status, result: { ok: false, error: status === 422 ? detail : 'We could not save your details right now. Please try again in a few minutes.', fieldErrors: {} } };
  }

  const route = step && page ? await branchTarget(step.funnelId, step.stepIndex, values) : null;
  const campaignId = await resolveCampaignId({
    assets: [{ type: 'form', id: form.id }, ...(page ? [{ type: 'page', id: page.id }] : []), ...(step ? [{ type: 'funnel', id: step.funnelId }] : [])],
    utmCampaign: utm.campaign,
  });

  await transaction(async client => {
    if (visitorId) {
      await client.query(`INSERT INTO identity_links (kind, value, contact_id) VALUES ('analytics_visitor', $1, $2) ON CONFLICT (kind, value) DO UPDATE SET contact_id = EXCLUDED.contact_id`, [visitorId, contactId]);
    }
    await client.query(`INSERT INTO identity_links (kind, value, contact_id) VALUES ('form_submission', $1, $2) ON CONFLICT DO NOTHING`, [submissionId, contactId]);
    await client.query(
      `INSERT INTO form_submissions (id, form_id, contact_id, field_values, page_id, funnel_id, variant, visitor_id, utm, page_url, status, consent_given, campaign_id, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'accepted', $11, $12, $13)`,
      [submissionId, form.id, contactId, JSON.stringify(values), page?.id ?? null, step?.funnelId ?? null, variant, visitorId, JSON.stringify(utm), pageUrlValue, consentGiven, campaignId, ipHash],
    );
    await emitEvent({
      type: 'form.submitted', contactId, entityType: 'form', entityId: form.id, campaignId, utm, visitorId, source: 'sites',
      properties: {
        formName: form.name, pageId: page?.id ?? null, funnelId: step?.funnelId ?? null, fields: values, submissionId, consent: consentGiven,
        ...(step && route ? { stepIndex: step.stepIndex, branch: route.branch, nextStep: route.toPosition } : {}),
      },
      idempotencyKey: `form.submitted:${submissionId}`,
    }, client);
    if (page) {
      await emitEvent({
        type: 'page.converted', contactId, entityType: 'page', entityId: page.id, campaignId, utm, visitorId, source: 'sites',
        properties: { variant: variant ?? 'a', formId: form.id, submissionId, ...(step ? { funnelId: step.funnelId, stepIndex: step.stepIndex } : {}) },
        idempotencyKey: `page.converted:${submissionId}`,
      }, client);
    }
  });
  if (step && visitorId && page) await recordFunnelProgress(step, { visitorId, contactId, campaignId, utm, pageId: page.id });

  if (settings.notifyUserId) {
    await createTask({
      title: `Follow up: ${form.name} from ${email}`.slice(0, 300), type: 'follow_up', contactId, assigneeId: settings.notifyUserId,
      source: `form:${form.id}`, notes: page ? `Submitted on ${page.name}.` : 'Submitted on the hosted form page.',
    }).catch(error => console.error(JSON.stringify({ level: 'error', scope: 'sites-notify', error: (error as Error).message })));
  }

  let emailNote = '';
  if (settings.confirmationDesignId) {
    let status = 'failed';
    let detail = '';
    try {
      const sent = await sendDesign(settings.confirmationDesignId, { to: email, category: 'transactional', source: `form:${form.id}`, contactId, campaignId, idempotencyKey: `form-confirmation:${submissionId}` });
      status = sent.status;
      detail = sent.reason;
    } catch (error) {
      detail = error instanceof AppError ? error.message : 'The confirmation email could not be prepared.';
    }
    await db.query('UPDATE form_submissions SET email_status = $2, email_detail = $3 WHERE id = $1', [submissionId, status, detail.slice(0, 500)]);
    if (status !== 'sent') emailNote = status === 'blocked' ? ' (No confirmation email was sent because email consent was not given.)' : '';
  }

  let redirect: string | null = null;
  if (settings.afterSubmit === 'redirect' && settings.redirectUrl) redirect = settings.redirectUrl;
  else if (settings.afterSubmit === 'page' && settings.thankYouPageId) {
    const target = (await db.query<PageRow>(`SELECT * FROM landing_pages WHERE id = $1 AND status = 'published'`, [settings.thankYouPageId])).rows[0];
    if (target) {
      const domain = target.domain_id ? (await db.query<DomainRow>('SELECT * FROM site_domains WHERE id = $1', [target.domain_id])).rows[0] : null;
      redirect = pageUrl(target, domain);
    }
  } else if (step && route?.page) {
    const target = pageUrl(route.page, route.page.domain);
    redirect = `${target}${target.includes('?') ? '&' : '?'}fn=${step.funnelId}`;
  }
  return { status: 200, result: { ok: true, message: settings.successMessage + emailNote, redirect, submissionId } };
}

/** Parses JSON, urlencoded or multipart bodies into a flat record (repeated keys become arrays). */
export async function readSubmission(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 64 * 1024) throw new AppError(413, 'The submission is too large.');
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await request.text();
    if (body.length > 64 * 1024) throw new AppError(413, 'The submission is too large.');
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      throw new AppError(400, 'Send the form as JSON or a regular form post.');
    }
  }
  const data = await request.formData();
  const out: Record<string, unknown> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value !== 'string') continue;
    out[key] = key in out ? [...([] as string[]).concat(out[key] as string), value] : value;
  }
  return out;
}

export function formPostResultPage(outcome: SubmitOutcome, back: string | null): Response {
  if (outcome.result.ok && outcome.result.redirect) return new Response(null, { status: 303, headers: { location: outcome.result.redirect } });
  const ok = outcome.result.ok;
  const body = ok
    ? `<h1>Thank you</h1><p>${escapeHtml((outcome.result as { message: string }).message)}</p>`
    : `<h1>Please check the form</h1><p>${escapeHtml(outcome.result.error)}</p><ul>${Object.values(outcome.result.fieldErrors).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  const link = back && /^https?:\/\//.test(back) ? `<p><a href="${escapeHtml(back)}">${ok ? 'Return to the page' : 'Go back and try again'}</a></p>` : '';
  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${ok ? 'Thank you' : 'Check the form'}</title>`
    + `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,sans-serif;color:#0f172a;background:#f8fafc}main{max-width:520px;padding:32px}h1{margin:0 0 8px;font-size:26px}</style></head>`
    + `<body><main role="${ok ? 'status' : 'alert'}">${body}${link}</main></body></html>`, ok ? 200 : outcome.status);
}

export const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, accept', 'access-control-max-age': '600' };

/** Form markup and styles for the embed script on other websites. */
export async function embedPayload(formId: string, origin: string) {
  const form = await getForm(formId);
  if (!form || form.status !== 'published') return null;
  return { html: renderFormHtml(form as FormRow, { action: `${origin}/api/public/forms/${form.id}/submit` }) };
}

// ── Redirects, sitemaps and robots ────────────────────────────────────────────────────────────────────────────

/** 301 from an old page address to the page's current one, keeping the query string (UTM parameters). */
export async function redirectFor(request: Request, slug: string, hostname?: string | null): Promise<Response | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  let domain: DomainRow | null = null;
  if (hostname) {
    domain = (await db.query<DomainRow>(`SELECT * FROM site_domains WHERE hostname = $1 AND status = 'verified'`, [hostname.toLowerCase()])).rows[0] ?? null;
    if (!domain) return null;
  }
  const row = (await db.query<PageRow & { redirect_id: string }>(
    `SELECT p.*, r.id AS redirect_id FROM page_redirects r JOIN landing_pages p ON p.id = r.page_id
     WHERE coalesce(r.domain_id::text, '') = coalesce($1::text, '') AND r.from_slug = $2 AND p.status = 'published'`, [domain?.id ?? null, slug],
  )).rows[0];
  if (!row) return null;
  await db.query('UPDATE page_redirects SET hits = hits + 1 WHERE id = $1', [row.redirect_id]);
  const target = row.domain_id ? (row.domain_id === domain?.id ? domain : (await db.query<DomainRow>('SELECT * FROM site_domains WHERE id = $1', [row.domain_id])).rows[0] ?? null) : null;
  let location = pageUrl(row, target);
  if (domain && target?.id === domain.id) location = new URL(location).pathname;
  return new Response(null, { status: 301, headers: { location: location + new URL(request.url).search, 'cache-control': 'public, max-age=300' } });
}

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** sitemap.xml of the published, indexable pages on the workspace address or on one verified domain. */
export async function sitemapXml(origin: string, hostname?: string | null): Promise<string | null> {
  let rows: (PageRow & { home: boolean })[];
  let base = origin;
  if (hostname) {
    const domain = (await db.query<DomainRow>(`SELECT * FROM site_domains WHERE hostname = $1 AND status = 'verified'`, [hostname.toLowerCase()])).rows[0];
    if (!domain) return null;
    base = `https://${domain.hostname}`;
    rows = (await db.query<PageRow & { home: boolean }>(
      `SELECT *, id = $2 AS home FROM landing_pages WHERE domain_id = $1 AND status = 'published' AND NOT noindex ORDER BY slug`, [domain.id, domain.home_page_id])).rows;
  } else {
    rows = (await db.query<PageRow & { home: boolean }>(`SELECT *, false AS home FROM landing_pages WHERE domain_id IS NULL AND status = 'published' AND NOT noindex ORDER BY slug`)).rows;
  }
  const urls = rows.map(row => `<url><loc>${xml(`${base}${hostname ? (row.home ? '/' : `/${row.slug}`) : `/s/${row.slug}`}`)}</loc>${row.published_at ? `<lastmod>${new Date(row.published_at).toISOString()}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`;
}

/** robots.txt: on the workspace address only published pages (/s/) may be crawled; a publishing domain is all pages. */
export function robotsTxt(origin: string, hostname?: string | null) {
  return hostname
    ? `User-agent: *\nAllow: /\n\nSitemap: https://${hostname}/sitemap.xml\n`
    : `User-agent: *\nAllow: /s/\nDisallow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}
