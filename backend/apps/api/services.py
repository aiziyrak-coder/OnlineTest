"""Imtihon yordamchi funksiyalar (Express server.ts mantiqining Python porti)."""
from __future__ import annotations

import hashlib
import hmac
import json
import random
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone as dj_tz

from apps.core.models import Group, ResultIdCounter
from apps.api.view_utils import safe_json_loads


def shuffle_in_place(arr: list) -> list:
    for i in range(len(arr) - 1, 0, -1):
        j = random.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def build_student_question_list(full: list[dict]) -> list[dict]:
    out = []
    for q in full:
        opts = list(q.get("options") or [])
        shuffle_in_place(opts)
        out.append({"id": q["id"], "text": q["text"], "options": opts})
    return out


def _option_explanation_for(q: dict, answer: str, lang: str = "uz") -> str:
    """Talaba tanlagan variant uchun iMentor optionExplanations dan izoh (imtihon tiliga mos)."""
    opts = [str(o) for o in (q.get("options") or [])]
    expls = q.get(f"optionExplanations_{lang}") or q.get("optionExplanations")
    if not isinstance(expls, list) or not opts or not answer:
        return ""
    try:
        idx = opts.index(str(answer))
    except ValueError:
        # Qisman moslik (til/format farqi)
        idx = next((i for i, o in enumerate(opts) if answer in o or o in answer), -1)
    if idx < 0 or idx >= len(expls):
        return ""
    return str(expls[idx] or "").strip()


_CORRECT_TEMPLATE = {
    "uz": "Javob to'g'ri tanlangan.",
    "ru": "Ответ выбран верно.",
    "en": "Correct answer selected.",
}
_CHOSE_WRONG_TEMPLATE = {
    "uz": 'Siz "{chosen}" variantini tanladingiz — to\'g\'ri javob "{correct}".',
    "ru": 'Вы выбрали вариант "{chosen}" — правильный ответ "{correct}".',
    "en": 'You selected "{chosen}" — the correct answer is "{correct}".',
}
_UNANSWERED_TEMPLATE = {
    "uz": 'Javob belgilanmagan — to\'g\'ri javob "{correct}".',
    "ru": 'Ответ не был выбран — правильный ответ "{correct}".',
    "en": 'No answer was selected — the correct answer is "{correct}".',
}
_EMPTY_ANSWER = {"uz": "bo'sh", "ru": "пусто", "en": "empty"}
_NO_MATCH_TEMPLATE = {
    "uz": 'Tanlangan javob ("{chosen}") savolning to\'g\'ri yechimi bilan mos kelmaydi.',
    "ru": 'Выбранный ответ ("{chosen}") не соответствует правильному решению вопроса.',
    "en": 'The selected answer ("{chosen}") does not match the correct solution to the question.',
}
_ONLY_CLEAR_OPTION_TEMPLATE = {
    "uz": 'To\'g\'ri javob "{correct}" -- savol mazmuniga mos yagona aniq variant.',
    "ru": 'Правильный ответ "{correct}" -- единственный вариант, точно соответствующий содержанию вопроса.',
    "en": 'The correct answer is "{correct}" -- the only option that clearly matches the question.',
}


def _api_explanation_pair(
    q: dict, student_answer: str, *, is_correct: bool, lang: str = "uz"
) -> tuple[str, str, str]:
    """
    API (iMentor) manbasidagi izohlar — imtihon tiliga mos variantda.
    Qaytaradi: (commentCorrect, whyStudentWrong, whyCorrectIsRight) — bo'sh bo'lishi mumkin.
    """
    lang = lang if lang in ("uz", "ru", "en") else "uz"
    explanation = str(q.get(f"explanation_{lang}") or q.get("explanation") or "").strip()
    if is_correct:
        return (explanation or _CORRECT_TEMPLATE[lang], "", "")
    why_wrong = _option_explanation_for(q, student_answer, lang)
    correct_localized = str(
        q.get(f"correct_answer_{lang}") or q.get("correctAnswer") or ""
    ).strip()
    why_right = explanation or _option_explanation_for(q, str(q.get("correctAnswer") or ""), lang)
    if not why_wrong and why_right:
        # Ko'p iMentor testlarida umumiy `explanation` bor, lekin har bir variant
        # uchun alohida izoh (`optionExplanations`) yo'q. Bunday holatda "Nega
        # xato" maydoni bo'sh qolib, talaba natijada hech narsa ko'rmasdi.
        # Tibbiy sabab O'YLAB TOPILMAYDI — faqat baholash faktи aytiladi,
        # asosiy tushuntirish esa quyidagi "to'g'ri variant" qatorida turadi.
        chosen = str(student_answer or "").strip()
        if chosen:
            why_wrong = _CHOSE_WRONG_TEMPLATE[lang].format(chosen=chosen, correct=correct_localized)
        else:
            why_wrong = _UNANSWERED_TEMPLATE[lang].format(correct=correct_localized)
    return ("", why_wrong, why_right)


