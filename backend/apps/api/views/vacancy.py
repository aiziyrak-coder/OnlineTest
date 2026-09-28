"""Vakansiya (ishga qabul) moduli — nomzodning o'zi ro'yxatdan o'tishi.

OQIM:
  1. Nomzod /vakansiya sahifasini ochadi, ochiq ish o'rinlari ro'yxatini ko'radi.
  2. Ro'yxatdan o'tadi: F.I.Sh., pasport raqami, telefon, kafedra, parol +
     pasport rasmi va jonli selfi.
  3. Pasportdagi yuz jonli selfi bilan LOKAL solishtiriladi (OpenCV, tashqi AI
     yo'q). Mos kelsa hisob ochiladi va u darrov testga kiradi.
  4. Keyingi safar pasport raqami + o'zi tanlagan parol bilan kiradi.

Profil rasmi sifatida pasportdan KESIB olingan yuz saqlanadi — imtihon oldidagi
tekshiruv aynan shu rasm bilan solishtiradi.
"""
from __future__ import annotations

import logging
import re

from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.api.authentication import issue_token
from apps.api.face_embedding import crop_face_b64
from apps.api.gemini_tools import compare_faces
from apps.api.identity_log import log_identity
from apps.api.throttles import FaceVerifyThrottle
from apps.api.views._helpers import (
    IsAuthenticated,
    _hash_pw,
    _request_user_role_norm,
    audit,
)
from apps.core.models import AppUser, AuditLog, Exam, Kafedra, StudentExam

logger = logging.getLogger(__name__)

MAX_B64 = 14 * 1024 * 1024
MIN_B64 = 80
MIN_PASSWORD = 6

# Pasport: 2 harf + 7 raqam (AC1234567). ID-karta: 9-14 raqam.
_PASSPORT_RE = re.compile(r"^([A-Z]{2}\d{7}|\d{9,14})$")
_PHONE_RE = re.compile(r"^\+?\d{9,15}$")


def _norm_passport(raw: str) -> str:
    return re.sub(r"[\s\-]", "", str(raw or "")).upper()


def _norm_phone(raw: str) -> str:
    return re.sub(r"[\s\-()]", "", str(raw or ""))


def _open_vacancy_exams():
    """Admin qo'lda yaratgan vakansiya imtihonlari (audience='vacancy')."""
    return (
        Exam.objects.filter(audience="vacancy")
        .exclude(kafedra_id=None)
        .select_related("kafedra")
        .order_by("kafedra__name", "faculty_subject", "-id")
    )


#: Kafedra <-> iMentor katalog moslamasi qimmat (45 ta kafedra bo'yicha fuzzy
#: qidiruv + tashqi API). Har sahifa ochilganda qayta hisoblamaymiz.
_VACANCY_KAF_CACHE_KEY = "vacancy_kafedra_rows_v3"
_VACANCY_KAF_TTL = 6 * 60 * 60


