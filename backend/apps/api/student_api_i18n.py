"""Talaba API xato/ogohlantirish matnlari (uz/ru/en)."""
from __future__ import annotations

from apps.api.proctor_violation_labels import _norm_lang


def _tri(uz: str, ru: str, en: str) -> dict[str, str]:
    return {"uz": uz, "ru": ru, "en": en}


_MSG: dict[str, dict[str, str]] = {
    "desktop_only": _tri(
        "Iltimos, kompyuter (desktop/laptop) orqali kiring. Telefon va planshetda imtihon topshirish mumkin emas.",
        "Пожалуйста, войдите с компьютера (desktop/laptop). Сдать экзамен с телефона или планшета нельзя.",
        "Please use a computer (desktop/laptop). Exams cannot be taken on a phone or tablet.",
    ),
    "profile_photo_required": _tri(
        "Profil rasmsiz imtihon boshlash mumkin emas. Administratorga murojaat qiling.",
        "Без фото профиля начать экзамен нельзя. Обратитесь к администратору.",
        "You cannot start the exam without a profile photo. Contact the administrator.",
    ),
    "vac_consent_required": _tri(
        "Imtihon nazorati qoidalarini o'qib, roziligingizni bildiring.",
        "Ознакомьтесь с правилами контроля экзамена и подтвердите согласие.",
        "Read the exam proctoring rules and give your consent.",
    ),
    "identity_required": _tri(
        "Yuz tekshiruvi talab qilinadi. Pre-exam bosqichini yakunlang.",
        "Требуется проверка лица. Завершите этап перед экзаменом.",
        "Face verification is required. Complete the pre-exam step.",
    ),
    "retake_exhausted": _tri(
        "Qayta topshirish imkoniyati tugadi. Administratorga murojaat qiling.",
        "Возможность пересдачи исчерпана. Обратитесь к администратору.",
        "Retake attempts are exhausted. Contact the administrator.",
    ),
    "exam_time_expired": _tri(
        "Imtihon vaqti tugagan. Javoblar qabul qilinmaydi.",
        "Время экзамена истекло. Ответы больше не принимаются.",
        "Exam time has expired. Answers are no longer accepted.",
    ),
    "exam_time_expired_short": _tri(
        "Imtihon vaqti tugagan",
        "Время экзамена истекло",
        "Exam time has expired",
    ),
    "identity_verify_expired": _tri(
        "Yuz tekshiruvi muddati tugagan.",
        "Срок проверки лица истёк.",
        "Face verification has expired.",
    ),
    "imentor_load_failed": _tri(
        "iMentor test yuklanmadi",
        "Не удалось загрузить тест iMentor",
        "Failed to load iMentor test",
    ),
    "submit_min_wait": _tri(
        "Imtihonni topshirish uchun kamida {n} soniya kuting.",
        "Подождите не менее {n} секунд перед отправкой экзамена.",
        "Wait at least {n} seconds before submitting the exam.",
    ),
    "bank_pool_insufficient": _tri(
        "Sizning guruhingiz (kurs/dastur) uchun tanlangan kategoriyalarda yetarli savol yo'q. Administrator kategoriya yoki guruh sozlamalarini tekshirsin.",
        "В выбранных категориях для вашей группы (курс/программа) недостаточно вопросов. Администратор должен проверить настройки категорий или группы.",
        "Not enough questions in the selected categories for your group (year/program). Ask an administrator to check category or group settings.",
    ),
    "forbidden": _tri(
        "Ruxsat yo'q",
        "Доступ запрещён",
        "Forbidden",
    ),
    "exam_not_found": _tri(
        "Imtihon topilmadi",
        "Экзамен не найден",
        "Exam not found",
    ),
    "exam_not_assigned": _tri(
        "Bu imtihon guruhingizga biriktirilmagan",
        "Этот экзамен не назначен вашей группе",
        "Exam not assigned to your group",
    ),
    "exam_not_started": _tri(
        "Imtihon hali boshlanmagan",
        "Экзамен ещё не начался",
        "Exam has not started yet",
    ),
    "exam_already_ended": _tri(
        "Imtihon allaqachon tugagan",
        "Экзамен уже завершён",
        "Exam has already ended",
    ),
    "exam_already_status": _tri(
        "Imtihon allaqachon {status}",
        "Экзамен уже {status}",
        "Exam already {status}",
    ),
    "no_active_session": _tri(
        "Faol sessiya yo'q",
        "Нет активной сессии",
        "No active session",
    ),
    "cannot_submit": _tri(
        "Imtihonni topshirib bo'lmaydi",
        "Нельзя сдать экзамен",
        "Cannot submit exam",
    ),
    "invalid_answers": _tri(
        "Javoblar formati noto'g'ri",
        "Некорректный формат ответов",
        "Invalid answers format",
    ),
    "appeal_fields_required": _tri(
        "exam_id va sabab majburiy",
        "Нужны exam_id и причина",
        "exam_id and reason are required",
    ),
    "appeal_reason_short": _tri(
        "Murojaat sababi juda qisqa",
        "Причина апелляции слишком короткая",
        "Appeal reason is too short",
    ),
    "appeal_no_ban": _tri(
        "Bu imtihon uchun ban yozuvi topilmadi",
        "Для этого экзамена запись о блокировке не найдена",
        "No banned record found for this exam",
    ),
    "appeal_pending_exists": _tri(
        "Bu imtihon uchun kutilayotgan murojaat allaqachon bor",
        "По этому экзамену уже есть ожидающая апелляция",
        "Pending appeal already exists for this exam",
    ),
    "ban_report_missing": _tri(
        "Ban report mavjud emas",
        "Отчёт о блокировке отсутствует",
        "Ban report is not available",
    ),
    "faculty_assessment_one_exam_only": _tri(
        "Siz allaqachon boshqa fan bo'yicha baholash imtihonini boshlagan yoki topshirgansiz. Faqat bitta fan tanlanadi.",
        "Вы уже начали или сдали оценочный экзамен по другому предмету. Можно выбрать только один предмет.",
        "You already started or completed an assessment exam for another subject. Only one subject is allowed.",
    ),
    "faculty_questions_not_ready": _tri(
        "Bu fan uchun savollar hali tayyorlanmoqda. Birozdan keyin qayta urinib ko'ring.",
        "Вопросы по этому предмету ещё готовятся. Попробуйте позже.",
        "Questions for this subject are still being prepared. Please try again shortly.",
    ),
}


def student_api_msg(key: str, lang: str | None = None, **fmt) -> str:
    entry = _MSG.get(key) or {}
    text = entry.get(_norm_lang(lang)) or entry.get("uz") or key
    if fmt:
        try:
            return text.format(**fmt)
        except Exception:
            return text
    return text
