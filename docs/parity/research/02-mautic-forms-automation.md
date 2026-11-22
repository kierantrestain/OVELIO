# OVELIO parity spec: Mautic forms and marketing automation (campaigns)

Scope: Mautic 7.2.2 `FormBundle` and `CampaignBundle` versus OVELIO's wrapper.

Path shorthand:
- `M/` = `.refs/mautic/app/bundles/`
- `O/` = `OVELIO/`
- `Camp/` = `M/CampaignBundle/`
- `Form/` = `M/FormBundle/`
- `wf.ts` = `O/src/server/mautic/workflows.ts`
- `idx.ts` = `O/src/server/mautic/index.ts`
- `auto.tsx` = `O/src/components/automations.tsx`
- `route` = `O/src/app/api/console/[...path]/route.ts`

Evidence labels: **[E]** = established by code read, with a citation. **[I]** = inferred. Unknowns are in section 5.

---
## 1. Gap table

| # | Capability | Mautic mechanism (one line) | OVELIO today | Pri | Eff |
|---|---|---|---|---|---|
| 1 | Branching campaign graph (yes/no paths, nested events) | `campaign_events` tree via `parent_id` + `decision_path` ('yes'/'no'); canvas JSON `connections[].anchors.source` (`Camp/Model/CampaignModel.php:277-305`) | **Partial.** OVELIO writes only a single linear chain and treats any other graph as read-only (`wf.ts:87-100`, `:166`). README admits the limitation (`O/README.md:111`). | P0 | L |
| 2 | Conditions (immediate yes/no evaluation) | `lead.*`/`form.field_value`/`email.validate.address` etc. evaluated at once, pass->yes children, fail->no children (`Camp/Executioner/EventExecutioner.php:359-410`) | **Missing.** Only the email open/click *decisions* are emitted; they are modelled as a "condition" (`wf.ts:6`, `:215-232`). | P0 | M |
| 3 | Decisions with a "no action after X" (inactivity) path | Negative children are executed by `mautic:campaigns:trigger` once the wait elapses (`Camp/Executioner/InactiveExecutioner.php:184-262`) | **Missing.** Only the 'yes' anchor is created; non-openers wait forever (`wf.ts:233-235`). | P0 | M |
| 4 | Full action catalogue (26 actions) | Subscribers call `CampaignBuilderEvent::addAction` (§2.2) | **Partial.** 5 of 26: email.send, lead.changetags, lead.changepoints, lead.changelist, stage.change (`wf.ts:143-166`, `:262-308`). | P0 | M |
| 5 | Full decision catalogue (9) | email.open/click/reply, form.submit, page.pagehit, page.devicehit, asset.download, dwc.decision, sms.reply | **Partial.** email.open and email.click only, with no URL restriction option. | P1 | M |
| 6 | Full condition catalogue (14) | See §2.2 | **Missing.** | P0 | M |
| 7 | Scheduling modes (interval / fixed date / immediate / optimized) | `triggerMode` + `triggerInterval/Unit/Date/Hour/Restricted*` (`Camp/Entity/Event.php:64-70, 304-345`) | **Partial.** Only whole-minute `interval` or `immediate`, max 525600 min (`wf.ts:206-212`). No date, send-time window, weekdays or contact-time optimisation. | P1 | M |
| 8 | Form trigger / contact-source rules | Campaign sources are `lists` and `forms`; a published form-sourced campaign adds the contact on submit (`Form/Model/SubmissionModel.php:382-388`) | **Exposed.** One list or one form, never both (`wf.ts:93-95`, `:184-200`). Multiple sources are not allowed. | P1 | S |
| 9 | Restart / re-entry (allowRestart, rotation) | `campaign_leads.rotation`; re-entry blocked unless `allowRestart` (`Camp/Membership/Action/Adder.php:22-60`) | **Missing.** Forces `allowRestart:false` (`wf.ts:329`) and a restart-enabled campaign is read-only (`wf.ts:95`). | P1 | S |
| 10 | Republish behaviour of waits | `RepublishBehavior` enum, 3 modes (`Camp/Enum/RepublishBehavior.php`) | **Missing.** | P2 | S |
| 11 | Contact-level run state (log, scheduled, failed) | `campaign_lead_event_log` + REST `/campaigns/events/contact/{id}` (`Camp/Config/config.php:92-111`) | **Partial.** Only member list: `contactId, dateAdded, manuallyRemoved` (`idx.ts:875-880`, `contracts:313`). No per-event state. | P0 | M |
| 12 | Per-event/per-campaign stats | `campaign_summary`, event preview stats (`Camp/Entity/Summary.php`, `Email CampaignSubscriber::onEventPreviewRequest`) | **Missing.** `Workflow` has no metrics (`contracts:307-311`). | P1 | M |
| 13 | Manual add/remove contact to a campaign | `POST /campaigns/{id}/contact/{leadId}/add\|remove` (`Camp/Config/config.php:117-126`) | **Missing.** | P1 | S |
| 14 | Campaign clone/export/import | API `POST /campaigns/clone/{id}`, export/import (`CampaignApiController.php:366-429`) | **Missing.** | P2 | S |
| 15 | Failure handling (retry, auto-unpublish) | Reschedule +`PT1H`; auto-unpublish at >=35% failed of >=100 contacts (`CampaignEventSubscriber.php:28-32, 98-145`) | **Missing, and invisible.** Failures never reach the UI. | P1 | M |
| 16 | Form field types (24) | `Form/Resources/views/Field/*.twig` (§2.1) | **Partial.** 5 types: text, email, textarea, select, checkboxgrp (`route:83`, `contracts:249-253`). | P0 | M |
| 17 | Form submit actions (11+) | `FormBuilderEvent::addSubmitAction` (§2.1) | **Missing.** Sends `actions: []` always (`idx.ts:719-720`). No email notification, tags, points, segment, webhook-repost. | P0 | M |
| 18 | Post-submit behaviour (message/redirect/return) | `Form.postAction` (`Form/Form/Type/FormType.php:191-195`) | **Partial.** Message only (`idx.ts:717-719`). | P1 | S |
| 19 | Conditional fields / progressive profiling | `Field.parent_id`, `conditions` JSON, `showWhenValueExists`, `showAfterXSubmissions`, `alwaysDisplay` (`Form/Entity/Field.php:263-286`) | **Missing.** | P1 | M |
| 20 | Validation (per-field message, required, captcha, phone/email-domain blocklist) | `Field.validation_message`, `FormValidationSubscriber` validators (`:37-59`) | **Partial.** Only `isRequired` (`idx.ts:210-215`). | P1 | M |
| 21 | Submission processing + contact matching | `SubmissionModel::saveSubmission` (§2.3) | **Delegated to Mautic.** Works because fields are mapped (`idx.ts:196-199`), but no control over kiosk mode, dedupe fields or consent. | P0 | n/a |
| 22 | Embed (JS, iframe, direct URL) | `/form/generate.js`, `/form/embed/{id}`, `/form/{id}` (`Form/Config/config.php:88-110`) | **Exposed.** `auto.tsx:827-853` shows script and iframe snippets. | done | |
| 23 | Form results UI and export | `/forms/results/{id}`, `/export/{format}` (`Form/Config/config.php:22-37`) | **Partial.** 25/page list, no export, no filters (`idx.ts:758-772`). | P1 | S |
| 24 | Submission limit, kiosk mode, theme/CSS, language, no-index | `Form` columns: `submissionLimit`, `inKioskMode`, `template`, `renderStyle`, `language`, `noIndex` | **Partial.** Only `noIndex:true` is sent (`idx.ts:721`). | P2 | S |
| 25 | Form-field-value campaign condition and form-submit decision | `form.field_value`, `form.submit` | **Partial.** Form is only an entry source; there is no mid-flow decision. | P1 | S |
| 26 | Simulation / dry run / preview of a campaign | Mautic has only a static event preview (`EventPreview`) | **Missing.** Opportunity: beat Mautic (§3). | P1 | L |

