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

## First workflows

1. Import an Audience CSV with `email`, `first_name`, `last_name`, `company`, `tags` and `consent`. Only `email` is required. Use `opted_in` and record where and when permission was obtained for recipients who have given it.
2. Create a segment, add contacts from their detail pages, and sync the segment. The corresponding list appears in Campaigns when the worker has finished.
3. Create a newsletter draft, preview the email and send a test to a contact with recorded consent before starting or scheduling the campaign.
4. Create a journey email and an automation for a trigger segment. Add steps and enable it. Adding a consenting contact to the segment enrolls them on the engine's next update.
5. Add a website in Analytics and install its tracking snippet. Create a goal for a page or a custom event. Use separate goal and campaign reports when the connection between a visit and a recipient has not been established.

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

```sh
docker compose -f compose.yaml -f compose.production.yaml build app
docker compose -f compose.yaml -f compose.production.yaml up -d --wait --wait-timeout 420
```

Caddy terminates HTTPS. The engines each use their own database on an isolated network. Their management APIs, databases and SMTP policy listener have no published ports. Only tracking, public forms and email links are forwarded to engines. The SMTP policy service checks consent and suppression before relaying email over TLS. Verify DNS, the provider's sender authorization, a seed-inbox delivery and authenticated feedback before a production send. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

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

The integration and browser suites require the local Compose stack and use synthetic addresses. CI also checks restart persistence, a second installation, and a restore into a fresh project. See [Third-party notices](NOTICE.md) before redistributing OVELIO.
