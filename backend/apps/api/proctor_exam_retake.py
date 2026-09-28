"""Qoidabuzarlik limitiga yetganda avtomatik qayta topshirish (barcha 29 tur)."""
from __future__ import annotations

from apps.core.models import Exam, StudentExam


IDENTITY_VIOLATION_TYPE = "IDENTITY_SUBSTITUTION"

#: ATAYLAB chiterlik — bularga qayta topshirish BERILMAYDI, to'g'ridan-to'g'ri ban.
#:
#: Nega kerak: ilgari har qanday qoidabuzarlikda ban o'rniga yangi urinish
#: berilardi (imtihonda standart 3 ta). Ya'ni telefon bilan tutilgan nomzod
#: jazo o'rniga toza sahifa olardi va yana 3 marta urinib ko'rardi. Auditda
#: 141 ta qoidabuzarlikka qarshi 0 ta ban chiqqanining asosiy sababi shu.
#:
#: Texnik nosozlik turlari (kamera ochilmadi, tasvir uzildi) bu ro'yxatda
#: YO'Q — ular ilgarigidek qayta topshirish oladi, chunki ular talabaning
#: aybi emas.
DELIBERATE_CHEAT_VIOLATIONS = frozenset(
    {
        "IDENTITY_SUBSTITUTION",
        "FORBIDDEN_OBJECT_CELL_PHONE",
        "FORBIDDEN_OBJECT_LAPTOP",
        "FORBIDDEN_OBJECT_BOOK",
        "REMOTE_CONTROL_SUSPECTED",
        "VIRTUAL_WEBCAM_SUSPECTED",
        "DEVTOOLS_OPEN",
        "CLIPBOARD_ATTEMPT",
        "PRINT_SCREEN",
        "MULTI_MONITOR_DETECTED",
    }
)


def retake_allowed_for_violation(vtype: str) -> bool:
    """Shu tur uchun ban o'rniga qayta topshirish berish mumkinmi."""
    import os

    raw = os.environ.get("PROCTOR_NO_RETAKE_VIOLATIONS")
    if raw is None:
        blocked = DELIBERATE_CHEAT_VIOLATIONS
    else:
        blocked = {x.strip().upper() for x in raw.split(",") if x.strip()}
    return str(vtype or "").strip().upper() not in blocked


#: Maydon umuman bo'lmasa ishlatiladigan qiymatlar (model default'lari).
DEFAULT_VIOLATION_RETAKES = 3
DEFAULT_IDENTITY_RETAKES = 1
#: Admin formasidagi yuqori chegara (`views/admin.py` bilan bir xil).
MAX_RETAKES = 20


def exam_violation_retakes_allowed(exam: Exam) -> int:
    """Imtihonning "Qoidabuzarlik uchun qayta urinishlar" maydoni — YAGONA manba.

    DIQQAT: `int(x or 3)` YOZMANG. Admin ataylab **0** qo'ygan bo'lsa
    (`0 or 3 == 3`) u jimgina 3 ga aylanardi. Aynan shu sabab talabaga va
    adminga hamma joyda "3 ta imkoniyat bor" deb ko'rsatilar, lekin haqiqiy
    qaror qabul qiluvchi kod 0 ni ishlatib birinchi qoidabuzarlikdayoq ban
    qilardi. Standart qiymat FAQAT maydon umuman bo'lmaganda qo'llanadi.
    """
    raw = getattr(exam, "technical_retakes_allowed", None)
    if raw is None:
        raw = DEFAULT_VIOLATION_RETAKES
    return max(0, min(MAX_RETAKES, int(raw)))


def exam_identity_retakes_allowed(exam: Exam) -> int:
    """Imtihonning "Shaxs almashtirish uchun qayta urinishlar" maydoni."""
    raw = getattr(exam, "identity_retakes_allowed", None)
    if raw is None:
        raw = DEFAULT_IDENTITY_RETAKES
    return max(0, min(MAX_RETAKES, int(raw)))


