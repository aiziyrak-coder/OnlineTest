"""Savollarni USMLE o'lchoviga solib saraydi va apellyatsiya xavfini topadi.

Uch narsa bor va ularni aralashtirmaslik kerak:

1. `appeal_risks` — FAQAT mexanik tasdiqlanadigan nuqsonlar: kalit
   variantlar ichida yo'q, ikki variant bir xil matn, 4 tadan kam variant,
   rasmga havola qilingan-u rasm yo'q, matn so'z o'rtasida kesilgan,
   "hammasi to'g'ri" turidagi variant. Bunday savolni imtihonda qoldirish
   mumkin emas — u qiyinlik bermaydi, faqat apellyatsiya keltiradi. Shu
   ro'yxat bo'yicha avtomatik chiqarish xavfsiz.

2. `review_flags` — SHUBHA, odam ko'rishi kerak. Masalan ikki variant
   bir-biriga juda o'xshash. Bu belgi o'zi hukm emas: 11.10.2026 da shunday
   belgilangan 708 savolni tekshirganda ko'pchiligi aslida TO'G'RI tuzilgan
   chalg'ituvchilar bo'lib chiqdi — "immunitet mavjud" / "immunitet yo'q",
   "HPV 6 va 11" / "HPV 16 va 18", "mushukni chiqarib yuborish" /
   "chiqarmasdan". Matn o'xshashligi ma'no farqini ko'rmaydi, shuning uchun
   bu belgi bo'yicha HECH NARSA avtomatik o'chirilmaydi.

3. `usmle_score` — savol qanchalik USMLE 2-qadam uslubiga mos: klinik holat
   bayoni, uzun matn, bir xil turdagi besh variant, "keyingi qadam / eng
   ehtimolli tashxis" savoli. Ball bo'yicha saralanadi: qiyinlik klinik
   fikrlash talabidan keladi, savolning nuqsonidan emas.

Savol matni hech qachon qayta yozilmaydi — faqat baholanadi va tanlanadi.
Matnni AI bilan qayta yozish 25.09.2026 da kalitlar fojiasiga olib kelgan.
"""
from __future__ import annotations

import difflib
import re
import unicodedata

_APOS = dict.fromkeys(map(ord, "'`’‘ʻʼ"), ord("'"))


def norm(s) -> str:
    """Taqqoslash uchun matnni tekislaydi (apostrof va registr farqi ketadi)."""
    t = unicodedata.normalize("NFKC", str(s or "")).translate(_APOS).lower()
    return re.sub(r"\s+", " ", t).strip()


_STOP = {
    "va", "bilan", "uchun", "yoki", "ham", "bu", "shu", "tufayli", "natijasida",
    "sababli", "mumkin", "kerak", "bo'lgan", "bo'lishi", "kelgan", "yuzaga",
    "orqali", "qilish", "etish", "hisoblanadi", "deb", "quyidagi", "eng",
    "the", "of", "a", "an", "to", "in",
}


def words(s) -> set[str]:
    return {w for w in re.findall(r"[a-zа-яёʻ'’\-]{3,}", norm(s)) if w not in _STOP}


def _digits(s) -> set[str]:
    return set(re.findall(r"\d+", str(s or "")))


# Ma'noni teskari qiladigan juftliklar — matni o'xshash, javobi boshqa.
_ANTONYMS = (
    ("mavjud", "yo'q"), ("bor", "yo'q"), ("oshadi", "pasayadi"),
    ("yuqori", "past"), ("ko'tarilgan", "pasaygan"), ("chap", "o'ng"),
    ("musbat", "salbiy"), ("boyishi", "kambag'allashuvi"), ("kengaygan", "toraygan"),
    ("ortadi", "kamayadi"), ("tez", "sekin"), ("iloji bor", "iloji yo'q"),
)
_NEG = re.compile(r"(masdan|maydi|magan|masligi|emas|siz\b)")


