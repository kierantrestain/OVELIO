#!/bin/sh
set -eu
umask 077
cd /listmonk

if [ ! -s /setup/token ]; then
  # The installer emits the one-time API token. Never send its output to Docker logs.
  install_log=$(mktemp /setup/install.XXXXXX)
  trap 'rm -f "$install_log" /setup/token.new' 0 HUP INT TERM
  if ! ./listmonk --install --idempotent --yes --config='' >"$install_log" 2>&1; then
    echo 'Newsletter engine installation failed. Check database health and bootstrap credentials.' >&2
    exit 1
  fi
  sed -n 's/^export LISTMONK_ADMIN_API_TOKEN="\([^"]*\)"$/\1/p' "$install_log" > /setup/token.new
  if [ ! -s /setup/token.new ]; then
    echo 'Newsletter API token is missing. Restore the matching access volume alongside the database.' >&2
    exit 1
  fi
  chown 1000:1000 /setup/token.new
  chmod 0400 /setup/token.new
  mv /setup/token.new /setup/token
  rm -f "$install_log"
  trap - 0 HUP INT TERM
fi
exec ./listmonk --upgrade --yes --config=''
