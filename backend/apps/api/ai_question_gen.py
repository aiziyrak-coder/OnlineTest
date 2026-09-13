"""Bankdagi savollarga o'xshash, lekin QIYINROQ savollarni AI yaratadi.

NIMA UCHUN KERAK: ordinatura savol banki talabalar orasida tarqalib ketgan —
ular savollarni yodlab olishlari mumkin. Shuning uchun imtihonning bir qismi
har bir topshiruvchi uchun AYNI PAYTDA yaratiladi: mavzu o'sha, savol yangi.

QOIDALAR:
  * namunadagi savol so'zma-so'z takrorlanmaydi;
  * klinik holat (vignette) uslubi — bir bosqich chuqurroq mulohaza talab
    qiladi (tashxis emas, keyingi qadam / mexanizm / farqlash);
  * 5 ta ishonarli chalg'ituvchi variant, bittasi to'g'ri;
  * javob savol matnida so'zma-so'z turmaydi;
  * har chaqiruvda boshqa savollar (temperature yuqori).

AI ishlamasa imtihon TO'XTAMAYDI — chaqiruvchi bankdan to'ldiradi.
"""
from __future__ import annotations

import json
import logging
import os
import random
import re
import time
import unicodedata

logger = logging.getLogger(__name__)

#: Bitta imtihon uchun AI ga ajratilgan eng ko'p vaqt (sekund).
AI_TIME_BUDGET = max(30, int(os.environ.get("AI_QUESTION_TIME_BUDGET", "110")))
#: Bitta so'rovda so'raladigan eng ko'p savol.
MAX_PER_CALL = 15

_LANG = {"uz": "O'zbek", "ru": "Rus", "en": "Ingliz"}


def _exam_model() -> str:
    """Imtihon savollari uchun model (sozlanmagan bo'lsa — standart)."""
    from django.conf import settings

    return str(getattr(settings, "OPENAI_EXAM_MODEL", "") or "").strip()


def _norm(v) -> str:
    s = unicodedata.normalize("NFKD", str(v or "")).lower()
    s = s.replace("‘", "'").replace("’", "'")
    return re.sub(r"[^0-9a-zа-яё]+", "", s)


#: Kirish (tanlov) imtihoni uchun qo'shimcha talablar. Oddiy "qiyinroq"
#: daraja bitiruv imtihoniga mo'ljallangan; tanlovda esa kuchli nomzod
#: ham qiynalishi kerak, aks holda imtihon saralamaydi.
#: Talab qilinayotgan darajaning NAMUNASI. Qoidalar ro'yxati o'zi
#: yetarli bo'lmadi — model uslubni misoldan ancha aniq oladi.
_EXTREME_EXAMPLE = (
    "\n\nMANA SHU DARAJADA yozishing kerak. NAMUNA (yaxshi):\n"
    '{"text":"34 yoshli ayol 3 kundan beri davom etayotgan hansirash va '
    "o'ng oyoq boldirida shish bilan keldi. 10 kun oldin sezaryen "
    "operatsiyasi qilingan. AB 105/70, puls 112, SpO2 92%. D-dimer "
    "yuqori, ko'krak qafasi rentgenida o'zgarish yo'q, EKGda sinus "
    "taxikardiyasi. Kreatinin 168 mkmol/l (operatsiyadan oldin 74 edi). "
    'Keyingi eng to\'g\'ri qadam qaysi?",'
    '"options":['
    '"KT-angiopulmonografiya o\'tkazish",'
    '"Oyoq venalari kompression ultratovush tekshiruvi",'
    '"Ventilyatsiya-perfuziya sintigrafiyasi",'
    '"Darhol trombolitik terapiya boshlash",'
    '"Takroriy D-dimer va kuzatuv"],'
    '"correctAnswer":"Oyoq venalari kompression ultratovush tekshiruvi"}\n'
    "NEGA QIYIN: KT-angiografiya odatdagi tanlov, lekin kreatinin keskin "
    "oshgan (kontrast nefropatiyasi xavfi) — shuning uchun avval "
    "kontrastsiz, boldirdagi shish esa chuqur vena trombozini ko'rsatadi "
    "va ijobiy natija KT'siz ham davolashni boshlashga asos bo'ladi. "
    "Trombolitik esa bemor gemodinamik barqaror bo'lgani uchun "
    "ko'rsatilmagan. Har bir variant O'Z O'RNIDA to'g'ri — tanlash "
    "uchun buyrak funksiyasini klinika bilan solishtirish kerak.\n\n"
    "YOMON NAMUNA (bunday YOZMA):\n"
    '{"text":"Paratsetamolni yuqori dozada ichgan bemorda AST/ALT '
    'oshgan. Davolash?","options":["Atsetilsistein","Uzum sharbati",'
    '"Kortikosteroid","Parhez","Gepatoprotektor"]}\n'
    "NEGA YOMON: bu bitta faktni yodlash; \"uzum sharbati\" kabi bema'ni "
    "variant javobni o'z-o'zidan ochib beradi; klinik mulohaza talab "
    "etilmaydi.\n"
)

