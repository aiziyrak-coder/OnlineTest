"""Ro'yxat bo'yicha ommaviy ruxsat berish (admin).

Har safar ismlar ro'yxatini qo'lda bitta-bitta qidirib ruxsat berish uzoq
davom etardi. Bu yerda ikki qadam: avval ro'yxat TEKSHIRILADI (kim topildi,
kimda allaqachon ruxsat bor, kim topilmadi), keyin admin tasdiqlaydi.
Hech narsa avtomatik berilmaydi — tasdiqlash alohida so'rov.
"""
from __future__ import annotations

from datetime import timedelta as _timedelta

from django.db.models import Q
import re
import unicodedata

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.core.models import ExamGroup, ExamStudentException  # noqa: F401

#: Ro'yxatga tushadigan rollar (pullik: ruxsat talab qiladi).
BULK_ROLES = ("ordinator", "magistr", "vacancy", "entrant", "faculty", "student")

#: Guruh orqali biriktiriladigan toifa — imtihonlari kafedra bo'yicha emas,
#: ExamGroup orqali topiladi (harbiy xizmatga chaqiriluvchilar shu toifada).
GROUP_ROLES = ("student",)


def _norm_name(value: str) -> list[str]:
    """Ismni solishtirishga tayyorlaydi: apostrof, x/h va ‘/' farqi yo'qoladi."""
    s = unicodedata.normalize("NFKD", str(value or "")).lower()
    for a, b in (("‘", ""), ("’", ""), ("`", ""), ("ʻ", ""), ("ʼ", ""), ("'", ""), ("-", " ")):
        s = s.replace(a, b)
    s = s.replace("x", "h").replace("ц", "s")
    s = re.sub(r"[^a-zа-яё ]+", " ", s)
    parts = [p for p in s.split() if len(p) > 1]
    # "o'g'li", "qizi", "ogli" kabi qo'shimchalar solishtirishga kirmaydi.
    skip = {"ogli", "oglu", "qizi", "kizi", "zoda", "ovich", "evich", "ovna", "evna"}
    return [p for p in parts if p not in skip]


def _close(a: str, b: str) -> bool:
    """Bitta harf farqi (Dinara/Dinora, Solih/Solix) moslikni buzmasin.

    BIRINCHI harf esa bir xil bo'lishi shart: aks holda "Aliyev" va "Valiyev"
    kabi BUTUNLAY boshqa familiyalar bir-biriga mos kelib qolardi.
    """
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1 or min(len(a), len(b)) < 4:
        return False
    if a[:1] != b[:1]:
        return False
    if len(a) == len(b):
        return sum(1 for x, y in zip(a, b) if x != y) <= 1
    long_s, short_s = (a, b) if len(a) > len(b) else (b, a)
    for i in range(len(long_s)):
        if long_s[:i] + long_s[i + 1:] == short_s:
            return True
    return False


def _match(tokens: list[str], people: list[tuple]) -> list[tuple]:
    """Familiya + ism bo'yicha moslik (kamida ikki so'z mos kelsin)."""
    if len(tokens) < 2:
        return []
    exact = [p for p in people if p[2][:2] == tokens[:2]]
    if exact:
        return exact
    near = [p for p in people
            if len(p[2]) >= 2 and _close(p[2][0], tokens[0]) and _close(p[2][1], tokens[1])]
    if near:
        return near
    # Ism-familiya o'rni almashgan yoki otasining ismi qo'shilgan holat.
    ts = tokens[:3]
    out = []
    for p in people:
        hits = sum(1 for t in ts if any(_close(t, q) for q in p[2][:3]))
        if hits >= 2:
            out.append(p)
    return out


