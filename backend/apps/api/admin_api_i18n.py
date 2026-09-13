"""Admin/staff API xato matnlari (uz/ru/en)."""
from __future__ import annotations

from apps.api.proctor_violation_labels import _norm_lang


def _tri(uz: str, ru: str, en: str) -> dict[str, str]:
    return {"uz": uz, "ru": ru, "en": en}


_MSG: dict[str, dict[str, str]] = {
    "student_photo_required": _tri(
        "Talaba uchun profil rasmi majburiy",
        "Для студента обязательно фото профиля",
        "Student requires a profile photo",
    ),
    "evidence_file_required": _tri(
        "JPG yoki PDF evidence fayli majburiy",
        "Требуется файл-доказательство JPG или PDF",
        "JPG or PDF evidence file is required",
    ),
    "evidence_mime_only": _tri(
        "Faqat JPG yoki PDF qabul qilinadi",
        "Принимаются только JPG или PDF",
        "Only JPG or PDF is accepted",
    ),
    "evidence_too_large": _tri(
        "Evidence fayl hajmi 5MB dan oshmasin",
        "Размер файла-доказательства не должен превышать 5 МБ",
        "Evidence file must be at most 5 MB",
    ),
    "evidence_pdf_ext": _tri(
        "PDF fayl yuklang",
        "Загрузите PDF-файл",
        "Upload a PDF file",
    ),
    "evidence_jpg_ext": _tri(
        "JPG fayl yuklang",
        "Загрузите JPG-файл",
        "Upload a JPG file",
    ),
    "level_name_exists": _tri(
        "Bu nomdagi level allaqachon bor",
        "Уровень с таким названием уже существует",
        "A level with this name already exists",
    ),
    "level_not_found": _tri(
        "Level topilmadi",
        "Уровень не найден",
        "Level not found",
    ),
    "level_name_exists_alt": _tri(
        "Bu nomdagi daraja allaqachon bor",
        "Уровень с таким названием уже существует",
        "A level with this name already exists",
    ),
    "level_has_groups": _tri(
        "Bu darajada {n} ta guruh bor. Avval guruhlarni o'chirib yuboring.",
        "В этом уровне {n} групп(ы). Сначала удалите группы.",
        "This level has {n} group(s). Delete the groups first.",
    ),
    "direction_name_exists": _tri(
        "Bu nomdagi yo'nalish allaqachon bor",
        "Направление с таким названием уже существует",
        "A direction with this name already exists",
    ),
    "direction_not_found": _tri(
        "Yo'nalish topilmadi",
        "Направление не найдено",
        "Direction not found",
    ),
    "direction_has_groups": _tri(
        "Bu yo'nalishda {n} ta guruh bor. Avval guruhlarni boshqa yo'nalishga o'tkazing yoki o'chiring.",
        "В этом направлении {n} групп(ы). Сначала перенесите или удалите группы.",
        "This direction has {n} group(s). Move or delete the groups first.",
    ),
    "kafedra_name_exists": _tri(
        "Bu nomdagi kafedra allaqachon bor",
        "Кафедра с таким названием уже существует",
        "A department with this name already exists",
    ),
    "kafedra_code_exists": _tri(
        "Bu koddagi kafedra allaqachon bor",
        "Кафедра с таким кодом уже существует",
        "A department with this code already exists",
    ),
    "kafedra_not_found": _tri(
        "Kafedra topilmadi",
        "Кафедра не найдена",
        "Department not found",
    ),
    "kafedra_required": _tri(
        "Kafedra tanlanishi shart",
        "Необходимо выбрать кафедру",
        "Department selection is required",
    ),
    "faculty_subject_required": _tri(
        "Fan (kitob) nomi kiritilishi shart",
        "Необходимо указать название предмета (книги)",
        "Subject (book) name is required",
    ),
    "kafedra_has_directions": _tri(
        "Bu kafedrada {n} ta yo'nalish bor. Avval yo'nalishlarni boshqa kafedraga o'tkazing yoki bog'lanishni bekor qiling.",
        "У этой кафедры {n} направлений(я). Сначала перенесите направления или отвяжите их.",
        "This department has {n} direction(s). Move or unlink the directions first.",
    ),
    "academic_year_invalid": _tri(
        "academic_year noto‘g‘ri",
        "Некорректный academic_year",
        "Invalid academic_year",
    ),
    "raw_text_or_file": _tri(
        "raw_text yoki file kerak",
        "Нужен raw_text или file",
        "raw_text or file is required",
    ),
    "category_not_found": _tri(
        "Tanlangan kategoriya topilmadi",
        "Выбранная категория не найдена",
        "Selected category not found",
    ),
    "department_not_found": _tri(
        "Kafedra topilmadi",
        "Кафедра не найдена",
        "Department not found",
    ),
    "start_before_end": _tri(
        "Boshlanish vaqti tugash vaqtidan oldin bo'lishi kerak",
        "Время начала должно быть раньше времени окончания",
        "Start time must be before end time",
    ),
    "duration_invalid": _tri(
        "Imtihon davomiyligi noto'g'ri",
        "Некорректная длительность экзамена",
        "Invalid exam duration",
    ),
    "duration_positive": _tri(
        "Imtihon davomiyligi 0 dan katta bo'lishi kerak",
        "Длительность экзамена должна быть больше 0",
        "Exam duration must be greater than 0",
    ),
    "duration_exceeds_window": _tri(
        "Imtihon davomiyligi ({dur} daq) vaqt oralig'idan ({window} daq) katta bo'lishi mumkin emas",
        "Длительность экзамена ({dur} мин) не может превышать окно ({window} мин)",
        "Exam duration ({dur} min) cannot exceed the time window ({window} min)",
    ),
    "group_required": _tri(
        "Kamida bitta guruh tanlanishi kerak",
        "Нужно выбрать хотя бы одну группу",
        "Select at least one group",
    ),
    "invalid_question_count": _tri(
        "Noto'g'ri savollar soni",
        "Некорректное число вопросов",
        "Invalid question count",
    ),
    "imentor_load_failed": _tri(
        "iMentor test yuklanmadi",
        "Не удалось загрузить тест iMentor",
        "Failed to load iMentor test",
    ),
    "bank_pool_short": _tri(
        "Test bazasida yetarli savol yo'q ({have}/{need} kerak). Kategoriyalarga savol qo'shing yoki sonni kamaytiring.",
        "В тестовой базе недостаточно вопросов ({have}/{need}). Добавьте вопросы в категории или уменьшите число.",
        "Not enough questions in the test bank ({have}/{need} needed). Add questions or lower the count.",
    ),
    "bank_category_required": _tri(
        "Kamida bitta test bank kategoriyasini tanlang",
        "Выберите хотя бы одну категорию тестового банка",
        "Select at least one test bank category",
    ),
    "items_required": _tri(
        "items[] kerak",
        "Нужен items[]",
        "items[] is required",
    ),
    "retake_fields_required": _tri(
        "student_id, window_start, window_end kerak",
        "Нужны student_id, window_start, window_end",
        "student_id, window_start, and window_end are required",
    ),
    "retake_window_invalid": _tri(
        "Vaqt oralig‘i noto‘g‘ri",
        "Некорректный временной интервал",
        "Invalid time window",
    ),
    "student_not_found": _tri(
        "Talaba topilmadi",
        "Студент не найден",
        "Student not found",
    ),
    "ban_report_missing": _tri(
        "Ban report mavjud emas",
        "Отчёт о блокировке отсутствует",
        "Ban report is not available",
    ),
}


def admin_api_msg(key: str, lang: str | None = None, **fmt) -> str:
    entry = _MSG.get(key) or {}
    text = entry.get(_norm_lang(lang)) or entry.get("uz") or key
    if fmt:
        try:
            return text.format(**fmt)
        except Exception:
            return text
    return text
