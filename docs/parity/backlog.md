# OVELIO parity backlog

The single scoreboard for reaching, then beating, Mautic 7.2.2, Listmonk 6.2.0 and Umami 3.5.0. Every row has an ID. Build agents work by ID, name their tests with it, and the lead session updates **Status**.

- **Pri**: P0 = core parity, P1 = what power users expect, P2 = nice to have. **Eff**: S < 1 day, M = 1-3 days, L = more than 3 days.
- **Status**: `todo`, `wip`, `review` (implemented and unit-tested, waiting for the CI integration and e2e run), `done`. **BUG** = a confirmed defect in OVELIO today. The lead session re-checked each one against the code.
- **Ref** points to the research report and gap-table row with the engine mechanism and file:line evidence (`R1#4` = [research/01](research/01-mautic-contacts-segments-scoring.md) row 4; R2 = [forms/automation](research/02-mautic-forms-automation.md), R3 = [delivery](research/03-listmonk-campaigns-delivery.md), R4 = [analytics](research/04-umami-tracking-analytics.md)).
- ★ = goes beyond the engine (a differentiator).

## PLT: platform (lead lane, runs first)

| ID | Item | Pri | Eff | Status | Done when | Ref |
|---|---|---|---|---|---|---|
| PLT-01 | Split the hot shared files so lanes can work in parallel: `src/app/api/console/[...path]/route.ts` (1,009 lines, every feature routes through it) into per-domain modules under `src/server/routes/`; `src/contracts/index.ts` into per-domain files re-exported by `index.ts`; `src/server/mautic/index.ts` into contacts, segments, points, forms, campaigns and content modules | P0 | M | done | No behaviour change. Lint, typecheck, unit tests and build pass unchanged. Each lane owns its own files (see README) | — |
| PLT-02 | `scripts/fetch-refs.sh` clones the pinned engine sources into `.refs/` for reading | P0 | S | done | Present in this change | — |
| PLT-03 | Parity test convention: every backlog item has at least one unit test whose name starts with its ID, e.g. `test('AUD-02 custom field values round-trip', …)` | P1 | S | todo | `grep -rhoE "'(AUD|AUT|DEL|ANA|X)-[0-9]+" test/` lists the covered IDs | — |

## AUD: master contact database, segmentation, lead scoring (lane A)

