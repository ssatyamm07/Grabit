#!/usr/bin/env bash
# Nightly-style Postgres dump → ./backups/
# Usage: ./scripts/backup-db.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://grabit:grabit@localhost:5434/grabit}"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/grabit-$STAMP.sql.gz"

echo "Dumping $DATABASE_URL → $FILE"
pg_dump "$DATABASE_URL" | gzip > "$FILE"
ls -lh "$FILE"
echo "OK"
