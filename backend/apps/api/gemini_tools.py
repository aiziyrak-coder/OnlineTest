"""Google Gemini (ixtiyoriy). Kalit bo'lmasa fallback. google-genai SDK."""
from __future__ import annotations

import json
import re
from typing import Any

from django.conf import settings


def _client():
    key = settings.GEMINI_API_KEY
    if not key:
        return None
    from google import genai
    return genai.Client(api_key=key)


def _generate(client, prompt, contents=None) -> str:
    """Matn yoki multimodal so'rov yuboradi, javob matnini qaytaradi."""
    from google import genai as _genai
    model = settings.GEMINI_MODEL
    resp = client.models.generate_content(
        model=model,
        contents=contents if contents is not None else prompt,
    )
    return resp.text or ""


def _detect_image_mime(data: bytes) -> str:
    """Rasm bytes dan MIME tur aniqlash."""
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return "image/png"
    if data[:3] == b'\xff\xd8\xff':
        return "image/jpeg"
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return "image/gif"
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return "image/webp"
    return "image/jpeg"


def compare_faces(profile_b64: str, live_b64: str) -> dict:
    """Express compareFacePairWithGemini bilan mos: success, match?, code."""
    import logging
    logger = logging.getLogger(__name__)

    client = _client()
    if not client:
        return {"success": False, "code": "GEMINI_UNAVAILABLE"}
    try:
        import base64
        from google.genai import types

        def _decode(s: str) -> bytes:
            s = s.strip()
            if "," in s:
                s = s.split(",", 1)[1].strip()
            # Padding to'g'rilash
            pad = len(s) % 4
            if pad:
                s += "=" * (4 - pad)
            return base64.b64decode(s)

        p_bytes = _decode(profile_b64)
        l_bytes = _decode(live_b64)

        p_mime = _detect_image_mime(p_bytes)
        l_mime = _detect_image_mime(l_bytes)

        contents = [
            "Compare these two face images. First image: reference profile photo. "
            "Second image: live camera capture. Are they the same person? "
            "Reply ONLY with MATCH or NO_MATCH.",
            types.Part.from_bytes(data=p_bytes, mime_type=p_mime),
            types.Part.from_bytes(data=l_bytes, mime_type=l_mime),
        ]
        raw = _generate(client, None, contents=contents).strip().upper()
        ok = raw == "MATCH" or ("MATCH" in raw and "NO_MATCH" not in raw)
        return {"success": True, "match": ok}
    except Exception as exc:
        logger.warning("compare_faces Gemini error: %s", exc)
        return {"success": False, "code": "GEMINI_ERROR", "detail": str(exc)[:200]}


def generate_exam_ai_summary(questions: list[dict], answers: dict[str, str], language: str) -> dict:
    from apps.api.services import build_fallback_ai_summary

    client = _client()
    if not client:
        return build_fallback_ai_summary(questions, answers)
    payload = []
    for q in questions:
        st = answers.get(str(q["id"]), "") or ""
        payload.append(
            {
                "questionId": q["id"],
                "text": q["text"],
                "options": q.get("options", []),
                "correctAnswer": q.get("correctAnswer"),
                "studentAnswer": st or None,
                "isCorrect": st == q.get("correctAnswer"),
            }
        )
    lang = "O'zbek" if language == "uz" else "Russian" if language == "ru" else "English"
    prompt = f"""FJSTI tibbiyot testlari. Savollar va javoblar:
{json.dumps(payload, ensure_ascii=False)}
Til: {lang}.
Faqat bitta JSON obyekt: {{"overview":"...","items":[{{"questionId":n,"isCorrect":bool,"commentCorrect":"","whyStudentWrong":"","whyCorrectIsRight":""}}]}}
Har bir savol uchun bitta item."""
    try:
        t = _generate(client, prompt).strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
        if fence:
            t = fence.group(1).strip()
        obj = json.loads(t)
        if not isinstance(obj.get("items"), list):
            raise ValueError("items")
        return {"overview": obj.get("overview", ""), "items": obj["items"]}
    except Exception:
        return build_fallback_ai_summary(questions, answers)


def generate_bank_extension(
    samples: list[dict], count: int, language: str, category_names: list[str]
) -> list[dict]:
    client = _client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    sample_block = json.dumps(samples[:14], ensure_ascii=False)
    lang = "O'zbek" if language == "uz" else "Russian" if language == "ru" else "English"
    prompt = f"""Medical education expert FJSTI. Generate exactly {count} NEW MCQ questions.
Language: {lang}. Categories: {', '.join(category_names)}.
Each: "text", "options" (4 strings), "correctAnswer" (one of options).
Output ONLY JSON array, no markdown.
Samples for style:
{sample_block}"""
    t = _generate(client, prompt).strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if fence:
        t = fence.group(1).strip()
    arr = json.loads(t)
    if not isinstance(arr, list):
        raise ValueError("not array")
    out = []
    for i in range(count):
        q = arr[i] if i < len(arr) else None
        if not isinstance(q, dict):
            raise ValueError("fewer questions")
        opts = [str(x) for x in (q.get("options") or [])][:4]
        while len(opts) < 4:
            opts.append(f"Variant {len(opts) + 1}")
        cor = str(q.get("correctAnswer") or opts[0])
        if cor not in opts:
            cor = opts[0]
        out.append({"text": str(q.get("text") or f"Savol {i+1}"), "options": opts, "correctAnswer": cor})
    return out