---
## 2. Mechanism deep dives

### 2.1 Forms (FormBundle)

**Data model [E]**
- `forms`: `Form/Entity/Form.php:221-300`
  - Columns: name, alias, language, `cachedHtml`, `postAction` (message|redirect|return, `FormType.php:191-195`), `postActionProperty`, `template` (theme), `inKioskMode`, `renderStyle`, `submissionLimit`, `submissionLimitMessage`, `submissionCount`, `noIndex`.
  - Also `formType` standalone|campaign (OVELIO hard-codes standalone, `idx.ts:716`).
- `form_fields`: `Form/Entity/Field.php:244-290`
  - Columns:
    - Identity and layout: type (indexed), label, alias, `isRequired`, `validationMessage`, `fieldWidth`, `isReadOnly`.
    - Conditional logic: `parent_id` and `conditions` (JSON).
    - Contact mapping: `mapped_object` and `mapped_field` (replacing deprecated `lead_field`), `is_auto_fill`.
    - Progressive profiling: `show_when_value_exists`, `show_after_x_submissions`, `always_display`.
    - Properties blob: options, placeholder, validation min/max, etc.
- `form_actions`: `Form/Entity/Action.php:102-118`. Columns: type (indexed), `order`, properties, form FK.
- `form_submissions`: `Form/Entity/Submission.php:67-94`. Columns: form FK, lead FK, `tracking_id`, `date_submitted` (indexed), page FK, ip, referer.
- **Per-form dynamic results table** `form_results_{id}_{alias}`, created by `FormModel::createTableSchema` (`Form/Model/FormModel.php:530-535`, dropped on delete at `:567`, `:584`). One column per saved field; this is the "results" data. It is not part of Doctrine's schema, so a native rebuild would need a different design.
- `campaign_form_xref` links forms as campaign sources (`Camp/Entity/CampaignRepository.php:223`).

**Field types [E]**: there are 24 view templates in `Form/Resources/views/Field/`:
`button, captcha, checkboxgrp, companyLookup, country, date, datetime, email, file, freehtml, freetext, group, hidden, number, pagebreak, password, radiogrp, rating, select, slider, tel, text, textarea, url`.

Plugins can add types via `FormBuilderEvent::addFormField` (`Form/Event/FormBuilderEvent.php:118`); the only one in this tree is `plugin.loginSocial` (`plugins/MauticSocialBundle/.../FormSubscriber.php:44`).

View-only types, which are not persisted to the results table: `button, captcha, freetext, freehtml, pagebreak` (`FormModel.php:649`). Mautic also has a `placeholder` form trait and a `conditions` form (`FormFieldConditionType`).

**Field validators [E]**: `phone.validation` (tel), `email.validation` (only when the `do_not_submit_emails` or `blocked_free_email_providers` config is set), `checkboxgrp.validation` (`FormValidationSubscriber.php:37-59`). Server-side checks run in `saveSubmission` (`SubmissionModel.php:121-290`):
- required / `validationMessage` handling
- type validation via `fieldHelper->validateFieldValue`
- custom validators
- file uploads (`FormUploader`)

