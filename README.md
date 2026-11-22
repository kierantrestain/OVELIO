# OVELIO

**Marketing. Connected.** A self-hosted console for contacts, newsletters, marketing journeys and website analytics.

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
| Worker and SMTP policy | Retried, idempotent jobs for contact and segment sync, suppression and erasure; a consent and suppression check before every relayed email. |
| Engines | Mautic 7.2.2 holds contacts, custom fields, segments, dynamic filters, tags, stages, companies, categories, lead scoring, notes, forms, assets, landing pages, dynamic web content, popups & bars, reports, webhooks and multi-action journeys. Listmonk 6.2.0 delivers newsletters, public archives, templates, media, bounces and transactional emails. Umami 3.5.0 records website traffic, realtime visitors, expanded metrics, events feed, sessions, heatmaps, saved segments & cohorts, goals, saved funnels, journeys, retention, attribution, revenue, Core Web Vitals, breakdowns, annotations, tracked links and pixels. Each keeps its own database on an isolated network. |

Interface code lives in `src/components`: `ui.tsx` is the shared OVELIO kit over Astryx (panels, metrics, charts, heatmaps, alert dialogs, drawers, filter tokens, progress bars, feedback), `shell.tsx` is the application frame with breadcrumbs and command palette, and each section has one file. Contracts shared by the console and the API are in `src/contracts`.

## First workflows

1. Import an Audience CSV with `email`, `first_name`, `last_name`, `company`, `phone`, `position`, `city`, `country`, `website`, `tags` and `consent`, plus one column per custom contact field named by its alias (download the starter CSV template inside the Import dialog). Use `opted_in` and record where and when permission was obtained for recipients who have given it.
2. Create dynamic or manual segments, custom contact and company fields (with values editable on each contact and included in exports), tags, lifecycle stages, B2B companies, lead scoring rules and triggers with their actions, and suppressions, sync segments into newsletter mailing lists, and inspect unified contact engagement, bounces and direct email sends.
3. Compose newsletters with the split HTML editor and live Desktop/Mobile preview, manage reusable campaign and transactional templates, upload images in the Media library, publish public web archives, preview and send tests to consenting contacts before starting or scheduling delivery, and inspect opens, clicks, bounces and clicked links.
4. Create journey emails, custom lead capture forms (with submissions viewer and embed code), downloadable assets, landing pages, dynamic web content slots, website popups and bars, categories, webhooks and multi-action automations (email, tags, points, segment, stage) triggered by segments or forms.
5. Add a website in Analytics and install its tracking snippet. Explore live realtime visitors, compact and expanded breakdowns across 22 dimensions, saved segments and cohorts, raw events feed, weekly heatmaps, anonymous sessions and properties, goals, saved funnels, user journeys, retention cohorts, first/last-click attribution, revenue, Core Web Vitals, annotations, tracked links and pixels with charts, and native marketing reports.

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

OVELIO defaults to no recorded marketing consent and stores consent evidence and suppression history. Native unsubscribes and permanent delivery failures can suppress the same address across both sending engines. Audience supports contact export and erasure. A keyed address digest can be retained to screen future imports against an objection. Set your retention period, privacy notice, provider contracts and lawful basis for processing before importing customer data. Assess consent requirements for tracking pixels separately from marketing emails. [ICO guidance on marketing email and PECR](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/)

Contact erasure removes the audience and subscriber records. Native form results can retain submitted values after the contact link is cleared. Include retained form results and backup retention in your operator's erasure process. [Mautic form submission storage](https://github.com/mautic/mautic/blob/7.2.2/app/bundles/FormBundle/Entity/Submission.php)

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
```

The integration and browser suites require the local Compose stack and use synthetic addresses. Set `OVELIO_TEST_CHROMIUM` to use an existing Chromium binary instead of installing one. CI also checks restart persistence, a second installation, and a restore into a fresh project. See [Third-party notices](NOTICE.md) before redistributing OVELIO.

## Known limitations

- Delivery confirmation depends on the SMTP provider. Relay acceptance is recorded, but delivered, bounce and complaint counts appear only when the provider forwards authenticated feedback to `POST /api/delivery/suppress`.
- Workflows use a step-based editor over Mautic campaigns supporting segment or form triggers, delays, open/click conditions, and email, tag, point, segment and stage actions. Free-form branching canvases and custom negative-path decision trees remain available only in the engine.
- Website visitors stay anonymous. Email and website reports are shown side by side, and visits are attributed to campaigns only through UTM parameters and session attribution models.
- Downloadable remote assets require a publicly reachable URL from the Mautic container so the engine can verify the file MIME type.
- Public analytics share pages need their own subdomain and aren't linked from the console yet. Tracked links (`/q/`) and pixels (`/p/`) work on the main address.
- Website reports can't be filtered by channel or screen size, because the analytics engine has no filter for them. Both still appear as breakdowns.
- Point triggers can't add contacts to workflows. Mautic 7.2.2 registers that trigger action without a working handler, so OVELIO doesn't offer it.
- Each client runs as a separate Compose project with its own credentials and volumes. There is no shared multi-tenant control plane.