_EXTREME_RULES = (
    "\n\nQO'SHIMCHA — BU TANLOV IMTIHONI, ENG YUQORI QIYINLIK:\n"
    "8. Holat ATIPIK yoki chalg'ituvchi bo'lsin: klassik ko'rinish emas, "
    "belgilar bir necha kasallikka mos keladi.\n"
    "9. Javob uchun KAMIDA IKKI bosqichli mulohaza shart bo'lsin — avval "
    "holatni to'g'ri talqin qilish, keyin undan taktik xulosa chiqarish.\n"
    "10. Laborator yoki instrumental natijani klinik manzara bilan "
    "SOLISHTIRISH talab etilsin (faqat bittasiga qarab javob berib "
    "bo'lmasin).\n"
    "11. Chalg'ituvchi variantlar BOSHQA vaziyatda to'g'ri bo'ladigan "
    "javoblar bo'lsin — darslikdan yodlagan odam aynan shularni tanlaydi.\n"
    "12. Qarshi ko'rsatmalar, dori o'zaro ta'siri, asorat xavfi yoki "
    "navbat (qaysi tekshiruv/muolaja AVVAL) kabi nozik jihatlarni "
    "sinovdan o'tkaz.\n"
    "13. Mo'ljal: mavzuni yaxshi biladigan nomzod ham 100% emas, taxminan "
    "yarmini to'g'ri yechsin. Ammo savol HALOL bo'lsin — javob berilgan "
    "ma'lumotdan mantiqan kelib chiqsin, tasodifiy yoki hiyla bo'lmasin.\n"
    "14. HAR BIR savolga `distractor_rationale` maydonini yoz: to'rtta "
    "noto'g'ri variantning HAR BIRI nega ishonarli ekanini bir jumlada "
    "asosla (qaysi vaziyatda u to'g'ri bo'lardi). Agar asoslay olmasang, "
    "u variant bema'ni — uni almashtir. Izoh QISQA bo'lsin: har variantga "
    "6-12 so'z, jami 150-350 belgi.\n"
    "15. Savol matni kamida 250 belgi bo'lsin.\n"
)


# Ordinator attestatsiyasi: haqiqiy BILIMNI tekshiradi, lekin "o'tib bo'lmas"
# tanlov darajasi (extreme) emas. Mo'ljal — yaxshi tayyorlangan ordinator
# 60-70% ini yechadi; yuzaki yodlagan yoki ko'chirgan odam esa qiynaladi.
_CLINICAL_RULES = (
    "\n\nQO'SHIMCHA — ORDINATORNING HAQIQIY BILIMINI TEKSHIRISH:\n"
    "8. Javob uchun KAMIDA IKKI bosqichli mulohaza shart bo'lsin — avval "
    "holatni to'g'ri talqin qilish, keyin undan amaliy xulosa chiqarish.\n"
    "9. Laborator yoki instrumental natijani klinik manzara bilan "
    "SOLISHTIRISH talab etilsin (faqat bitta belgiga qarab javob topilmasin).\n"
    "10. Chalg'ituvchi variantlar BOSHQA vaziyatda to'g'ri bo'ladigan "
    "javoblar bo'lsin — yuzaki yodlagan odam aynan shularni tanlaydi.\n"
    "11. Qarshi ko'rsatmalar, asorat xavfi, navbat (qaysi tekshiruv yoki "
    "muolaja AVVAL), doza kabi amaliy jihatlarni sinovdan o'tkaz.\n"
    "12. Mo'ljal: mavzuni yaxshi biladigan ordinator taxminan 60-70% ini "
    "yechsin. Savol HALOL bo'lsin — javob berilgan ma'lumotdan mantiqan "
    "kelib chiqsin; hiyla, noaniqlik yoki juda kam uchraydigan ekzotik "
    "holat bo'lmasin.\n"
    "13. HAR BIR savolga `distractor_rationale` yoz: har bir noto'g'ri "
    "variant nega ishonarli ekanini qisqa asosla. Asoslay olmasang — "
    "u variant bema'ni, uni almashtir. Har variantga 6-12 so'z, jami "
    "120-300 belgi.\n"
    "14. Savol matni kamida 220 belgi.\n"
)


