"""Yuqori natijani test markazida yuzma-yuz tasdiqlash.

NEGA (15.09.2026): uyda topshirilgan imtihonlarda kadrdan tashqaridagi odam
ekranni ko'rib, imo-ishora bilan javob ko'rsatmoqda. Kamera uni ko'rmaydi.
Oxirgi 3 haftada o'qituvchilarning 104 tasi 80%+ natijani 12 daqiqadan tez
olgan. Qaror (admin):

  * 80% va undan yuqori natija — shubhali belgi bo'lsa (tez to'g'ri javoblar,
    javobdan oldin chetga qarash naqshi, juda tez tugatish) HAMMASI, qolgan
    yuqori natijalardan tasodifiy 20% — "tasdiqlanishi kerak" navbatiga tushadi;
  * tasdiqlash test markazida yuzma-yuz (og'zaki savollar);
  * kutish paytida natija "tasdiqlanmoqda", sertifikat BERILMAYDI;
  * rad etilsa ball bekor (0), asl ball saqlanadi — natija "o'tmadi".

Topshiruvchi bu haqda imtihon OLDIDAN qoidalar matnida ogohlantiriladi.
Test markazida (PIN bilan) topshirilgan sessiya tanlanmaydi.
"""
from __future__ import annotations

import logging
import os
import random

from django.utils import timezone as dj_tz

logger = logging.getLogger("apps.api")

PENDING = "pending"
CONFIRMED = "confirmed"
REJECTED = "rejected"


def min_percent() -> int:
    try:
        return max(1, min(100, int(os.environ.get("VERIFY_MIN_PERCENT", "80"))))
    except ValueError:
        return 80


def random_share() -> float:
    try:
        return max(0.0, min(1.0, float(os.environ.get("VERIFY_RANDOM_SHARE", "0.20"))))
    except ValueError:
        return 0.20


def audiences() -> set[str]:
    raw = os.environ.get("VERIFY_AUDIENCES", "faculty,ordinator,magistr,vacancy,entrant")
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def applies_to(exam) -> bool:
    aud = str(getattr(exam, "audience", "") or "student").strip().lower()
    return aud in audiences()