**Submit actions (registered via `addSubmitAction`) [E]**

| Key | Source | What it does |
|---|---|---|
| `email.send.user` | `EmailBundle/.../FormSubscriber.php:39` | Email an admin or user |
| `email.send.lead` | `:49` | Email the submitter |
| `lead.pointschange` | `LeadBundle/.../FormSubscriber.php:70` | Adjust points |
| `lead.changelist` | `:80` | Add or remove segments |
| `lead.changetags` | `:89` | Add or remove tags |
| `lead.addutmtags` | `:98` | Add UTM tags |
| `lead.remove_do_not_contact` | `:107` | Clear DNC |
| `lead.scorecontactscompanies` | `:115` | Company score |
| `lead.updatelead` | `:124` | Update contact fields |
| `form.email` | `FormBundle/.../FormSubscriber.php:98` | Send a templated email message |
| `form.repost` | `:111` | HTTP POST to a URL, with failure email and authorization header |
| `asset.download` | `AssetBundle/.../FormSubscriber.php:52` | Download an asset |
| `plugin.leadpush` | `PluginBundle/.../FormSubscriber.php:25` | Push lead to a CRM integration |

**End-to-end submit flow [E]**

Entry points are public, not REST: `POST /form/submit` and `/form/submit/ajax` (`Form/Config/config.php:88-112`). The REST API only reads submissions (`/forms/{formId}/submissions`, `/submissions/{id}`, `/submissions/contact/{contactId}`, `Form/Config/config.php:56-66`).

`SubmissionModel::saveSubmission` (`SubmissionModel.php:121-390`):
1. Build a `Submission` with IP, referer and landing page, then collect tokens, results and `leadFieldMatches` from mapped fields.
2. Validate each field. Errors go into `$validationErrors`.
3. With progressive profiling, drop errors for fields that were hidden from this contact (`:300-315`).
4. If any error remains, return `['errors'=>...]`.
5. If `leadFieldMatches` is non-empty, call `createLeadFromSubmit` (§ contact matching below).
6. Attach the contact and `tracking_id` from the device tracker, upload files, then `saveEntity` the submission (`:335-358`).
7. Run the form's submit actions in order (`executeFormActions`). An action may invalidate the submission (`:358-370`).
8. Save contact field changes (`leadModel->saveEntity`).
9. **Campaign entry:** `campaignModel->getCampaignsByForm($form)`, and for each published campaign `membershipManager->addContact` (`:382-388`).
10. Dispatch `FormEvents::FORM_ON_SUBMIT`. This triggers:
    - the real-time `form.submit` decision in all campaigns (`Form/EventListener/CampaignSubscriber.php:66-71`)
    - the form webhook
    - point actions

**Contact matching [E]** (`SubmissionModel.php:~957-1130`, `createLeadFromSubmit`):
- It takes the submitted values for contact fields flagged as unique identifiers (`fieldsWithUniqueIdentifier`).
- It looks up existing contacts by those values (`getLeadsByUniqueFields`).
- If a found contact conflicts with the currently tracked contact's identifiers, or the form is in kiosk mode, it uses the found contact **without merging**.
- Otherwise it merges the tracked contact into the found one (`contactMerger->merge`).
- If the submitted data conflicts with the tracked contact's identifiers (not in kiosk mode), it creates a **new** contact.
- It attaches the IP address (skipped in kiosk mode) and sets field values.
- It supports `stagebyname` mapping to a stage.

Consequence [I]: a visitor who is tracked as contact A and submits contact B's email gets a new or merged contact, depending on conflict rules. OVELIO exposes none of these controls.

**Progressive profiling [E]**: `ProgressiveProfiling/DisplayManager.php`. Per-field flags `alwaysDisplay`, `showAfterXSubmissions`, `showWhenValueExists`, plus a display counter.
- The embed code serves the contact-specific form only when the contact is tracked (`form_field_autofill` config, default false, `Form/Config/config.php:149`).

**Conditional fields [E]:** `parent_id` + `conditions` JSON, built by `FormFieldConditionType` (operators incl. `notIn`, "any"). `SubmissionModel` drops validation errors for fields hidden by a condition.

**Embedding [E]:** `/form/generate.js?id=` (`getAutomaticJavascript`, `FormModel.php:~660-700`, uses `insertAdjacentHTML` on `document.currentScript` with a `document.write` fallback), `/form/embed/{id}` (iframe), `/form/{id}` (preview). `GET` params prefill fields (`populateValuesWithGetParameters`, `:~725`).

**Other Mautic form features [E, shallow]:** results export (`/forms/results/{id}/export/{format}`), file download of uploads, "add results to segment", cleanup commands (`Form/Command/Delete*`), audit log, form reports, A/B winner (`DetermineWinnerSubscriber`).

**REST endpoints OVELIO can call**
- `/forms` CRUD (`standard_entity`, `Form/Config/config.php:50`)
- `DELETE /forms/{id}/fields/delete`
- `DELETE /forms/{id}/actions/delete` (`:68-75`)
- `GET /forms/{id}/submissions`
- `GET /forms/{id}/submissions/contact/{contactId}`

The `actions` array is accepted in the form payload. OVELIO already sends `actions: []` (`idx.ts:720`), so the only gap is exposure.

