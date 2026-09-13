"""Ordinator / magistr moduli — ADMIN tomoni.

Bu yerda:
  * Ordinatorlar va magistrlar ro'yxati (kim to'lagan, kim topshirgan,
    nechta urinish qolgan) — `admin_examinees`.
  * Ro'yxatga yangi ordinator/magistr qo'shish, parolini tiklash, o'chirish.
  * Imtihon savol bankini ADMIN yuklaydi (AI EMAS): PDF / DOCX / matn
    fayldan mahalliy parser bilan o'qib `Exam.questions_json` ga yoziladi.
    Har bir topshiruvchiga shu bankdan tasodifiy `bank_question_count` ta
    savol tushadi va har urinishda boshqasi beriladi (`views/ordinator.py`).
"""
from __future__ import annotations

import json

from django.db.models import Q
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.api.views._helpers import (
    MIN_APP_PASSWORD_LEN,
    IsAuthenticated,
    _hash_pw,
    _request_user_role_norm,
    audit,
    safe_json_loads,
)
from apps.api.views.ordinator import FREE_TECH_RETRIES, PAID_ROLES, access_state, served_ids
from apps.core.models import (
    AppUser,
    Exam,
    Kafedra,
    PaymentReceipt,
    StudentExam,
    ViolationLog,
)

#: Savol banki fayli uchun chegara — DAK banklari katta bo'ladi.
MAX_BANK_PAGES = 200
MAX_BANK_BYTES = 20 * 1024 * 1024


def _is_admin(request) -> bool:
    return _request_user_role_norm(request.user) == "admin"


#: Admin panelidagi «topshiruvchilar» sahifalari (Ordinatorlar, Magistrlar,
#: Maxsus kiruvchilar). `PAID_ROLES` dan ATAYLAB alohida: u to'lov
#: darvozasini boshqaradi va unga `entrant` qo'shilsa maxsus kiruvchi
#: to'lov tasdig'ini kutib qolardi.
ADMIN_EXAMINEE_ROLES = ("ordinator", "magistr", "entrant")


def _norm_role(raw) -> str:
    role = str(raw or "").strip().lower()
    return role if role in ADMIN_EXAMINEE_ROLES else "ordinator"


