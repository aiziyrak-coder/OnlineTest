"""Google Gemini (ixtiyoriy). Kalit bo'lmasa fallback. google-genai SDK.

TOKEN TEJASH STRATEGIYASI:
- Har bir prompt minimal, aniq strukturali
- Tarjima: bitta promptda barcha tillar (uz+ru bir vaqtda)
- OCR/multimodal faqat zarur bo'lganda
- Snippet: faqat kerakli qism, ortiqcha context yo'q
- Temperatura: 0 (deterministic, kamroq retry)
"""
from __future__ import annotations

import json
import re
import zipfile
from io import BytesIO
from typing import Any

from django.conf import settings


# ---------------------------------------------------------------------------
# Client helpers
# ---------------------------------------------------------------------------

def _client():
    key = settings.GEMINI_API_KEY
    if not key:
        return None
    from google import genai
    return genai.Client(api_key=key)


def _generate(client, prompt: str | None, contents=None, temperature: float = 0.0) -> str:
    """Matn yoki multimodal so'rov yuboradi, javob matnini qaytaradi."""
    from google import genai as _genai
    from google.genai import types as _types
    model = settings.GEMINI_MODEL
    config = _types.GenerateContentConfig(temperature=temperature)
    resp = client.models.generate_content(
        model=model,
        contents=contents if contents is not None else prompt,
        config=config,
    )
    return resp.text or ""


def _detect_image_mime(data: bytes) -> str:
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return "image/png"
    if data[:3] == b'\xff\xd8\xff':
        return "image/jpeg"
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return "image/gif"
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return "image/webp"
    return "image/jpeg"


# ---------------------------------------------------------------------------
# Face compare — minimal prompt
# ---------------------------------------------------------------------------

def compare_faces(profile_b64: str, live_b64: str) -> dict:
    """Profile va live yuzni solishtiradi. Minimal token: faqat MATCH/NO_MATCH."""
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
            pad = len(s) % 4
            if pad:
                s += "=" * (4 - pad)
            return base64.b64decode(s)

        p_bytes = _decode(profile_b64)
        l_bytes = _decode(live_b64)

        # Rasmlarni kichiklashtirish (agar PIL mavjud bo'lsa)
        p_bytes = _resize_image_if_large(p_bytes, max_kb=80)
        l_bytes = _resize_image_if_large(l_bytes, max_kb=80)

        p_mime = _detect_image_mime(p_bytes)
        l_mime = _detect_image_mime(l_bytes)

        # Minimal prompt — faqat ikki so'z javob
        contents = [
            "Compare faces: Image1=id photo, Image2=live capture.\n"
            "Reply with EXACTLY one word on the first line only: MATCH (same person) or NO_MATCH (different person). No other text.",
            types.Part.from_bytes(data=p_bytes, mime_type=p_mime),
            types.Part.from_bytes(data=l_bytes, mime_type=l_mime),
        ]
        raw = _generate(client, None, contents=contents)
        ok = _parse_strict_match_line(raw)
        return {"success": True, "match": ok}
    except Exception as exc:
        logger.warning("compare_faces error: %s", exc)
        detail = str(exc)[:400]
        dl = detail.lower()
        code = "GEMINI_ERROR"
        # Model nomi noto'g'ri / eskirgan / kalitda yo'q — odatda 404 NOT_FOUND
        if (
            "404" in detail
            or "not_found" in dl
            or "not found" in dl
            or "no longer available" in dl
            or "invalid model" in dl
            or "does not exist" in dl
            or "was not found" in dl
        ):
            code = "GEMINI_MODEL_INVALID"
        return {"success": False, "code": code, "detail": detail}


def _parse_strict_match_line(raw: str) -> bool:
    """
    Faqat birinchi qatordagi MATCH / NO_MATCH — noyob javobda xavfsizlik uchun rad.
    """
    import string

    if not (raw or "").strip():
        return False
    first = raw.strip().splitlines()[0].strip().upper()
    first = first.strip(string.punctuation + "•–—")
    if first == "MATCH":
        return True
    if first in ("NO_MATCH", "NO MATCH", "NOMATCH"):
        return False
    return False


def _resize_image_if_large(data: bytes, max_kb: int = 100) -> bytes:
    """Rasm hajmini kamaytiradi (PIL mavjud bo'lsa). Token tejash uchun."""
    if len(data) <= max_kb * 1024:
        return data
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data))
        # Max 320x240 — yuz tanish uchun yetarli
        img.thumbnail((320, 240), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70, optimize=True)
        return buf.getvalue()
    except Exception:
        return data


# ---------------------------------------------------------------------------
# Exam AI summary — minimal token, faqat xato savollar uchun tafsilot
# ---------------------------------------------------------------------------

