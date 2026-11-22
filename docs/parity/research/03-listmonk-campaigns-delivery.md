# 03 - Listmonk (v6.2.0) campaigns, delivery, bulk email, email stats vs OVELIO

Path shorthand. `LM:` = `.refs/listmonk/`. `OV:` = `OVELIO/`. Cites are `file:line`. "Established" = read in code. "Inferred" = reasoned from code, not executed. Nothing was run.

---

## 1. Gap table

Status words: exposed = OVELIO surfaces it end to end; partial = some of it; missing = not reachable from OVELIO.

| # | Capability | Listmonk mechanism (one line) | OVELIO today | Pri | Eff |
|---|---|---|---|---|---|
| 1 | Campaign lifecycle (draft, scheduled, running, paused, cancelled, finished) | `PUT /api/campaigns/:id/status`, transition table in `internal/core/campaigns.go:250-303`; manager picks up `running` or due `scheduled` every 5 s | **exposed**: start/pause/schedule/cancel/clone/delete (`OV:src/server/listmonk/index.ts:451-716`, routes `[...path]/route.ts:401-487`); advisory lock + `campaign_operations` audit (`delivery.ts:98-130`) | P0 | done |
| 2 | Throughput controls: concurrency, message_rate, batch_size, sliding window, max_send_errors | Settings `app.*` (`LM:schema.sql:235-241`), enforced in `manager.go:487-510`, `pipe.go:94-135` | **missing**: `configureDelivery` forwards existing settings untouched (`index.ts:966-982`) and has no UI; defaults (10 workers x 10 msg/s, 1000 batch, 1000 max errors) stay | P0 | S |
| 3 | Multiple SMTP servers, from-address/domain routing, named messengers | `email.New` pools keyed by from-address and domain, random pick (`LM:internal/messenger/email/email.go:93-98,111-122,242-257`) | **missing**: forces a single server `email-ovelio` through the policy gateway (`index.ts:932-951,968`); sender pinned to `SMTP_FROM_EMAIL` (`delivery.ts:55-64`) | P1 | M |
| 4 | Postback (HTTP) messengers | `initPostbackMessengers` (`LM:cmd/init.go:719`), JSON payload in `postback.go:17-58` | **missing** | P2 | M |
| 5 | Audience targeting | Campaign -> lists only; batch query `next-campaign-subscribers` (`LM:queries/campaigns.sql:330-372`); no SQL segment on a campaign | **partial**: Mautic segment -> one Listmonk list sync (`OV:src/server/audience.ts:416-469`, tag `ovelio-segment-N`); campaign form requires >=1 list (`route.ts:46`) | P0 | M |
| 6 | Subscriber SQL-expression query, bulk list/blocklist/delete by query | `query-subscribers*` raw templates with `%query%` (`LM:queries/subscribers.sql:280-402`), read-only tx + table allow-list (`LM:internal/core/subscribers.go:20-31,126-155`) | **missing** by design (segmentation lives in Mautic) | P2 | S (gap is covered by Mautic) |
| 7 | Template types: campaign, campaign_visual, tx | `templates` table + `{{ template "content" . }}` rule (`LM:cmd/templates.go:214-230`) | **partial**: campaign + tx CRUD, default, preview (`index.ts:759-806`); no visual type, no body_source, no archive template | P1 | M |
| 8 | Personalisation and template functions (Subscriber.*, Campaign.*, Sprig, Date, Safe) | Go `html/template` + Sprig minus env/expandenv/getHostByName (`LM:manager.go:658-683`) | **broken for HTML**: every `{{` in HTML bodies is entity-escaped (`OV:delivery.ts:17,51`) yet the editor inserts `{{ .Subscriber.FirstName }}` (`campaigns.tsx:83,95,225`). Markdown/plain bodies are not escaped (`delivery.ts:58`) | P0 | S |
| 9 | Open/click tracking and privacy modes | `TrackView` pixel, `TrackLink` redirect, `privacy.individual_tracking`, `privacy.disable_tracking` (`LM:manager.go:373-397`, `cmd/public.go:552-610`) | **partial**: auto-injects `@TrackLink` and pixel (`index.ts:190-198`); reads flags only (`index.ts:329,351,869-870`); never sets `individual_tracking`, so counts are anonymous (inferred, see 2.7) | P0 | S |
| 10 | Stats: sent, views, clicks, bounces, per-link top 50, time series, running rate | `get-campaign-stats`, `get-campaign-analytics-*` (`LM:queries/campaigns.sql:115-276`), `/api/campaigns/running/stats` (`LM:cmd/campaigns.go:486-516`) | **partial**: all fetched (`index.ts:620-729,868-900`); `delivered` and `unsubscribes` hard-null (`index.ts:349,353`); dashboard aggregates only if <=100 campaigns (`delivery.ts:140-146`) | P0 | M |
| 11 | Analytics export (views/clicks CSV, by date) | `GET /api/maintenance/analytics/:type/export?since=` (`LM:cmd/maintenance.go:89-150`) | **partial / wrong scope**: `_ids` ignored, exports all campaigns since date (`index.ts:902-918`); bounce CSV capped at first 100 rows (`route.ts:458`) | P1 | S |
| 12 | Unsubscribe: footer link, `List-Unsubscribe` + One-Click, manage-preferences page | `UnsubscribeURL`, headers set at send (`LM:manager.go:529-533`), `SubscriptionPrefs` (`LM:cmd/public.go:253-343`) | **partial**: header on (`index.ts:975`), one-click POST proxied and forced `blocklist=true` (`OV:src/app/subscription/[campaign]/[subscriber]/route.ts:12-14`); preferences page disabled (`index.ts:977`) | P0 | S |
| 13 | Double opt-in lists and opt-in campaigns | list `optin` single/double, `campaign.type='optin'` (`LM:queries/campaigns.sql:206-212,351-353`), `OptinPage` (`LM:cmd/public.go:348-420`) | **partial**: list type/optin settable (`index.ts:155-163`); all synced subscriptions are `preconfirm_subscriptions: true` (`index.ts:525`); public subscribe page off (`index.ts:973`); consent is Mautic-side. No opt-in campaign | P1 | M |
| 14 | Bounce ingestion: POP mailbox + webhooks SES, SendGrid, Postmark, Azure, ForwardEmail, Lettermint + native webhook | `internal/bounce/*`, `POST /webhooks/service/:service` (`LM:cmd/bounce.go:123-245`) | **missing in practice**: `bounce.enabled` + `webhooks_enabled` + actions set (`index.ts:980-982`), but no provider or mailbox is configured anywhere, and Caddy does not proxy `/webhooks/*` (`deploy/Caddyfile:47-105`). Only SMTP-gateway 5.1.0/5.1.1 on single-RCPT feeds OVELIO's own `suppressions` (`scripts/smtp.ts:63-66`), not Listmonk bounces | P0 | M |
| 15 | Bounce actions and thresholds (none, unsubscribe, blocklist, delete per soft/hard/complaint) | `record-bounce` (`LM:queries/bounces.sql:1-30`) | **partial**: fixed policy soft 2/none, hard 1/blocklist, complaint 1/blocklist (`index.ts:927-931`); no editing | P1 | S |
| 16 | Bounce list, delete, blocklist | `/api/bounces*` | **exposed but unsafe**: "Blocklist" button sends one id (`audience.tsx:1623`), upstream ignores ids and blocklists EVERY subscriber with any bounce (`LM:queries/bounces.sql:66-75`, `LM:cmd/bounce.go:112-118`) | P0 (bug) | S |
| 17 | Test sends | `POST /api/campaigns/:id/test` with arbitrary subscriber emails (`LM:cmd/campaigns.go:520-606`) | **exposed**: one recipient, must be consented, rate-limited (`delivery.ts:71-77`, `route.ts:471-477`) | done | - |
| 18 | A/B or multivariate tests | **not in Listmonk** (grep: no variant concept in schema/queries) | missing | P1 | L |
| 19 | Scheduling | `send_at` + status `scheduled`; picked when `NOW() >= send_at` (`LM:queries/campaigns.sql:186`) | **exposed**: future time >=1 min, device-local tz (`delivery.ts:111-114`, `campaigns.tsx:1033-1066`) | done | - |
| 20 | Attachments (campaign media) and inline `data-embed` images | `campaign_media`, `attachMedia`, `applyInlineImages` (`LM:manager.go:685-767`) | **missing**: payload has no `media` (`index.ts:435-448`); media library is image/PDF 8 MB insert-URL only (`OV:src/app/api/console/media/route.ts:11-14`) | P1 | M |
| 21 | Editors: richtext, html, markdown, plain, visual | content_type enum (`LM:schema.sql:8`) | **partial**: html, markdown, plain in UI (`campaigns.tsx:187`); contract allows richtext (`contracts/index.ts:560`) but no editor; no visual builder | P1 | L |
| 22 | Public archive page + RSS + per-campaign slug/template/meta | `archive*` (`LM:cmd/archive.go`) | **partial**: toggle + slug (`index.ts:653-660`); `/archive` proxied (`Caddyfile:49`), `/archive.xml` not; no archive template/meta | P2 | S |
| 23 | Transactional email | `POST /api/tx` multi-recipient, modes default/fallback/external, attachments, headers (`LM:cmd/tx.go:15-160`, `LM:models/messages.go:44-72`) | **partial**: single recipient, consent-gated, no attachments/headers/modes (`index.ts:854-866`) | P1 | S |
| 24 | Custom headers per campaign, Return-Path, Bcc/Cc | `campaigns.headers` JSON (`LM:schema.sql:106`), `email.go:166-205` | missing (`email_headers: []` fixed, `index.ts:949`) | P2 | S |
| 25 | Admin notifications on finish/pause | `sendNotif` (`LM:pipe.go:212,243`), `app.notify_emails` | missing: never configured | P1 | S |
| 26 | Link and view data retention (GC) | `/api/maintenance/analytics/:type` | **exposed** (`index.ts:1020-1030`, `route.ts:964-967`) | done | - |
| 27 | Per-subscriber activity (views, clicks, bounces) | `get-subscriber-activity` (`LM:queries/subscribers.sql:435-471`) | exposed (`index.ts:580-602`); empty unless individual tracking is on (inferred) | P1 | S |
| 28 | Domain allow/block lists, GDPR self-export/wipe | `privacy.*` | export/wipe forced off (`index.ts:978-979`); domain lists untouched | P2 | S |
| 29 | Deliverability diagnostics (SPF/DKIM/DMARC, relay verify, consent gate) | n/a in Listmonk | **OVELIO only**: DNS checks (`reporting.ts:53-68`), `relay.verify()` (`scripts/worker.ts:44`), per-RCPT consent policy (`scripts/smtp.ts:38-45`) | done | - |