def _match_kafedras_to_imentor() -> list[dict]:
    """Fanlari BOR kafedralar ro'yxati — iMentor katalogi bo'yicha.

    Vakansiya testi nomzod tanlagan FAN sillabusidan yaratiladi. Demak
    ro'yxatda faqat iMentor katalogida fani bor kafedralar turishi kerak:
    talabalar turar joyi yoki buxgalteriya kabi bo'limlarda fan yo'q va
    nomzod 2-qadamda tiqilib qolardi.
    """
    from apps.api.imentor_client import imentor_catalog_departments
    from apps.api.imentor_department_match import pick_best_department

    cats = imentor_catalog_departments()
    raw = cats.get("results") if isinstance(cats, dict) else cats
    rows = [r for r in (raw if isinstance(raw, list) else [])
            if int(r.get("subjects_count") or 0) > 0]

    from django.db.models import Count, Q

    # Bir iMentor kafedrasiga bir nechta yozuv tushishi mumkin — eng "tirik"
    # yozuvni qoldiramiz.
    from apps.core.models import Exam

    # Kafedrada nechta imtihon bor — "tirik" yozuvni aniqlash uchun eng
    # ishonchli belgi (dublikat yozuvlardan qaysinisi haqiqiyligini
    # ko'rsatadi).
    exam_cnt: dict[int, int] = {}
    for e in Exam.objects.exclude(kafedra_id=None).values("kafedra_id").annotate(
        n=Count("id")
    ):
        exam_cnt[int(e["kafedra_id"])] = int(e["n"] or 0)

    best: dict[str, tuple] = {}
    kafedras = Kafedra.objects.filter(is_active=True).annotate(
        staff=Count("users", filter=Q(users__role="faculty"))
    ).order_by("name")
    for k in kafedras:
        hit = pick_best_department(
            name=k.name, code=getattr(k, "code", None) or None, catalog_rows=rows
        )
        n_exams = exam_cnt.get(int(k.id), 0)
        # iMentor katalogida fani bo'lmasa ham, imtihoni bor kafedra
        # ro'yxatda turishi kerak: fanlar DAK bankidan olinadi.
        if not hit and n_exams == 0:
            continue
        dept = (
            str(hit.get("code") or hit.get("name") or "").strip().lower()
            if hit else "kafedra:%d" % k.id
        )
        name = str(k.name or "")
        rank = (
            n_exams,
            int(k.staff or 0),
            1 if "kafedra" in name.lower() else 0,
            len(name),
        )
        # iMentor yo'nalishi nomi — ro'yxatda qo'shimcha yorliq sifatida.
        # Bazadagi kafedra nomi ("Pediatriya kafedrasi") nomzod izlayotgan
        # nom ("Pediatriya 1") bilan mos kelmasligi mumkin; ikkalasi ham
        # ko'rinib tursa nomzod o'zinikini topa oladi.
        dept_name = str((hit or {}).get("name") or "").strip()
        row = {
            "kafedra_id": int(k.id),
            "kafedra_name": name,
            "is_clinical": bool(getattr(k, "is_clinical", False)),
            "subjects_count": int(hit.get("subjects_count") or 0) if hit else 0,
            "dept_name": dept_name if _norm_txt(dept_name) != _norm_txt(name) else "",
        }
        cur = best.get(dept)
        if cur is None or rank > cur[0]:
            best[dept] = (rank, row)
    return [v[1] for v in best.values()]


