#!/usr/bin/env bash
# Ikki domen uchun Let's Encrypt + nginx SSL (certbot konfigni o‘zi yangilaydi).
# Ishlatish (o‘z domenlaringiz bilan):
#   sudo bash deploy/https-certbot.sh onlinetest.sizning-domen.uz onlinetestapi.sizning-domen.uz
#
# Oldin: DNS A yozuvlari server IP ga, nginx sayt fayli yoqilgan, `sudo nginx -t` OK.

set -euo pipefail
FRONT="${1:?1-arg: frontend domen (masalan onlinetest.example.com)}"
API="${2:?2-arg: API domen (masalan onlinetestapi.example.com)}"

echo "==> certbot --nginx -d $FRONT -d $API"
sudo certbot --nginx -d "$FRONT" -d "$API"

echo
echo "==> Keyingi qadamlar (kod/muhit HTTPS ga mos):"
echo "    1) /etc/onlinetest/api.env"
echo "       ALLOWED_HOSTS=$API,127.0.0.1,localhost"
echo "       CSRF_TRUSTED_ORIGINS=https://$FRONT,https://$API"
echo "       CORS_ALLOWED_ORIGINS=https://$FRONT"
echo "       PUBLIC_APP_URL=https://$FRONT"
echo "       SECURE_PROXY_SSL_HEADER=X-Forwarded-Proto:https"
echo "       (DJANGO_SECURE_SSL=1 qo‘ymang — nginx allaqachon HTTPS; Django redirect cheksiz loop beradi)"
echo "    2) /etc/onlinetest/realtime.env — SOCKET_IO_CORS_ORIGIN=https://$FRONT"
echo "    3) frontend/.env.production — VITE_API_BASE_URL=https://$API va VITE_SOCKET_URL=https://$API"
echo "    4) cd frontend && npm run build && sudo systemctl reload nginx"
echo "    5) sudo systemctl restart onlinetest-api onlinetest-realtime"
