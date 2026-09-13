"""Har bir savolga alohida vaqt va orqaga qaytmaslik — SERVER tomonida majburiy.

Nega: savolni telefon bilan rasmga olib, tashqaridan javob kutish uchun vaqt
qolmasin. Imtihon oynasi joriy savolni ko'rsatadi; "Keyingi" bosilganda yoki
vaqt tugaganda javob serverda qulflanadi (``question-advance``). Oxirgi
topshirishda faqat qulflangan javoblar va joriy savolning o'z vaqtida berilgan
javobi hisobga olinadi — brauzer/ilova qanday so'rov yuborishidan qat'i nazar.

Yoqilishi: imtihon toifasi ``QUESTION_LOCK_AUDIENCES`` da bo'lsa VA ilova buni
qo'llashini bildirsa (start so'rovida ``client_features: ["question_lock"]``).
Eski ilova versiyasi bilan boshlangan sessiyada qulf yoqilmaydi — aks holda
uning javoblari hisobga olinmay qolardi.
"""
from __future__ import annotations

import json
import os
from datetime import datetime

from django.utils import timezone as dj_tz

#: Tarmoq kechikishi uchun qo'shimcha soniyalar.
GRACE_SECONDS = 20
#: Bitta savolga eng kam vaqt.
MIN_SECONDS = 40
DEFAULT_AUDIENCES = "student,faculty,ordinator,magistr,vacancy,entrant"


def min_read_seconds() -> int:
    """Savolni O'QIMASDAN javob berib bo'lmaydi: shuncha soniyagacha 'Keyingi' qabul qilinmaydi.
    (25 savolga 5 daqiqada 80% — javob tashqaridan aytib turilganining belgisi edi.)"""
    try:
        return max(0, min(60, int(os.environ.get("QUESTION_MIN_READ_SECONDS", "12"))))
    except ValueError:
        return 12


def _flag(name: str, default: str) -> bool:
    return str(os.environ.get(name, default)).strip().lower() in ("1", "true", "yes", "on")


def lock_audiences() -> set[str]:
    raw = os.environ.get("QUESTION_LOCK_AUDIENCES", DEFAULT_AUDIENCES)
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def question_lock_enabled(exam) -> bool:
    aud = str(getattr(exam, "audience", "") or "student").strip().lower() or "student"
    return aud in lock_audiences()


def room_scan_required() -> bool:
    return _flag("ROOM_SCAN_REQUIRED", "1")


def webcam_snapshots_enabled() -> bool:
    return _flag("WEBCAM_SNAPSHOTS", "1")


