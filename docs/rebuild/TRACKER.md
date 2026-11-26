# OVELIO 2.0 rebuild tracker

One page every lane works from. The lead owns this file; lanes report status in their final summary and the lead
updates it at merge. Older parity work (Mautic/Listmonk/Umami engine parity) stays in [../parity/](../parity/README.md).

## 1. Decisions

| ID | Decision | Why |
|---|---|---|
| D2 | **Preview runs real SQL.** Without `DATABASE_URL`, the developer preview and DB-backed unit tests run every migration on PGlite (in-process PostgreSQL, Apache-2.0) through the same `db` interface (`src/server/db.ts`). | One code path for preview and production; no second in-memory implementation per feature. Data resets on restart, and the banner says so. |
| D3 | **OVELIO owns sales and design records in PostgreSQL** (deals, tasks, activities, designs, pages, forms, campaigns, flows, events). Mautic stays the contact and company master, Listmonk the newsletter engine, Umami the website collector. | Hybrid D1 from the parity plan; the engines have no deals, designs or native funnels. |
| D4 | **OVELIO's own sends** (sales, sequences, automations, studio tests) go through `src/server/mailer.ts` → the SMTP policy gateway (third account `SMTP_OVELIO_*`), which re-checks consent. Without a gateway nothing is delivered and the message is stored `not_sent`. | Preserves the consent and suppression safeguards; never fakes a send. |
| D5 | **Email studio:** GrapesJS 0.23.9 + grapesjs-mjml 1.0.8 (BSD-3-Clause), compiled with mjml 5.4.1 (MIT). Pages: GrapesJS with OVELIO blocks. | Mature, commercially usable, already the basis of Mautic's builder (we reimplement, never copy). |
| D6 | **Native flows** on `@xyflow/react` 12.12.1 (MIT), executed by the OVELIO worker via platform jobs. The Mautic workflow canvas stays for engine journeys. | Mautic cannot trigger on deals, tasks or OVELIO forms. |
| D7 | **Analytics** reads the `events` table, OVELIO records and the existing Umami/Listmonk adapters. No new analytics engine. | Requirement §9. |
| D8 | Kanban drag and drop: `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 (MIT). | Accessible keyboard dragging. |
| D9 | **Payments through Stripe's REST API, no SDK**: hosted Checkout per invoice balance, refunds, and a webhook verified with the documented HMAC scheme (5-minute tolerance), processed once per event id in a transaction. OVELIO never handles card data. | Three endpoints do not justify a dependency; idempotency is ours to guarantee either way. |
| D10 | **Native simple e-signature** on proposals (typed name + consent + evidence record with a SHA-256 of the accepted content). Documenso (AGPL-3.0) evaluated and not incorporated; a qualified-signature provider can be added behind the same acceptance step. | Licence, and the evidence a simple signature needs is small. |
| D11 | **Experiments judge outcomes, never opens**: workflow A/B splits measure clicks (signed `/r/` redirects, scanners flagged), conversions, qualified leads or won revenue; two-proportion z-test or Welch, minimum 100 contacts and 5 outcomes per path, p < 0.05. | Apple Mail Privacy Protection and scanners make opens unreliable. |
| D12 | **Public revenue paths are `/proposal/` and `/pay/`**, never `/q/` or `/p/` (Caddy sends those to Umami tracked links). Public OVELIO paths are listed in Caddy's `@ovelioPublic` so they never receive the console session. | Found as a production routing defect during wave two. |

Licences checked 2026-11-25: all of the above are MIT, BSD-3-Clause or Apache-2.0. Twenty (AGPL-3.0), Mautic (GPL-3.0) and Listmonk (AGPL-3.0) are references only: read behaviour, never copy code.

## 2. Platform contracts (lead-owned, use them, do not fork them)

| Need | Use | File |
|---|---|---|
| Read, create or tag people and companies | `searchContacts`, `getContact(s)`, `findContactByEmail`, `upsertContact` (dedupes by email, adds tags, records consent only with evidence), `tagContact`, `adjustPoints`, `canEmail`, `searchCompanies`, `getCompanies`, `createCompany`, `linkContactToCompany` | `src/server/directory.ts` |
| Tell other modules something happened | `emitEvent({ type, contactId, dealId, campaignId, entityType, entityId, amount, utm, properties, idempotencyKey }, client?)`; `listEvents(filter)`; `audit(...)` | `src/server/events.ts`, types in `src/contracts/platform.ts` |
| React to events | your lane module's `onPlatformEvent(event)` (called once per event per lane, retried on failure, must be idempotent) | `src/server/<lane>/module.ts` |
| Background or delayed work | `schedulePlatformJob('<lane>.<name>', key, data, { runAt })`, handler in your module's `jobHandlers` | `src/server/platform/jobs.ts` |
| Deals, tasks, activities, campaign lookup | `createDeal`, `moveDeal`, `createTask`, `completeTask`, `logActivity`, `resolveCampaignId` | `src/server/records.ts` |
| Send an email | `sendEmail({ to, subject, html, category, source, contactId, campaignId, idempotencyKey })` or `sendDesign(designId, …)`. Returns `sent`, `blocked`, `failed` or `not_sent` with a reason; show that reason to the user | `src/server/mailer.ts` |
| Personalisation | `{{contact.first_name \| fallback}}` etc., list in `mergeTags`, render with `renderMergeTags` | `src/contracts/merge-tags.ts` |
| Global search | your module's `search(q, user)` → `SearchResult[]` (max 5) | lane module |
| Saved table views | `GET/POST/PATCH/DELETE /api/console/platform/views?object=<name>` | `src/server/routes/platform.ts` |
| Team for owner pickers | `GET /api/console/platform/users`, client helper `loadTeam()` | `src/components/shell.tsx` |
| Event timeline | `GET /api/console/platform/events?contactId=&dealId=&campaignId=&entityType=&entityId=&types=` | platform routes |
| Preview sample data | your module's `seedPreview(sql)`: plain SQL, idempotent, every record named so it reads as sample data where it could be mistaken for live data | lane module |
| Am I in the preview? | server: `isDevPreviewMode()`; client: `usePreview()` | `src/server/dev-preview.ts`, `src/components/shell.tsx` |

Console endpoints are `route(method, /^regex$/, handler, role)` entries (`src/server/routes/shared.ts`) in your module's `endpoints`. Roles: `analyst` reads, `marketer` creates and edits, `admin` changes settings, team and integrations. The gateway enforces origin checks and rate limits; in the preview it runs your endpoints on the embedded database and drains due jobs after each response.

**Shared schema (migrations 007, 008):** `identity_links`, `events`, `saved_views`, `audit_log`, `marketing_campaigns`, `campaign_assets`, `pipelines`, `pipeline_stages` (default "Sales pipeline" seeded), `deals`, `deal_contacts`, `deal_stage_history`, `tasks`, `activities`, `record_owners`, `designs`, `design_versions`, `messages`. Lanes add tables or columns only in their own migration range, additively.

## 3. Lanes

| Lane | Owns (files) | Console API prefix | Pages | Migrations | Test IDs |
|---|---|---|---|---|---|
| Lead | `src/server/{db,directory,events,records,mailer}.ts`, `src/server/platform/`, `src/server/preview/`, `src/server/routes/platform.ts`, `src/contracts/{platform,merge-tags}.ts`, `src/components/{shell,nav,section,lane-stub}.tsx`, the console gateway, `migrations/001-009`, compose, deploy, `scripts/` | `platform/` | route registry | 001-009 | PLT- |
| 1 CRM & Sales | `src/server/crm/`, `src/contracts/crm.ts`, `src/components/crm/`, `src/styles/crm.css`, `src/components/audience.tsx` | `crm/`, `sales/`, `mailboxes/` | `/crm/**`, `/sales/**`, `/settings/mailboxes` | 010-019 | CRM- |
| 2 Email Studio | `src/server/studio/`, `src/contracts/studio.ts`, `src/components/studio/`, `src/styles/studio.css`, `src/templates/email/`, `src/components/campaigns.tsx` | `studio/` | `/studio/email/[id]`, `/marketing/{emails,templates,brand,media,transactional}` | 020-029 | EML- |
| 3 Sites & Forms | `src/server/sites/`, `src/contracts/sites.ts`, `src/components/sites/`, `src/styles/sites.css`, `src/templates/pages/`, public routes `src/app/(public)/`, `src/app/api/public/` | `sites/` | `/studio/page/[id]`, `/sites/**` | 030-039 | SIT- |
| 4 Campaigns & Automations | `src/server/journeys/`, `src/contracts/journeys.ts`, `src/components/journeys/`, `src/styles/journeys.css`, `src/components/{automations,workflow-canvas,workflow-run-log}.tsx` | `journeys/` | `/marketing` (hub, `/marketing/campaigns/[id]`), `/automations/**` | 040-049 | JRN- |
| 5 Analytics | `src/server/insights/`, `src/contracts/insights.ts`, `src/components/insights/`, `src/styles/insights.css`, `src/components/{analytics,overview}.tsx` | `insights/` | `/overview`, `/analytics/**` | 050-059 | BI- |
| 6 Design & QA | `src/components/{ui,login,providers,settings}.tsx`, `src/app/globals.css`, `test/e2e/` | none | `/settings/**` except mailboxes, `/login` | none | UX- |

Rules: stay in your files. A change you need in a lead-owned file goes in its own commit titled `[shared] …`, kept minimal, and is named in your final report. Lane CSS lives in `src/styles/<lane>.css`, imported from your components, with classes prefixed `ov-<lane>-`. Put `className="ov-wide"` on a page's root element to use the full width (boards, tables, canvases).

### Cross-lane API contracts (build these first so other lanes can integrate)

| Endpoint | Returns | Owner |
|---|---|---|
| `GET /api/console/sales/pipelines` | `{ items: { id, name, currency, isDefault, stages: { id, name, position, probability, outcome }[] }[] }` | 1 |
| `GET /api/console/studio/designs?kind=email` | `{ items: { id, name, subject, kind, status, updatedAt }[] }` | 2 |
| `GET /api/console/sites/pages` | `{ items: { id, name, slug, status, url }[] }` | 3 |
| `GET /api/console/sites/forms` | `{ items: { id, name, status }[] }` | 3 |
| `GET /api/console/sites/funnels` | `{ items: { id, name, status }[] }` | 3 |
| `GET /api/console/journeys/campaigns` | `{ items: { id, name, status, utmCampaign }[] }` | 4 |
| `GET /api/console/journeys/flows` | `{ items: { id, name, status }[] }` | 4 |

### Cross-lane event contracts

| Event | Emitted by | Required fields |
|---|---|---|
| `form.submitted` | 3 | `contactId`, `entityType: 'form'`, `entityId: formId`, `campaignId` (via `resolveCampaignId`), `utm`, `visitorId`, `properties: { formName, pageId?, funnelId?, fields }` |
| `page.viewed`, `page.converted`, `funnel.step_viewed`, `funnel.completed` | 3 | `entityType: 'page' \| 'funnel'`, `entityId`, `visitorId`, `campaignId`, `utm`, `properties: { variant?, stepIndex? }` |
| `deal.*`, `task.*`, `activity.logged` | `records.ts` (all lanes) | as emitted there |
| `email.sent` | `mailer.ts` | `entityType: 'message'` |
| `email.replied` | 1 (mailbox sync) | `contactId`, `properties: { threadId, messageId }` |
| `sequence.*` | 1 | `contactId`, `entityId: sequenceId` |
| `campaign.launched` | 4 | `campaignId` |
| `flow.enrolled`, `flow.completed`, `flow.failed` | 4 | `contactId`, `entityId: flowId` |

## 4. Quality bar (every lane)

- Purpose-built screens on Astryx and the kit in `src/components/ui.tsx`. No HTML-first creation dialogs, no placeholder buttons, no disconnected forms.
- Loading, empty, error and success states on every screen. Errors say what to do next.
- Never present sample data as live: preview records are seeded and labelled; estimates (forecast, weighted pipeline) are labelled as estimates.
- Never report success that did not happen: show the mailer's `not_sent` / `blocked` reasons and engine errors as they are.
- Responsive to 390 px wide; keyboard reachable; labelled controls.
- Unit tests named with your ID prefix, e.g. `test('CRM-03 dragging a deal to Won closes it', …)`. DB-backed tests set `process.env.OVELIO_DEV_PREVIEW = 'true'` before importing server modules (see `test/unit/plt-records-mailer.test.ts`).
- Verify: `npm run lint && npm run typecheck && npm test && npm run build`. Check your screens in a browser: `OVELIO_DEV_PREVIEW=true npx next start -p <port>` after a build, sign in with `POST /api/auth/dev-login` (Origin header = the server origin), and capture Playwright screenshots at 1440×900 and 390×844.

## 5. Acceptance journeys

| # | Journey | Owner | Status |
|---|---|---|---|
| 1 | Import contacts, create companies, manage associated records | 1 | done (CRM-01..12, browser) |
| 2 | Create a deal, drag between stages, reload, persisted | 1 | done (UX-10) |
| 3 | Assign a task, record a follow-up, forecast updates | 1 | done (CRM tests, browser) |
| 4 | Pick a template, edit visually, save, reopen | 2 | done (UX-11) |
| 5 | Send a test email, verify rendered content | 2 | done (EML-06; preview stores `not_sent`, live delivery via gateway) |
| 6 | Design and publish a responsive landing page without code | 3 | done (UX-12) |
| 7 | Submit a published form, verify the CRM record | 3 | done (UX-12) |
| 8 | Multi-step funnel with tracked conversion | 3 | done (SIT tests, browser) |
| 9 | Campaign containing emails, forms, pages and automations | 4 | done (JRN-07, browser) |
| 10 | Workflow triggered by a real form submission or CRM event | 4 | done (UX-13, JRN-02) |
| 11 | Consent, suppression and unsubscribe enforced | lead, 2, 4 | done (UX-14, PLT-35) |
| 12 | Leads and revenue attributed to a campaign | 5 | done (UX-16, BI-04) |
| 13 | Authentication, permissions, persistence, secure publishing | lead, 6 | done (role-gated routes, signed unsubscribe, sanitised publishing; live Auth0 not exercised) |
| 14 | Desktop and mobile layouts with real browser interaction | 6 | done (UX-01 sweep, 1440 and 390) |
| 15 | No regression in existing functionality | lead | done (CI integration on live engines; unit 322/322) |

## 6. Known blockers

- Live Gmail/Outlook sync needs OAuth client credentials (`GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`) registered with each provider.
- The Vercel deployment can only run the developer preview: Vercel functions cannot host the worker, the SMTP gateway or the three engines. Production is the Docker Compose stack.

## 7. Growth OS programme (waves)

Brief of 2026-11-26: four waves in dependency order, at most three specialists at once, specialists reused across waves.
Specialists: **PE** Product Engineering (shell, navigation, dashboards, kit), **CR** CRM & Revenue, **MC** Marketing & Content
(email studio, sites, templates), **PL** Platform Engineering (communications, automation, integrations, infrastructure,
security), **IQ** Intelligence & Quality (analytics, AI, benchmarks, independent acceptance). Migration ranges for new
work: PE 060-069, CR 011-019, MC 021-029 / 032-039, PL 042-049 / 070-079, IQ 051-059.

### Wave one: perfect the core (status: done, gate passed 2026-11-26)

| Capability | Exists | Gap | P | Owner | Acceptance |
|---|---|---|---|---|---|
| Environment indicator | Large preview banner | Compact, persistent, truthful badge | P0 | PE | Badge in top bar on every page; banner gone |
| Demo-data hygiene | Seeds + QA records in screenshots | Evidence sweep runs on clean data | P0 | PE | Sweep screenshots contain no test-created records |
| Notifications, recents, favourites | None | Bell with unread count; recent and starred records in search | P0 | PE | Task reminder, flow failure and form lead create notifications; star a deal and find it in search |
| Configurable dashboards | Overview + 6 analytics pages | Executive, Sales and Marketing dashboards with widget choice and date comparison | P1 | PE | Hide a widget, reload, still hidden |
| Table density and kit | DataTable added | Density toggle, inline edit, used by CRM lists | P1 | PE, CR | Compact and comfortable both readable at 390 px |
| CRM lists | Legacy contacts/companies tables | Owner, stage, last activity, open deals, inline edit, advanced filters, saved views | P0 | CR | Filter by owner and stage, save view, bulk reassign |
| Duplicates and merge | None | Detect and merge contacts with all OVELIO associations moved | P0 | CR | Merge two contacts; deals, tasks and activities follow the survivor |
| Lead routing | None | Round-robin and rule-based assignment on new leads | P0 | CR | Form lead is assigned to the next rep in rotation |
| Deal cards and stage rules | Value, owner, close date | Last interaction, next action, health, stage requirements | P1 | CR | Move into a stage with a missing required field is refused with the reason |
| Sequence safety | Delays, stop on reply | Recipient time zone send windows, daily limits | P1 | CR | Steps outside the window wait for the next window |
| Email studio depth | GrapesJS/MJML studio, one brand kit | Multiple brand kits, global styles, conditional content, contact preview | P0 | MC | Conditional block renders per contact in preview and native send |
| Deliverability | DNS check in Settings | SPF, DKIM, DMARC, bounce and complaint rates, broken links, list hygiene in one view | P1 | MC | Report lists each check with measured values or "unavailable" |
| Email experiments | None | Subject A/B with deterministic allocation, minimum sample and significance | P1 | MC | Winner is declared only when the test is significant |
| Template factory | 24 email + 16 page templates written by hand | Layouts x brand tokens x content schemas, industry kits, auto thumbnails, validation | P0 | MC | Factory output compiles with zero MJML errors and renders thumbnails |
| Forms and funnels | Single-step forms, linear funnels | Multi-step forms, conditional fields, secure uploads, page rollback | P1 | MC | Conditional field shows only when its rule matches; rollback restores a page |
| Persistent media | Engine media + preview data URLs | OVELIO media store with type sniffing, size limits, SVG sanitising | P1 | PL | Upload survives restart; a script in an SVG is removed |
| Independent acceptance | Preview suite + CI on engines | Preview suite in CI; QA verification of specialists' claims | P0 | IQ | CI runs both suites green |

Wave one gate: CI run 38 green on 2392ff6 (engines, preview suite, 2.0 records survive restart and restore);
independent acceptance IQ-01..IQ-19 all pass (test/e2e/preview/wave1.spec.ts), with three defects found and fixed (CRM
density, studio first-edit save, SVG sandbox CSP). Declined with reason: newsletter subject A/B (Listmonk reports opens
per campaign and Apple Mail prefetch inflates them, so a significance test would crown unreliable winners).

Rollback points: `fccb9d0` main before 2.0; `a29fb83` first CI-verified 2.0 build; `2392ff6` wave one complete.

### Wave two: complete the customer lifecycle (status: in progress)

Branch `claude/serene-brahmagupta-ekl58t` (from main e56d866). Migration ranges in use: 014 revenue, 015 inbox, 071 calendar.

| Slice | Status | Evidence |
|---|---|---|
| Wave-one carry-over: outcome-based experiments | done | JRN-09, JRN-10, IQ-22; signed click tracking PLT-37 |
| Revenue: catalogue, price lists, tax, deal line items, proposals, e-signature, deposits, invoices, Stripe Checkout + webhook, refunds, subscriptions and renewals, onboarding tasks, revenue states, accounting CSV | done | REV-01..REV-09 unit; IQ-20, IQ-21 browser (signing on a 390 px phone) |
| Workflow triggers: proposal viewed/accepted/declined, payment received/failed, subscription cancelled, meetings | done | REV-09 (accepted proposal enrols the signer) |
| Calendar: booking types, availability, round-robin, public booking, reminders, ICS feed | in progress (Calendar specialist worktree) | CAL- tests |
| Inbox: threads, mailbox privacy, shared inboxes, notes, saved replies, assignment, response times, provider sync | in progress (Communications specialist worktree) | INB- tests |
| Connector infrastructure, advanced automation (webhooks in, sub-workflows, replay) | not started | |

Defects found and fixed in wave two: deal line editor overflowing its column (browser), Save draft disabled after typing a
number (IQ-20), proposal links colliding with Umami's `/q/` route in production (Caddy review), CR-03 relying on a fixed
job budget.

Pending external verification: Stripe test keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), Google/Microsoft OAuth
clients. The Vercel deployment was not reachable from the build container, so its commit could not be confirmed;
`/api/health` now reports `commit` for every later deployment.

**Continuation point:** merge the calendar and inbox worktrees into the wave two branch, run the full gate (unit, preview
browser suite, CI engines), then connector infrastructure and advanced automation, then the end-to-end lifecycle check
(lead → CRM → appointment → proposal → contract → payment → onboarding → renewal) and the wave two checkpoint.
