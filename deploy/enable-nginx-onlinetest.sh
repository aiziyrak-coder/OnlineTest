#!/usr/bin/env bash
# Loyiha ildizidan: nginx ga FJSTI saytlarini ulash (boshqa loyihalarning default saytini o‘chirmaydi).
# Ishlatish: sudo bash deploy/enable-nginx-onlinetest.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# ONLINETEST_NGINX_HTTP_ONLY=1 — sertifikat yo'q payt; keyin onlinetest.conf (HTTPS) ga o'ting
if [[ "${ONLINETEST_NGINX_HTTP_ONLY:-}" == "1" ]]; then
  SRC="$ROOT/deploy/nginx/onlinetest.http-only.conf"
  echo "=== HTTP-only rejim (onlinetest.http-only.conf) ==="
else
  SRC="$ROOT/deploy/nginx/onlinetest.conf"
  echo "=== HTTPS rejim (onlinetest.conf) — default_server yo'q, faqat exam domenlari ==="
fi
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

if [[ "${ONLINETEST_NGINX_HTTP_ONLY:-}" != "1" ]] && [[ ! -f /etc/letsencrypt/live/onlinetest.ziyrak.org/fullchain.pem ]]; then
  echo "DIQQAT: Let's Encrypt sertifikati topilmadi (/etc/letsencrypt/live/onlinetest.ziyrak.org/)."
  echo "  nginx -t xato berishi mumkin. Variantlar:"
  echo "  1) ONLINETEST_NGINX_HTTP_ONLY=1 sudo bash deploy/enable-nginx-onlinetest.sh"
  echo "  2) sudo bash deploy/https-certbot.sh onlinetest.ziyrak.org onlinetestapi.ziyrak.org"
fi

cp -a "$SRC" "$DST_AVAILABLE"
ln -sf "$DST_AVAILABLE" "$DST_ENABLED"

nginx -t
systemctl reload nginx

echo "OK: $DST_ENABLED ulangan. Tekshiruv:"
echo "  curl -sS -H 'Host: onlinetest.ziyrak.org' http://127.0.0.1/healthz"
echo "  curl -sS -H 'Host: onlinetestapi.ziyrak.org' http://127.0.0.1/api/health"
