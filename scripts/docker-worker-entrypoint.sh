#!/usr/bin/env bash
# Celery worker konteyneri — proctor-frame AI tasklarini bajaradi.
set -euo pipefail

export DJANGO_SETTINGS_MODULE=exam_platform.settings
export DJANGO_DEBUG="${DJANGO_DEBUG:-1}"
export JWT_SECRET="${JWT_SECRET:-docker-dev-jwt-secret-min-24-chars}"

cd /app/backend

# PostgreSQL'ni kutish (task'lar DB'ga tegishi mumkin)
if [ -n "${DATABASE_URL:-}" ]; then
    echo "Worker: PostgreSQL tayyor bo'lishini kutmoqda..."
    until python - <<'EOF'
import os, sys, urllib.parse, socket
p = urllib.parse.urlparse(os.environ["DATABASE_URL"])
s = socket.socket(); s.settimeout(3)
try:
    s.connect((p.hostname, p.port or 5432)); s.close(); sys.exit(0)
except Exception:
    sys.exit(1)
EOF
    do sleep 1; done
    echo "Worker: PostgreSQL tayyor."
fi

# Redis (broker)'ni kutish
if [ -n "${REDIS_URL:-}" ]; then
    echo "Worker: Redis (broker) kutilmoqda..."
    until python - <<'EOF'
import os, sys, urllib.parse, socket
p = urllib.parse.urlparse(os.environ["REDIS_URL"])
s = socket.socket(); s.settimeout(3)
try:
    s.connect((p.hostname, p.port or 6379)); s.close(); sys.exit(0)
except Exception:
    sys.exit(1)
EOF
    do sleep 1; done
    echo "Worker: Redis tayyor."
fi

CONCURRENCY="${CELERY_WORKER_CONCURRENCY:-4}"
echo "=== Celery worker (concurrency=${CONCURRENCY}) ==="
exec celery -A exam_platform worker \
    --loglevel="${CELERY_LOGLEVEL:-info}" \
    --concurrency="${CONCURRENCY}" \
    --prefetch-multiplier=1 \
    --max-tasks-per-child=100
