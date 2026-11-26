# OVELIO

**Marketing. Connected.** A self-hosted CRM, sales, marketing and analytics platform: contacts and companies, deal pipelines and tasks, a visual email studio, landing pages and funnels, campaigns and workflow automation, and revenue attribution, in one product with eight workspaces (Overview, CRM, Sales, Marketing, Sites & Forms, Automations, Analytics, Settings).

## Run locally

Use Docker Engine with the Docker Compose v2 plugin (v2.24.4 or newer), and OpenSSL.

```sh
sh deploy/init-env.sh
docker compose build app
docker compose up -d --wait --wait-timeout 420
```

Open [OVELIO](http://localhost:3100) with `OVELIO_ADMIN_EMAIL` and `OVELIO_ADMIN_PASSWORD` from the generated `.env`. Local messages appear in the [development inbox](http://localhost:8025). Keep `.env` private and retain it with your backups.

Compose creates the operational database, installs the three engines and configures private API access. Check `docker compose ps --all` and the connection status in Settings if initialization fails. Mautic's cron service processes segment and workflow changes on its native schedule.

For a second client, use a separate Compose project, ports and generated credentials.

```sh
OVELIO_PORT=3101 MAILPIT_PORT=8026 sh deploy/init-env.sh .env.client2
docker compose --env-file .env.client2 -p ovelio-client2 up -d --wait --wait-timeout 420
```

## Architecture

| Layer | Responsibility |
| --- | --- |
| OVELIO console (Next.js, TypeScript) | Sign-in, roles, navigation, `Cmd/Ctrl+K` command palette, toasts, drawers and every screen. Built on Meta's [Astryx](https://github.com/meta/astryx) design system with OVELIO's own colour tokens. |
| OVELIO API (`/api/console/*`) | One authenticated gateway with typed adapters in `src/server/{mautic,listmonk,umami}` plus multipart media uploads. Engine credentials stay server-side. |
| Worker and SMTP policy | Retried, idempotent jobs for contact and segment sync, suppression and erasure, background imports and pre-send refreshes of scheduled newsletters; a sweep that reconciles suppressions across both engines; a consent and suppression check before every relayed email. |
| Engines | Mautic 7.2.2 holds contacts, custom fields, segments, dynamic filters, tags, stages, companies, categories, lead scoring, notes, forms, assets, landing pages, dynamic web content, popups & bars, reports, webhooks and multi-action journeys. Listmonk 6.2.0 delivers newsletters, public archives, templates, media, bounces and transactional emails. Umami 3.5.0 records website traffic, realtime visitors, expanded metrics, events feed, sessions, heatmaps, saved segments & cohorts, goals, saved funnels, journeys, retention, attribution, revenue, Core Web Vitals, breakdowns, annotations, tracked links and pixels. Each keeps its own database on an isolated network. |

Interface code lives in `src/components`: `ui.tsx` is the shared OVELIO kit over Astryx (panels, metrics, charts, heatmaps, alert dialogs, drawers, filter tokens, progress bars, feedback), `shell.tsx` is the application frame with breadcrumbs and command palette, and each section has one file. Contracts shared by the console and the API are in `src/contracts`.

## First workflows

1. Import an Audience CSV (up to 25 MB and 200,000 rows) with `email`, `first_name`, `last_name`, `company`, `phone`, `position`, `city`, `country`, `website`, `tags` and `consent`, plus one column per custom contact field named by its alias (download the starter CSV template inside the Import dialog). Map columns to core or custom fields, run a dry run to see what would be created, updated or skipped, then import in the background with progress and a downloadable list of skipped rows. Use `opted_in` and record where and when permission was obtained for recipients who have given it.
2. Create dynamic or manual segments, custom contact and company fields (with values editable on each contact and included in exports), tags, lifecycle stages, B2B companies, lead scoring rules and triggers with their actions, and suppressions, sync segments into newsletter mailing lists, and inspect unified contact engagement, bounces and direct email sends.
3. Design emails visually in the full-screen Email Studio (Marketing › Templates: 24 editable MJML templates in eight categories, your brand kit applied automatically, drag-and-drop blocks, merge tags, versions, personalised preview and consent-checked test sends whose rendered message is stored), then use Create email campaign in Marketing › Emails to choose lists (with consent and exclusion counts), test and send or schedule through the newsletter engine. Existing HTML newsletters open in the studio as an editable raw-HTML section. You can still compose newsletters with the split HTML editor and live Desktop/Mobile preview, manage reusable campaign and transactional templates, upload images in the Media library, publish public web archives, preview and send tests to consenting contacts before starting or scheduling delivery, and inspect opens, clicks, bounces and clicked links.
4. Create journey emails, custom lead capture forms (with submissions viewer and embed code), downloadable assets, landing pages, dynamic web content slots, website popups and bars, categories, webhooks and multi-action automations (email, tags, points, segment, stage) triggered by segments or forms.
5. Build landing pages in Sites & Forms: pick one of 16 templates (lead generation, services, events, webinars, products, waitlists, lead magnets), edit it in the full-screen builder with Desktop/Tablet/Mobile styles, autosave and version history, then publish it at `/s/<page>` or on a verified custom domain. Forms built in Sites › Forms work on pages, as a hosted link (`/f/<form>`) and as an embed script; each submission creates or updates the CRM contact (consent only when its box is ticked), and funnels report visitors, drop-off and completion per step.
6. Start the day on Overview (today's leads, deals and wins, your overdue and due tasks, pipeline snapshot, recent leads, campaigns in flight, email and website pulse, and a setup checklist built from what the workspace already has). In Analytics, the executive dashboard, Sales, Marketing, Attribution, Funnels and Reports share one date range, comparison period (previous period or same period last year) and pipeline, owner, campaign and source filters. Every number says whether it is measured, a current snapshot, an estimate (weighted pipeline, forecast, velocity) or a model allocation (attribution), explains its calculation, opens the deals, contacts, tasks or emails behind it, and exports to CSV. Attribution credits won revenue and leads to campaigns under first-touch, last-touch, linear and 40/20/40 position-based models with a chosen lookback window; credit always adds up to measured won revenue and the rest is shown as unattributed.
7. Add a website in Analytics › Website and install its tracking snippet. Explore live realtime visitors, compact and expanded breakdowns across 22 dimensions, saved segments and cohorts, raw events feed, weekly heatmaps, anonymous sessions and properties, goals, saved funnels, user journeys, retention cohorts, first/last-click attribution, revenue, Core Web Vitals, annotations, tracked links and pixels with charts, and native marketing reports.
8. Sell from a deal: add products and services from Sales › Products (prices per currency, tax rates, one-time or monthly/quarterly/yearly billing) to the deal's line items, which set its value. Create a proposal, choose the deposit due on acceptance and send it: the client reviews it at `/proposal/<link>`, accepts with a typed signature and consent (signer, time, IP hash, browser and a SHA-256 of the exact content are kept) or declines with a reason. Acceptance marks the deal won, issues the deposit or full invoice at `/pay/<link>`, starts a subscription for recurring lines (each later period is invoiced and emailed automatically) and creates onboarding tasks once any required deposit is paid. Sales › Revenue keeps pipeline, contracted, invoiced, collected, refunded, outstanding and monthly recurring revenue apart, per currency. Workflows can start on proposal, payment and meeting events.
9. Test two paths in a workflow with an A/B split and choose what decides it: clicks, conversions, qualified leads or won revenue within a window. The Results tab shows each path's rate, the difference with a 95% interval and p-value, and says Collecting or Inconclusive until each path has 100 contacts, five outcomes and p below 0.05. Opens are never used.
10. Connect Gmail or Outlook in Settings › Mailboxes. Use Manage access to grant selected marketers or administrators read access to that mailbox. Sales › Inbox and the associated CRM timelines honour those permissions, including search and exports. Only the owner can change sharing, initiate a sync or send through the connection. Workspace administrators can see connection metadata and disconnect an account.

## Production

Set `OVELIO_HOST` to your DNS name and `APP_ORIGIN` to its HTTPS origin. Keep DNS pointed to the server, allow inbound 80/443, and configure the following in `.env`.

| Setting | Value |
| --- | --- |
| `SMTP_FROM_EMAIL` | Approved provider From address |
| `SMTP_RELAY_HOST`, `SMTP_RELAY_PORT` | Provider host and port |
| `SMTP_RELAY_TLS` | `starttls` or `smtps` as specified by the provider |
| `SMTP_RELAY_USERNAME`, `SMTP_RELAY_PASSWORD` | Provider SMTP credentials |
| `SMTP_DKIM_SELECTOR` | Provider's DKIM selector for the Settings DNS check |
| `SMTP_VERIFIED_DOMAIN` | From domain after the provider has confirmed verification |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Optional Auth0 OIDC login (set Allowed Callback URL to `<APP_ORIGIN>/api/auth/auth0/callback` and Allowed Logout URL to `<APP_ORIGIN>/login`) |
| `BOUNCE_PROVIDERS` and the other `BOUNCE_*` settings in `.env.example` | Optional bounce sources: provider webhooks (`ses`, `sendgrid`, `postmark`, `azure`, `forwardemail`, `lettermint`) posting to `<APP_ORIGIN>/webhooks/service/<provider>`, and POP mailbox scanning. The worker applies them to the newsletter engine and leaves blank settings as they are |
| `AUTH0_AUTO_PROVISION`, `AUTH0_DEFAULT_ROLE` | Optional (`true` to auto-create new Auth0 users with role `analyst`, `marketer` or `admin`; first user in an empty workspace becomes `admin`) |

```sh
docker compose -f compose.yaml -f compose.production.yaml build app
docker compose -f compose.yaml -f compose.production.yaml up -d --wait --wait-timeout 420
```

Caddy terminates HTTPS. The engines each use their own database on an isolated network. Their management APIs, databases and SMTP policy listener have no published ports. Only tracking, public forms, downloadable assets, media uploads and email links are forwarded to engines. The SMTP policy service checks consent and suppression before relaying email over TLS. Verify DNS, the provider's sender authorization, a seed-inbox delivery and authenticated feedback before a production send. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

Send authenticated, normalized permanent bounce, complaint and unsubscribe notifications to `POST /api/delivery/suppress` with `Authorization: Bearer <SUPPRESSION_WEBHOOK_SECRET>` and JSON `{"email":"recipient@example.com","reason":"bounce"}`. Verify the provider's signature in your provider adapter before forwarding. The supported reasons are `bounce`, `complaint` and `unsubscribe`. SMTP relay acceptance alone does not establish inbox delivery.

### Backup and restore

Create a snapshot to a new directory. Backup briefly pauses the services that write data. Store the files and their matching private `.env` in encrypted storage.

```sh
sh deploy/backup.sh /path/to/new-backup
```

Restore in a fresh Compose project using the backup's credentials and HMAC key. Start under the same public origin or update engine settings as part of the migration. Restore refuses a database with existing tables.

```sh
COMPOSE_PROJECT_NAME=ovelio-restored sh deploy/restore.sh /path/to/backup
docker compose -p ovelio-restored up -d --wait --wait-timeout 420
```

Run the production commands with `COMPOSE_FILE=compose.yaml:compose.production.yaml` when taking or restoring a production backup. Revoke active user sessions and review pending campaigns when rehearsing disaster recovery. The restore script invalidates OVELIO sessions before startup.

### Consent and privacy

OVELIO defaults to no recorded marketing consent and stores consent evidence and suppression history. OVELIO's suppression list is the single record of who must not be emailed. Unsubscribes, bounces and blocklists that start inside either engine are picked up by the worker within a few cycles and mirrored to the other engine. Each contact shows its do-not-contact entries per channel, with reason, comment and date. Removing an email entry needs written evidence, is recorded in the consent history and does not opt the contact back in. Removing a bounce or complaint also needs confirmation that the address has been fixed. A suppression created by an erasure request can't be removed. Audience supports contact export and erasure. A keyed address digest can be retained to screen future imports against an objection. Set your retention period, privacy notice, provider contracts and lawful basis for processing before importing customer data. Assess consent requirements for tracking pixels separately from marketing emails. [ICO guidance on marketing email and PECR](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/)

Contact erasure removes the audience and subscriber records. Native form results can retain submitted values after the contact link is cleared. Include retained form results and backup retention in your operator's erasure process. [Mautic form submission storage](https://github.com/mautic/mautic/blob/7.2.2/app/bundles/FormBundle/Entity/Submission.php)

### Hosted preview (Vercel)

A Vercel deployment without engine URLs runs the **developer preview**: every screen works on labelled sample data, OVELIO's own records (deals, designs, pages, forms, campaigns, workflows) use real SQL, and engine features (Mautic contacts, Listmonk delivery, Umami tracking) are simulated. Vercel functions cannot host the worker, the SMTP policy gateway or the engines, so production is the Docker Compose stack above.

| Setting | Effect |
| --- | --- |
| none | Embedded PGlite database per serverless instance; data resets when an instance restarts |
| `DATABASE_URL` (Neon, Vercel Postgres; add `?sslmode=require`) | Preview data persists and is shared by every instance. The database migrates and seeds itself on first use |
| `OVELIO_PREVIEW_DB=embedded` | Selects the ephemeral embedded database in developer preview mode, even if the project inherits a `DATABASE_URL`. Configure in the Vercel Preview environment |
| `OVELIO_DEV_PREVIEW=true` | Forces the preview anywhere (never in `OVELIO_ENV=production`) |

Preview contacts and other engine sample data stay in memory per instance even with `DATABASE_URL`.

### New settings in OVELIO 2.0

| Setting | Purpose |
| --- | --- |
| `SMTP_OVELIO_PASSWORD` | Gateway account for OVELIO's own email (sales, sequences, automations, test sends). `deploy/init-env.sh` generates it; add it to an older `.env` or native sends report that the account is missing |
| `MAILBOX_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, `MICROSOFT_CLIENT_ID`/`SECRET` | Gmail and Outlook mailbox connections for Sales (OAuth clients registered with each provider) |
| `OVELIO_WEBHOOK_ALLOW_PRIVATE` | `true` lets workflow webhooks call private network addresses |
| `STRIPE_SECRET_KEY` | Card payments on invoices through Stripe Checkout (use a `sk_test_` key until you go live). Without it, invoices show your bank transfer instructions and payments are recorded by hand |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of a Stripe webhook pointed at `<APP_ORIGIN>/api/public/stripe/webhook` with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` and `charge.refunded`. Card payments are only marked paid when Stripe confirms them here |
| `OVELIO_CLICK_TRACKING` | `false` sends links in OVELIO's own marketing and sales email unchanged. By default they go through signed `/r/` redirects so workflow A/B splits can be judged on clicks |
| `OVELIO_COMMIT` | Commit reported by `/api/health` outside Vercel (Vercel sets `VERCEL_GIT_COMMIT_SHA`), so a deployment can be matched to the repository |

## Verify

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright install chromium
npm run test:integration
npm run test:e2e
npm run test:e2e:preview   # after npm run build: every workspace and the acceptance journeys on the developer preview
```

The integration and browser suites require the local Compose stack and use synthetic addresses. Set `OVELIO_TEST_CHROMIUM` to use an existing Chromium binary instead of installing one. CI also checks restart persistence, a second installation, and a restore into a fresh project. See [Third-party notices](NOTICE.md) before redistributing OVELIO.

## Known limitations

- Card payments need `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; the Checkout, webhook and refund code is unit-tested against Stripe's documented formats with signed sample events, but has not yet run against a live Stripe test account. Accounting systems (Xero, QuickBooks) are fed by the invoice CSV export in their import layout; there is no direct API sync yet.
- Revenue states are reported per currency and never converted. Proposal acceptance is a simple electronic signature with an evidence record, not a qualified or advanced electronic signature; use a dedicated signing provider where the law or the contract requires one.
- Click tracking cannot tell every security scanner from a person: clicks within five seconds of sending, without a user agent, or from known scanners are kept but left out of experiment results.

- Delivery confirmation depends on the SMTP provider. Relay acceptance is recorded, but delivered, bounce and complaint counts appear only when the provider forwards authenticated feedback to `POST /api/delivery/suppress`.
- The workflow canvas edits any Mautic campaign, with yes/no branches and "didn't act within N" paths. It configures all 14 Mautic conditions and 20 of its 26 actions. The other six (text message, web and mobile push, tracking pixel, CRM push and tweet) need an integration OVELIO doesn't set up, so they're listed with the reason and existing steps of those types are kept as they are. Of the decisions, only email open and click have editors so far; other decision steps keep their settings as advanced steps, and "Push dynamic content" and "Show popup" can only be added under those decisions where a campaign already has them. A "didn't act" path runs at the engine's next scheduled run after the wait.
- Activating a workflow checks every email, segment, stage, company, user, form field, point group, workflow, page, content item, popup and marketing message it uses, on every branch. Two Mautic quirks are shown as warnings: the owner condition only matches the first owner chosen, and the do-not-contact condition only checks the last channel chosen.
- "Show path" in a workflow's members, and the Workflows panel on each contact, show every step a contact has passed, is scheduled for or failed, with the reason. The log combines Mautic's event log with the contact's activity feed, because the event log API leaves out steps run by the engine's scheduler. It reads up to 1,000 event rows and 500 activity rows and says when it hits that cap.
- Server-side events (`POST /api/v1/events` with `Authorization: Bearer <API key>` from Analytics settings) accept up to 100 events per request, each with an `idempotencyKey`. Send a `distinctId` with each event, or events from one server share a session.
- Website visitors stay anonymous. Email and website reports are shown side by side, and visits are attributed to campaigns only through UTM parameters and session attribution models.
- Downloadable remote assets require a publicly reachable URL from the Mautic container so the engine can verify the file MIME type.
- Public analytics share pages need their own subdomain and aren't linked from the console yet. Tracked links (`/q/`) and pixels (`/p/`) work on the main address.
- Website reports can't be filtered by channel or screen size, because the analytics engine has no filter for them. Both still appear as breakdowns.
- Point triggers can't add contacts to workflows. Mautic 7.2.2 registers that trigger action without a working handler, so OVELIO doesn't offer it.
- Segment membership is rebuilt on the audience engine's own schedule. Mautic 7.2.2 has no API to rebuild on demand, and its member counts can be cached for up to 12 hours.
- When you press Start, segments of up to 1,000 contacts are refreshed before sending so recipients match current membership. Larger segments start from their last background sync while a fresh one runs.
- Scheduled newsletters refresh their segment recipients about 10 minutes before the send time. If the refresh hasn't finished 2 minutes before, the newsletter is held as a draft and starts as soon as it completes, marked "Sent late" with the reason. A refresh that fails unschedules the newsletter and shows why. If the worker is down at send time, the newsletter goes out to its last synced recipients and is marked as sent without a refresh. Contacts who join or leave a segment in the last 10 minutes rely on the normal contact sync.
- Unsubscribes made in the audience engine reach OVELIO within one worker cycle. Those made in the newsletter engine are found by a changed-since check, and a slower full pass catches bounces that the engine records without a timestamp. The OVELIO and engine clocks need to agree to within about a minute.
- A suppression with no matching contact (for example from an authenticated provider webhook) can't be removed from the console.
- Any newsletter unsubscribe is treated as a marketing opt-out across both sending engines, so the per-list preferences page stays off.
- Studio merge tags that the newsletter engine has no field for (company, job title, city, country, phone) come from newsletter subscriber attributes and are blank unless the subscriber carries them; workspace name, address and website are written in when the newsletter is created. In the developer preview, uploaded media is not stored, so uploaded images show as broken there.
- Website report filters follow Umami 3.5.0: "equals" and "not equals" can take several values, but a single value can't contain a comma. Other operators take one value each.
- Custom publishing domains verify by DNS TXT record and are routed by `src/proxy.ts`, but HTTPS for them needs a Caddy site block with on-demand TLS whose `ask` hook is `/api/public/domains/check`; the default Caddyfile serves only the workspace address. Set `SITES_CNAME_TARGET` and `SITES_SERVER_IP` to show the exact DNS targets.
- Landing-page form confirmation emails use an OVELIO email design and go only to people who ticked the consent box; each submission shows the mailer's result (blocked without consent, not sent without a relay).
- Analytics money totals use one currency (the default pipeline's, or the selected pipeline's); deals in other currencies are counted and named but left out of sums. Campaign ROI compares revenue in the period with the campaign's total budget and is shown only when both exist in the same currency. Attribution touchpoints are OVELIO events that carry a campaign; website visits count only when a published OVELIO page or form recorded them.
- Each client runs as a separate Compose project with its own credentials and volumes. There is no shared multi-tenant control plane.
- Gmail and Outlook mailboxes (Settings › Mailboxes) connect only after an administrator registers OAuth clients and sets `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`, plus `MAILBOX_ENCRYPTION_KEY` (generated by `deploy/init-env.sh`). The page names whichever are missing. Sync reads the last three days every 15 minutes and logs only conversations with known contacts.
- Connected mailbox threads show synced message snippets. Provider attachments and full message bodies are pending. Workspace-wide email reporting measures gateway mail and excludes connected mailbox activity.
- Sales sequences send through OVELIO's email gateway with the same consent checks as other email; "business hours" means Monday to Friday, 09:00 to 17:00 UTC. In the developer preview nothing is delivered and each step shows "Not delivered" with the reason.
