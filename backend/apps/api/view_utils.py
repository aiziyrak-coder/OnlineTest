"""API yordamchilari."""
from __future__ import annotations

import json
from datetime import datetime

from django.utils import timezone as dj_tz


def parse_iso_datetime(s) -> datetime | None:
    if s is None:
        return None
    if isinstance(s, datetime):
        dt = s
    else:
        t = str(s).strip()
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(t)
        except ValueError:
            return None
    if dj_tz.is_naive(dt):
        dt = dj_tz.make_aware(dt, dj_tz.get_current_timezone())
    return dt


def safe_json_loads(raw: str, default):
    try:
        return json.loads(raw or "")
    except Exception:
        return default


def norm_answers(answers: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(answers, dict):
        return out
    for k, v in answers.items():
        out[str(k)] = "" if v is None else str(v)
    return out