| ID | Item | Pri | Eff | Status | Done when | Ref |
|---|---|---|---|---|---|---|
| AUD-01 | **BUG** Point triggers are created and updated with no `events`, so they never fire (`src/server/mautic/index.ts:672-695`) | P0 | M | done | Create/edit send `events` (type and properties). The UI offers all 7 trigger event types. Unit test asserts the payload | R1#20-21 |
| AUD-02 | **BUG** Custom field values are dropped: `contactPayload` and `toContact` handle only 9 core fields (`index.ts:93-111`, `normalize.ts:74-103`, `audience.ts:494`) | P0 | M | done | Custom field values are read, written, imported, exported and shown on the contact. Type-validated against the field definition | R1#2 |
| AUD-03 | Contact list: full search grammar (Mautic has 27 search commands), sort by any listable field, page size over 100, saved views | P0 | M | review | Parity with Mautic's `GET /contacts` search, orderBy and limit | R1#4 |
| AUD-04 | Segment filter fields: from 6 to about 55 (custom contact and company fields, stage, segment membership, 6 DNC keys, devices, UTM, email, page and asset behaviours, point groups) | P0 | L | review | Every Mautic filter family is selectable, with a type-aware value input | R1#6 |
| AUD-05 | Segment operators per field type: from 6 to 24, including regexp, between, empty and not empty, `in_all`, and relative dates (`inLast`/`inNext`). The UI shows only operators that are valid for the field type (`audience.tsx:96-112` shows all of them for every field) | P0 | M | review | Operator matrix matches Mautic's per-type table. Relative-date filters work | R1#7-8 |
| AUD-06 | Segment rebuild and status: trigger a rebuild, show the last-built time, member count and a member preview. Mautic only materialises membership on its cron (batch 300, 1 s sleep per batch), and nothing recomputes on contact change | P0 | M | review | The segment page shows count, last built and the first 50 members. Rebuild-now works | R1#9-10 |
| AUD-07 | Point actions: set `properties` (which email, page, form or URL), `repeatable` and `group`. Add `email.send` to the type list | P0 | M | review | All 6 action types are configurable end to end | R1#18-19 |
| AUD-08 | Do-not-contact: add and remove per channel and reason (1 unsubscribed, 2 bounced, 3 manual). DNC as a segment filter. One source of truth with OVELIO `suppressions` (see X-06) | P0 | M | review | DNC can be removed. The segment filter works. No disagreement between DNC and suppressions | R1#25-26 |
| AUD-09 | Contact timeline: complete, filterable by event type, paginated (today it is the last 25 events, unfiltered) | P0 | M | review | All Mautic timeline event types, with paging. Feeds X-02 | R1#27 |
| AUD-10 | Import: async job with progress, column mapping including custom fields, dry run, no 500-row cap, no global serial lock | P0 | M | review | Imports 100k rows through the job queue with mapping and a dry-run report | R1#30 |
| AUD-11 | Merge and dedupe. Mautic has no REST merge, so OVELIO must own it: a duplicates queue, merge preview, Mautic's rules (sum points, union tags and companies, newest value wins per field) | P0 | L | todo | Duplicates are listed. A merge preview shows the result. The merge is executed and audited | R1#32 |
| AUD-12 | Custom field definitions: all 18 types and the missing flags (unique identifier, listable, index, character limit, order) | P1 | S | todo | Parity with `lead_fields` | R1#3 |
| AUD-13 | Segment-in-segment filters, and preference-centre and global segment flags | P1 | M | todo | — | R1#12 |
| AUD-14 | Bulk actions through batch endpoints (today they make one call per contact) and a wider action set | P1 | M | todo | Bulk tag, segment, stage, points, DNC and delete on 10k contacts | R1#14 |
| AUD-15 | Companies: custom fields, merge, company score, company filters in segments | P1 | M | todo | — | R1#16 |
| AUD-16 | Point groups (several scores per contact) | P1 | M | todo | — | R1#22 |
| AUD-17 | ★ Score decay, caps and a visible score ledger (Mautic core has no decay) | P1 | M | todo | A scheduled OVELIO job applies configurable decay. The ledger shows every change with its reason | R1#24 |
| AUD-18 | Export: async, filtered by segment, chosen columns, no 10,000 cap | P1 | M | todo | — | R1#31 |
| AUD-19 | ★ Nested AND/OR/NOT filter groups (Mautic compiles to flat AND-groups joined by OR, with no nesting) | P2 | L | todo | Needs a native segment engine (see README, decision D1) | R1#5 |
| AUD-20 | Point insights; devices, IPs and UTM on the contact; owner, frequency rules, channel preferences, locale | P2 | M | todo | — | R1#23,29,34 |

## AUT: forms and marketing automation (lane B)

