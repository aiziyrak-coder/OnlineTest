"""Har bir savolga sarflangan vaqt: kiruvchi ma'lumotni tozalash va tahlil.

Frontend har savol uchun yuboradi: {"<savol id>": {"ms": ko'rilgan jami ms,
"first": birinchi javobgacha ms yoki null, "changes": javob o'zgartirish soni}}.
Ma'lumot talaba brauzeridan kelgani uchun qat'iy tozalanadi (hajm, tur, chegara).
Tahlil avtomatik jazo EMAS — admin hisobotida "shubhali" belgisi uchun.
"""
from __future__ import annotations

MAX_MS = 3 * 3600 * 1000
MAX_KEYS = 200


def _int(value, hi: int):
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return max(0, min(hi, n))


def clean_timings(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for key, val in list(raw.items())[:MAX_KEYS]:
        k = str(key)[:12]
        if not k.isdigit() or not isinstance(val, dict):
            continue
        ms = _int(val.get("ms"), MAX_MS)
        if ms is None:
            continue
        first = val.get("first")
        first = _int(first, MAX_MS) if first is not None else None
        out[k] = {"ms": ms, "first": first, "changes": _int(val.get("changes"), 1000) or 0}
    return out


def quick_correct(questions: list, answers: dict, timings: dict, *,
                  min_len: int = 200, max_ms: int = 8000) -> tuple[int, int]:
    """(uzun klinik savolga max_ms dan tez TO'G'RI javoblar soni, jami uzun savollar)."""
    n_long = quick = 0
    for q in questions or []:
        if len(str(q.get("text") or "")) < min_len:
            continue
        n_long += 1
        t = (timings or {}).get(str(q.get("id"))) or {}
        first = t.get("first")
        a = (answers or {}).get(str(q.get("id")))
        if (first is not None and first <= max_ms and a is not None
                and str(a).strip() == str(q.get("correctAnswer") or "").strip()):
            quick += 1
    return quick, n_long