**OVELIO detail [E]**
- `buildFormFields` forces a mapped email field (`idx.ts:197-210`) and a Submit button.
- `toForm` hides `button` fields (`idx.ts:339-345`).
- The create path verifies the saved fields echo (`idx.ts:725-733`).
- The message is HTML-escaped, including `{` `}` to defeat token injection (`idx.ts:172-175`; test `test/unit/mautic.test.ts:251`).
- PATCH replaces the whole field list when `fields` is given (`idx.ts:746-749`). This may lose field IDs and results columns [I, unverified].
- Route caps: fields 1-20, options 30 (`route:82-87,553-561`).

### 2.2 Campaigns (CampaignBundle)

**Data model [E]**
- `campaigns` (`Camp/Entity/Campaign.php:63`)
  - Columns: name, description, published flags, `republishBehavior` (`:172`), `canvasSettings` (serialized array, `:207`), `deleted` (`:213`).
  - Relations: `events` (OneToMany), `leads` (OneToMany), `lists` (M2M segments), `forms` (M2M).
  - Other FormEntity columns (publish up/down, category, version) were not read here.
  - `allowRestart` is read via `allowRestart()` (`Adder.php:52`).
- `campaign_events` (`Camp/Entity/Event.php:50-406`)
  - Columns: `name`, `type` (e.g. `email.send`), `event_type` ('decision'|'action'|'condition', `:54-58`), `order`, `properties` (array), `parent_id` (self-FK), `decision_path` ('yes'|'no', `:60-62`), `redirect_event_id` (jump-to target, `:294`), `temp_id`, `channel` + `channel_id`, `failed_count`, `date_added`, `date_linked`.
  - Trigger columns: `trigger_mode` (date|interval|immediate|optimized, `:64-70`), `trigger_interval`, `trigger_interval_unit`, `trigger_date`, `trigger_hour`, `trigger_restricted_start_hour`, `trigger_restricted_stop_hour`, `trigger_restricted_days_of_week`, `trigger_window`.
  - Indexes: `(type,event_type)`, `(channel,channel_id)`.
- `campaign_leads` membership (`Camp/Entity/Lead.php:54-72`)
  - Columns: campaign + lead, `date_added`, `manually_removed`, `manually_added`, `date_last_exited`, `rotation`.
  - Index: `(campaign_id, manually_removed, lead_id, rotation)`.
- `campaign_lead_event_log` (`Camp/Entity/LeadEventLog.php:114-178`)
  - Columns: event FK, campaign FK, lead FK, `rotation`, `date_triggered`, `is_scheduled`, `trigger_date`, `system_triggered`, `metadata`, `channel/channel_id`, `date_queued`, `non_action_path_taken` (null/0/1, `:170`).
  - **Unique `(event_id, lead_id, rotation)`** (`:123`): this is the idempotency key, so one event runs at most once per contact per rotation.
  - Indexes: `(is_scheduled, event_id, trigger_date)` for the scheduler (`:122`), `(campaign_id, date_triggered, event_id, non_action_path_taken)` for stats (`:120`).
- `campaign_lead_event_failed_log` (`Camp/Entity/FailedLeadEventLog.php`): `log_id` FK, reason, `date_added`.
- `campaign_summary` (`Camp/Entity/Summary.php:63`): unique `(campaign_id, event_id, date_triggered)`. Pre-aggregated counters, built by `mautic:campaigns:summarize`; used when `campaign_use_summary` is on (`Camp/Config/config.php:162`).

**Graph storage [E]**
- The UI/API posts `events[]` plus `canvasSettings.{nodes,connections}`.
- `CampaignModel::setEvents` derives `parent` and `decisionPath` from the `connections`: `sourceId`→parent, `anchors.source` in {`yes`,`no`}→`decisionPath`; `leadsource` anchors are ignored and `lists`/`forms` sources are skipped (`CampaignModel.php:277-305`).
- OVELIO's wrapper relies on the same rule. Its chain uses anchors `leadsource → bottom → yes` (`wf.ts:200-201`, `:307-308`).
- API semantics (`CampaignApiController.php:179-253`):
  - POST/PUT need non-empty `events` and at least one of `lists` or `forms`.
  - PUT deletes any existing event not present in the payload.
  - PUT events require an `id`.
  - New events use temp ids such as `new_send_1`, resolved via `tempId` (`CampaignModel.php:~232`).
  - Event violations return HTTP 422.
  - The canvas is saved a second time after IDs exist.
- A decision's children are the "yes" path (`getPositiveChildren`, `Event.php:752`). `getNegativeChildren` (`:762`) is the "no" path.

**Event catalogue [E]** (from `CampaignBuilderEvent::add*` calls in ~23 subscribers)

*Actions (26 registrations):*

