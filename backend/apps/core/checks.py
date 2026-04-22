"""Django system checks (`manage.py check --deploy`)."""
from __future__ import annotations

import os

from django.conf import settings
from django.core.checks import Warning, register, Tags


@register(Tags.security, deploy=True)
def warn_gemini_missing_for_identity(app_configs, **kwargs):
    """Prod da identity-compare uchun GEMINI_API_KEY kerak."""
    if settings.DEBUG:
        return []
    if os.environ.get("GEMINI_API_KEY", "").strip():
        return []
    return [
        Warning(
            "GEMINI_API_KEY bo‘sh — POST /api/student/identity-compare yuzni solishtira olmaydi (503).",
            hint="api.env ga GEMINI_API_KEY qo‘shing.",
            id="exam.W002",
        )
    ]