def per_question_seconds(exam, total: int) -> int:
    dur = int(getattr(exam, "duration_minutes", 0) or 0) * 60
    n = max(1, int(total or 0))
    if dur <= 0:
        return 90
    return max(MIN_SECONDS, dur // n)


def load_lock(se) -> dict | None:
    try:
        data = json.loads(getattr(se, "question_lock_json", "") or "{}")
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("enabled") else None


def _ts(value, fallback):
    try:
        dt = datetime.fromisoformat(str(value))
        if dj_tz.is_naive(dt):
            dt = dj_tz.make_aware(dt)
        return dt
    except (TypeError, ValueError):
        return fallback


def _elapsed(lock: dict, now) -> float:
    return (now - _ts(lock.get("shown_at"), now)).total_seconds()


def public_state(lock: dict, total: int, now=None) -> dict:
    now = now or dj_tz.now()
    secs = int(lock.get("seconds") or 60)
    idx = int(lock.get("idx") or 0)
    remaining = max(0, secs - int(_elapsed(lock, now))) if idx < total else 0
    locked = lock.get("locked") or {}
    return {
        "enabled": True,
        "index": idx,
        "total": int(total),
        "per_question_seconds": secs,
        "remaining_seconds": remaining,
        "locked_ids": sorted((str(k) for k in locked.keys()), key=lambda x: (len(x), x)),
        "min_read_seconds": min(min_read_seconds(), max(0, secs - 5)),
    }


def start_state(se, exam, total: int, features, resuming: bool, now=None) -> dict | None:
    """Imtihon boshlanganda (yoki qayta ochilganda) qulf holati; qo'llanmasa None."""
    now = now or dj_tz.now()
    feats = {str(x) for x in (features or [])}
    if "question_lock" not in feats or not question_lock_enabled(exam) or int(total or 0) <= 0:
        # Oldingi urinishdan qolgan qulf yangi (qulfsiz) urinishga aralashmasin.
        if not resuming and getattr(se, "question_lock_json", ""):
            se.question_lock_json = ""
            se.save(update_fields=["question_lock_json"])
        return None
    lock = load_lock(se)
    if resuming:
        return public_state(lock, total, now) if lock else None
    lock = {
        "enabled": True,
        "idx": 0,
        "shown_at": now.isoformat(),
        "seconds": per_question_seconds(exam, total),
        "locked": {},
    }
    se.question_lock_json = json.dumps(lock)
    se.save(update_fields=["question_lock_json"])
    return public_state(lock, total, now)


def advance(se, questions: list, qid: str, normalized_answer: str, now=None) -> tuple[int, dict]:
    """Joriy savol javobini qulflab, keyingisiga o'tadi. (http_status, javob)."""
    now = now or dj_tz.now()
    lock = load_lock(se)
    total = len(questions or [])
    if not lock:
        return 400, {"error": "Savolga vaqt rejimi yoqilmagan", "code": "LOCK_DISABLED"}
    idx = int(lock.get("idx") or 0)
    if idx >= total:
        return 409, {"code": "LOCK_FINISHED", "state": public_state(lock, total, now)}
    current = str((questions[idx] or {}).get("id"))
    if str(qid) != current:
        return 409, {"code": "LOCK_MISMATCH", "state": public_state(lock, total, now)}
    secs = int(lock.get("seconds") or 60)
    elapsed = _elapsed(lock, now)
    min_read = min(min_read_seconds(), max(0, secs - 5))
    if elapsed < min_read:
        return 200, {
            "ok": False,
            "code": "TOO_EARLY",
            "wait": int(min_read - elapsed) + 1,
            "state": public_state(lock, total, now),
        }
    late = elapsed > secs + GRACE_SECONDS
    locked = dict(lock.get("locked") or {})
    locked[current] = "" if late else str(normalized_answer or "")
    lock["locked"] = locked
    # Server o'lchagan vaqt (ilova yuborgan vaqtga ishonilmaydi): tez-to'g'ri javob tahlili uchun.
    times = dict(lock.get("times") or {})
    times[current] = round(min(max(0.0, _elapsed(lock, now)), 36000.0), 1)
    lock["times"] = times
    lock["idx"] = idx + 1
    lock["shown_at"] = now.isoformat()
    se.question_lock_json = json.dumps(lock)
    se.save(update_fields=["question_lock_json"])
    return 200, {"ok": True, "late": late, "state": public_state(lock, total, now)}


def final_answers(lock: dict, questions: list, answers: dict, now=None) -> dict:
    """Hisobga olinadigan javoblar: qulflanganlar + joriy savolning o'z vaqtidagi javobi."""
    now = now or dj_tz.now()
    out = {str(k): v for k, v in (lock.get("locked") or {}).items() if v}
    idx = int(lock.get("idx") or 0)
    if 0 <= idx < len(questions or []):
        current = str((questions[idx] or {}).get("id"))
        secs = int(lock.get("seconds") or 60)
        value = (answers or {}).get(current)
        if value and _elapsed(lock, now) <= secs + GRACE_SECONDS:
            out[current] = value
    return out


#: Birinchi savol vaqti imtihon oynasi to'liq tayyor bo'lganda boshlanadi (kamera,
#: to'liq ekran). Faqat BIR MARTA va start'dan keyin qisqa vaqt ichida — aks holda
#: vaqtni qayta-qayta "yangilab" olish mumkin bo'lardi.
ARM_WINDOW_SECONDS = 180


def arm(se, total: int, now=None, deadline=None) -> tuple[int, dict]:
    """Birinchi savol soatini imtihon oynasi tayyor bo'lganda boshlaydi (bir marta).

    Qayta chaqirilsa (to'liq ekran qaytishi, ilova qayta ochilishi) soat
    yangilanmaydi — faqat joriy holat qaytariladi (ekran server bilan sinxronlanadi).
    Savolga vaqt imtihon oxirigacha sig'adigan qilib moslanadi.
    """
    now = now or dj_tz.now()
    lock = load_lock(se)
    if not lock:
        return 400, {"error": "Savolga vaqt rejimi yoqilmagan", "code": "LOCK_DISABLED"}
    if not lock.get("armed") and int(lock.get("idx") or 0) == 0:
        lock["armed"] = True
        lock["shown_at"] = now.isoformat()
        if deadline is not None and int(total or 0) > 0:
            left = (deadline - now).total_seconds() - 30
            fit = int(left // max(1, int(total)))
            if fit > 0:
                lock["seconds"] = max(20, min(int(lock.get("seconds") or 60), fit))
        se.question_lock_json = json.dumps(lock)
        se.save(update_fields=["question_lock_json"])
    return 200, {"ok": True, "state": public_state(lock, total, now)}
