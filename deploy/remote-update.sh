#!/usr/bin/env bash
# Serverda loyiha ildizidan: pull (ixtiyoriy), backend, frontend build, restart + health-check.
# Ishlatish:
#   bash deploy/remote-update.sh
#   bash deploy/remote-update.sh --no-git
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ensure_realtime_env() {
  local api_env="/etc/onlinetest/api.env"
  local rt_env="/etc/onlinetest/realtime.env"
  if [[ ! -f "$api_env" ]]; then
    echo "[remote-update] WARN: $api_env topilmadi; realtime JWT auto-sync o'tkazib yuborildi."
    return 0
  fi
  local jwt
  jwt="$(grep -E '^JWT_SECRET=' "$api_env" | sed -E 's/^JWT_SECRET=//')"
  if [[ -z "$jwt" ]]; then
    echo "[remote-update] WARN: JWT_SECRET bo'sh; realtime xizmati ishlab ketmasligi mumkin."
    return 0
  fi
  if [[ ! -f "$rt_env" ]]; then
    sudo install -o root -g root -m 600 /dev/null "$rt_env"
  fi
  sudo sed -i '/^JWT_SECRET=/d;/^SOCKET_IO_CORS_ORIGIN=/d;/^REALTIME_BIND=/d;/^REALTIME_PORT=/d' "$rt_env"
  {
    echo "JWT_SECRET=$jwt"
    echo "SOCKET_IO_CORS_ORIGIN=https://online-imtixon.uz"
    echo "REALTIME_BIND=127.0.0.1"
    echo "REALTIME_PORT=9082"
  } | sudo tee -a "$rt_env" >/dev/null
  sudo chmod 600 "$rt_env"
  echo "[remote-update] realtime.env JWT/CORS sync qilindi."
}

AUTOSTASH=1
if [[ "${1:-}" == "--no-git" ]]; then
  NO_GIT=1
else
  NO_GIT=0
fi
if [[ "${2:-}" == "--no-autostash" ]] || [[ "${1:-}" == "--no-autostash" ]]; then
  AUTOSTASH=0
fi

STASHED=0
STASH_NAME="remote-update-autostash-$(date +%F-%H%M%S)"

git_pull_safe() {
  if [[ "$NO_GIT" -eq 1 ]]; then
    echo "[remote-update] --no-git: git pull o'tkazib yuborildi."
    return 0
  fi
  if [[ "$AUTOSTASH" -eq 1 ]] && [[ -n "$(git status --porcelain)" ]]; then
    git stash push -u -m "$STASH_NAME" >/dev/null
    STASHED=1
    echo "[remote-update] Lokal o'zgarishlar vaqtincha stash qilindi."
  fi
  git pull origin main
}

restore_stash_if_any() {
  if [[ "$STASHED" -eq 1 ]]; then
    if git stash list | grep -q "$STASH_NAME"; then
      echo "[remote-update] Stash qaytarilmoqda..."
      if ! git stash pop --index >/dev/null 2>&1; then
        echo "[remote-update] WARN: stash auto-popda konflikt bo'ldi. Qo'lda tekshiring: git stash list"
      fi
    fi
  fi
}

check_health() {
  local local_api="http://127.0.0.1:9081/api/health"
  local public_api="https://api.online-imtixon.uz/api/health"
  if command -v curl >/dev/null 2>&1; then
    echo "[remote-update] Health tekshirilmoqda..."
    curl -fsS --max-time 8 "$local_api" >/dev/null && echo "  - local api: OK" || echo "  - local api: FAIL ($local_api)"
    curl -fsS --max-time 12 "$public_api" >/dev/null && echo "  - public api: OK" || echo "  - public api: FAIL ($public_api)"
  fi
}

git_pull_safe

# systemd/nginx shablonlarini serverga qo'llash
if [[ -f "$ROOT/deploy/systemd/onlinetest-api.service" ]]; then
  sudo cp "$ROOT/deploy/systemd/onlinetest-api.service" /etc/systemd/system/onlinetest-api.service
fi
if [[ -f "$ROOT/deploy/systemd/onlinetest-realtime.service" ]]; then
  sudo cp "$ROOT/deploy/systemd/onlinetest-realtime.service" /etc/systemd/system/onlinetest-realtime.service
fi
if [[ -f "$ROOT/deploy/nginx/onlinetest.conf" ]]; then
  sudo cp "$ROOT/deploy/nginx/onlinetest.conf" /etc/nginx/sites-available/fjsti-onlinetest.conf
  sudo ln -sf /etc/nginx/sites-available/fjsti-onlinetest.conf /etc/nginx/sites-enabled/fjsti-onlinetest.conf
fi
sudo systemctl daemon-reload
ensure_realtime_env

if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv
fi
(
  cd backend
  ./.venv/bin/pip install -r requirements.txt -q
  ./.venv/bin/python manage.py migrate --noinput
  ./.venv/bin/python manage.py collectstatic --noinput
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
  echo "[remote-update] systemd yangilandi."
else
  echo "[remote-update] onlinetest-api systemd topilmadi — birinchi o‘rnatish: deploy/bootstrap-ubuntu-once.sh yoki deploy/DEPLOY.md"
fi

if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t
  sudo systemctl reload nginx
fi

if id www-data &>/dev/null; then
  if [[ $(id -u) -eq 0 ]]; then
    chown -R www-data:www-data "$ROOT/backend" "$ROOT/frontend/dist" 2>/dev/null || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo chown -R www-data:www-data "$ROOT/backend" "$ROOT/frontend/dist" 2>/dev/null || true
  fi
fi

restore_stash_if_any
check_health
echo "[remote-update] OK"
