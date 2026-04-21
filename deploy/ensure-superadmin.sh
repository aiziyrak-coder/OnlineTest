#!/usr/bin/env bash
# Serverda: /etc/onlinetest/api.env dan SUPERADMIN_PASSWORD o'qiladi, keyin superadmin yangilanadi.
# Ishlatish: sudo bash deploy/ensure-superadmin.sh
# Yoki: SUPERADMIN_PASSWORD='...' sudo -E bash deploy/ensure-superadmin.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_ENV="${API_ENV:-/etc/onlinetest/api.env}"

if [[ $(id -u) -ne 0 ]]; then
  echo "Root yoki sudo bilan ishga tushiring."
  exit 1
fi

if [[ ! -f "$API_ENV" ]]; then
  echo "Topilmadi: $API_ENV"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$API_ENV"
set +a

if [[ -z "${SUPERADMIN_PASSWORD:-}" ]]; then
  echo "api.env ga qo'shing: SUPERADMIN_PASSWORD=... (kamida 6 belgi)"
  exit 1
fi

cd "$ROOT/backend"
SID="${SUPERADMIN_ID:-superadmin}"
./.venv/bin/python manage.py ensure_superadmin --id "$SID" --password "$SUPERADMIN_PASSWORD"
echo "OK: «$SID» admin sifatida yangilandi."
