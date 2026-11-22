#!/bin/sh
set -eu
umask 077

if [ "$#" != 1 ]; then
  echo 'Usage: sh deploy/backup.sh NEW_DIRECTORY' >&2
  exit 2
fi
target=$1
mkdir "$target"

checksum() {
  if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

running=$(docker compose ps --status running --services)
paused=''
for component in gateway app worker smtp-policy mautic-cron mautic-worker mautic listmonk umami mailpit; do
  if printf '%s\n' "$running" | grep -Fx "$component" >/dev/null; then
    paused="$paused $component"
  fi
done
resume() {
  if [ -n "$paused" ]; then
    # Service names come from the fixed list above.
    # shellcheck disable=SC2086
    docker compose start $paused >&2 || echo 'Restart the Compose stack to resume service.' >&2
  fi
}
trap resume 0
trap 'exit 1' HUP INT TERM
if [ -n "$paused" ]; then
  # shellcheck disable=SC2086
  docker compose stop $paused >&2
fi

for component in ovelio listmonk umami; do
  docker compose exec -T "$component-db" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$target/$component.dump"
done
docker compose exec -T mautic-db sh -c 'export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; exec mariadb-dump -u root --single-transaction --routines --events --databases "$MARIADB_DATABASE"' >"$target/mautic.sql"
docker compose run --rm -T --no-deps --entrypoint tar mautic-init -C /var/www/html -cf - config docroot/media >"$target/mautic.tar"
docker compose run --rm -T --no-deps --entrypoint tar listmonk-init -C /setup -cf - token >"$target/listmonk-access.tar"
docker compose run --rm -T --no-deps --entrypoint tar listmonk -C /listmonk/uploads -cf - . >"$target/listmonk-uploads.tar"

(cd "$target" && checksum ovelio.dump listmonk.dump umami.dump mautic.sql mautic.tar listmonk-access.tar listmonk-uploads.tar >SHA256SUMS)
echo 'Backup verified with checksums. Store it with the matching environment credentials in private, encrypted storage.'