---

## 2. Mechanism deep dives

### 2.1 Data model (v6.2.0, `LM:schema.sql`)

| Table | Key columns / relations | Notes |
|---|---|---|
| `subscribers` | id, uuid, email (unique lower), name, attribs JSONB, status enum `enabled, disabled, blocklisted` (`:4,20-35`) | `disabled` exists but I found no send-path use besides `!= 'blocklisted'` filters (`campaigns.sql:213,349`), i.e. a `disabled` subscriber is still mailed (established by the query, odd edge case) |
| `lists` | id, uuid, type enum `public, private, temporary`, optin `single, double`, status `active, archived`, tags[] (`:1-3,39-51`) | `temporary` appears only in the enum; `archived` is not filtered in campaign queries I read (`campaigns.sql:181-232,330-372`) |
| `subscriber_lists` | PK (subscriber_id, list_id), status `unconfirmed, confirmed, unsubscribed`, meta JSONB (opt-in IP lives here) (`:61-71`, `public.go:404-406`) | per-list consent state |
| `templates` | type `campaign, campaign_visual, tx`, subject (tx only), body, body_source, is_default (unique partial index) (`:78-90`) | delete keeps >=1 template, rebinding campaigns to default (`templates.sql:29-42`) |
| `campaigns` | uuid, type `regular, optin`, status, content_type `richtext, html, plain, markdown, visual`, send_at, headers JSONB, attribs, tags, messenger, template_id, `to_send, sent, max_subscriber_id, last_subscriber_id`, archive, archive_slug, archive_template_id, archive_meta, started_at (`:95-134`) | **checkpoint = last_subscriber_id** |
| `campaign_lists` | campaign_id, list_id (nullable, SET NULL on list delete), list_name copy (`:142-153`) | keeps history after list deletion |
| `campaign_media` | campaign_id, media_id (nullable), filename copy (`:184-194`) | attachments |
| `campaign_views` | id, campaign_id, subscriber_id (nullable), created_at (`:156-166`) | append-only, **no uniqueness** |
| `links` / `link_clicks` | links(uuid, url UNIQUE); link_clicks(campaign_id, link_id, subscriber_id nullable, created_at) (`:199-219`) | link row shared across campaigns |
| `bounces` | subscriber_id NOT NULL, campaign_id nullable, type `soft, hard, complaint`, source text, meta JSONB (`:305-317`) | |
| `media` | uuid, provider, filename, content_type, thumb, meta (`:170-180`) | filesystem or S3 |
| `settings` | key/value JSONB (`:223-301`) | all tunables below |
| materialized views | `mat_dashboard_counts`, `mat_dashboard_charts`, `mat_list_subscriber_stats` (`internal/migrations/v3.0.0.go:57-131`) | refreshed by `Core.RefreshMatViews` (`internal/core/core.go:90`), optionally on a cron (`app.cache_slow_queries`, `cmd/settings.go:307`) |

