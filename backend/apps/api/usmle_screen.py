"""Savollarni USMLE o'lchoviga solib saraydi va apellyatsiya xavfini topadi.

Ikki vazifa bor va ularni aralashtirmaslik kerak:

1. APELLYATSIYA XAVFI (`appeal_risks`) — savolning o'zida nuqson bor,
   topshiruvchi haqli ravishda shikoyat qila oladi. Masalan ikki variant bir
   xil tashxisni boshqa so'z bilan aytadi ("qizilo'ngach varikozi" va "sirroz
   portal gipertenziyasi" — ikkisi ham to'g'ri), yoki savol matni yarmida
   kesilgan, yoki rasmga havola qilingan-u rasm yo'q. Bunday savol imtihonda
   bo'lmasligi kerak: u qiyinlik bermaydi, faqat janjal keltiradi.

2. USMLE DARAJASI (`usmle_score`) — savol qanchalik USMLE 2-qadam uslubiga
   mos: klinik holat bayoni, bir xil turdagi besh variant, "eng ehtimolli
   tashxis / keyingi qadam" ko'rinishidagi savol. Ball qancha baland bo'lsa,
   savol shuncha qiyin VA shuncha himoyalangan — qiyinlik chalkashlikdan
   emas, klinik fikrlash talabidan keladi. Shu ball bo'yicha saralanadi.

Hech narsa qayta yozilmaydi: faqat baholanadi va tanlanadi. Savol matnini
AI bilan qayta yozish 25.09.2026 da kalitlar fojiasiga olib kelgan edi.
"""
from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------- matn --

_APOS = dict.fromkeys(map(ord, "'`’‘ʻʼ"), ord("'"))


def norm(s) -> str:
    """Taqqoslash uchun matnni tekislaydi (apostrof va registr farqlari ketadi)."""
    t = unicodedata.normalize("NFKC", str(s or "")).translate(_APOS).lower()
    return re.sub(r"\s+", " ", t).strip()


_STOP = {
    "va", "bilan", "uchun", "yoki", "ham", "bu", "shu", "u", "о", "в", "и",
    "the", "of", "a", "an", "to", "in", "tufayli", "natijasida", "sababli",
    "mumkin", "kerak", "bo'lgan", "bo'lishi", "kelgan", "yuzaga", "orqali",
    "qilish", "etish", "hisoblanadi", "deb", "quyidagi", "eng",
}


def words(s) -> set[str]:
    return {w for w in re.findall(r"[a-zа-яёʻ'’\-]{3,}", norm(s)) if w not in _STOP}


def _similar(a: str, b: str) -> float:
    """Ikki variantning ma'no yaqinligi (so'zlar kesishuvi)."""
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    inter = len(wa & wb)
    # Biri ikkinchisini qamrab olsa — eng xavfli holat (bittasi ikkinchisining
    # aniqroq ko'rinishi, ya'ni ikkisi ham to'g'ri deb da'vo qilinadi).
    cover = inter / min(len(wa), len(wb))
    jacc = inter / len(wa | wb)
    return max(jacc, cover * 0.95)


# ------------------------------------------------- apellyatsiya xavfi --

_IMAGE = re.compile(
    r"(rasmda|suratda|rasmga|diagrammada|grafikda|quyidagi rasm|ko'rsatilgan rasm|"
    r"ekgda ko'rsatilgan|rentgenogrammada ko'rsatilgan|на рисунке|на снимке|"
    r"shown in the (figure|image))",
    re.IGNORECASE)
_ALL_OF = re.compile(
    r"(hammasi to'g'ri|barchasi to'g'ri|yuqoridagilarning barchasi|hech biri|"
    r"all of the above|none of the above|все перечисленн|ничего из перечисленного)",
    re.IGNORECASE)
_NEGATIVE = re.compile(
    r"(to'g'ri emas|noto'g'ri|emas\?|bo'lmaydi|xato|except|не является|неверно)",
    re.IGNORECASE)
# Matn tugallanganmi: savol belgisi, nuqta, ikki nuqta bilan tugasin.
_ENDS_OK = re.compile(r"[?.!:;]\s*$")
_DANGLING = re.compile(
    r"\b(va|bilan|uchun|yoki|hamda|ya'ni|chunki|agar|lekin|ammo|qaysi|qanday|"
    r"nima|bo'lsa|bo'lgan|quyidagi|eng)\s*$",
    re.IGNORECASE)

SIM_LIMIT = 0.72


