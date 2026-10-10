"""Imtihon savollarini saqlashdan OLDIN tekshiradigan yagona joy.

Nega kerak: savollar ikki yo'l bilan kiritiladi — imtihon yaratishda (qo'lda
yozilgan ro'yxat yoki PDF) va keyinchalik "savol banki" oynasidan. Bank oynasi
savollarni tekshirardi, imtihon yaratish esa tekshirmasdan saqlab yuborardi.
Natijada bankka nuqsonli savol tushishi mumkin edi:

  * raqami (id) yo'q savol — baholashda xatolik;
  * to'g'ri javobi variantlar ichida yo'q — talaba nima tanlasa ham "xato";
  * bir xil ikkita variant — qaysi biri to'g'ri ekani noaniq, apellyatsiya;
  * bitta savol bankda ikki marta — bir xil savol ikki marta tushadi.

Shu modul hamma joyda bir xil qoidani qo'llaydi va muammolarni sabab bilan
qaytaradi, admin nimani tuzatish kerakligini ko'radi.
"""
from __future__ import annotations

import re

#: Variantlarni solishtirish uchun soddalashtirish (katta-kichik harf, apostrof,
#: ortiqcha bo'sh joy va tinish belgilari farqi hisobga olinmaydi).
_NORM = re.compile(r"[^0-9a-zA-Zа-яёА-ЯЁ]+")


def norm_text(value) -> str:
    s = str(value or "").lower()
    for a, b in (("‘", "'"), ("’", "'"), ("ʻ", "'"), ("ʼ", "'")):
        s = s.replace(a, b)
    return _NORM.sub("", s)


def _resolve_answer(ans: str, opts: list[str]) -> str | None:
    """Javob variantlar ichidami; "A" yoki "3" ko'rinishida bo'lsa — o'giradi."""
    if ans in opts:
        return ans
    na = norm_text(ans)
    for o in opts:
        if norm_text(o) == na and na:
            return o
    key = ans.strip().rstrip(").:").upper()
    idx = None
    if len(key) == 1 and key.isalpha():
        idx = ord(key) - ord("A")
    elif key.isdigit():
        idx = int(key) - 1
    if idx is not None and 0 <= idx < len(opts):
        return opts[idx]
    return None


def sanitize_questions(
    raw, *, min_options: int = 2, renumber: bool = True, start_id: int = 1
) -> tuple[list[dict], list[str]]:
    """Savollarni normallashtiradi. `(yaroqli savollar, muammolar)` qaytaradi."""
    out: list[dict] = []
    problems: list[str] = []
    seen_texts: set[str] = set()
    for i, q in enumerate(raw or [], start=1):
        if not isinstance(q, dict):
            problems.append("%d-savol: noto'g'ri ko'rinish (obyekt emas)" % i)
            continue
        text = str(q.get("text") or q.get("question") or "").strip()
        opts = [str(o).strip() for o in (q.get("options") or q.get("variants") or []) if str(o).strip()]
        ans = str(q.get("correctAnswer") or q.get("answer") or "").strip()
        if not text:
            problems.append("%d-savol: matni bo'sh" % i)
            continue
        if len(opts) < min_options:
            problems.append("%d-savol: variantlar yetarli emas (%d ta)" % (i, len(opts)))
            continue
        norms = [norm_text(o) for o in opts]
        if len(set(norms)) != len(norms):
            problems.append("%d-savol: bir xil variant ikki marta yozilgan" % i)
            continue
        resolved = _resolve_answer(ans, opts)
        if resolved is None:
            problems.append("%d-savol: to'g'ri javob variantlar ichida yo'q" % i)
            continue
        key = norm_text(text)
        if key in seen_texts:
            problems.append("%d-savol: bu savol ro'yxatda takrorlangan" % i)
            continue
        seen_texts.add(key)
        item = {
            "id": (start_id + len(out)) if renumber else (q.get("id") or start_id + len(out)),
            "text": text,
            "options": opts,
            "correctAnswer": resolved,
        }
        for extra in ("text_ru", "text_en", "text_uz", "options_ru", "options_en", "options_uz",
                      "correct_answer_ru", "correct_answer_en", "explanation", "subject",
                      "topic_from", "references", "key_source", "key_confidence"):
            if q.get(extra):
                item[extra] = q[extra]
        out.append(item)
    return out, problems


def merge_banks(current: list, incoming: list) -> tuple[list[dict], list[str]]:
    """Mavjud bankka yangi savollarni qo'shadi — takrorlanganlari tashlanadi."""
    kept, problems = sanitize_questions(current, renumber=True)
    have = {norm_text(q["text"]) for q in kept}
    fresh, more = sanitize_questions(incoming, renumber=False)
    problems += more
    added = 0
    for q in fresh:
        k = norm_text(q["text"])
        if k in have:
            problems.append("takrorlangan savol o'tkazib yuborildi: %s" % q["text"][:60])
            continue
        have.add(k)
        q["id"] = len(kept) + 1
        kept.append(q)
        added += 1
    return kept, problems
