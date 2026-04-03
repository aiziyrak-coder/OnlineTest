#!/usr/bin/env bash
# Serverda loyiha ildizidan: pull (ixtiyoriy), backend, frontend build, restart.
# Ishlatish:
#   bash deploy/remote-update.sh
#   bash deploy/remote-update.sh --no-git
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" != "--no-git" ]]; then
  git pull origin main
fi

if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv
fi
(
  cd backend
  ./.venv/bin/pip install -r requirements.txt -q
  ./.venv/bin/python manage.py migrate --noinput
)

if [[ ! -f frontend/.env.production ]]; then
  cp frontend/.env.production.example frontend/.env.production
  echo "[remote-update] frontend/.env.production yaratildi (namunadan). Bir marta tekshiring."
fi
(
  cd frontend
  npm ci
  npm run build
)

npm ci --omit=dev --prefix "$ROOT"

if systemctl is-active --quiet onlinetest-api 2>/dev/null; then
  sudo systemctl restart onlinetest-api onlinetest-realtime
  sudo systemctl reload nginx 2>/dev/null || true
  echo "[remote-update] systemd + nginx yangilandi."
else
  echo "[remote-update] onlinetest-api systemd topilmadi — birinchi o‘rnatish: deploy/DEPLOY.md"
fi

echo "[remote-update] OK"
