# 01 - Mautic 7.2.2 contacts, segments, scoring vs OVELIO

Scope: LeadBundle (contacts, segments, filters, companies, fields, tags, DNC, import/export, merge, timeline), PointBundle, StageBundle.
Paths: `M:` = `.refs/mautic/app/bundles`, `O:` = `OVELIO`. Line numbers are as read; "inferred" marks anything not directly shown by code.

Shorthand for OVELIO files: `idx` = `O:src/server/mautic/index.ts`, `norm` = `O:src/server/mautic/normalize.ts`, `aud` = `O:src/server/audience.ts`, `ui` = `O:src/components/audience.tsx`, `route` = `O:src/app/api/console/[...path]/route.ts`.

---------------------------------------------------------------------------------------------------

## 1. Gap table

Status key: exposed = usable end to end in OVELIO; partial = some of it; missing = nothing.

| # | Capability | Mautic mechanism (one line) | OVELIO today | Pri | Eff |
|---|---|---|---|---|---|
| 1 | Contact CRUD, core fields | `leads` row + one real column per custom field; REST `/contacts`, `/contacts/new`, `/{id}/edit` | exposed for 9 core fields only (email, first/last, company, phone, position, city, country, website): `idx:93-111`, `aud:494-507`, `route:131-172` | P0 | S |
| 2 | Custom field VALUES on contacts | `leads.<alias>` columns, `fields.all` in API | **missing**: `toContact` reads only 9 core keys (`norm:74-103`), `contactPayload` writes only those (`idx:93-111`), `contactFields` zod has no custom keys (`aud:494`). Custom fields can be defined (`ui:693-945`, `idx:1017-1064`) but never filled or read | P0 | M |
| 3 | Custom field definitions | `lead_fields` (18 types, group, unique-id, listable, visible, required, index, char limit, order); column created sync or by cron | partial: CRUD for 15 types, 4 groups, required, publicly-updatable, options (`ui:57-86`, `idx:1025-1062`). Missing types: `lookup`, `time`, `html`; missing flags: isUniqueIdentifer, isListable, isVisible, isShortVisible, isIndex, order, charLengthLimit | P1 | S |
| 4 | Contact list: search, filter, sort, pagination | `GET /contacts` with `search` command grammar (27 commands, `LeadRepository.php:1021-1052`), `where[]`, `orderBy`, `limit` | partial: free text + `segment:` + `tag:` only, fixed order date_added DESC, forced `date_identified NOT NULL` (anonymous hidden), page size capped 100 (`idx:370-394`, `route:131-136`) | P0 | M |
| 5 | Segment CRUD + filter builder | `lead_lists.filters` serialized array; `/segments` REST | partial: CRUD + 6 fields x 6 operators + flat AND/OR (`ui:96-112`, `ui:304-410`, `route:53-60,301-307`) | P0 | M |
| 6 | Segment filter FIELD coverage | ~55 filter keys: contact fields, company fields, dates, tags, segments, campaigns, stage, DNC x6, devices x4, UTM x5, email/page/form/asset/SMS behaviors, point groups | missing beyond email, company, country, city, points, tags (`ui:96-103`). No custom fields, no behaviors, no DNC, no stage, no segment-in-segment | P0 | L |
| 7 | Segment OPERATORS per type | 24 operator keys; type to operator matrix (`OperatorListTrait.php:12-`) | partial: like, eq, neq, gt, lt, in (`ui:105-112`). Missing: gte, lte, empty, !empty, !like, between, !between, regexp, !regexp, startsWith, endsWith, contains, !in, in_all, !in_all, inLast, inNext, date. UI offers operators regardless of field type (e.g. `like`/`gt` on tags, inferred invalid) | P0 | M |
| 8 | Relative-date filters | `DateOptionFactory`: today/yesterday/tomorrow, week/month/year this/last/next, "-5 days", anniversary/birthday, first/last day of | missing | P1 | M |
| 9 | Segment REBUILD (membership materialisation) | `mautic:segments:update` cron; `lead_lists_leads` rows; batch 300 default; add + remove passes | indirect only: OVELIO never triggers or observes a rebuild (`grep` finds no `segments:update`; schedule is inside the unseen Mautic image, `compose.yaml:247-262`). `lastBuiltDate/lastBuiltTime` not read | P0 | M |
| 10 | Segment member COUNT / preview | `lead_lists_leads` count, cached 12 h (`LeadBundle/Config/config.php:336`); `getTotalLeadListLeadsCount` | missing: `Segment` type has no count; `toSegment` ignores it (`norm:140-153`). No "preview matches" before save | P0 | M |
| 11 | Manual segment membership | `manually_added` / `manually_removed` flags survive rebuild | exposed: add/remove (`idx:524-530`, `aud:309`, `route:179-182`), bulk add (`aud:277-307`). Flags/rebuild semantics not shown to operator | P1 | S |
| 12 | Segment dependency (segment-in-segment), preference-center / global flags, delete-in-use guard | `leadlist` filter, `is_global`, `is_preference_center`, `SegmentInUse` validator | partial: `isGlobal` read only (`norm:149-151`); nothing else | P1 | M |
| 13 | Tags | `lead_tags` + `lead_tags_xref`; `-tag` removes; REST `/tags` | exposed: list/create/delete, per-contact via `tags` array with `-tag` diff (`idx:408-421,532-547`, `route:329-336`). No tag rename/edit, no usage counts | P0 | S |
| 14 | Bulk contact actions | UI batch: segment add/remove, campaign add/remove, stage, owner, tags, DNC, delete, export | partial: 4 actions, max 100 ids, N+1 sequential REST calls (`route:142-151`, `aud:277-307`) | P1 | M |
| 15 | Lifecycle stages | `stages` (name, weight) + `leads.stage_id` + `lead_stages_change_log`; set via REST, campaign action, point trigger, import | exposed: CRUD, set/clear per contact (`idx:549-589`, `route:199-207`, `route:338-348`). No stage-change history view, no stage filter in segments, no stage bulk action | P0 | S |
| 16 | Companies (B2B) | `companies` + `companies_leads` (is_primary) + company fields (`company*` aliases) + company score; REST `/companies` | partial: 6 company fields, link contact (`idx:591-614`, `route:349-366`). Missing: company custom fields, unlink, primary flag set, company merge (`CompanyModel.php:660`), company filters in segments, company score, company dedupe | P1 | M |
| 17 | Lead scoring: manual adjust | `POST /contacts/{id}/points/{plus,minus,times,divide,set}/{n}` + `lead_points_change_log` | partial: plus/minus only, +/-10000 (`idx:438-449`, `route:191-198`). Missing times/divide/set; no points history UI | P0 | S |
| 18 | Lead scoring: point ACTIONS (rules) | `points` table: type, delta, repeatable, group, `properties` (which page/email/form/asset/url); engine `PointModel::triggerAction` (`PointModel.php:173-300`) | partial/weak: create name/type/delta/published only (`idx:636-647`, `route:370-381`). Cannot set `properties`, `repeatable`, `group`, publish dates, category. A rule with no `properties` means "any" page/email/form (inferred from `PointActionHelper.php:29-35`) | P0 | M |
| 19 | Point action TYPES | 6 in core: `email.open`, `email.send`, `form.submit`, `page.hit`, `url.hit`, `asset.download` | partial: types fetched live (`idx:620-634`) but UI fallback lists 5 and omits `email.send` (`ui:115-121`) | P1 | S |
| 20 | Point TRIGGERS (threshold events) | `point_triggers` + `point_trigger_events` (type, order, properties) + `lead_trigger_log`; fire when points >= threshold | **partial and effectively inert**: trigger CRUD exists but `createPointTrigger`/`updatePointTrigger` never send `events` (`idx:672-695`); read-side normalises events (`norm:198-214`). A trigger with zero events does nothing. No color, no group, no publish dates | P0 | M |
| 21 | Trigger EVENT types | 7: `lead.changelists`, `lead.changetags`, `lead.changestage`, `email.send`, `email.send_to_user`, `campaign.changecampaign`, `plugin.leadpush` | missing (no UI/API to add events; `/points/triggers/events/types` not called) | P0 | M |
| 22 | Point groups (multi-score) | `point_groups`, `point_group_contact_score`, group-scoped actions/triggers, `group_points_<id>` segment filter | missing | P1 | M |
| 23 | Point insights | `point_insights` (compare_point_groups, writes result to custom field) | missing | P2 | S |
| 24 | Score decay / expiry | **none in core** (no decay/expire in PointBundle: grep empty) | missing (same as Mautic) | P1 (differentiator) | M |
| 25 | Do-not-contact | `lead_donotcontact` (lead, channel, reason 1 unsub/2 bounce/3 manual, comments); REST `/dnc/{channel}/add|remove` | partial: add email DNC (reason map `idx:43`, `idx:427-436`), no DNC removal, no per-channel (SMS), no comments surfaced; `suppressed` = any email DNC regardless of reason (`norm:100-101`). Parallel OVELIO `suppressions` + `consent_events` tables (`migrations/001_core.sql`) | P0 | M |
| 26 | DNC as segment filter (6 keys) | `dnc_bounced|unsubscribed|manual` x `email|sms` | missing | P0 | S |
| 27 | Contact timeline | `TIMELINE_ON_GENERATE`, ~25 event types, filter by type/search/date, paged, export | partial: last 25 events unfiltered, label+time only (`idx:491-500`, `ui:2005-2008`) | P0 | M |
| 28 | Contact notes | `lead_notes` (text, type, dateTime); REST `/notes` | exposed (`idx:451-469`, `route:208-219`) | done | - |
| 29 | Devices, IPs, UTM tags | `lead_devices`, `lead_ips_xref`, `lead_utmtags` | partial: devices read (`idx:1237`); IPs/UTM missing | P2 | S |
| 30 | Import | CSV wizard (field mapping, owner, segment, tags, skip-if-exists, create-new, delimiter), queued/background, `mautic:import` cron, per-row failure log | partial: synchronous, fixed header names, max 500 rows, sequential, per-row error list (`aud:509-548`). No mapping UI, no async progress, no segment/owner/stage/points columns, no update-vs-skip choice | P0 | M |
| 31 | Export | `contact_export_scheduler` + `mautic:contacts:scheduled_export` (background, notify admin), filtered by current list | partial: whole-DB CSV, hard cap 10,000, 10 columns, no filter/segment scope, no custom fields (`aud:550-575`) | P1 | M |
| 32 | Merge / dedupe | `ContactMerger` (winner/loser), `mautic:contacts:deduplicate`, unique-identifier fields, `merge_records` | **missing**; `findContact` throws 409 on duplicate email and tells operator to merge elsewhere (`idx:396-406`). No REST merge endpoint exists in Mautic (no route in `LeadBundle/Config/config.php`) so wrapping cannot do it | P0 | L |
| 33 | GDPR erase / export one contact | delete contact (cascade) | exposed and stronger than Mautic (consent evidence, queued erase) (`aud:360-393,577-583`) | done | - |
| 34 | Contact owner, frequency rules, channel prefs, preferred locale | `leads.owner_id`, `lead_frequencyrules` | missing | P2 | M |
| 35 | Contact campaign membership | `/contacts/{id}/campaigns` | exposed read (`idx:471-476`) | done | - |
| 36 | Segment to newsletter-list sync | n/a (OVELIO-specific, Listmonk) | exposed: `segment_lists`, `segment_sync` job (`aud:408-437`) | done | - |

