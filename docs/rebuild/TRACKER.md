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
