"""Kafedra kesimidagi imtihon hisoboti.

Ilgari admin paneldagi hisobot brauzerda yig'ilardi: har bir imtihon uchun
alohida `/api/admin/exams/<id>/results` so'rovi ketardi (50+ so'rov). Bittasi
uzilsa raqamlar kamayib qolardi — shuning uchun har "obnovit"da boshqa son
chiqardi. Endi butun hisob SERVERDA, bitta so'rovda va bitta tranzaksiyada
olinadi, ya'ni javob barqaror.
"""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.certificate_pdf import PASS_PERCENT_THRESHOLD, exam_pass_threshold



# Auditoriya nomlari — hisobot sarlavhasida ko'rinadi.
AUDIENCE_LABELS = {
    "faculty": "O'qituvchilarni baholash",
    "ordinator": "Ordinatorlar (DAK)",
    "magistr": "Magistrlar (bitiruv)",
    "student": "Talabalar semestr testi",
    "vacancy": "Ishga qabul (vakansiya)",
    "entrant": "Maxsus kiruvchilar",
}

# Shuncha kundan uzoq tanaffus bo'lsa — bu boshqa mavsum.
SEASON_GAP_DAYS = 7


def _audience_label(aud: str) -> str:
    a = str(aud or "").strip().lower() or "student"
    return AUDIENCE_LABELS.get(a, a.title())


def list_seasons() -> list[dict]:
    """Imtihonlarni auditoriya va sanalar bo'yicha mavsumlarga ajratadi.

    Hisobotda o'qituvchilar baholovi, ordinatorlar, talabalar semestri va
    ishga qabul testlari aralashib ketmasligi kerak. Alohida "mavsum" maydoni
    yo'q, shuning uchun mavsum imtihon sanalaridan aniqlanadi: 7 kundan uzoq
    tanaffus yangi mavsum deb hisoblanadi. Yangi test to'lqini yaratilsa,
    ro'yxatga o'zi qo'shiladi — qo'lda sozlash shart emas.
    """
    rows = list(
        Exam.objects.exclude(start_time=None)
        .values("id", "audience", "start_time", "course")
        .order_by("audience", "course", "start_time")
    )
    # Auditoriya + KURS bo'yicha guruhlaymiz: ordinatura 1-kurs va 2-kurs
    # (DAK) imtihonlari bir vaqtda ochiq turadi va sana bo'yicha bitta
    # mavsumga qo'shilib ketardi.
    by_aud: dict[tuple, list] = {}
    for r in rows:
        aud = str(r["audience"] or "student").strip().lower()
        by_aud.setdefault((aud, int(r.get("course") or 0)), []).append(r)

    seasons: list[dict] = []
    for (aud, course), items in by_aud.items():
        cluster: list = []
        prev = None
        for r in items:
            d = dj_tz.localtime(r["start_time"]).date()
            if prev is not None and (d - prev).days > SEASON_GAP_DAYS:
                seasons.append(_make_season(aud, cluster, course))
                cluster = []
            cluster.append(r)
            prev = d
        if cluster:
            seasons.append(_make_season(aud, cluster, course))

    seasons.sort(key=lambda x: x["date_to"], reverse=True)
    return seasons


def _make_season(aud: str, items: list, course: int = 0) -> dict:
    dates = [dj_tz.localtime(r["start_time"]).date() for r in items]
    d1, d2 = min(dates), max(dates)
    label_dates = d1.strftime("%d.%m.%Y") if d1 == d2 else (d1.strftime("%d.%m") + "-" + d2.strftime("%d.%m.%Y"))
    course_label = (" %d-kurs" % course) if course else ""
    base = _audience_label(aud)
    # DAK (davlat attestatsiyasi) faqat 2-kurs ordinatorlar uchun. 1-kurs
    # testi — alohida, oraliq nazorat; unga "(DAK)" yozish noto'g'ri edi.
    if str(aud or "").strip().lower() == "ordinator" and int(course or 0) == 1:
        base = "Ordinatorlar"
    return {
        "key": "%s:%d:%s:%s" % (aud, int(course or 0), d1.isoformat(), d2.isoformat()),
        "audience": aud,
        "course": int(course or 0),
        "audience_label": base + course_label,
        "label": base + course_label + " · " + label_dates,
        "date_from": d1.isoformat(),
        "date_to": d2.isoformat(),
        "exam_count": len(items),
        "exam_ids": [int(r["id"]) for r in items],
    }