---------------------------------------------------------------------------------------------------

## 2. Mechanism deep dives

### 2.1 Contact data model

Established by code:
- `leads` table (`M:LeadBundle/Entity/Lead.php:298-446`): `id`, `owner_id` (user), `points` int, `last_active`, `date_identified` (null = anonymous visitor), `date_added`, `date_modified`, `stage_id`, `internal`/`social_cache` arrays, `preferred_profile_image`, plus ONE REAL COLUMN PER CUSTOM FIELD (see 2.6). Indexes on date_added, date_modified, date_identified, last_active (`Lead.php:305-308`).
- Relations: `lead_tags_xref` (m2m tags, `Lead.php:403`), `companies_leads` (`CompanyLead.php`, `is_primary`), `lead_donotcontact` (1:n, `Lead.php:336`), `lead_ips_xref`, `lead_notes`, `lead_points_change_log`, `lead_stages_change_log`, `lead_utmtags`, `lead_devices`, `lead_frequencyrules`, `lead_event_log`, `lead_lists_leads`, `point_group_contact_score`.
- `lead_lists_leads`: `lead_id`, `leadlist_id`, `manually_added`, `manually_removed`, `date_added`; indexes `(lead_id, leadlist_id, manually_removed)` (`ListLead.php:46-68`).
- Anonymous vs identified: `date_identified` NOT NULL = known contact. OVELIO forces this filter (`idx:392`), so cookie-only visitors never appear (good for a CRM view; but they are scoreable in Mautic and may later merge into a known contact).