| Key | Source | Notes |
|---|---|---|
| `email.send` | EmailBundle | Marketing/transactional email; batch handler; channel=email. Config `email`, `email_type`. |
| `email.send.to.user` | EmailBundle | Notify an internal user. |
| `message.send` | ChannelBundle `:80` | Marketing message (multi-channel). |
| `sms.send_text_sms` | SmsBundle | Only if an SMS transport is configured. |
| `notification.*` (2 actions, `NotificationBundle ...CampaignSubscriber.php:76,92`) | NotificationBundle | Web push; names not read. |
| `tracking.pixel.send` | PageBundle `:88` | |
| `focus.show` | FocusBundle plugin | |
| `dwc.push_content` | DynamicContentBundle | |
| `campaign.sendwebhook` | WebhookBundle `:52` | Outbound webhook. |
| `plugin.leadpush` | PluginBundle | CRM push. |
| `twitter.tweet` | SocialBundle | |
| `lead.changepoints` | LeadBundle `:112` | |
| `lead.changelist` | LeadBundle `:120` | `addToLists`, `removeFromLists`. |
| `lead.updatelead` | LeadBundle `:129` | Batch handler. |
| `lead.updatecompany` | LeadBundle `:138` | |
| `lead.changetags` | LeadBundle `:146` | `add_tags`, `remove_tags`. |
| `lead.addtocompany` | LeadBundle `:154` | |
| `lead.changeowner` | LeadBundle `:162` (`ACTION_LEAD_CHANGE_OWNER`) | |
| `lead.scorecontactscompanies` | LeadBundle `:170` | |
| `lead.adddnc` | `CampaignActionDNCSubscriber.php:35` | |
| `lead.removednc` | `:45` | |
| `lead.deletecontact` | `CampaignActionDeleteContactSubscriber.php:31` | |
| `stage.change` | StageBundle `:43` | |
| `campaign.addremovelead` | `CampaignActionChangeMembershipSubscriber.php:40` | Form fields `addTo`, `removeFrom` (campaign lists). |
| `campaign.jump_to_event` | `CampaignActionJumpToEventSubscriber.php:46` | Property `jumpToEvent`; restricted: cannot target decisions/actions/conditions without "none" restriction. |

(26 `addAction` registrations found; `notification.*` counts as two.)

*Decisions (9)*

| Key | Source | Notes |
|---|---|---|
| `email.open` | EmailBundle `:66` | Source must be an `email.send` action (`connectionRestrictions`). |
| `email.click` | EmailBundle `:82` | Same restriction, has a URL-restriction form (`EmailClickDecisionType`). |
| `email.reply` | EmailBundle `:113` | Same restriction. |
| `form.submit` | FormBundle `:53` | Config `forms` (empty = any form, `:79-94`). |
| `page.pagehit` | PageBundle `:57` | |
| `page.devicehit` | PageBundle `:68` | |
| `asset.download` | AssetBundle `:42` | |
| `dwc.decision` | DynamicContentBundle `:67` | |
| `sms.reply` | SmsBundle (`CampaignReplySubscriber.php:41`) | |


*Conditions (14):* `lead.field_value`, `lead.device`, `lead.pageHit`, `lead.tags`, `lead.segments`, `lead.stages`, `lead.owner`, `lead.attached` (company), `lead.campaigns`, `lead.dnc`, `lead.points` (`LeadBundle/.../CampaignSubscriber.php:179-270`), plus `form.field_value` (`FormBundle ... :62`), `email.validate.address` (`CampaignConditionSubscriber.php:31`), `notification.has.active` (`NotificationBundle ... :24`).

Option details (operators, fields) live in the `formType` classes. I did not read all of them [see §5].

**Execution engine [E]**

Three execution paths, all in `Camp/Executioner/`:

1. **Real-time decisions** (`RealTimeExecutioner::execute`, `:58-118`)
   - Triggered from the web request, e.g. on an email open or form submit.
   - It loads the contact and all decision events of that type, and calls `DecisionHelper::checkIsDecisionApplicableForContact` (`Helper/DecisionHelper.php:22-60`).
   - That helper rejects the decision if:
     - the channel or channel id differs,
     - the parent event has no log for this contact and rotation, or
     - the parent took the other path (`non_action_path_taken`).
   - On a pass, positive children are executed or scheduled immediately (`executeAssociatedEvents`, `:120-152`), and the decision is logged.
   - This is why a decision only fires if the contact has already reached its parent.
2. **Kickoff** (`KickoffExecutioner::execute`, loop at `:130-190`)
   - Run by `mautic:campaigns:trigger`.
   - It takes new members (no root-event log) in batches. Root events are executed immediately, or scheduled if `triggerMode` is interval/date.
   - `NotSchedulableException` means "execute now" (`:154-161`).
   - Batching is by contact id: `batchMinContactId = max(ids)+1` (`:131`, `:177-188`).
3. **Scheduled** (`ScheduledExecutioner`, `:215-268`)
   - Pulls logs where `is_scheduled=1 AND trigger_date <= now`, per event, in batches (`LeadEventLogRepository::getScheduled`, query around `:429-434`).
   - `validateSchedule` can reschedule logs that are not yet due for the contact's timezone or windows (`:279-`).
   - Execution only runs if the campaign is published (`:258`); scheduled logs of an unpublished campaign simply stay scheduled.
4. **Inactive** (`InactiveExecutioner::executeEvents`, `:184-262`)
   - Iterates decisions that have negative children.
   - Finds contacts that passed the parent (action) but have no decision log, via `InactiveContactFinder`.
   - `InactiveHelper::removeContactsThatAreNotApplicable` computes the earliest inactivity date from the parent's execution time plus the negative child's interval.
   - It records the decision as executed with `non_action_path_taken=1` (`recordLogsAsExecutedForEvent(..., true)`, `:218`) and runs the "no" children.
   - Delay for the no path comes from the negative child's trigger settings, so "wait 3 days then act if no open" is a no-path child with a 3-day interval.

**Core execution (`EventExecutioner::executeLogs`, `:107-153`)**
- Dispatches by `event_type`:
  - Action: run the batch action; persist logs; then run child *condition* events and child *action* events of the passed contacts.
  - Condition: `ConditionExecutioner`; passed contacts go to the "yes" children, failed contacts to the "no" children (`:359-410`). **Conditions evaluate immediately with no waiting.**
  - Decision: `DecisionExecutioner`; passed contacts go to the "yes" children. A decision outside the real-time path never waits itself; waiting is implicit, because the decision event is only reached when the real-time trigger fires.