def generate_exam_ai_summary(questions: list[dict], answers: dict[str, str], language: str) -> dict:
    """
    Imtihon natijalari tahlili.
    TOKEN TEJASH: faqat xato javoblarni AI ga yuboramiz, to'g'rilar uchun fallback.
    """
    from apps.api.services import build_fallback_ai_summary

    client = _client()
    if not client:
        return build_fallback_ai_summary(questions, answers)

    # Faqat xato javoblarni ajratib olamiz
    wrong_questions = []
    correct_map: dict[int, bool] = {}
    for q in questions:
        qid = q["id"]
        st = answers.get(str(qid), "") or ""
        is_correct = st == q.get("correctAnswer")
        correct_map[qid] = is_correct
        if not is_correct:
            wrong_questions.append({
                "id": qid,
                "q": q["text"][:200],  # Uzun savollarni qisqartirish
                "correct": q.get("correctAnswer", "")[:100],
                "student": st[:100] or "blank",
            })

    # Agar hammasi to'g'ri bo'lsa — AI kerak emas
    if not wrong_questions:
        return build_fallback_ai_summary(questions, answers)

    lang_code = "uz" if language == "uz" else "ru" if language == "ru" else "en"
    lang_name = {"uz": "O'zbek", "ru": "Russian", "en": "English"}[lang_code]

    # Minimal structured prompt — faqat xato savollar
    wrong_json = json.dumps(wrong_questions[:30], ensure_ascii=False)  # Max 30 xato
    prompt = (
        f"Medical exam errors analysis. Language: {lang_name}.\n"
        f"Wrong answers (id,q,correct,student):\n{wrong_json}\n"
        f"Return JSON only: {{\"overview\":\"1 sentence\","
        f"\"items\":[{{\"questionId\":N,\"whyStudentWrong\":\"<20 words\","
        f"\"whyCorrectIsRight\":\"<20 words\"}}]}}"
    )

    try:
        t = _generate(client, prompt).strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
        if fence:
            t = fence.group(1).strip()
        obj = json.loads(t)
        if not isinstance(obj.get("items"), list):
            raise ValueError("items missing")

        # Xato va to'g'rilarni birlashtirish
        ai_items_map = {item["questionId"]: item for item in obj["items"] if isinstance(item, dict)}
        full_items = []
        for q in questions:
            qid = q["id"]
            is_correct = correct_map.get(qid, False)
            if is_correct:
                full_items.append({
                    "questionId": qid,
                    "isCorrect": True,
                    "commentCorrect": "✓",
                    "whyStudentWrong": "",
                    "whyCorrectIsRight": "",
                })
            else:
                ai = ai_items_map.get(qid, {})
                full_items.append({
                    "questionId": qid,
                    "isCorrect": False,
                    "commentCorrect": "",
                    "whyStudentWrong": ai.get("whyStudentWrong", ""),
                    "whyCorrectIsRight": ai.get("whyCorrectIsRight", ""),
                })

        return {"overview": obj.get("overview", ""), "items": full_items}
    except Exception:
        return build_fallback_ai_summary(questions, answers)


# ---------------------------------------------------------------------------
# Bank extension — yangi savollar generatsiya
# ---------------------------------------------------------------------------

def generate_bank_extension(
    samples: list[dict], count: int, language: str, category_names: list[str]
) -> list[dict]:
    client = _client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    # Faqat 3 ta namuna yetarli (ko'p namuna = ko'p token)
    sample_block = json.dumps(samples[:3], ensure_ascii=False)
    lang = "Uzbek" if language == "uz" else "Russian" if language == "ru" else "English"
    cats = ", ".join(category_names[:5])

    prompt = (
        f"Generate {count} medical MCQs. Lang:{lang}. Topics:{cats}.\n"
        f"Format:[{{\"text\":\"...\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"correctAnswer\":\"A\"}}]\n"
        f"JSON array only. Style sample:\n{sample_block}"
    )
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
            opts.append(f"Option {len(opts) + 1}")
        cor = str(q.get("correctAnswer") or opts[0])
        if cor not in opts:
            cor = opts[0]
        out.append({"text": str(q.get("text") or f"Question {i+1}"), "options": opts, "correctAnswer": cor})
    return out


# ---------------------------------------------------------------------------
# JSON extraction helper
# ---------------------------------------------------------------------------

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
        try:
            arr = json.loads(t[i: j + 1])
            if isinstance(arr, list):
                return arr
        except json.JSONDecodeError:
            pass
    raise ValueError("Model javobi JSON massiv emas")


# ---------------------------------------------------------------------------
# Language detection (heuristic, AI sarflamaydi)
# ---------------------------------------------------------------------------