def question_references(q: dict) -> list[dict]:
    """Savolga biriktirilgan manbalar (iMentor `references`). Bo'sh bo'lishi mumkin."""
    refs = q.get("references") if isinstance(q, dict) else None
    if not isinstance(refs, list):
        return []
    return [r for r in refs if isinstance(r, dict) and (r.get("title") or r.get("url"))]


def question_has_api_explanations(q: dict) -> bool:
    if str(q.get("explanation") or "").strip():
        return True
    oe = q.get("optionExplanations")
    return isinstance(oe, list) and any(str(x).strip() for x in oe)


def build_fallback_ai_summary(
    questions: list[dict], answers: dict[str, str], language: str = "uz"
) -> dict:
    lang = (language or "uz").lower()
    if lang not in ("uz", "ru", "en"):
        lang = "uz"
    items = []
    used_api = 0
    for q in questions:
        qid = q["id"]
        st = answers.get(str(qid), "") or ""
        ok = st == q.get("correctAnswer")
        comment, why_wrong, why_right = _api_explanation_pair(q, st, is_correct=ok, lang=lang)
        if question_has_api_explanations(q) and (comment or why_wrong or why_right):
            used_api += 1
            item_source = "api"
        else:
            item_source = "fallback"
            correct_localized = str(
                q.get(f"correct_answer_{lang}") or q.get("correctAnswer") or ""
            ).strip()
            comment = _CORRECT_TEMPLATE[lang] if ok else ""
            why_wrong = "" if ok else _NO_MATCH_TEMPLATE[lang].format(chosen=(st or _EMPTY_ANSWER[lang]))
            why_right = "" if ok else _ONLY_CLEAR_OPTION_TEMPLATE[lang].format(correct=correct_localized)
        items.append(
            {
                "questionId": qid,
                "isCorrect": ok,
                "commentCorrect": comment,
                "whyStudentWrong": why_wrong,
                "whyCorrectIsRight": why_right,
                "explanationSource": item_source,
                "references": question_references(q) if item_source == "api" else [],
            }
        )
    if used_api == len(questions) and questions:
        source = "api"
    elif used_api > 0:
        source = "mixed"
    else:
        source = "fallback"
    overview_api = {
        "uz": "Quyida har bir savol bo'yicha API manbasidagi tahlil ko'rsatilgan.",
        "ru": "Ниже показан анализ по каждому вопросу из источника API.",
        "en": "Below is the per-question analysis from the API source.",
    }
    overview_fallback = {
        "uz": "Quyida har bir savol bo'yicha avtomatik tekshiruv natijalari ko'rsatilgan.",
        "ru": "Ниже показаны результаты автоматической проверки по каждому вопросу.",
        "en": "Below are the automatic check results for each question.",
    }
    return {
        "overview": overview_api[lang] if source == "api" else overview_fallback[lang],
        "items": items,
        "source": source,
    }


def build_exam_ai_summary(questions: list[dict], answers: dict[str, str], language: str) -> dict:
    """Avvalo iMentor/API izohlari; yetishmasa AI. Kalit yo'q yoki xato → fallback."""
    from apps.api.gemini_tools import generate_exam_ai_summary

    lang = (language or "uz").lower()
    if lang == "auto":
        lang = "uz"

    # API manbasi to'liq bo'lsa — AI umuman chaqirilmaydi.
    api_ready = all(question_has_api_explanations(q) for q in questions) if questions else False
    if api_ready:
        return build_fallback_ai_summary(questions, answers, lang)

    # Qisman: AI'ga FAQAT izohi yo'q savollar yuboriladi. Ilgari butun ro'yxat
    # yuborilardi — bitta izohsiz savol tufayli API izohi bor savollar ham
    # AI'ga ketardi (ortiqcha xarajat + tayyor manbani qayta yozish xavfi).
    missing = [q for q in questions if not question_has_api_explanations(q)]
    try:
        ai = generate_exam_ai_summary(missing, answers, lang) if missing else {"items": [], "source": "api"}
    except Exception:
        ai = build_fallback_ai_summary(questions, answers, lang)

    # AI natijasini API izohlari bilan boyitish (bo'sh joylarni to'ldirish)
    items_out = []
    used_api = 0
    used_ai = 0
    for q in questions:
        qid = q["id"]
        st = answers.get(str(qid), "") or ""
        ok = st == q.get("correctAnswer")
        ai_row = next((i for i in (ai.get("items") or []) if i.get("questionId") == qid), {}) or {}
        c_api, w_api, r_api = _api_explanation_pair(q, st, is_correct=ok, lang=lang)
        if question_has_api_explanations(q) and (c_api or w_api or r_api):
            used_api += 1
            items_out.append(
                {
                    "questionId": qid,
                    "isCorrect": ok,
                    "commentCorrect": c_api if ok else "",
                    "whyStudentWrong": "" if ok else (w_api or ai_row.get("whyStudentWrong") or ""),
                    "whyCorrectIsRight": "" if ok else (r_api or ai_row.get("whyCorrectIsRight") or ""),
                    "explanationSource": "api",
                    "references": question_references(q),
                }
            )
        else:
            used_ai += 1
            items_out.append(
                {
                    "questionId": qid,
                    "isCorrect": ok,
                    "commentCorrect": ai_row.get("commentCorrect", "") if ok else "",
                    "whyStudentWrong": "" if ok else ai_row.get("whyStudentWrong", ""),
                    "whyCorrectIsRight": "" if ok else ai_row.get("whyCorrectIsRight", ""),
                    "explanationSource": "ai" if (ai.get("source") == "ai") else str(ai_row.get("explanationSource") or ai.get("source") or "ai"),
                    "references": [],
                }
            )

    if used_api and not used_ai:
        source = "api"
    elif used_api and used_ai:
        source = "mixed"
    else:
        source = ai.get("source") or "ai"

    return {
        "overview": str(ai.get("overview") or "").strip()
        or "Quyida har bir savol bo'yicha tahlil natijalari ko'rsatilgan.",
        "items": items_out,
        "source": source,
    }


