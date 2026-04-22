#!/usr/bin/env bash
# Socket.io 502: nginx → 127.0.0.1:9082 ulanmayapti. Serverda ishga tushiring.
set -euo pipefail

echo "=== node ==="
command -v node && node -v || echo "node yo'q — o'rnating: apt install nodejs (>=20)"

echo "=== onlinetest-realtime ==="
systemctl is-active onlinetest-realtime 2>/dev/null || true
systemctl status onlinetest-realtime --no-pager -l 2>/dev/null | tail -35 || true

echo "=== 9082 tinglayaptimi ==="
ss -tlnp 2>/dev/null | grep -E ':9082\b' || echo "9082 LISTEN yo'q — servis ishlamayapti."

echo "=== realtime health (loopback) ==="
curl -fsS --max-time 3 "http://127.0.0.1:9082/health" && echo "" || echo "health javob bermadi (jarayon yo'q yoki port boshqacha)."

echo "=== realtime.env (JWT yashirin) ==="
if [[ -f /etc/onlinetest/realtime.env ]]; then
  grep -E '^(NODE_ENV|REALTIME_PORT|REALTIME_BIND|JWT_SECRET|SOCKET_IO_CORS_ORIGIN)=' /etc/onlinetest/realtime.env \
    | sed 's/^JWT_SECRET=.*/JWT_SECRET=<hidden>/' || true
else
  echo "realtime.env yo'q"
fi

echo ""
echo "Tuzatish: sudo bash deploy/remote-update.sh  yoki  sudo systemctl restart onlinetest-realtime"
echo "JWT < 24 yoki bo'sh bo'lsa realtime chiqadi — api.env ni tekshiring yoki vaqtincha REALTIME_ALLOW_NO_JWT=1 (xavfli)."