def detect_question_language(raw_text: str) -> str:
    """Heuristic til aniqlash: uz / ru / en / other. AI ishlatilmaydi."""
    t = (raw_text or "").lower()
    if not t:
        return "uz"

    # Kirill harflari soni
    cyr = len(re.findall(r"[а-яёА-ЯЁ]", raw_text))
    total_alpha = len(re.findall(r"[a-zA-Zа-яёА-ЯЁ]", raw_text)) or 1
    cyr_ratio = cyr / total_alpha

    # O'zbek lotin so'zlari
    uz_words = len(re.findall(
        r"\b(to['']?g['']?ri|javob|savol|variant|quyidagi|qaysi|kasallik|bo['']lishi|"
        r"o['']zbek|hamma|qon|bemor|davo|shifo|tibbiy|davolash|tekshiruv)\b",
        t, flags=re.IGNORECASE,
    ))
    # Ingliz tibbiy so'zlari
    eng_words = len(re.findall(
        r"\b(question|answer|choose|which|following|disease|patient|treatment|"
        r"diagnosis|clinical|drug|therapy|symptom|correct)\b",
        t
    ))
    # Rus tibbiy so'zlari
    ru_words = len(re.findall(
        r"\b(вопрос|ответ|задание|правильн|пациент|лечение|диагноз|болезнь|симптом)\b",
        t, flags=re.IGNORECASE,
    ))

    if cyr_ratio > 0.35 or ru_words >= 3:
        return "ru"
    if uz_words >= 2:
        return "uz"
    if eng_words >= 2:
        return "en"
    if cyr_ratio > 0.1:
        return "ru"
    # Lotin alifbosi lekin hech narsa yo'q — o'zbek deb qabul qilamiz
    return "uz"


# ---------------------------------------------------------------------------
# Answer key extraction
# ---------------------------------------------------------------------------

def _parse_answer_indexes(answer_text: str, option_count: int) -> list[int]:
    idxs: list[int] = []
    for m in re.findall(r"\d+", answer_text or ""):
        n = int(m)
        if 1 <= n <= option_count and n not in idxs:
            idxs.append(n)
    return idxs


def _extract_answer_key_map(raw_text: str) -> dict[int, list[str]]:
    """
    Javob kalitini ajratadi. Formatlar:
      1-A, 2:C, 3) 4, 4-B,D
      1. B  2. C  3. D  (bir qatorda)
      Answers: 1-A; 2-C
    """
    m: dict[int, list[str]] = {}
    text = raw_text or ""

    # Oxirgi 30% dan javob kalitini qidirish (ko'pincha oxirida bo'ladi)
    tail_start = max(0, int(len(text) * 0.7))
    tail = text[tail_start:]

    for region in [tail, text]:
        for qn, ans in re.findall(
            r"(?im)\b(\d{1,4})\s*[-:.)\s]\s*([A-Ja-j](?:\s*[,;/]\s*[A-Ja-j])*|\d{1,2}(?:\s*[,;/]\s*\d{1,2})*)",
            region
        ):
            q = int(qn)
            if q in m:
                continue
            vals = [x.strip().upper() for x in re.split(r"[,;/\s]+", ans) if x.strip()]
            if vals:
                m[q] = vals

        # Dense single-line: "1-A 2-C 3-D 4-B"
        for line in region.splitlines():
            pairs = re.findall(r"(\d{1,4})\s*[-:.]\s*([A-Ja-j]|\d{1,2})", line, flags=re.IGNORECASE)
            if len(pairs) >= 3:
                for qn, ans in pairs:
                    q = int(qn)
                    if q not in m:
                        m[q] = [ans.strip().upper()]

    return m


# ---------------------------------------------------------------------------
# Flexible question parser (regex, AI ishlatilmaydi)
# ---------------------------------------------------------------------------

