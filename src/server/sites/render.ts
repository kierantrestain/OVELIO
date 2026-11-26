// Server rendering for published pages, hosted forms and embeds (Lane 3): the OVELIO form markup, the complete HTML
// document with SEO and social tags, and the small first-party tracker (page views, funnel steps, form submits).
import type { FormField, FormSettings } from '@/contracts/sites';
import type { Utm } from '@/contracts/platform';
import type { FormRow } from './data';
import { formStepCount } from '@/contracts/sites';
import { formSettings } from './data';
import { formCss } from '@/templates/pages/form-css';

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
  /** Progressive profiling: keys of skipIfKnown fields the recognised visitor's contact already has. */
  known?: ReadonlySet<string>;
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
  const rules = field.showIf?.length ? ` data-show-if="${escapeHtml(JSON.stringify(field.showIf))}"` : '';
  return `<div class="ovf-field" data-field="${escapeHtml(field.key)}"${rules}>${control}${help}${error}</div>`;
}

/** The markup of an OVELIO form. Works without JavaScript (plain POST); the tracker upgrades it to an inline submit. */
export function renderFormHtml(form: FormRow, context: FormContext): string {
  const settings: FormSettings = formSettings(form);
  const steps = formStepCount(settings);
  const known = context.known ?? new Set<string>();
  const fields = form.fields.filter(field => !(field.skipIfKnown && known.has(field.key)));
  const sections: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    const parts: string[] = [];
    let half: string[] = [];
    const flush = () => {
      if (half.length) parts.push(half.length === 2 ? `<div class="ovf-row">${half.join('')}</div>` : half.join(''));
      half = [];
    };
    for (const field of fields.filter(item => Math.min(item.step ?? 0, steps - 1) === step)) {
      const html = renderField(form, field);
      if (field.width === 'half' && field.type !== 'hidden' && !field.showIf?.length) {
        half.push(html);
        if (half.length === 2) flush();
      } else {
        flush();
        parts.push(html);
      }
    }
    flush();
    if (step === steps - 1 && settings.consent.enabled) {
      parts.push(`<div class="ovf-field ovf-consent" data-field="_consent"><label class="ovf-choice"><input type="checkbox" name="_consent" value="yes"${settings.consent.required ? ' required' : ''}> <span>${escapeHtml(settings.consent.text)}</span></label><p class="ovf-error" hidden></p></div>`);
    }
    if (steps === 1) sections.push(parts.join(''));
    else {
      const title = settings.steps?.[step]?.title?.trim();
      const nav = `<div class="ovf-nav">${step > 0 ? '<button type="button" class="ovf-back">Back</button>' : ''}${step < steps - 1 ? '<button type="button" class="ovf-next ovf-submit">Next</button>' : ''}</div>`;
      sections.push(`<fieldset class="ovf-step" data-step="${step}">${title ? `<legend class="ovf-step-title">${escapeHtml(title)}</legend>` : ''}${parts.join('')}${nav}</fieldset>`);
    }
  }
  const progress = steps > 1
    ? `<div class="ovf-progress" aria-hidden="true"><span class="ovf-progress-label">Step <span data-ovf-current>1</span> of ${steps}</span><span class="ovf-progress-bar"><span style="width:${Math.round(100 / steps)}%"></span></span></div>`
    : '';
  const hidden = (name: string, value: string | number | null | undefined) => `<input type="hidden" name="${name}" value="${escapeHtml(value == null ? '' : String(value))}">`;
  const tail = `<div class="ovf-hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="_website" tabindex="-1" autocomplete="off"></label></div>`
    + hidden('_page', context.pageId) + hidden('_variant', context.variant) + hidden('_funnel', context.funnelId) + hidden('_step', context.stepIndex)
    + hidden('_vid', '') + hidden('_url', '') + ['source', 'medium', 'campaign', 'term', 'content'].map(key => hidden('_utm_' + key, '')).join('')
    + `<button type="submit" class="ovf-submit ovf-final">${escapeHtml(settings.submitLabel || 'Submit')}</button><p class="ovf-status" role="status" aria-live="polite"></p>`;
  return `<form class="ovf${steps > 1 ? ' ovf-multi' : ''}" method="post" action="${escapeHtml(context.action)}" data-ovelio-form-id="${form.id}" data-steps="${steps}" novalidate aria-label="${escapeHtml(form.name)}">${progress}${sections.join('')}${tail}</form>`;
}

export { formCss };

