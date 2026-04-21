#!/usr/bin/env bash
# Ikki domen uchun Let's Encrypt + nginx SSL (certbot konfigni o‘zi yangilaydi).
# Ishlatish (o‘z domenlaringiz bilan):
#   sudo bash deploy/https-certbot.sh onlinetest.sizning-domen.uz onlinetestapi.sizning-domen.uz
# API DNS yo‘q bo‘lsa — faqat frontend domeni (bitta sertifikat):
#   sudo bash deploy/https-certbot.sh onlinetest.sizning-domen.uz
#
# Oldin: DNS A yozuvlari server IP ga, nginx sayt fayli yoqilgan, `sudo nginx -t` OK.

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$DEPLOY_DIR/ensure-letsencrypt-nginx-options.sh" ]]; then
  if [[ $(id -u) -eq 0 ]]; then
    bash "$DEPLOY_DIR/ensure-letsencrypt-nginx-options.sh"
  else
    sudo bash "$DEPLOY_DIR/ensure-letsencrypt-nginx-options.sh"
  fi
fi

FRONT="${1:?1-arg: frontend domen (masalan onlinetest.example.com)}"
API="${2:-}"

if [[ -n "$API" ]]; then
  echo "==> certbot --nginx -d $FRONT -d $API"
  sudo certbot --nginx -d "$FRONT" -d "$API"
else
  echo "==> certbot --nginx -d $FRONT  (faqat apex; API uchun alohida A yozuvi bo‘lgach: $0 $FRONT api.$FRONT)"
  sudo certbot --nginx -d "$FRONT"
fi

echo
echo "==> Keyingi qadamlar (kod/muhit HTTPS ga mos):"
echo "    1) /etc/onlinetest/api.env"
if [[ -n "$API" ]]; then
  echo "       ALLOWED_HOSTS=$FRONT,$API,127.0.0.1,localhost"
  echo "       CSRF_TRUSTED_ORIGINS=https://$FRONT,https://$API"
  echo "       CORS_ALLOWED_ORIGINS=https://$FRONT"
  echo "       PUBLIC_APP_URL=https://$FRONT"
else
  echo "       ALLOWED_HOSTS=$FRONT,127.0.0.1,localhost"
  echo "       CSRF_TRUSTED_ORIGINS=https://$FRONT"
  echo "       CORS_ALLOWED_ORIGINS=https://$FRONT"
  echo "       PUBLIC_APP_URL=https://$FRONT"
  echo "       (API bir domen: VITE bo'sh yoki https://$FRONT — /api/ nginx orqali)"
fi
echo "       SECURE_PROXY_SSL_HEADER=X-Forwarded-Proto:https"
echo "       (DJANGO_SECURE_SSL=1 qo‘ymang — nginx allaqachon HTTPS; Django redirect cheksiz loop beradi)"
echo "    2) /etc/onlinetest/realtime.env — SOCKET_IO_CORS_ORIGIN=https://$FRONT"
if [[ -n "$API" ]]; then
  echo "    3) frontend/.env.production — VITE_API_BASE_URL=https://$API va VITE_SOCKET_URL=https://$API"
else
  echo "    3) frontend/.env.production — VITE_API_BASE_URL= va VITE_SOCKET_URL= (bo'sh = bir domen) yoki https://$FRONT"
fi
echo "    4) cd frontend && npm run build && sudo systemctl reload nginx"
echo "    5) sudo bash deploy/enable-nginx-onlinetest.sh && sudo systemctl restart onlinetest-api onlinetest-realtime"
