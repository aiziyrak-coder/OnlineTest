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

# nginx (www-data) har bir ota-katalogda "x" bo'lmasa fayllarni o'qiy olmaydi → 403 Forbidden.
# Faqat $ROOT ga chmod yetarli emas (masalan: /home/user/repo — /home yoki /home/user 711 emas).
ensure_world_traverse_to_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  local p
  p="$(cd "$dir" && pwd -P)"
  while [[ "$p" != "/" ]]; do
    if [[ "$p" == "/root" ]]; then
      echo "[enable-nginx] WARN: loyiha /root ostida — nginx www-data kirmaydi. Kodni /var/www/... ga ko'chiring yoki ACL qo'lda sozlang."
      break
    fi
    chmod o+rx "$p" 2>/dev/null || true
    p="$(dirname "$p")"
  done
}

# SPA: nginx www-data o'qishi + katalog bo'ylab "x" (403 oldini olish)
DIST="$ROOT/frontend/dist"
if [[ -d "$DIST" ]]; then
  ensure_world_traverse_to_dir "$DIST"
  chmod o+rx "$ROOT/frontend" 2>/dev/null || true
  chmod o+rx "$ROOT" 2>/dev/null || true
  if id www-data &>/dev/null; then
    chown -R www-data:www-data "$DIST" 2>/dev/null || true
  fi
  chmod -R a+rX "$DIST" 2>/dev/null || true
else
  echo "[enable-nginx] WARN: $DIST yo'q — frontend uchun 'npm run build' qiling, aks holda SPA 403/404 berishi mumkin."
fi

nginx -t
systemctl reload nginx

echo "OK: $DST_ENABLED enabled"
echo "curl -sS -H 'Host: online-imtixon.uz' http://127.0.0.1/healthz"
echo "curl -sS -H 'Host: api.online-imtixon.uz' http://127.0.0.1/api/health"