def violation_retakes_budget(se: StudentExam, exam: Exam) -> int:
    bonus = max(0, int(getattr(se, "bonus_technical_retakes", 0) or 0))
    return exam_violation_retakes_allowed(exam) + bonus


def violation_retakes_remaining(se: StudentExam, exam: Exam) -> int:
    used = max(0, int(getattr(se, "technical_retakes_used", 0) or 0))
    return max(0, violation_retakes_budget(se, exam) - used)


def identity_retakes_budget(exam: Exam) -> int:
    return exam_identity_retakes_allowed(exam)


def identity_retakes_remaining(se: StudentExam, exam: Exam) -> int:
    used = max(0, int(getattr(se, "identity_retakes_used", 0) or 0))
    return max(0, identity_retakes_budget(exam) - used)


#: Qayta urinishda savollar YANGIDAN yaratiladigan rejimlar. Retake reset ham,
#: retake oynasidagi /start ham shu bitta ro'yxatdan foydalanadi (ilgari ikki joyda
#: turlicha edi: biri faculty_ai_books ni, biri vacancy_ai ni tashlab ketardi).
REGENERATE_QUESTION_MODES = ("bank_mixed", "imentor_mixed", "faculty_ai_books", "vacancy_ai", "static", "")


def reset_fields_for_exam_retake(se: StudentExam) -> list[str]:
    """Sessiyani tozalab Pending holatiga qaytaradi."""
    se.status = "Pending"
    se.answers_json = ""
    se.score = None
    se.draft_answers_json = "{}"
    se.draft_flagged_json = "[]"
    se.draft_updated_at = None
    se.proctor_official_warnings = 0
    se.proctor_last_warning_at = None
    se.proctor_last_frame_at = None
    se.started_at = None
    se.completed_at = None
    se.device_fingerprint = ""
    se.device_bound_at = None
    se.session_signing_key = ""
    se.session_request_seq = 1
    se.session_challenge = ""
    se.device_session_token = ""
    se.identity_verified_at = None
    se.question_lock_json = ""
    se.test_center_mode = False
    se.test_center_at = None
    # Oldingi natijaning qoldiqlari yangi urinishga o'tmasin: eski "rad etilgan"
    # holat yangi natijani abadiy to'sib qo'yardi, "tasdiqlash" esa eski ballni
    # yangisining ustiga qaytarardi; eski tekshirish havolasi ham ishlab turardi.
    se.verify_state = ""
    se.verify_reason = ""
    se.verify_note = ""
    se.verify_by = ""
    se.verify_at = None
    se.verify_original_score = None
    se.result_public_id = None
    se.result_verify_secret = ""
    se.ai_summary_json = ""
    se.answer_timings_json = ""
    se.flagged_questions_json = "[]"
    update_fields = [
        "verify_state",
        "verify_reason",
        "verify_note",
        "verify_by",
        "verify_at",
        "verify_original_score",
        "result_public_id",
        "result_verify_secret",
        "ai_summary_json",
        "answer_timings_json",
        "flagged_questions_json",
        "status",
        "answers_json",
        "score",
        "draft_answers_json",
        "draft_flagged_json",
        "draft_updated_at",
        "proctor_official_warnings",
        "proctor_last_warning_at",
        "proctor_last_frame_at",
        "started_at",
        "completed_at",
        "device_fingerprint",
        "device_bound_at",
        "session_signing_key",
        "session_request_seq",
        "session_challenge",
        "device_session_token",
        "identity_verified_at",
        "question_lock_json",
        "test_center_mode",
        "test_center_at",
    ]
    exam = getattr(se, "exam", None)
    if exam is None:
        exam = Exam.objects.filter(pk=se.exam_id).first()
    # vacancy_ai: nomzodga qayta imkon berilsa, savollar YANGIDAN yaratilishi
    # kerak. Aks holda u xuddi o'sha 20 ta savolni qayta ko'rardi va qayta
    # topshirish ma'nosini yo'qotardi.
    if exam and (exam.exam_mode or "") in REGENERATE_QUESTION_MODES:
        se.session_questions_json = None
        update_fields.append("session_questions_json")
    return update_fields


