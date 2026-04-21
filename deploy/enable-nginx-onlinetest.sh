#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/deploy/nginx/onlinetest.conf"
if [[ "${ONLINETEST_NGINX_HTTP_ONLY:-}" == "1" ]]; then
  SRC="$ROOT/deploy/nginx/onlinetest.http-only.conf"
elif [[ ! -f /etc/letsencrypt/live/online-imtixon.uz/fullchain.pem ]]; then
  # HTTPS bloki fullchain.pem siz ishlamaydi — nginx yiqilmasligi uchun HTTP-only
  echo "[enable-nginx] SSL sertifikat yo'q (/etc/letsencrypt/live/online-imtixon.uz/)."
  echo "[enable-nginx] Vaqtincha HTTP-only (80). Keyin: DNS (api A yozuvi) + certbot, so'ng: sudo bash deploy/enable-nginx-onlinetest.sh"
  SRC="$ROOT/deploy/nginx/onlinetest.http-only.conf"
fi

DST_AVAILABLE="/etc/nginx/sites-available/fjsti-onlinetest.conf"
DST_ENABLED="/etc/nginx/sites-enabled/fjsti-onlinetest.conf"

if [[ $(id -u) -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/enable-nginx-onlinetest.sh"
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "Missing file: $SRC"
  exit 1
fi

grep -rE "server_name.*(online-imtixon\.uz|api\.online-imtixon\.uz)" /etc/nginx/sites-enabled/ 2>/dev/null | grep -v fjsti-onlinetest || true

cp -a "$SRC" "$DST_AVAILABLE"
ln -sf "$DST_AVAILABLE" "$DST_ENABLED"
nginx -t
systemctl reload nginx

echo "OK: $DST_ENABLED enabled"
echo "curl -sS -H 'Host: online-imtixon.uz' http://127.0.0.1/healthz"
echo "curl -sS -H 'Host: api.online-imtixon.uz' http://127.0.0.1/api/health"
