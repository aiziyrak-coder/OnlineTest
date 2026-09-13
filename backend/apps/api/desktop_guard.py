"""FerMI Exam Platform ilovasi talabi.

DESKTOP_APP_REQUIRED=1 bo'lganda test topshiruvchi API'si (/api/student/...)
faqat ilovadan kelgan, IMZOLANGAN so'rovni qabul qiladi. Ilova har bir so'rovga
X-FerMI-Ts va X-FerMI-Sig = HMAC-SHA256(DESKTOP_APP_KEY, "ts\\nMETHOD\\npath")
qo'shadi (desktop/src/main.js). Brauzerdan kelgan so'rov 403 DESKTOP_APP_REQUIRED.

Admin paneli, kirish (login) va ochiq sahifalar tegilmaydi.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from pathlib import Path

from django.http import JsonResponse

#: Imzo muddati (soniya) — kompyuter soati biroz noto'g'ri bo'lsa ham ishlasin.
MAX_CLOCK_SKEW_SECONDS = 600

GUARDED_PREFIXES = ("/api/student/",)
#: Brauzerdagi "profil rasmini yangilash" sahifasi ham ishlatadi.
EXEMPT_PATHS = frozenset({"/api/student/profile-photo"})


def _flag(name: str, default: str = "0") -> bool:
    return str(os.environ.get(name, default)).strip().lower() in ("1", "true", "yes", "on")


def desktop_required() -> bool:
    return _flag("DESKTOP_APP_REQUIRED")


def desktop_min_version() -> str:
    return str(os.environ.get("DESKTOP_MIN_VERSION", "")).strip()


def _version_tuple(v: str) -> tuple:
    out = []
    for part in str(v or "").split(".")[:4]:
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    while len(out) < 3:
        out.append(0)
    return tuple(out)


def verify_desktop_request(request) -> tuple[bool, str]:
    """(to'g'rimi, sabab). Sabab faqat log/diagnostika uchun."""
    if str(request.META.get("HTTP_X_FERMI_CLIENT", "")).strip().lower() != "desktop":
        return False, "NO_CLIENT"
    key = str(os.environ.get("DESKTOP_APP_KEY", "")).strip()
    if not key:
        return False, "NO_KEY"
    ts = str(request.META.get("HTTP_X_FERMI_TS", "")).strip()
    sig = str(request.META.get("HTTP_X_FERMI_SIG", "")).strip().lower()
    try:
        ts_i = int(ts)
    except ValueError:
        return False, "BAD_TS"
    if abs(time.time() - ts_i) > MAX_CLOCK_SKEW_SECONDS:
        return False, "STALE_TS"
    msg = "%s\n%s\n%s" % (ts, str(request.method or "GET").upper(), request.path)
    expected = hmac.new(key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()
    if not sig or not hmac.compare_digest(expected, sig):
        return False, "BAD_SIG"
    return True, ""


class DesktopAppGuardMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ""
        if (
            request.method != "OPTIONS"
            and path.startswith(GUARDED_PREFIXES)
            and path not in EXEMPT_PATHS
            and desktop_required()
        ):
            ok, reason = verify_desktop_request(request)
            if not ok:
                return JsonResponse(
                    {
                        "error": "Imtihon faqat FerMI Exam Platform ilovasida topshiriladi. "
                        "Ilovani test.fermi.uz saytidan yuklab oling.",
                        "code": "DESKTOP_APP_REQUIRED",
                        "reason": reason,
                        # Kompyuter soati noto'g'ri bo'lsa ilova farqni shu qiymatdan hisoblaydi.
                        "server_ts": int(time.time()),
                    },
                    status=403,
                )
            min_v = desktop_min_version()
            got_v = str(request.META.get("HTTP_X_FERMI_VERSION", "")).strip()
            if min_v and _version_tuple(got_v) < _version_tuple(min_v):
                return JsonResponse(
                    {
                        "error": "FerMI Exam Platform ilovasini yangilang (kerakli versiya: %s)." % min_v,
                        "code": "DESKTOP_UPDATE_REQUIRED",
                        "min_version": min_v,
                    },
                    status=426,
                )
        return self.get_response(request)


def desktop_download_info() -> dict:
    """Yuklab olish sahifasi uchun: joriy versiya, fayl manzili va hajmi (latest.yml dan)."""
    base = Path(os.environ.get("DESKTOP_DOWNLOADS_DIR", "/app/frontend_dist/downloads"))
    version, fname, size = "", "", 0
    try:
        for line in (base / "latest.yml").read_text(encoding="utf-8").splitlines():
            if line.startswith("version:"):
                version = line.split(":", 1)[1].strip().strip("'\"")
            elif line.startswith("path:"):
                fname = line.split(":", 1)[1].strip().strip("'\"")
        if fname and (base / fname).is_file():
            size = (base / fname).stat().st_size
        else:
            fname = ""
    except OSError:
        pass
    return {
        "required": desktop_required(),
        "version": version,
        "min_version": desktop_min_version(),
        "download_url": ("/downloads/" + fname) if fname else "",
        "size_mb": round(size / 1048576, 1),
    }