### 2.2 Campaign statuses and transitions (established, `LM:internal/core/campaigns.go:250-303`)

Statuses: `draft, scheduled, running, paused, cancelled, finished` (`schema.sql:6`, `models/campaigns.go:19-24`).

| Target | Allowed from | Extra rule |
|---|---|---|
| `draft` | `scheduled` only | un-schedule |
| `scheduled` | `draft`, `paused` | needs `send_at` set |
| `running` | `paused`, `draft` | DB trigger `update-campaign-status` rewrites `running` to `scheduled` when `send_at IS NOT NULL` (`campaigns.sql:443-452`) |
| `paused` | `running` | also set by the manager on error threshold (`pipe.go:205-213`) |
| `cancelled` | `running`, `paused` | terminal |
| `finished` | set by manager only, when batches exhausted and DB status still `running` or `scheduled` (`pipe.go:230-236`) | terminal |

Other facts:
- Editing allowed only in `draft, paused, scheduled` (`LM:cmd/campaigns.go:845-851`).
- Send time must be in the future on create/update (`campaigns.go:~705`).
- Pause and cancel also call `manager.StopCampaign(id)` to stop in-flight (`campaigns.go:375-377`).
- Scheduled campaigns are picked up by `next-campaigns` when `NOW() >= send_at` (`campaigns.sql:186`); the scan ticker is 5 s (`LM:cmd/init.go:615`).
- OVELIO guards: `start` allowed from draft/paused/scheduled, `pause` from scheduled/running/paused (scheduled pause = back to draft), schedule requires >= 1 min ahead (`OV:delivery.ts:104-114`).

### 2.3 Send pipeline (established; `LM:internal/manager/manager.go`, `pipe.go`, `cmd/manager_store.go`)

**Planning (every 5 s tick)** - `scanCampaigns` (`manager.go:447-483`):
1. `getCurrentCampaigns` collects IDs and per-pipe `sent` deltas, resetting deltas to 0 (`:586-605`).
2. SQL `next-campaigns` (`campaigns.sql:181-232`): selects campaigns with `status='running'` or due `scheduled`, not already in memory; computes `to_send = COUNT(DISTINCT subscriber_id)` and `max_subscriber_id` across all of the campaign's lists using the same eligibility predicate as the sender; flips status to `running`, stamps `started_at`; also writes the cumulative `sent` deltas back (side-effecting read).
3. `newPipe` (`pipe.go:27-75`): validates messenger (unknown messenger -> campaign cancelled, `:29-32`), resolves `data-embed` inline images, compiles templates, loads attachments, creates a WaitGroup with a +1 sentinel, spawns a goroutine that runs `cleanup()` when it drains.

**Eligibility predicate** (`campaigns.sql:342-363`): subscriber `status != 'blocklisted'`; regular campaign: double opt-in list requires `confirmed`, single opt-in list requires `!= 'unsubscribed'` (so `unconfirmed` is mailed on single opt-in); optin campaign: only `unconfirmed` on double lists. De-duplicated across lists with `SELECT DISTINCT s.id`.

**Batching**: `NextSubscribers` (`pipe.go:81-139`) -> store `NextSubscribers` runs `get-running-campaign` (needs status `running`, so a paused campaign yields zero rows) then `next-campaign-subscribers` with `last_subscriber_id < id <= max_subscriber_id ORDER BY id LIMIT batch_size` (default 1000) and, in the same statement, advances `last_subscriber_id` to the batch's max id (`campaigns.sql:367-372`). Keyset pagination on subscriber id, not OFFSET. The comment at `:323-329` records a planner problem that forced the list IDs to be passed statically.

**Rendering**: per subscriber `NewCampaignMessage` renders subject (text/template if it has `{{`), body through base template + "content" child, optional alt body, templated headers (`message.go:33-88`). Failure to render logs and skips the subscriber (`pipe.go:101-105`), without counting as error.

