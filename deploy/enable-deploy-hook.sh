#!/usr/bin/env bash
# Mavjud serverda (bootstrap dan keyin): deploy hook + nginx yo‘li yangilash.
# Ishlatish: cd /var/www/onlinetest && sudo bash deploy/enable-deploy-hook.sh
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo "sudo bash deploy/enable-deploy-hook.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${APP_PATH:-$ROOT}"

mkdir -p /etc/onlinetest
if [[ ! -f /etc/onlinetest/deploy-hook.env ]]; then
  sec=$(openssl rand -hex 32)
  umask 077
  cat > /etc/onlinetest/deploy-hook.env <<EOF
DEPLOY_HOOK_SECRET=${sec}
DEPLOY_HOOK_PORT=9085
DEPLOY_APP_ROOT=${APP}
EOF
  chmod 600 /etc/onlinetest/deploy-hook.env
  echo "Yaratildi /etc/onlinetest/deploy-hook.env — DEPLOY_HOOK_SECRET ni GitHub ga qo‘shing."
  echo "  DEPLOY_HOOK_SECRET=${sec}"
fi

chmod +x "$ROOT/deploy/deploy-hook-runner.sh"
sed "s#/var/www/onlinetest#${APP}#g" "$ROOT/deploy/systemd/onlinetest-deploy-hook.service" > /etc/systemd/system/onlinetest-deploy-hook.service
systemctl daemon-reload
systemctl enable onlinetest-deploy-hook
systemctl restart onlinetest-deploy-hook

bash "$ROOT/deploy/enable-nginx-onlinetest.sh"
echo "OK: onlinetest-deploy-hook. URL: https://<API_DOMEN>/__internal_deploy/v1"