- Children are scheduled with `EventScheduler::getExecutionDateTime` (`EventScheduler.php:142-170`):
  - immediate/optimized/null → now;
  - interval → `parentExecTime + interval` (`Mode/Interval.php:~80-110`), returning "now" if already past;
  - date → fixed `trigger_date` (`Mode/DateTime`).
- `shouldSchedule` compares to now at minute precision (`EventScheduler.php:289-300`). If true, a log with `is_scheduled=1` and a `trigger_date` is written; otherwise the child runs in the same request/process (**synchronous cascade**).
- Interval-mode logs with hour or day-of-week restrictions, or negative-path or optimized events, get a contact-specific date (`Interval::isContactSpecificExecutionDateRequired`, `Mode/Interval.php:~150-170`; `Optimized` mode uses contact engagement data [I]).

**Failures and retries [E]**
- A failed log is rescheduled by `EventScheduler::rescheduleFailures` (`:117-130`) to now + the log's own interval, falling back to config `campaign_time_wait_on_event_false` = `PT1H` (`:412-432`; default at `Camp/Config/config.php:161`). If neither is set the failure is just logged.
- `CampaignEventSubscriber::onEventFailed` (`:98-145`): after `LOOPS_TO_FAIL=100` failures for one contact/event (`:28`), `failedCount` on the event is incremented, a notification is dispatched, and if the campaign has >= 100 contacts (`:30`) and the failed share is >= 0.35 (`:32`) it is **auto-unpublished** and a notify event is sent.
- A successful run decrements the failed count (`onEventExecuted`, `:149`).
- A log can be both passed and failed by a handler only in error (`LogPassedAndFailedException`); handlers should not do this.

**Membership and restart [E]**
- `mautic:campaigns:rebuild` runs `MembershipBuilder::build` (`Membership/MembershipBuilder.php:37-66`): `addNewlyQualifiedMembers` for contacts that match a source segment and are not yet members, then `removeUnqualifiedMembers` for contacts who no longer match.
- `Adder::createNewMembership` (`Adder.php:22-40`): rotation = 1, or 2 if a log from rotation 1 exists.
- `Adder::updateExistingMembership` (`Adder.php:48-85`):
  - Without `allowRestart`, re-adding is blocked for natural exits and filter removals. It is allowed only for a manually removed contact being manually re-added (`:52-60`).
  - With `allowRestart`, a returning contact starts a new rotation and runs the campaign again. The `(event_id, lead_id, rotation)` unique key permits this.
- Manual add/remove through `/campaigns/{id}/contact/{leadId}/add|remove` sets the `manually_*` flags and the rebuild respects `manually_removed`.
- Form-sourced campaigns add the contact in the submit request (see §2.1), not in rebuild.

**Commands and schedule [E for flags, I for schedule]**

| Command | Purpose | Key options |
|---|---|---|
| `mautic:campaigns:update` (rebuild) | Membership from segments | `--batch-limit` (default 300, `UpdateLeadCampaignsCommand.php:50`), `--max-contacts`, `--campaign-id`, `--contact-id(s)`, `--min/max-contact-id`, `--thread-id` + `--max-threads` |
| `mautic:campaigns:trigger` | Kickoff + scheduled + inactive | `--campaign-id`, `--campaign-limit`, `--contact-id(s)`, `--min/max-contact-id`, `--thread-id`, `--max-threads`, `--kickoff-only`, `--scheduled-only`, `--inactive-only`, `--batch-limit` (default 100, `TriggerCampaignCommand.php:144-147`), exclude list |
| `mautic:campaigns:execute` | Execute specific scheduled log ids | `--scheduled-log-ids`, `--execution-time` (this is what a queue worker calls) |
| `mautic:campaigns:validate` | Evaluate one decision for contacts | `--decision-id`, `--contact-id(s)` |
| `mautic:campaigns:summarize` | Build `campaign_summary` | `--batch-limit`, `--max-hours`, `--rebuild` |
| `mautic:campaigns:resume-stuck` | Recover stuck contacts | `--dry-run`, `--min/max-contact-id`, `--batch-limit` |
| `mautic:campaigns:delete-event-logs` | Purge logs | `--campaign-id` |

- The trigger command uses a run-lock (`checkRunStatus`, `:225`) and signal-safe termination (`SignalCaughtException`).
- **Schedule:** OVELIO runs a `mautic-cron` container (`O/compose.yaml:247-259`). The actual crontab entries are inside the Mautic image and are not in this repo. README says "native schedule" (`O/README.md:17`). The integration test runs `segments:update`, `campaigns:update`, `campaigns:trigger` by hand (`O/test/integration/services.test.ts:147`). Mautic's recommended cadence is typically every few minutes [I, not in code read]. A `mautic-worker` service also exists (`compose.yaml:262`), probably a messenger consumer [I].

**REST endpoints OVELIO could call [E]** (`Camp/Config/config.php:76-126`)
- `/campaigns` standard CRUD
- `/campaigns/events` (get/getAll)
- `GET /campaigns/events/contact/{contactId}`
- `PUT /campaigns/events/{eventId}/contact/{contactId}/edit` (reschedule one log)
- `PUT /campaigns/events/batch/edit`
- `GET /campaigns/{campaignId}/events/contact/{contactId}`
- `GET /campaigns/{id}/contacts`
- `POST /campaigns/{id}/contact/{leadId}/add|remove`
- `POST /campaigns/clone/{id}`
- export/import actions in `CampaignApiController.php:404-429`

OVELIO uses only list/new/edit/delete/contacts (`idx.ts:852-900`).