**Concurrency and rate** - workers (`manager.go:487-582`):
- `app.concurrency` goroutines (default 10, `schema.sql:235`) read from `campMsgQ` (buffer `concurrency*message_rate*2`, `:190`).
- Per-worker limiter: after `message_rate` messages (default 10) the worker sleeps 1 s and resets (`:505-510`). Effective ceiling ~ concurrency x message_rate msg/s, but the sleep is a fixed 1 s after the burst, not a token bucket, and each worker counts independently (inferred: bursts are not smoothed).
- Sliding window (`pipe.go:94-135`): optional global counter on the Manager (`slidingCount`, `slidingStart`), when count reaches `message_sliding_window_rate` within `message_sliding_window_duration` the **batch-feeding loop sleeps** for the remainder. Requires duration > 1 s. State is shared by all campaigns but is mutated without a mutex (`manager.go:103-107`; inferred benign because one feeder goroutine runs `Run()` loop, `manager.go:295`). Because the sleep blocks the single feeder, all campaigns stall together (inferred).
- Messenger push: `m.messengers[camp.Messenger].Push(out)` (`:546`). Headers added: `X-Listmonk-Campaign`, `X-Listmonk-Subscriber` (used for bounce correlation), `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` when `privacy.unsubscribe_header` (`:525-533`), then campaign custom headers.
- No send-side retry in the manager. Retries only inside the SMTP pool (`max_msg_retries`, `OV:index.ts:946` sets 0). `Config.RequeueOnError` exists (`manager.go:139`) but is never set or read elsewhere (grep over cmd/internal/models: only the declaration).

**Error handling and auto-pause**: a failed push calls `OnError` (`pipe.go:143-156`); when error count >= `app.max_send_errors` (default 1000, `schema.sql:238`; <1 disables) the pipe is stopped `withErrors`, `cleanup()` sets status `paused`, and `sendNotif` emails `app.notify_emails` (`pipe.go:205-214`).

**Pause / resume / cancel keeps position**:
- Pause/cancel set `stopped`; workers drop queued messages of a stopped pipe (`manager.go:499-503`); in-flight sends finish.
- `cleanup()` writes `sent` and `last_subscriber_id = max(subscriber id of successfully sent messages)` (`pipe.go:200`, `campaigns.sql:435-441`).
- Resume = status back to `running`; next scan creates a new pipe and `next-campaign-subscribers` continues after `last_subscriber_id`.
- Position semantics (inferred from the two writes): `next-campaign-subscribers` pre-advances the checkpoint to the end of each fetched batch; `cleanup` then rewrites it to the highest id actually sent. Failed sends are therefore not retried if any higher-id message succeeded, and a crash mid-batch loses the unsent tail of the fetched batch (the checkpoint already moved). It is at-most-once per subscriber with possible gaps, never duplicates (unless the checkpoint is rewritten lower than a sent id, which `max` prevents).
- `to_send` is recomputed on each new pipe (`campaigns.sql:222-231`), so list growth after start is only partly included (bounded by new `max_subscriber_id`).

**Finish**: all messages drained and not stopped -> re-read status; if `running` or `scheduled` set `finished` and email admins (`pipe.go:222-243`).

**Multi-instance**: `passive` mode disables the scanner (`LM:cmd/init.go:591-593`, `ScanCampaigns`).

### 2.4 Messengers (`LM:internal/messenger`)

- **email** (SMTP pool, `smtppool`): per server options host, port, auth `cram|plain|login|none`, TLS `none|STARTTLS|TLS`, skip verify, max_conns, idle/wait timeouts, max_msg_retries, hello hostname, `email_headers`, `from_addresses` (`email.go:23-44,60-122`). Random server per message among servers matching the From address, then From domain, else all (`:134-141,242-257`). Each named SMTP also becomes a standalone messenger `email-<name>` selectable per campaign; if it is later removed the campaign silently falls back to `email` (`LM:cmd/campaigns.go:735-742`, `cmd/init.go:668-712`).
- Message-Id generated per From domain; `Return-Path` header becomes envelope sender; `Bcc`/`Cc` headers go to envelope (`email.go:166-205`). Plain content type sends text only, else HTML plus optional alt body.
- **postback**: POSTs a JSON campaign payload with recipients/attachments to a URL with basic auth, `max_conns`, `retries`, `timeout` (`postback.go:17-58`). Gives SMS/push/Slack style delivery.
- OVELIO overrides all this with one server `email-ovelio` -> its own policy gateway (`index.ts:932-951`, `scripts/smtp.ts`).

### 2.5 Templates and functions (established, `LM:internal/manager/manager.go:371-423,658-683`, `models/common.go:43-66`, `docs/docs/content/templating.md:20-64`)

Compile order: base template (campaign template body, or `{{ template "content" . }}` when none or `visual`), then campaign body (markdown converted by goldmark with table/strikethrough/tasklist/typographer, unsafe HTML on, `common.go:69-90`), alt body, subject, headers (`campaigns.go:141-242`).

Pre-parse shorthands (`models/common.go:43-66`): `{{ TrackLink "url" }}` -> adds `.`; `https://x@TrackLink` -> `{{ TrackLink "https://x" . }}`; `{{ TrackView|UnsubscribeURL|ManageURL|OptinURL|MessageURL }}` -> adds `.`.

Template data: `.Subscriber` (UUID, Email, Name, FirstName(), LastName(), Status, Attribs, CreatedAt, UpdatedAt; `models/subscribers.go:31-102`), `.Campaign` (UUID, Name, Subject, FromEmail; doc table). FirstName = first space-split chunk longer than 2 chars (`subscribers.go:79-87`).

Function enumeration (complete for Listmonk-defined):
| Function | Behaviour | Cite |
|---|---|---|
| `TrackLink url` | returns `LinkTrackURL(linkUUID, campUUID, subUUID)`; `&amp;` normalised; registers link in `links` once, cached in-memory; on DB error returns raw URL; returns raw URL when tracking disabled; subscriber UUID replaced by all-zero dummy when individual tracking off | `manager.go:373-383,609-637` |
| `TrackView` | `<img src=ViewTrackURL>` pixel (HTML), empty if disabled; dummy UUID if individual tracking off | `:385-396` |
| `UnsubscribeURL` | `/subscription/<campUUID>/<subUUID>` | `:398-400`, `message.go:21` |
| `ManageURL` | UnsubscribeURL + `?manage=true` | `:401-403` |
| `OptinURL` | `/subscription/optin/<subUUID>` | `:404-408` |
| `MessageURL` | `/campaign/<campUUID>/<subUUID>` web view | `:409-411` |
| `ArchiveURL`, `RootURL` | static URLs | `:412-417` |
| `Date layout` | `time.Now().Format` (empty layout -> ANSIC) | `:660-665` |
| `L` | i18n object (`{{ L.T "key" }}`) | `:666-668` |
| `Safe html` | marks string as `template.HTML` | `:669-671` |
| Sprig `GenericFuncMap` minus `env`, `expandenv`, `getHostByName` | 100+ string/date/math/list/dict funcs | `:674-681` |