def needs_ai_summary_upgrade(ai: dict) -> bool:
    """Eski shablon yoki fallback summary — AI bilan yangilash kerakmi."""
    from django.conf import settings

    if not getattr(settings, "OPENAI_API_KEY", None):
        return False
    if not ai.get("items"):
        return True
    # API manbasi (iMentor explanation) — AI shart emas
    if ai.get("source") in ("api", "imentor"):
        return False
    if ai.get("source") == "mixed":
        # Aralash: shablon qoldiqlari bo'lsa yangilash mumkin
        pass
    elif ai.get("source") != "ai":
        return True
    for item in ai.get("items") or []:
        if item.get("isCorrect"):
            continue
        ww = str(item.get("whyStudentWrong") or "")
        wr = str(item.get("whyCorrectIsRight") or "")
        if "savolning to'g'ri yechimi bilan mos kelmaydi" in ww:
            return True
        if "savol mazmuniga mos yagona aniq variant" in wr:
            return True
    return False


def finalize_student_exam_session(
    se,
    exam,
    answers: dict,
    flagged: list | None = None,
    *,
    completed_at=None,
) -> tuple[int, int]:
    """Javoblar bilan sessiyani Completed qiladi (submit va avto-tugatish uchun)."""
    from apps.api.view_utils import validate_exam_answers

    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(exam.questions_json, [])
    raw_questions = list(questions)
    raw_answers = answers if isinstance(answers, dict) else {}
    # Savolga vaqt rejimi: qulflangan javoblar question_lock_json da — avto-yakunlashda
    # (ilova yopilgan, vaqt tugagan) ular yo'qolmasin.
    try:
        from apps.api.question_lock import load_lock as _ql_load

        _lk = _ql_load(se)
    except Exception:  # noqa: BLE001
        _lk = None
    if _lk:
        raw_answers = {
            **{str(k): v for k, v in raw_answers.items()},
            **{str(k): v for k, v in (_lk.get("locked") or {}).items() if v},
        }
    questions = prepare_questions_for_grading(questions, exam, raw_answers)
    # Bardoshli rejim: ilgari bitta nomuvofiq javob `norm = {}` ga olib kelardi —
    # ya'ni talabaning BARCHA javoblari yo'qolib, ball 0 bo'lardi. Endi faqat
    # o'sha bitta javob tashlab yuboriladi.
    norm = validate_exam_answers(questions, raw_answers, strict=False)
    score = sum(1 for q in questions if norm.get(str(q["id"])) == q.get("correctAnswer"))
    flagged_json = json.dumps(flagged) if flagged else "[]"
    done_at = completed_at or dj_tz.now()
    result_public_id = next_result_public_id()
    verify_secret = secrets.token_hex(32)
    # Tezkor shablon — haqiqiy AI tushuntirish natija birinchi ochilganda hisoblanadi
    # (`_upgrade_ai_summary_if_needed`, student_results.py). Bu funksiya avto-yakunlash
    # (vaqt tugaganda) uchun ham ishlatiladi — talaba kutib turmasa ham, izchillik uchun
    # bir xil "tezkor keyin yangilash" qoidasi.
    quick_lang = detect_grading_language(exam, norm, raw_questions=raw_questions)
    ai_summary_json = json.dumps(build_fallback_ai_summary(questions, norm, quick_lang))
    se.status = "Completed"
    se.score = score
    se.answers_json = json.dumps(norm)
    se.flagged_questions_json = flagged_json
    se.completed_at = done_at
    se.result_public_id = result_public_id
    se.result_verify_secret = verify_secret
    se.ai_summary_json = ai_summary_json
    se.draft_answers_json = "{}"
    se.draft_flagged_json = "[]"
    se.draft_updated_at = None
    se.save()
    return score, len(questions)


def auto_finalize_student_exam_if_expired(se, exam, student_id: str) -> bool:
    """Vaqt tugagan In Progress sessiyani draft javoblar bilan yakunlaydi."""
    from apps.api.exam_time import is_student_exam_expired

    if not is_student_exam_expired(exam, se, student_id):
        return False
    answers = safe_json_loads(se.draft_answers_json, {})
    flagged = safe_json_loads(se.draft_flagged_json, [])
    finalize_student_exam_session(se, exam, answers, flagged)
    return True