def _prompt(
    samples: list[dict],
    count: int,
    language: str,
    subject: str,
    difficulty: str = "hard",
) -> str:
    lang_name = _LANG.get(language, "O'zbek")
    block = json.dumps(
        [
            {"text": s.get("text", "")[:600],
             "options": [str(o)[:200] for o in (s.get("options") or [])]}
            for s in samples
        ],
        ensure_ascii=False,
    )
    # TOKEN TEJASH: o'zgarmas ko'rsatmalar (qoidalar, namuna, format) BOSHIDA,
    # har topshiruvchida o'zgaradigan qism (namuna savollar, fan, til) OXIRIDA.
    # OpenAI bir xil boshlanishni (>=1024 token) keshlaydi — shu qism ikkinchi
    # topshiruvchidan boshlab yarim narxda va tezroq ishlanadi. Mazmun o'sha.
    static = (
        "Sen tibbiyot instituti ordinatura bitiruv imtihoni uchun test tuzuvchi "
        "mutaxassissan. Namuna savollar, vazifa, fan va til ushbu ko'rsatmaning "
        "OXIRIDA berilgan.\n\n"
        "QAT'IY TALABLAR:\n"
        "0. FAQAT oxirida ko'rsatilgan fan (yo'nalish) doirasida yoz: namunalardagi "
        "mavzular va shu yo'nalishning ordinatura dasturidan chiqma, boshqa "
        "mutaxassislikka oid savol YOZMA.\n"
        "1. Namunadagi savollarni TAKRORLAMA — yangi klinik holat o'ylab top.\n"
        "2. Namunalardan SEZILARLI QIYINROQ bo'lsin: oddiy ta'rif yoki "
        "yodlab olinadigan fakt emas. Klinik holat berilib, quyidagilardan "
        "biri so'ralsin: eng to'g'ri KEYINGI QADAM, patogenez MEXANIZMI, "
        "ikki o'xshash holatni QIYOSIY tashxis qilish, laborator/instrumental "
        "natijani izohlash yoki noto'g'ri taktikaning oqibati. Javob uchun "
        "bir necha bosqichli mulohaza kerak bo'lsin.\n"
        "3. Har savolda AYNAN 5 ta variant, faqat BITTASI to'g'ri.\n"
        "4. Chalg'ituvchi variantlar JUDA ishonarli bo'lsin — o'sha sohaning "
        "haqiqiy javoblari, ular ham shu holatga qisman to'g'ri keladi, "
        "lekin bittasi eng to'g'ri. Aniq bema'ni variant yozma: bilimsiz "
        "odam taxmin qilib topa olmasin.\n"
        "5. To'g'ri javob savol matnida so'zma-so'z takrorlanmasin.\n"
        "6. Variantlar uzunligi bir-biriga yaqin bo'lsin (uzunligi bo'yicha "
        "javobni topib bo'lmasin).\n"
        "7. Savol matni kamida 200 belgi — bemor yoshi, shikoyati, anamnezi, "
        "ko'rik va tekshiruv natijalari bilan to'liq klinik holat.\n\n"
        + (
            _EXTREME_RULES + _EXTREME_EXAMPLE
            if difficulty == "extreme"
            else (_CLINICAL_RULES + _EXTREME_EXAMPLE if difficulty == "clinical" else "")
        )
        + "\nJAVOB FORMATI — faqat JSON massiv, boshqa hech narsa:\n"
        + (
            '[{"text":"...","options":["...","...","...","...","..."],'
            '"correctAnswer":"...","distractor_rationale":"..."}]'
            if difficulty in ("extreme", "clinical")
            else '[{"text":"...","options":["...","...","...","...","..."],'
            '"correctAnswer":"..."}]'
        )
    )
    tail = (
        "\n\n=== VAZIFA ===\n"
        "QUYIDAGI NAMUNA SAVOLLAR mavzusi va darajasini o'rgan:\n"
        f"{block}\n\n"
        f"VAZIFA: shu mavzular bo'yicha {count} ta YANGI test savoli yoz.\n"
        f"Fan: {subject} (FAQAT «{subject}» yo'nalishi doirasida)\n"
        f"Til: {lang_name} (savol ham, variantlar ham shu tilda)\n"
        "Javob — faqat yuqoridagi formatdagi JSON massiv.\n"
    )
    return static + tail