Templates: tx templates are compiled with only generic funcs (`models/templates.go` Compile, `cmd/init.go:630-646`); campaign and campaign_visual templates additionally get campaign funcs (`cmd/templates.go:122-125,162-165`). Campaign templates must contain `{{ template "content" . }}` (`cmd/templates.go:219-222`); tx templates must have a subject (`:224-227`). Default template is a unique partial index; deleting the default is blocked (`templates.sql:29-42`). Preview renders against a dummy campaign/subscriber (`cmd/templates.go:233-266`). Archive pages use `archive_template_id` and `archive_meta` (dummy subscriber JSON) (`campaigns.sql:85-97`, `cmd/archive.go:239-277`).

Inline images: `<img data-embed src=...>` is rewritten to `cid:` and the media blob attached as inline part (`manager.go:707-767`). Campaign attachments are fetched once per campaign and attached to every message (`:685-705`, `queries/campaigns.sql:195-200,232`).

### 2.6 Opens, clicks, de-duplication

- **Open**: `GET /campaign/:campUUID/:subUUID/px.png` -> `register-campaign-view` inserts a row (`public.go:587-610`, `campaigns.sql:481-488`). Always returns a PNG, even on error. Dummy-UUID hits (previews) are not recorded (`public.go:600-606`). If tracking is disabled nothing is stored (`:589-592`). If individual tracking is off `subUUID=''` so `subscriber_id` is NULL.
- **Click**: `GET /link/:linkUUID/:campUUID/:subUUID` -> `register-link-click` inserts a row and returns the URL, 307 redirect (`public.go:552-581`, `links.sql:8-18`). Disabled tracking = plain redirect, no row. Invalid link -> error page.
- **No uniqueness at write time**. Every pixel load or click is a row; bot prefetches (Apple MPP, security scanners) inflate counts (inferred; no bot filter found in `public.go`).
- **De-dup only at read time**: when `privacy.individual_tracking` is on, time-series queries use `get-campaign-analytics-unique-counts` (`DISTINCT ON (subscriber_id, campaign_id)`, `campaigns.sql:234-246`, chosen at `cmd/init.go:409`) and link counts use `COUNT(DISTINCT subscriber_id)` (`init.go:410`, `campaigns.sql:269-276`). With it off, raw counts. The headline `views` / `clicks` on a campaign row are always raw `COUNT(campaign_id)` (`campaigns.sql:123-132`).
- Aggregation buckets: hour if range < 7 days, else day (`campaigns.sql:236-238`). Link report: top 50 only (`:276`). Analytics API takes `id[]`, `from`, `to`; types `views|clicks|bounces|links` (`cmd/campaigns.go:609-653`).
- Per-subscriber activity: `get-subscriber-activity` groups views and clicks by campaign/link with last timestamps (`subscribers.sql:435-471`); needs `subscriber_id` so only works with individual tracking.
- Export: stream CSV of views or clicks since a timestamp, batched by `DBBatchSize` with OFFSET paging (`cmd/maintenance.go:89-150`, `core/campaigns.go:464-490`); includes email and name (PII).
- Dashboard: counts and 30-day charts from materialized views (stale until refreshed).

### 2.7 Privacy settings

`privacy.individual_tracking` (default false), `privacy.disable_tracking` (false), `privacy.unsubscribe_header` (true), `allow_blocklist`, `allow_export`, `allow_wipe`, `allow_preferences` (all true), `exportable`, `domain_blocklist/allowlist`, `record_optin_ip` (false) (`schema.sql:252-262`). Opt-in IP stored in `subscriber_lists.meta.optin_ip` when enabled (`public.go:400-408`).

OVELIO sets: unsubscribe_header true, allow_blocklist true, allow_preferences false, allow_wipe false, allow_export false (`index.ts:975-979`). It never writes `individual_tracking` or `disable_tracking` (inferred: preserved from install defaults = false/false, so opens/clicks counted anonymously and per-subscriber activity panel (`index.ts:580`, `contracts/index.ts:110`) stays empty). Needs a live-instance check to confirm.

### 2.8 Unsubscribe, opt-in, preferences (established)

- Footer/headers use `/subscription/<campUUID>/<subUUID>`. `GET` renders page; `POST` without `manage` = unsubscribe from the campaign's lists; with `blocklist=true` (and `allow_blocklist`) = set subscriber `blocklisted` and unsubscribe from all lists (`public.go:253-280`, `subscribers.sql:251-267`). With `manage` + `allow_preferences`: name edit and per-list checkboxes; unchecked public lists are unsubscribed, private lists are untouched (`:282-343`).
- One-click: provider POSTs `List-Unsubscribe=One-Click` to the header URL (`manager.go:529-533`). OVELIO re-implements POST in Next and always sends `blocklist=true` (`OV:subscription/.../route.ts:12-14`), i.e. a one-click unsubscribe blocklists the person globally (stronger than Listmonk default). Caddy only proxies GET/HEAD of that URL to Listmonk; POST falls to the Next app (`Caddyfile:47-58,100-105`).
- Double opt-in: new public subscriber to a double list gets a confirmation email (`makeOptinNotifyHook`, `LM:cmd/subscribers.go:857-905`, `app.send_optin_confirmation`). `OptinPage` confirms by `confirm-subscription-optin` (`subscribers.sql:231-239`). Stale unconfirmed rows GC: `DELETE /api/maintenance/subscriptions/unconfirmed?before_date=` (`subscribers.sql:269-274`).
- Opt-in campaign (`type='optin'`) creates a default body with `{{ OptinURL }}?l=<uuid>` per double list (`cmd/campaigns.go:767-807`), sent to `unconfirmed` subscribers only.
- Public forms: `/subscription/form`, `POST /api/public/subscription`, `/api/public/lists`, altcha/hCaptcha (`LM:cmd/handlers.go:~260-262,277-279`).