def parse_flexible_questionnaire(raw_text: str, language: str = "auto") -> list[dict]:
    """
    Erkin formatli savol-javoblarni regex bilan ajratadi.
    AI ishlatilmaydi — zero token cost.
    Qo'llab-quvvatlangan formatlar:
    - 1. Savol matni / 1) Savol / Question 1: ...
    - Variantlar: A) B) C) D) yoki a. b. c. d. yoki 1) 2) 3) 4)
    - Javob kaliti: hujjat oxirida yoki inline
    """
    src_lang = (language or "auto").lower()
    if src_lang == "auto":
        src_lang = detect_question_language(raw_text)

    text = (raw_text or "").replace("\r\n", "\n").replace("\r", "\n")
    answer_map = _extract_answer_key_map(text)

    # Savol bloklarini ajratish.
    # "1) variant" ni savol boshidan ajratish uchun — faqat harfli prefiksli variantlar
    # yoki kalit so'zli (savol/вопрос/question) savollar bo'yicha split qilamiz.
    # Raqamli variant (1) 2) 3) 4)) bo'lgan bloklar `parse_structured_questionnaire` orqali.
    qsplit = re.split(
        r"(?im)(?=^\s*(?:"
        r"\d{1,4}[.]\s+"                    # 1. (nuqta bilan — savol)
        r"|question\s*#?\s*\d+[:\s]?"       # Question 1
        r"|savol\s*#?\s*\d+[:\s]?"          # Savol 1
        r"|вопрос\s*#?\s*\d+[:\s]?"         # Вопрос 1
        r"|задание\s*#?\s*\d+[:\s]?"        # Задание 1
        r"))",
        text,
    )

    out: list[dict] = []
    for block in qsplit:
        b = block.strip()
        if len(b) < 10:
            continue

        # Savol raqami va tanasini ajratish
        hm = re.match(
            r"(?im)^\s*(?:"
            r"(\d{1,4})[).]\s*"                                                    # 1. yoki 1)
            r"|(?:question|savol|вопрос|задание)\s*#?\s*(\d{1,4})\s*[:.)\-]?\s*"  # Savol 1: / Задание 1
            r")\s*([\s\S]*)$",
            b,
        )
        if not hm:
            continue

        qn = int(hm.group(1) or hm.group(2) or 0)
        body = (hm.group(3) or "").strip()
        lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
        if not lines:
            continue

        option_rows: list[tuple[str, str]] = []
        stem_parts: list[str] = []
        inline_answer = ""

        for ln in lines:
            # Inline javob kaliti
            ans_m = re.match(
                r"(?im)^(to['']?g['']?ri\s+javob(?:lar)?|правильн\w+\s+ответ\w*|correct\s+answer(?:s)?)\s*[:\-]\s*(.+)$",
                ln
            )
            if ans_m:
                inline_answer = ans_m.group(2).strip()
                continue

            # Variant satri — keng format: A) B) / a. b. / 1) 2) 3) 4)
            om = re.match(
                r"^\s*([A-Ja-j]|\d{1,2})[).:\-]\s+(.+)$",
                ln
            )
            if om:
                option_rows.append((om.group(1).upper(), om.group(2).strip()))
            else:
                # Savol matni qatoriga qo'shamiz — lekin "To'g'ri javob" kabi satrlarni emas
                if not re.match(
                    r"(?im)^(to['']?g['']?ri|правильн|correct\s+answer)",
                    ln
                ):
                    stem_parts.append(ln)

        # Inline variantlar (bir qatorda: A) ... B) ... C) ...)
        if len(option_rows) < 2:
            inline_opts = re.findall(
                r"(?i)([A-Ja-j])[).]\s*([^A-Ja-j\n]{2,60}?)(?=\s+[A-Ja-j][).]\s*|\s*$)",
                body
            )
            if len(inline_opts) >= 2:
                option_rows = [(k.upper(), v.strip()) for k, v in inline_opts]

        options = [v for _, v in option_rows][:10]
        if len(options) < 2:
            continue

        stem = " ".join(stem_parts).strip()
        # Stem oxiridan "To'g'ri javob:" kabi narsalarni olib tashlaymiz
        stem = re.sub(
            r"(?im)\s*(to['']?g['']?ri\s+javob(?:lar)?|правильн\w+\s+ответ\w*|correct\s+answer(?:s)?)\s*[:\-].*$",
            "", stem
        ).strip()
        if not stem or len(stem) < 3:
            stem = f"Question {qn}"

        # Javobni aniqlash
        ans_tokens: list[str] = []
        if inline_answer:
            ans_tokens = [x.strip().upper() for x in re.split(r"[,;/\s]+", inline_answer) if x.strip()]
        elif qn in answer_map:
            ans_tokens = answer_map[qn]

        # Token → index
        idxs: list[int] = []
        for tok in ans_tokens:
            tok = tok.strip()
            if re.match(r"^\d+$", tok):
                n = int(tok)
                if 1 <= n <= len(options):
                    idxs.append(n)
            elif re.match(r"^[A-J]$", tok):
                n = ord(tok.upper()) - ord("A") + 1
                if 1 <= n <= len(options):
                    idxs.append(n)

        if not idxs:
            idxs = [1]  # Fallback: birinchi variant

        correct_values = list(dict.fromkeys(options[i - 1] for i in idxs if i <= len(options)))
        if not correct_values:
            correct_values = [options[0]]

        # Ko'p to'g'ri javob — stemga yozamiz
        extra = f" [to'g'ri: {len(correct_values)} ta]" if len(correct_values) > 1 else ""

        out.append({
            "text": stem + extra,
            "options": options,
            "correctAnswer": correct_values[0],
            "categoryName": "Umumiy",
            "categoryDescription": "",
        })

    if out:
        return out

    # Oxirgi fallback: A/B/C/D inline format
    return _parse_abcd_inline(text)


