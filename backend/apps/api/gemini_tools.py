"""Google Gemini (ixtiyoriy). Kalit bo‘lmasa fallback."""
from __future__ import annotations

import json
import re
from typing import Any

from django.conf import settings


def _client():
    key = settings.GEMINI_API_KEY
    if not key:
        return None
    import google.generativeai as genai

    genai.configure(api_key=key)
    return genai.GenerativeModel(settings.GEMINI_MODEL)


def compare_faces(profile_b64: str, live_b64: str) -> dict:
    """Express compareFacePairWithGemini bilan mos: success, match?, code."""
    model = _client()
    if not model:
        return {"success": False, "code": "GEMINI_UNAVAILABLE"}
    try:
        import base64

        p = base64.b64decode(profile_b64.split(",")[-1] if "," in profile_b64 else profile_b64)
        l = base64.b64decode(live_b64.split(",")[-1] if "," in live_b64 else live_b64)
        r = model.generate_content(
            [
                "Compare these two images. First: reference profile. Second: live capture. "
                "Same person? Reply ONLY MATCH or NO_MATCH.",
                {"mime_type": "image/jpeg", "data": p},
                {"mime_type": "image/jpeg", "data": l},
            ]
        )
        raw = (r.text or "").strip().upper()
        ok = raw == "MATCH" or ("MATCH" in raw and "NO_MATCH" not in raw)
        return {"success": True, "match": ok}
    except Exception:
        return {"success": False, "code": "GEMINI_ERROR"}


def generate_exam_ai_summary(questions: list[dict], answers: dict[str, str], language: str) -> dict:
    from apps.api.services import build_fallback_ai_summary

    model = _client()
    if not model:
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
        r = model.generate_content(prompt)
        t = (r.text or "").strip()
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
    model = _client()
    if not model:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    sample_block = json.dumps(samples[:14], ensure_ascii=False)
    lang = "O'zbek" if language == "uz" else "Russian" if language == "ru" else "English"
    prompt = f"""Medical education expert FJSTI. Generate exactly {count} NEW MCQ questions.
Language: {lang}. Categories: {', '.join(category_names)}.
Each: "text", "options" (4 strings), "correctAnswer" (one of options).
Output ONLY JSON array, no markdown.
Samples for style:
{sample_block}"""
    r = model.generate_content(prompt)
    t = (r.text or "").strip()
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