def _retake_response(
    *,
    reason_text: str,
    violations_count: int,
    retakes_remaining: int,
    retakes_used: int,
    identity_retake: bool,
) -> dict:
    return {
        "banned": False,
        "examRetake": True,
        "technicalRetake": True,
        "identityRetake": identity_retake,
        "retakesRemaining": retakes_remaining,
        "technicalRetakesRemaining": retakes_remaining,
        "retakesUsed": retakes_used,
        "technicalRetakesUsed": retakes_used,
        "violationsCount": violations_count,
        "warningNumber": 0,
        "violationReason": reason_text,
        "isFinalWarning": False,
        "warningSuppressed": False,
        "officialWarnings": 0,
    }


def exam_retakes_exhausted(se: StudentExam, exam: Exam) -> bool:
    """Berilgan qayta topshirishni resume qilib bo'lmaydimi (start bloklanadi).

    MUHIM — bu `try_apply_exam_retake` dagi tekshiruv bilan BIR XIL EMAS va shunday
    bo'lishi ham kerak. Ikkalasi turli savolga javob beradi:

      `try_apply_exam_retake`  → "yangi retake BERISH mumkinmi?"  (remaining > 0)
      `exam_retakes_exhausted` → "berilganini RESUME qilish mumkinmi?" (used > budget)

    Hisoblagich retake BERILGANDA oshiriladi, `..._remaining()` esa max(0, ...) bilan
    cheklangan. Shu sabab endigina berilgan oxirgi retake uchun `remaining == 0` bo'ladi —
    agar bu yerda ham `remaining <= 0` ishlatilsa, talaba haqli ravishda berilgan
    retake'ni hech qachon resume qila olmasdi.

    `used > budget` faqat admin ruxsat sonini KEYIN kamaytirgan holatda rost bo'ladi.
    Oddiy oqimda Pending sessiya doim resume qilinadi; byudjet tugagach keyingi
    qoidabuzarlikda `try_apply_exam_retake` None qaytaradi va chaqiruvchi ban qiladi.
    """
    v_used = max(0, int(getattr(se, "technical_retakes_used", 0) or 0))
    id_used = max(0, int(getattr(se, "identity_retakes_used", 0) or 0))
    if v_used > violation_retakes_budget(se, exam):
        return True
    if id_used > identity_retakes_budget(exam):
        return True
    return False


def exam_rules(exam) -> dict:
    """Imtihonning qo'shimcha sozlamalari (`custom_rules` JSON) — xavfsiz o'qish."""
    import json as _json

    raw = str(getattr(exam, "custom_rules", "") or "").strip()
    if not raw:
        return {}
    try:
        data = _json.loads(raw)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def exam_is_remote(exam) -> bool:
    """Imtihon uyidan topshiriladimi (test markazi PIN'i talab qilinmaydi).

    Bu ATAYLAB alohida belgi: imtihonda PIN maydoni bo'sh qolgani o'zi yetarli
    emas — aks holda yangi imtihon yaratib, PIN talabini chetlab o'tish mumkin
    bo'lardi. Ishga kiruvchilar (vacancy) esa doim uydan topshiradi.
    """
    if str(getattr(exam, "audience", "") or "") == "vacancy":
        return True
    return bool(exam_rules(exam).get("remote"))


def exam_auto_retake_all(exam: Exam) -> bool:
    """Imtihonda HAR QANDAY chetlatish o'rniga (byudjet bo'lsa) qayta topshirish beriladimi.

    Uyidan topshiriladigan imtihonlarda noto'g'ri aniqlash (stoldagi kitob,
    qo'ldagi ruchka) tufayli odam chetlatilib qolardi va admin qo'lda qayta
    ruxsat berishi kerak bo'lardi. Imtihon sozlamasida `auto_retake_all`
    yoqilgan bo'lsa, tizim buni O'ZI qiladi: hodisa dalil sifatida saqlanadi,
    urinish esa byudjetdan yechiladi. Byudjet tugagach odatdagidek ban bo'ladi.
    """
    import json as _json

    raw = str(getattr(exam, "custom_rules", "") or "").strip()
    if not raw:
        return False
    try:
        data = _json.loads(raw)
    except ValueError:
        return False
    return bool(isinstance(data, dict) and data.get("auto_retake_all"))