def _parse(raw: str) -> list[dict]:
    from apps.api.gemini_tools import _extract_json_array_from_model_text

    arr = _extract_json_array_from_model_text(raw)
    out: list[dict] = []
    for q in arr:
        if not isinstance(q, dict):
            continue
        text = str(q.get("text") or "").strip()
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        ans = str(q.get("correctAnswer") or "").strip()
        if not text or len(opts) < 4 or not ans:
            continue
        if ans not in opts:
            continue
        row = {"text": text, "options": opts, "correctAnswer": ans}
        # Sifat nazorati uchun — `_acceptable` shu maydonga qaraydi,
        # bankka saqlashdan oldin olib tashlanadi.
        _why = str(q.get("distractor_rationale") or "").strip()
        if _why:
            row["distractor_rationale"] = _why
        out.append(row)
    return out


def _acceptable(q: dict, seen: set[str], difficulty: str = "hard") -> bool:
    """Sifat filtri — oson yoki takroriy savolni o'tkazmaydi."""
    text, opts, ans = q["text"], q["options"], q["correctAnswer"]
    # Tanlov imtihonida qisqa savol = klinik holat yo'q = oson savol.
    if len(text) < (250 if difficulty == "extreme" else 220 if difficulty == "clinical" else 150):
        return False
    if difficulty in ("extreme", "clinical"):
        # Model chalg'ituvchilarni asoslay olmagan bo'lsa, ular bema'ni
        # bo'lishi ehtimoli yuqori — bunday savol o'tkazilmaydi.
        if len(str(q.get("distractor_rationale") or "")) < (80 if difficulty == "extreme" else 60):
            return False
    key = _norm(text)[:180]
    if not key or key in seen:
        return False
    norm_opts = [_norm(o) for o in opts]
    if len(set(norm_opts)) != len(norm_opts):
        return False
    na = _norm(ans)
    if len(na) >= 8 and na in _norm(text):
        return False
    # javob boshqa variantlardan sezilarli uzun bo'lsa — taxmin qilish oson
    others = [len(o) for o in opts if o != ans]
    if others and len(ans) > max(others) * 1.6:
        return False
    if len(opts) < 5:
        return False
    return True


_VERIFY_PROMPT = (
    "Sen tibbiyot imtihoni savollarini TEKSHIRUVCHI mutaxassissan. "
    "Quyidagi test savolini baholaysan. Savolni kim yozganini bilmaysan "
    "va uni himoya qilishing shart emas — vazifang xatoni topish.\n\n"
    "SAVOL:\n{q}\n\n"
    "BELGILANGAN JAVOB: {a}\n\n"
    "Quyidagilarni tekshir:\n"
    "1. Belgilangan javob berilgan ma'lumot asosida YAGONA eng to'g'ri "
    "variantmi? Boshqa variant ham xuddi shunday yoki ko'proq to'g'ri "
    "bo'lsa — YO'Q.\n"
    "2. Savol nima so'rayotgani bilan variantlar TURI mos keladimi? "
    "(masalan 'mexanizm' so'ralib, qo'zg'atuvchilar berilgan bo'lsa — "
    "mos emas)\n"
    "3. Javob berilgan ma'lumotdan MANTIQAN kelib chiqadimi, yoki "
    "yetishmayotgan ma'lumot kerakmi?\n"
    "4. Zamonaviy klinik amaliyotga zid emasmi?\n"
    "5. Variantlardan birortasi aniq bema'ni yoki umuman boshqa sohadan "
    "(masalan, yurak xurujida qandli diabet dorisi) bo'lib, javobni "
    "o'z-o'zidan ochib qo'ymaydimi? Ochib qo'ysa — YO'Q.\n"
    "6. Savol klinik mulohazasiz bitta faktni yodlashni so'ramaydimi? "
    "So'rasa — YO'Q.\n"
    "7. Savol «{s}» yo'nalishiga tegishlimi? Tegishli bo'lmasa — YO'Q.\n\n"
    "Faqat JSON qaytar, boshqa hech narsa:\n"
    '{{"ok": true/false, "reason": "qisqa sabab"}}'
)


def verify_question(q: dict, subject: str = "") -> tuple[bool, str]:
    """Savolni MUSTAQIL tekshiradi: kalit haqiqatan to'g'rimi.

    `(ok, sabab)` qaytaradi. Tekshiruv o'zi yiqilsa `(True, "")` —
    tekshira olmaslik savolni rad etish uchun asos emas, aks holda
    OpenAI uzilganda butun bank yo'qolardi.
    """
    import json as _json

    from apps.api.openai_client import chat_text

    body = "%s\nVariantlar:\n%s" % (
        str(q.get("text") or ""),
        "\n".join("- %s" % o for o in (q.get("options") or [])),
    )
    try:
        raw = chat_text(
            _VERIFY_PROMPT.format(
                q=body, a=str(q.get("correctAnswer") or ""), s=str(subject or "tibbiyot")
            ),
            temperature=0.0,          # tekshiruv barqaror bo'lsin
            model=_exam_model(),
        )
    except Exception as ex:  # noqa: BLE001
        logger.warning("verify: so'rov yiqildi: %s", str(ex)[:140])
        return True, ""
    try:
        txt = raw.strip()
        i, j = txt.find("{"), txt.rfind("}")
        data = _json.loads(txt[i:j + 1]) if i >= 0 and j > i else {}
    except Exception:  # noqa: BLE001
        return True, ""
    ok = bool(data.get("ok"))
    return ok, str(data.get("reason") or "")[:200]