def vacancy_kafedra_rows() -> list[dict]:
    """Nomzodga ko'rsatiladigan kafedralar (keshlangan).

    iMentor katalogidagi kafedralar + admin qo'lda ochgan vakansiya
    imtihonlari kafedralari birlashtiriladi.
    """
    from django.core.cache import cache

    rows = cache.get(_VACANCY_KAF_CACHE_KEY)
    if rows is None:
        try:
            rows = _match_kafedras_to_imentor()
            cache.set(_VACANCY_KAF_CACHE_KEY, rows, _VACANCY_KAF_TTL)
        except Exception:
            # iMentor javob bermasa ro'yxat BO'SH qolmasin: faol kafedralarni
            # ko'rsatamiz, fan ro'yxati 2-qadamda tekshiriladi.
            logger.warning("vacancy: iMentor katalogi olinmadi", exc_info=True)
            rows = [
                {
                    "kafedra_id": int(k.id),
                    "kafedra_name": str(k.name or ""),
                    "is_clinical": bool(getattr(k, "is_clinical", False)),
                    "subjects_count": 0,
                    "dept_name": "",
                }
                for k in Kafedra.objects.filter(is_active=True).order_by("name")
            ]

    by_id = {r["kafedra_id"]: dict(r) for r in rows}
    # Admin qo'lda vakansiya imtihoni ochgan kafedra ham ro'yxatda bo'lsin.
    for e in _open_vacancy_exams():
        kid = int(e.kafedra_id)
        if kid not in by_id:
            by_id[kid] = {
                "kafedra_id": kid,
                "kafedra_name": str(getattr(e.kafedra, "name", "") or ""),
                "is_clinical": bool(getattr(e.kafedra, "is_clinical", False)),
                "subjects_count": 0,
                "dept_name": "",
            }

    # FANI YO'Q kafedra ro'yxatda turmasin.
    #
    # Nomzod uni tanlasa "Bu kafedra bo'yicha fan topilmadi" chiqadi va
    # ro'yxatdan o'ta olmaydi — boshi berk yo'l. Aynan shu holat 2026-09-09
    # da "Endokrinologiya gematologiya va ftizatriya" (id=97) bilan yuz
    # berdi: u id=114 ning imlosi boshqacha TAKRORI bo'lgani uchun iMentor
    # katalogidan topilmagan, DAK banki esa 114 ga bog'langan.
    #
    # Fan ikki manbadan keladi (`vacancy_subjects` bilan bir xil mantiq):
    #   1) iMentor sillabusi — `subjects_count`;
    #   2) kafedraning DAK banki — `_dak_subjects()`.
    # Ikkalasi ham bo'sh bo'lgan kafedra tanlash uchun ko'rsatilmaydi.
    # Kafedra O'CHIRILMAYDI: unga bog'langan eski natijalar joyida qoladi.
    _dak_kaf = set(
        Exam.objects.filter(audience="ordinator", exam_mode="static")
        .exclude(faculty_subject="")
        .exclude(kafedra_id=None)
        .values_list("kafedra_id", flat=True)
    )
    usable = []
    for r in by_id.values():
        has_subjects = (
            int(r.get("subjects_count") or 0) > 0
            or int(r["kafedra_id"]) in _dak_kaf
        )
        if has_subjects:
            usable.append(r)
        else:
            logger.info(
                "vacancy: kafedra %s (%s) ro'yxatdan chiqarildi — fani yo'q",
                r["kafedra_id"], r.get("kafedra_name"),
            )
    return sorted(usable, key=lambda r: r["kafedra_name"].lower())


def _dak_subjects(kafedra_id) -> list[dict]:
    """Kafedraning DAK bankidagi fanlari — tanlash uchun.

    iMentor katalogida yo'q fanlar (masalan "Tibbiy radiologiya") shu
    yo'l bilan ro'yxatga chiqadi va nomzod ularni tanlay oladi.
    """
    from apps.api.view_utils import safe_json_loads

    # Bir xil nomli fan ro'yxatda IKKI MARTA chiqmasin. Har fan uchun
    # odatda ikkita imtihon bor — 1-kurs va 2-kurs DAK — va nomzod
    # ikkitasining farqini ko'rmaydi. 2-kurs DAK ustuvor (nomzod testi
    # aynan DAK bankidan tuziladi), teng bo'lsa savoli ko'prog'i olinadi.
    best: dict[str, tuple[int, int, dict]] = {}
    for e in Exam.objects.filter(
        audience="ordinator", exam_mode="static", kafedra_id=kafedra_id
    ).only("faculty_subject", "questions_json", "id", "course"):
        name = str(e.faculty_subject or "").strip()
        if not name:
            continue
        n_q = len(safe_json_loads(e.questions_json, []))
        rank = (1 if int(getattr(e, "course", 0) or 0) == 2 else 0, n_q)
        key = name.lower()
        row = {
            "subject_code": "dak:%d" % e.id,
            "subject_name": name,
            "topics_count": n_q,
        }
        if key not in best or rank > best[key][:2]:
            best[key] = (rank[0], rank[1], row)
    out = [v[2] for v in best.values()]
    return sorted(out, key=lambda x: x["subject_name"].lower())