REST (all under `/api`, `M:LeadBundle/Config/config.php:155-282`): `/contacts` (standard CRUD + batch), `/contacts/{id}/dnc/{channel}/add|remove`, `/activity`, `/notes`, `/devices`, `/campaigns`, `/segments`, `/companies`, `/utm/add|{utmid}/remove`, `/contacts/list/owners|fields|segments`, `/segments` (+ `/{id}/contact/{leadId}/add|remove`, `/{id}/contacts/add`), `/companies` (+ `/{cid}/contact/{id}/add|remove`), `/fields/{object}`, `/notes`, `/devices`, `/tags`. Points: `/contacts/{id}/points/{operator}/{delta}` (`M:PointBundle/Config/config.php:72`), `/points`, `/points/triggers`, `/points/actions/types`, `/points/triggers/events/types`, `/points/triggers/{id}/events/delete`, `/points/groups`, `/contacts/{id}/points/groups[/{gid}[/{op}/{v}]]`, `/points/insights`. Stages: `/stages` + `/stages/{id}/contact/{cid}/add|remove` (`M:StageBundle/Config/config.php:21-30`).
- `contact_api_count_cache_ttl` = 5 s (`LeadBundle/Config/config.php:334`); `segment_api_count_cache_ttl` = 43200 s = 12 h (`:336`). So segment counts read through the API can be up to 12 h stale (inferred meaning of the parameter name).
- No REST route for merge, dedupe, import, or export (absent from config.php route list).

OVELIO read/write path: `idx:312-314` `contact()`, `idx:370-394` list (one `search` string; filters concatenated as `segment:"alias" tag:"x" "term"`; quotes stripped), `idx:396-406` exact-email lookup via `where[l.email eq]` with 409 on duplicates. Lookup is done under a global advisory lock `64337002` in `saveContact` (`aud:136-169`), serialising all contact writes in the app.

### 2.2 Segment filter to SQL (core algorithm)

Storage: `lead_lists.filters` is a serialized PHP array of filter rows `{glue, field, object (lead|company), type, operator, properties{filter, display}}` (`LeadList.php:149-152`; API BC shim moves top-level `filter` into `properties.filter`, `Controller/Api/ListApiController.php:71-95`). OVELIO sends both forms (`idx:113-122`).

Pipeline (`M:LeadBundle/Segment/`):
1. `ContactSegmentFilterFactory` builds a `ContactSegmentFilter` per row; `Decorator/DecoratorFactory.php:25-60` picks the decorator: plugin override event; date type -> `DateOptionFactory` decorators (relative dates); field present in `ContactSegmentFilterDictionary` -> `CustomMappedDecorator`; `object=company` -> `CompanyDecorator`; else `BaseDecorator` (assumed `leads.<field>` column; unknown field = `FieldNotFoundException`, rebuild silently returns 0, `ListModel.php:401-412`).
2. Operator is normalised by `ContactSegmentFilterOperator::fixOperator` through the 24-entry table in `OperatorOptions.php:60-190` (`=`->eq, `!=`->neq, `gt`, `gte`, `lt`, `lte`, `empty`, `!empty`->notEmpty, `like`, `!like`->notLike, `between`, `!between`, `in`, `!in`->notIn, `in_all`, `!in_all`, `regexp`, `!regexp`->notRegexp, `date`, `startsWith`, `endsWith`, `contains`, `inLast`, `inNext`). Unknown operators pass through unchanged, which is why OVELIO's `eq`/`neq` work.
3. Query-builder service is chosen per dictionary entry (`Services/ContactSegmentFilterDictionary.php:56-250`, services registered `Config/services.php:182-195`):
   - `BaseFilterQueryBuilder`: direct predicate on `leads` column; operators dispatched via the `LIST_FILTERS_OPERATOR_QUERYBUILDER_ON_GENERATE` event, handled in `EventListener/SegmentOperatorQuerySubscriber.php` (empty :29, notEmpty :49, negative :69, multiselect :114, defaults :171); unhandled operator throws "Dunno how to handle operator" (`BaseFilterQueryBuilder.php`).
   - `ForeignValueFilterQueryBuilder`: `EXISTS` / `NOT EXISTS` sub-select on a child table (`lead_tags_xref`, `lead_lists_leads`, `lead_devices`, `page_hits`, `email_stats`, `lead_utmtags`, `lead_categories`, `campaign_leads`, `asset_downloads`, `push_ids`). Negative operators (`neq`, `notIn`, `notLike`, `notRegexp`, `empty`) become `NOT EXISTS`/`NOT IN` (`ForeignValueFilterQueryBuilder.php:49-161`), so "tag is not X" matches contacts with NO tag rows at all.
   - `ForeignFuncFilterQueryBuilder`: aggregate sub-select (`sum(email_stats.open_count)` for `lead_email_read_count`, `count(page_hits.id)` for `hit_url_count`, `max(date_read)` for `lead_email_read_date`), with `null_value` 0.
   - `DoNotContactFilterQueryBuilder`: IN/NOT IN on `lead_donotcontact` by reason+channel parsed from the key name (`DoNotContactParts.php`: `_manual`->3, `_bounced`->2, default unsubscribed 1; `_sms` channel).
   - `ChannelClickQueryBuilder` (email/sms link clicks), `SessionsFilterQueryBuilder` (visit sessions), `IntegrationCampaignFilterQueryBuilder`, `ComplexRelationValueFilterQueryBuilder`.
4. Glue: `QueryBuilder::addLogic` (`Query/QueryBuilder.php:386-426`) keeps a "logic stack". AND rows append to the current group; an OR row flushes the stack as `(a AND b)` and starts a new group; final `applyStackLogic` ORs the groups. Result is a flat disjunctive normal form, precedence AND over OR, **no parentheses or nesting**. OVELIO's flat rule list with and/or glue maps exactly onto this (`ui:304-366`).
5. Segment dependencies: `getResolutionPlan` (`ContactSegmentQueryBuilder.php:255-282`) validates circular `leadlist` references.
6. Rebuild-time restrictions (`ContactSegmentQueryBuilder.php:137-200`): "new members" query = filter result AND `leads.id NOT IN (SELECT lead_id FROM lead_lists_leads WHERE leadlist_id=:id)`; `addManuallySubscribedQuery` ORs in `EXISTS(manually_added=1 ...)`; `addManuallyUnsubscribedQuery` left-joins `manually_removed=1` rows so manually removed contacts are excluded.