def generate_harder_similar(
    samples: list[dict],
    count: int,
    *,
    difficulty: str = "hard",
    language: str = "uz",
    subject: str = "",
    avoid_texts: set[str] | None = None,
) -> list[dict]:
    """Namunalarga o'xshash, undan qiyinroq `count` ta savol yaratadi.

    Xato bo'lsa yoki yetarli savol chiqmasa — nechta chiqqan bo'lsa shuncha
    qaytaradi (bo'sh ro'yxat ham bo'lishi mumkin). Imtihonni hech qachon
    to'xtatmaydi.
    """
    from apps.api.openai_client import api_key_configured, chat_text

    if count <= 0 or not samples:
        return []
    if not api_key_configured():
        logger.warning("ai_gen: OPENAI_API_KEY sozlanmagan")
        return []

    seen = set(avoid_texts or ())
    out: list[dict] = []
    started = time.monotonic()
    attempt = 0

    while len(out) < count and attempt < 3:
        attempt += 1
        if time.monotonic() - started > AI_TIME_BUDGET:
            logger.warning("ai_gen: vaqt chegarasi, %d/%d savol", len(out), count)
            break
        need = min(MAX_PER_CALL, (count - len(out)) + 3)  # zaxira bilan
        picked = random.sample(samples, min(4, len(samples)))
        try:
            raw = chat_text(
                _prompt(
                    picked, need, language, subject or "tibbiyot", difficulty,
                ),
                temperature=0.9,          # har topshiruvchida boshqa savollar
                model=_exam_model(),
                # Uzun javob: SDK 90 s da uzib, o'zi qayta yuborsa, tugagan
                # javob uchun ham to'lanadi. Qayta urinishni shu tsikl boshqaradi.
                timeout=float(os.environ.get("AI_GEN_TIMEOUT_SECONDS", "150")),
                max_retries=0,
                prompt_cache_key="fjsti-qgen-%s" % difficulty,
            )
            got = _parse(raw)
        except Exception as ex:
            logger.warning("ai_gen: urinish %d yiqildi: %s", attempt, str(ex)[:180])
            continue
        added = 0
        for q in got:
            if len(out) >= count:
                break
            if not _acceptable(q, seen, difficulty):
                continue
            seen.add(_norm(q["text"])[:180])
            q.pop("distractor_rationale", None)
            q["source"] = "ai_generated"
            out.append(q)
            added += 1
        logger.info(
            "ai_gen: urinish %d — %d ta keldi, %d tasi qabul qilindi (jami %d/%d)",
            attempt, len(got), added, len(out), count,
        )
        if added == 0 and attempt >= 2:
            break
    return out[:count]


_VERIFY_BATCH_PROMPT = (
    "Sen tibbiyot imtihoni savollarini TEKSHIRUVCHI mutaxassissan. "
    "Quyida bir nechta test savoli berilgan — HAR BIRINI boshqalaridan "
    "MUSTAQIL baholaysan. Savollarni kim yozganini bilmaysan va ularni "
    "himoya qilishing shart emas — vazifang xatoni topish.\n\n"
    "Har bir savol uchun quyidagilarni tekshir:\n"
    "1. Belgilangan javob berilgan ma'lumot asosida YAGONA eng to'g'ri "
    "variantmi? Boshqa variant ham xuddi shunday yoki ko'proq to'g'ri "
    "bo'lsa — YO'Q.\n"
    "2. Savol nima so'rayotgani bilan variantlar TURI mos keladimi? "
    "(masalan 'mexanizm' so'ralib, qo'zg'atuvchilar berilgan bo'lsa — "
    "mos emas)\n"
    "3. Javob berilgan ma'lumotdan MANTIQAN kelib chiqadimi, yoki "
    "yetishmayotgan ma'lumot kerakmi?\n"
    "4. Zamonaviy klinik amaliyotga zid emasmi?\n"
    "5. Variantlardan birortasi aniq bema'ni yoki umuman boshqa sohadan "
    "(masalan, yurak xurujida qandli diabet dorisi) bo'lib, javobni "
    "o'z-o'zidan ochib qo'ymaydimi? Ochib qo'ysa — YO'Q.\n"
    "6. Savol klinik mulohazasiz bitta faktni yodlashni so'ramaydimi? "
    "So'rasa — YO'Q.\n"
    "7. Savol quyida ko'rsatilgan yo'nalishga tegishlimi? Tegishli "
    "bo'lmasa — YO'Q.\n\n"
    "Faqat JSON massiv qaytar — har savol uchun bitta element, boshqa hech narsa:\n"
    '[{"i": 1, "ok": true, "reason": "qisqa sabab"}]\n'
)