/** Binds every OVELIO form under `root`: fills context fields and submits inline as JSON. Shared by pages and embeds. */
export const formBinderJs = `function ovelioBindForms(root,vid,utm,cross){var keys=['source','medium','campaign','term','content'];var truthy=['yes','on','true','1','checked'];
function match(rule,vals){var raw=vals[rule.field];var list=(Array.isArray(raw)?raw:raw==null?[]:[raw]).map(function(x){return String(x).trim()}).filter(Boolean);var t=(rule.value||'').trim().toLowerCase();
var eq=list.some(function(x){return x.toLowerCase()===t});var ck=rule.value?eq:list.some(function(x){return truthy.indexOf(x.toLowerCase())>=0||Array.isArray(raw)});
switch(rule.operator){case 'equals':return eq;case 'not_equals':return !eq;case 'contains':return !!t&&list.some(function(x){return x.toLowerCase().indexOf(t)>=0});case 'checked':return ck;case 'not_checked':return !ck;case 'not_empty':return list.length>0}return false}
root.querySelectorAll('form[data-ovelio-form-id]').forEach(function(form){if(form.__ov)return;form.__ov=1;form.classList.add('ovf-js');
var steps=Number(form.getAttribute('data-steps')||1);var current=0;var sections=form.querySelectorAll('.ovf-step');var btn=form.querySelector('.ovf-final');var status=form.querySelector('.ovf-status');
function set(n,v){var i=form.querySelector('input[name="'+n+'"]');if(i)i.value=v}
set('_vid',vid);set('_url',location.href.slice(0,500));keys.forEach(function(k){set('_utm_'+k,utm[k]||'')});
function refresh(){var vals={};form.querySelectorAll('.ovf-field[data-field]').forEach(function(f){var rules=f.getAttribute('data-show-if');var show=true;
if(rules){try{show=JSON.parse(rules).every(function(r){return match(r,vals)})}catch(e){}}f.hidden=!show;
f.querySelectorAll('input,select,textarea').forEach(function(el){el.disabled=!show});if(!show)return;var k=f.getAttribute('data-field');
f.querySelectorAll('input,select,textarea').forEach(function(el){if((el.type==='checkbox'||el.type==='radio')&&!el.checked)return;if(!el.value)return;vals[k]=vals[k]===undefined?el.value:[].concat(vals[k],el.value)})})}
function show(i){current=Math.max(0,Math.min(steps-1,i));sections.forEach(function(s,j){s.classList.toggle('is-current',j===current)});if(steps>1&&btn)btn.hidden=current<steps-1;
var c=form.querySelector('[data-ovf-current]');if(c)c.textContent=String(current+1);var bar=form.querySelector('.ovf-progress-bar span');if(bar)bar.style.width=Math.round((current+1)/steps*100)+'%'}
function clear(f){f.classList.remove('ovf-invalid');var e=f.querySelector('.ovf-error');if(e){e.textContent='';e.hidden=true}}
function checkStep(scope){var first=null;scope.querySelectorAll('.ovf-field').forEach(function(f){if(f.hidden)return;clear(f);var bad=null;
f.querySelectorAll('input,select,textarea').forEach(function(el){if(!bad&&!el.disabled&&el.type!=='hidden'&&!el.checkValidity())bad=el});
if(bad){f.classList.add('ovf-invalid');var e=f.querySelector('.ovf-error');if(e){e.textContent=bad.validity.valueMissing?'This field is required.':(bad.validationMessage||'Check this field.');e.hidden=false}if(!first)first=bad}});
if(first)first.focus();return !first}
form.addEventListener('input',refresh);form.addEventListener('change',refresh);refresh();if(steps>1)show(0);
form.querySelectorAll('.ovf-next').forEach(function(b){b.addEventListener('click',function(){if(checkStep(sections[current]))show(current+1)})});
form.querySelectorAll('.ovf-back').forEach(function(b){b.addEventListener('click',function(){show(current-1)})});
form.addEventListener('submit',function(ev){ev.preventDefault();if(steps>1&&current<steps-1){if(checkStep(sections[current]))show(current+1);return}
if(!checkStep(steps>1?sections[current]:form))return;
form.querySelectorAll('.ovf-field').forEach(clear);
var data={};new FormData(form).forEach(function(v,k){if(typeof v!=='string')return;if(data[k]!==undefined){data[k]=[].concat(data[k],v)}else{data[k]=v}});
form.querySelectorAll('[data-multi]').forEach(function(g){var k=g.getAttribute('data-multi');if(g.closest('.ovf-field').hidden)return;data[k]=data[k]===undefined?[]:[].concat(data[k])});
btn.disabled=true;status.textContent='Sending…';status.className='ovf-status';
fetch(form.action,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(data),credentials:cross?'omit':'same-origin'})
.then(function(r){return r.json().catch(function(){return {ok:false,error:'The form could not be sent. Try again in a moment.'}})})
.then(function(res){btn.disabled=false;
if(res.ok){if(res.redirect){location.href=res.redirect;return}var d=document.createElement('div');d.className='ovf-success';d.setAttribute('role','status');d.textContent=res.message;form.replaceWith(d);return}
status.textContent=res.error||'Check the highlighted fields.';status.className='ovf-status ovf-status--error';var target=null;
Object.keys(res.fieldErrors||{}).forEach(function(k){var f=form.querySelector('[data-field="'+k+'"]');if(!f)return;f.classList.add('ovf-invalid');var e=f.querySelector('.ovf-error');if(e){e.textContent=res.fieldErrors[k];e.hidden=false}
var s=f.closest('.ovf-step');var i=s?Number(s.getAttribute('data-step')):0;if(target===null||i<target)target=i});
if(steps>1&&target!==null)show(target);var first=form.querySelector('.ovf-invalid input,.ovf-invalid select,.ovf-invalid textarea');if(first)first.focus()})
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
export function hydratePage(html: string, forms: Map<string, FormRow>, context: Omit<FormContext, 'action'>, nextStepUrl: string | null, known: Map<string, Set<string>> = new Map()) {
  return html
    .replace(/<div([^>]*)data-ovelio-form="([0-9a-f-]{36})"([^>]*)>\s*<\/div>/g, (whole, before: string, formId: string, after: string) => {
      const form = forms.get(formId);
      if (!form || form.status !== 'published') return `<div${before}data-ovelio-form="${formId}"${after}></div>`;
      return `<div${before}data-ovelio-form="${formId}"${after}>${renderFormHtml(form, { ...context, known: known.get(formId), action: `/api/public/forms/${formId}/submit` })}</div>`;
    })
    .replace(/href="#ovelio-next-step"/g, `href="${escapeHtml(nextStepUrl ?? '#')}"`);
}
