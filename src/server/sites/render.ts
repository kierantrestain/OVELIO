// Server rendering for published pages, hosted forms and embeds (Lane 3): the OVELIO form markup, the complete HTML
// document with SEO and social tags, and the small first-party tracker (page views, funnel steps, form submits).
import type { FormField, FormSettings } from '@/contracts/sites';
import type { Utm } from '@/contracts/platform';
import type { FormRow } from './data';
import { formSettings } from './data';

export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const autocomplete: Record<string, string> = {
  email: 'email', firstName: 'given-name', lastName: 'family-name', company: 'organization', phone: 'tel', position: 'organization-title',
  city: 'address-level2', country: 'country-name', website: 'url',
};

export type FormContext = {
  action: string;
  pageId?: string | null;
  variant?: string | null;
  funnelId?: string | null;
  stepIndex?: number | null;
};

function inputType(field: FormField) {
  return ({ email: 'email', phone: 'tel', number: 'number', date: 'date', url: 'url' } as Record<string, string>)[field.type] ?? 'text';
}

function renderField(form: FormRow, field: FormField): string {
  const id = `ovf-${form.id.slice(0, 8)}-${field.key}`;
  const required = field.required ? ' required aria-required="true"' : '';
  const label = `${escapeHtml(field.label)}${field.required ? '<span class="ovf-req" aria-hidden="true">*</span>' : ''}`;
  const help = field.help ? `<p class="ovf-help" id="${id}-help">${escapeHtml(field.help)}</p>` : '';
  const describedBy = ` aria-describedby="${id}-error${field.help ? ` ${id}-help` : ''}"`;
  const error = `<p class="ovf-error" id="${id}-error" hidden></p>`;
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
  const auto = field.mapsTo in autocomplete ? ` autocomplete="${autocomplete[field.mapsTo]}"` : '';
  const options = field.options ?? [];
  let control: string;
  switch (field.type) {
    case 'hidden':
      return `<input type="hidden" name="${escapeHtml(field.key)}" value="${escapeHtml(field.defaultValue ?? '')}">`;
    case 'textarea':
      control = `<label for="${id}">${label}</label><textarea id="${id}" name="${escapeHtml(field.key)}" rows="4"${placeholder}${required}${describedBy}></textarea>`;
      break;
    case 'select':
      control = `<label for="${id}">${label}</label><select id="${id}" name="${escapeHtml(field.key)}"${required}${describedBy}><option value="">${escapeHtml(field.placeholder || 'Choose…')}</option>`
        + options.map(option => `<option>${escapeHtml(option)}</option>`).join('') + '</select>';
      break;
    case 'radio':
    case 'checkboxes':
      control = `<fieldset class="ovf-group"${field.type === 'checkboxes' ? ` data-multi="${escapeHtml(field.key)}"` : ''}${describedBy}><legend>${label}</legend>`
        + options.map((option, index) => `<label class="ovf-choice"><input type="${field.type === 'radio' ? 'radio' : 'checkbox'}" name="${escapeHtml(field.key)}" value="${escapeHtml(option)}"${field.type === 'radio' && field.required && index === 0 ? ' required' : ''}> <span>${escapeHtml(option)}</span></label>`).join('')
        + '</fieldset>';
      break;
    case 'checkbox':
      control = `<label class="ovf-choice"><input type="checkbox" id="${id}" name="${escapeHtml(field.key)}" value="yes"${required}${describedBy}> <span>${label}</span></label>`;
      break;
    default:
      control = `<label for="${id}">${label}</label><input id="${id}" type="${inputType(field)}" name="${escapeHtml(field.key)}"${placeholder}${auto}${required}${describedBy}>`;
  }
  return `<div class="ovf-field" data-field="${escapeHtml(field.key)}">${control}${help}${error}</div>`;
}