def verify_batch(questions: list[dict], subject: str = "") -> list:
    """Bir necha savolni BITTA so'rovda tekshiradi (tekshiruv qoidalari bir marta yuboriladi).

    Har savol uchun True/False; javobda topilmagan savol — None (chaqiruvchi
    uni alohida tekshiradi). So'rov o'zi yiqilsa — hammasi True (verify_question
    bilan bir xil: tekshira olmaslik rad etish uchun asos emas).
    """
    import json as _json

    from apps.api.openai_client import chat_text

    parts = ["Yo'nalish: %s\n" % (subject or "tibbiyot")]
    for n, q in enumerate(questions, 1):
        parts.append(
            "=== SAVOL %d ===\n%s\nVariantlar:\n%s\nBELGILANGAN JAVOB: %s\n"
            % (
                n,
                str(q.get("text") or ""),
                "\n".join("- %s" % o for o in (q.get("options") or [])),
                str(q.get("correctAnswer") or ""),
            )
        )
    try:
        raw = chat_text(
            _VERIFY_BATCH_PROMPT + "\n" + "\n".join(parts),
            temperature=0.0,
            model=_exam_model(),
        )
    except Exception as ex:  # noqa: BLE001
        logger.warning("verify_batch: so'rov yiqildi: %s", str(ex)[:140])
        return [True] * len(questions)
    res: list = [None] * len(questions)
    try:
        txt = (raw or "").strip()
        a, b = txt.find("["), txt.rfind("]")
        data = _json.loads(txt[a:b + 1]) if a >= 0 and b > a else []
    except Exception:  # noqa: BLE001
        data = []
    for row in data if isinstance(data, list) else []:
        try:
            i = int(row.get("i")) - 1
        except (TypeError, ValueError, AttributeError):
            continue
        if 0 <= i < len(res) and isinstance(row.get("ok"), bool):
            res[i] = row["ok"]
    return res


def verify_many(questions: list[dict], subject: str = "", workers: int = 8) -> list[bool]:
    """Bir nechta savolni PARALLEL tekshiradi (talabani kuttirmaslik uchun).

    TOKEN TEJASH: savollar AI_VERIFY_BATCH_SIZE (standart 5) tadan bitta
    so'rovga jamlanadi — uzun tekshiruv qoidalari har savolga qayta
    yuborilmaydi. AI_VERIFY_BATCH_SIZE=1 — eski tartib (har savol alohida).
    """
    from concurrent.futures import ThreadPoolExecutor

    if not questions:
        return []
    try:
        size = max(1, int(os.environ.get("AI_VERIFY_BATCH_SIZE", "5")))
    except ValueError:
        size = 5
    if size == 1:
        with ThreadPoolExecutor(max_workers=max(1, min(workers, len(questions)))) as ex:
            res = list(ex.map(lambda q: verify_question(q, subject)[0], questions))
        return [bool(x) for x in res]
    chunks = [questions[i:i + size] for i in range(0, len(questions), size)]
    with ThreadPoolExecutor(max_workers=max(1, min(workers, len(chunks)))) as ex:
        parts = list(ex.map(lambda c: verify_batch(c, subject), chunks))
    res = [x for p in parts for x in p]
    missing = [i for i, x in enumerate(res) if x is None]
    if missing:
        with ThreadPoolExecutor(max_workers=max(1, min(workers, len(missing)))) as ex:
            fb = list(ex.map(lambda i: verify_question(questions[i], subject)[0], missing))
        for i, ok in zip(missing, fb):
            res[i] = ok
    return [bool(x) for x in res]


