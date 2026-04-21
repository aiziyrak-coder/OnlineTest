#!/usr/bin/env bash
# Django 400 (DisallowedHost): api.online-imtixon.uz ni ALLOWED_HOSTS ga qo'shadi va API ni restart qiladi.
#
# Loyiha yo'li bor bo'lsa:
#   sudo bash /var/www/onlinetest/deploy/fix-api-400-allowed-hosts.sh
#
# Reposiz bitta qator (api.env = /etc/onlinetest/api.env):
#   sudo bash -c 'E=/etc/onlinetest/api.env; [ -f "$E" ]||exit 1; f(){ k="$1"; v="$2"; if grep -q "^${k}=" "$E"; then sed -i "s|^${k}=.*|${k}=${v}|" "$E"; else printf "\n%s=%s\n" "$k" "$v" >> "$E"; fi; }; f ALLOWED_HOSTS "online-imtixon.uz,api.online-imtixon.uz,127.0.0.1,localhost"; f CSRF_TRUSTED_ORIGINS "https://online-imtixon.uz,https://api.online-imtixon.uz"; grep -q "^TRUST_X_FORWARDED_HOST=" "$E"||echo "TRUST_X_FORWARDED_HOST=1" >> "$E"; chmod 600 "$E"; systemctl restart onlinetest-api'
set -euo pipefail

E="${API_ENV:-/etc/onlinetest/api.env}"

if [[ ! -f "$E" ]]; then
  echo "Topilmadi: $E — API_ENV=/yo'l/api.env bilan qayta ishga tushiring."
  exit 1
fi

upsert() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$E" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$E"
  else
    printf '\n%s=%s\n' "$key" "$val" >>"$E"
  fi
}

upsert ALLOWED_HOSTS "online-imtixon.uz,api.online-imtixon.uz,127.0.0.1,localhost"
upsert CSRF_TRUSTED_ORIGINS "https://online-imtixon.uz,https://api.online-imtixon.uz"
if ! grep -q '^TRUST_X_FORWARDED_HOST=' "$E" 2>/dev/null; then
  printf '\nTRUST_X_FORWARDED_HOST=1\n' >>"$E"
fi
chmod 600 "$E" 2>/dev/null || true

if systemctl cat onlinetest-api.service &>/dev/null; then
  systemctl restart onlinetest-api
  echo "OK: onlinetest-api restart qilindi."
else
  echo "WARN: onlinetest-api.service yo'q — API uchun: systemctl restart <sizning-gunicorn-unit>"
fi

echo "Tekshirish: curl -sS https://api.online-imtixon.uz/api/health"