# ---------------------------------------------------------------- ro'yxat --


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_examinees(request):
    """Ordinatorlar / magistrlar ro'yxati va yangisini qo'shish."""
    if not _is_admin(request):
        return Response({"error": "Forbidden"}, status=403)

    if request.method == "POST":
        d = request.data or {}
        uid = str(d.get("id") or "").strip()[:64]
        name = str(d.get("name") or "").strip()[:255]
        role = _norm_role(d.get("role"))
        password = str(d.get("password") or "").strip()
        try:
            kafedra_id = int(d.get("kafedra_id") or 0) or None
        except (TypeError, ValueError):
            kafedra_id = None
        if not uid or not name:
            return Response({"error": "ID va F.I.Sh majburiy"}, status=400)
        if not password:
            password = uid  # login = parol (o'qituvchilardagi kabi PINFL)
        if len(password) < MIN_APP_PASSWORD_LEN:
            return Response(
                {"error": f"Parol kamida {MIN_APP_PASSWORD_LEN} belgi bo'lishi kerak"},
                status=400,
            )
        try:
            course = int(d.get("course") or 0)
        except (TypeError, ValueError):
            course = 0
        course = course if 0 <= course <= 6 else 0
        if kafedra_id and not Kafedra.objects.filter(pk=kafedra_id).exists():
            return Response({"error": "Kafedra topilmadi"}, status=400)
        if AppUser.objects.filter(pk=uid).exists():
            return Response({"error": "Bunday ID allaqachon mavjud"}, status=400)
        AppUser.objects.create(
            id=uid,
            password=_hash_pw(password),
            role=role,
            name=name,
            status="Active",
            kafedra_id=kafedra_id,
            course=course,
        )
        audit(request, "create_examinee", "user", uid, name, f"role={role}")
        return Response({"ok": True, "id": uid, "password": password}, status=201)

    role = _norm_role(request.query_params.get("role"))
    q = str(request.query_params.get("q") or "").strip()
    try:
        kaf_f = int(request.query_params.get("kafedra_id") or 0) or None
    except (TypeError, ValueError):
        kaf_f = None

    users = AppUser.objects.filter(role=role).select_related("kafedra")
    try:
        course_f = int(request.query_params.get("course") or 0)
    except (TypeError, ValueError):
        course_f = 0
    if course_f:
        users = users.filter(course=course_f)
    if kaf_f:
        users = users.filter(kafedra_id=kaf_f)
    if q:
        users = users.filter(Q(name__icontains=q) | Q(id__icontains=q))
    users = users.order_by("kafedra__name", "name")[:1000]
    user_ids = [u.id for u in users]

    exams = {
        e.id: e
        for e in Exam.objects.filter(audience=role).select_related("kafedra")
    }
    ses_by_user: dict[str, list] = {}
    for se in StudentExam.objects.filter(
        student_id__in=user_ids, exam_id__in=list(exams.keys())
    ).order_by("-id"):
        ses_by_user.setdefault(str(se.student_id), []).append(se)

    receipts_by_user: dict[str, dict] = {}
    for r in PaymentReceipt.objects.filter(student_id__in=user_ids).order_by("-created_at"):
        receipts_by_user.setdefault(
            str(r.student_id),
            {"status": r.status, "created_at": r.created_at.isoformat(), "id": r.id},
        )

    rows = []
    for u in users:
        sessions = []
        for se in ses_by_user.get(str(u.id), []):
            e = exams.get(se.exam_id)
            st = access_state(se, e, role) if e else {}
            # --- natija tafsilotlari (admin uchun) ---
            from collections import Counter as _Counter

            from apps.api.certificate_pdf import exam_pass_threshold

            _qs = safe_json_loads(se.session_questions_json or "", []) or []
            _total = len(_qs) or int(getattr(e, "bank_question_count", 0) or 0)
            _ans = safe_json_loads(se.answers_json or "", {}) or {}
            if not _ans:
                _ans = safe_json_loads(se.draft_answers_json or "", {}) or {}
            _pct = (
                round((se.score or 0) / _total * 100)
                if (se.score is not None and _total)
                else None
            )
            _thr = exam_pass_threshold(e) if e else 0
            _vq = ViolationLog.objects.filter(student_id=se.student_id, exam_id=se.exam_id)
            _vtypes = _Counter(_vq.values_list("violation_type", flat=True))
            sessions.append(
                {
                    "student_exam_id": se.id,
                    "exam_id": se.exam_id,
                    "exam_title": str(getattr(e, "title", "") or ""),
                    "status": se.status,
                    "score": se.score,
                    "access_granted": bool(getattr(se, "access_granted", False)),
                    "paid_attempts": int(getattr(se, "paid_attempts_granted", 0) or 0),
                    "tech_retries_used": int(getattr(se, "technical_retakes_used", 0) or 0),
                    "tech_retries_left": st.get("tech_retries_left", FREE_TECH_RETRIES),
                    "served_total": len(served_ids(se)),
                    "locked": bool(st.get("locked")),
                    "lock_code": st.get("code") or "",
                    "one_attempt": bool(st.get("one_attempt")),
                    "ban_reason": se.ban_reason or "",
                    "started_at": se.started_at.isoformat() if se.started_at else None,
                    "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                    "answered": len(_ans),
                    "total": _total,
                    "percent": _pct,
                    "pass_threshold": _thr,
                    "passed": (_pct is not None and _pct >= _thr),
                    "warnings": int(se.proctor_official_warnings or 0),
                    "violations": sum(_vtypes.values()),
                    "violation_types": dict(_vtypes.most_common(6)),
                }
            )
        rows.append(
            {
                "id": str(u.id),
                "name": u.name,
                "status": u.status,
                "kafedra_id": u.kafedra_id,
                "kafedra_name": str(getattr(u.kafedra, "name", "") or ""),
                "course": int(getattr(u, "course", 0) or 0),
                "has_photo": bool(u.profile_image and len(u.profile_image) > 50),
                "sessions": sessions,
                "last_receipt": receipts_by_user.get(str(u.id)),
            }
        )

    return Response(
        {
            "role": role,
            "total": len(rows),
            "examinees": rows,
            "exams": [
                {
                    "id": e.id,
                    "title": e.title,
                    "kafedra_id": e.kafedra_id,
                    "kafedra_name": str(getattr(e.kafedra, "name", "") or ""),
                    "faculty_subject": e.faculty_subject or "",
                    "question_count": len(safe_json_loads(e.questions_json, [])),
                    "per_student": int(e.bank_question_count or 0),
                    "course": int(getattr(e, "course", 0) or 0),
                }
                for e in exams.values()
            ],
            "kafedras": [
                {"id": k.id, "name": k.name}
                for k in Kafedra.objects.filter(is_active=True).order_by("name")
            ],
            "pending_receipts": PaymentReceipt.objects.filter(
                status=PaymentReceipt.STATUS_PENDING
            ).count(),
        }
    )


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_examinee_detail(request, user_id: str):
    """Ordinator/magistrni tahrirlash yoki o'chirish."""
    if not _is_admin(request):
        return Response({"error": "Forbidden"}, status=403)
    u = AppUser.objects.filter(pk=user_id).first()
    if not u or str(u.role or "").lower() not in ADMIN_EXAMINEE_ROLES:
        return Response({"error": "Topilmadi"}, status=404)

    if request.method == "DELETE":
        name = u.name
        u.delete()
        audit(request, "delete_examinee", "user", user_id, name, "")
        return Response({"ok": True})

    d = request.data or {}
    fields = []
    if d.get("name"):
        u.name = str(d["name"]).strip()[:255]
        fields.append("name")
    if "kafedra_id" in d:
        try:
            kid = int(d.get("kafedra_id") or 0) or None
        except (TypeError, ValueError):
            kid = None
        if kid and not Kafedra.objects.filter(pk=kid).exists():
            return Response({"error": "Kafedra topilmadi"}, status=400)
        u.kafedra_id = kid
        fields.append("kafedra_id")
    if d.get("status") in ("Active", "Banned"):
        u.status = d["status"]
        fields.append("status")
    if "course" in d:
        try:
            cv = int(d.get("course") or 0)
        except (TypeError, ValueError):
            cv = 0
        u.course = cv if 0 <= cv <= 6 else 0
        fields.append("course")
    if "profile_image" in d:
        from apps.api.views._helpers import validate_profile_image_b64

        img = d.get("profile_image") or ""
        if img:
            err = validate_profile_image_b64(img)
            if err:
                return Response({"error": err}, status=400)
        u.profile_image = img
        fields.append("profile_image")
    new_pw = str(d.get("password") or "").strip()
    if new_pw:
        if len(new_pw) < MIN_APP_PASSWORD_LEN:
            return Response(
                {"error": f"Parol kamida {MIN_APP_PASSWORD_LEN} belgi bo'lishi kerak"},
                status=400,
            )
        u.password = _hash_pw(new_pw)
        fields.append("password")
    if fields:
        u.save(update_fields=fields)
    audit(request, "update_examinee", "user", user_id, u.name, ",".join(fields))
    return Response({"ok": True, **({"password": new_pw} if new_pw else {})})


