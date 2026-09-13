"""Davriy xizmat vazifalari — brokersiz, to'g'ridan-to'g'ri.

NEGA: Celery beat vazifalarni Redis navbatiga qo'yardi, lekin worker ularni
olmasdi (navbatda 13 700 dan ortiq bajarilmagan xabar to'planib qolgan edi).
Natijada tashlab ketilgan imtihon sessiyalari avtomatik yopilmasdi va imtihon
vaqti tugagach natijalar yakunlanmay qolardi.

Bu sikl ayni o'sha ikkita funksiyani navbatsiz, to'g'ridan-to'g'ri chaqiradi —
ishonchli va tekshirish oson. Proctoring kadrlari (analyze_frame) avvalgidek
Celery orqali ishlaydi, ular muammosiz o'tyapti.
"""
import os
import sys
import time
import logging

sys.path.insert(0, "/app/backend")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "exam_platform.settings")

import django  # noqa: E402

django.setup()

from apps.api.tasks import run_finalize_ended_exams, run_sweep_stale_sessions  # noqa: E402

log = logging.getLogger("maintenance")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SWEEP_EVERY = int(os.environ.get("PROCTOR_SWEEP_INTERVAL_SECONDS", "60"))
FINALIZE_EVERY = int(os.environ.get("EXAM_FINALIZE_INTERVAL_SECONDS", "300"))


def _safe(name, fn):
    try:
        result = fn()
        if result and any(result.values() if isinstance(result, dict) else []):
            log.info("%s -> %s", name, result)
        return result
    except Exception:
        log.exception("%s xato berdi", name)
        return None


def main() -> None:
    log.info("Xizmat sikli ishga tushdi: sweep=%ss finalize=%ss", SWEEP_EVERY, FINALIZE_EVERY)
    last_finalize = 0.0
    while True:
        started = time.time()
        _safe("sweep_stale_sessions", run_sweep_stale_sessions)
        if started - last_finalize >= FINALIZE_EVERY:
            _safe("finalize_ended_exams", run_finalize_ended_exams)
            last_finalize = started
        time.sleep(max(5, SWEEP_EVERY - (time.time() - started)))


if __name__ == "__main__":
    main()
