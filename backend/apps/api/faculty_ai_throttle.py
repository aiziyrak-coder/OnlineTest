"""Faculty AI MCQ — bir vaqtda ko'p start bo'lganda OpenAI/iMentor stampede oldini olish."""
from __future__ import annotations

import logging
import time
from contextlib import contextmanager

from django.core.cache import cache

logger = logging.getLogger(__name__)

# Bir vaqtda nechta generate-mcq (OpenAI) — default 2 (server/AI cheklovi).
_DEFAULT_SLOTS = 2
_LOCK_WAIT_SEC = 180
_LOCK_POLL_SEC = 0.4


def _slots() -> int:
    import os

    try:
        return max(1, min(8, int(os.environ.get("FACULTY_AI_GENERATE_SLOTS", str(_DEFAULT_SLOTS)))))
    except ValueError:
        return _DEFAULT_SLOTS


@contextmanager
def faculty_ai_generate_slot(timeout_sec: float | None = None):
    """Redis/cache semafor: bir vaqtda faqat N ta AI generate."""
    wait = float(timeout_sec if timeout_sec is not None else _LOCK_WAIT_SEC)
    slots = _slots()
    token = None
    deadline = time.monotonic() + wait
    key_prefix = "vac:faculty_ai_slot:"

    while time.monotonic() < deadline:
        for i in range(slots):
            k = f"{key_prefix}{i}"
            # 4 daqiqa — generate o'zi ~1–3 daqiqa
            if cache.add(k, "1", timeout=240):
                token = k
                break
        if token:
            break
        time.sleep(_LOCK_POLL_SEC)

    if not token:
        logger.warning("faculty_ai_generate_slot: timeout (slots=%s wait=%s)", slots, wait)
        raise TimeoutError("AI savol generatsiyasi band — biroz kutib qayta urining")

    try:
        yield
    finally:
        try:
            cache.delete(token)
        except Exception:
            pass
