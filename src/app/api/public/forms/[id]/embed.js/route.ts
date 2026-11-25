// Embed script: <div data-ovelio-form="<id>"></div><script src=".../api/public/forms/<id>/embed.js" async></script>
// Renders the form into the host page (no iframe) and submits it to OVELIO with CORS.
import { formBinderJs, formCss, visitorJs } from '@/server/sites/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('/* Unknown form */', { status: 404, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
  const script = `(function(){var id=${JSON.stringify(id)};var s=document.currentScript;var origin=s?new URL(s.src).origin:'';
${visitorJs}
${formBinderJs}
var host=document.querySelector('[data-ovelio-form="'+id+'"]');if(!host){host=document.createElement('div');if(s&&s.parentNode){s.parentNode.insertBefore(host,s)}else{document.body.appendChild(host)}}
if(!document.getElementById('ovelio-form-css')){var st=document.createElement('style');st.id='ovelio-form-css';st.textContent=${JSON.stringify(formCss)};document.head.appendChild(st)}
fetch(origin+'/api/public/forms/'+id,{credentials:'omit'}).then(function(r){return r.json()}).then(function(d){if(!d.html){host.textContent=d.error||'This form is not available.';return}
host.innerHTML=d.html;var v=ovelioVisitor({});ovelioBindForms(host,v.vid,v.utm,true)}).catch(function(){host.textContent='The form could not be loaded.'})})();`;
  return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
}