def _parse_abcd_inline(text: str) -> list[dict]:
    """A) ... B) ... C) ... D) ... formatini ajratadi."""
    gpat = re.compile(
        r"(?is)(?P<stem>.{8,300}?)\s+"
        r"A[).:\-]\s*(?P<a>.{2,200}?)\s+"
        r"B[).:\-]\s*(?P<b>.{2,200}?)\s+"
        r"C[).:\-]\s*(?P<c>.{2,200}?)\s+"
        r"D[).:\-]\s*(?P<d>.{2,100}?)"
        r"(?=\s*(?:\n\s*\d+[).:]|\n\s*(?:question|savol|вопрос)\s*#?\s*\d+|$))"
    )
    out: list[dict] = []
    for gm in gpat.finditer(text):
        stem = re.sub(r"\s+", " ", (gm.group("stem") or "").strip())
        # Stem boshidagi raqamni olib tashlaymiz
        stem = re.sub(r"^\d{1,4}[).:\-\s]+", "", stem).strip()
        options = [
            re.sub(r"\s+", " ", (gm.group(k) or "").strip())
            for k in ("a", "b", "c", "d")
        ]
        if len(stem) < 5 or any(len(o) < 1 for o in options):
            continue
        out.append({
            "text": stem,
            "options": options,
            "correctAnswer": options[0],
            "categoryName": "Umumiy",
            "categoryDescription": "",
        })
    return out


def parse_structured_questionnaire(raw_text: str, language: str = "auto") -> list[dict]:
    """
    Qat'iy strukturali parser (Задание #N / Savol N / Question N formatlar).
    AI ishlatilmaydi.
    """
    try:
        return parse_flexible_questionnaire(raw_text, language)
    except Exception:
        pass

    src_lang = (language or "auto").lower()
    if src_lang == "auto":
        src_lang = detect_question_language(raw_text)

    lines = [ln.strip() for ln in (raw_text or "").splitlines()]
    out: list[dict] = []
    i = 0
    q_no = 0
    while i < len(lines):
        ln = lines[i]
        if not ln:
            i += 1
            continue
        if not re.match(
            r"^(задание\s*#?\d+|savol\s*#?\d+|question\s*#?\d+)",
            ln, flags=re.IGNORECASE
        ):
            i += 1
            continue
        q_no += 1
        question_text = ""
        options: list[str] = []
        answer_line = ""
        image_url = ""
        i += 1
        while i < len(lines):
            cur = lines[i]
            if re.match(
                r"^(задание\s*#?\d+|savol\s*#?\d+|question\s*#?\d+)",
                cur, flags=re.IGNORECASE
            ):
                break
            if not cur:
                i += 1
                continue
            if re.match(
                r"^(to['']?g['']?ri\s+javoblar?|правильн\w+\s+ответ\w*|correct\s+answer[s]?)\s*:",
                cur, flags=re.IGNORECASE,
            ):
                answer_line = cur
                i += 1
                continue
            om = re.match(r"^\s*(\d+)\)\s*(.+)$", cur)
            if om:
                options.append(om.group(2).strip())
                i += 1
                continue
            letter_om = re.match(r"^\s*([A-Ja-j])[).]\s*(.+)$", cur)
            if letter_om:
                options.append(letter_om.group(2).strip())
                i += 1
                continue
            um = re.search(r"(https?://\S+\.(?:png|jpe?g|gif|webp))", cur, flags=re.IGNORECASE)
            if um:
                image_url = um.group(1)
            if not question_text:
                question_text = re.sub(
                    r"^(вопрос|savol|question)\s*:\s*", "", cur, flags=re.IGNORECASE
                ).strip()
            elif not re.match(r"^(to['']?g['']?ri|правильн|correct)", cur, flags=re.IGNORECASE):
                question_text = question_text + " " + cur
            i += 1

        if len(options) < 2:
            continue
        ans_ids = _parse_answer_indexes(answer_line, len(options))
        if not ans_ids:
            ans_ids = [1]
        correct_values = [options[x - 1] for x in ans_ids]
        if image_url:
            question_text = f"{question_text}\n![question-image]({image_url})"
        out.append({
            "text": question_text or f"Question {q_no}",
            "options": options[:10],
            "correctAnswer": correct_values[0],
            "categoryName": "Umumiy",
            "categoryDescription": "",
        })

    if out:
        return out
    raise ValueError("Savol formati o'qilmadi: faylda savol/variant/to'g'ri javob satrlarini tekshiring.")


# ---------------------------------------------------------------------------
# Translation — bitta call da uz+ru (token tejash: 2x o'rniga 1x)
# ---------------------------------------------------------------------------