### 2.3 Complete filter catalogue (what a native rebuild must match)

Contact-type operators (`Entity/OperatorListTrait.php:12-`, aliasing in `EventListener/TypeOperatorSubscriber.php:70-95`):

| Field type | Operators |
|---|---|
| text, lookup, email, url, tel | `=`, `!=`, empty, !empty, like, !like, regexp, !regexp, startsWith, endsWith, contains; in segments also `in`, `!in` (`FilterOperatorSubscriber.php:528-553`) |
| select, country, region, timezone, locale | `=`, `!=`, empty, !empty, regexp, !regexp, in, !in |
| boolean | `=`, `!=` |
| number / default | `=`, `!=`, gt, gte, lt, lte, empty, !empty, like, !like, between, !between, regexp, !regexp, startsWith, endsWith, contains |
| multiselect (also tags, leadlist) | in, !in, in_all, !in_all, empty, !empty |
| date, datetime | `=`, `!=`, gt, gte, lt, lte, empty, !empty, like, !like, between, !between, regexp, !regexp, date, startsWith, endsWith, contains; **+ inLast, inNext in segment context** (`TypeOperatorSubscriber.php:78-81`) |
| lookup_id (owner) | `=`, `!=`, empty, !empty |
| behavior text | `=`, `!=`, like, !like, regexp, !regexp, startsWith, endsWith, contains (`FilterOperatorSubscriber.php:41-51`) |
| behavior number | `=`, gt, lt, gte, lte (`:34-40`) |
| behavior datetime | `=`, `!=`, gt, lt, gte, lte; + inLast, inNext (segment) (`:26-33`, `:561-569`) |
| behavior "email received/sent" | in, !in, in_all, !in_all (`:52-57`) |

Filter field categories (`FilterOperatorSubscriber.php`; dictionary entries in `ContactSegmentFilterDictionary.php`):
- **Contact custom/core fields**: every published, *listable* `lead_fields` row, object `lead` or `company` (`:91-122`).
- **Static contact**: `leadlist` (segment membership, `:125-146`), `date_added`, `date_identified`, `last_active`, `date_modified` (datetime), `owner_id` (lookup_id), `points` (number), `campaign` (membership), `tags`, `stage`, `globalcategory`, device `device_type|device_brand|device_os|device_model`, UTM `utm_campaign|content|medium|source|term` (`:149-347`).
- **DNC (boolean, 6 keys)**: `dnc_bounced`, `dnc_unsubscribed`, `dnc_manual_email`, `dnc_bounced_sms`, `dnc_unsubscribed_sms`, `dnc_manual_sms` (`:243-295`).
- **Behaviors group** (`:357-518`): `lead_asset_download`, `lead_email_received` (read), `lead_email_sent`, `lead_email_sent_date`, `lead_email_read_date`, `lead_email_read_count`, `hit_url`, `hit_url_date`, `hit_url_count`, `email_id` (clicked link in email, boolean), `email_clicked_link_date`, `sms_clicked_link`, `sms_clicked_link_date`, `sessions`, `referer`, `url_title`, `source`, `source_id`, `notification`, `page_id`, `redirect_id`. Form submission is not a filter key in this list (form data is reachable via custom field values or the `form` search command; inferred).
- **Point groups**: `group_points_<groupId>` (number) under "groups" (`M:PointBundle/EventListener/SegmentFilterSubscriber.php:34-60`).
- **Company object**: company fields via `CompanyDecorator`; date company via `DateCompanyDecorator` (`DecoratorFactory.php:35-48`).
- **Integration**: `integration_campaigns`.
- Relative-date values (`Decorator/Date/DateOptionFactory.php:46-90`): `today`, `tomorrow`, `yesterday`, `week_last|this|next`, `month_last|this|next`, `year_last|this|next`, `birthday`/`anniversary`, relative strings (`-5 days`, `+2 weeks`), `first day of ...`, `last day of ...`, `... ago`. Timezone resolution in `Date/TimezoneResolver.php`.

### 2.4 Segment rebuild: jobs, batching, schedule

- Command `mautic:segments:update` (alias `mautic:segments:rebuild`), `Command/UpdateLeadListsCommand.php`. Options: `--batch-limit/-b` (default 300), `--max-contacts/-m`, `--list-id/-i`, `--timing`, `--exclude/-d` (repeatable), plus `ModeratedCommand` lock flags (`--force`, `--bypass-locking`, quiet).
- Order: with no `--list-id`, iterates all lists; for each list first rebuilds `leadlist` dependencies recursively, tracks already-rebuilt IDs, prints and skips on circular chain (`:100-260`). Unpublished segments skipped (`:rebuildSegment`).
- `ListModel::rebuildListLeads($list, $limit=100, $max, $output)` (`Model/ListModel.php:383-589`):
  1. `batchLimiters.dateTime = now` (ignore contacts added after start).
  2. Count of new members; freeze `maxId`; loop `while start < count`: `batchSleep()` (config `batch_lead_sleep_time` else `batch_sleep_time`, **default 1 s per batch**, `ListModel.php:916-930`, `CoreBundle/Config/config.php:698`), fetch `limit` IDs, `addLead` each (row insert with `manually_added=0`), dispatch `LEAD_LIST_BATCH_CHANGE`.
  3. Then orphan pass: count members who no longer match (excluding `manually_added`), loop `removeLead` in batches.
  4. `finishRebuild` refreshes the cached count, sets `last_built_date` only if no work remains, else nulls it (`:591-603`). `last_built_time` stored by the command (`UpdateLeadListsCommand.php:249-260`); warning threshold `segment_rebuild_time_warning`=30 (`LeadBundle/Config/config.php:357`).