def next_result_public_id() -> str:
    year = datetime.now(timezone.utc).year
    with transaction.atomic():
        c, _ = ResultIdCounter.objects.select_for_update().get_or_create(
            pk=1, defaults={"next_num": 37923423}
        )
        c.next_num += 1
        c.save(update_fields=["next_num"])
        n = c.next_num
    return f"FJSTI_{str(n).zfill(8)}_{year}"


def integrity_code(result_id: str, completed_at: str, score: int, total: int, secret: str) -> str:
    msg = f"{result_id}|{completed_at}|{score}|{total}|{secret}"
    return hmac.new(
        settings.JWT_SECRET.encode(),
        msg.encode(),
        hashlib.sha256,
    ).hexdigest()[:24].upper()


def assert_safe_result_public_id(rid: str) -> bool:
    return bool(rid and len(rid) <= 80 and re.match(r"^FJSTI_[0-9]{8}_20[0-9]{2}$", rid))


def public_base_url(request) -> str:
    if settings.PUBLIC_APP_URL:
        return settings.PUBLIC_APP_URL.rstrip("/")
    host = request.META.get("HTTP_HOST", "127.0.0.1:8000")
    xf = request.META.get("HTTP_X_FORWARDED_PROTO", "http")
    proto = xf.split(",")[0].strip() if isinstance(xf, str) else "http"
    return f"{proto}://{host}"


def parse_pdf_questions(file_obj) -> list[dict]:
    """
    PDF dan savollarni ajratadi.
    Qo'llab-quvvatlangan formatlar:
    - 1. Savol / 1) Savol
    - Variantlar: A) B) C) D) yoki a. b. c. d. yoki 1) 2) 3) 4)
    - Javob kaliti hujjat oxirida ham bo'lishi mumkin
    """
    from pypdf import PdfReader
    from io import BytesIO
    from apps.api.gemini_tools import parse_flexible_questionnaire, detect_question_language

    raw = file_obj.read()
    reader = PdfReader(BytesIO(raw))
    text = ""
    for page in reader.pages:
        text += (page.extract_text() or "") + "\n"

    if not text.strip():
        return []

    # Aqlli parser ishlatamiz (zero token cost)
    try:
        src_lang = detect_question_language(text)
        parsed = parse_flexible_questionnaire(text, src_lang)
        return [
            {
                "id": i + 1,
                "text": q["text"],
                "options": q["options"],
                "correctAnswer": q["correctAnswer"],
            }
            for i, q in enumerate(parsed)
        ]
    except Exception:
        pass

    # Oddiy fallback
    questions = []
    blocks = re.split(r"(?m)(?=^\s*\d{1,3}[.)]\s+\S)", text)
    for block in blocks:
        b = block.strip()
        if not b or len(b) < 15:
            continue
        lines = [x.strip() for x in b.split("\n") if x.strip()]
        if not lines:
            continue
        q_text = re.sub(r"^\d+[.)]\s*", "", lines[0]).strip()
        options: list[str] = []
        for line in lines[1:]:
            # A) / a) / A. / 1) / 1. formatlar
            m = re.match(r"^([A-Ja-j]|\d{1,2})[).:\-]\s+(.+)$", line)
            if m:
                options.append(m.group(2).strip())
        if len(options) < 2:
            continue
        while len(options) < 4:
            options.append(f"Variant {len(options) + 1}")
        questions.append({
            "id": len(questions) + 1,
            "text": q_text or f"Savol {len(questions) + 1}",
            "options": options[:10],
            "correctAnswer": options[0],
        })
    return questions


def extract_text_from_bank_upload(raw: bytes, filename: str) -> str:
    """Test bazasiga AI import: PDF, DOCX yoki oddiy matn."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        if len(raw) < 5 or not raw.startswith(b"%PDF"):
            raise ValueError("Yaroqsiz yoki buzilgan PDF fayl")
        from io import BytesIO

        from pypdf import PdfReader

        reader = PdfReader(BytesIO(raw))
        page_count = len(reader.pages)
        max_pages = 15
        if page_count > max_pages:
            raise ValueError(
                f"PDF juda katta ({page_count} bet). Hozircha maksimal {max_pages} betni import qiling."
            )
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
    if name.endswith(".docx"):
        from io import BytesIO

        from docx import Document

        doc = Document(BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if name.endswith(".doc"):
        # Eski .doc -- to'liq qo'llab-quvvatlanmaydi; UTF-8 matn sifatida urinib ko'ramiz
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            raise ValueError(
                ".doc faylini Word orqali .docx ga saqlab, qayta yuklang (yoki PDF)."
            )
    return raw.decode("utf-8", errors="replace")


def filter_bank_questions_for_group(qs, group: Group | None):
    """Talaba guruhi bo'yicha test bazasi savollarini filtrlash."""
    from django.db.models import Q

    if group is None:
        return qs
    pt = (group.program_track or "bachelor").lower()
    if pt == "residency":
        return qs.filter(Q(category__program_track__in=("residency", "any")))
    if pt == "master":
        return qs.filter(Q(category__program_track__in=("master", "any")))
    q = Q(category__program_track__in=("bachelor", "any"))
    qs2 = qs.filter(q)
    ay = group.academic_year
    if ay is not None:
        qs2 = qs2.filter(
            Q(category__academic_year__isnull=True) | Q(category__academic_year=ay)
        )
    return qs2


