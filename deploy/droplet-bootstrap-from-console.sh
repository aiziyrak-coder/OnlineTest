#!/usr/bin/env bash
# Droplet ichida bir marta (DigitalOcean «Recovery Console» / droplet konsoli):
#   curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-bootstrap-from-console.sh | bash
# Yoki repo klonlangan bo‘lsa:
#   sudo bash deploy/droplet-bootstrap-from-console.sh
#
# ENV (ixtiyoriy): CERTBOT_EMAIL FRONT_DOMAIN API_DOMAIN APP REPO_URL
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@online-imtixon.uz}"
export FRONT_DOMAIN="${FRONT_DOMAIN:-online-imtixon.uz}"
export API_DOMAIN="${API_DOMAIN:-api.online-imtixon.uz}"
APP="${APP:-/var/www/onlinetest}"
REPO_URL="${REPO_URL:-https://github.com/aiziyrak-coder/OnlineTest.git}"

mkdir -p "$(dirname "$APP")"
if [[ -d "${APP}/.git" ]]; then
  git -C "${APP}" fetch origin
  git -C "${APP}" reset --hard origin/main
else
  git clone "${REPO_URL}" "${APP}"
fi

cd "${APP}"
exec bash deploy/bootstrap-ubuntu-once.sh