def try_apply_exam_retake(
    se: StudentExam,
    exam: Exam,
    *,
    reason_text: str,
    violations_count: int,
    violation_type: str,
) -> dict | None:
    """Ban o'rniga qayta topshirish. Imkon yo'q bo'lsa None (keyin ban)."""
    vtype = str(violation_type or "").strip()
    if not retake_allowed_for_violation(vtype) and not exam_auto_retake_all(exam):
        # Ataylab chiterlik — ikkinchi imkoniyat yo'q. Chaqiruvchi ban qiladi.
        return None
    if vtype == IDENTITY_VIOLATION_TYPE:
        if identity_retakes_remaining(se, exam) <= 0:
            return None
        se.identity_retakes_used = int(getattr(se, "identity_retakes_used", 0) or 0) + 1
        remaining = identity_retakes_remaining(se, exam)
        used = se.identity_retakes_used
        update_fields = reset_fields_for_exam_retake(se)
        update_fields.append("identity_retakes_used")
        se.save(update_fields=list(dict.fromkeys(update_fields)))
        return _retake_response(
            reason_text=reason_text,
            violations_count=violations_count,
            retakes_remaining=remaining,
            retakes_used=used,
            identity_retake=True,
        )

    if violation_retakes_remaining(se, exam) <= 0:
        # Byudjet tugagan — retake yo'q. Chaqiruvchi ban qiladi.
        return None

    # DIQQAT: ilgari bu yerda hisoblagich oshirilgach `remaining <= 0` bo'lsa
    # DARHOL ban qilinardi. Natijada OXIRGI ruxsat etilgan qayta topshirish hech
    # qachon berilmasdi: `allowed=3` bo'lsa talaba 3 emas, 2 ta olardi va
    # 3-qoidabuzarlikda "yana 1 ta imkoniyat qoldi" deb yozilgan holda banlanardi.
    #
    # To'g'ri mezon yuqorida: byudjet BOR bo'lsa retake beriladi. Byudjet
    # tugagach keyingi qoidabuzarlikda `return None` ishlaydi va ban bo'ladi.
    # Yuqoridagi identity yo'li allaqachon aynan shunday ishlaydi (`allowed=1` →
    # 1 ta beriladi, 2-chisida None) — technical yo'li unga moslashtirildi.
    se.technical_retakes_used = int(getattr(se, "technical_retakes_used", 0) or 0) + 1
    remaining = violation_retakes_remaining(se, exam)
    used = se.technical_retakes_used
    update_fields = reset_fields_for_exam_retake(se)
    update_fields.append("technical_retakes_used")
    se.save(update_fields=list(dict.fromkeys(update_fields)))
    return _retake_response(
        reason_text=reason_text,
        violations_count=violations_count,
        retakes_remaining=remaining,
        retakes_used=used,
        identity_retake=False,
    )


def notify_exam_retake(
    student_id: str,
    student_exam_id: int,
    exam_id: int,
    *,
    remaining: int,
    reason: str,
    retakes_used: int = 0,
    identity_retake: bool = False,
) -> None:
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                f"exam_{exam_id}",
                {
                    "type": "exam.exam_retake",
                    "student_id": str(student_id),
                    "student_exam_id": student_exam_id,
                    "exam_id": exam_id,
                    "retakes_remaining": remaining,
                    "technical_retakes_remaining": remaining,
                    "retakes_used": retakes_used,
                    "reason": reason,
                    "identity_retake": identity_retake,
                },
            )
    except Exception:
        pass


def grant_bonus_retakes(se: StudentExam, *, amount: int = 3) -> int:
    se.bonus_technical_retakes = int(getattr(se, "bonus_technical_retakes", 0) or 0) + max(1, amount)
    return se.bonus_technical_retakes