def translate_questions_batch(questions: list[dict], source_language: str) -> list[dict]:
    """
    Savollarni manba tilidan UZ+RU+EN ga tarjima qiladi.
    TOKEN TEJASH:
    - Bitta API call da 3 til (avval 2 alohida call bor edi)
    - Chunk size: 8 (5 dan ko'paytirildi — kamroq call)
    - Faqat kerakli maydonlar yuboriladi
    - Prompt juda qisqa va aniq
    """
    if not questions:
        return []
    client = _client()
    if not client:
        return [{} for _ in questions]

    src = (source_language or "uz").lower()
    src_name = {
        "uz": "Uzbek(Latin)",
        "ru": "Russian",
        "en": "English",
        "other": "Unknown"
    }.get(src, "Uzbek(Latin)")

    out_all: list[dict] = []
    chunk_size = 8  # 5 → 8: kamroq API call

    for i in range(0, len(questions), chunk_size):
        chunk = questions[i: i + chunk_size]

        # Faqat kerakli maydonlar — kamroq token
        batch = [
            {
                "i": j,  # Index — javobda moslashtirish uchun
                "t": q["text"][:300],  # Max 300 belgi
                "o": [str(x)[:150] for x in (q.get("options") or [])[:5]],
                "ca": str(q.get("correctAnswer") or "")[:150],
            }
            for j, q in enumerate(chunk)
        ]

        # Qaysi tillar kerak?
        if src == "en":
            targets = "Uzbek(Latin) as uz, Russian as ru"
            out_schema = '{"i":N,"t_uz":"...","t_ru":"...","o_uz":["..."],"o_ru":["..."],"ca_uz":"...","ca_ru":"..."}'
            lang_note = "Source is English, translate to UZ and RU only."
        elif src == "ru":
            targets = "Uzbek(Latin) as uz, English as en"
            out_schema = '{"i":N,"t_uz":"...","t_en":"...","o_uz":["..."],"o_en":["..."],"ca_uz":"...","ca_en":"..."}'
            lang_note = "Source is Russian, translate to UZ and EN only."
        elif src == "uz":
            targets = "Russian as ru, English as en"
            out_schema = '{"i":N,"t_ru":"...","t_en":"...","o_ru":["..."],"o_en":["..."],"ca_ru":"...","ca_en":"..."}'
            lang_note = "Source is Uzbek(Latin), translate to RU and EN only."
        else:
            # Unknown → translate to all 3
            targets = "Uzbek(Latin) as uz, Russian as ru, English as en"
            out_schema = '{"i":N,"t_uz":"...","t_ru":"...","t_en":"...","o_uz":["..."],"o_ru":["..."],"o_en":["..."],"ca_uz":"...","ca_ru":"...","ca_en":"..."}'
            lang_note = f"Source language: {src_name}. Translate to UZ, RU, EN."

        prompt = (
            f"Medical MCQ translator. {lang_note}\n"
            f"Targets: {targets}.\n"
            f"RULES: Keep option count/order. ca_* must exactly match one option in that lang.\n"
            f"Input JSON:\n{json.dumps(batch, ensure_ascii=False)}\n"
            f"Output: JSON array only. Each item: {out_schema}"
        )

        try:
            t = _generate(client, prompt).strip()
            arr = _extract_json_array_from_model_text(t)
        except Exception:
            arr = []

        # Index bo'yicha moslashtirish
        idx_map = {item["i"]: item for item in arr if isinstance(item, dict) and "i" in item}

        for j, q in enumerate(chunk):
            raw = idx_map.get(j, {})
            result: dict = {}

            # Manba tilini original sifatida saqlash
            opts_src = [str(x) for x in (q.get("options") or [])]
            if src == "en":
                result = {
                    "text_en": q["text"],
                    "text_uz": str(raw.get("t_uz") or ""),
                    "text_ru": str(raw.get("t_ru") or ""),
                    "options_en": opts_src,
                    "options_uz": _safe_list(raw.get("o_uz"), len(opts_src)),
                    "options_ru": _safe_list(raw.get("o_ru"), len(opts_src)),
                    "correct_answer_en": q.get("correctAnswer", ""),
                    "correct_answer_uz": str(raw.get("ca_uz") or ""),
                    "correct_answer_ru": str(raw.get("ca_ru") or ""),
                }
            elif src == "ru":
                result = {
                    "text_ru": q["text"],
                    "text_uz": str(raw.get("t_uz") or ""),
                    "text_en": str(raw.get("t_en") or ""),
                    "options_ru": opts_src,
                    "options_uz": _safe_list(raw.get("o_uz"), len(opts_src)),
                    "options_en": _safe_list(raw.get("o_en"), len(opts_src)),
                    "correct_answer_ru": q.get("correctAnswer", ""),
                    "correct_answer_uz": str(raw.get("ca_uz") or ""),
                    "correct_answer_en": str(raw.get("ca_en") or ""),
                }
            elif src == "uz":
                result = {
                    "text_uz": q["text"],
                    "text_ru": str(raw.get("t_ru") or ""),
                    "text_en": str(raw.get("t_en") or ""),
                    "options_uz": opts_src,
                    "options_ru": _safe_list(raw.get("o_ru"), len(opts_src)),
                    "options_en": _safe_list(raw.get("o_en"), len(opts_src)),
                    "correct_answer_uz": q.get("correctAnswer", ""),
                    "correct_answer_ru": str(raw.get("ca_ru") or ""),
                    "correct_answer_en": str(raw.get("ca_en") or ""),
                }
            else:
                result = {
                    "text_uz": str(raw.get("t_uz") or ""),
                    "text_ru": str(raw.get("t_ru") or ""),
                    "text_en": str(raw.get("t_en") or ""),
                    "options_uz": _safe_list(raw.get("o_uz"), len(opts_src)),
                    "options_ru": _safe_list(raw.get("o_ru"), len(opts_src)),
                    "options_en": _safe_list(raw.get("o_en"), len(opts_src)),
                    "correct_answer_uz": str(raw.get("ca_uz") or ""),
                    "correct_answer_ru": str(raw.get("ca_ru") or ""),
                    "correct_answer_en": str(raw.get("ca_en") or ""),
                }

            out_all.append(result)

    return out_all[: len(questions)]


