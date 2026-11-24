#!/usr/bin/env bash
# Zkouška migrací Supabase na dočasném Postgresu (16+): zástupné auth schéma, migrace, testy pravidel přístupu.
# Použití: bash scripts/db/test.sh   (spouští Postgres jako uživatel postgres v dočasné složce)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
chown postgres "$TMP" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
cleanup() { run "$BIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
run "$BIN/initdb -D $TMP/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
run "$BIN/pg_ctl -D $TMP/data -o '-k $TMP -p 54329 -c listen_addresses=' -l $TMP/log start -w" >/dev/null
PSQL="PGOPTIONS=-cclient_min_messages=warning $BIN/psql -h $TMP -p 54329 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1"
run "$PSQL -f $ROOT/scripts/db/auth_stub.sql"
run "$PSQL -f $ROOT/scripts/db/app_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do run "$PSQL -f $f"; done
run "$PSQL -f $ROOT/scripts/db/test_policies.sql"
