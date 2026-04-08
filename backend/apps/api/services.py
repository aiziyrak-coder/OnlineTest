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


def build_fallback_ai_summary(questions: list[dict], answers: dict[str, str]) -> dict:
    items = []
    for q in questions:
        qid = q["id"]
        st = answers.get(str(qid), "") or ""
        ok = st == q.get("correctAnswer")
        items.append(
            {
                "questionId": qid,
                "isCorrect": ok,
                "commentCorrect": "Javob to‘g‘ri tanlangan." if ok else "",
                "whyStudentWrong": ""
                if ok
                else f"Tanlangan javob (“{st or 'bo‘sh'}”) savolning to‘g‘ri yechimi bilan mos kelmaydi.",
                "whyCorrectIsRight": ""
                if ok
                else f"To‘g‘ri javob “{q.get('correctAnswer')}” — savol mazmuniga mos yagona aniq variant.",
            }
        )
    return {
        "overview": "Quyida har bir savol bo‘yicha avtomatik tekshiruv natijalari ko‘rsatilgan.",
        "items": items,
    }


def next_result_public_id() -> str:
    year = datetime.now().year
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
        # Eski .doc — to‘liq qo‘llab-quvvatlanmaydi; UTF-8 matn sifatida urinib ko‘ramiz
        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            raise ValueError(
                ".doc faylini Word orqali .docx ga saqlab, qayta yuklang (yoki PDF)."
            )
    return raw.decode("utf-8", errors="replace")


def filter_bank_questions_for_group(qs, group: Group | None):
    """Talaba guruhi bo‘yicha test bazasi savollarini filtrlash."""
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


def bank_row_to_exam_dict(row, exam_lang: str) -> dict:
    """TestBankQuestion qatoridan imtihon tili bo‘yicha savol dict (to‘g‘ri javob bilan)."""
    opts_en = safe_json_loads(row.options_json, [])
    exam_lang = (exam_lang or "uz").lower()
    if exam_lang == "en":
        text, opts, ca = row.text, list(opts_en), row.correct_answer
    elif exam_lang == "ru":
        opts = safe_json_loads(getattr(row, "options_ru_json", None) or "[]", [])
        text = (getattr(row, "text_ru", None) or "").strip() or row.text
        if not opts:
            opts = list(opts_en)
        ca = (getattr(row, "correct_answer_ru", None) or "").strip() or row.correct_answer
    else:
        opts = safe_json_loads(getattr(row, "options_uz_json", None) or "[]", [])
        text = (getattr(row, "text_uz", None) or "").strip() or row.text
        if not opts:
            opts = list(opts_en)
        ca = (getattr(row, "correct_answer_uz", None) or "").strip() or row.correct_answer
    opts = [str(x) for x in opts][:5]
    if len(opts) < 2:
        opts = [str(x) for x in opts_en][:5]
    while len(opts) < 2 and opts_en:
        opts.append(str(opts_en[len(opts)]))
    while len(opts) < 2:
        opts.append(f"Variant {len(opts) + 1}")
    if ca not in opts and opts:
        ca = opts[0]
    return {"text": text, "options": opts, "correctAnswer": ca}