def _student_exam_options(u, exams: list) -> list[dict]:
    """Talaba imtihonlari: guruhi biriktirilgan va istisnoda bo'lmaganlari."""
    gid = getattr(u, "group_id", None)
    if not gid:
        return []
    ids = set(ExamGroup.objects.filter(group_id=gid).values_list("exam_id", flat=True))
    if not ids:
        return []
    blocked = set(
        ExamStudentException.objects.filter(student_id=u.pk, exam_id__in=ids)
        .values_list("exam_id", flat=True)
    )
    mine = [e for e in exams if e.id in ids and e.id not in blocked]
    now = dj_tz.now()
    mine.sort(key=lambda e: (0 if (e.end_time and e.end_time >= now) else 1, -e.id))
    return [
        {
            "id": e.id,
            "title": e.title,
            "open": bool(e.start_time and e.end_time and e.start_time <= now <= e.end_time),
        }
        for e in mine[:12]
    ]


def _exam_options(u, exams: list) -> list[dict]:
    """Shu kishiga mos imtihonlar — kafedra va kurs bo'yicha, yangisi birinchi."""
    role = str(getattr(u, "role", "") or "").lower()
    if role in GROUP_ROLES:
        return _student_exam_options(u, exams)
    course = int(getattr(u, "course", 0) or 0)
    same_kaf = [e for e in exams if e.audience == role and e.kafedra_id == u.kafedra_id]
    if course:
        by_course = [e for e in same_kaf if int(e.course or 0) in (0, course)]
        same_kaf = by_course or same_kaf
    # Hozir ochiq imtihon birinchi turadi — admin ro'yxatdan qidirib o'tirmasin.
    now = dj_tz.now()
    same_kaf.sort(key=lambda e: (0 if (e.end_time and e.end_time >= now) else 1, -e.id))
    return [
        {
            "id": e.id,
            "title": e.title,
            "open": bool(e.end_time and e.end_time >= now and (not e.start_time or e.start_time <= now)),
        }
        for e in same_kaf[:12]
    ]


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_bulk_access_preview(request):
    """Ro'yxatni tekshiradi — hech narsa o'zgartirmaydi."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    raw = str((request.data or {}).get("names") or "")
    lines = [ln.strip(" \t.,;") for ln in re.split(r"[\n;]+", raw)]
    lines = [ln for ln in lines if len(ln) > 2][:300]
    if not lines:
        return Response({"rows": [], "count": 0})

    users = list(AppUser.objects.filter(role__in=BULK_ROLES).only("id", "name", "role", "course", "kafedra_id"))
    people = [(u.pk, u, _norm_name(u.name)) for u in users]
    exams = list(
        Exam.objects.filter(audience__in=BULK_ROLES).order_by("-id").only(
            "id", "title", "audience", "course", "kafedra_id", "end_time", "start_time"
        )
    )
    rows = []
    for line in lines:
        tokens = _norm_name(line)
        found = _match(tokens, people)
        if not found:
            rows.append({"input": line, "status": "not_found"})
            continue
        if len(found) > 1:
            rows.append({
                "input": line, "status": "ambiguous",
                "candidates": [
                    {
                        "id": str(p[0]),
                        "name": p[1].name,
                        "kafedra": str(getattr(getattr(p[1], "kafedra", None), "name", "") or ""),
                        "course": int(getattr(p[1], "course", 0) or 0),
                        "exams": _exam_options(p[1], exams),
                    }
                    for p in found[:6]
                ],
            })
            continue
        u = found[0][1]
        ses = list(
            StudentExam.objects.filter(student_id=u.pk, exam__audience=str(u.role).lower())
            .select_related("exam")
        )
        done = [s for s in ses if (s.status or "") in ("Completed", "Banned")]
        open_ses = [s for s in ses if s.access_granted and (s.status or "") not in ("Completed", "Banned")]
        rows.append({
            "input": line,
            "status": "done" if done and not open_ses else ("has_access" if open_ses else "ok"),
            "user_id": str(u.pk),
            "name": u.name,
            "role": str(u.role or ""),
            "course": int(getattr(u, "course", 0) or 0),
            "kafedra": str(getattr(getattr(u, "kafedra", None), "name", "") or ""),
            "exams": _exam_options(u, exams),
            "history": [
                {
                    "exam_id": s.exam_id,
                    "exam_title": s.exam.title,
                    "status": s.status,
                    "score": s.score,
                }
                for s in ses[:6]
            ],
        })
    return Response({"rows": rows, "count": len(rows)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_bulk_access_grant(request):
    """Tasdiqlangan qatorlarga ruxsat beradi (va kerak bo'lsa imtihon oynasini bugunga ochadi)."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.views.ordinator import ONE_ATTEMPT_USED_MSG, OneAttemptUsed, grant_paid_attempt

    items = (request.data or {}).get("items") or []
    open_today = bool((request.data or {}).get("open_today"))
    out = []
    now = dj_tz.localtime()
    start = now.replace(second=0, microsecond=0) - _timedelta(minutes=2)
    end = now.replace(hour=18, minute=0, second=0, microsecond=0)
    # Kech soatda "bugunga ochish" tugash vaqtini boshlanishdan OLDIN qo'yardi.
    if end < now + _timedelta(hours=2):
        end = now.replace(second=0, microsecond=0) + _timedelta(hours=3)
    for it in items[:300]:
        uid = str((it or {}).get("user_id") or "").strip()
        try:
            eid = int((it or {}).get("exam_id") or 0)
        except (TypeError, ValueError):
            eid = 0
        u = AppUser.objects.filter(pk=uid).first()
        exam = Exam.objects.filter(pk=eid).first()
        if not u or not exam:
            out.append({"user_id": uid, "ok": False, "error": "Topilmadi"})
            continue
        # Imtihon shu odamga mos kelmasa, ruxsat berilsa ham u imtihonni ko'rmaydi
        # ("test ko'rinmayapti" shikoyatlari) — oldindan aytamiz.
        _urole = str(u.role or "").strip().lower()
        _eaud = str(exam.audience or "student").strip().lower()
        _mismatch = ""
        if _urole in GROUP_ROLES and _eaud in ("student", "", None):
            if not ExamGroup.objects.filter(exam_id=exam.id, group_id=u.group_id).exists():
                _mismatch = "imtihon bu talabaning guruhiga biriktirilmagan"
            elif ExamStudentException.objects.filter(exam_id=exam.id, student_id=u.pk).exists():
                _mismatch = "talaba bu imtihonning istisno ro'yxatida"
        elif _urole != _eaud:
            _mismatch = "imtihon boshqa toifa uchun (%s), bu kishi — %s" % (_eaud, _urole)
        elif _urole != "student" and exam.kafedra_id and u.kafedra_id and exam.kafedra_id != u.kafedra_id:
            _mismatch = "imtihon boshqa kafedraga tegishli"
        elif (int(getattr(exam, "course", 0) or 0) and int(getattr(u, "course", 0) or 0)
              and int(exam.course) != int(u.course)):
            _mismatch = "imtihon %s-kurs uchun, bu kishi %s-kurs" % (exam.course, u.course)
        if _mismatch:
            out.append({"user_id": uid, "name": u.name, "ok": False,
                        "error": "Mos emas: %s — kishi imtihonni ko'rmaydi" % _mismatch})
            continue
        se = StudentExam.objects.filter(student_id=u.pk, exam_id=exam.id).first()
        if se and (se.status or "") in ("Completed", "Banned"):
            out.append({
                "user_id": uid, "name": u.name, "ok": False,
                "error": "Bu imtihonni allaqachon topshirgan (%s) — qayta ruxsatni hisobotdan bering" % se.status,
            })
            continue
        try:
            grant_paid_attempt(str(u.pk), exam.id)
        except OneAttemptUsed:
            out.append({"user_id": uid, "name": u.name, "ok": False, "error": ONE_ATTEMPT_USED_MSG})
            continue
        except Exception as ex:  # noqa: BLE001
            out.append({"user_id": uid, "name": u.name, "ok": False, "error": str(ex)[:120]})
            continue
        if open_today and (exam.end_time is None or exam.end_time < dj_tz.now()):
            Exam.objects.filter(pk=exam.id).update(start_time=start, end_time=end)
        audit(request, "grant_exam_access", "user", str(u.pk), u.name, "ro'yxat orqali, exam=%s" % exam.id)
        out.append({"user_id": uid, "name": u.name, "ok": True, "exam_id": exam.id, "exam_title": exam.title})
    return Response({
        "results": out,
        "granted": sum(1 for r in out if r.get("ok")),
        "failed": sum(1 for r in out if not r.get("ok")),
        "window": {"start": start.isoformat(), "end": end.isoformat()} if open_today else None,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_bulk_access_people(request):
    """Ruxsat berish uchun ro'yxat: filtrlangan odamlar + ularning holati va mos imtihonlari."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    role = str(request.query_params.get("role") or "ordinator").strip().lower()
    if role not in BULK_ROLES:
        role = "ordinator"
    q = str(request.query_params.get("q") or "").strip()
    try:
        course = int(request.query_params.get("course") or 0)
    except (TypeError, ValueError):
        course = 0
    try:
        kaf = int(request.query_params.get("kafedra_id") or 0)
    except (TypeError, ValueError):
        kaf = 0
    state = str(request.query_params.get("state") or "").strip()

    users = AppUser.objects.filter(role=role).select_related("kafedra")
    if role in GROUP_ROLES and not q:
        # Talabalar minglab — qidiruvsiz ro'yxat ma'nosiz bo'lardi.
        return Response({
            "rows": [], "count": 0, "kafedras": [], "courses": [],
            "need_query": True,
            "hint": "Talabani topish uchun familiya, ism yoki login yozing.",
        })
    if course:
        users = users.filter(course=course)
    if kaf:
        users = users.filter(kafedra_id=kaf)
    if q:
        users = users.filter(Q(name__icontains=q) | Q(id__icontains=q))
    users = list(users.order_by("kafedra__name", "name")[:800])
    ids = [u.pk for u in users]

    exams = list(
        Exam.objects.filter(audience=role).order_by("-id").only(
            "id", "title", "audience", "course", "kafedra_id", "start_time", "end_time"
        )
    )
    ses_by_user: dict[str, list] = {}
    for se in StudentExam.objects.filter(student_id__in=ids, exam__audience=role).select_related("exam").order_by("-id"):
        ses_by_user.setdefault(str(se.student_id), []).append(se)

    rows = []
    for u in users:
        ses = ses_by_user.get(str(u.pk), [])
        done = [s for s in ses if (s.status or "") in ("Completed", "Banned")]
        live = [s for s in ses if s.access_granted and (s.status or "") not in ("Completed", "Banned")]
        st = "done" if done and not live else ("has_access" if live else "none")
        rows.append({
            "id": str(u.pk),
            "name": u.name,
            "course": int(getattr(u, "course", 0) or 0),
            "kafedra": str(getattr(u.kafedra, "name", "") or ""),
            "kafedra_id": u.kafedra_id,
            "has_photo": bool(u.profile_image and len(u.profile_image) > 50),
            "state": st,
            "exams": _exam_options(u, exams),
            "history": [
                {
                    "exam_id": s.exam_id,
                    "exam_title": s.exam.title,
                    "status": s.status,
                    "score": s.score,
                }
                for s in ses[:4]
            ],
        })
    if state in ("none", "has_access", "done"):
        rows = [r for r in rows if r["state"] == state]

    kafs = sorted(
        {(r["kafedra_id"], r["kafedra"]) for r in rows if r["kafedra_id"]},
        key=lambda x: x[1],
    )
    return Response({
        "rows": rows,
        "count": len(rows),
        "kafedras": [{"id": k, "name": n} for k, n in kafs],
        "courses": sorted({r["course"] for r in rows if r["course"]}),
    })
