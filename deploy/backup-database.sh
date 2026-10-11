#!/usr/bin/env bash
# PostgreSQL zaxirasi: foydalanuvchilar, test banki, imtihon natijalari.
#
# Bu server Docker Compose bilan ishlaydi, shuning uchun dump `db` konteyneri
# ichidan olinadi — hostda pg_dump bo'lishi shart emas va versiya farqi
# muammo qilmaydi. Ilgari bu skript bare-metal yo'llarni (/var/www/onlinetest,
# /etc/onlinetest/api.env) va hostdagi pg_dump ni kutardi: shu sababli hech
# qachon ishlamagan va cron'ga ham qo'yilmagan — 21.09.2026 gacha bazaning
# birorta avtomatik zaxirasi yo'q edi.
#
# Cron (kuniga ikki marta):
#   10 2,14 * * * /home/onlinetest/deploy/backup-database.sh >> /home/onlinetest/backups/db/backup.log 2>&1
set -euo pipefail

ROOT="${ONLINETEST_ROOT:-/home/onlinetest}"
DEST="${BACKUP_DIR:-$ROOT/backups/db}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
DC="docker compose -f $ROOT/docker-compose.yml -f $ROOT/docker-compose.prod.yml"

cd "$ROOT"

# DATABASE_URL — compose'ning env_file'idan (repo'ga tushmaydi).
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/backend/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | tail -1 | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | tail -1 | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup-database] Xato: DATABASE_URL topilmadi (backend/.env yoki .env)" >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/db-$STAMP.sql.gz"
TMP="$OUT.part"

# Dump konteyner ichida olinadi va stdout orqali hostga siqib yoziladi.
if ! $DC exec -T db sh -c 'pg_dump "$0"' "$DATABASE_URL" </dev/null | gzip > "$TMP"; then
  rm -f "$TMP"
  echo "[backup-database] XATO: pg_dump bajarilmadi" >&2
  exit 1
fi

# Bo'sh yoki shubhali kichik fayl zaxira hisoblanmaydi — shunday fayl
# saqlanib qolsa, "zaxira bor" degan yolg'on xotirjamlik beradi.
SIZE="$(stat -c %s "$TMP" 2>/dev/null || echo 0)"
if [[ "$SIZE" -lt 100000 ]]; then
  rm -f "$TMP"
  echo "[backup-database] XATO: dump juda kichik ($SIZE bayt) — saqlanmadi" >&2
  exit 1
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT" 2>/dev/null || true
find "$DEST" -maxdepth 1 -name 'db-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true
find "$DEST" -maxdepth 1 -name 'db-*.sql.gz.part' -type f -mtime +1 -delete 2>/dev/null || true
echo "[backup-database] OK $OUT ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "$SIZE") )"

# Tiklash: gunzip -c db-YYYYMMDD-HHMMSS.sql.gz | docker compose ... exec -T db psql "$DATABASE_URL"
