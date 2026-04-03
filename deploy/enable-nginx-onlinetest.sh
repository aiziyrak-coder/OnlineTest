#!/usr/bin/env bash
# Loyiha ildizidan: nginx ga FJSTI saytlarini ulash (boshqa loyihalarning default saytini o‘chirmaydi).
# Ishlatish: sudo bash deploy/enable-nginx-onlinetest.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/deploy/nginx/onlinetest.conf"
DST_AVAILABLE="/etc/nginx/sites-available/fjsti-onlinetest.conf"
DST_ENABLED="/etc/nginx/sites-enabled/fjsti-onlinetest.conf"

if [[ $(id -u) -ne 0 ]]; then
  echo "sudo bilan ishga tushiring: sudo bash deploy/enable-nginx-onlinetest.sh"
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "Topilmadi: $SRC"
  exit 1
fi

echo "=== Boshqa konfiglarda shu domenlar bormi? (ixtiyoriy tekshiruv) ==="
grep -rE 'server_name.*onlinetest(\.ziyrak)?\.org' /etc/nginx/sites-enabled/ 2>/dev/null | grep -v fjsti-onlinetest || true

cp -a "$SRC" "$DST_AVAILABLE"
ln -sf "$DST_AVAILABLE" "$DST_ENABLED"

nginx -t
systemctl reload nginx

echo "OK: $DST_ENABLED ulangan. Tekshiruv:"
echo "  curl -sS -H 'Host: onlinetest.ziyrak.org' http://127.0.0.1/healthz"
echo "  curl -sS -H 'Host: onlinetestapi.ziyrak.org' http://127.0.0.1/api/health"
