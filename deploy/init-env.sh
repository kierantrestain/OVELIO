#!/bin/sh
set -eu
umask 077
set -C

destination=${1:-.env}
if [ -e "$destination" ]; then
  echo "The environment file already exists. Existing credentials were kept." >&2
  exit 1
fi

port=${OVELIO_PORT:-3100}
mail_port=${MAILPIT_PORT:-8025}
for value in "$port" "$mail_port"; do
  case "$value" in
    ''|*[!0-9]*) echo 'Ports must be numbers.' >&2; exit 1 ;;
  esac
  if [ "${#value}" -gt 5 ] || [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    echo 'Ports must be between 1 and 65535.' >&2
    exit 1
  fi
done

cat >"$destination" <<EOF
APP_ORIGIN=http://localhost:$port
OVELIO_PORT=$port
OVELIO_BIND=127.0.0.1
MAILPIT_PORT=$mail_port
OVELIO_ADMIN_EMAIL=admin@ovelio.test
OVELIO_ADMIN_NAME=Administrator
OVELIO_ADMIN_PASSWORD=$(openssl rand -hex 16)
CONTACT_HMAC_KEY=$(openssl rand -hex 32)
SUPPRESSION_WEBHOOK_SECRET=$(openssl rand -hex 32)
MAILBOX_ENCRYPTION_KEY=$(openssl rand -hex 32)
OVELIO_DB_PASSWORD=$(openssl rand -hex 24)
MAUTIC_USERNAME=ovelio
MAUTIC_ADMIN_EMAIL=journeys@ovelio.test
MAUTIC_PASSWORD=$(openssl rand -hex 16)
MAUTIC_DB_PASSWORD=$(openssl rand -hex 24)
MAUTIC_DB_ROOT_PASSWORD=$(openssl rand -hex 24)
LISTMONK_ADMIN_USER=internal-admin
LISTMONK_ADMIN_PASSWORD=$(openssl rand -hex 16)
LISTMONK_DB_PASSWORD=$(openssl rand -hex 24)
UMAMI_PASSWORD=$(openssl rand -hex 16)
UMAMI_APP_SECRET=$(openssl rand -hex 32)
UMAMI_DB_PASSWORD=$(openssl rand -hex 24)
UMAMI_2FA_KEY=$(openssl rand -hex 32)
SMTP_FROM_EMAIL=hello@ovelio.test
MAIL_FROM_NAME=OVELIO
SMTP_MAUTIC_PASSWORD=$(openssl rand -hex 24)
SMTP_LISTMONK_PASSWORD=$(openssl rand -hex 24)
SMTP_OVELIO_PASSWORD=$(openssl rand -hex 24)
SMTP_RELAY_HOST=mailpit
SMTP_RELAY_PORT=1025
SMTP_RELAY_TLS=local
SMTP_RELAY_USERNAME=
SMTP_RELAY_PASSWORD=
SMTP_DKIM_SELECTOR=
SMTP_VERIFIED_DOMAIN=
OVELIO_HOST=
EOF
echo "Created a private environment file. Read OVELIO_ADMIN_EMAIL and OVELIO_ADMIN_PASSWORD there to sign in."