def _coerce_exam_options(opts_raw: list, opts_en: list) -> list[str]:
    """Bo'sh yoki yaroqsiz variantlarni EN zaxirasiga yoki A–E yorliqlariga almashtiradi."""
    letters = ("A", "B", "C", "D", "E")
    opts = [str(x).strip() for x in (opts_raw or []) if str(x).strip()]
    if len(opts) < 2:
        opts = [str(x).strip() for x in (opts_en or []) if str(x).strip()]
    if len(opts) < 2:
        n = max(2, min(5, len(opts_raw or opts_en or [1, 2])))
        opts = [f"{letters[i]}) Variant" for i in range(n)]
    out: list[str] = []
    for i, o in enumerate(opts[:5]):
        if len(o) == 1 and o.upper() in letters:
            out.append(f"{o.upper()}) {o.upper()}")
        else:
            out.append(o)
    return out


def resolve_ui_language(request) -> str:
    """UI tili — X-Student-Lang / X-UI-Lang / body.lang (ogohlantirish/API xatolari)."""
    for meta_key in ("HTTP_X_STUDENT_LANG", "HTTP_X_UI_LANG"):
        header = str(request.META.get(meta_key) or "").lower().strip()[:2]
        if header in ("uz", "ru", "en"):
            return header
    body = getattr(request, "data", None)
    if isinstance(body, dict):
        for key in ("student_lang", "lang", "ui_lang"):
            sl = str(body.get(key) or "").lower().strip()[:2]
            if sl in ("uz", "ru", "en"):
                return sl
    return "uz"


def resolve_student_exam_language(request, exam) -> str:
    """Imtihon `auto` bo'lsa — talaba UI tili (header/body), aks holda imtihon tili."""
    exam_lang = (getattr(exam, "language", None) or "uz").lower()
    if exam_lang in ("uz", "ru", "en"):
        return exam_lang
    return resolve_ui_language(request)


def effective_exam_language(exam, student_lang: str) -> str:
    exam_lang = (getattr(exam, "language", None) or "uz").lower()
    if exam_lang == "auto":
        return student_lang if student_lang in ("uz", "ru", "en") else "uz"
    return exam_lang if exam_lang in ("uz", "ru", "en") else "uz"


def localize_exam_question(q: dict, lang: str) -> dict:
    """Ko'p tilli savol dict → bitta til (talaba ko'radi)."""
    lang = (lang or "uz").lower()
    opts_en = q.get("options") or []
    if not isinstance(opts_en, list):
        opts_en = []
    if lang == "en":
        text = (q.get("text_en") or q.get("text") or "").strip()
        opts = q.get("options_en") if isinstance(q.get("options_en"), list) else opts_en
        ca = (q.get("correct_answer_en") or q.get("correctAnswer") or "").strip()
    elif lang == "ru":
        text = (q.get("text_ru") or q.get("text") or "").strip()
        opts = q.get("options_ru") if isinstance(q.get("options_ru"), list) else opts_en
        ca = (q.get("correct_answer_ru") or q.get("correctAnswer") or "").strip()
    else:
        text = (q.get("text_uz") or q.get("text") or "").strip()
        opts = q.get("options_uz") if isinstance(q.get("options_uz"), list) else opts_en
        ca = (q.get("correct_answer_uz") or q.get("correctAnswer") or "").strip()
    opts = _coerce_exam_options(
        [str(x) for x in opts] if isinstance(opts, list) else [],
        [str(x) for x in opts_en],
    )
    ca = str(ca or "").strip()
    if ca not in opts:
        for o in opts:
            if ca and (ca in o or o.endswith(ca)):
                ca = o
                break
        else:
            ca = opts[0] if opts else ca
    out = dict(q)
    out["text"] = text
    out["options"] = opts
    out["correctAnswer"] = ca
    # iMentor API izohlari — talaba tiliga mos
    expl = (
        (q.get(f"explanation_{lang}") or q.get("explanation") or "")
        if isinstance(q, dict)
        else ""
    )
    expl = str(expl).strip()
    if expl:
        out["explanation"] = expl
    oe_key = f"optionExplanations_{lang}"
    oe = q.get(oe_key) if isinstance(q.get(oe_key), list) else q.get("optionExplanations")
    if isinstance(oe, list) and any(str(x).strip() for x in oe):
        out["optionExplanations"] = [str(x).strip() for x in oe]
    return out


