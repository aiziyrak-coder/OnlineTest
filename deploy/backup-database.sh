#!/usr/bin/env bash
# SQLite zaxirasi: foydalanuvchilar, test bazasi, imtihon natijalari — barchasi shu faylda.
# Cron: kuniga 2 marta masalan 03:15 va 15:15
#   15 3,15 * * * root /var/www/onlinetest/deploy/backup-database.sh >> /var/log/onlinetest-backup.log 2>&1
set -euo pipefail

ROOT="${ONLINETEST_ROOT:-/var/www/onlinetest}"
DB="$ROOT/backend/db.sqlite3"
DEST="${BACKUP_DIR:-/var/backups/onlinetest}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-45}"

mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$DEST/db-$STAMP.sqlite3"

if [[ ! -f "$DB" ]]; then
  echo "[backup-database] Xato: baz topilmadi: $DB"
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$OUT'"
else
  cp -a "$DB" "$OUT"
  echo "[backup-database] Ogohlantirish: sqlite3 CLI yo'q — oddiy nusxa olindi (tavsiya: apt install sqlite3)"
fi

chmod 600 "$OUT" 2>/dev/null || true
find "$DEST" -maxdepth 1 -name 'db-*.sqlite3' -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup-database] OK $OUT"