- Companion commands: `lead:list:count-cache-update` (`SegmentCountCacheCommand.php`, recount flagged segments), `mautic:segment:delete` (`DeleteLeadListsCommand`, background delete when `delete_segment_in_background`), `mautic:segments:stat` (`SegmentStatCommand`).
- **Nothing recomputes membership on contact change.** Only the cron path calls `rebuildListLeads` (grep: callers are the command and a fixture). Therefore: after an API segment create/edit, or after any contact edit, membership is stale until the next cron tick. Cron cadence is configured inside the Mautic image (`compose.yaml:247-262` runs a `mautic_cron` role) and is not visible in the repo: **unknown**.
- OVELIO consequence: `contacts({segmentId})` is `search=segment:"alias"` = a read from `lead_lists_leads` (`idx:380-385`), `syncSegment` pages through that (`aud:416-437`), and `contactSegments` uses `/contacts/{id}/segments` (`idx:482-485`). All of it inherits cron staleness; OVELIO has no "rebuild now", no progress, no last-built display.

### 2.5 Tags, stages, companies

- Tags: `lead_tags(id, tag)`; contact modification tag strings, a leading `-` removes (`idx:411-415` relies on this). `modifyTags` is used by merge, import (`|`-separated, `LeadModel.php` import ~l.1509), campaign actions and point trigger `lead.changetags` (`PointBundle...LeadBundle/EventListener/PointSubscriber.php:47-52,81-90`). Orphan tags are not auto-deleted (inferred).
- Stages: `stages(id, name, weight, description, publish dates)`, `leads.stage_id`, `lead_stages_change_log(lead, stage, eventName, actionName, dateAdded)` (`StagesChangeLog.php:47-63`). Stage can be set by: REST add/remove, campaign action, form action, point trigger `lead.changestage` (`LeadBundle/EventListener/PointSubscriber.php:55-68`), import (creates a missing Stage by name, `LeadModel.php:1438-1460`). Nothing in core auto-advances by weight; weight is only an ordering hint (inferred; no consumer found). Stage timeline type `stage.changed`.
- Companies: `companies` (fixed columns plus company custom fields `company*`, `score`, owner), `companies_leads(is_primary)`. Contact `company` field is a string; `CompanyModel::addLeadToCompany` (`:278`) creates/links company rows from it and manages primary; `companyMerge($main,$sec)` (`:660`); `CompanyDeduper::checkForDuplicateCompanies`; commands `mautic:company:update_lead_company`, `mautic:company:delete_company_leads`, `mautic:contact:delete:secondary-companies`. Company import shares the contact import pipeline (`extractCompanyDataFromImport :745`).

### 2.6 Custom fields

- `lead_fields`: label, alias, type, field_group, default_value, is_required, is_fixed, is_visible, is_short_visible, is_listable, is_publicly_updatable, `is_unique_identifer` (sic), is_index, char_length_limit, field_order, `object` (lead|company), properties (select option list, boolean yes/no labels), plus `column_is_not_created` and `column_is_not_removed` flags (`LeadField.php:219-304`).
- 18 field types: text, textarea, multiselect, select, boolean, lookup, date, datetime, time, timezone, email, html, number, tel, url, country, region, locale (`Helper/FormFieldHelper.php:11-90`).
- A field is a real SQL column on `leads`/`companies` (`Field/CustomFieldColumn.php`, `SchemaDefinition.php`). Column creation can run in background via `mautic:custom-field:create-column`, `:update-column`, `:delete-column` when the `create_custom_field_in_background` setting is on (`Field/Settings/BackgroundSettings.php`); until it runs, `column_is_not_created=1` and the field is unusable. `mautic:fields:analyse`, `mautic:fields:modify` are maintenance commands.
- Wide-table implication: filtering and export are cheap on indexed columns, but adding fields alters a large table (online DDL) and MySQL row-size limits apply (inferred; relevant to a native rebuild).
- Unique-identifier fields drive duplicate detection at create/import/form time (`LeadModel::checkForDuplicateContact`, `LeadModel.php:875-925`, uses `FieldsWithUniqueIdentifier`; default is email).

### 2.7 Do-not-contact

- `lead_donotcontact(lead_id, channel, channel_id, reason, comments, date_added)`; reasons `UNSUBSCRIBED=1`, `BOUNCED=2`, `MANUAL=3`, `IS_CONTACTABLE=0` (`Entity/DoNotContact.php:17-32`); index `(lead_id, channel, reason)`.
- Model `Model/DoNotContact.php`: `addDncForContact`, `removeDncForContact`, `isContactable`, `createDncRecord`, `updateDncRecord`. REST add/remove per channel (`/contacts/{id}/dnc/{channel}/add|remove`).
- Channel-specific: email vs sms vs others; a contact can be DNC on email but contactable by SMS. Import can set `doNotEmail` (`LeadModel.php` ~l.1475-1490, MANUAL).
- OVELIO mapping: `unsubscribe:1, bounce:2, complaint:3, erasure:3` (`idx:43`); complaint/erasure are indistinguishable from manual in Mautic. `suppressed` is true for any email-channel DNC row (`norm:100-101`); OVELIO's source of truth for sending is its own `suppressions`/`contact_state` (`aud:471-492`), with propagation job `suppress` (`aud:395-406`).

### 2.8 Scoring engine

Data (`M:PointBundle/Entity`): `points(id, name, type, delta, repeatable, properties[], publish_up/down, category, group_id)`; `lead_points_change_log(lead, type, event_name, action_name, delta, ip, group, date_added)`; `point_lead_action_log(point, lead, date_fired)` (one-time guard); `point_triggers(name, points, color, trigger_existing_leads, group)`; `point_trigger_events(trigger, type, order, properties)`; `point_lead_event_log` / `LeadTriggerLog` (applied events); `point_groups`, `point_group_contact_score(contact, group, score)`; `point_insights`.