def exam_question_with_translations(q: dict, tr: dict, source_lang: str) -> dict:
    """Bitta savol + AI tarjima natijasini imtihon JSON formatiga birlashtiradi."""
    tr = tr or {}
    src = (source_lang or "uz").lower()
    out = {
        "id": q.get("id"),
        "text": q.get("text"),
        "options": list(q.get("options") or []),
        "correctAnswer": q.get("correctAnswer"),
    }

    def _lst(key: str, fallback: list) -> list:
        v = tr.get(key)
        return list(v) if isinstance(v, list) else list(fallback)

    if src == "en":
        out.update(
            {
                "text_en": out["text"],
                "text_uz": str(tr.get("text_uz") or ""),
                "text_ru": str(tr.get("text_ru") or ""),
                "options_en": out["options"],
                "options_uz": _lst("options_uz", out["options"]),
                "options_ru": _lst("options_ru", out["options"]),
                "correct_answer_en": out["correctAnswer"],
                "correct_answer_uz": str(tr.get("correct_answer_uz") or ""),
                "correct_answer_ru": str(tr.get("correct_answer_ru") or ""),
            }
        )
    elif src == "ru":
        out.update(
            {
                "text_ru": out["text"],
                "text_uz": str(tr.get("text_uz") or ""),
                "text_en": str(tr.get("text_en") or ""),
                "options_ru": out["options"],
                "options_uz": _lst("options_uz", out["options"]),
                "options_en": _lst("options_en", out["options"]),
                "correct_answer_ru": out["correctAnswer"],
                "correct_answer_uz": str(tr.get("correct_answer_uz") or ""),
                "correct_answer_en": str(tr.get("correct_answer_en") or ""),
            }
        )
    else:
        out.update(
            {
                "text_uz": out["text"],
                "text_ru": str(tr.get("text_ru") or ""),
                "text_en": str(tr.get("text_en") or ""),
                "options_uz": out["options"],
                "options_ru": _lst("options_ru", out["options"]),
                "options_en": _lst("options_en", out["options"]),
                "correct_answer_uz": out["correctAnswer"],
                "correct_answer_ru": str(tr.get("correct_answer_ru") or ""),
                "correct_answer_en": str(tr.get("correct_answer_en") or ""),
            }
        )
    # Manba (iMentor API) izohlari tarjima bosqichida yo'qolmasin — natija
    # sahifasida tayyor izoh o'rniga AI qayta yozib berardi.
    _carry_api_explanations(q, out, src)
    # AI tomonidan tarjima qilingan izohlar (translate_questions_batch natijasi) —
    # manba tilida allaqachon borini _carry_api_explanations to'ldirgan, bu yerda
    # faqat YETISHMAYOTGAN (boshqa til) izohlar to'ldiriladi.
    for lang in ("uz", "ru", "en"):
        if not out.get(f"explanation_{lang}"):
            val = str(tr.get(f"explanation_{lang}") or "").strip()
            if val:
                out[f"explanation_{lang}"] = val
        if not out.get(f"optionExplanations_{lang}"):
            val = tr.get(f"optionExplanations_{lang}")
            if isinstance(val, list) and any(str(x).strip() for x in val):
                out[f"optionExplanations_{lang}"] = [str(x).strip() for x in val]
    return out


def _carry_api_explanations(src_q: dict, out: dict, source_lang: str) -> None:
    """API izohlarini savol dictidan ko'chiradi (manba tili nusxasi bilan birga)."""
    lang = (source_lang or "uz").lower()
    if lang not in ("uz", "ru", "en"):
        lang = "uz"
    expl = str(src_q.get("explanation") or "").strip()
    if expl:
        out["explanation"] = expl
        out.setdefault(f"explanation_{lang}", expl)
    for key in ("explanation_uz", "explanation_ru", "explanation_en"):
        val = str(src_q.get(key) or "").strip()
        if val:
            out[key] = val

    opt_expl = src_q.get("optionExplanations")
    if isinstance(opt_expl, list) and any(str(x).strip() for x in opt_expl):
        cleaned = [str(x).strip() for x in opt_expl]
        out["optionExplanations"] = cleaned
        out.setdefault(f"optionExplanations_{lang}", list(cleaned))
    for key in ("optionExplanations_uz", "optionExplanations_ru", "optionExplanations_en"):
        val = src_q.get(key)
        if isinstance(val, list) and any(str(x).strip() for x in val):
            out[key] = [str(x).strip() for x in val]

    # Manbalar (kitob/maqola) — tilga bog'liq emas, o'zgarishsiz ko'chiriladi.
    refs = src_q.get("references")
    if isinstance(refs, list) and refs:
        out["references"] = list(refs)


def exam_questions_add_translations(questions: list[dict], source_language: str | None = None) -> list[dict]:
    """Manual/PDF savollarini UZ+RU+EN ga tarjima qilib saqlash (imtihon yaratish — auto til)."""
    if not questions:
        return []
    from apps.api.gemini_tools import detect_question_language, translate_questions_batch

    src = (source_language or "").lower()
    if src not in ("uz", "ru", "en"):
        sample = " ".join(str(q.get("text") or "") for q in questions[:8])
        src = detect_question_language(sample)
    payload = []
    for q in questions:
        item = {
            "text": str(q.get("text") or ""),
            "options": list(q.get("options") or []),
            "correctAnswer": str(q.get("correctAnswer") or ""),
        }
        expl = str(q.get("explanation") or "").strip()
        if expl:
            item["explanation"] = expl
            oe = q.get("optionExplanations")
            if isinstance(oe, list) and any(str(x).strip() for x in oe):
                item["optionExplanations"] = list(oe)
        payload.append(item)
    try:
        translations = translate_questions_batch(payload, src)
    except Exception:
        translations = [{} for _ in questions]
    return [
        exam_question_with_translations(q, translations[i] if i < len(translations) else {}, src)
        for i, q in enumerate(questions)
    ]


