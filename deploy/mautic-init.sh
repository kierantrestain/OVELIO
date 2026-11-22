#!/bin/sh
set -eu
cd /var/www/html

if [ -f config/local.php ] &&
  php -r 'include "config/local.php"; exit(empty($parameters["db_driver"]) || empty($parameters["site_url"]));'; then
  exit 0
fi

mkdir -p config var/cache var/logs docroot/media
chown -R www-data:www-data config var docroot/media
# PHP writes generated DB/API settings as the same user used by the web and worker services.
exec runuser -u www-data -- php bin/console mautic:install --force --no-interaction --no-ansi \
  --db_driver=pdo_mysql --db_host="$MAUTIC_DB_HOST" --db_port="$MAUTIC_DB_PORT" \
  --db_name="$MAUTIC_DB_DATABASE" --db_user="$MAUTIC_DB_USER" --db_password="$MAUTIC_DB_PASSWORD" \
  --admin_username="$MAUTIC_USERNAME" --admin_email="$MAUTIC_ADMIN_EMAIL" \
  --admin_password="$MAUTIC_PASSWORD" "$APP_ORIGIN"