def ensure_vacancy_exam(kafedra_id: int, subject: str = "") -> Exam | None:
    """Kafedra uchun DOIM OCHIQ vakansiya imtihonini topadi yoki yaratadi.

    Vakansiya doim ochiq turadi, savollar esa nomzod testni boshlaganda
    uning FANI sillabusidan yaratiladi. Shuning uchun har bir kafedraga
    bitta imtihon yozuvi yetarli — admin qo'lda yaratishi shart emas
    (ilgari shart edi va shu sabab ro'yxat bo'sh chiqardi).
    """
    from datetime import timedelta

    from django.utils import timezone as dj_tz

    ex = _open_vacancy_exams().filter(kafedra_id=kafedra_id).first()
    if ex is not None:
        return ex
    kaf = Kafedra.objects.filter(pk=kafedra_id).first()
    if kaf is None:
        return None
    owner = (
        AppUser.objects.filter(role="admin").order_by("id").first()
        or AppUser.objects.filter(role="staff").order_by("id").first()
    )
    if owner is None:
        return None
    now = dj_tz.now()
    return Exam.objects.create(
        teacher_id=owner.id,
        title="Ishga qabul testi — %s" % kaf.name,
        start_time=now - timedelta(days=1),
        end_time=now + timedelta(days=3650),
        # 20 ta savol — 20 daqiqa (boshqa ishga qabul imtihonlari bilan bir xil).
        duration_minutes=20,
        questions_json="[]",
        language="uz",
        exam_mode="vacancy_ai",
        audience="vacancy",
        bank_question_count=20,
        # 5 tasi ordinatura DAK bankidan, 15 tasi AI yaratgan qiyinroq savol.
        # Nisbat ataylab AI tomonga og'dirilgan: DAK banki tarqalgan, uni
        # yodlab kelgan nomzod imtihonning atigi choragini biladi.
        ai_question_count=15,
        # Institut bo'yicha yagona o'tish bali.
        pass_percent=56,
        kafedra_id=kaf.id,
        faculty_subject=str(subject or "")[:300],
    )


# ---------------------------------------------------------- savol sifati --

def _norm_txt(v) -> str:
    """Solishtirish uchun sodda normallashtirish."""
    return re.sub(r"[^0-9a-zA-Zа-яёА-ЯЁ]+", "", str(v or "")).lower()


