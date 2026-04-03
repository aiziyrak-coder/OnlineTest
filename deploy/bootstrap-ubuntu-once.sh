#!/usr/bin/env bash
# Ubuntu droplet: nginx, git, Python venv, Node 20, klon, env, systemd, build, nginx ulash.
# Bir marta root:  CERTBOT_EMAIL=you@mail.com bash deploy/bootstrap-ubuntu-once.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/aiziyrak-coder/OnlineTest.git}"
APP="${APP_PATH:-/var/www/onlinetest}"

if [[ $(id -u) -ne 0 ]]; then
  echo "Faqat root yoki sudo -i"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y nginx git python3-venv python3-pip curl ca-certificates certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null || true)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

mkdir -p "$APP" /etc/onlinetest
if [[ ! -d "$APP/.git" ]]; then
  git clone "$REPO_URL" "$APP"
else
  git -C "$APP" pull origin main || true
fi

[[ -f /etc/onlinetest/api.env ]] || cp "$APP/deploy/env.api.example" /etc/onlinetest/api.env
[[ -f /etc/onlinetest/realtime.env ]] || cp "$APP/deploy/env.realtime.example" /etc/onlinetest/realtime.env
chmod 600 /etc/onlinetest/*.env 2>/dev/null || true

echo ">>> /etc/onlinetest/api.env ichida DJANGO_SECRET_KEY, JWT_SECRET to‘ldiring, keyin qayta ishga tushiring."

cp "$APP/deploy/systemd/onlinetest-api.service" /etc/systemd/system/
cp "$APP/deploy/systemd/onlinetest-realtime.service" /etc/systemd/system/
systemctl daemon-reload

chown -R root:root "$APP"
# build root sifatida
bash "$APP/deploy/remote-update.sh" --no-git || true

# static va kod nginx / gunicorn uchun o‘qiladi
chown -R www-data:www-data "$APP/frontend/dist" 2>/dev/null || true
chown -R www-data:www-data "$APP/backend" 2>/dev/null || true

systemctl enable onlinetest-api onlinetest-realtime 2>/dev/null || true
systemctl restart onlinetest-api onlinetest-realtime 2>/dev/null || true

bash "$APP/deploy/enable-nginx-onlinetest.sh"

if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  certbot --nginx -d onlinetest.ziyrak.org -d onlinetestapi.ziyrak.org \
    --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect || true
else
  echo ">>> HTTPS: CERTBOT_EMAIL=... bilan qayta ishga tushiring yoki qo‘lda: certbot --nginx -d onlinetest.ziyrak.org -d onlinetestapi.ziyrak.org"
fi

echo "Bootstrap yakunlandi."