def _safe_list(val: Any, expected_len: int) -> list:
    """Ro'yxatni xavfsiz tekshiradi, kerak bo'lsa bo'sh stringlar bilan to'ldiradi."""
    if not isinstance(val, list):
        return [""] * expected_len
    result = [str(x) for x in val]
    while len(result) < expected_len:
        result.append("")
    return result[:expected_len]


# Legacy compat: eski nomlar bilan chaqirilgan kodlar uchun
def translate_en_questions_to_uz_ru(questions: list[dict]) -> list[dict]:
    """Legacy. translate_questions_batch ga yo'naltiradi."""
    return translate_questions_batch(questions, "en")


def translate_questions_to_other_languages(questions: list[dict], source_language: str) -> list[dict]:
    """Legacy. translate_questions_batch ga yo'naltiradi."""
    return translate_questions_batch(questions, source_language)


# ---------------------------------------------------------------------------
# AI-assisted question parsing + classification
# ---------------------------------------------------------------------------

def parse_and_classify_questionnaire(raw_text: str, language: str) -> list[dict]:
    """
    AI yordamida savol ajratish va kategoriyalash.
    TOKEN TEJASH:
    - Matn 120k belgidan kesiladi (avval 220k edi)
    - Prompt ancha qisqa va strukturali
    - Temperatura: 0 (kamroq hallucination)
    """
    src_language = (language or "auto").lower()
    if src_language == "auto":
        src_language = detect_question_language(raw_text)

    client = _client()
    if not client:
        return parse_structured_questionnaire(raw_text, src_language)

    lang = "Uzbek" if src_language == "uz" else "Russian" if src_language == "ru" else "English"

    # Token tejash: max 120k belgi (avval 220k edi — ~40% kamayish)
    snippet = raw_text if len(raw_text) <= 120_000 else raw_text[:120_000]

    # Qisqa, aniq prompt
    prompt = (
        f"Extract ALL MCQs from this {lang} document text. Include answer key if present.\n"
        f"Output: JSON array only.\n"
        f"Schema: [{{\"text\":\"stem\",\"options\":[\"opt1\",...],\"correctAnswer\":\"opt1\","
        f"\"categoryName\":\"topic\",\"categoryDescription\":\"\"}}]\n"
        f"Rules:\n"
        f"- options: 2-5 items, full text (no letter prefix)\n"
        f"- correctAnswer must exactly match one option\n"
        f"- categoryName: short medical topic in {lang}\n"
        f"- skip incomplete questions\n"
        f"- use answer key at end of doc if present\n\n"
        f"TEXT:\n{snippet}"
    )

    t = _generate(client, prompt)
    arr = _extract_json_array_from_model_text(t)
    out = _normalize_parsed_items(arr, src_language)
    if not out:
        raise ValueError("AI hech qanday yaroqli savol topmadi")
    return out