def _season_exam_ids(season_key: str | None) -> tuple[list[int] | None, dict | None]:
    """Mavsum kalitidan imtihon id lari. Kalit bo'lmasa - eng oxirgi mavsum."""
    seasons = list_seasons()
    if not seasons:
        return None, None
    chosen = None
    if season_key:
        for sn in seasons:
            if sn["key"] == season_key:
                chosen = sn
                break
    if chosen is None:
        chosen = seasons[0]
    return chosen["exam_ids"], chosen

def _season_threshold(season_ids) -> int:
    """Mavsum imtihonlarining o'tish chegarasi (bir xil bo'lsa — o'sha)."""
    if not season_ids:
        return PASS_PERCENT_THRESHOLD
    vals = {
        exam_pass_threshold(e)
        for e in Exam.objects.filter(id__in=season_ids).only("pass_percent")
    }
    return vals.pop() if len(vals) == 1 else PASS_PERCENT_THRESHOLD


def _question_total(se: StudentExam, exam_totals: dict[int, int]) -> int:
    """Imtihondagi savollar soni — foizni hisoblash uchun maxraj."""
    raw = (se.session_questions_json or "").strip()
    if raw:
        n = len(safe_json_loads(raw, []))
        if n:
            return n
    return int(exam_totals.get(se.exam_id) or 0)