Awarding algorithm (`Model/PointModel.php:173-300`):
1. Subscribers call `triggerAction($type, $eventDetails, $typeId, $lead)` on: `email.open` (`EmailBundle/EventListener/PointSubscriber.php:89`), `email.send` (:97), `page.hit`, `url.hit` (PageBundle), `form.submit`, `asset.download`.
2. Guard: **only for anonymous (non logged-in) requests** unless `$allowUserRequest` (`:176`). In prod, per-session dedupe by `$typeId` (`:180-189`).
3. Load published rules of that type (`getPublishedByType`, honours publish_up/down), load already-completed one-time actions for the lead (`:211`).
4. For each rule: skip if non-repeatable and already logged (`:217`); call the type's validator callback (`PageBundle/Helper/PointActionHelper.php:17-36` page filter: empty `pages` = any; `:38-110` url_hit with wildcard `page_url`, `first_time`, `returns_within`, `returns_after`) or default `EventHelper::engagePointAction` (`PointBundle/Helper/EventHelper.php:16-31`, once per lead per type per request).
5. If valid: group rule -> `PointGroupModel::adjustPoints` (`:118-148`, ops plus/minus/times/divide/set), else `Lead::adjustPoints(delta)` (`Lead.php:808-852`, ops add/subtract/multiply/divide); write change log; dispatch `POINT_ON_ACTION`; if non-repeatable write `LeadPointLog`.
6. Save lead; `LEAD_POINTS_CHANGE` -> `PointBundle/EventListener/LeadSubscriber.php:43,52` -> `TriggerModel::triggerEvents`.
7. Manual / API / campaign "adjust points" bypass rules: `Lead::adjustPoints` + changelog (`Controller/Api/PointApiController.php:84-111`, operator route constants `Lead.php:59-67`).

Trigger firing (`Model/TriggerModel.php:387-423`, `Entity/TriggerEventRepository.php:21-39`): on each points change, select published trigger events whose trigger `points <= lead.points` (and group null), plus group-score triggers; skip events already in the lead's applied log; execute; log. So triggers are **threshold-crossing-or-above, once per contact per event**; if points later fall below, nothing reverses. `triggerExistingLeads` on save (`TriggerModel.php:106-188`) back-applies to contacts with `l.date_added <= trigger.date_added` and `l.points >= threshold` (or group score), excluding already-applied.

Trigger event types (7): `lead.changelists` (segment add/remove), `lead.changetags`, `lead.changestage` (`LeadBundle/EventListener/PointSubscriber.php:39-68`); `email.send`, `email.send_to_user` (`EmailBundle/.../PointSubscriber.php:72,83`); `campaign.changecampaign` (`CampaignBundle/.../PointSubscriber.php:31`); `plugin.leadpush` (`PluginBundle/.../PointSubscriber.php:32`). Point action types (6) listed in gap table row 19.

No decay, no cap, no per-period budget in core (grep for decay/expire in PointBundle returns nothing). Colour of trigger shown on contact via `getColorForLeadPoints` (`TriggerModel.php:430-443`).

Direct-DB note: `Lead::pointChanges` are applied as a SQL delta (`Lead.php:842-849` comment), so concurrent changes do not lose updates.

OVELIO: `adjustPoints` (`idx:438-449`), actions (`idx:616-664`), triggers (`idx:666-699`). Defect: `createPointTrigger` payload has no `events`, so UI-created triggers have nothing to fire (confirm by Mautic API behaviour; the code shows only the omission). `triggerExistingLeads` is sent but has no events to run.

### 2.9 Import

- Wizard: upload CSV, map columns to fields (unmapped skipped), choose default owner, segment, tags, "skip if exists", "create new" (`Form/Type/LeadImportFieldType.php`), delimiter/enclosure/escape/batchlimit config (`Controller/ImportController.php` ~l.334-342).
- Entity `Import`: status QUEUED 1, IN_PROGRESS 2, IMPORTED 3, FAILED 4, STOPPED 5, MANUAL 6, DELAYED 7; priority LOW 512, NORMAL 64, HIGH 1 (`Entity/Import.php:21-60`). Queue worker `mautic:import` (`--id`, `--limit`, `Command/ImportCommand.php:51-52`); parallel limit `parallel_import_limit`=1; `background_import_if_more_rows_than`=0 (always background) (`LeadBundle/Config/config.php:331-332`); ghost imports marked failed (`Model/ImportModel.php:121-135`).
- Row processing (`ImportModel::process :258-420`, `LeadModel::import :1332-1560`): extract company columns, `checkForDuplicateContact` on unique-identifier fields (merge into existing = update), set owner (`ownerusername` column), tags from `|`-list, points (only for new contacts), stage by name (auto-creates), `doNotEmail`, segments from wizard; per-row event log with error text (`LeadEventLog`), failed-rows download (`getFailedRows :541`), line chart of imported rows.
- OVELIO import (`aud:509-548`): 500 rows, header-normalised names, sequential `saveContact` (each takes the global advisory lock and makes 2+ REST calls, so about 0.3-1 s/row inferred), consent+evidence per row (OVELIO-specific and better for compliance), per-row failure array. No update/skip choice (always upsert by email), no async.

### 2.10 Export

- Scheduled/background: `contact_export_scheduler` rows, `mautic:contacts:scheduled_export`, `mautic:contacts:cleanup_exported_files`, `contact_export_in_background`=true, notify admins (`LeadBundle/Config/config.php:359-360`); download route `/contacts/export/download/{fileName}` (`:149-152`); single-contact export `/contacts/contact/export/{id}`; formats csv/xlsx (per-listing, inferred from scheduler entity).
- OVELIO: synchronous whole-table CSV, `escapeFormulae: true` (good CSV-injection defence), cap 10,000 (`aud:550-575`).

### 2.11 Merge / dedupe

- `ContactMerger::merge(winner, loser)` (`Deduplicate/ContactMerger.php`): pre-merge event; `updateMergeRecords` (move loser's earlier records, add `merge_records`), `mergeTimestamps` (later `last_active`; earlier `date_identified`), `mergeIpAddressHistory` (union), `mergeFieldData` (**newest-modified contact's value wins per field regardless of winner/loser**, `MergeValueHelper::getMergeValue`: use newer unless empty or default-on-anonymous, else older, else skip), `mergeOwners` (only if winner has none), `mergePoints` (**sum**), `mergeTags` (union), `mergeCompanies` (union; winner keeps primary); save winner; `LEAD_POST_MERGE` re-parents rows in every bundle (email_stats, page_hits, form_submissions, asset_downloads, campaign_leads, event log, stage log, points log, dynamic content: subscribers in Email/Page/Form/Asset/Campaign/Point/Stage/DynamicContent/Lead bundles); delete loser.
- `ContactDeduper` + command `mautic:contacts:deduplicate` (`--newer-into-older`, `--batch` 100, `--processes` 1) and `mautic:contacts:deduplicate:ids`. Detection = equality on all non-empty unique-identifier fields (`getLeadsByUniqueFields`, ordered `date_added DESC, id DESC`); by default, merges **older into newer** (the newest record survives) unless `--newer-into-older`.
- UI merge (contact detail "merge") exists in LeadController (not read in depth). **No REST endpoint**.
- OVELIO: none. Email uniqueness is enforced at write time (`aud:136-169`) but duplicates already in Mautic (form posts, imports through Mautic UI) block the contact with a 409 (`idx:396-406`).

