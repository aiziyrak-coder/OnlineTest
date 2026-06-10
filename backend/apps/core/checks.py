"""Django system checks (`manage.py check --deploy`)."""
from __future__ import annotations

import os

from django.conf import settings
from django.core.checks import Warning, register, Tags


@register(Tags.security, deploy=True)
def warn_gemini_missing_for_identity(app_configs, **kwargs):
    """Prod da identity-compare uchun OpenAI kaliti kerak."""
    if settings.DEBUG:
        return []
    key = (
        os.environ.get("OPENAI_API_KEY", "").strip()
        or os.environ.get("GEMINI_API_KEY", "").strip()
    )
    if key:
        return []
    return [
        Warning(
            "OPENAI_API_KEY bo‘sh — POST /api/student/identity-compare yuzni solishtira olmaydi (503).",
            hint="api.env ga OPENAI_API_KEY qo‘shing.",
            id="exam.W002",
        )
    ]
