"""
Django sozlamalari — FJSTI Online Exam API (Express API bilan mos marshrutlar).
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

_DEFAULT_SECRET_KEY = "dev-only-change-in-production-min-50-chars-xxxxxxxxxx"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", _DEFAULT_SECRET_KEY)
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "127.0.0.1,localhost").split(",") if h.strip()]
if DEBUG and "testserver" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("testserver")

if not DEBUG:
    if SECRET_KEY == _DEFAULT_SECRET_KEY or len(SECRET_KEY) < 40:
        raise RuntimeError("Production: DJANGO_SECRET_KEY majburiy (kamida ~40 tasodifiy belgi).")

JWT_SECRET = os.environ.get("JWT_SECRET", SECRET_KEY)
if not DEBUG and (not JWT_SECRET or len(JWT_SECRET) < 24):
    raise RuntimeError("Production: JWT_SECRET (min 24 belgi) majburiy")

# Nginx / reverse proxy: Host sarlavhasi to‘g‘ri bo‘lishi (faqat aniq yoqilganda).
if os.environ.get("TRUST_X_FORWARDED_HOST", "").strip().lower() in ("1", "true", "yes"):
    USE_X_FORWARDED_HOST = True

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "apps.core",
    "apps.api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "apps.core.middleware.RequestIdMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.SecurityHeadersMiddleware",
]

X_FRAME_OPTIONS = "DENY"

if not DEBUG:
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    _use_https = os.environ.get("DJANGO_SECURE_SSL", "").strip().lower() in ("1", "true", "yes")
    if _use_https:
        SECURE_SSL_REDIRECT = True
        SESSION_COOKIE_SECURE = True
        CSRF_COOKIE_SECURE = True
        SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True
        SECURE_HSTS_PRELOAD = True
    _proxy = os.environ.get("SECURE_PROXY_SSL_HEADER", "").strip()
    if _proxy and ":" in _proxy:
        name, value = _proxy.split(":", 1)
        SECURE_PROXY_SSL_HEADER = (name.strip(), value.strip())

_csrf = [o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]
CSRF_TRUSTED_ORIGINS = _csrf
if not DEBUG and _csrf and any(o.startswith("https://") for o in _csrf):
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

ROOT_URLCONF = "exam_platform.urls"
WSGI_APPLICATION = "exam_platform.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ], 
        },
    },
]

_database_url = os.environ.get("DATABASE_URL", "").strip()
if _database_url:
    import dj_database_url

    _conn_max = int(os.environ.get("DB_CONN_MAX_AGE", "60") or "60")
    _conn_max = max(0, min(_conn_max, 600))
    _ssl = os.environ.get("DATABASE_SSL_REQUIRE", "").strip().lower() in ("1", "true", "yes")
    DATABASES = {
        "default": dj_database_url.parse(
            _database_url,
            conn_max_age=_conn_max,
            ssl_require=_ssl,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
            "OPTIONS": {
                "timeout": 30,
            },
        }
    }

# Prod: tasodifiy SQLite yoki yuz-tekshiruvni chetlatish — ochiq qoldirilmasin
if not DEBUG:
    _engine = DATABASES["default"].get("ENGINE", "")
    if "sqlite" in _engine:
        _allow_sqlite = os.environ.get("DATABASE_ALLOW_SQLITE_PROD", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if not _allow_sqlite:
            raise RuntimeError(
                "Production: DATABASE_URL (PostgreSQL) majburiy — SQLite bilan prod odatda ishlamasligi kerak. "
                "Faqat maqsadli lab/CI: DATABASE_ALLOW_SQLITE_PROD=1."
            )
    if os.environ.get("ALLOW_IDENTITY_VERIFY_BYPASS", "").strip().lower() in ("1", "true", "yes"):
        raise RuntimeError(
            "Production: ALLOW_IDENTITY_VERIFY_BYPASS taqiqlangan — yuz tekshiruvini chetlatadi."
        )

LANGUAGE_CODE = "uz"
TIME_ZONE = "Asia/Tashkent"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_ALL_ORIGINS = DEBUG
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",")
    if o.strip()
]
if not DEBUG and CORS_ALLOWED_ORIGINS:
    CORS_ALLOW_ALL_ORIGINS = False

if not DEBUG and not CORS_ALLOW_ALL_ORIGINS and not CORS_ALLOWED_ORIGINS:
    raise RuntimeError(
        "Production: CORS_ALLOWED_ORIGINS bo‘sh — frontend domenini vergul bilan qo‘shing (api.env)."
    )

CORS_ALLOW_CREDENTIALS = False
CORS_PREFLIGHT_MAX_AGE = 600
CORS_EXPOSE_HEADERS = ["X-Total-Count", "X-Request-Id"]

# SPA boshqa domen orqali POST (multipart /api/admin/...) yuborilganda Django CSRF
# HTTP_ORIGIN ni CSRF_TRUSTED_ORIGINS bilan solishtiradi. GET o'tadi, POST 403 bo'lishi mumkin
# agar faqat API domeni yozilgan bo'lsa. CORS_ALLOWED_ORIGINS dagi frontend domenlarini bu yerga ham qo'shamiz.
_csrf_merged: list[str] = []
_seen_csrf: set[str] = set()

def _csrf_add(url: str) -> None:
    u = (url or "").strip()
    if not u or u in _seen_csrf:
        return
    _seen_csrf.add(u)
    _csrf_merged.append(u)


for _u in CSRF_TRUSTED_ORIGINS:
    _csrf_add(_u)
for _u in CORS_ALLOWED_ORIGINS:
    _csrf_add(_u)
    if _u.startswith("http://"):
        _csrf_add("https://" + _u[7:])
    elif _u.startswith("https://"):
        _csrf_add("http://" + _u[8:])

CSRF_TRUSTED_ORIGINS = _csrf_merged

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.api.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["apps.api.permissions.IsAuthenticatedStrict"],
    "EXCEPTION_HANDLER": "apps.api.exception_handlers.api_exception_handler",
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "login": "60/h",        # 10 → 60: har soatda 60 urinish (5 ta foydalanuvchi × 12)
        "face_verify": "60/m",  # 30 → 60: identity check tezroq
        "public_verify": "300/h",
        "anon": "200/m",
        "user": "600/m",
        "exam_autosave": "60/m",
        "bank_ai_import": "20/h",
        "violations": "180/h",
    },
}
if not DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = ["rest_framework.renderers.JSONRenderer"]

DATA_UPLOAD_MAX_MEMORY_SIZE = 52_428_800
FILE_UPLOAD_MAX_MEMORY_SIZE = 52_428_800

PUBLIC_APP_URL = os.environ.get("PUBLIC_APP_URL", "").rstrip("/")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
# Yangi AI Studio kalitlari uchun barqaror: gemini-2.5-pro | tezroq: gemini-2.5-flash | 3.x: gemini-3.1-pro-preview (kalitga bog‘liq)
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")

if not DEBUG:
    _log_json = os.environ.get("LOG_JSON", "").strip().lower() in ("1", "true", "yes")
    _log_formatter = "json" if _log_json else "simple"
    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "request_id": {"()": "apps.core.middleware.RequestIdLogFilter"},
        },
        "formatters": {
            "simple": {
                "format": "{levelname} {asctime} [{request_id}] {name} {message}",
                "style": "{",
            },
            "json": {
                "()": "apps.core.logging_formatters.JsonLogFormatter",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": _log_formatter,
                "filters": ["request_id"],
            },
        },
        "root": {"handlers": ["console"], "level": "INFO"},
        "loggers": {
            "django.security": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        },
    }