### 2.12 Timeline

- `LeadModel::getEngagements` (`Model/LeadModel.php:2185-`) dispatches `TIMELINE_ON_GENERATE`; each bundle contributes types with filter, search, date range, paging and ordering. REST `GET /contacts/{id}/activity` accepts `filters[search|includeEvents|excludeEvents|dateFrom|dateTo]`, `order`, `page`, `limit` (`Controller/Api/LeadApiController.php:433-438`) and `/contacts/activity` for all contacts.
- Types registered: `lead.create`, `lead.identified`, `lead.ipadded`, `lead.apiadded`, `lead.utmtagsadded`, `lead.donotcontact`, `lead.imported` (`LeadBundle/EventListener/LeadSubscriber.php:320-376`), `form.submitted`, `asset.download`, `page.hit`, `page.videohit`, `email.sent|read|failed|bounced...` (state-parametrised, `EmailBundle/.../LeadSubscriber.php:54`), `email.replied`, `sms.*`, `message.queue`, `dynamic.content.sent`, `point.gained`, `stage.changed`, campaign events, integration events, plus generic event-log types (`TimelineEventLogTrait`).
- OVELIO: `limit=25`, no filters, shows only label and timestamp (`idx:491-500`). It ignores `eventType` details, so no deep links to the email/form/page.

### 2.13 Operator UI capabilities in Mautic worth matching

- Segment editor: field picker grouped (Lead / Company / Behaviors / Groups), type-aware operator list, value widget by type (lookup, select, multi-select, date relative), drag reorder, AND/OR glue, "Segment dependencies" display, per-segment "last built" and member count, "rebuild" on demand through CLI only, member list with search, "Public name", "Global", "Preference center", category, project assignment.
- Contact list: saved filters via search grammar, column picker (`contact_columns` default name/email/location/stage/points/last_active/id, `LeadBundle/Config/config.php:341-347`), batch actions, anonymous toggle, DNC filter, duplicate finder (`searchcommand.duplicate`).
- Contact detail: score badge coloured by trigger, stage, owner, tags, companies, segments, campaigns, timeline with filters, notes, UTM, devices, IPs, DNC toggle, frequency rules, merge, export, audit log.

---------------------------------------------------------------------------------------------------

## 3. Better-than opportunities

Grounded in weaknesses seen above:

1. **Live segment counts + preview (beats cron staleness).** Mautic membership is only materialised by `mautic:segments:update` with a 1 s sleep per 100-300-row batch and a 12 h API count cache (`ListModel.php:916-930`, `config.php:336`). OVELIO can (a) compile the same filter tree to SQL and run `COUNT(*)` on save (debounced, shows "~N contacts match" before saving), (b) evaluate membership incrementally on contact/event change (event-driven), keeping a materialised table only for performance. Even without a native rebuild, OVELIO can expose `last_built_date`, a "Rebuild now" action (`mautic:segments:update --list-id` via a worker if the worker can reach the Mautic container; unknown) and a stale-badge.
2. **Honest filter UX.** Operator list is currently field-agnostic (`ui:105-112`), so invalid combinations (tags + `like`/`gt`) are possible. Ship a field-type to operator matrix identical to Mautic's (table 2.3), typed value editors (multi-select for tags/segments/stages, date pickers with relative presets, numeric between), inline validation, and a plain-language summary ("Tag is any of A, B AND Score >= 50").
3. **Real nested groups.** Mautic is flat DNF with no parentheses (`QueryBuilder.php:386-426`). A tree (groups of AND/OR, NOT) is strictly more expressive and compiles to the same SQL; keep a flatten-to-Mautic export for the wrapping phase.
4. **Score decay and caps.** Core has none. Add: per-rule expiry ("+5 for page hit, decays after 30 days"), time-decay half-life, inactivity decay job, per-rule daily/lifetime caps, and "score as sum of unexpired ledger entries" so scores are explainable. The `lead_points_change_log` equivalent already makes this ledger-shaped.
5. **Scoring explainability.** Show a contact's score ledger (rule, delta, when, source event) and a rule "impact" report (contacts affected, total points). Mautic stores the log (`PointsChangeLog.php:62-86`) but the REST layer OVELIO uses never surfaces it.
6. **Triggers that work out of the box.** OVELIO's trigger UI currently omits events (`idx:672-695`). Provide threshold actions (add tag, set stage, add to segment, notify owner, enrol in workflow, webhook) with a visible "has no actions" warning, and make triggers level-triggered or edge-triggered by choice (Mautic: `>=` once per event, `TriggerEventRepository.php:21-39`).
7. **Performance of lists and bulk.** Current list is capped at 100/page via one search string, with per-row N+1 on bulk (`aud:277-307`) and per-row serial import under a global lock (`aud:136-169`). A native contacts table with keyset pagination, server-side column sort, saved views and set-based bulk updates removes all three.
8. **Import you can trust.** Column-mapping preview, dry-run with dedupe report, update-vs-skip-vs-create modes, async job with progress and downloadable error CSV, 100k+ rows (Mautic: background queue but parallel limit 1, `config.php:331`). OVELIO already has the best consent-evidence-per-row model; keep and surface it.
9. **Dedupe/merge that Mautic's API cannot do.** No REST merge exists. A native merge preview (field-by-field winner picker, points sum, tag union, activity re-parent) plus a "possible duplicates" queue (email case/alias, phone, name+company fuzzy) beats the CLI-only `mautic:contacts:deduplicate`.
10. **Timeline with filters, search, deep links and export** (Mautic has these but OVELIO exposes 25 flat rows). Add type filter chips, date range, and unification with Listmonk sends/clicks (`aud:187-243` already pulls newsletter activity) and Umami site visits into ONE timeline.
11. **Consent as first-class.** OVELIO's `consent_events`/`suppressions` model is stricter than Mautic DNC (reason granularity, evidence). Add per-channel and per-purpose consent and expose DNC as a segment filter (Mautic has 6 keys) so "only opted-in" is a one-click segment.
12. **Custom field values everywhere** (row 2) with typed inputs, validation, required enforcement, and use in segments, import, export and templates; Mautic requires column DDL, OVELIO could use a JSONB column with expression indexes for no-DDL field creation.

