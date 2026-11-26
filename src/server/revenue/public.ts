// Public proposal (/q/<token>) and invoice (/i/<token>) pages. Server-rendered, no script, branded with the
// workspace name and accent. Every value is escaped; the token in the address is the only credential.
import type { CompanySettings } from '@/contracts';
import type { Line } from '@/contracts/revenue';
import { billingLabels, totals } from '@/contracts/revenue';
import { AppError } from '../config';
import { db } from '../db';
import { clientIp, hashIp, htmlResponse, notFoundPage } from '../sites/public';
import { createCheckout } from './stripe';
import { acceptInput, acceptQuote, declineInput, declineQuote, quoteByToken, recordQuoteView } from './quotes';
import { formatMoney, invoiceSelect, readLines, revenueSettings, stripeConfig, toInvoiceSummary, tokenPattern, workspace } from './shared';
import type { InvoiceRow, QuoteRow } from './shared';

const e = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paragraphs = (text: string) => text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean).map(part => `<p>${e(part).replace(/\n/g, '<br>')}</p>`).join('');
const day = (value: Date | string | null) => value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null;
const longDate = (value: string | null) => value ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

function shell(company: CompanySettings, title: string, body: string, status = 200) {
  const accent = /^#[0-9a-f]{6}$/i.test(company.accent ?? '') ? company.accent : '#2457d6';
  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${e(title)}</title><style>
:root{--accent:${accent};--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
header{background:#fff;border-bottom:1px solid var(--line)}header div{max-width:880px;margin:0 auto;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}
header strong{font-size:18px}header span{color:var(--muted);font-size:14px}
main{max-width:880px;margin:24px auto;padding:0 16px 48px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:28px;margin-bottom:20px}
h1{font-size:28px;line-height:1.25;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px}
.meta{display:flex;flex-wrap:wrap;gap:8px 24px;color:var(--muted);font-size:14px;margin-bottom:8px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;background:#eef2ff;color:#3730a3}
.badge.ok{background:#dcfce7;color:#166534}.badge.warn{background:#fef3c7;color:#92400e}.badge.bad{background:#fee2e2;color:#991b1b}
.table{width:100%;border-collapse:collapse;font-size:15px}.table th{text-align:left;color:var(--muted);font-weight:600;font-size:13px;border-bottom:1px solid var(--line);padding:8px 6px}
.table td{border-bottom:1px solid var(--line);padding:12px 6px;vertical-align:top}.table td.n,.table th.n{text-align:right;white-space:nowrap}
.table small{display:block;color:var(--muted)}
.totals{margin-left:auto;max-width:340px;margin-top:16px}.totals div{display:flex;justify-content:space-between;padding:4px 0}.totals .grand{font-weight:700;font-size:20px;border-top:2px solid var(--ink);margin-top:6px;padding-top:10px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input[type=text],input[type=email],textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin-top:16px}.check input{margin-top:5px;width:18px;height:18px}
button,.button{display:inline-block;font:inherit;font-weight:600;padding:12px 22px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;margin-top:16px}
button.secondary{background:#fff;color:var(--ink);border:1px solid #cbd5e1}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.notice{padding:14px 16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;margin-bottom:20px}.notice.err{background:#fef2f2;border-color:#fecaca}
details{margin-top:12px}summary{cursor:pointer;color:var(--muted)}
.fine{color:var(--muted);font-size:13px}code{font-size:12px;word-break:break-all}
@media (max-width:600px){.card{padding:20px}h1{font-size:23px}.table .hide{display:none}}
@media print{header,form,.noprint{display:none}body{background:#fff}.card{border:0;padding:0}}
</style></head><body><header><div><strong>${e(company.name || 'OVELIO')}</strong><span>${e(company.website || '')}</span></div></header><main>${body}</main></body></html>`, status);
}

function linesTable(lines: Line[], currency: string) {
  const sum = totals(lines);
  const rows = lines.map(line => `<tr><td>${e(line.name)}${line.description ? `<small>${e(line.description)}</small>` : ''}${line.billing !== 'one_time' ? `<small>${e(billingLabels[line.billing])}</small>` : ''}</td>
<td class="n hide">${line.quantity}</td><td class="n hide">${formatMoney(line.unitPrice, currency)}${line.discountPercent ? `<small>−${line.discountPercent}%</small>` : ''}</td>
<td class="n hide">${line.taxRate ? `${line.taxRate}%` : '—'}</td><td class="n">${formatMoney(line.net, currency)}</td></tr>`).join('');
  return `<table class="table"><thead><tr><th>Item</th><th class="n hide">Qty</th><th class="n hide">Price</th><th class="n hide">Tax</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals"><div><span>Subtotal</span><span>${formatMoney(sum.subtotal, currency)}</span></div>
${sum.discountTotal ? `<div><span>Discounts</span><span>−${formatMoney(sum.discountTotal, currency)}</span></div>` : ''}
<div><span>Tax</span><span>${formatMoney(sum.taxTotal, currency)}</span></div><div class="grand"><span>Total</span><span>${formatMoney(sum.total, currency)}</span></div>
${sum.monthlyRecurring ? `<div class="fine"><span>Includes recurring services worth</span><span>${formatMoney(sum.monthlyRecurring, currency)}/month (net)</span></div>` : ''}</div>`;
}

/* ── Proposal ─────────────────────────────────────────────────────────── */

async function quotePage(row: QuoteRow, notice?: { text: string; error?: boolean }) {
  const company = await workspace();
  const lines = readLines(row.lines);
  const validUntil = day(row.valid_until);
  const expired = row.status === 'sent' && Boolean(validUntil && validUntil < new Date().toISOString().slice(0, 10));
  const badge = row.status === 'accepted' ? '<span class="badge ok">Accepted</span>' : row.status === 'declined' ? '<span class="badge bad">Declined</span>'
    : row.status === 'void' ? '<span class="badge warn">Withdrawn</span>' : expired ? '<span class="badge warn">Expired</span>' : '<span class="badge">Awaiting your decision</span>';
  let action = '';
  if (row.status === 'sent' && !expired) {
    action = `<section class="card" aria-labelledby="accept"><h2 id="accept">Accept and sign</h2>
<form method="post"><input type="hidden" name="action" value="accept">
<label for="signerName">Full name</label><input id="signerName" name="signerName" type="text" autocomplete="name" required minlength="2" maxlength="120" value="${e(row.contact_name)}">
<label for="signerEmail">Email</label><input id="signerEmail" name="signerEmail" type="email" autocomplete="email" required value="${e(row.contact_email)}">
<label class="check"><input type="checkbox" name="agree" value="true" required><span>I have read this proposal, I accept it on behalf of ${e(row.company_name || 'myself')}, and I agree that typing my name is my electronic signature.</span></label>
<button type="submit">Accept proposal · ${formatMoney(Number(row.total), row.currency)}</button></form>
<details><summary>Decline instead</summary><form method="post"><input type="hidden" name="action" value="decline">
<label for="reason">Anything we should know? (optional)</label><textarea id="reason" name="reason" rows="3" maxlength="1000"></textarea>
<button type="submit" class="secondary">Decline proposal</button></form></details></section>`;
  } else if (row.status === 'accepted') {
    const invoice = (await db.query<{ token: string; number: string; status: string }>(`SELECT token, number, status FROM rev_invoices WHERE quote_id = $1 AND status <> 'void' ORDER BY issued_at LIMIT 1`, [row.id])).rows[0];
    action = `<section class="card"><h2>Signed</h2><p>Accepted by <strong>${e(row.signer_name)}</strong> (${e(row.signer_email)}) on ${e(new Date(row.accepted_at!).toUTCString())}.</p>
${invoice ? `<p><a class="button" href="/i/${e(invoice.token)}">${invoice.status === 'paid' ? 'View receipt' : 'View and pay invoice'} ${e(invoice.number)}</a></p>` : ''}
<p class="fine">Signature record: SHA-256 of the accepted content <code>${e(row.document_hash)}</code>. Print or save this page for your records.</p></section>`;
  } else if (expired) {
    action = `<section class="card"><p>This proposal expired on ${e(longDate(validUntil))}. Reply to the email you received to ask for an updated one.</p></section>`;
  }
  return shell(company, `${row.title} · ${row.number}`, `${notice ? `<div class="notice${notice.error ? ' err' : ''}" role="${notice.error ? 'alert' : 'status'}">${e(notice.text)}</div>` : ''}
<article class="card"><div class="meta"><span>${e(row.number)}</span>${validUntil ? `<span>Valid until ${e(longDate(validUntil))}</span>` : ''}<span>${badge}</span></div>
<h1>${e(row.title)}</h1><div class="meta"><span>Prepared for ${e([row.contact_name, row.company_name].filter(Boolean).join(', ') || 'you')}</span><span>by ${e(company.name)}</span></div>
${paragraphs(row.intro)}</article>
<section class="card" aria-labelledby="pricing"><h2 id="pricing">Pricing</h2>${linesTable(lines, row.currency)}
${Number(row.deposit_percent) > 0 ? `<p class="fine">${Number(row.deposit_percent) >= 100 ? 'Payment in full is due on acceptance.' : `A ${Number(row.deposit_percent)}% deposit is due on acceptance.`}</p>` : ''}</section>
${row.terms ? `<section class="card" aria-labelledby="terms"><h2 id="terms">Terms</h2>${paragraphs(row.terms)}</section>` : ''}${action}`);
}

export async function serveQuote(token: string, request: Request) {
  if (!tokenPattern.test(token)) return notFoundPage('This proposal link is not valid.');
  const row = await quoteByToken(token);
  if (!row) return notFoundPage('This proposal is not available.');
  if (new URL(request.url).searchParams.get('preview') !== '1' && row.status === 'sent') await recordQuoteView(row);
  return quotePage(row);
}

export async function postQuote(token: string, request: Request) {
  if (!tokenPattern.test(token)) return notFoundPage('This proposal link is not valid.');
  const { rateLimit } = await import('../auth');
  await rateLimit('public:quote:' + hashIp(clientIp(request)), 20, 60);
  const form = Object.fromEntries((await request.formData()).entries());
  try {
    if (form.action === 'decline') {
      await declineQuote(token, declineInput.parse({ reason: String(form.reason ?? '') }).reason);
      return quotePage((await quoteByToken(token))!, { text: 'Thank you for letting us know. The proposal is marked as declined.' });
    }
    const input = acceptInput.safeParse({ signerName: form.signerName, signerEmail: form.signerEmail, agree: form.agree === 'true' });
    if (!input.success) return quotePage((await quoteByToken(token))!, { text: input.error.issues[0]?.message ?? 'Check the form and try again.', error: true });
    const { already } = await acceptQuote(token, input.data, { ipHash: hashIp(clientIp(request)), agent: request.headers.get('user-agent') ?? '' });
    return quotePage((await quoteByToken(token))!, { text: already ? 'This proposal was already accepted.' : 'Accepted. Thank you! A copy of the signature record is below.' });
  } catch (error) {
    const row = await quoteByToken(token);
    if (!row) return notFoundPage('This proposal is not available.');
    return quotePage(row, { text: error instanceof AppError ? error.message : 'Something went wrong. Please try again in a minute.', error: true });
  }
}

/* ── Invoice ──────────────────────────────────────────────────────────── */

async function invoiceByToken(token: string) {
  return (await db.query<InvoiceRow>(`${invoiceSelect} WHERE i.token = $1`, [token])).rows[0] ?? null;
}

async function invoicePage(row: InvoiceRow, notice?: { text: string; error?: boolean }) {
  const [company, settings] = await Promise.all([workspace(), revenueSettings()]);
  const invoice = toInvoiceSummary(row);
  const stripe = stripeConfig();
  const badge = invoice.status === 'paid' ? '<span class="badge ok">Paid</span>' : invoice.status === 'void' ? '<span class="badge warn">Void</span>'
    : invoice.overdue ? '<span class="badge bad">Overdue</span>' : '<span class="badge">Due</span>';
  const pay = invoice.status !== 'open' || invoice.balance <= 0 ? ''
    : `<section class="card noprint"><h2>Pay ${formatMoney(invoice.balance, invoice.currency)}</h2>
${stripe.configured ? `<form method="post"><input type="hidden" name="action" value="pay"><button type="submit">Pay securely by card</button></form><p class="fine">You will be taken to Stripe's secure payment page. ${e(company.name)} never sees your card details.</p>` : ''}
${settings.paymentInstructions ? `<h2 style="margin-top:20px">${stripe.configured ? 'Or pay by bank transfer' : 'How to pay'}</h2>${paragraphs(settings.paymentInstructions)}<p class="fine">Use ${e(invoice.number)} as the payment reference.</p>` : ''}
${!stripe.configured && !settings.paymentInstructions ? `<p>Contact ${e(company.name)} to arrange payment, quoting ${e(invoice.number)}.</p>` : ''}</section>`;
  return shell(company, `Invoice ${invoice.number}`, `${notice ? `<div class="notice${notice.error ? ' err' : ''}" role="${notice.error ? 'alert' : 'status'}">${e(notice.text)}</div>` : ''}
<article class="card"><div class="meta"><span>Invoice ${e(invoice.number)}</span><span>Issued ${e(longDate(invoice.issuedAt.slice(0, 10)))}</span>${invoice.dueDate ? `<span>Due ${e(longDate(invoice.dueDate))}</span>` : ''}<span>${badge}</span></div>
<h1>${e(invoice.description || `Invoice ${invoice.number}`)}</h1><div class="meta"><span>Billed to ${e([invoice.contactName, invoice.companyName].filter(Boolean).join(', ') || invoice.contactEmail)}</span>${company.postalAddress ? `<span>${e(company.name)}, ${e(company.postalAddress)}</span>` : ''}</div>
${linesTable(readLines(row.lines), invoice.currency)}
<div class="totals">${invoice.amountPaid ? `<div><span>Paid</span><span>−${formatMoney(invoice.amountPaid, invoice.currency)}</span></div>` : ''}
${invoice.amountRefunded ? `<div><span>Refunded</span><span>${formatMoney(invoice.amountRefunded, invoice.currency)}</span></div>` : ''}
<div class="grand"><span>Balance due</span><span>${formatMoney(invoice.balance, invoice.currency)}</span></div></div></article>${pay}`);
}

export async function serveInvoice(token: string, request: Request) {
  if (!tokenPattern.test(token)) return notFoundPage('This invoice link is not valid.');
  const row = await invoiceByToken(token);
  if (!row) return notFoundPage('This invoice is not available.');
  const returned = new URL(request.url).searchParams.get('paid') === '1' && row.status === 'open';
  // Stripe confirms the payment by webhook; until then the page says so rather than claiming it is paid.
  return invoicePage(row, returned ? { text: 'Thank you. Stripe is confirming your payment; this invoice shows as paid once the confirmation arrives (usually within a minute).' } : undefined);
}

export async function postInvoice(token: string, request: Request) {
  if (!tokenPattern.test(token)) return notFoundPage('This invoice link is not valid.');
  const { rateLimit } = await import('../auth');
  await rateLimit('public:invoice:' + hashIp(clientIp(request)), 10, 60);
  const row = await invoiceByToken(token);
  if (!row) return notFoundPage('This invoice is not available.');
  try {
    const url = await createCheckout(row);
    return new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } });
  } catch (error) {
    return invoicePage(row, { text: error instanceof AppError ? error.message : 'The payment page could not be opened. Please try again.', error: true });
  }
}