def appeal_risks(q: dict) -> list[str]:
    """Savoldagi apellyatsiyaga sabab bo'ladigan nuqsonlar ro'yxati."""
    text = str(q.get("text") or "")
    opts = [str(o) for o in (q.get("options") or [])]
    ans = str(q.get("correctAnswer") or "")
    out: list[str] = []

    if not text.strip():
        out.append("matn yo'q")
    if len(opts) < 4:
        out.append("variant %d ta (4 tadan kam)" % len(opts))
    if not ans.strip():
        out.append("kalit yo'q")
    elif ans not in opts:
        out.append("to'g'ri javob variantlar ichida yo'q")
    if len({norm(o) for o in opts}) != len(opts):
        out.append("variantlar takrorlangan")

    # Matn yarmida kesilgan — "savol tugallanmagan" degan shikoyat.
    stripped = text.strip()
    if stripped and not _ENDS_OK.search(stripped):
        out.append("matn tugallanmagan (tinish belgisi yo'q)")
    elif _DANGLING.search(re.sub(r"[?.!:;]\s*$", "", stripped)):
        out.append("matn bog'lovchi so'zda tugagan")

    # Rasm yo'q, lekin rasmga havola bor.
    if _IMAGE.search(text) and not (q.get("image") or q.get("image_url")):
        out.append("rasmga havola, rasm yo'q")

    # "Hammasi to'g'ri" — qiyinlik bermaydi, janjal keltiradi.
    if any(_ALL_OF.search(o) for o in opts):
        out.append("'hammasi/hech biri' turidagi variant")

    # Inkor savol + mutlaq variantlar: eng ko'p shikoyat shu yerdan chiqadi.
    if _NEGATIVE.search(text) and any(_ALL_OF.search(o) for o in opts):
        out.append("inkor savol + mutlaq variant")

    # IKKI VARIANT BIR XIL MA'NODA — ikkisi ham to'g'ri deb da'vo qilinadi.
    for i in range(len(opts)):
        for j in range(i + 1, len(opts)):
            s = _similar(opts[i], opts[j])
            if s >= SIM_LIMIT and (opts[i] == ans or opts[j] == ans):
                out.append("kalit bilan yaqin variant (%.0f%%): %s"
                           % (s * 100, opts[j if opts[i] == ans else i][:60]))
                break
        else:
            continue
        break
    return out


# ------------------------------------------------------ USMLE darajasi --

_AGE = re.compile(r"\b(\d{1,3})\s*(yosh|yoshli|-yosh|yoshda|лет|года|year[- ]old)", re.IGNORECASE)
_SEX = re.compile(r"(erkak|ayol|o'g'il|qiz|bola|chaqaloq|мужчина|женщина|male|female)", re.IGNORECASE)
_FINDINGS = re.compile(
    r"(qon bosimi|puls|harorat|nafas|mm sim|°c|laborator|tahlil|mri|kt\b|ktsi|"
    r"rentgen|ekg|exo|uzi|usm|leykotsit|gemoglobin|kreatinin|ck-mb|troponin|"
    r"auskultatsiya|palpatsiya|ko'rikda|tekshiruvda)",
    re.IGNORECASE)
_BEST_STEM = re.compile(
    r"(eng ehtimolli|eng to'g'ri|keyingi qadam|keyingi bosqich|eng yaxshi|"
    r"birinchi navbatda|eng mos|qaysi biri eng|tashxis(ni)? (qo'yish|tasdiqlash)|"
    r"dastlabki tekshiruv|taktika|most likely|next step|best initial)",
    re.IGNORECASE)
_RECALL = re.compile(
    r"(nima deb ataladi|qanday nomlanadi|kim tomonidan|qaysi yilda|ta'rifi|"
    r"nechta|klassifikatsiyasi bo'yicha|sinonimi)",
    re.IGNORECASE)


def usmle_score(q: dict) -> int:
    """Savolning USMLE uslubiga mosligi (katta ball = qiyin va himoyalangan).

    Ball 0 dan 10 gacha. Klinik holat, bir xil uzunlikdagi besh variant va
    "keyingi qadam / eng ehtimolli tashxis" savoli ball qo'shadi; ta'rifga
    asoslangan yodlash savoli va javob uzunligidan topiladigan savol ball
    yo'qotadi.
    """
    text = str(q.get("text") or "")
    opts = [str(o) for o in (q.get("options") or [])]
    ans = str(q.get("correctAnswer") or "")
    score = 0

    # Klinik holat bayoni
    if _AGE.search(text):
        score += 2
    if _SEX.search(text):
        score += 1
    if _FINDINGS.search(text):
        score += 2
    n = len(text)
    if 350 <= n <= 1400:
        score += 2
    elif n < 160:
        score -= 2

    # Savol shakli
    if _BEST_STEM.search(text):
        score += 2
    if _RECALL.search(text):
        score -= 2

    # Variantlar: 5 ta va bir xil uzunlikda — chalg'ituvchilar jonli
    if len(opts) >= 5:
        score += 1
    lens = [len(o) for o in opts if o]
    if lens and min(lens) > 0:
        if max(lens) / min(lens) <= 1.6:
            score += 1
        elif max(lens) / min(lens) > 2.5:
            score -= 1
    # Javob eng uzun bo'lsa — uzunligiga qarab topiladi
    others = [len(o) for o in opts if o != ans]
    if others and ans and len(ans) > max(others) * 1.4:
        score -= 2
    # Chalg'ituvchilar bir-biriga yaqin (bir xil toifadan) — yaxshi belgi,
    # lekin KALIT bilan yaqin bo'lmasin (u appeal_risks da tutiladi).
    if len(opts) >= 4:
        sims = [
            _similar(opts[i], opts[j])
            for i in range(len(opts)) for j in range(i + 1, len(opts))
            if ans not in (opts[i], opts[j])
        ]
        if sims and 0.25 <= (sum(sims) / len(sims)) <= SIM_LIMIT:
            score += 1

    return max(0, min(10, score))
