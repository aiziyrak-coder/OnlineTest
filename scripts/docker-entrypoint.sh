#!/usr/bin/env bash
set -euo pipefail

export DJANGO_SETTINGS_MODULE=exam_platform.settings
export DJANGO_DEBUG="${DJANGO_DEBUG:-1}"
export ALLOWED_HOSTS="${ALLOWED_HOSTS:-127.0.0.1,localhost,0.0.0.0}"
export JWT_SECRET="${JWT_SECRET:-docker-dev-jwt-secret-min-24-chars}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://127.0.0.1:8080,http://localhost:8080}"
export PUBLIC_APP_URL="${PUBLIC_APP_URL:-http://127.0.0.1:8080}"
export IDENTITY_VERIFY_DEBUG_LOG="${IDENTITY_VERIFY_DEBUG_LOG:-1}"
export GUNICORN_BIND="127.0.0.1:8000"
export DJANGO_API_INTERNAL_URL="http://127.0.0.1:8000"

# Ma'lumotlar bazasini kutish
if [ -n "${DATABASE_URL:-}" ]; then
    echo "PostgreSQL tayyor bo'lishini kutmoqda..."
    until python - <<'EOF'
import os, sys, urllib.parse, socket
url = os.environ["DATABASE_URL"]
p = urllib.parse.urlparse(url)
s = socket.socket()
s.settimeout(3)
try:
    s.connect((p.hostname, p.port or 5432))
    s.close()
    sys.exit(0)
except Exception:
    sys.exit(1)
EOF
    do
        sleep 1
    done
    echo "PostgreSQL tayyor."
else
    echo "XATO: DATABASE_URL o'rnatilmagan. Faqat PostgreSQL qo'llab-quvvatlanadi." >&2
    exit 1
fi

cd /app/backend
python manage.py migrate --noinput
python manage.py bootstrap_exam 2>/dev/null || true
# Demo hisoblar faqat dev uchun: buyruq o'zi prodda hech narsa qilmaydi.
python manage.py seed_demo_users 2>/dev/null || true

echo ""
echo "=== FJSTI Online Exam ==="
echo "  Brauzer:  http://127.0.0.1:8080"
if [ "${DJANGO_DEBUG}" = "1" ]; then
    echo "  Login (parol hammasiga: ${DEMO_SEED_PASSWORD:-DemoFJSTI2026!}):"
    echo "     demo_admin    (admin)"
    echo "     demo_staff    (staff/kuzatuvchi)"
    echo "     demo_student  (talaba)"
    echo "  Django admin: http://127.0.0.1:8080/admin/  (admin / AdminLocal123)"
fi
echo ""

gunicorn exam_platform.asgi:application --config gunicorn.conf.py &
exec nginx -c /etc/nginx/onlinetest.conf -g 'daemon off;'