**Operator-facing UI in Mautic [E for routes]:** canvas editor (`/campaigns/events/...`, `/campaigns/sources/...`), per-event stats (`/campaigns/event/stats/...`), campaign graph, contacts list (`/campaigns/view/{id}/contact/{page}`), preview (`mautic_campaign_preview`), map stats, email weekday/hour metrics (`Camp/Config/config.php:16-48`).

**Edge cases and limits [E]**
- The `email.open/click/reply` decisions can only hang off `email.send` (`connectionRestrictions`); other decisions may follow any event.
- Jump-to-event creates cycles; guarded by `redirect_event_id` and `EventRedirectionHelper`. Infinite-loop protection is not documented here [unknown].
- `email.send` as a marketing email is sent once per contact per email ("Each marketing email is sent once per contact", `wf.ts:244`). OVELIO therefore blocks reusing an email within a workflow.
- Event configs are stored as serialized arrays, and `canvasSettings` is a PHP-serialized array. The wrapper fully rewrites events on PUT, and Mautic deletes events not sent (`CampaignApiController.php:206-212`), so any native extras in a managed workflow are lost on edit. OVELIO avoids this by refusing to edit non-managed graphs (`wf.ts:95-100`) and by the description marker "Managed by OVELIO" (`wf.ts:5`).

### 2.3 OVELIO's current implementation [E]

- **Contract:** `WorkflowStep` has kind email|tags|points|segment|stage plus a delay in minutes and an optional condition `opened_previous|clicked_previous` (`contracts:284-311`).
- **Validation:** the route caps steps at 1-12 (`route:77`) while the server library allows 20 (`wf.ts:185`). This is an inconsistency, not a bug in practice.
- **Always-draft:** created or updated workflows are saved with `isPublished:false` (`wf.ts:328`) and verified by re-parsing (`verifySavedWorkflow`, `wf.ts:335-370`). Activation is a separate PATCH (`idx.ts:882-905`) that checks the source segment is published and every email is published and has an unsubscribe link and `emailType === 'template'` (`allowedEmail`, `idx.ts:158-160`). The route also calls `assertDeliveryReady` (`route:592`).
- **Editing guard:** updates require the workflow to be paused and in managed shape (`idx.ts:861-867`).
- **Read-only fallback:** any campaign not matching the managed chain (branches, jump events, multiple sources, `allowRestart`) maps to `editable:false, steps:[]` (`wf.ts:95-100`, `:166-180`).
- **UI:** `auto.tsx` Workflow editor (steps list, per-step kind selector, delay, condition select) and a members drawer (`WorkflowContactsDrawer`, `auto.tsx:2096`). There is no canvas, per-step metrics or run log.
- **Tests:** `test/unit/mautic.test.ts:740-852` covers multi-action workflows and form triggers.

---
## 3. Better-than opportunities (grounded in observed weaknesses)

1. **Visual branching canvas with explicit yes/no paths and a real "else".** Mautic's linear `yes` anchor with no `no` path strands non-openers forever in OVELIO's current output (`wf.ts:233-235`). Add a "wait up to N days for open/click, else do X" node. In Mautic this is a decision plus a delayed "no" child, which the engine already supports (`InactiveExecutioner`). Quick win, built on the existing REST payload.
2. **Dry-run simulation and preview.** Mautic has no simulator (only per-event stats preview). Build a pure-function evaluator over the saved graph: pick a contact or a synthetic profile and show which path, which wait dates, and why a condition failed. Needs the condition semantics from §2.2.
3. **Per-step funnel analytics on the canvas.** Mautic spreads this across several screens and an opt-in summary table (`campaign_use_summary` default 0, `Camp/Config/config.php:162`). Show contacts-in, executed, scheduled, failed, no-path and conversion counts per node, from the log indexes (`LeadEventLog.php:119-123`).
4. **Visible failures and stuck contacts.** Mautic only auto-unpublishes at 35% of >=100 contacts (`CampaignEventSubscriber.php:28-32`) and notifies; OVELIO surfaces none. Show failed logs with reason and one-click retry or reschedule (via `PUT /campaigns/events/{id}/contact/{id}/edit`), and expose `resume-stuck` as a button.
5. **A/B (split) nodes and goal exits.** Mautic has no native split node or goal. Emulate a split with a random-bucket condition (e.g. `lead.field_value` on a stored bucket field) and a goal as a "remove from campaign" after a `form.submit` or page-hit decision. A native rebuild can make both first-class.
6. **Time-zone and quiet-hours scheduling as plain controls.** Mautic's restricted hour/weekday fields exist but are buried (`Event.php:320-340`). Expose "send at 9:00 contact-local, weekdays only".
7. **Safer editing.** OVELIO's "pause before edit" is stricter than needed; a versioned draft/publish model that does not touch live runs would beat Mautic's destructive PUT (events not in the payload are deleted, `CampaignApiController.php:206-212`).
8. **Form builder with live validation preview.** Mautic's builder has 24 field types but server-only validation for several cases. Show conditional-field and progressive-profiling previews, a consent checkbox field with stored evidence (ties into OVELIO's consent model), and submit-action pickers using the existing tag/segment/points selectors.
9. **Honest form errors.** Mautic returns validation errors as a map by alias; surface per-field inline messages plus a spam score (honeypot, rate limit) rather than only reCAPTCHA.
10. **Entry-source union.** Allow list + form + "contact created" triggers in one workflow. Mautic allows both lists and forms on one campaign (`Campaign.php:193-204`), but OVELIO forbids it (`wf.ts:93-95`).