# ------------------------------------------------------------ savol banki --


def _extract_bank_text(raw: bytes, filename: str) -> str:
    """PDF / DOCX / TXT dan matn — AI ishlatilmaydi."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        if not raw.startswith(b"%PDF"):
            raise ValueError("Yaroqsiz PDF fayl")
        from io import BytesIO

        from pypdf import PdfReader

        reader = PdfReader(BytesIO(raw))
        if len(reader.pages) > MAX_BANK_PAGES:
            raise ValueError(
                f"PDF juda katta ({len(reader.pages)} bet). Maksimal {MAX_BANK_PAGES} bet."
            )
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    if name.endswith(".docx"):
        from io import BytesIO

        from docx import Document

        return "\n".join(p.text for p in Document(BytesIO(raw)).paragraphs if p.text.strip())
    if name.endswith((".txt", ".csv", ".md")):
        return raw.decode("utf-8", errors="replace")
    raise ValueError("Faqat PDF, DOCX yoki TXT fayl qabul qilinadi")


def _parse_bank(text: str, language: str = "auto") -> list[dict]:
    """Matnni savollarga ajratadi. Ikkala mahalliy parser ham sinab ko'riladi."""
    from apps.api.gemini_tools import (
        parse_flexible_questionnaire,
        parse_structured_questionnaire,
    )

    best: list[dict] = []
    for fn in (parse_flexible_questionnaire, parse_structured_questionnaire):
        try:
            got = fn(text, language) or []
        except Exception:
            got = []
        if len(got) > len(best):
            best = got
    return best


