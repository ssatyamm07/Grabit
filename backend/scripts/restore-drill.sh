#!/usr/bin/env bash
# Restore drill: restore latest (or given) dump into a throwaway DB, then drop it.
# Usage: ./scripts/restore-drill.sh [path/to/dump.sql.gz]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://grabit:grabit@localhost:5434/grabit}"
DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  DUMP="$(ls -t "$ROOT"/backups/grabit-*.sql.gz 2>/dev/null | head -1 || true)"
fi
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "No dump found. Run ./scripts/backup-db.sh first, or pass a .sql.gz path."
  exit 1
fi

# Parse host/port/user from URL roughly for createdb
DRILL_DB="grabit_restore_drill"
echo "Restore drill using dump: $DUMP → database $DRILL_DB"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DRILL_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DRILL_DB;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DRILL_DB;"

# Swap db name in URL
DRILL_URL="$(echo "$DATABASE_URL" | sed -E "s#/[^/?]+(\\?|$)#/$DRILL_DB\\1#")"
gunzip -c "$DUMP" | psql "$DRILL_URL" -v ON_ERROR_STOP=1 >/dev/null
COUNT="$(psql "$DRILL_URL" -tAc "SELECT COUNT(*) FROM schema_migrations")"
echo "Restored OK — schema_migrations rows: $COUNT"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DRILL_DB;"
echo "Drill complete (throwaway DB dropped)."