/** The markup of an OVELIO form. Works without JavaScript (plain POST); the tracker upgrades it to an inline submit. */
export function renderFormHtml(form: FormRow, context: FormContext): string {
  const settings: FormSettings = formSettings(form);
  const parts: string[] = [];
  let half: string[] = [];
  const flush = () => {
    if (half.length) parts.push(half.length === 2 ? `<div class="ovf-row">${half.join('')}</div>` : half.join(''));
    half = [];
  };
  for (const field of form.fields) {
    const html = renderField(form, field);
    if (field.width === 'half' && field.type !== 'hidden') {
      half.push(html);
      if (half.length === 2) flush();
    } else {
      flush();
      parts.push(html);
    }
  }
  flush();
  if (settings.consent.enabled) {
    parts.push(`<div class="ovf-field ovf-consent" data-field="_consent"><label class="ovf-choice"><input type="checkbox" name="_consent" value="yes"${settings.consent.required ? ' required' : ''}> <span>${escapeHtml(settings.consent.text)}</span></label><p class="ovf-error" hidden></p></div>`);
  }
  const hidden = (name: string, value: string | number | null | undefined) => `<input type="hidden" name="${name}" value="${escapeHtml(value == null ? '' : String(value))}">`;
  parts.push(`<div class="ovf-hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="_website" tabindex="-1" autocomplete="off"></label></div>`);
  parts.push(hidden('_page', context.pageId) + hidden('_variant', context.variant) + hidden('_funnel', context.funnelId) + hidden('_step', context.stepIndex)
    + hidden('_vid', '') + hidden('_url', '') + ['source', 'medium', 'campaign', 'term', 'content'].map(key => hidden('_utm_' + key, '')).join(''));
  parts.push(`<button type="submit" class="ovf-submit">${escapeHtml(settings.submitLabel || 'Submit')}</button><p class="ovf-status" role="status" aria-live="polite"></p>`);
  return `<form class="ovf" method="post" action="${escapeHtml(context.action)}" data-ovelio-form-id="${form.id}" novalidate aria-label="${escapeHtml(form.name)}">${parts.join('')}</form>`;
}

export const formCss = `.ovf{display:grid;gap:14px;text-align:left;font:inherit;color:inherit}
.ovf-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ovf-field{display:grid;gap:6px;min-width:0}
.ovf label,.ovf legend{font-size:14px;font-weight:600}
.ovf-req{color:#b91c1c;margin-left:3px}
.ovf input:not([type=checkbox]):not([type=radio]),.ovf select,.ovf textarea{width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;font-size:15px;line-height:1.4;background:#fff;color:#0f172a;outline:none}
.ovf textarea{resize:vertical}
.ovf-group{border:0;margin:0;padding:0;display:grid;gap:8px}
.ovf-choice{display:flex;gap:10px;align-items:flex-start;font-weight:400!important;font-size:14px;line-height:1.45;cursor:pointer}
.ovf-choice input{margin-top:3px;width:16px;height:16px;flex:none}
.ovf-help{font-size:13px;color:#64748b;margin:0}
.ovf-error{font-size:13px;color:#b91c1c;margin:0}
.ovf-invalid input:not([type=checkbox]):not([type=radio]),.ovf-invalid select,.ovf-invalid textarea{border-color:#dc2626}
.ovf-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
.ovf-submit{padding:14px 20px;border:0;font:inherit;font-weight:700;font-size:16px;cursor:pointer;background:#2457d6;color:#fff;border-radius:8px;width:100%}
.ovf-submit[disabled]{opacity:.6;cursor:progress}
.ovf-status{margin:0;font-size:14px;min-height:1px}
.ovf-status--error{color:#b91c1c}
.ovf-success{padding:20px;border-radius:10px;background:#ecfdf5;color:#065f46;font-weight:600;line-height:1.5}
@media (max-width:480px){.ovf-row{grid-template-columns:1fr}}`;