---------------------------------------------------------------------------------------------------

## 4. Native-rebuild notes

If OVELIO owns this natively (Postgres, `migrations/001_core.sql` style, worker `scripts/worker.ts` job queue with `jobs` table):

Tables (minimum):
- `contacts(id, email citext unique nullable, owner_id, points int, stage_id, date_identified, last_active, created_at, updated_at, fields jsonb, anon bool)` + GIN on `fields`, btree on (stage_id), (last_active), (created_at).
- `contact_field_defs(id, object, alias, label, type, group, flags..., options jsonb, order)`; `companies`, `company_contacts(company_id, contact_id, is_primary)`.
- `tags`, `contact_tags` (PK pair, index both ways); `stages`, `stage_changes`.
- `segments(id, name, alias, filter_tree jsonb, published, is_global, last_built_at, last_build_ms, member_count, count_at)`, `segment_members(segment_id, contact_id, manual_state enum[none|added|removed], added_at)` with PK pair and index on contact_id.
- `dnc(contact_id, channel, reason, comment, at)` unique (contact, channel, reason).
- `points_rules`, `points_ledger(contact_id, rule_id, group_id, delta, at, expires_at, source jsonb)`, `points_rule_fired(rule_id, contact_id)` for non-repeatable, `score_groups`, `score_group_totals`, `point_triggers`, `trigger_events`, `trigger_applied(event_id, contact_id)`.
- `events` (the activity stream; partition by month) with `contact_id, type, occurred_at, ref jsonb`; this is both timeline source and the substrate for behavior filters.
- `imports(id, status, mapping jsonb, file_ref, totals)`, `import_rows_failed`; `exports`; `merge_log`.

Jobs:
- `segment_rebuild(segment_id)` (full), `segment_delta(contact_id)` (on event/contact change; evaluate only segments whose referenced fields/event types intersect the change), `segment_count(segment_id)`.
- `score_apply` (event-driven rule evaluation), `score_decay` (daily), `trigger_eval` (on ledger change), `import_run`, `export_run`, `dedupe_scan`, `field_index_maintain`.

Algorithms to port faithfully:
- Filter compiler (2.2-2.3): per-field-type operator semantics; **negative operators on foreign tables are NOT EXISTS** (so "tag != X" includes untagged contacts); aggregate behaviors (`count/sum/max` sub-selects with `null_value`); segment-in-segment with cycle detection and topological rebuild order; manual add/remove overrides (include if `manual=added` or (`filter match` and not `removed`)); DNF glue (or tree).
- Rebuild: snapshot `maxId`/`now`, new-members insert-select in batches (`INSERT ... SELECT ... WHERE NOT EXISTS member LIMIT n`), orphan removal pass, completion flag only when both passes empty; keep batch sleep configurable, default 0 (Mautic default 1 s hurts).
- Scoring: one-time guard (`points_rule_fired`), per-session dedupe, rule `properties` matchers (page/url wildcard, first_time, returns_within/after, email/form/asset IDs), group routing, SQL-delta update to avoid lost updates, ledger row per change, trigger evaluation with applied-log and `trigger_existing_contacts` back-fill (Mautic back-fills only contacts older than the trigger, `TriggerModel.php:117-124`).
- Merge: winner/loser selection, newest-wins field merge with default-value protection (`MergeValueHelper`), points summed, tags/companies unioned, owner fill-if-empty, **re-parent every child table in one transaction**, merge record for redirect of old IDs (so webhooks/links to the loser still resolve).
- Import: unique-identifier matching, `|` tag lists, auto-create stage by name, points only on new contacts, DNC column, per-row error log.

Hardest parts (ranked):
1. Behavior filters over high-volume event tables (`page_hits`, `email_stats`): need composite indexes and, past ~10M events, pre-aggregated counters or incremental maintenance; this is where Mautic segment rebuilds become slow.
2. Correct negative/empty semantics across 24 operators x types x foreign tables (many edge cases in `ForeignValueFilterQueryBuilder.php:49-161` and `SegmentOperatorQuerySubscriber.php`).
3. Incremental segment membership without full rescan (dependency graph from filter fields/event types to segments; segment-in-segment propagation order).
4. Merge re-parenting across all modules plus identity stitching of anonymous visitors (Mautic tracks cookie contacts; OVELIO sits next to Umami).
5. Decay-aware scoring that stays consistent with trigger semantics (what happens to once-fired triggers when score falls).
6. Migration/coexistence: keep Mautic as system of record while OVELIO shadow-builds; reconcile by mautic ID (`contact_state.contact_id` already keys on it, `migrations/001_core.sql`).

---------------------------------------------------------------------------------------------------

## 5. Unknowns and limitations

- Cron schedule: Mautic image cron (rebuild, import, campaign, scheduled export) is outside the repo; `compose.yaml:247-262` shows a `mautic_cron` role only. Actual segment freshness in OVELIO deployments is therefore unknown. Check `refs`/docker image `mautic_cron` entrypoint.
- Not read in depth: LeadController merge UI, `ContactExportSchedulerModel` formats, form-submission-as-filter coverage, `LeadSubscriber` timeline SQL, Company filter query builders (`CompanyDecorator`), frequency-rule evaluation, `PointInsight` runtime semantics (type `compare_point_groups` writing to a custom field; mechanism not traced).
- "Inferred" items: staleness of count cache (parameter name only), stage weight having no consumer, import per-row latency, untagged contacts matching negative tag filters (derived from `NOT EXISTS` in builder, not from a run), UI offering invalid operators for tags (derived from `ui:105-112`, `ui:349-362`).
- Mautic API behaviour for a trigger created without events was not exercised (read-only analysis); the omission in `idx:672-695` is a code fact, the "inert" effect follows from `TriggerEventRepository::getPublishedByPointTotal` selecting only events.
- Plugin/integration filters (`integration_campaigns`), SMS channel and focus items out of scope.
- Nothing was executed; no test run. OVELIO test coverage reviewed only by names (`test/unit/mautic.test.ts:62,329,388,441,537,939,1324`).