def apply_exam_language_to_questions(full: list[dict], exam_lang: str, student_lang: str) -> list[dict]:
    if (exam_lang or "uz").lower() != "auto":
        return full
    return [localize_exam_question(q, student_lang) for q in full]


def prepare_questions_for_grading(
    questions: list[dict],
    exam,
    answers: dict | None = None,
    *,
    student_lang: str | None = None,
) -> list[dict]:
    """
    Auto imtihon: sessiyadagi ko'p tilli savollarni talaba tiliga moslashtiradi.
    submit/draft uchun — javoblar shu tildagi variantlar bilan solishtiriladi.
    """
    from apps.api.view_utils import validate_exam_answers

    exam_lang = (getattr(exam, "language", None) or "uz").lower()
    if exam_lang != "auto":
        return questions
    hint = (student_lang or "").lower().strip()[:2]
    if hint in ("uz", "ru", "en"):
        return [localize_exam_question(q, hint) for q in questions]
    if not isinstance(answers, dict) or not answers:
        return [localize_exam_question(q, "uz") for q in questions]
    best_lang = "uz"
    best_score = -1
    for lang in ("uz", "ru", "en"):
        loc = [localize_exam_question(q, lang) for q in questions]
        try:
            norm = validate_exam_answers(loc, answers)
        except ValueError:
            continue
        filled = sum(1 for v in norm.values() if v)
        if filled > best_score:
            best_score = filled
            best_lang = lang
    return [localize_exam_question(q, best_lang) for q in questions]


def detect_grading_language(
    exam,
    answers: dict | None,
    *,
    student_lang: str | None = None,
    raw_questions: list[dict] | None = None,
) -> str:
    """Baholash/tahlil uchun til (auto imtihonda talaba yoki javoblardan)."""
    from apps.api.view_utils import validate_exam_answers

    exam_lang = (getattr(exam, "language", None) or "uz").lower()
    if exam_lang != "auto":
        return effective_exam_language(exam, exam_lang)
    hint = (student_lang or "").lower().strip()[:2]
    if hint in ("uz", "ru", "en"):
        return hint
    if not isinstance(answers, dict) or not answers or not raw_questions:
        return "uz"
    best_lang = "uz"
    best_score = -1
    for lang in ("uz", "ru", "en"):
        loc = [localize_exam_question(q, lang) for q in raw_questions]
        try:
            norm = validate_exam_answers(loc, answers)
        except ValueError:
            continue
        filled = sum(1 for v in norm.values() if v)
        if filled > best_score:
            best_score = filled
            best_lang = lang
    return best_lang


def _question_has_lang_field(q: dict, lang: str) -> bool:
    if lang == "en":
        return bool((q.get("text_en") or q.get("text") or "").strip())
    if lang == "ru":
        return bool((q.get("text_ru") or "").strip())
    return bool((q.get("text_uz") or q.get("text") or "").strip())


def fill_missing_exam_translations(questions: list[dict]) -> list[dict]:
    """Auto imtihon: text_uz / text_ru / text_en yetishmasa AI bilan to'ldiradi."""
    if not questions:
        return []
    from apps.api.gemini_tools import detect_question_language, translate_questions_batch

    need_indices: list[int] = []
    payload: list[dict] = []
    for i, q in enumerate(questions):
        if all(_question_has_lang_field(q, lg) for lg in ("uz", "ru", "en")):
            continue
        need_indices.append(i)
        src_text = (
            (q.get("text_uz") or "").strip()
            or (q.get("text_ru") or "").strip()
            or (q.get("text_en") or "").strip()
            or (q.get("text") or "").strip()
        )
        if _question_has_lang_field(q, "uz") and isinstance(q.get("options_uz"), list):
            src_opts = list(q.get("options_uz") or [])
            src_ca = str(q.get("correct_answer_uz") or q.get("correctAnswer") or "")
            src = "uz"
        elif _question_has_lang_field(q, "ru") and isinstance(q.get("options_ru"), list):
            src_opts = list(q.get("options_ru") or [])
            src_ca = str(q.get("correct_answer_ru") or q.get("correctAnswer") or "")
            src = "ru"
        elif isinstance(q.get("options_en"), list) and (q.get("text_en") or q.get("text")):
            src_opts = list(q.get("options_en") or [])
            src_ca = str(q.get("correct_answer_en") or q.get("correctAnswer") or "")
            src = "en"
        else:
            src_opts = list(q.get("options") or [])
            src_ca = str(q.get("correctAnswer") or "")
            src = detect_question_language(src_text)
        payload.append(
            {
                "text": src_text,
                "options": src_opts,
                "correctAnswer": src_ca,
                "_src": src,
            }
        )

    if not payload:
        return questions

    by_src: dict[str, list[tuple[int, dict]]] = {}
    for j, idx in enumerate(need_indices):
        item = payload[j]
        src = str(item.pop("_src", "uz"))
        by_src.setdefault(src, []).append((idx, item))

    out = [dict(q) for q in questions]
    for src, batch in by_src.items():
        try:
            translations = translate_questions_batch([b[1] for b in batch], src)
        except Exception:
            continue
        for k, (idx, base) in enumerate(batch):
            tr = translations[k] if k < len(translations) else {}
            merged = exam_question_with_translations(
                {
                    "id": out[idx].get("id"),
                    "text": base["text"],
                    "options": base["options"],
                    "correctAnswer": base["correctAnswer"],
                },
                tr,
                src,
            )
            out[idx] = {**out[idx], **merged}
    return out


