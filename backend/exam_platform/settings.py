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
    "jazzmin",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "channels",
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
    "apps.core.middleware.IdentityCompareLogMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.SecurityHeadersMiddleware",
    # FerMI Exam ilovasi talabi (DESKTOP_APP_REQUIRED=1 bo'lganda)
    "apps.api.desktop_guard.DesktopAppGuardMiddleware",
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
if DEBUG and "http://localhost:8080" not in _csrf:
    _csrf.append("http://localhost:8080")
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
ASGI_APPLICATION = "exam_platform.asgi.application"

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

# Faqat PostgreSQL — SQLite qo'llab-quvvatlanmaydi (dev, test, prod hammasi Postgres).
# DATABASE_URL o'rnatilmasa lokal Docker Postgres'ga (127.0.0.1:5432) ulanadi.
import dj_database_url

_database_url = (
    os.environ.get("DATABASE_URL", "").strip()
    or "postgres://onlinetest:dev-postgres-password@127.0.0.1:5432/onlinetest"
)
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
# Parallel imtihon starti: Postgres ulanishlarini tezkor ushlab turish
DATABASES["default"].setdefault("OPTIONS", {})
DATABASES["default"]["OPTIONS"].setdefault("connect_timeout", 10)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
if "postgresql" not in DATABASES["default"].get("ENGINE", ""):
    raise RuntimeError(
        "Faqat PostgreSQL qo'llab-quvvatlanadi. DATABASE_URL=postgres://... o'rnating "
        "(yoki Docker Compose'dagi Postgres'dan foydalaning)."
    )

# Prod: yuz-tekshiruvni chetlatish — ochiq qoldirilmasin
if not DEBUG:
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
CORS_EXPOSE_HEADERS = [
    "X-Total-Count",
    "X-Request-Id",
    "X-Exam-Seq-Next",
    "X-Exam-Challenge-Next",
]

# VAC HMAC nonce replay — multi-worker Gunicorn uchun umumiy cache (filebased yoki Redis)
_redis_url = os.environ.get("REDIS_URL", "").strip()
_vac_cache_dir = os.environ.get("VAC_CACHE_DIR", str(BASE_DIR / "vac_cache"))
if _redis_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _redis_url,
        }
    }
elif not DEBUG:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
            "LOCATION": _vac_cache_dir,
            "OPTIONS": {"MAX_ENTRIES": 200_000},
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "vac-dev",
        }
    }

# Django Channels WebSocket: Redis channel layer (Redis yo'q bo'lsa InMemory — multi-worker da ishlamaydi)
if _redis_url:
    import urllib.parse as _urlparse
    _rp = _urlparse.urlparse(_redis_url)
    _redis_conn: dict = {
        "host": _rp.hostname or "redis",
        "port": _rp.port or 6379,
        "db": int((_rp.path or "/0").lstrip("/") or 0),
        # socket_timeout=None → pub/sub idle-da TimeoutError chiqmaydi
        "socket_timeout": None,
        "socket_connect_timeout": 10,
        "socket_keepalive": True,
    }
    if _rp.password:
        _redis_conn["password"] = _rp.password
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [_redis_conn],
                "capacity": 1500,
                "expiry": 60,
            },
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }

# ── Celery (background AI tasklari) ──────────────────────────────────────────
# proctor-frame / identity-compare AI chaqiruvlarini web worker'dan tashqari
# Celery worker'ga chiqaradi. Broker yo'q bo'lsa (CELERY_BROKER_URL ham, REDIS_URL
# ham yo'q) TASK_ALWAYS_EAGER=True — task'lar sync ishlaydi (eski xulq saqlanadi).
_celery_broker = os.environ.get("CELERY_BROKER_URL", "").strip() or _redis_url
CELERY_BROKER_URL = _celery_broker
CELERY_RESULT_BACKEND = (
    os.environ.get("CELERY_RESULT_BACKEND", "").strip() or _celery_broker
)
CELERY_TASK_ALWAYS_EAGER = not _celery_broker
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_TASK_TIME_LIMIT = int(os.environ.get("CELERY_TASK_TIME_LIMIT", "120"))
CELERY_TASK_SOFT_TIME_LIMIT = int(os.environ.get("CELERY_TASK_SOFT_TIME_LIMIT", "100"))
CELERY_RESULT_EXPIRES = int(os.environ.get("CELERY_RESULT_EXPIRES", "900"))
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_ACKS_LATE = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"