### 2.9 Bounces (established)

Sources and classification:

| Source | `bounces.source` | Type mapping | Cite |
|---|---|---|---|
| POP3 mailbox (one only; scans every `scan_interval`, up to 1000 msgs, deletes after) | mailbox host | SMTP status 5.x.x -> hard, 4.x.x -> soft; else keyword regex (NXDOMAIN, user unknown, ...) -> hard; default soft; correlates via `X-Listmonk-Campaign/Subscriber` headers or regex fallback | `internal/bounce/mailbox/pop.go` (classifyBounce), `cmd/init.go:856-873` |
| Native webhook `POST /webhooks/bounce` (authenticated, perm `webhooks:post_bounce`) | caller-supplied | caller sets `soft|hard|complaint`; needs email or subscriber_uuid | `cmd/bounce.go:118-166,216-232`, `handlers.go:~224-228` |
| SES via SNS (`/webhooks/service/ses`) | `ses` | Permanent -> hard; Transient -> soft, except status 5.4.4 -> hard; Complaint notification -> complaint; campaign UUID read from mail headers unless truncated; SNS signature verified, subscription auto-confirm | `webhooks/ses.go:125-175`, `bounce.go:~155-170` |
| SendGrid | `sendgrid` | event "bounce": hard unless classification technical/content -> soft; signature verified (ECDSA) | `webhooks/sendgrid.go:60-80` |
| Postmark | `postmark` | HardBounce, BadEmailAddress, ManuallyDeactivated -> hard; SoftBounce, Transient, DnsError, SpamNotification, VirusNotification, DMARCPolicy -> soft; SpamComplaint -> complaint; others ignored; basic auth | `webhooks/postmark.go:66-96` |
| Azure Communication Services via Event Grid | `azure` | bounced/suppressed -> hard; failed/other statuses mapped hard/soft; filteredspam/quarantined -> complaint or soft; shared-secret header; subscription validation handshake | `webhooks/azure.go:105-235`, `bounce.go:~170-185` |
| ForwardEmail | `forwardemail` | soft default, hard on specific response; HMAC signature | `webhooks/forwardemail.go:77-95` |
| Lettermint | `lettermint` | `message.hard_bounced`, `message.soft_bounced`, `message.spam_complaint`; signed (`t`, `v1`) | `webhooks/lettermint.go:83-146` |

Pipeline: every source pushes to a 1000-slot channel (`bounce.go:75,154-157`); `Run` drains it and calls `Core.RecordBounce` (`bounce.go:125-139`). `RecordBounce` looks up the action for the type and runs `record-bounce` (`core/bounces.go:60-87`): counts existing bounces of this subscriber and type, +1; if `>= count` applies `blocklist` (status blocklisted), `unsubscribe` (all subscriptions unsubscribed), `delete` (subscriber deleted), or `none` (`queries/bounces.sql:1-30`). The row is inserted only when the subscriber is not blocklisted and `num <= count`, so with action `none` and count 2 a third soft bounce is not recorded at all (established by `:26`; consequence inferred: soft bounce history is capped at `count`). Unknown subscriber is logged and ignored (`core/bounces.go:77-80`). Defaults soft 2/none, hard 1/blocklist, complaint 1/blocklist (`schema.sql:287`). API: list (filter campaign, subscriber, source; sortable), per-subscriber bounces (max 1000), delete one/many/all, blocklist-all-bounced (`handlers.go:134-138`, `bounces.sql:32-76`).

OVELIO: sets action thresholds (`index.ts:927-931`) and enables the webhook switch (`index.ts:981`) but I found no provider key, mailbox, or reverse-proxy rule that would let any bounce reach Listmonk. Established: Caddy proxies a fixed GET allow-list only (`Caddyfile:47-58`) and everything else goes to the Next app (`:100-105`). Established: only provider-specific route is `POST /api/delivery/suppress` with a shared secret, reasons unsubscribe/bounce/complaint, writes OVELIO `suppressions` not a Listmonk bounce (`OV:api/delivery/suppress/route.ts:7-18`). Inferred: today's bounce numbers come only from Listmonk's own record when something posts internally; for a stock deployment they will be zero.

### 2.10 Stats Listmonk reports (complete enumeration)

Per campaign (`campaigns.sql:115-150`, `models/campaigns.go:86-103`): `to_send`, `sent`, `views`, `clicks`, `bounces`, `started_at`, `updated_at`, lists with names, media, plus status. Running stats (`cmd/campaigns.go:486-516`): `rate` (per-minute counter from `ratecounter`, `pipe.go:15,52`) and `net_rate` (sent / elapsed minutes, min 1). Analytics API: views, clicks, bounces as bucketed counts per campaign; links top 50 (`campaigns.sql:234-276`). Dashboard: subscriber totals, blocklisted, orphans, list counts by type/optin, campaign counts by status, message totals, 30-day views/clicks charts (`v3.0.0.go:57-122`). List stats: subscriber counts per subscription status (`lists.sql:11-39`). Not reported: delivered, deferred, complaints rate, unsubscribes per campaign, open rate, CTR, unique opens (except via the individual-tracking query), device/client, geo, time-to-open, revenue, domain breakdown (no such table or query found).

### 2.11 REST endpoints OVELIO can call (v6.2.0, `LM:cmd/handlers.go:117-197,224-285`)