def _meaning_differs(a: str, b: str) -> bool:
    """Matni o'xshash bo'lsa ham ma'nosi boshqami."""
    na, nb = norm(a), norm(b)
    if _digits(na) != _digits(nb):
        return True
    for x, y in _ANTONYMS:
        if (x in na) != (x in nb) or (y in na) != (y in nb):
            return True
    if bool(_NEG.search(na)) != bool(_NEG.search(nb)):
        return True
    return False


def option_similarity(a: str, b: str) -> float:
    """Ikki variantning MATN yaqinligi (ma'no emas)."""
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


SIM_REVIEW = 0.86

# --------------------------------------------------- mexanik nuqsonlar --

_IMAGE = re.compile(
    r"(rasmda|suratda|rasmga qarab|diagrammada|grafikda|quyidagi rasm|"
    r"ko'rsatilgan rasm|rasmda ko'rsatilgan|на рисунке|на снимке|"
    r"shown in the (figure|image))",
    re.IGNORECASE)
_ALL_OF = re.compile(
    r"(hammasi to'g'ri|barchasi to'g'ri|yuqoridagilarning barchasi|"
    r"all of the above|none of the above|все перечисленн|ничего из перечисленного)",
    re.IGNORECASE)
_ENDS_OK = re.compile(r"[?.!:;»\")]\s*$")
# So'z o'rtasida kesilgan matn: oxiri vergul/chiziq, yoki oxirgi "so'z" 1-2
# harfdan iborat qoldiq ("..., p/ya - 21%, s").
_CUT = re.compile(r"[,;\-–—/]\s*$")


def appeal_risks(q: dict) -> list[str]:
    """Imtihonda qoldirish mumkin bo'lmagan nuqsonlar (avtomatik chiqarishga)."""
    text = str(q.get("text") or "").strip()
    opts = [str(o) for o in (q.get("options") or [])]
    ans = str(q.get("correctAnswer") or "")
    out: list[str] = []

    if not text:
        out.append("matn yo'q")
    if len(opts) < 4:
        out.append("variant %d ta (4 tadan kam)" % len(opts))
    if not ans.strip():
        out.append("kalit yo'q")
    elif ans not in opts:
        out.append("to'g'ri javob variantlar ichida yo'q")
    if len({norm(o) for o in opts}) != len(opts):
        out.append("ikki variant bir xil matn")
    if any(_ALL_OF.search(o) for o in opts):
        out.append("'hammasi/hech biri' turidagi variant")
    if _IMAGE.search(text) and not (q.get("image") or q.get("image_url")):
        out.append("rasmga havola, rasm yo'q")

    # Matn so'z o'rtasida kesilgan. Tinish belgisining yo'qligi o'zi nuqson
    # emas (bosh harf bilan yozilgan savollar shunday), shuning uchun faqat
    # aniq qoldiq belgilari tekshiriladi.
    if text and not _ENDS_OK.search(text):
        tail = text.split()[-1] if text.split() else ""
        if _CUT.search(text) or (len(tail) <= 2 and not tail.isdigit()):
            out.append("matn so'z o'rtasida kesilgan")
    return out


def review_flags(q: dict) -> list[str]:
    """Odam ko'rishi kerak bo'lgan shubhalar (avtomatik o'chirilmaydi)."""
    text = str(q.get("text") or "").strip()
    opts = [str(o) for o in (q.get("options") or [])]
    ans = str(q.get("correctAnswer") or "")
    out: list[str] = []

    if text and not _ENDS_OK.search(text):
        out.append("matn tinish belgisi bilan tugamagan")
    for i in range(len(opts)):
        for j in range(i + 1, len(opts)):
            s = option_similarity(opts[i], opts[j])
            if s >= SIM_REVIEW and not _meaning_differs(opts[i], opts[j]):
                qayer = "kalit bilan" if ans in (opts[i], opts[j]) else "ikki chalg'ituvchi"
                out.append("%s juda o'xshash variant (%.0f%%)" % (qayer, s * 100))
                return out
    return out