| ID | Item | Pri | Eff | Status | Done when | Ref |
|---|---|---|---|---|---|---|
| AUT-01 | **BUG** The console route caps workflows at 12 steps while the library allows 20 (`route.ts:77` vs `workflows.ts:185`) | P0 | S | done | One shared limit | R2 |
| AUT-02 | Branching workflow canvas: yes/no paths and nested events, stored as Mautic's `parent_id` plus `decision_path`. Any Mautic campaign graph opens and saves; nothing is read-only (`editable:false`, `workflows.ts:87-100`) | P0 | L | review | Round-trips every campaign graph the engine can hold | R2#1 |
| AUT-03 | Conditions: all 14 immediate yes/no evaluations | P0 | M | review | — | R2#2,6 |
| AUT-04 | "No action after X" paths: decisions get their negative branch after a wait. Today only the yes anchor is created, so a contact who never opens waits forever (`workflows.ts:233-235`) | P0 | M | review | Contacts who don't act move down the no path at the deadline | R2#3 |
| AUT-05 | Action catalogue: from 5 to 26 | P0 | M | review | Every registered Mautic action is configurable | R2#4 |
| AUT-06 | Per-contact run state: event log with scheduled, executed and failed states, from `/campaigns/events/contact/{id}` | P0 | M | review | The contact and workflow views show where each contact is and why | R2#11 |
| AUT-07 | Form field types: from 5 to 24 | P0 | M | review | — | R2#16 |
| AUT-08 | Form submit actions: from none (`index.ts:719-720` always sends `actions: []`) to all 13 (admin email, repost, tags, segment, points, send email, download asset and more) | P0 | M | review | — | R2#17 |
| AUT-09 | Decision catalogue: from 2 to 9 (email open, click and reply, form submit, page hit, device hit, asset download, dynamic content, SMS reply) | P1 | M | todo | — | R2#5 |
| AUT-10 | Scheduling: fixed date, send window, weekdays and relative delays (today whole-minute intervals only) | P1 | M | todo | — | R2#7 |
| AUT-11 | Re-entry (`allowRestart`, which today is hard-coded false) and several entry sources at once | P1 | S | todo | — | R2#8-9 |
| AUT-12 | Per-step stats and funnel for every workflow | P1 | M | todo | — | R2#12 |
| AUT-13 | Add or remove a contact manually | P1 | S | todo | — | R2#13 |
| AUT-14 | Failure visibility and retry. Surface Mautic's auto-unpublish rule (at least 100 failures and a failed share of 0.35 or more) before it triggers | P1 | M | todo | — | R2#15 |
| AUT-15 | Post-submit behaviour: message, redirect or return | P1 | S | todo | — | R2#18 |
| AUT-16 | Conditional fields and progressive profiling | P1 | M | todo | — | R2#19 |
| AUT-17 | Validation: per-field messages, captcha, blocked email domains, phone format | P1 | M | todo | — | R2#20 |
| AUT-18 | Form results UI and export | P1 | S | todo | — | R2#23 |
| AUT-19 | Form-field-value condition and form-submit decision inside workflows | P1 | S | todo | — | R2#25 |
| AUT-20 | ★ Dry-run simulator: run a sample contact through a workflow and show the path and timings | P1 | L | todo | — | R2#26 |
| AUT-21 | ★ A/B split and goal-exit nodes. Versioned draft and publish (Mautic's PUT deletes events left out of the payload) | P2 | L | todo | Native engine (decision D1) | R2 §3 |
| AUT-22 | Workflow clone, export and import. Form submission limit, kiosk mode, theme and language | P2 | S | todo | — | R2#14,24 |

## DEL: newsletters, delivery, bulk email, email statistics (lane C)

| ID | Item | Pri | Eff | Status | Done when | Ref |
|---|---|---|---|---|---|---|
| DEL-01 | **BUG** "Blocklist" on one bounce blocklists every bounced subscriber. Listmonk's `PUT /api/bounces/blocklist` ignores ids (`queries/bounces.sql:66-75`), and OVELIO reports `blocklisted: ids.length` (`route.ts:535-538`, `audience.tsx:1623`) | P0 | S | done | The row action blocklists only that bounce's subscriber via `PUT /api/subscribers/{id}/blocklist`, and the count is real. Any "blocklist all bounced" action is separate, clearly labelled and confirmed | R3#16 |
| DEL-02 | **BUG** Personalisation never renders: `mailContent` escapes every `{{` (`delivery.ts:17,51`) while the editor inserts `{{ .Subscriber.FirstName }}` (`campaigns.tsx:83,95,225,435`) | P0 | S | done | An allow-list of merge tags survives sanitising: Subscriber name and email fields, `Attribs.<key>`, Campaign name, unsubscribe, opt-in and message URLs, TrackLink. Every other `{{` stays escaped, so injection is still blocked. A test send shows the name | R3#8 |
| DEL-03 | **BUG (inferred)** No working bounce source: bounce actions are set, but no mailbox or provider is configured and Caddy doesn't forward `/webhooks/service/*`. Add POP and provider webhooks (SES, SendGrid, Postmark, Azure, ForwardEmail, Lettermint, native) with signature checks | P0 | M | done | A provider bounce reaches Listmonk and OVELIO suppressions in the integration suite | R3#14 |
| DEL-04 | **BUG** Stats gaps: `delivered` and `unsubscribes` are hard-null (`listmonk/index.ts:349,353`); dashboard totals turn null above 100 campaigns (`delivery.ts:140-146`); analytics export ignores campaign ids; bounce CSV is capped at 100 rows | P0 | S | done | Every metric is populated or labelled as provider-dependent. No silent caps | R3#10-11 |
| DEL-05 | Throughput controls in Settings: concurrency, message rate, batch size, sliding window and maximum send errors (stuck at defaults today) | P0 | S | review | — | R3#2 |
| DEL-06 | Individual tracking and privacy modes setting, so per-subscriber opens and clicks are recorded where consent allows | P0 | S | review | The per-subscriber activity panel fills | R3#9 |
| DEL-07 | Unsubscribe: correct `List-Unsubscribe` one-click semantics (unsubscribe from the list or everything, not always blocklist) and a manage-preferences page | P0 | S | review | — | R3#12 |
| DEL-08 | Target segments resolved at send time. Today Mautic's cron, then OVELIO's `segment_sync` job, then a mirrored Listmonk list: two layers of staleness | P0 | M | review | Recipients equal segment membership at the moment the campaign starts | R3#5 |
| DEL-09 | Editable bounce thresholds and actions | P1 | S | todo | — | R3#15 |
| DEL-10 | Several SMTP servers with routing by From address or domain | P1 | M | todo | — | R3#3 |
| DEL-11 | Template types, including visual templates | P1 | M | todo | — | R3#7 |
| DEL-12 | Double opt-in lists and opt-in campaigns | P1 | M | todo | — | R3#13 |
| DEL-13 | ★ A/B subject and content tests with an automatic winner (Listmonk has none) | P1 | L | todo | — | R3#18 |
| DEL-14 | Attachments and inline `data-embed` images | P1 | M | todo | — | R3#20 |
| DEL-15 | Rich-text and visual drag-and-drop editors | P1 | L | todo | — | R3#21 |
| DEL-16 | Full transactional API: attachments, headers, several recipients | P1 | S | todo | — | R3#23 |
| DEL-17 | Admin notifications when a campaign finishes or pauses | P1 | S | todo | — | R3#25 |
| DEL-18 | Relay performance: pooled SMTP transport, and cached consent decisions (the gateway makes 2 upstream calls per recipient today) | P1 | S | todo | Measured throughput before and after | R3 §2 |
| DEL-19 | Archive and RSS metadata, custom headers, Return-Path, Cc and Bcc, domain allow and block lists, postback messengers | P2 | M | todo | — | R3#4,22,24,28 |
| DEL-21 | Per-campaign unsubscribe counts: add a `campaign_unsubscribes` table written by OVELIO's unsubscribe route (it knows the campaign) and report it in campaign metrics (follow-up from DEL-04) | P1 | S | review | The metric is a real count per campaign | R3#10 |
| DEL-22 | Refresh a scheduled campaign's segment recipients shortly before Listmonk starts it at `send_at` (a worker job), and pause it if the refresh fails. Today the refresh runs when it is scheduled (follow-up from DEL-08) | P1 | S | review | Recipients match the segment at send time for scheduled sends too | R3#5 |
| DEL-20 | ★ Native delivery pipeline: durable outbox with retries (Listmonk is at-most-once and can leave gaps after a crash), per-domain throttling and warm-up, exact delivered counts | P1 | L | todo | Decision D1 | R3 §4 |

## ANA: website tracking, sources, events, funnels, conversions (lane D)

| ID | Item | Pri | Eff | Status | Done when | Ref |
|---|---|---|---|---|---|---|
| ANA-01 | **BUG** Segment operators are mislabelled: `s`/`ns` mean "is set" and "is not set" in Umami, not "starts with"; `nc` doesn't exist (Umami uses `dnc`) (`analytics.tsx:213-229`, `umami/src/lib/constants.ts:153-160`) | P0 | S | done | Labels match Umami's 16 operators, chosen per field type | R4#20 |
| ANA-02 | **BUG** `IGNORE_BOT: 1` in `compose.yaml:340` is never read (Umami reads `DISABLE_BOT_CHECK`). Remove it and document the real variable | P0 | S | done | — | R4#34 |
| ANA-03 | **BUG (inferred)** Tracked-link `/q/`, pixel `/p/` and `/share/` URLs go through Caddy to the Next app, which has no such routes (`deploy/Caddyfile:100-105`) | P0 | S | done | Each URL type works in the integration suite | R4#25-27 |
| ANA-04 | **BUG** The adapter drops `channel` and `screen` filters that the route accepts. Route and adapter limits disagree (funnel window 1440 vs 10080, breakdown fields 4 vs 10, step length 200 vs 500). Attribution ignores filters and currency | P0 | S | done | One set of limits. Every accepted filter is applied | R4 |
| ANA-05 | Snippet options UI (domains, do-not-track, exclude search and hash, tag, performance, before-send) and a consent wrapper | P0 | M | review | — | R4#1,35 |
| ANA-06 | Filter engine: from 18 equality-only dimensions to 23 dimensions × 16 operators, OR matching, segment and cohort parameters, property filters | P0 | M | review | — | R4#6 |
| ANA-07 | ★ Channel classification: treat `utm_medium=newsletter`/`email` as email, `fbclid` as paid, and make the rules editable. Umami hard-codes a first-match SQL CASE | P0 | M | review | Rules are applied the same way in every report | R4#10 |
| ANA-08 | Attribution with filters, revenue and a cross-session lookback. Revenue by UTM and campaign | P0 | M | review | — | R4#17-18 |
| ANA-09 | Session properties (`session_data`) shown and filterable | P0 | M | review | — | R4#22 |
| ANA-10 | Server-side events API: authenticated and idempotent, wrapping `/api/batch` and `/api/record` (not proxied today) | P0 | M | review | — | R4#33 |
| ANA-11 | Goals, tracked links and pixels completed (after ANA-03) | P0 | S | review | — | R4#13,25-26 |
| ANA-12 | Timezone, units and comparison periods (forced to UTC with hour and day units today) | P1 | S | todo | — | R4#7 |
| ANA-13 | UTM builder and campaign link generator | P1 | S | todo | — | R4#12 |
| ANA-14 | Property filters on funnel steps. Saved segments applied by id. Cohorts | P1 | M | todo | — | R4#14,20 |
| ANA-15 | Custom events and event-property explorer | P1 | M | todo | — | R4#4-5 |
| ANA-16 | Share links, teams and API keys | P1 | M | todo | — | R4#27,32 |
| ANA-17 | Bot, internal-traffic and domain controls. Web vitals completed | P1 | S | todo | — | R4#24,34 |
| ANA-19 | Public share pages on a dedicated analytics subdomain. They can't share OVELIO's origin, because Umami's `/_next` and `/api` collide with OVELIO's (follow-up from ANA-03) | P1 | M | todo | Share links open from the console | R4#27 |
| ANA-18 | Heatmaps and replay, error tracking, boards | P2 | L | todo | — | R4#29-31 |

## X: cross-engine features, where OVELIO beats all three (lead lane plus owners)

| ID | Item | Pri | Eff | Status | Done when | Ref |
|---|---|---|---|---|---|---|
| X-01 | ★ Consent-gated identity stitching from email click to web session to contact. Campaign links carry a signed HMAC pseudonym. The page calls `umami.identify()` only after consent. An OVELIO `identities` table maps pseudonym to contact, and erasure (DSAR) deletes the link | P0 | L | todo | A test contact clicks, browses, and appears on their own timeline. Erasure removes the link | R4#37 |
| X-02 | ★ One contact timeline: Mautic activity, Listmonk sends, opens, clicks and bounces, and Umami visits and events | P0 | M | todo | Depends on X-01 and AUD-09 | R1 §3 |
| X-03 | ★ One consent and suppression truth across Mautic DNC, Listmonk blocklist and OVELIO `suppressions`, reconciled by the worker | P0 | M | review | No path where engines disagree | R1#25, R3 |
| X-04 | ★ Behaviour segments: website events become segment membership and tags | P1 | L | todo | — | R4#38 |
| X-05 | ★ Engagement score from opens, clicks and visits written back to the contact, with decay | P1 | M | todo | Depends on AUD-17 | R3 §3 |
| X-06 | ★ Multi-touch attribution from campaign to revenue | P1 | L | todo | Depends on X-01 and ANA-08 | R4 §3 |