Campaigns: `GET/POST /api/campaigns`, `GET/PUT/DELETE /api/campaigns/:id`, `PUT /api/campaigns/:id/status`, `PUT .../archive`, `GET|POST .../preview`, `POST .../preview/archive`, `POST .../content` (markdown -> html), `POST .../text`, `POST .../test`, `GET /api/campaigns/running/stats`, `GET /api/campaigns/analytics/:type`, `DELETE /api/campaigns` (bulk by ids or query). Subscribers: CRUD, `PATCH`, `/blocklist`, `/lists`, `/query/*` (delete, blocklist, lists), `GET /api/subscribers/export`, `/api/subscribers/:id/{activity,export,bounces,optin}`. Bounces: `GET/DELETE /api/bounces`, `GET/DELETE /api/bounces/:id`, `PUT /api/bounces/blocklist`. Templates: CRUD, `/default`, `/preview`. Media: list/get/upload/delete. Import: `POST/GET/DELETE /api/import/subscribers`, `GET .../logs` (modes subscribe or blocklist, CSV or ZIP, overwrite flags, `LM:cmd/import.go`, `subimporter/importer.go:47-97`). Maintenance: `DELETE /api/maintenance/{subscribers/:type, analytics/:type, subscriptions/unconfirmed}`, `GET /api/maintenance/analytics/:type/export`. Tx: `POST /api/tx`. Settings: `GET/PUT /api/settings`, `POST /api/settings/smtp/test`. Webhooks: `POST /webhooks/bounce`, `POST /webhooks/service/:service`. Public: `/subscription/*`, `/link/*`, `/campaign/*`, `/archive*`, `/api/public/*`.

### 2.12 Operator UI capabilities in Listmonk (for parity checklist)

Campaign form: name, subject (templated), from address, lists multi-select, template, tags, messenger/SMTP choice, schedule date-time, custom headers, attachments, archive options (slug, template, meta), editor choice (rich text, raw HTML, Markdown, plain, visual builder), alt-body, preview, test send to arbitrary subscribers, convert between formats. Campaign list: status filter, tag filter, search, running progress with rate. Analytics page: multi-campaign comparison across dates for views/clicks/bounces/links. Subscribers: SQL query box, bulk ops, per-subscriber activity/bounces. Bounces page. Settings: performance (concurrency, message rate, batch size, max errors, sliding window), privacy, SMTP list with test, bounce sources, messengers, media storage, notifications, appearance (custom CSS/JS). Public pages: subscription form, preferences, archive, opt-in confirmation.

### 2.13 Edge cases and limits worth copying or avoiding

- Link tracking cache is in-memory and unbounded (`manager.go:96`), grows with every distinct URL; per-recipient personalised URLs create one `links` row each (inferred).
- Link click with `campaign_id` NULL possible (campaign deleted) (`schema.sql:209`).
- Campaign body is compiled again at start; template syntax errors surface at send time as pipe creation failure that leaves the campaign `running` but unprocessed (`manager.go:462-465`: `newPipe` error logs and `continue`s every 5 s; inferred loop).
- Subject limit 5000 chars (template logic) (`campaigns.go:~700`).
- Concurrency/rate changes require restart (Listmonk returns `needs_restart` from settings PUT; OVELIO checks it, `index.ts:984`).
- Media: filesystem or S3, extension allow-list, thumbnail for raster formats (`LM:cmd/media.go:42-100`).

---

## 3. Better-than opportunities (grounded in weaknesses seen)

