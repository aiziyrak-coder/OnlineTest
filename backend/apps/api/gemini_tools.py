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


def compare_faces(profile_b64: str, live_b64: str) -> dict:
    """Express compareFacePairWithGemini bilan mos: success, match?, code."""
    client = _client()
    if not client:
        return {"success": False, "code": "GEMINI_UNAVAILABLE"}
    try:
        import base64
        from google.genai import types

        p = base64.b64decode(profile_b64.split(",")[-1] if "," in profile_b64 else profile_b64)
        l = base64.b64decode(live_b64.split(",")[-1] if "," in live_b64 else live_b64)
        contents = [
            "Compare these two images. First: reference profile. Second: live capture. "
            "Same person? Reply ONLY MATCH or NO_MATCH.",
            types.Part.from_bytes(data=p, mime_type="image/jpeg"),
            types.Part.from_bytes(data=l, mime_type="image/jpeg"),
        ]
        raw = _generate(client, None, contents=contents).strip().upper()
        ok = raw == "MATCH" or ("MATCH" in raw and "NO_MATCH" not in raw)
        return {"success": True, "match": ok}
    except Exception:
        return {"success": False, "code": "GEMINI_ERROR"}


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