_PARAPHRASE_PROMPT = (
    "Sen tibbiyot test savollarini QAYTA YOZUVCHI mutaxassissan. Quyidagi "
    "test savollarini qayta yoz. Maqsad: savolni oldindan yodlab olgan odam "
    "uni matnidan tanimasin, lekin MAZMUN va TO'G'RI JAVOB o'zgarmasin.\n"
    "Fan: {subject}. Til: {lang} (savol ham, variantlar ham shu tilda).\n\n"
    "QOIDALAR:\n"
    "1. Savol matnini boshqa so'zlar va boshqa jumla tuzilishi bilan yoz. "
    "Javobga ta'sir qilmaydigan tafsilotlarni (bayon tartibi, so'z tanlovi) "
    "o'zgartirishing mumkin; javobni o'zgartiradigan ma'lumotni O'ZGARTIRMA.\n"
    "2. Variantlar SONI va TARTIBI aynan saqlansin: i-variant — asl i-variantning "
    "boshqa so'zlar bilan yozilgan shakli (ma'nosi aynan bir xil).\n"
    "3. To'g'ri javob asl savoldagi bilan bir xil tartib raqamidagi variant "
    "bo'lib qoladi (correct_index o'zgarmaydi).\n"
    "4. Yangi xato qo'shma, ilmiy atama va raqamlarni to'g'ri qoldir.\n\n"
    "SAVOLLAR:\n{block}\n\n"
    "JAVOB — faqat JSON massiv, boshqa hech narsa:\n"
    '[{{"i": N, "text": "...", "options": ["...", "..."]}}]'
)


def paraphrase_questions(questions: list[dict], *, language: str = "uz", subject: str = "") -> list:
    """Bank savollarini har topshiruvchi uchun boshqa so'zlar bilan qayta yozadi.

    Natija kirish bilan bir xil uzunlikdagi ro'yxat: har element — qayta
    yozilgan savol dict (`text`, `options`, `correctAnswer`) yoki `None`
    (qayta yozish yaroqsiz — asl savol ishlatiladi). Variantlar tartibi
    saqlanadi, shuning uchun til biriktirish tahlili variant raqami bo'yicha
    ishlaydi.
    """
    import json as _json

    from apps.api.openai_client import api_key_configured, chat_text

    out: list = [None] * len(questions or [])
    if not questions or not api_key_configured():
        return out
    items = []
    for i, q in enumerate(questions):
        opts = [str(o) for o in (q.get("options") or [])]
        ca = str(q.get("correctAnswer") or "")
        if ca not in opts:
            continue
        items.append({"i": i, "text": str(q.get("text") or "")[:900], "options": opts,
                      "correct_index": opts.index(ca)})
    if not items:
        return out
    try:
        raw = chat_text(
            _PARAPHRASE_PROMPT.format(
                subject=subject or "tibbiyot",
                lang=_LANG.get(language, "O'zbek"),
                block=_json.dumps(items, ensure_ascii=False),
            ),
            temperature=0.7,
            model=_exam_model(),
        )
        txt = (raw or "").strip()
        a, b = txt.find("["), txt.rfind("]")
        data = _json.loads(txt[a:b + 1]) if a >= 0 and b > a else []
    except Exception as ex:  # noqa: BLE001
        logger.warning("paraphrase: yiqildi: %s", str(ex)[:160])
        return out
    by_i = {it["i"]: it for it in items}
    for row in data if isinstance(data, list) else []:
        try:
            i = int(row.get("i"))
        except (TypeError, ValueError, AttributeError):
            continue
        src = by_i.get(i)
        if src is None:
            continue
        text = str(row.get("text") or "").strip()
        opts = [str(o).strip() for o in (row.get("options") or [])]
        if (len(text) < 40 or len(opts) != len(src["options"]) or any(not o for o in opts)
                or len({_norm(o) for o in opts}) != len(opts) or _norm(text) == _norm(src["text"])):
            continue
        out[i] = {"text": text, "options": opts, "correctAnswer": opts[src["correct_index"]]}
    return out


# ---------------------------------------------------------------------------
# Qayta yozilgan (va tekshiruvdan o'tgan) bank savollari keshi.
#
# TOKEN TEJASH: bir bank savoli uchun PARAPHRASE_CACHE_VARIANTS (standart 3)
# ta TEKSHIRILGAN variant yig'ilgach, keyingi topshiruvchilarga shulardan
# tasodifiy biri beriladi — qayta yozish ham, qayta tekshirish ham so'ralmaydi.
# Variant yetmaguncha odatdagidek yangi yoziladi. 0 — kesh o'chiq.
# ---------------------------------------------------------------------------
_PARA_TTL = 60 * 60 * 24 * 60


def _para_target() -> int:
    try:
        return max(0, int(os.environ.get("PARAPHRASE_CACHE_VARIANTS", "3")))
    except ValueError:
        return 3


def _para_key(exam_id, language: str, q: dict) -> str:
    import hashlib

    sig = "|".join(
        [_norm(q.get("text"))] + [_norm(o) for o in (q.get("options") or [])]
        + [_norm(q.get("correctAnswer"))]
    )
    return "para_v1:%s:%s:%s" % (exam_id, language, hashlib.sha1(sig.encode("utf-8")).hexdigest())


