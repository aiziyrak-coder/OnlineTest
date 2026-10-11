"""Har bir topshiruvchiga OLDINDAN tayyorlangan savollar to'plami.

Nega kerak: ilgari to'plam imtihon boshlanganda tanlanardi (bank_mixed va
ishga qabul testlarida hatto AI chaqiruvi bilan). Bu o'sha lahzada
"generatsiya" degani: yuz kishi bir vaqtda kirganda eng kritik daqiqada
qo'shimcha ish bajarilardi, va qayta ruxsat berilganda ham xuddi shunday.
Endi to'plamlar imtihondan OLDIN yig'iladi va navbatda turadi:

  * har kishiga boshqa savollar (bank bo'ylab teng taqsimlab);
  * bir odamning 1-urinishi va 2-urinishida umumiy savol yo'q;
  * variantlar tartibi ham, VARIANTLAR ICHIDAGI javoblar tartibi ham
    aralashtiriladi — qo'shni ekrandan ko'chirish foyda bermaydi;
  * qayta ruxsat berilganda navbatdagi tayyor to'plam olinadi, hech narsa
    qaytadan tanlanmaydi.

Javoblar tartibini aralashtirish xavfsiz: baholash javob MATNINI
solishtiradi (services.py), to'g'ri javob esa matn sifatida saqlanadi.
Lekin variantlarga POZITSIYA bo'yicha bog'langan maydonlar bor
(options_ru/_en, optionExplanations*) — ular ham birga ko'chiriladi, aks
holda rus tilidagi javob boshqa variantga tushib qolardi.
"""
from __future__ import annotations

import json
import random
from collections import Counter

# Variantlarga pozitsiya bo'yicha bog'langan maydonlar.
PARALLEL_KEYS = (
    "options_uz", "options_ru", "options_en",
    "optionExplanations", "optionExplanations_uz",
    "optionExplanations_ru", "optionExplanations_en",
)


def question_key(q: dict):
    """Savolning bank bo'yicha barqaror belgisi."""
    raw = q.get("bank_id") or q.get("source_id") or q.get("id")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return str(q.get("text") or "")[:160]


def shuffle_options(q: dict, rnd: random.Random) -> dict:
    """Javoblar tartibini aralashtiradi (to'g'ri javob matni o'zgarmaydi)."""
    opts = [o for o in (q.get("options") or [])]
    if len(opts) < 2:
        return dict(q)
    order = list(range(len(opts)))
    rnd.shuffle(order)
    out = dict(q)
    out["options"] = [opts[i] for i in order]
    for key in PARALLEL_KEYS:
        val = q.get(key)
        if isinstance(val, list) and len(val) == len(opts):
            out[key] = [val[i] for i in order]
    return out


def build_variants(
    bank: list[dict],
    need: int,
    count: int,
    *,
    usage: Counter | None = None,
    rnd: random.Random | None = None,
    avoid: set | None = None,
    quality=None,
) -> list[list[dict]]:
    """Bitta odam uchun `count` ta to'plam tuzadi.

    `usage` — bank bo'ylab savol necha marta ishlatilgani (odamlar orasida
    teng taqsimlash uchun); funksiya uni yangilaydi. `avoid` — bu odamga
    ilgari berilgan savollar (takrorlanmasin). `quality` — savolga ball
    beruvchi funksiya (masalan USMLE balli): teng darajada ishlatilgan
    savollar orasidan balli balandi oldin tanlanadi, ya'ni qiyinroq va
    uzunroq klinik savollar birinchi navbatda tushadi.
    """
    rnd = rnd or random.Random()
    usage = usage if usage is not None else Counter()
    taken = set(avoid or ())
    out: list[list[dict]] = []
    for _ in range(max(1, count)):
        pool = [q for q in bank if question_key(q) not in taken]
        if len(pool) < need:
            # Bank tugadi — bu odamga berilmaganlar yetmaydi. Shunda eng kam
            # ishlatilganlardan to'ldiramiz (imtihon boshlanmay qolmasin).
            pool = list(bank)
        # Eng kam ishlatilganlar oldinda; teng ishlatilganlar orasida balli
        # balandi oldinda; qolgani tasodifiy tartibda.
        if quality is None:
            pool.sort(key=lambda q: (usage[question_key(q)], rnd.random()))
        else:
            pool.sort(key=lambda q: (usage[question_key(q)], -quality(q), rnd.random()))
        picked = pool[:need]
        rnd.shuffle(picked)
        variant = []
        for i, q in enumerate(picked, 1):
            item = shuffle_options(q, rnd)
            item.setdefault("source_id", q.get("bank_id") or q.get("id"))
            item["id"] = i
            variant.append(item)
            usage[question_key(q)] += 1
            taken.add(question_key(q))
        out.append(variant)
    return out


def prepared_variants(se) -> list[list[dict]]:
    raw = getattr(se, "prepared_variants_json", "") or "[]"
    try:
        val = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [v for v in val if isinstance(v, list) and v] if isinstance(val, list) else []


def set_prepared(se, variants: list[list[dict]]) -> None:
    se.prepared_variants_json = json.dumps(variants, ensure_ascii=False)


def take_prepared(se) -> bool:
    """Navbatdagi tayyor to'plamni sessiyaga qo'yadi.

    Tayyor to'plam bo'lmasa False qaytaradi — bunda eski yo'l (boshlanganda
    tanlash) ishlaydi, ya'ni imtihon baribir boshlanadi.
    """
    queue = prepared_variants(se)
    if not queue:
        return False
    nxt, rest = queue[0], queue[1:]
    se.session_questions_json = json.dumps(nxt, ensure_ascii=False)
    set_prepared(se, rest)
    return True
