#!/bin/sh
set -eu

if [ "$#" != 1 ]; then
  echo 'Usage: sh deploy/restore.sh BACKUP_DIRECTORY' >&2
  exit 2
fi
source_dir=$1

# Verify only known archive names in the manifest, before starting any services.
(
  cd "$source_dir"
  files='ovelio.dump listmonk.dump umami.dump mautic.sql mautic.tar listmonk-access.tar listmonk-uploads.tar'
  if [ "$(wc -l <SHA256SUMS | tr -d ' ')" != 7 ]; then
    echo 'Invalid backup manifest.' >&2
    exit 1
  fi
  for file in $files; do
    if ! awk -v name="$file" '($2 == name || $2 == "*" name) && length($1) == 64 && $1 ~ /^[0-9a-f]+$/ { matches++ } END { exit matches != 1 }' SHA256SUMS; then
      echo 'Invalid backup manifest.' >&2
      exit 1
    fi
  done
  if command -v sha256sum >/dev/null; then
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 -c SHA256SUMS
  fi
)

# A fresh Compose project isolates this restore from any current installation.
# Source credentials and encryption keys must match the backup.
docker compose up -d --wait --wait-timeout 180 ovelio-db listmonk-db umami-db mautic-db
for component in ovelio listmonk umami; do
  exists=$(docker compose exec -T "$component-db" sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema()"')
  if [ "$exists" != 0 ]; then
    echo "The $component database contains data. Select a fresh Compose project." >&2
    exit 1
  fi
done
exists=$(docker compose exec -T mautic-db sh -c 'export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; exec mariadb -u root "$MARIADB_DATABASE" -sNe "SELECT count(*) FROM information_schema.tables WHERE table_schema = database()"')
if [ "$exists" != 0 ]; then
  echo 'The journey database contains data. Select a fresh Compose project.' >&2
  exit 1
fi

for component in ovelio listmonk umami; do
  docker compose exec -T "$component-db" sh -c 'exec pg_restore --exit-on-error --single-transaction --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <"$source_dir/$component.dump"
done
docker compose exec -T mautic-db sh -c 'export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; exec mariadb -u root "$MARIADB_DATABASE"' <"$source_dir/mautic.sql"
docker compose run --rm -T --no-deps --entrypoint tar mautic-init -C /var/www/html -xf - <"$source_dir/mautic.tar"
docker compose run --rm -T --no-deps --entrypoint tar listmonk-init -C /setup -xf - <"$source_dir/listmonk-access.tar"
docker compose run --rm -T --no-deps --entrypoint tar listmonk -C /listmonk/uploads -xf - <"$source_dir/listmonk-uploads.tar"

# Restoring a snapshot can otherwise revive previously valid browser sessions.
docker compose exec -T ovelio-db sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM sessions"' >/dev/null
echo 'Restored the databases and engine files. Start Compose and sign in again to verify the restored installation.'
