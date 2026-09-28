"""Har bir savolga sarflangan vaqt: kiruvchi ma'lumotni tozalash va tahlil.

Frontend har savol uchun yuboradi: {"<savol id>": {"ms": ko'rilgan jami ms,
"first": birinchi javobgacha ms yoki null, "changes": javob o'zgartirish soni}}.
Ma'lumot talaba brauzeridan kelgani uchun qat'iy tozalanadi (hajm, tur, chegara).
Tahlil avtomatik jazo EMAS — admin hisobotida "shubhali" belgisi uchun.
"""
from __future__ import annotations

MAX_MS = 3 * 3600 * 1000
MAX_KEYS = 200


def _int(value, hi: int):
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return None
    return max(0, min(hi, n))


def clean_timings(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for key, val in list(raw.items())[:MAX_KEYS]:
        k = str(key)[:12]
        if not k.isdigit() or not isinstance(val, dict):
            continue
        ms = _int(val.get("ms"), MAX_MS)
        if ms is None:
            continue
        first = val.get("first")
        first = _int(first, MAX_MS) if first is not None else None
        row = {"ms": ms, "first": first, "changes": _int(val.get("changes"), 1000) or 0}
        # Javobdan oldin chetga qarash (klient o'lchovi, v2):
        #   glance — birinchi javobdan oldingi 3 s da kamida 0.7 s chetga qaragan;
        #   gdir   — o'sha qarash yo'nalishi (L/R);
        #   side   — savol ko'rsatilgan vaqtdagi jami chetga qarash (ms);
        #   eps    — savol davomidagi chetga qarashlar soni (0.7 s dan uzun).
        if val.get("glance") in (1, "1", True):
            row["glance"] = 1
            if str(val.get("gdir") or "") in ("L", "R"):
                row["gdir"] = str(val.get("gdir"))
        side = _int(val.get("side"), MAX_MS) if val.get("side") is not None else None
        if side:
            row["side"] = min(side, ms) if ms else side
        eps = _int(val.get("eps"), 10000) if val.get("eps") is not None else None
        if eps:
            row["eps"] = eps
        out[k] = row
    return out


def quick_correct(questions: list, answers: dict, timings: dict, *,
                  min_len: int = 200, max_ms: int = 8000) -> tuple[int, int]:
    """(uzun klinik savolga max_ms dan tez TO'G'RI javoblar soni, jami uzun savollar)."""
    n_long = quick = 0
    for q in questions or []:
        if len(str(q.get("text") or "")) < min_len:
            continue
        n_long += 1
        t = (timings or {}).get(str(q.get("id"))) or {}
        first = t.get("first")
        a = (answers or {}).get(str(q.get("id")))
        if (first is not None and first <= max_ms and a is not None
                and str(a).strip() == str(q.get("correctAnswer") or "").strip()):
            quick += 1
    return quick, n_long


def gaze_answer_pattern(timings: dict) -> tuple[int, int]:
    """(javobdan oldin chetga qaralgan savollar soni, javob berilgan savollar soni).

    Kadrdan tashqaridagi odam ekranni ko'rib, imo-ishora bilan javob ko'rsatsa,
    topshiruvchi deyarli har savolda javobni belgilashdan oldin o'sha tomonga
    qaraydi. Bir-ikki marta — tabiiy; ko'pchilik savolda — naqsh.
    """
    answered = glance = 0
    for v in (timings or {}).values():
        if not isinstance(v, dict) or v.get("first") is None:
            continue
        answered += 1
        if v.get("glance"):
            glance += 1
    return glance, answered


#: Javobgacha oynasi (klient bilan bir xil).
GLANCE_WINDOW_MS = 3000


def gaze_answer_assessment(timings: dict) -> dict:
    """Javobdan oldin chetga qarash naqshi — talabaning o'z odati bilan solishtirib.

    Tasodifan javobdan oldingi 3 s oynaga chetga qarash tushish ehtimoli:
        expected ~= min(1, episodes_per_ms * 3000 + side_ms / total_ms)
    Naqsh: haqiqiy ulush >= 60%, kutilganidan kamida 35 punkt yuqori, kamida
    5 ta holat va javob oldidan qarashlarning >= 75% i BIR tomonga.
    Doim chetga qaraydigan (kamera yonda, odat) talaba shu tariqa jazolanmaydi.
    """
    answered = glance = 0
    total_ms = side_ms = eps = 0
    dirs = {"L": 0, "R": 0}
    for v in (timings or {}).values():
        if not isinstance(v, dict):
            continue
        total_ms += int(v.get("ms") or 0)
        side_ms += int(v.get("side") or 0)
        eps += int(v.get("eps") or 0)
        if v.get("first") is None:
            continue
        answered += 1
        if v.get("glance"):
            glance += 1
            d = str(v.get("gdir") or "")
            if d in dirs:
                dirs[d] += 1
    rate = glance / answered if answered else 0.0
    if total_ms > 0:
        expected = min(1.0, eps / total_ms * GLANCE_WINDOW_MS + side_ms / total_ms)
    else:
        expected = 0.0
    with_dir = dirs["L"] + dirs["R"]
    same_side = (max(dirs.values()) / with_dir) if with_dir else 0.0
    # Eski klient (yo'nalish/baseline yubormagan) — faqat qat'iy ulush bo'yicha.
    legacy = with_dir == 0 and eps == 0 and side_ms == 0
    suspicious = bool(
        answered >= 8
        and glance >= 5
        and rate >= 0.6
        and (legacy and rate >= 0.8 or (not legacy and rate - expected >= 0.35 and same_side >= 0.75))
    )
    return {
        "glance": glance,
        "answered": answered,
        "rate": round(rate, 2),
        "expected": round(expected, 2),
        "same_side": round(same_side, 2),
        "side": "L" if dirs["L"] >= dirs["R"] else "R",
        "suspicious": suspicious,
        "legacy": legacy,
    }
