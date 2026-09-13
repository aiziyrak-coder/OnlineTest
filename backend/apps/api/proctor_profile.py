"""Nazorat profili — imtihon toifasiga qarab YUMSHATISH.

NEGA KERAK (2026-09-10, Maxmudov A.I.): maxsus kirish imtihonida nomzod
3 ta urinishni birorta ham savolga javob bermay yo'qotdi:

  * 07:00 va 07:11 — "qo'l harakati" ikki marta -> ikkala urinish ketdi;
  * 07:21:52 — boshlanishiga 35 soniya bo'lganda "kitob" -> darhol ban.

Qo'l harakati — o'ylanayotgan, charchagan, yuzini ushlagan odamning
tabiiy holati. Kitob aniqlagichi esa stoldagi qog'oz yoki hujjatni ham
"kitob" deb oladi. Bitta odamning taqdirini hal qiladigan imtihonda
bunday soxta signal bilan chetlatish adolatsiz.

MUHIM: bu faqat YUMSHATISH, o'chirish emas. Telefon, shaxs almashtirish,
masofaviy boshqaruv, pichirlash va gapirish to'liq kuchda qoladi.

Qoidalar matni (`vac_rules`) ham SHU moduldan o'qiydi — nomzodga
ko'rsatilgan qoidalar bilan tizimning haqiqiy xatti-harakati bir xil
bo'lishi shart (yuridik talab).
"""
from __future__ import annotations

import os

#: Jazolanmaydigan qo'shimcha turlar.
RELAXED_IGNORED = frozenset(
    {
        # Qo'lni qimirlatish, yuzni ushlash — tabiiy holat.
        "HAND_GESTURE_SUSPECTED",
        # Uydagi shovqin (televizor, ko'cha) — chiterlik emas.
        "SUSPICIOUS_AUDIO",
    }
)

#: DARHOL to'xtatish o'rniga oddiy ogohlantirish beradigan turlar.
RELAXED_NO_INSTANT = frozenset(
    {
        # Aniqlagich qog'oz va hujjatni ham "kitob" deb oladi.
        "FORBIDDEN_OBJECT_BOOK",
    }
)

#: Ogohlantirishlar chegarasi (umumiy 2 o'rniga).
RELAXED_MAX_WARNINGS = 3

#: Xavf ballari chegarasi (umumiy 12 o'rniga).
RELAXED_HARD_MAX_POINTS = 20


def relaxed_audiences() -> set[str]:
    raw = os.environ.get("PROCTOR_RELAXED_AUDIENCES", "entrant")
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def relaxed_profile(exam) -> dict | None:
    """Imtihon yumshatilgan toifadami — bo'lsa sozlamalarni qaytaradi."""
    aud = str(getattr(exam, "audience", "") or "").strip().lower()
    if not aud or aud not in relaxed_audiences():
        return None
    return {
        "ignored": RELAXED_IGNORED,
        "no_instant": RELAXED_NO_INSTANT,
        "max_warnings": RELAXED_MAX_WARNINGS,
        "hard_max_points": RELAXED_HARD_MAX_POINTS,
    }


# --- Ovozga asoslangan gumonlar (admin qarori, 11.09.2026) -------------------
# Ovoz YOZIB OLINMAYDI — "pichirlash/gaplashish" dasturning taxmini, keyin
# isbotlab bo'lmaydi; konditsioner, ko'cha shovqini, odamning o'zi savolni
# sekin o'qishi ham shunday signal berishi mumkin. Bir martalik imtihonda
# faqat shunga asoslanib chetlatish yuridik jihatdan zaif. Shuning uchun:
#   * yolg'iz ovoz signali — talabaga ogohlantirish, qayd, admin ko'rib chiqadi;
#   * so'nggi 2 daqiqada KAMERADA ko'rinadigan dalil ham bo'lsa — odatdagi
#     ogohlantirish/chetlatish oqimi.
AUDIO_CORROBORATING_TYPES = frozenset({
    "MULTIPLE_FACES",
    "FACE_TURNED_AWAY",
    "FACE_NOT_VISIBLE",
    "GAZE_AWAY_LEFT",
    "GAZE_AWAY_RIGHT",
    "MOUTH_MOVEMENT_TALKING",
    "FORBIDDEN_OBJECT_CELL_PHONE",
    "FORBIDDEN_OBJECT_LAPTOP",
    "FORBIDDEN_OBJECT_BOOK",
})
AUDIO_CORROBORATION_WINDOW_SECONDS = 120


def audio_review_types() -> frozenset:
    raw = os.environ.get(
        "PROCTOR_AUDIO_REVIEW_ONLY", "WHISPER_OR_CONVERSATION_SUSPECTED,SUSPICIOUS_AUDIO"
    )
    return frozenset(x.strip().upper() for x in str(raw).split(",") if x.strip())


# --- Faqat qayd + admin ko'rib chiqadigan turlar (jazo emas) -------------------
def review_only_types() -> frozenset:
    raw = os.environ.get("PROCTOR_REVIEW_ONLY_TYPES", "BROWSER_EXTENSION_SUSPECTED")
    return frozenset(x.strip().upper() for x in str(raw).split(",") if x.strip())


def secure_text_enabled(exam, user_id: str = "") -> bool:
    """Savol matnini <canvas> ga chizish yoqilganmi (toifa yoki sinov foydalanuvchisi)."""
    aud = {x.strip().lower() for x in os.environ.get("SECURE_QUESTION_RENDER_AUDIENCES", "").split(",") if x.strip()}
    users = {x.strip() for x in os.environ.get("SECURE_QUESTION_RENDER_USERS", "").split(",") if x.strip()}
    return str(getattr(exam, "audience", "") or "").strip().lower() in aud or str(user_id) in users


def screen_share_required(exam, user_id: str = "") -> bool:
    """Butun ekranni ulashish talab qilinadimi (toifa yoki sinov foydalanuvchisi).

    Standart — O'CHIQ. SCREEN_SHARE_AUDIENCES=ordinator,... yoki
    SCREEN_SHARE_USERS=<login>,... bilan yoqiladi.
    """
    aud = {x.strip().lower() for x in os.environ.get("SCREEN_SHARE_AUDIENCES", "").split(",") if x.strip()}
    users = {x.strip() for x in os.environ.get("SCREEN_SHARE_USERS", "").split(",") if x.strip()}
    return str(getattr(exam, "audience", "") or "").strip().lower() in aud or str(user_id) in users
