#!/usr/bin/env bash
# systemd ExecStart — env fayldan DEPLOY_APP_ROOT o‘qiydi
set -euo pipefail
set -a
# shellcheck source=/dev/null
source /etc/onlinetest/deploy-hook.env
set +a
exec /usr/bin/node "${DEPLOY_APP_ROOT}/deploy/deploy-hook.mjs"