/** Binds every OVELIO form under `root`: fills context fields and submits inline as JSON. Shared by pages and embeds. */
export const formBinderJs = `function ovelioBindForms(root,vid,utm,cross){var keys=['source','medium','campaign','term','content'];
root.querySelectorAll('form[data-ovelio-form-id]').forEach(function(form){if(form.__ov)return;form.__ov=1;
function set(n,v){var i=form.querySelector('input[name="'+n+'"]');if(i)i.value=v}
set('_vid',vid);set('_url',location.href.slice(0,500));keys.forEach(function(k){set('_utm_'+k,utm[k]||'')});
form.addEventListener('submit',function(ev){ev.preventDefault();var btn=form.querySelector('.ovf-submit');var status=form.querySelector('.ovf-status');
form.querySelectorAll('.ovf-field').forEach(function(f){f.classList.remove('ovf-invalid');var e=f.querySelector('.ovf-error');if(e){e.textContent='';e.hidden=true}});
var data={};new FormData(form).forEach(function(v,k){if(typeof v!=='string')return;if(data[k]!==undefined){data[k]=[].concat(data[k],v)}else{data[k]=v}});
form.querySelectorAll('[data-multi]').forEach(function(g){var k=g.getAttribute('data-multi');data[k]=data[k]===undefined?[]:[].concat(data[k])});
btn.disabled=true;status.textContent='Sending…';status.className='ovf-status';
fetch(form.action,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(data),credentials:cross?'omit':'same-origin'})
.then(function(r){return r.json().catch(function(){return {ok:false,error:'The form could not be sent. Try again in a moment.'}})})
.then(function(res){btn.disabled=false;
if(res.ok){if(res.redirect){location.href=res.redirect;return}var d=document.createElement('div');d.className='ovf-success';d.setAttribute('role','status');d.textContent=res.message;form.replaceWith(d);return}
status.textContent=res.error||'Check the highlighted fields.';status.className='ovf-status ovf-status--error';
Object.keys(res.fieldErrors||{}).forEach(function(k){var f=form.querySelector('[data-field="'+k+'"]');if(!f)return;f.classList.add('ovf-invalid');var e=f.querySelector('.ovf-error');if(e){e.textContent=res.fieldErrors[k];e.hidden=false}});
var first=form.querySelector('.ovf-invalid input,.ovf-invalid select,.ovf-invalid textarea');if(first)first.focus()})
.catch(function(){btn.disabled=false;status.textContent='The form could not be sent. Check your connection and try again.';status.className='ovf-status ovf-status--error'})})})}`;

/** Visitor id cookie and UTM capture shared by pages and embeds. */
export const visitorJs = `function ovelioVisitor(defaults){function cookie(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):null}
var vid=cookie('ov_vid');if(!vid||!/^[A-Za-z0-9-]{8,64}$/.test(vid)){vid=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():('v'+Date.now().toString(36)+Math.random().toString(36).slice(2,14))}
document.cookie='ov_vid='+vid+'; Max-Age=31536000; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
var keys=['source','medium','campaign','term','content'];var q=new URLSearchParams(location.search);var utm={};var stored={};
try{stored=JSON.parse(sessionStorage.getItem('ov_utm')||'{}')}catch(e){}
keys.forEach(function(k){var v=q.get('utm_'+k);if(v)utm[k]=v.slice(0,200)});
if(Object.keys(utm).length){try{sessionStorage.setItem('ov_utm',JSON.stringify(utm))}catch(e){}}else{utm=Object.keys(stored).length?stored:(defaults||{})}
return {vid:vid,utm:utm}}`;