---
## 4. Native-rebuild notes

**Tables (Postgres)**
- `workflows(id, name, status, version, allow_restart, republish_mode, published_at, created_at)`
- `workflow_versions(workflow_id, version, graph_json)`: immutable once published.
- `workflow_nodes(id, workflow_id, version, type, kind, config_json, parent_id, branch)`: or keep nodes only in `graph_json` and denormalise on publish.
- `workflow_members(workflow_id, contact_id, rotation, status, entered_at, exited_at, manually_added, manually_removed)`
- `workflow_runs`: the event log. Columns: `workflow_id, node_id, contact_id, rotation, status (scheduled|done|failed|skipped), path_taken, run_at, started_at, finished_at, attempts, last_error, metadata`.
  - **Unique `(node_id, contact_id, rotation)`** (this is Mautic's idempotency, `LeadEventLog.php:123`).
  - **Partial index `(run_at) WHERE status='scheduled'`** replaces `idx_scheduled_events` (`:122`).
- `workflow_stats_daily(workflow_id, node_id, day, counts)`: always on, unlike Mautic's opt-in summary.

**Jobs**
- **Scheduler worker:** `SELECT ... FROM workflow_runs WHERE status='scheduled' AND run_at<=now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT n`. Run every ~1 minute, or use `pg_notify`/a queue for timed wake-ups. This replaces both cron and the thread-id/min-max-contact sharding (`TriggerCampaignCommand.php:~85-150`), which only exists because Mautic scans.
- **Membership builder:** event-driven by segment-membership changes (or a periodic reconcile). A form submit enrols the contact directly in the same transaction as the submission.
- **Inactive/timeouts:** model "decision with timeout" as two scheduled rows at wait time, race-safe: the decision outcome (event arrival) cancels the timeout row, and otherwise the timeout row fires the "no" path. This is simpler than `InactiveExecutioner`'s polling scan (`:184-262`).
- **Retry:** exponential backoff with attempt counter instead of Mautic's flat 1-hour reschedule (`EventScheduler.php:412-432`), and a circuit breaker (auto-pause above a failure ratio, as Mautic's 35% rule, `CampaignEventSubscriber.php:28-32`, but with a lower minimum than 100 contacts).

**Algorithms**
- Executioner loop: for each due run, load node config, run the handler idempotently, write the outcome, and enqueue child runs (compute `run_at` from the child's schedule: immediate, relative interval, fixed date, or contact-local time with weekday windows).
- Conditions evaluate synchronously and choose a branch; a decision node registers a "listener" (event type + channel/id filter, as in `DecisionHelper.php:22-60`) which the event ingest path matches against the contact's pending decision nodes.
- Real-time triggers (email open/click, form submit, page hit, asset download) hit the ingest path, which finds waiting decision nodes for that contact whose parent run has completed.
- Re-entry via `rotation`.

**Hardest parts**
1. Exactly-once-ish semantics for sends and CRM pushes (idempotency keys per run and provider) when a worker crashes mid-action.
2. Decisions racing with their own timeout, and with unpublish/republish. Mautic's three republish behaviours (`RepublishBehavior.php`) show the needed semantics: restart, count only while published, count all time.
3. Migrating live Mautic campaigns without losing wait state: map `campaign_lead_event_log` scheduled rows and `non_action_path_taken` onto the new tables.
4. Condition and segment-filter parity (14 conditions, plus segment queries used for `lead.segments`).
5. The form results store: Mautic's per-form dynamic tables (`FormModel.php:530-535`) should become a JSONB `form_submissions.values` column plus a typed field catalogue.
6. Contact matching and merge rules (unique identifier fields, kiosk mode, tracked-contact conflicts, `SubmissionModel.php:~990-1130`). This is the highest-risk piece for duplicate or wrongly merged contacts.
7. Timezone and DST-correct scheduling for "contact local 9am".

---
## 5. Unknowns and limitations

- The **crontab schedule** is not in the reviewed repos. It lives in the Mautic Docker image used by `mautic-cron` (`compose.yaml:247`). I cannot state how often `campaigns:trigger` actually runs in OVELIO, which bounds minimum delay granularity.
- I did not read the `formType` classes for most events, so **operator lists and option sets** (for example `lead.field_value`, `page.pagehit`, `email.click` URL filters, `lead.points`) are not enumerated. I read config `properties` only for the five types OVELIO writes.
- `Campaign` columns inherited from `FormEntity` (publish up/down, category, version) and `Lead` extras were not confirmed by a read.
- The `Optimized` scheduler mode (send-time optimisation) and `triggerWindow` semantics were not read.
- Loop protection for `jump_to_event` cycles was not verified.
- Whether OVELIO's PATCH of form `fields` (`idx.ts:746-749`) preserves field ids and existing results columns was not tested (no execution allowed).
- Non-default Mautic plugins (Zapier, Social, FullContact etc.) were only checked for campaign/form registration, not for runtime behaviour. SMS and push events are present in the code but need configured transports. OVELIO's compose may not enable them [I].
- Form-embed JS behaviour (`_script.html.twig`: validation, multi-page, AJAX) was not read beyond the generator.
- The "dev-preview" mock layer (`O/src/server/dev-preview.ts`) was not reviewed, so the preview behaviour of forms and workflows may differ from the live engine.
- Counts of events (26 actions, 9 decisions, 14 conditions) come from grep of `addAction/addDecision/addCondition`; any event registered by a mechanism other than those calls, or by a bundle not under `app/bundles` or `plugins`, would be missed.