def _clean_questions(raw: list) -> tuple[list[dict], list[str]]:
    """Savollarni normallashtiradi va yaroqsizlarini sabab bilan qaytaradi."""
    out: list[dict] = []
    problems: list[str] = []
    for i, q in enumerate(raw or [], start=1):
        if not isinstance(q, dict):
            continue
        text = str(q.get("text") or q.get("question") or "").strip()
        opts_raw = q.get("options") or q.get("variants") or []
        opts = [str(o).strip() for o in opts_raw if str(o).strip()]
        ans = str(q.get("correctAnswer") or q.get("answer") or "").strip()
        if not text or len(opts) < 2:
            problems.append(f"{i}-savol: matn yoki variantlar yetarli emas")
            continue
        if ans not in opts:
            # Javob "A" / "1" ko'rinishida bo'lishi mumkin.
            key = ans.strip().rstrip(").:").upper()
            idx = None
            if len(key) == 1 and key.isalpha():
                idx = ord(key) - ord("A")
            elif key.isdigit():
                idx = int(key) - 1
            if idx is not None and 0 <= idx < len(opts):
                ans = opts[idx]
            else:
                problems.append(f"{i}-savol: to'g'ri javob aniqlanmadi")
                continue
        item = {
            "id": len(out) + 1,
            "text": text,
            "options": opts,
            "correctAnswer": ans,
        }
        for extra in ("text_ru", "text_en", "options_ru", "options_en", "explanation"):
            if q.get(extra):
                item[extra] = q[extra]
        out.append(item)
    return out, problems


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_exam_question_bank(request, pk: int):
    """Imtihon savol banki: ko'rish va ADMIN tomonidan yuklash.

    POST: `file` (PDF/DOCX/TXT) yoki `raw_text` yoki `questions` (JSON ro'yxat).
    `per_student` — har bir topshiruvchiga nechta savol tushishi (default 20).
    `mode=append` bo'lsa bankka qo'shiladi, aks holda almashtiriladi.
    """
    if not _is_admin(request):
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Imtihon topilmadi"}, status=404)

    current = safe_json_loads(exam.questions_json, [])
    if request.method == "GET":
        return Response(
            {
                "exam_id": exam.id,
                "title": exam.title,
                "audience": exam.audience,
                "exam_mode": exam.exam_mode,
                "per_student": int(exam.bank_question_count or 0),
                "total": len(current),
                "preview": current[:5],
            }
        )

    d = request.data or {}
    language = str(d.get("language") or exam.language or "auto").lower()[:4]
    parsed: list = []
    f = request.FILES.get("file")
    if f:
        raw = f.read()
        if len(raw) > MAX_BANK_BYTES:
            return Response({"error": "Fayl juda katta (20 MB dan oshmasin)"}, status=400)
        try:
            text = _extract_bank_text(raw, getattr(f, "name", "") or "")
        except ValueError as ex:
            return Response({"error": str(ex)}, status=400)
        parsed = _parse_bank(text, language)
    elif d.get("questions"):
        rawq = d["questions"]
        parsed = safe_json_loads(rawq, []) if isinstance(rawq, str) else list(rawq)
    elif d.get("raw_text"):
        parsed = _parse_bank(str(d["raw_text"]), language)
    else:
        return Response({"error": "Fayl yoki matn yuboring"}, status=400)

    questions, problems = _clean_questions(parsed)
    if not questions:
        return Response(
            {
                "error": "Faylda yaroqli savol topilmadi. Format: savol matni, "
                "A) B) C) D) variantlar va javoblar kaliti.",
                "problems": problems[:20],
            },
            status=400,
        )

    if str(d.get("mode") or "").lower() == "append":
        questions = list(current) + questions
        for i, q in enumerate(questions, start=1):
            q["id"] = i

    try:
        per = int(d.get("per_student") or exam.bank_question_count or 20)
    except (TypeError, ValueError):
        per = 20
    per = max(1, min(per, len(questions)))

    exam.questions_json = json.dumps(questions, ensure_ascii=False)
    exam.bank_question_count = per
    if exam.exam_mode not in ("bank_mixed", "imentor_mixed", "faculty_ai_books", "vacancy_ai"):
        exam.exam_mode = "static"
    exam.save(update_fields=["questions_json", "bank_question_count", "exam_mode"])
    # Javoblar kaliti umuman topilmagan bo'lsa, parser hamma joyda birinchi
    # variantni "to'g'ri" deb qo'yishi mumkin. Bu imtihonni ma'nosiz qiladi,
    # shuning uchun adminni OGOHLANTIRAMIZ (yuklashni to'xtatmaymiz — ba'zi
    # banklarda to'g'ri javob haqiqatan ham birinchi bo'lib yoziladi).
    first_opt = sum(1 for q in questions if q["correctAnswer"] == q["options"][0])
    warning = ""
    if len(questions) >= 10 and first_opt >= len(questions) * 0.9:
        warning = (
            "Diqqat: savollarning %d%% ida to'g'ri javob birinchi variant. "
            "Javoblar kaliti topilmagan bo'lishi mumkin — hujjatda "
            "\"Javoblar kaliti:\" bo'limi borligini tekshiring."
            % round(first_opt * 100 / len(questions))
        )

    audit(
        request,
        "exam_question_bank_upload",
        "exam",
        exam.id,
        exam.title,
        f"total={len(questions)}, per_student={per}",
    )
    return Response(
        {
            "ok": True,
            "total": len(questions),
            "per_student": per,
            "skipped": len(problems),
            "problems": problems[:20],
            "warning": warning,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_examinee_grant_access(request, user_id: str):
    """Nomzodga imtihonga BITTA urinish ochadi (to'lov tasdiqlangach).

    Sessiya hali umuman bo'lmasa ham ishlaydi — `grant_paid_attempt` uni
    yaratadi. Shu sabab ro'yxatdagi har bir kishida "Ruxsat berish" tugmasi
    bor, kutish shart emas.
    """
    from apps.api.views.ordinator import ONE_ATTEMPT_USED_MSG, OneAttemptUsed, grant_paid_attempt

    if not _is_admin(request):
        return Response({"error": "Forbidden"}, status=403)
    u = AppUser.objects.filter(pk=user_id).first()
    if not u or str(u.role or "").lower() not in ADMIN_EXAMINEE_ROLES:
        return Response({"error": "Topilmadi"}, status=404)
    try:
        exam_id = int((request.data or {}).get("exam_id") or 0) or None
    except (TypeError, ValueError):
        exam_id = None
    if not exam_id:
        qs_ex = Exam.objects.filter(
            audience=str(u.role).lower(), kafedra_id=u.kafedra_id
        )
        # Foydalanuvchi kursi bo'lsa — o'sha kursning imtihoni.
        ucourse = int(getattr(u, "course", 0) or 0)
        if ucourse:
            from django.db.models import Q as _Q

            qs_ex = qs_ex.filter(_Q(course=0) | _Q(course=ucourse))
        exam = qs_ex.order_by("-id").first()
        exam_id = exam.id if exam else None
    if not exam_id:
        return Response({"error": "Imtihon tanlanmadi"}, status=400)
    try:
        opened = grant_paid_attempt(str(u.id), exam_id)
    except OneAttemptUsed:
        return Response({"error": ONE_ATTEMPT_USED_MSG, "code": "ONE_ATTEMPT_USED"}, status=409)
    if not opened:
        return Response({"error": "Urinish ochilmadi"}, status=400)
    audit(request, "grant_exam_access", "user", str(u.id), u.name, f"exam={exam_id}")
    return Response({"ok": True, "opened": opened})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_examinee_revoke_access(request, user_id: str):
    """Xato berilgan ruxsatni qaytarib oladi."""
    if not _is_admin(request):
        return Response({"error": "Forbidden"}, status=403)
    try:
        exam_id = int((request.data or {}).get("exam_id") or 0) or None
    except (TypeError, ValueError):
        exam_id = None
    qs = StudentExam.objects.filter(student_id=user_id)
    if exam_id:
        qs = qs.filter(exam_id=exam_id)
    n = qs.update(access_granted=False)
    audit(request, "revoke_exam_access", "user", user_id, "", f"exam={exam_id}")
    return Response({"ok": True, "updated": n})
