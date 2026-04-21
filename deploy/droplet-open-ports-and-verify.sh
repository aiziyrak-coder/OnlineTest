#!/usr/bin/env bash
# Droplet ichida (root): firewall + nginx + xizmatlar + mahalliy tekshiruv.
# Sizning kompyuteringizdan: ssh root@209.38.239.183
# Keyin:
#   curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-open-ports-and-verify.sh | bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "=== 1) UFW: 22, 80, 443 ==="
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH comment "SSH" 2>/dev/null || true
  ufw allow 80/tcp comment "HTTP" 2>/dev/null || true
  ufw allow 443/tcp comment "HTTPS" 2>/dev/null || true
  yes | ufw enable 2>/dev/null || true
  ufw status verbose || true
else
  echo "ufw o'rnatilmagan — o'tkazib yuborildi."
fi

echo "=== 2) Nginx ==="
systemctl enable nginx 2>/dev/null || true
systemctl start nginx 2>/dev/null || true
nginx -t
systemctl reload nginx 2>/dev/null || true

echo "=== 3) Loyiha xizmatlari ==="
systemctl daemon-reload 2>/dev/null || true
systemctl restart onlinetest-api 2>/dev/null && echo "onlinetest-api: OK" || echo "onlinetest-api: yo'q yoki xato (avval bootstrap qiling)"
systemctl restart onlinetest-realtime 2>/dev/null && echo "onlinetest-realtime: OK" || echo "onlinetest-realtime: yo'q yoki xato"

echo "=== 4) Mahalliy health (nginx virtual host) ==="
set +e
curl -fsS --max-time 5 -H "Host: online-imtixon.uz" http://127.0.0.1/healthz && echo "  frontend /healthz: OK" || echo "  frontend /healthz: FAIL"
curl -fsS --max-time 8 -H "Host: api.online-imtixon.uz" http://127.0.0.1/api/health && echo "  api /api/health: OK" || echo "  api /api/health: FAIL (nginx yoki gunicorn tekshiring)"
set -e

PUB_IP="$(curl -4 -fsS --max-time 5 ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 5 icanhazip.com 2>/dev/null || echo "209.38.239.183")"
echo ""
echo "=== 5) SIZ qilishingiz kerak (men buni serverda qila olmayman) ==="
echo "A) DNS (registrar / Cloudflare):"
echo "     A    @                    -> ${PUB_IP}"
echo "     A    api                 -> ${PUB_IP}"
echo "   (yoki CNAME api -> online-imtixon.uz — lekin A ikkalasiga ham bir xil IP osonroq)"
echo ""
echo "B) DigitalOcean → Networking → Firewalls:"
echo "     Inbound: TCP 22, 80, 443  (source: 0.0.0.0/0 va ::/0)"
echo "     Firewall dropletga bog'langan bo'lishi kerak."
echo ""
echo "C) Birinchi o'rnatish bo'lmasa:"
echo "     curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-bootstrap-from-console.sh | bash"
echo ""