def suspicion_reasons(se, exam, questions: list, answers: dict, timings: dict) -> list[str]:
    """Faqat qayd uchun belgilar (jazo emas) — tanlashda ishlatiladi."""
    reasons: list[str] = []
    try:
        from apps.api.answer_timing import gaze_answer_assessment, quick_correct

        qc, n_long = quick_correct(questions, answers, timings)
        if n_long >= 5 and qc >= 5:
            reasons.append("tez to'g'ri javoblar (%d ta uzun savol 8 soniyadan tez)" % qc)
        ga = gaze_answer_assessment(timings)
        if ga["suspicious"]:
            if ga["legacy"]:
                reasons.append("javobdan oldin chetga qarash %d/%d savolda" % (ga["glance"], ga["answered"]))
            else:
                reasons.append(
                    "javobdan oldin chetga qarash %d/%d savolda (odatiy %d%%, %s tomonga %d%%)"
                    % (ga["glance"], ga["answered"], round(ga["expected"] * 100), ga["side"], round(ga["same_side"] * 100))
                )
    except Exception:  # noqa: BLE001
        logger.warning("verification: timings tahlili yiqildi se=%s", getattr(se, "id", None), exc_info=True)
    try:
        dur = int(getattr(exam, "duration_minutes", 0) or 0) * 60
        if dur and se.started_at and se.completed_at:
            spent = (se.completed_at - se.started_at).total_seconds()
            if spent < 0.35 * dur:
                reasons.append("juda tez tugatildi (%d daqiqa, imtihon %d daqiqa)" % (spent // 60, dur // 60))
    except Exception:  # noqa: BLE001
        pass
    return reasons


def maybe_mark_for_verification(se, exam, questions: list, answers: dict, timings: dict, percentage: int) -> str:
    """Yakunlangan sessiyani kerak bo'lsa navbatga qo'yadi. Holatni qaytaradi."""
    try:
        if not applies_to(exam):
            return ""
        if bool(getattr(se, "test_center_mode", False)):
            return ""
        if (se.status or "").strip() != "Completed" or int(percentage or 0) < min_percent():
            return ""
        if getattr(se, "verify_state", ""):
            return se.verify_state
        reasons = suspicion_reasons(se, exam, questions, answers, timings or {})
        if not reasons and random.random() >= random_share():
            return ""
        se.verify_state = PENDING
        se.verify_reason = ("; ".join(reasons) if reasons else "tasodifiy tanlov")[:500]
        se.save(update_fields=["verify_state", "verify_reason"])
        logger.info("[VERIFY] navbatga qo'yildi se=%s %s%% sabab=%s", se.id, percentage, se.verify_reason)
        return PENDING
    except Exception:  # noqa: BLE001
        logger.exception("verification: tanlash yiqildi se=%s", getattr(se, "id", None))
        return ""


def certificate_blocked(se) -> bool:
    return str(getattr(se, "verify_state", "") or "") in (PENDING, REJECTED)


def decide(se, decision: str, note: str, actor_id: str) -> None:
    """Admin qarori: confirm / reject / pending (qayta navbatga)."""
    now = dj_tz.now()
    fields = ["verify_state", "verify_note", "verify_by", "verify_at"]
    if decision == "confirm":
        if se.verify_state == REJECTED and se.verify_original_score is not None:
            se.score = se.verify_original_score
            fields.append("score")
        se.verify_state = CONFIRMED
    elif decision == "reject":
        if se.verify_state != REJECTED:
            se.verify_original_score = se.score
            se.score = 0
            fields += ["verify_original_score", "score"]
        se.verify_state = REJECTED
    elif decision == "pending":
        if se.verify_state == REJECTED and se.verify_original_score is not None:
            se.score = se.verify_original_score
            fields.append("score")
        se.verify_state = PENDING
    else:
        raise ValueError("decision")
    se.verify_note = str(note or "")[:2000]
    se.verify_by = str(actor_id or "")[:64]
    se.verify_at = now
    se.save(update_fields=list(dict.fromkeys(fields)))


NOTICE = {
    PENDING: (
        "Natijangiz yuqori — u test markazida yuzma-yuz tasdiqlanadi. Sizni chaqirishadi. "
        "Tasdiqlanguncha sertifikat berilmaydi.",
        "Ваш результат высокий — он будет подтверждён очно в тестовом центре. Вас пригласят. "
        "До подтверждения сертификат не выдаётся.",
        "Your score is high — it will be confirmed in person at the test centre. You will be invited. "
        "No certificate is issued until it is confirmed.",
    ),
    REJECTED: (
        "Natija test markazidagi tekshiruvda tasdiqlanmadi va bekor qilindi.",
        "Результат не подтверждён при проверке в тестовом центре и аннулирован.",
        "The result was not confirmed at the test-centre check and has been annulled.",
    ),
    CONFIRMED: (
        "Natija test markazida tasdiqlandi.",
        "Результат подтверждён в тестовом центре.",
        "The result was confirmed at the test centre.",
    ),
}


def notice(state: str, lang: str = "uz") -> str:
    i = {"uz": 0, "ru": 1, "en": 2}.get(lang, 0)
    t = NOTICE.get(state)
    return t[i] if t else ""


def rules_text(lang_index: int) -> str:
    p = min_percent()
    return (
        "%d%% va undan yuqori natija test markazida yuzma-yuz (og'zaki) tasdiqlanishi mumkin. "
        "Tasdiqlanguncha sertifikat berilmaydi; tasdiqlanmasa natija bekor qilinadi." % p,
        "Результат %d%% и выше может быть подтверждён очно (устно) в тестовом центре. "
        "До подтверждения сертификат не выдаётся; если результат не подтверждён — он аннулируется." % p,
        "A score of %d%% or higher may be confirmed in person (orally) at the test centre. "
        "No certificate is issued until confirmed; an unconfirmed result is annulled." % p,
    )[lang_index]