def bank_row_to_exam_dict_multilingual(row) -> dict:
    """Test bazasi savolini 3 tilda saqlash (auto imtihon sessiyasi uchun)."""
    opts_en = safe_json_loads(row.options_json, [])
    opts_uz = safe_json_loads(getattr(row, "options_uz_json", None) or "[]", [])
    opts_ru = safe_json_loads(getattr(row, "options_ru_json", None) or "[]", [])
    if not any(str(x).strip() for x in opts_uz):
        opts_uz = list(opts_en)
    if not any(str(x).strip() for x in opts_ru):
        opts_ru = list(opts_en)

    text_en = (row.text or "").strip()
    text_uz = (getattr(row, "text_uz", None) or "").strip() or text_en
    text_ru = (getattr(row, "text_ru", None) or "").strip() or text_en
    ca_en = str(row.correct_answer or "").strip()
    ca_uz = (getattr(row, "correct_answer_uz", None) or "").strip() or ca_en
    ca_ru = (getattr(row, "correct_answer_ru", None) or "").strip() or ca_en

    opts_en_c = _coerce_exam_options(list(opts_en), list(opts_en))
    opts_uz_c = _coerce_exam_options(list(opts_uz), list(opts_en))
    opts_ru_c = _coerce_exam_options(list(opts_ru), list(opts_en))

    def _align_ca(ca: str, opts: list[str]) -> str:
        ca = str(ca or "").strip()
        if ca in opts:
            return ca
        for o in opts:
            if ca and (ca in o or o.endswith(ca)):
                return o
        return opts[0] if opts else ca

    ca_en = _align_ca(ca_en, opts_en_c)
    ca_uz = _align_ca(ca_uz, opts_uz_c)
    ca_ru = _align_ca(ca_ru, opts_ru_c)

    return {
        "text": text_uz,
        "text_en": text_en,
        "text_uz": text_uz,
        "text_ru": text_ru,
        "options": opts_uz_c,
        "options_en": opts_en_c,
        "options_uz": opts_uz_c,
        "options_ru": opts_ru_c,
        "correctAnswer": ca_uz,
        "correct_answer_en": ca_en,
        "correct_answer_uz": ca_uz,
        "correct_answer_ru": ca_ru,
    }


def bank_row_to_exam_dict(row, exam_lang: str) -> dict:
    """TestBankQuestion qatoridan imtihon tili bo'yicha savol dict (to'g'ri javob bilan)."""
    opts_en_fallback = safe_json_loads(row.options_json, [])
    exam_lang = (exam_lang or "uz").lower()
    if exam_lang == "en":
        opts_en = safe_json_loads(getattr(row, "options_en_json", None) or "[]", [])
        text = (getattr(row, "text_en", None) or "").strip() or row.text
        if not any(str(x).strip() for x in opts_en):
            opts_en = list(opts_en_fallback)
        opts, ca = opts_en, (getattr(row, "correct_answer_en", None) or "").strip() or row.correct_answer
    elif exam_lang == "ru":
        opts = safe_json_loads(getattr(row, "options_ru_json", None) or "[]", [])
        text = (getattr(row, "text_ru", None) or "").strip() or row.text
        if not any(str(x).strip() for x in opts):
            opts = list(opts_en_fallback)
        ca = (getattr(row, "correct_answer_ru", None) or "").strip() or row.correct_answer
    else:
        opts = safe_json_loads(getattr(row, "options_uz_json", None) or "[]", [])
        text = (getattr(row, "text_uz", None) or "").strip() or row.text
        if not any(str(x).strip() for x in opts):
            opts = list(opts_en_fallback)
        ca = (getattr(row, "correct_answer_uz", None) or "").strip() or row.correct_answer
    opts = _coerce_exam_options(opts, opts_en_fallback)
    ca = str(ca or "").strip()
    if ca not in opts:
        for o in opts:
            if ca and (ca in o or o.endswith(ca)):
                ca = o
                break
        else:
            ca = opts[0]
    return {"text": text, "options": opts, "correctAnswer": ca}