const trackerJs = `(function(){var cfg={};try{cfg=JSON.parse(document.getElementById('ovelio-config').textContent)}catch(e){}
${visitorJs}
${formBinderJs}
var v=ovelioVisitor(cfg.utm);
if(cfg.track&&cfg.pageId){try{var body=JSON.stringify({pageId:cfg.pageId,variant:cfg.variant||'a',funnelId:cfg.funnelId||null,stepIndex:cfg.stepIndex==null?null:cfg.stepIndex,visitorId:v.vid,utm:v.utm,url:location.href.slice(0,500),referrer:document.referrer.slice(0,500)});
if(!(navigator.sendBeacon&&navigator.sendBeacon('/api/public/track',new Blob([body],{type:'application/json'})))){fetch('/api/public/track',{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true})}}catch(e){}}
ovelioBindForms(document,v.vid,v.utm,false);
document.querySelectorAll('[data-ovelio-countdown]').forEach(function(el){var end=Date.parse(el.getAttribute('data-ovelio-countdown'));if(isNaN(end))return;
function tick(){var s=Math.max(0,Math.floor((end-Date.now())/1000));var u={days:Math.floor(s/86400),hours:Math.floor(s%86400/3600),minutes:Math.floor(s%3600/60),seconds:s%60};
Object.keys(u).forEach(function(k){var n=el.querySelector('[data-unit="'+k+'"]');if(n)n.textContent=String(u[k]).padStart(2,'0')})}tick();setInterval(tick,1000)})})();`;

export type DocumentInput = {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImageUrl: string;
  faviconUrl: string;
  noindex: boolean;
  bodyHtml: string;
  css: string;
  config: { pageId: string | null; variant: string | null; funnelId: string | null; stepIndex: number | null; utm: Utm; track: boolean };
  banner?: string;
  lang?: string;
};

const defaultFavicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2457d6"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>')}`;

/** The complete public HTML document for a page or hosted form. */
export function renderDocument(input: DocumentInput): string {
  const meta = (name: string, content: string, attr = 'name') => content ? `<meta ${attr}="${name}" content="${escapeHtml(content)}">` : '';
  const config = JSON.stringify(input.config).replace(/</g, '\\u003c');
  const banner = input.banner
    ? `<div style="position:sticky;top:0;z-index:2147483647;background:#0f172a;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center">${escapeHtml(input.banner)}</div>`
    : '';
  return `<!doctype html><html lang="${escapeHtml(input.lang ?? 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escapeHtml(input.title)}</title>${meta('description', input.description)}`
    + (input.noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">')
    + (input.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(input.canonicalUrl)}">` : '')
    + meta('og:type', 'website', 'property') + meta('og:title', input.title, 'property') + meta('og:description', input.description, 'property')
    + meta('og:url', input.canonicalUrl, 'property') + meta('og:image', input.ogImageUrl, 'property')
    + meta('twitter:card', input.ogImageUrl ? 'summary_large_image' : 'summary') + meta('twitter:title', input.title) + meta('twitter:description', input.description)
    + meta('twitter:image', input.ogImageUrl)
    + `<link rel="icon" href="${escapeHtml(input.faviconUrl || defaultFavicon)}">`
    + `<style>${formCss}</style><style>${input.css}</style></head><body>${banner}${input.bodyHtml}`
    + `<script type="application/json" id="ovelio-config">${config}</script><script>${trackerJs}</script></body></html>`;
}

/** Replaces each bound form block with the live form markup, and next-step links with the funnel's next page. */
export function hydratePage(html: string, forms: Map<string, FormRow>, context: Omit<FormContext, 'action'>, nextStepUrl: string | null) {
  return html
    .replace(/<div([^>]*)data-ovelio-form="([0-9a-f-]{36})"([^>]*)>\s*<\/div>/g, (whole, before: string, formId: string, after: string) => {
      const form = forms.get(formId);
      if (!form || form.status !== 'published') return `<div${before}data-ovelio-form="${formId}"${after}></div>`;
      return `<div${before}data-ovelio-form="${formId}"${after}>${renderFormHtml(form, { ...context, action: `/api/public/forms/${formId}/submit` })}</div>`;
    })
    .replace(/href="#ovelio-next-step"/g, `href="${escapeHtml(nextStepUrl ?? '#')}"`);
}