1. **Per-domain, per-IP throttling and warm-up**. Listmonk only has a global per-worker 1 s burst limiter and one global sliding window that sleeps the single feeder for all campaigns (`manager.go:505-510`, `pipe.go:112-135`). Own a token-bucket per recipient domain (gmail.com, outlook.com...) and per sending identity, with warm-up ramps and automatic back-off on 4xx deferrals.
2. **Real send retries and a durable queue**. Failures are dropped and the checkpoint can skip them (`pipe.go:200`, `campaigns.sql:367-372`); `RequeueOnError` is dead code (`manager.go:139`). Use a per-recipient outbox row with state (queued, sent, deferred, failed, bounced) and exponential retry; this also gives exact "delivered" counts, which OVELIO currently reports as null (`index.ts:349`).
3. **Delivered / deferred / complaint accounting**. Add provider webhooks and SMTP DSN parsing so `delivered`, `deferred`, `complaint rate`, `unsubscribe rate` exist. Listmonk reports none of these.
4. **Bounce ingestion that actually ships on**. OVELIO has no working source (2.9). Provide IMAP+POP mailbox, VERP return-path, and webhook adapters for SES/SendGrid/Postmark/Mailgun/Resend/Brevo with signature checks, behind the Caddy allow-list. Add reason codes (SMTP enhanced status, provider code) as first-class columns instead of free JSON meta, and a soft-bounce decay window (Listmonk counts lifetime soft bounces, `bounces.sql:11`).
5. **Bot-aware, unique engagement metrics**. Listmonk stores every hit (no uniqueness, `schema.sql:156-163`), has no Apple MPP or scanner filtering, and de-dups only in some queries (`campaigns.sql:234-246`). Add unique opens/clicks, bot/prefetch flagging (UA, timing after send, IP ranges), and "human clicks only" CTR.
6. **A/B and multivariate subject/content tests with auto-winner**. Absent in Listmonk. Split a list by hash of subscriber id, send test cohort, pick winner on opens or clicks after N hours, send the remainder. Fits the existing keyset batching (batch by id, then by variant).
7. **Send-time optimisation and timezone sends**. Use per-contact open history (from individual tracking) for best-hour and local-time delivery; Listmonk has only an absolute `send_at` and OVELIO schedules in device-local tz (`campaigns.tsx:1033-1066`).
8. **Engagement scoring written back to contacts**. Listmonk keeps views/clicks in separate tables and only offers per-subscriber activity (`subscribers.sql:435-471`). OVELIO can compute recency/frequency scores, sunset policies (auto-suppress after N non-opens), and push them to Mautic contact fields/segments so campaigns can target "engaged 30d". Closes the loop between delivery and the segment->list sync (`audience.ts:416-469`).
9. **Dynamic segment targeting at send time**. Listmonk campaigns target static lists only (`campaigns.sql:330-365`), forcing OVELIO's segment-to-list mirroring and sync jobs (`audience.ts:416-469`) which can lag. Native: resolve the segment predicate inside the batch query, with snapshot at start.
10. **Deliverability dashboard**. OVELIO already has SPF/DKIM/DMARC DNS checks (`reporting.ts:53-68`); add per-domain acceptance/deferral rates, blocklist (DNSBL) monitoring, FBL status, complaint rate vs 0.1% thresholds, and pre-send spam-score/link lint.
11. **Safer consent model than Listmonk**. OVELIO's per-RCPT consent gate (`smtp.ts:38-45`) already exceeds Listmonk (which mails `unconfirmed` on single opt-in lists, `campaigns.sql:359`). Keep as native pre-send filter, recording suppression reason per skipped recipient so "to_send vs sent" is explained.
12. **Merge-tag safety**. Provide a safe personalisation DSL (`{{first_name|default:"there"}}`) validated at save time, instead of either exposing full Go/Sprig (Listmonk's own docs warn of abuse, `templating.md:8`) or disabling it (OVELIO today).
13. **Rich per-link analytics**: all links (not top 50, `campaigns.sql:276`), heatmap, UTM auto-tagging joined with Umami sessions (OVELIO has Umami) for click -> conversion attribution.
14. **Exports scoped properly** (campaign and date range), streaming, with PII controls.

---

## 4. Native-rebuild notes (if OVELIO owns delivery)

**Tables** (Postgres, same DB as OVELIO core): `email_campaigns` (status, send_at, window, content, template_id, variant config, checkpoint), `campaign_audiences` (static list or segment ref + snapshot id), `outbox` (campaign_id, contact_id, email, variant, state, attempts, next_attempt_at, provider_msg_id, last_error, queued/sent/delivered_at; unique (campaign_id, contact_id)), `send_events` (outbox_id, type: accepted/deferred/delivered/bounced/complaint/open/click/unsubscribe, ts, meta JSONB, is_bot), `links` (campaign-scoped, short code), `bounces` (type, enhanced status, provider code, source), `suppressions` (already exists, `migrations/001_core.sql:56`), `domain_stats`/`throttles` (domain, rate, window, backoff_until), `sending_identities` (from, SMTP pool or API creds, DKIM selector, daily cap, warm-up stage), `templates`, `media`.

**Queues/algorithms**:
- *Planning*: on start, materialise recipients into `outbox` in id-ordered chunks (INSERT ... SELECT with keyset on contact id, suppression filter), so pause/resume is trivial (state per row) and counts are exact. Avoid Listmonk's pre-advanced checkpoint (2.3).
- *Dispatch*: `SELECT ... FOR UPDATE SKIP LOCKED` workers claim rows whose `next_attempt_at <= now` and whose domain bucket has tokens; per-identity and per-domain token buckets in Postgres (or Redis if added); SMTP connection pool per identity with keep-alive (OVELIO's relay currently builds a nodemailer transport without `pool: true`, `delivery.ts:172-182`, so each message likely opens a new connection - inferred).
- *Classification*: SMTP reply codes -> sent / deferred (4xx, retry with backoff up to 72 h) / hard fail (5xx); map enhanced status codes; write bounce row and apply action table (soft N within window, hard 1, complaint 1).
- *Tracking*: signed opaque ids (HMAC of campaign+contact) rather than raw UUIDs; pixel and redirect endpoints that write `send_events` asynchronously and always return fast; flag bots; unique indexes on (outbox_id, type, bucket).
- *Auto-pause*: error-rate guard per campaign and per domain rather than a flat 1000 errors (`schema.sql:238`).
- *Unsubscribe*: RFC 8058 endpoint with signed token, POST idempotent; write into `suppressions` (already the authority, `scripts/smtp.ts:63-66`).

**Hardest parts**: (1) per-domain adaptive throttling and reputation handling; (2) reliable bounce/complaint ingestion across providers incl. DSN parsing and VERP; (3) exactly-once-ish semantics under crashes (outbox + idempotent provider calls, Message-Id reuse); (4) bot-filtered unique engagement metrics at volume (partitioned event tables, rollups instead of Listmonk-style COUNT scans, `campaigns.sql:123-132`); (5) segment-at-send correctness with concurrent contact changes (snapshot vs live); (6) safe templating (sandboxed, no Sprig); (7) migration of existing Listmonk data (links, views, subscriber_lists, bounces) without losing history.

---

## 5. Unknowns and limitations

- Nothing executed; no live Listmonk instance. Settings keys that OVELIO leaves untouched (individual_tracking, disable_tracking, concurrency, message_rate, sliding window, notify_emails, domain lists) are assumed to hold install defaults (`schema.sql:235-262`) unless the init script or env sets them. Not checked: `deploy/listmonk-init.sh` only installs; compose env `LISTMONK_*` only sets app/db addresses (`compose.yaml:89-98`). Compose may inject other settings via env overrides I did not read to the end.
- I did not read `cmd/settings.go` validation fully, `subscribers.go` handlers in full, `cmd/media.go` S3 paths, `internal/subimporter` row-level logic, or `frontend/` (UI behaviour is taken from docs and routes, not from Vue code). The operator UI list (2.12) is therefore from handlers, settings and docs.
- Rate-limit behaviour (burstiness, feeder stalls) and the checkpoint gap semantics (2.3) are inferred from reading the code paths; I have not confirmed them with a test run.
- Claim that bounces are empty in a stock OVELIO deployment relies on not finding any bounce source config; a Mautic-side or SES-side integration outside the files I read could exist. Grep of OVELIO src/deploy for `webhooks/service`, `bounce.mailboxes` returned nothing.
- The `{{` escaping finding (row 8) is established at the code level (`delivery.ts:17,51`); whether the rendered email shows a literal `{{ .Subscriber.FirstName }}` is inferred (entity-encoded braces render as text). `campaigns.tsx` also offers the starter layout containing the tag (`:83,95`).
- Blocklist-all bug (row 16) is established from upstream SQL/handler of the pinned version and OVELIO's call site; OVELIO's route then reports `blocklisted: ids.length` (`route.ts:537-538`), which is false.
- "Delivered" semantics: Listmonk's `sent` means SMTP accepted by the next hop (here OVELIO's gateway, which only returns 250 after relaying, `smtp.ts:60-69`); it is not mailbox delivery.
- OVELIO's gateway runs `checkRecipient` twice per recipient (RCPT then DATA), each hitting Postgres and the Mautic and Listmonk APIs (`smtp.ts:15-19,38-45,57`, `audience.ts:471-491`). Throughput impact is inferred, not measured.
- Mautic and Umami analysis is out of scope; roles/permissions (`LM:cmd/roles.go`), OIDC, and i18n skipped.