def _normalize_parsed_items(arr: list, src_language: str) -> list[dict]:
    out: list[dict] = []
    for item in arr:
        if not isinstance(item, dict):
            continue
        opts = [str(x).strip() for x in (item.get("options") or [])][:10]
        opts = [x for x in opts if x]
        if len(opts) < 2:
            continue
        ca = str(item.get("correctAnswer") or opts[0]).strip()
        if ca not in opts:
            # Harfdan indeksga o'girish urinishi
            ca_letter = ca.upper()
            if re.match(r"^[A-J]$", ca_letter):
                idx = ord(ca_letter) - ord("A")
                ca = opts[idx] if idx < len(opts) else opts[0]
            else:
                ca = opts[0]
        text = str(item.get("text") or "").strip()
        if len(text) < 4:
            continue
        cat = str(item.get("categoryName") or "Umumiy").strip()[:300] or "Umumiy"
        desc = str(item.get("categoryDescription") or "").strip()[:500]
        out.append({
            "text": text,
            "options": opts,
            "correctAnswer": ca,
            "categoryName": cat,
            "categoryDescription": desc,
        })
    return out


# ---------------------------------------------------------------------------
# Multimodal (scan/rasm) parsing
# ---------------------------------------------------------------------------

def parse_and_classify_document_bytes(raw: bytes, filename: str, language: str) -> list[dict]:
    """
    Skanerlangan/rasmli hujjatlar uchun multimodal parsing.
    TOKEN TEJASH:
    - PDF to'g'ridan-to'g'ri (eng samarali)
    - DOCX: faqat dastlabki 15 ta rasm
    - Minimal prompt
    """
    client = _client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    from google.genai import types

    src_language = (language or "auto").lower()
    if src_language == "auto":
        src_language = "uz"

    lang_name = "English" if src_language == "en" else "Russian" if src_language == "ru" else "Uzbek"
    name = (filename or "").lower()

    prompt = (
        f"Extract ALL MCQs from this document. Language hint: {lang_name}.\n"
        f"JSON array only: [{{\"text\":\"...\",\"options\":[...],\"correctAnswer\":\"...\","
        f"\"categoryName\":\"...\",\"categoryDescription\":\"\"}}]\n"
        f"Rules: options 2-10 items; correctAnswer=exact option; include answer key."
    )

    contents: list[Any] = [prompt]
    if name.endswith(".pdf"):
        contents.append(types.Part.from_bytes(data=raw, mime_type="application/pdf"))
    elif name.endswith(".docx"):
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            media_names = [n for n in zf.namelist() if n.startswith("word/media/")]
            for n in media_names[:15]:  # 20 → 15: kamroq token
                b = zf.read(n)
                ext = n.rsplit(".", 1)[-1].lower() if "." in n else ""
                mime = (
                    "image/png" if ext == "png" else
                    "image/gif" if ext == "gif" else
                    "image/webp" if ext == "webp" else
                    "image/jpeg"
                )
                contents.append(types.Part.from_bytes(data=b, mime_type=mime))
    else:
        raise ValueError("Unsupported document type for multimodal parse")

    t = _generate(client, None, contents=contents).strip()
    arr = _extract_json_array_from_model_text(t)
    out = _normalize_parsed_items(arr, src_language)
    if not out:
        raise ValueError("Hujjatdan savollar ajratilmadi")
    return out


# ---------------------------------------------------------------------------
# Paraphrase (exam security)
# ---------------------------------------------------------------------------

def paraphrase_medical_mcqs(questions: list[dict], exam_language: str) -> list[dict]:
    """Savollarni qayta shakllantirish. Minimal prompt."""
    if not questions:
        return []
    client = _client()
    if not client:
        return questions

    lang = (
        "Uzbek(Latin)" if exam_language == "uz" else
        "Russian" if exam_language == "ru" else
        "English"
    )

    batch = [
        {
            "t": q["text"][:250],
            "o": [str(x)[:100] for x in (q.get("options") or [])[:5]],
            "ca": str(q.get("correctAnswer") or "")[:100],
        }
        for q in questions
    ]

    prompt = (
        f"Rephrase medical MCQs for exam security. Language: {lang}.\n"
        f"Keep: difficulty, topic, option count, correctAnswer meaning.\n"
        f"Input: {json.dumps(batch, ensure_ascii=False)}\n"
        f"Output: JSON array only. Each: {{\"t\":\"...\",\"o\":[...],\"ca\":\"...\"}}\n"
        f"ca must exactly match one item in o."
    )

    try:
        t = _generate(client, prompt).strip()
        arr = _extract_json_array_from_model_text(t)
    except Exception:
        return questions

    out: list[dict] = []
    for j, q in enumerate(questions):
        if j < len(arr) and isinstance(arr[j], dict):
            opts = [str(x) for x in (arr[j].get("o") or [])][:5]
            while len(opts) < 2:
                opts.append(f"Option {len(opts) + 1}")
            ca = str(arr[j].get("ca") or opts[0])
            if ca not in opts and opts:
                ca = opts[0]
            out.append({
                "text": str(arr[j].get("t") or q["text"]),
                "options": opts,
                "correctAnswer": ca,
            })
        else:
            out.append(dict(q))
    return out if out else questions
