#!/usr/bin/env bash
# To‘liq birinchi o‘rnatish (root): klon, env, build, nginx, systemd, ixtiyoriy certbot.
# Ishlatish:
#   sudo bash deploy/full-install-root.sh
#   sudo CERTBOT_EMAIL=siz@pochta.uz bash deploy/full-install-root.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bootstrap-ubuntu-once.sh" "$@"