def _extract_json_array_from_model_text(t: str) -> list:
    t = (t or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if fence:
        t = fence.group(1).strip()
    try:
        arr = json.loads(t)
        if isinstance(arr, list):
            return arr
    except json.JSONDecodeError:
        pass
    i, j = t.find("["), t.rfind("]")
    if i >= 0 and j > i:
        arr = json.loads(t[i : j + 1])
        if isinstance(arr, list):
            return arr
    raise ValueError("Model javobi JSON massiv emas")


def translate_en_questions_to_uz_ru(questions: list[dict]) -> list[dict]:
    """Inglizcha savollarni tibbiy terminologiya bilan O‘zbek (lotin) va Ruschaga tarjima qiladi."""
    if not questions:
        return []
    client = _client()
    if not client:
        return [{} for _ in questions]
    import json

    out_all: list[dict] = []
    chunk_size = 5
    for i in range(0, len(questions), chunk_size):
        chunk = questions[i : i + chunk_size]
        batch = [
            {"text": q["text"], "options": q.get("options", []), "correctAnswer": q.get("correctAnswer")}
            for q in chunk
        ]
        prompt = f"""You are an expert medical translator for Central Asian medical schools. Translate each MCQ from English to Uzbek (Latin script) and Russian. Use correct clinical terminology (anatomy, pharmacology, pathophysiology); avoid literal machine translation where a standard medical term exists in the target language.

INPUT JSON array (length {len(batch)}):
{json.dumps(batch, ensure_ascii=False)}

OUTPUT: JSON array ONLY, same length. Each object:
{{"text_uz":"...","text_ru":"...","options_uz":["..."],"options_ru":["..."],"correct_answer_uz":"exact copy of one element of options_uz","correct_answer_ru":"exact copy of one element of options_ru"}}

Rules:
- options_uz and options_ru must have the SAME length and order as English options (parallel translation).
- correct_answer_uz must equal options_uz[k] for the same k as the correct English option.
- correct_answer_ru must equal options_ru[k] likewise.
"""
        try:
            t = _generate(client, prompt).strip()
            arr = _extract_json_array_from_model_text(t)
        except Exception:
            arr = []
        for j in range(len(chunk)):
            row = arr[j] if j < len(arr) and isinstance(arr[j], dict) else {}
            out_all.append(row)
    return out_all[: len(questions)]


def paraphrase_medical_mcqs(questions: list[dict], exam_language: str) -> list[dict]:
    """So‘zlarni/sinonimlarni o‘zgartirib savollarni yangilash; qiyinlik va mazmun saqlanadi."""
    if not questions:
        return []
    client = _client()
    if not client:
        return questions
    import json

    lang = (
        "English"
        if exam_language == "en"
        else "O'zbek (Latin)"
        if exam_language == "uz"
        else "Russian"
    )
    batch = [
        {"text": q["text"], "options": q.get("options", []), "correctAnswer": q.get("correctAnswer")}
        for q in questions
    ]
    prompt = f"""You rewrite medical multiple-choice questions for exam security (students may have memorized exact wording).

STRICT RULES:
- Output language for every field: {lang}.
- Preserve difficulty level and clinical topic; do not make questions easier or harder.
- Rephrase the stem using synonyms and sentence restructuring.
- Rephrase each option similarly. Use 3 to 5 options (same count as input).
- You may change trivial numbers ONLY if the scenario remains medically realistic and difficulty unchanged.
- correctAnswer must be EXACTLY one full string from the new options array (same meaning as input correct answer).

INPUT JSON:
{json.dumps(batch, ensure_ascii=False)}

OUTPUT: JSON array only, same length as input. Each item: {{"text":"...","options":[...],"correctAnswer":"..."}}
"""
    try:
        t = _generate(client, prompt).strip()
        arr = _extract_json_array_from_model_text(t)
    except Exception:
        return questions
    out: list[dict] = []
    for j, q in enumerate(questions):
        if j < len(arr) and isinstance(arr[j], dict):
            opts = [str(x) for x in (arr[j].get("options") or [])][:5]
            while len(opts) < 3:
                opts.append(f"Option {len(opts) + 1}")
            ca = str(arr[j].get("correctAnswer") or opts[0])
            if ca not in opts and opts:
                ca = opts[0]
            out.append(
                {
                    "text": str(arr[j].get("text") or q["text"]),
                    "options": opts,
                    "correctAnswer": ca,
                }
            )
        else:
            out.append(dict(q))
    return out if out else questions


def parse_and_classify_questionnaire(raw_text: str, language: str) -> list[dict]:
    """
    Namunaviy savolnoma matnidan MCQ ajratish va har biriga mavzu (kategoriya) berish.
    Qaytadi: [{"text","options","correctAnswer","categoryName","categoryDescription?"}, ...]
    """
    client = _client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    lang = "O'zbek" if language == "uz" else "Russian" if language == "ru" else "English"
    snippet = (
        raw_text
        if len(raw_text) <= 220_000
        else raw_text[:220_000] + "\n\n[...matn qisqartirildi — qolgan sahifalarni alohida PDF sifatida yuklang...]"
    )
    if language == "en":
        prompt = f"""You are a medical education expert. Extract ALL multiple-choice questions from the document text (PDF/OCR). Do not skip pages.

The document may use:
- Question numbers: 1. or 1) or Q1
- Options labeled A) B) C) D) E) OR 1) 2) 3) 4) 5) OR a. b. c.
- An ANSWER KEY at the end (e.g. "Answers:", "Key:", "1-B", "1. B", "Answer: 1-3" mapping question number to option letter or number). Use the key to set correctAnswer.

For EACH valid MCQ output one JSON object in a JSON ARRAY (no markdown):
- "text": question stem ONLY (no option letters in stem if possible)
- "options": array of 3 to 5 option texts (full text, no "A)" prefix)
- "correctAnswer": must be EXACTLY equal to one string in "options" (the correct choice)
- "categoryName": short English topic e.g. "Cardiology", "Pharmacology" — group similar questions
- "categoryDescription": optional one line

Skip incomplete or ambiguous items. If answer key conflicts with text, prefer the answer key section at the end of the document.

OUTPUT: JSON array only.

TEXT:
---
{snippet}
---
"""
    else:
        prompt = f"""Sen tibbiyot/ta'lim testlarini tahlil qiluvchi mutaxassissan.
Quyidagi matn butun hujjatdan (masalan PDF dan chiqarilgan) bo'lishi mumkin — boshidan oxirigacha BARCHA ko'p tanlovli (MCQ) savollarni top va ajratib ol. Hech bir sahifani o'tkazma.
Matn tartibsiz bo'lishi mumkin: raqamlar 1. yoki 1), variantlar A) B) yoki a) b), to'g'ri javob oxirida yoki kalitda.

Har bir savol uchun bitta obyekt (faqat JSON massiv, markdown yo'q):
- "text": savol matni (faqat savol, variantlarsiz)
- "options": aniq 4 ta variant matni (qisqa, tushunarli)
- "correctAnswer": to'g'ri variant — "options" ichidagi satrlardan biri bilan AYNAN bir xil
- "categoryName": mavzu nomi ({lang}, qisqa: masalan "Yurak kasalliklari", "Anatomiya") — o'xshash fan bo'yicha savollarni bir xil categoryName bilan guruhla
- "categoryDescription": ixtiyoriy, bir qator izoh

Agar 4 ta variant bo'lmasa yoki savol shubhali bo'lsa, o'tkazib yubor.
Til: savollar qaysi tilda bo'lsa ham, categoryName va categoryDescription {lang} da yozilsin yoki savol tili bilan mos.

OUTPUT: faqat JSON massiv.

MATN:
---
{snippet}
---
"""
    t = _generate(client, prompt)
    arr = _extract_json_array_from_model_text(t)
    out: list[dict] = []
    for item in arr:
        if not isinstance(item, dict):
            continue
        if language == "en":
            opts = [str(x).strip() for x in (item.get("options") or [])][:5]
            while len(opts) < 3:
                opts.append(f"Option {len(opts) + 1}")
        else:
            opts = [str(x).strip() for x in (item.get("options") or [])][:4]
            while len(opts) < 4:
                opts.append(f"Variant {len(opts) + 1}")
        ca = str(item.get("correctAnswer") or opts[0]).strip()
        if ca not in opts:
            ca = opts[0]
        text = str(item.get("text") or "").strip()
        if len(text) < 4:
            continue
        cat = str(item.get("categoryName") or "Umumiy").strip()[:300] or "Umumiy"
        desc = str(item.get("categoryDescription") or "").strip()[:500]
        out.append(
            {
                "text": text,
                "options": opts,
                "correctAnswer": ca,
                "categoryName": cat,
                "categoryDescription": desc,
            }
        )
    if not out:
        raise ValueError("Hech qanday yaroqli savol topilmadi — matnni tekshiring yoki qisqaroq bo'limlarda yuklang")
    return out
