#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/var/www/onlinetest}"
if [[ ! -d "$ROOT" ]]; then
  echo "[repair] ERROR: root path not found: $ROOT"
  exit 1
fi

cd "$ROOT"
echo "[repair] Project root: $ROOT"

# 1) Sync code
if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  git stash push -u -m "one-shot-repair-$(date +%F-%H%M%S)" >/dev/null || true
fi
git pull origin main

# 2) Nginx: repodagi vhost (HTTPS + aniq server_name; default_server yo‘q — boshqa saytlarga tegmaydi)
sudo cp "$ROOT/deploy/nginx/onlinetest.conf" /etc/nginx/sites-available/fjsti-onlinetest.conf
sudo ln -sf /etc/nginx/sites-available/fjsti-onlinetest.conf /etc/nginx/sites-enabled/fjsti-onlinetest.conf
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  echo "[repair] INFO: sites-enabled/default saqlanib qoldi — boshqa domenlar shu orqali ishlayveradi."
fi

# 3) Rebuild/restart app stack
bash deploy/remote-update.sh --no-git

# 4) Verify cert installation (reinstall existing cert mapping, no forced renewal)
sudo certbot --nginx -d onlinetest.ziyrak.org -d onlinetestapi.ziyrak.org || true

# 5) Final checks
sudo nginx -t
sudo systemctl reload nginx
curl -fsS --max-time 10 https://onlinetestapi.ziyrak.org/api/health >/dev/null && echo "[repair] public api health: OK"
curl -fsS --max-time 10 https://onlinetest.ziyrak.org/healthz >/dev/null && echo "[repair] frontend health: OK"
echo "[repair] DONE"

