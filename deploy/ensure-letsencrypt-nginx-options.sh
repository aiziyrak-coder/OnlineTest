#!/usr/bin/env bash
# Certbot nginx plaginiga kerak bo'lgan SSL parametrlar fayli (ba'zi serverlarda apt dan keyin yo'q).
# Ishlatish: sudo bash deploy/ensure-letsencrypt-nginx-options.sh
set -euo pipefail

DEST="/etc/letsencrypt/options-ssl-nginx.conf"
mkdir -p /etc/letsencrypt

if [[ -f "$DEST" ]]; then
  echo "OK: $DEST allaqachon bor."
  exit 0
fi

URL="https://raw.githubusercontent.com/certbot/certbot/v3.0.0/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf"
if curl -fsSL --max-time 30 "$URL" -o "$DEST.tmp" 2>/dev/null; then
  mv "$DEST.tmp" "$DEST"
  chmod 644 "$DEST"
  echo "OK: $DEST yuklandi (certbot rasmiy nusxa)."
  exit 0
fi

rm -f "$DEST.tmp" 2>/dev/null || true
cat > "$DEST" <<'EOF'
# This file contains important security parameters (certbot bilan mos).
# Manba: https://ssl-config.mozilla.org

ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
EOF
chmod 644 "$DEST"
echo "OK: $DEST yaratildi (lokal nusxa)."
