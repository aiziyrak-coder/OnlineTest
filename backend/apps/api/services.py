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

from apps.core.models import ResultIdCounter


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
    from pypdf import PdfReader
    from io import BytesIO

    raw = file_obj.read()
    reader = PdfReader(BytesIO(raw))
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    blocks = re.split(r"(?=\d+\.)", text)
    questions = []
    for idx, block in enumerate(blocks):
        b = block.strip()
        if not b:
            continue
        lines = [x.strip() for x in b.split("\n") if x.strip()]
        if not lines:
            continue
        q_text = re.sub(r"^\d+\.\s*", "", lines[0])
        options = []
        for line in lines[1:]:
            m = re.match(r"^[A-D]\)\s*(.+)", line)
            if m:
                options.append(m.group(1).strip())
        while len(options) < 4:
            options.append(f"Variant {len(options) + 1}")
        questions.append(
            {
                "id": len(questions) + 1,
                "text": q_text or f"Savol {len(questions) + 1}",
                "options": options[:4],
                "correctAnswer": options[0],
            }
        )
    return questions