# Davriy (beat) task'lar — alohida `beat` xizmati orqali ishga tushadi
# (docker-compose `beat` service / deploy/systemd/onlinetest-beat.service).
# DIQQAT: hech qachon bir nechta beat jarayoni bir vaqtda ishlamasin —
# aks holda bitta sweep bir necha marta takrorlanadi.
CELERY_BEAT_SCHEDULE = {
    "proctor-sweep-stale-sessions": {
        "task": "proctor.sweep_stale_sessions",
        "schedule": float(os.environ.get("PROCTOR_SWEEP_INTERVAL_SECONDS", "60")),
    },
    # Vaqti tugagan imtihonlarni avtomatik yakunlash: kirib tugatmaganni ballash,
    # retake'ga qaytmaganni "Failed", umuman kirmaganni "Failed (kelmagan)" qilish.
    "exam-finalize-ended-exams": {
        "task": "exam.finalize_ended_exams",
        "schedule": float(os.environ.get("EXAM_FINALIZE_INTERVAL_SECONDS", "300")),
    },
}

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
        # DIQQAT: bu cheklov IP bo'yicha ishlaydi. Institut butun binosi bitta
        # tashqi IP orqali chiqadi, ya'ni 181 o'qituvchi BITTA limitni bo'lishadi.
        # 60/h da imtihon kuni ertalab bir necha o'nlab kishi kirgach, qolganlar
        # "Too many requests" olib, tizimga umuman kira olmasdi.
        "login": os.environ.get("LOGIN_THROTTLE_RATE", "1200/h"),
        "face_verify": "25/m",  # 3s interval=20/min + ~5 person-swap burst
        "public_verify": "300/h",
        # Anonim so'rovlar ham IP bo'yicha — yuqoridagi sabab bilan kengaytirildi.
        "anon": os.environ.get("ANON_THROTTLE_RATE", "600/m"),
        "user": "600/m",
        "exam_autosave": "60/m",
        "bank_ai_import": "20/h",
        "violations": "180/h",
        "proctor_frame": "10/m",
    },
}
if not DEBUG:
    REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = ["rest_framework.renderers.JSONRenderer"]

DATA_UPLOAD_MAX_MEMORY_SIZE = 52_428_800
FILE_UPLOAD_MAX_MEMORY_SIZE = 52_428_800

PUBLIC_APP_URL = os.environ.get("PUBLIC_APP_URL", "").rstrip("/")
# OpenAI (yuz solishtirish, test import, AI savollar, tarjima)
OPENAI_API_KEY = (
    os.environ.get("OPENAI_API_KEY", "").strip()
    or os.environ.get("GEMINI_API_KEY", "").strip()  # eski deploy fayllar
)
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip()
# Imtihon savollarini yaratish uchun alohida model. Bo'sh bo'lsa
# OPENAI_MODEL ishlatiladi. Tibbiy o'zbekcha atamalar sifati uchun
# kuchliroq model tavsiya etiladi (masalan "gpt-4o").
OPENAI_EXAM_MODEL = os.environ.get("OPENAI_EXAM_MODEL", "").strip()

# Audit jurnalini ochish uchun qo'shimcha parol. Bo'sh bo'lsa —
# qo'shimcha parol so'ralmaydi (admin roli yetarli).
AUDIT_PASSWORD = os.environ.get("AUDIT_PASSWORD", "").strip()
OPENAI_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o").strip()
OPENAI_MODEL_FALLBACKS = os.environ.get("OPENAI_MODEL_FALLBACKS", "gpt-4o-mini").strip()
# Eski nomlar (kod va deploy skriptlari bilan moslik)
GEMINI_API_KEY = OPENAI_API_KEY
GEMINI_MODEL = OPENAI_MODEL
GEMINI_MODEL_FALLBACKS = OPENAI_MODEL_FALLBACKS

_identity_console_fmt = "{levelname} {asctime} {message}"

if DEBUG:
    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "identity_console": {
                "format": _identity_console_fmt,
                "style": "{",
            },
        },
        "handlers": {
            "identity_console": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
                "formatter": "identity_console",
            },
        },
        "loggers": {
            "fjsti.identity": {
                "handlers": ["identity_console"],
                "level": "INFO",
                "propagate": False,
            },
        },
    }

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
            "fjsti.identity": {
                "handlers": ["console"],
                "level": "INFO",
                "propagate": False,
            },
        },
    }

from exam_platform.jazzmin_settings import JAZZMIN_SETTINGS, JAZZMIN_UI_TWEAKS  # noqa: E402