def cached_paraphrase(exam_id, language: str, q: dict):
    """Keshda yetarli variant bo'lsa — tasodifiy tekshirilgan variant, aks holda None."""
    n = _para_target()
    if n <= 0:
        return None
    opts = [str(o) for o in (q.get("options") or [])]
    ca = str(q.get("correctAnswer") or "")
    if ca not in opts:
        return None
    try:
        from django.core.cache import cache

        variants = cache.get(_para_key(exam_id, language, q)) or []
    except Exception:  # noqa: BLE001
        return None
    good = [
        v for v in variants
        if isinstance(v, dict) and len(v.get("options") or []) == len(opts)
        and v.get("ci") == opts.index(ca) and str(v.get("text") or "").strip()
    ]
    if len(good) < n:
        return None
    v = random.choice(good)
    return {"text": v["text"], "options": list(v["options"]), "correctAnswer": v["options"][v["ci"]]}


def remember_paraphrases(exam_id, language: str, pairs) -> int:
    """Tekshiruvdan o'tgan (asl, qayta_yozilgan) juftlarni keshga qo'shadi."""
    n = _para_target()
    if n <= 0:
        return 0
    added = 0
    try:
        from django.core.cache import cache
    except Exception:  # noqa: BLE001
        return 0
    for src, pq in pairs or []:
        try:
            opts = list(pq["options"])
            ci = opts.index(pq["correctAnswer"])
            key = _para_key(exam_id, language, src)
            variants = cache.get(key) or []
            if len(variants) >= n or any(_norm(v.get("text")) == _norm(pq["text"]) for v in variants):
                continue
            variants.append({"text": pq["text"], "options": opts, "ci": ci})
            cache.set(key, variants, _PARA_TTL)
            added += 1
        except Exception:  # noqa: BLE001
            continue
    return added


def paraphrase_bank_part(exam_id, questions: list, *, language: str = "uz", subject: str = "", verify: bool = True) -> list:
    """Bank savollarini (AI yaratganidan tashqari) har topshiruvchiga boshqa so'zlar bilan beradi.

    Avval keshdagi TEKSHIRILGAN variantlar ishlatiladi; yetmaganlari bitta so'rovda
    qayta yoziladi, tekshiriladi va keshga qo'shiladi. Har qanday xatoda asl savol qoladi.
    """
    out = [dict(q) if isinstance(q, dict) else q for q in (questions or [])]
    need = []
    for i, q in enumerate(out):
        if not isinstance(q, dict) or q.get("source") == "ai_generated" or q.get("paraphrased"):
            continue
        cv = cached_paraphrase(exam_id, language, q)
        if cv:
            out[i] = {**q, "text": cv["text"], "options": cv["options"], "correctAnswer": cv["correctAnswer"], "paraphrased": True}
        else:
            need.append(i)
    if not need:
        return out
    try:
        para = paraphrase_questions([out[i] for i in need], language=language, subject=subject)
    except Exception:  # noqa: BLE001
        logger.warning("paraphrase_bank_part: qayta yozish yiqildi exam=%s", exam_id, exc_info=True)
        return out
    cands = [(need[j], pq) for j, pq in enumerate(para or []) if pq and j < len(need)]
    if cands and verify:
        try:
            oks = verify_many([pq for _, pq in cands], subject=subject)
            cands = [c for c, ok in zip(cands, oks) if ok]
        except Exception:  # noqa: BLE001
            cands = []
    if cands:
        remember_paraphrases(exam_id, language, [(out[i], pq) for i, pq in cands])
        for i, pq in cands:
            out[i] = {**out[i], "text": pq["text"], "options": pq["options"], "correctAnswer": pq["correctAnswer"], "paraphrased": True}
    return out


def paraphrase_bank_part_safe(exam_id, questions: list, *, language: str = "uz", subject: str = "", timeout: float = 45.0) -> list:
    """`paraphrase_bank_part` vaqt chegarasi bilan: ulgurmasa asl savollar (imtihon kutib qolmasin)."""
    from concurrent.futures import ThreadPoolExecutor
    from concurrent.futures import TimeoutError as _FutTimeout

    ex = ThreadPoolExecutor(max_workers=1)
    fut = ex.submit(paraphrase_bank_part, exam_id, questions, language=language, subject=subject)
    try:
        return fut.result(timeout=timeout)
    except _FutTimeout:
        logger.warning("paraphrase_bank_part: %ss da ulgurmadi exam=%s — asl savollar", timeout, exam_id)
        return list(questions or [])
    except Exception:  # noqa: BLE001
        return list(questions or [])
    finally:
        ex.shutdown(wait=False)