def build_kafedra_report(season_key: str | None = None) -> dict:
    """Hisobotni yig'adi. View'dan ajratilgan — shell'dan ham tekshirsa bo'ladi.

    FAQAT bitta test mavsumi hisoblanadi: o'qituvchilar baholovi, ordinatorlar,
    talabalar semestri va ishga qabul testlari bir hisobotda aralashmasin.
    """
    season_ids, season = _season_exam_ids(season_key)
    # Mavsumdagi imtihonlarning O'Z chegarasi bo'lsa — o'shani olamiz
    # (maxsus kirish imtihonida chegara boshqacha bo'ladi).
    threshold = _season_threshold(season_ids)
    _role = (season or {}).get("audience") or "faculty"

    kafedralar = {
        int(k["id"]): str(k["name"] or "")
        for k in Kafedra.objects.values("id", "name")
    }

    # 1. Kafedradagi jami o'qituvchilar.
    total_by_kaf: dict[int, int] = {}
    for row in (
        AppUser.objects.filter(role=_role)
        .exclude(kafedra_id=None)
        .values("kafedra_id")
        .annotate(n=Count("id"))
    ):
        total_by_kaf[int(row["kafedra_id"])] = int(row["n"] or 0)

    # 2. Imtihonlar -> kafedra va savollar soni.
    exam_kaf: dict[int, int] = {}
    exam_totals: dict[int, int] = {}
    exam_qs = Exam.objects.all()
    if season_ids is not None:
        exam_qs = exam_qs.filter(id__in=season_ids)
    for e in exam_qs.values(
        "id", "kafedra_id", "bank_question_count", "questions_json"
    ):
        eid = int(e["id"])
        if e["kafedra_id"]:
            exam_kaf[eid] = int(e["kafedra_id"])
        n = int(e["bank_question_count"] or 0)
        if not n:
            n = len(safe_json_loads(e["questions_json"] or "[]", []))
        exam_totals[eid] = n

    # 3. Yakunlangan urinishlar. Bir o'qituvchi bir nechta fandan topshirishi
    #    mumkin — "ishtirok etgan" va "o'tgan" ODAM bo'yicha sanaladi, urinish
    #    bo'yicha emas (aks holda faol kafedra sun'iy yuqori chiqardi).
    participants: dict[int, set[str]] = {}
    passers: dict[int, set[str]] = {}
    best_pct: dict[tuple[int, str], int] = {}
    # Boshlagan, lekin yakunlamaganlar. Ular ham imtihonga kirgan, shuning
    # uchun "ishtirok etmagan" qatoriga qo'shib yuborish noto'g'ri edi —
    # 37 kishi hisobotda umuman ko'rinmasdi.
    attempted: dict[int, set[str]] = {}

    for row in StudentExam.objects.filter(
        exam_id__in=list(exam_kaf.keys())
    ).values("exam_id", "student_id"):
        kaf = exam_kaf.get(int(row["exam_id"]))
        if kaf:
            attempted.setdefault(kaf, set()).add(str(row["student_id"]))

    ses = StudentExam.objects.filter(
        status="Completed", exam_id__in=list(exam_kaf.keys())
    ).only("exam_id", "student_id", "score", "session_questions_json")
    for se in ses.iterator(chunk_size=500):
        kaf = exam_kaf.get(se.exam_id)
        if not kaf:
            continue
        sid = str(se.student_id)
        participants.setdefault(kaf, set()).add(sid)
        total_q = _question_total(se, exam_totals)
        pct = round(((se.score or 0) / total_q) * 100) if total_q else 0
        key = (kaf, sid)
        if pct > best_pct.get(key, -1):
            best_pct[key] = pct

    for (kaf, sid), pct in best_pct.items():
        if pct >= threshold:
            passers.setdefault(kaf, set()).add(sid)

    # Hisobotga FAQAT imtihoni bor kafedralar kiradi. Ilgari institutdagi
    # barcha kafedra chiqardi va imtihon tayinlanmagan o'nlab kafedra
    # "0% / ishtirok etmagan" bo'lib turib, hisobotni chalg'itardi.
    kafedra_with_exam = set(exam_kaf.values())

    rows: list[dict] = []
    for kaf_id, kaf_name in kafedralar.items():
        if kaf_id not in kafedra_with_exam:
            continue
        total = int(total_by_kaf.get(kaf_id, 0))
        part = len(participants.get(kaf_id, ()))
        passed = len(passers.get(kaf_id, ()))
        tried = attempted.get(kaf_id, set())
        unfinished = len(tried - participants.get(kaf_id, set()))
        rows.append(
            {
                "kafedra_id": kaf_id,
                "kafedra_name": kaf_name,
                "total_teachers": total,
                "participated": part,
                "unfinished": unfinished,
                "not_participated": max(0, total - part - unfinished),
                "passed": passed,
                "failed": max(0, part - passed),
                # O'tish foizi ishtirok etganlarga nisbatan.
                "pass_percent": round((passed / part) * 100) if part else 0,
                # Qamrov: kafedradagi o'qituvchilarning qanchasi topshirdi.
                "participation_percent": round((part / total) * 100) if total else 0,
            }
        )

    rows.sort(key=lambda r: r["kafedra_name"].lower())

    t_total = sum(r["total_teachers"] for r in rows)
    t_part = sum(r["participated"] for r in rows)
    t_unfinished = sum(r["unfinished"] for r in rows)
    t_passed = sum(r["passed"] for r in rows)

    # Reyting faqat haqiqatda topshirilgan kafedralar orasida — nol ishtirokli
    # kafedra "eng past" bo'lib chiqsa hisobot chalg'itadi.
    ranked = [r for r in rows if r["participated"] > 0]
    ranked_desc = sorted(
        ranked, key=lambda r: (-r["pass_percent"], -r["participated"], r["kafedra_name"])
    )
    ranked_asc = sorted(
        ranked, key=lambda r: (r["pass_percent"], -r["participated"], r["kafedra_name"])
    )

    return {
            "generated_at": dj_tz.now().isoformat(),
            "season": season,
            "pass_threshold": threshold,
            "totals": {
                "kafedra_count": len(rows),
                "total_teachers": t_total,
                "participated": t_part,
                "unfinished": t_unfinished,
                "not_participated": max(0, t_total - t_part - t_unfinished),
                "passed": t_passed,
                "failed": max(0, t_part - t_passed),
                "pass_percent": round((t_passed / t_part) * 100) if t_part else 0,
                "participation_percent": round((t_part / t_total) * 100) if t_total else 0,
            },
            "kafedralar": rows,
            "top": ranked_desc[:10],
            "bottom": ranked_asc[:10],
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_kafedra(request):
    """Kafedra kesimida: jami / ishtirok etgan / o'tgan / o'tmagan va foizlar."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response(build_kafedra_report(request.query_params.get("season")))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_kafedra_pdf(request):
    """Xuddi shu hisobot — bosib chiqarishga tayyor PDF."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.kafedra_report_pdf import build_kafedra_report_pdf

    data = build_kafedra_report(request.query_params.get("season"))
    now = dj_tz.localtime(dj_tz.now())
    pdf = build_kafedra_report_pdf(data, now.strftime("%d.%m.%Y %H:%M"))
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = (
        'attachment; filename="kafedra-hisobot-' + now.strftime("%Y-%m-%d") + '.pdf"'
    )
    return resp

def build_absent_report(season_key: str | None = None, only_active: bool = True) -> dict:
    """Imtihonni topshirmagan o'qituvchilar — kafedralar kesimida, ism bilan.

    Umumiy hisobotda faqat SONLAR bor edi. Kafedra mudiriga "kim topshirmadi"
    degan aniq ro'yxat kerak, shuning uchun bu yerda har bir kishi ismi,
    login raqami va holati bilan chiqadi.

    only_active=True (standart) — FAQAT haqiqatan topshirilgan kafedralar.
    Umuman hech kim topshirmagan kafedra ro'yxatni ko'mib tashlardi:
    kafedra mudiriga o'z kafedrasidagi qolganlar kerak, boshqasi emas.
    """
    season_ids, season = _season_exam_ids(season_key)
    _role = (season or {}).get("audience") or "faculty"
    exam_qs = Exam.objects.all()
    if season_ids is not None:
        exam_qs = exam_qs.filter(id__in=season_ids)
    exam_kaf: dict[int, int] = {}
    for e in exam_qs.values("id", "kafedra_id"):
        if e["kafedra_id"]:
            exam_kaf[int(e["id"])] = int(e["kafedra_id"])
    kafedra_with_exam = set(exam_kaf.values())

    # Kim topshirgan / kim urinib ko'rgan.
    done: dict[int, set[str]] = {}
    tried: dict[int, set[str]] = {}
    for row in StudentExam.objects.filter(exam_id__in=list(exam_kaf.keys())).values(
        "exam_id", "student_id", "status"
    ):
        kaf = exam_kaf.get(int(row["exam_id"]))
        if not kaf:
            continue
        sid = str(row["student_id"])
        tried.setdefault(kaf, set()).add(sid)
        if str(row["status"] or "").strip() == "Completed":
            done.setdefault(kaf, set()).add(sid)

    kafedralar = {
        int(k["id"]): str(k["name"] or "")
        for k in Kafedra.objects.filter(id__in=kafedra_with_exam).values("id", "name")
    }

    groups: list[dict] = []
    jami_odam = 0
    for kaf_id, kaf_name in sorted(kafedralar.items(), key=lambda x: x[1].lower()):
        topshirgan = done.get(kaf_id, set())
        urinib = tried.get(kaf_id, set())
        people = []
        qs = AppUser.objects.filter(role=_role, kafedra_id=kaf_id).order_by("name")
        for u in qs.only("id", "name"):
            sid = str(u.id)
            if sid in topshirgan:
                continue
            people.append(
                {
                    "student_id": sid,
                    "name": str(u.name or ""),
                    "state": "unfinished" if sid in urinib else "never_started",
                }
            )
        if not people:
            continue
        if only_active and not done.get(kaf_id):
            continue  # bu kafedradan umuman hech kim topshirmagan
        jami_odam += len(people)
        groups.append(
            {
                "kafedra_id": kaf_id,
                "kafedra_name": kaf_name,
                "total_teachers": qs.count(),
                "absent_count": len(people),
                "unfinished_count": sum(1 for p in people if p["state"] == "unfinished"),
                "people": people,
            }
        )

    groups.sort(key=lambda g: (-g["absent_count"], g["kafedra_name"].lower()))
    return {
        "generated_at": dj_tz.now().isoformat(),
        "season": season,
        "only_active": bool(only_active),
        "kafedra_count": len(groups),
        "absent_total": jami_odam,
        "groups": groups,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_absent(request):
    """Topshirmaganlar ro'yxati — kafedra bo'yicha guruhlangan."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    only_active = str(request.query_params.get("all") or "").strip() not in ("1", "true", "yes")
    return Response(build_absent_report(request.query_params.get("season"), only_active))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_absent_pdf(request):
    """Topshirmaganlar ro'yxati — bosib chiqarish uchun PDF."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.kafedra_report_pdf import build_absent_report_pdf

    only_active = str(request.query_params.get("all") or "").strip() not in ("1", "true", "yes")
    data = build_absent_report(request.query_params.get("season"), only_active)
    now = dj_tz.localtime(dj_tz.now())
    pdf = build_absent_report_pdf(data, now.strftime("%d.%m.%Y %H:%M"))
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = (
        'attachment; filename="qatnashmaganlar-' + now.strftime("%Y-%m-%d") + '.pdf"'
    )
    return resp


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_seasons(request):
    """Mavjud test mavsumlari — hisobot yuqorisidagi tanlov uchun."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response({"seasons": list_seasons()})

def build_participants_report(season_key: str | None = None) -> dict:
    """Topshirgan har bir kishi — kafedra kesimida, ball va natija bilan.

    Hisobotda faqat sonlar bor edi; kafedra mudiriga kim necha ball olgani va
    o'tdi-o'tmadi degan aniq ro'yxat kerak.
    """
    season_ids, season = _season_exam_ids(season_key)
    # Mavsumdagi imtihonlarning O'Z chegarasi bo'lsa — o'shani olamiz
    # (maxsus kirish imtihonida chegara boshqacha bo'ladi).
    threshold = _season_threshold(season_ids)

    exam_qs = Exam.objects.all()
    if season_ids is not None:
        exam_qs = exam_qs.filter(id__in=season_ids)
    exam_info: dict[int, dict] = {}
    for e in exam_qs.values("id", "kafedra_id", "faculty_subject", "title", "bank_question_count", "questions_json"):
        eid = int(e["id"])
        n = int(e["bank_question_count"] or 0)
        if not n:
            n = len(safe_json_loads(e["questions_json"] or "[]", []))
        exam_info[eid] = {
            "kafedra_id": e["kafedra_id"],
            "subject": str(e["faculty_subject"] or e["title"] or ""),
            "total": n,
        }

    kafedralar = {int(k["id"]): str(k["name"] or "") for k in Kafedra.objects.values("id", "name")}
    by_kaf: dict[int, list] = {}

    ses = (
        StudentExam.objects.filter(status="Completed", exam_id__in=list(exam_info.keys()))
        .select_related("student")
    )
    for se in ses.iterator(chunk_size=500):
        info = exam_info.get(se.exam_id)
        if not info or not info["kafedra_id"]:
            continue
        total = _question_total(se, {se.exam_id: info["total"]})
        score = int(se.score or 0)
        pct = round((score / total) * 100) if total else 0
        by_kaf.setdefault(int(info["kafedra_id"]), []).append(
            {
                "student_exam_id": se.id,
                "student_id": str(se.student_id),
                "name": str(getattr(se.student, "name", "") or ""),
                "subject": info["subject"],
                "score": score,
                "total": total,
                "percent": pct,
                "passed": pct >= threshold,
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                # Ordinator/magistr: to'lov asosidagi urinishlar hisoboti.
                "paid_attempts": int(getattr(se, "paid_attempts_granted", 0) or 0),
                "tech_retries_used": int(getattr(se, "technical_retakes_used", 0) or 0),
            }
        )

    groups = []
    t_people = t_passed = 0
    for kaf_id, rows in by_kaf.items():
        rows.sort(key=lambda r: (-r["percent"], r["name"].lower()))
        passed = sum(1 for r in rows if r["passed"])
        t_people += len(rows)
        t_passed += passed
        groups.append(
            {
                "kafedra_id": kaf_id,
                "kafedra_name": kafedralar.get(kaf_id, ""),
                "count": len(rows),
                "passed": passed,
                "failed": len(rows) - passed,
                "avg_percent": round(sum(r["percent"] for r in rows) / len(rows)) if rows else 0,
                "people": rows,
            }
        )
    groups.sort(key=lambda g: g["kafedra_name"].lower())

    return {
        "generated_at": dj_tz.now().isoformat(),
        "season": season,
        "pass_threshold": threshold,
        "total_people": t_people,
        "total_passed": t_passed,
        "total_failed": t_people - t_passed,
        "groups": groups,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_participants(request):
    """Qatnashganlar — kafedra kesimida, ball va o'tdi/o'tmadi bilan."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response(build_participants_report(request.query_params.get("season")))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_participants_pdf(request):
    """Qatnashganlar ro'yxati — bosib chiqarish uchun PDF."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.kafedra_report_pdf import build_participants_report_pdf

    data = build_participants_report(request.query_params.get("season"))
    now = dj_tz.localtime(dj_tz.now())
    pdf = build_participants_report_pdf(data, now.strftime("%d.%m.%Y %H:%M"))
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = (
        'attachment; filename="qatnashganlar-' + now.strftime("%Y-%m-%d") + '.pdf"'
    )
    return resp

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_full_pdf(request):
    """To'liq hisobot: umumiy + qatnashganlar (ball bilan) + qatnashmaganlar."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.kafedra_report_pdf import build_full_report_pdf

    season_key = request.query_params.get("season")
    kaf = build_kafedra_report(season_key)
    part = build_participants_report(season_key)
    absent = build_absent_report(season_key)  # to'liq hisobotda ham faqat qatnashgan kafedralar
    now = dj_tz.localtime(dj_tz.now())
    pdf = build_full_report_pdf(kaf, part, absent, now.strftime("%d.%m.%Y %H:%M"))
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = (
        'attachment; filename="imtihon-hisoboti-' + now.strftime("%Y-%m-%d") + '.pdf"'
    )
    return resp
