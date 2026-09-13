"""Natijada savollar va to'g'ri javoblarni imtihon muddati tugaguncha yashirish.

Attestatsiya / tanlov imtihonlarida (ordinator, magistr, nomzod, maxsus
kiruvchi) imtihon bir necha kun ochiq turadi. Topshirib bo'lgan odam natija
sahifasidagi "savollar tahlili"ni (har bir savol + to'g'ri javob) va sertifikat
PDF'ini hali topshirmaganlarga uzatib, bank tarqalib ketardi (11.09).

Endi bu toifalarda imtihon muddati tugaguncha faqat ball, o'tdi/o'tmadi va
sertifikat ko'rsatiladi; savollar tahlili muddat tugagach ochiladi. Admin
hamma narsani avvalgidek ko'radi.
"""
from __future__ import annotations

import os

from django.utils import timezone as dj_tz


def _hidden_audiences() -> set[str]:
    raw = os.environ.get("RESULT_REVIEW_HIDDEN_AUDIENCES", "ordinator,magistr,vacancy,entrant")
    return {x.strip().lower() for x in str(raw).split(",") if x.strip()}


def review_hidden(exam) -> bool:
    """Shu imtihon natijasida savollar tahlili hozir yashirilishi kerakmi."""
    if exam is None:
        return False
    if str(getattr(exam, "audience", "") or "").strip().lower() not in _hidden_audiences():
        return False
    end = getattr(exam, "end_time", None)
    return end is None or dj_tz.now() < end


def hide_review(payload: dict, exam) -> dict:
    """Natija ma'lumotidan savollar va AI tahlilini olib tashlaydi (kerak bo'lsa)."""
    if not isinstance(payload, dict) or not review_hidden(exam):
        return payload
    out = dict(payload)
    out["questions"] = []
    out["overview"] = ""
    out["questions_hidden"] = True
    end = getattr(exam, "end_time", None)
    out["questions_visible_from"] = end.isoformat() if end else None
    return out
