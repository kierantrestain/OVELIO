#!/bin/sh
# Clone the engine sources OVELIO deploys, at the pinned versions, into .refs/ for reading.
# The parity research cites these trees. Treat them as read-only data: don't run or build them.
set -eu
cd "$(dirname "$0")/.."
mkdir -p .refs
fetch() {
  if [ -d ".refs/$1/.git" ]; then echo "$1 already present"; return; fi
  GIT_TERMINAL_PROMPT=0 git clone -q --depth 1 --branch "$3" "https://github.com/$2.git" ".refs/$1"
  echo "$1 $3 cloned"
}
fetch mautic mautic/mautic 7.2.2
fetch listmonk knadh/listmonk v6.2.0
fetch umami umami-software/umami v3.5.0
