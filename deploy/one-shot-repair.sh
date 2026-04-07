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

# 2) Apply known-good nginx config
sudo tee /etc/nginx/sites-available/fjsti-onlinetest.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name onlinetest.ziyrak.org onlinetestapi.ziyrak.org;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name onlinetest.ziyrak.org;

    ssl_certificate /etc/letsencrypt/live/onlinetest.ziyrak.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/onlinetest.ziyrak.org/privkey.pem;

    root /var/www/onlinetest/frontend/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location = /healthz {
        default_type text/plain;
        return 200 "ok\n";
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name onlinetestapi.ziyrak.org;

    ssl_certificate /etc/letsencrypt/live/onlinetest.ziyrak.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/onlinetest.ziyrak.org/privkey.pem;

    client_max_body_size 55m;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:9082;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location /api/ {
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_hide_header Access-Control-Allow-Credentials;
        add_header Access-Control-Allow-Origin "https://onlinetest.ziyrak.org" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;
        add_header Access-Control-Allow-Credentials "true" always;
        if ($request_method = OPTIONS) { return 204; }

        proxy_pass http://127.0.0.1:9081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 900s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 900s;
    }

    location = /admin { return 301 $scheme://$host/admin/; }

    location /admin/ {
        proxy_pass http://127.0.0.1:9081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }

    location /static/ {
        alias /var/www/onlinetest/backend/staticfiles/;
        access_log off;
        expires 7d;
    }

    location = /favicon.ico {
        access_log off;
        log_not_found off;
        return 204;
    }

    location = / { return 302 $scheme://$host/api/health; }
    location / { return 404; }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/fjsti-onlinetest.conf /etc/nginx/sites-enabled/fjsti-onlinetest.conf

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

