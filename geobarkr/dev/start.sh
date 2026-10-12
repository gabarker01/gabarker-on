#!/usr/bin/env bash
# Starts GeoBarkr locally against a throwaway Postgres running the real SQL,
# with the Supabase stand-in in server.mjs. Not used by the live site.
#   geobarkr/dev/start.sh            → http://localhost:8080/geobarkr/
# Environment: POLL_MS (default 15000), GOOGLE_MAPS_KEY (default "dev").
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
work="${GEOBARKR_DEV_DIR:-$(mktemp -d)}"
deps="$work/deps"
mkdir -p "$work"

if [ ! -d "$deps/node_modules/pg" ]; then
  mkdir -p "$deps" && (cd "$deps" && npm init -y >/dev/null && npm install --no-audit --no-fund pg@8 ws@8 >/dev/null)
fi

if [ "$(id -u)" = 0 ]; then
  chown -R postgres "$work"
  as() { su postgres -c "$(printf '%q ' "$@")"; }
else
  as() { "$@"; }
fi

as "$bin/initdb" -D "$work/data" -U postgres -A trust >/dev/null
as "$bin/pg_ctl" -D "$work/data" -o "-k $work -p 54329 -c listen_addresses=''" -l "$work/pg.log" -w start >/dev/null
trap 'as "$bin/pg_ctl" -D "$work/data" -m fast stop >/dev/null 2>&1 || true' EXIT

psql_() { as psql -h "$work" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_ -f "$here/../supabase/tests/supabase_stub.sql"
psql_ -c "set client_min_messages = warning" -f "$here/../supabase/setup.sql" >/dev/null

export DATABASE_URL="postgresql://postgres@/postgres?host=$work&port=54329"
GEOBARKR_DEPS="$deps" exec node "$here/server.mjs"
