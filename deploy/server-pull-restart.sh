#!/usr/bin/env bash
# Dropletda (loyiha ildizida): git pull va xizmatlarni qayta ishga tushirish
set -euo pipefail
cd "$(dirname "$0")/.."
git pull origin main
cd backend && ./.venv/bin/pip install -r requirements.txt -q && ./.venv/bin/python manage.py migrate --noinput
cd ../frontend && npm ci && npm run build
cd .. && npm ci --omit=dev
sudo systemctl restart onlinetest-api onlinetest-realtime
sudo systemctl reload nginx || true
echo "OK: pull, migrate, build, restart"
