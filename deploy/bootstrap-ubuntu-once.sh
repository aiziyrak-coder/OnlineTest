#!/usr/bin/env bash
# Ubuntu droplet: nginx, git, Python venv, Node 20, klon, env (avto kalit), systemd, build, nginx.
# Bir marta root:
#   sudo bash deploy/bootstrap-ubuntu-once.sh
#   sudo CERTBOT_EMAIL=you@mail.com FRONT_DOMAIN=onlinetest.ziyrak.org API_DOMAIN=onlinetestapi.ziyrak.org bash deploy/bootstrap-ubuntu-once.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/aiziyrak-coder/OnlineTest.git}"
APP="${APP_PATH:-/var/www/onlinetest}"
FRONT_DOMAIN="${FRONT_DOMAIN:-onlinetest.ziyrak.org}"
API_DOMAIN="${API_DOMAIN:-onlinetestapi.ziyrak.org}"

if [[ $(id -u) -ne 0 ]]; then
  echo "Faqat root yoki sudo -i"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y nginx git python3-venv python3-pip curl ca-certificates certbot python3-certbot-nginx openssl

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null || true)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

mkdir -p "$APP" /etc/onlinetest

if [[ ! -d "$APP/.git" ]]; then
  git clone "$REPO_URL" "$APP"
else
  git -C "$APP" fetch origin
  git -C "$APP" reset --hard "origin/HEAD"
fi

write_frontend_env() {
  cat > "$APP/frontend/.env.production" <<EOF
VITE_API_BASE_URL=https://${API_DOMAIN}
VITE_SOCKET_URL=https://${API_DOMAIN}
EOF
}

ensure_api_env() {
  local f=/etc/onlinetest/api.env
  local need=0
  if [[ ! -f "$f" ]]; then
    need=1
  elif ! grep -qE '^DJANGO_SECRET_KEY=[^[:space:]].{39,}' "$f" 2>/dev/null; then
    need=1
  elif ! grep -qE '^JWT_SECRET=[^[:space:]].{23,}' "$f" 2>/dev/null; then
    need=1
  fi

  if [[ "$need" -eq 1 ]]; then
    umask 077
    local sk jk adm
    sk=$(openssl rand -base64 48 | tr -d '\n')
    jk=$(openssl rand -base64 36 | tr -d '\n')
    adm=$(openssl rand -hex 10)
    cat > "$f" <<EOF
DJANGO_SECRET_KEY=${sk}
JWT_SECRET=${jk}
ADMIN_BOOTSTRAP_PASSWORD=${adm}
DJANGO_DEBUG=0
ALLOWED_HOSTS=${API_DOMAIN},127.0.0.1,localhost
CSRF_TRUSTED_ORIGINS=https://${FRONT_DOMAIN},https://${API_DOMAIN}
CORS_ALLOWED_ORIGINS=https://${FRONT_DOMAIN}
PUBLIC_APP_URL=https://${FRONT_DOMAIN}
SECURE_PROXY_SSL_HEADER=X-Forwarded-Proto:https
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
EOF
    chmod 600 "$f"
    umask 077
    {
      echo "Login: admin"
      echo "Parol: ${adm}"
      echo "Fayl: /etc/onlinetest/api.env (ADMIN_BOOTSTRAP_PASSWORD)"
    } > /root/onlinetest-admin-once.txt
    chmod 600 /root/onlinetest-admin-once.txt
    echo ">>> Admin foydalanuvchi: /root/onlinetest-admin-once.txt (bir marta o‘qing, keyin o‘chiring)."
  else
    chmod 600 "$f" 2>/dev/null || true
  fi
}

ensure_realtime_env() {
  local f=/etc/onlinetest/realtime.env
  if [[ ! -f "$f" ]]; then
    cp "$APP/deploy/env.realtime.example" "$f"
    sed -i "s#^SOCKET_IO_CORS_ORIGIN=.*#SOCKET_IO_CORS_ORIGIN=https://${FRONT_DOMAIN}#" "$f" 2>/dev/null || true
  fi
  chmod 600 "$f" 2>/dev/null || true
}

ensure_deploy_hook_env() {
  local f=/etc/onlinetest/deploy-hook.env
  if [[ ! -f "$f" ]]; then
    local sec
    sec=$(openssl rand -hex 32)
    umask 077
    cat > "$f" <<EOF
DEPLOY_HOOK_SECRET=${sec}
DEPLOY_HOOK_PORT=9085
DEPLOY_APP_ROOT=${APP}
EOF
    chmod 600 "$f"
    {
      echo "GitHub → Settings → Secrets → Actions:"
      echo "  DEPLOY_HOOK_SECRET=${sec}"
      echo "  DEPLOY_HOOK_URL=https://${API_DOMAIN}/__internal_deploy/v1"
      echo "Certbot dan keyin ham xuddi shu https URL ishlatiladi."
    } > /root/onlinetest-github-webhook-once.txt
    chmod 600 /root/onlinetest-github-webhook-once.txt
    echo ">>> SSH kalitsiz deploy uchun: /root/onlinetest-github-webhook-once.txt"
  else
    chmod 600 "$f" 2>/dev/null || true
  fi
}

ensure_api_env
ensure_realtime_env
write_frontend_env

cp "$APP/deploy/systemd/onlinetest-api.service" /etc/systemd/system/
cp "$APP/deploy/systemd/onlinetest-realtime.service" /etc/systemd/system/
systemctl daemon-reload

chown -R root:root "$APP"
bash "$APP/deploy/remote-update.sh" --no-git

set -a
# shellcheck source=/dev/null
source /etc/onlinetest/api.env
set +a
(
  cd "$APP/backend"
  ./.venv/bin/python manage.py bootstrap_exam
)

chown -R www-data:www-data "$APP/frontend/dist" 2>/dev/null || true
chown -R www-data:www-data "$APP/backend" 2>/dev/null || true

ensure_deploy_hook_env
chmod +x "$APP/deploy/deploy-hook-runner.sh"
sed "s#/var/www/onlinetest#${APP}#g" "$APP/deploy/systemd/onlinetest-deploy-hook.service" > /etc/systemd/system/onlinetest-deploy-hook.service
systemctl daemon-reload

systemctl enable onlinetest-api onlinetest-realtime onlinetest-deploy-hook 2>/dev/null || true
systemctl restart onlinetest-api onlinetest-realtime onlinetest-deploy-hook 2>/dev/null || true

bash "$APP/deploy/enable-nginx-onlinetest.sh"

if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  certbot --nginx -d "$FRONT_DOMAIN" -d "$API_DOMAIN" \
    --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect || true
else
  echo ">>> HTTPS: CERTBOT_EMAIL=... bilan qayta ishga tushiring yoki:"
  echo "    certbot --nginx -d ${FRONT_DOMAIN} -d ${API_DOMAIN}"
fi

echo "Bootstrap yakunlandi."
echo "  Front: https://${FRONT_DOMAIN}"
echo "  API:   https://${API_DOMAIN}/api/health"
echo "  Health (nginx): curl -sS -H 'Host: ${FRONT_DOMAIN}' http://127.0.0.1/healthz"