# ------------------------------------------------------ USMLE darajasi --

# Yoshni ko'rsatuvchi shakllar. Chaqaloq savollarida yosh boshqacha aytiladi
# ("hayotining 3-kunida", "36-soatida", "2-sutka", "34 haftalik muddatda") —
# ilgari bu shakllar tanilmagani uchun neonatologiya savollari klinik holat
# bayoniga ega bo'lsa ham ball yo'qotardi.
_AGE = re.compile(
    r"(\b\d{1,3}\s*(yosh|yoshli|-yosh|yoshda|kunlik|kunida|kunlar|haftalik|haftada|"
    r"oylik|oylarda|soatida|soatlik|sutka|daqiqasida|лет|года|year[- ]old)"
    r"|hayotining\s+\d{1,3}|muddatida tug'ilgan|chala tug'ilgan|yangi tug'ilgan)",
    re.IGNORECASE)
_SEX = re.compile(r"(erkak|ayol|o'g'il|qiz|bola|chaqaloq|bemor|мужчина|женщина|"
                  r"male|female)", re.IGNORECASE)
_FINDINGS = re.compile(
    r"(qon bosimi|puls|harorat|nafas|mm sim|mmhg|°c|laborator|tahlil|mri|\bkt\b|ktsi|"
    r"rentgen|ekg|exo|uzi|usm|leykotsit|gemoglobin|kreatinin|troponin|bilirubin|"
    r"auskultatsiya|palpatsiya|ko'rikda|tekshiruvda|g/l|mmol|ml/min|"
    # Neonatologiya va laboratoriya ko'rsatkichlari
    r"apgar|bilirubin|gematokrit|saturatsiya|gestatsion|surfaktant|\bph\b|"
    r"mkmol|retikulotsit|trombotsit|crp|ekma|x10\^9|persentil)",
    re.IGNORECASE)
_BEST_STEM = re.compile(
    r"(eng ehtimolli|eng to'g'ri|keyingi qadam|keyingi bosqich|eng yaxshi|"
    r"birinchi navbatda|eng mos|eng samarali|optimal taktika|qaysi biri eng|"
    r"dastlabki tashxis|dastlabki tekshiruv|taktika qanday|to'g'ri qaror|"
    r"most likely|next step|best initial)",
    re.IGNORECASE)
_RECALL = re.compile(
    r"(nima deb ataladi|qanday nomlanadi|kim tomonidan|qaysi yilda|ta'rifi|"
    r"klassifikatsiyasi bo'yicha|sinonimi|nechta turi)",
    re.IGNORECASE)


def usmle_score(q: dict) -> int:
    """USMLE uslubiga moslik balli, 0..12. Katta ball = qiyin va himoyalangan."""
    text = str(q.get("text") or "")
    opts = [str(o) for o in (q.get("options") or [])]
    ans = str(q.get("correctAnswer") or "")
    score = 0

    # Klinik holat bayoni — USMLE savolining o'zagi.
    if _AGE.search(text):
        score += 2
    if _SEX.search(text):
        score += 1
    if _FINDINGS.search(text):
        score += 2
    # Uzun matn: ma'lumotni saralash talab qiladi.
    n = len(text)
    if n >= 700:
        score += 3
    elif n >= 450:
        score += 2
    elif n >= 300:
        score += 1
    elif n < 160:
        score -= 2

    if _BEST_STEM.search(text):
        score += 2
    if _RECALL.search(text):
        score -= 2

    if len(opts) >= 5:
        score += 1
    lens = [len(o) for o in opts if o]
    if lens and min(lens) > 0:
        if max(lens) / min(lens) <= 1.6:
            score += 1
        elif max(lens) / min(lens) > 2.5:
            score -= 1
    others = [len(o) for o in opts if o != ans]
    if others and ans and len(ans) > max(others) * 1.4:
        score -= 2  # javob uzunligiga qarab topiladi

    return max(0, min(12, score))
