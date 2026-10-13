#!/usr/bin/env bash
# Runs GeoBarkr's SQL (migrations, seed, then the tests) on a throwaway local
# Postgres 16 that mimics Supabase. Not needed to run the site; for checking
# SQL changes. Usage: geobarkr/supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
sql="$here/.."
bin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
tmp="$(mktemp -d)"
trap '"$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

if [ "$(id -u)" = 0 ]; then
  chown -R postgres "$tmp"
  as() { su postgres -c "$(printf '%q ' "$@")"; }
else
  as() { "$@"; }
fi

as "$bin/initdb" -D "$tmp/data" -U postgres -A trust >/dev/null
as "$bin/pg_ctl" -D "$tmp/data" -o "-k $tmp -p 54329 -c listen_addresses=''" -l "$tmp/log" -w start >/dev/null

run() { as psql -h "$tmp" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
run -f "$here/supabase_stub.sql"
run -c "set client_min_messages = warning" -f "$sql/setup.sql" >/dev/null
run -f "$sql/setup.sql" >/dev/null 2>&1   # setup must be safe to run twice
run -f "$here/rls_test.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //' -e '/^$/d'