def drop_weak_questions(questions: list[dict], strict: bool = True) -> list[dict]:
    """Oson (chalg'ituvchisiz) savollarni chetlab o'tadi.

    Tashlab yuboriladi:
      * to'g'ri javob savol matnida so'zma-so'z turgan bo'lsa — nomzod
        o'qimasdan ham topadi;
      * variantlar kam bo'lsa — tanlov tor, taxmin qilish oson;
      * variantlar takrorlangan bo'lsa;
      * `strict` (vakansiya uchun standart): qisqa, klinik holatsiz
        savollar; javobi boshqa variantlardan sezilarli uzun bo'lganlar
        (uzunligiga qarab topib bo'ladi); javob matnining bir qismi
        savolda takrorlanganlar.

    Nomzodlarning 80% i o'tib ketgani uchun mezon qattiqlashtirildi.
    """
    min_opts = 5 if strict else 4
    min_len = 150 if strict else 1
    out: list[dict] = []
    for q in questions or []:
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        ans = str(q.get("correctAnswer") or "").strip()
        text = str(q.get("text") or "").strip()
        if len(opts) < min_opts or not ans or not text:
            continue
        if len(text) < min_len:
            continue
        norm_opts = [_norm_txt(o) for o in opts]
        if len(set(norm_opts)) != len(norm_opts):
            continue
        na, nt = _norm_txt(ans), _norm_txt(text)
        if len(na) >= 8 and na in nt:
            continue
        if strict:
            # Javob eng uzun variant bo'lsa — klassik "topib olish" belgisi.
            others = [len(o) for o in opts if o != ans]
            if others and len(ans) > max(others) * 1.6:
                continue
            # Javobning yarmidan ko'pi savol matnida uchrasa ham oson.
            if len(na) >= 14 and na[: len(na) // 2] in nt:
                continue
        out.append(q)
    return out


def hard_bank_questions(kafedra_id, need: int, seen_texts=None,
                        subject: str = "") -> list[dict]:
    """Kafedra bo'yicha ordinatura DAK bankidan qiyin savollar.

    Bu savollar institut tomonidan tayyorlangan haqiqiy mutaxassislik
    testlari: klinik holat + 4-5 ta ishonarli chalg'ituvchi variant.
    AI yaratganidan ancha qiyin va tekin (kredit sarflanmaydi).
    """
    import random

    from apps.api.view_utils import safe_json_loads

    if not kafedra_id:
        return []

    def _collect(qs):
        got: list[dict] = []
        for e in qs:
            for q in safe_json_loads(e.questions_json, []) or []:
                if isinstance(q, dict) and q.get("text") and q.get("options"):
                    got.append(q)
        return got

    base = Exam.objects.filter(audience="ordinator", exam_mode="static")

    # Nomzod FAN tanlagan bo'lsa — aynan o'sha fan bankidan olamiz.
    # Kafedrada bir nechta yo'nalish bo'lsa (masalan endokrinologiya,
    # ftiziatriya, radiologiya) aralashib ketmasin.
    pool: list[dict] = []
    subj = str(subject or "").strip().lower()
    if subj:
        exact = [
            e for e in base.filter(kafedra_id=kafedra_id).only(
                "faculty_subject", "questions_json"
            )
            if str(e.faculty_subject or "").strip().lower() == subj
        ]
        pool = _collect(exact)
    if not pool:
        pool = _collect(base.filter(kafedra_id=kafedra_id).only("questions_json"))

    if not pool:
        # Bazada bir kafedra ikki xil yozuvda turishi mumkin ("Pediatriya
        # kafedrasi" va "Pediatriya fakulteti"). Aynan mos yozuvda bank
        # bo'lmasa, NOMI eng yaqin kafedra bankidan olamiz.
        from difflib import SequenceMatcher

        me = Kafedra.objects.filter(pk=kafedra_id).first()
        if me:
            def key(v):
                v = re.sub(r"\bkafedra\w*|\bfakultet\w*", " ", str(v or "").lower())
                return re.sub(r"[^a-z' ]+", " ", v).strip()

            mine = key(me.name)
            best, bs = None, 0.0
            for e in base.select_related("kafedra").only("kafedra__name", "kafedra_id"):
                if not e.kafedra_id or e.kafedra_id == kafedra_id:
                    continue
                sc = SequenceMatcher(None, mine, key(e.kafedra.name)).ratio()
                if sc > bs:
                    best, bs = e.kafedra_id, sc
            if best and bs >= 0.72:
                pool = _collect(base.filter(kafedra_id=best).only("questions_json"))
    if not pool:
        return []
    seen = set(seen_texts or ())
    fresh = [q for q in pool if _norm_txt(q.get("text"))[:120] not in seen]
    src = fresh if len(fresh) >= need else pool
    picked = random.sample(src, min(need, len(src)))
    return [
        {
            "id": i + 1,
            "text": str(q.get("text") or ""),
            "options": [str(o) for o in (q.get("options") or [])],
            "correctAnswer": str(q.get("correctAnswer") or ""),
            "source": "ordinatura_dak_bank",
        }
        for i, q in enumerate(picked)
    ]


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def vacancy_positions(request):
    """Vakansiya kafedralari — klinik/noklinik bo'yicha guruhlangan."""
    rows = vacancy_kafedra_rows()
    return Response(
        {
            "positions": rows,
            "clinical": [r for r in rows if r["is_clinical"]],
            "non_clinical": [r for r in rows if not r["is_clinical"]],
        }
    )


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def vacancy_subjects(request):
    """Tanlangan kafedraning FANLARI — iMentor sillabus katalogidan.

    Nomzod kafedrani tanlaganda shu ro'yxat chiqadi va u fanni tanlaydi;
    test aynan o'sha fanning sillabus mavzulari bo'yicha yaratiladi.
    """
    from apps.api.imentor_client import IMentorApiError, imentor_catalog_departments
    from apps.api.imentor_department_match import pick_best_department
    from apps.api.imentor_service import subjects_for_department

    try:
        kaf_id = int(request.query_params.get("kafedra_id") or 0)
    except (TypeError, ValueError):
        kaf_id = 0
    kaf = Kafedra.objects.filter(pk=kaf_id).first() if kaf_id else None
    if not kaf:
        return Response({"error": "KAFEDRA_INVALID"}, status=400)
    if not bool(getattr(kaf, "is_active", True)):
        return Response({"error": "KAFEDRA_CLOSED"}, status=400)

    # OnlineTest kafedra nomi iMentor kafedra nomi bilan aynan mos kelmaydi —
    # katalogdan eng yaqinini topamiz (o'qituvchi imtihonidagi bilan bir xil).
    try:
        cats = imentor_catalog_departments()
        rows = cats.get("results") if isinstance(cats, dict) else None
        # Kafedralar ro'yxati bilan AYNAN bir xil filtr: fani bo'lmagan
        # katalog yozuvlari hisobga olinmaydi. Aks holda ro'yxatda "3 fan"
        # deb turib, ochilganda boshqa son chiqardi.
        rows = [
            r for r in (rows if isinstance(rows, list) else [])
            if int(r.get("subjects_count") or 0) > 0
        ]
        hit = pick_best_department(
            name=kaf.name,
            code=getattr(kaf, "code", None) or None,
            catalog_rows=rows,
        )
    except IMentorApiError:
        hit = None
    if not hit:
        # iMentor'da mos kafedra yo'q — fanlarni DAK bankidan beramiz.
        dak = _dak_subjects(kaf.id)
        return Response({"subjects": dak, "department": kaf.name if dak else None},
                        status=200)

    dept_code = str(hit.get("code") or "").strip()
    _dept, subs = subjects_for_department(dept_code)
    subs = list(subs) + _dak_subjects(kaf.id)
    out = []
    for x in subs:
        topics = int(x.get("topics_count") or 0)
        out.append(
            {
                "subject_code": x.get("subject_code"),
                "subject_name": x.get("subject_name"),
                "topics_count": topics,
            }
        )
    return Response(
        {
            "department": {"code": dept_code, "name": hit.get("name")},
            "subjects": out,
        }
    )

@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([FaceVerifyThrottle])
def vacancy_register(request):
    """Nomzodni ro'yxatdan o'tkazadi va darrov tizimga kirgizadi."""
    d = request.data or {}
    name = str(d.get("name") or "").strip()
    passport = _norm_passport(d.get("passport"))
    phone = _norm_phone(d.get("phone"))
    password = str(d.get("password") or "")
    kafedra_id = d.get("kafedra_id")
    subject_name = str(d.get("subject") or "").strip()
    subject_code = str(d.get("subject_code") or "").strip()
    passport_img = d.get("passport_image_base64")
    live_img = d.get("live_capture_base64")

    if len(name.split()) < 2:
        return Response({"error": "FULL_NAME_REQUIRED"}, status=400)
    if not _PASSPORT_RE.match(passport):
        return Response({"error": "PASSPORT_INVALID"}, status=400)
    if not _PHONE_RE.match(phone):
        return Response({"error": "PHONE_INVALID"}, status=400)
    if len(password) < MIN_PASSWORD:
        return Response({"error": "PASSWORD_SHORT"}, status=400)
    try:
        kafedra_id = int(kafedra_id)
    except (TypeError, ValueError):
        return Response({"error": "KAFEDRA_REQUIRED"}, status=400)

    # Faqat ro'yxatda ko'rsatilgan kafedra tanlansin.
    if not Kafedra.objects.filter(pk=kafedra_id, is_active=True).exists():
        return Response({"error": "KAFEDRA_INVALID"}, status=400)
    if kafedra_id not in {r["kafedra_id"] for r in vacancy_kafedra_rows()}:
        return Response({"error": "KAFEDRA_INVALID"}, status=400)
    # Fan majburiy: test aynan shu fan sillabusidan yaratiladi.
    if not subject_name:
        return Response({"error": "SUBJECT_REQUIRED"}, status=400)

    if AppUser.objects.filter(pk=passport).exists():
        return Response({"error": "ALREADY_REGISTERED"}, status=409)

    if not isinstance(passport_img, str) or not isinstance(live_img, str):
        return Response({"error": "PHOTO_REQUIRED"}, status=400)
    if not (MIN_B64 <= len(passport_img) <= MAX_B64) or not (MIN_B64 <= len(live_img) <= MAX_B64):
        return Response({"error": "PHOTO_INVALID"}, status=400)

    log_identity("vacancy_register_start", user_id=passport, kafedra_id=kafedra_id)
    result = compare_faces(passport_img, live_img)
    if not result.get("success"):
        log_identity("vacancy_register_fail", user_id=passport, code=result.get("code"))
        return Response({"error": result.get("code") or "COMPARE_FAILED"}, status=503)
    if not result.get("match"):
        log_identity("vacancy_register_nomatch", user_id=passport, score=result.get("score"))
        return Response(
            {"error": "NO_MATCH", "score": result.get("score")},
            status=200,
        )

    stored = crop_face_b64(passport_img)
    if not stored:
        return Response({"error": "FACE_NOT_DETECTED"}, status=400)

    user = AppUser.objects.create(
        id=passport,
        password=_hash_pw(password),
        role="vacancy",
        name=name,
        status="Active",
        kafedra_id=kafedra_id,
        position=phone,  # telefon raqami — HR bog'lanishi uchun
        vacancy_subject=subject_name[:200],
        vacancy_subject_code=subject_code[:120],
        profile_image=stored,
    )
    # Nomzod kabinetida test darrov ko'rinsin — kerak bo'lsa imtihon
    # avtomatik ochiladi (admin qo'lda yaratishi shart emas).
    ensure_vacancy_exam(kafedra_id, subject_name)
    audit(
        request,
        "vacancy_register",
        "user",
        passport,
        name,
        "kafedra_id=%s, fan=%s, tel=%s" % (kafedra_id, subject_name, phone),
    )
    log_identity("vacancy_register_ok", user_id=passport, score=result.get("score"))

    token = issue_token(user)
    return Response(
        {
            "ok": True,
            "token": token,
            "user": {
                "id": user.id,
                "name": user.name,
                "role": user.role,
                "profile_image": user.profile_image,
            },
        },
        status=201,
    )


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def vacancy_check_passport(request):
    """Pasport raqami allaqachon ro'yxatdan o'tganmi — forma to'ldirilayotganda."""
    passport = _norm_passport(request.query_params.get("passport"))
    if not _PASSPORT_RE.match(passport):
        return Response({"valid": False, "taken": False})
    return Response({"valid": True, "taken": AppUser.objects.filter(pk=passport).exists()})

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_vacancy_applicants(request):
    """Ro'yxatdan o'tgan nomzodlar — HR uchun to'liq ro'yxat.

    Har bir nomzod: ism, pasport (login), telefon, tanlagan ish o'rni,
    ro'yxatdan o'tgan vaqti va test holati (topshirmagan / topshirmoqda /
    topshirgan, ball va foizi bilan).
    """
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)

    from apps.api.certificate_pdf import (
        PASS_PERCENT_THRESHOLD,
        exam_pass_threshold,
    )
    from apps.api.view_utils import safe_json_loads

    # Sahifada ko'rsatiladigan chegara: vakansiya imtihonlariniki (bir xil
    # bo'lsa o'sha, aks holda umumiy sozlama).
    _thr_vals = {
        int(x or 0) or PASS_PERCENT_THRESHOLD
        for x in Exam.objects.filter(audience='vacancy').values_list('pass_percent', flat=True)
    }
    threshold = _thr_vals.pop() if len(_thr_vals) == 1 else PASS_PERCENT_THRESHOLD
    users = list(
        AppUser.objects.filter(role="vacancy").select_related("kafedra").order_by("name")
    )
    ids = [u.id for u in users]

    # Ro'yxatdan o'tgan vaqt: alohida maydon yo'q, audit jurnalidan olinadi.
    reg_at: dict[str, str] = {}
    for a in AuditLog.objects.filter(
        action="vacancy_register", target_id__in=ids
    ).values("target_id", "created_at"):
        key = str(a["target_id"])
        if key not in reg_at:
            reg_at[key] = a["created_at"].isoformat()

    exam_info: dict[int, dict] = {}
    for e in Exam.objects.filter(audience="vacancy").values(
        "id", "faculty_subject", "title", "bank_question_count", "questions_json",
        "pass_percent"
    ):
        n = int(e["bank_question_count"] or 0)
        if not n:
            n = len(safe_json_loads(e["questions_json"] or "[]", []))
        exam_info[int(e["id"])] = {
            "subject": str(e["faculty_subject"] or e["title"] or ""),
            "total": n,
            # Har imtihonning O'Z o'tish chegarasi bo'lishi mumkin.
            "threshold": int(e.get("pass_percent") or 0) or PASS_PERCENT_THRESHOLD,
        }

    ses_by_user: dict[str, list] = {}
    for se in StudentExam.objects.filter(
        student_id__in=ids, exam_id__in=list(exam_info.keys())
    ).only("id", "student_id", "exam_id", "status", "score",
           "session_questions_json", "completed_at"):
        ses_by_user.setdefault(str(se.student_id), []).append(se)

    rows = []
    for u in users:
        sessions = ses_by_user.get(str(u.id), [])
        best = None
        for se in sessions:
            info = exam_info.get(se.exam_id) or {
                "subject": "", "total": 0, "threshold": threshold,
            }
            thr = int(info.get("threshold") or threshold)
            total = len(safe_json_loads(se.session_questions_json or "", [])) or int(info["total"] or 0)
            score = int(se.score or 0)
            pct = round((score / total) * 100) if total else 0
            row = {
                "student_exam_id": se.id,
                "exam_id": se.exam_id,
                "subject": info["subject"],
                "status": se.status,
                "score": score if se.score is not None else None,
                "total": total,
                "percent": pct if se.score is not None else None,
                "passed": bool(se.score is not None and pct >= thr),
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
            }
            if best is None or (row["percent"] or -1) > (best["percent"] or -1):
                best = row

        rows.append(
            {
                "id": str(u.id),
                "name": str(u.name or ""),
                "phone": str(u.position or ""),
                "kafedra_id": u.kafedra_id,
                "kafedra_name": str(getattr(u.kafedra, "name", "") or ""),
                "vacancy_subject": str(getattr(u, "vacancy_subject", "") or ""),
                "status": str(u.status or ""),
                "registered_at": reg_at.get(str(u.id)),
                "has_photo": bool((u.profile_image or "").strip()),
                "attempt": best,
            }
        )

    done = [r for r in rows if r["attempt"] and r["attempt"]["status"] == "Completed"]
    return Response(
        {
            "pass_threshold": threshold,
            "total": len(rows),
            "completed": len(done),
            "passed": sum(1 for r in done if r["attempt"]["passed"]),
            "not_started": sum(1 for r in rows if not r["attempt"]),
            "applicants": rows,
        }
    )

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_vacancy_reset_password(request, user_id: str):
    """Nomzodning parolini tiklaydi va yangisini BIR MARTA qaytaradi.

    Nomzod parolini unutsa, o'zi tiklay olmasdi va admin ham hech narsa
    qila olmasdi — bazani qo'lda tahrirlash kerak bo'lardi.
    """
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    u = AppUser.objects.filter(pk=str(user_id), role="vacancy").first()
    if not u:
        return Response({"error": "Not found"}, status=404)

    import secrets

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    new_pw = "".join(secrets.choice(alphabet) for _ in range(8))
    u.password = _hash_pw(new_pw)
    u.save(update_fields=["password"])
    audit(request, "vacancy_reset_password", "user", u.id, u.name, "parol tiklandi")
    return Response({"ok": True, "password": new_pw})
