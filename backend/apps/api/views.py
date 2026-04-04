"""REST marshrutlar — Express server.ts bilan mos."""
from __future__ import annotations

import json
import os
import secrets
import tempfile
from datetime import datetime

import bcrypt
from django.db import transaction
from django.db.models import Count
from django.http import HttpResponse
from django.utils import timezone as dj_tz
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.api.authentication import issue_token
from apps.api.permissions import IsAuthenticatedStrict as IsAuthenticated
from apps.api.exam_time import seconds_until_deadline, submission_deadline
from apps.api.throttles import (
    BankAiImportThrottle,
    ExamAutosaveThrottle,
    FaceVerifyThrottle,
    LoginThrottle,
    PublicVerifyThrottle,
)
from apps.api.certificate_pdf import build_certificate_pdf
from apps.api.gemini_tools import (
    compare_faces,
    generate_bank_extension,
    generate_exam_ai_summary,
    parse_and_classify_questionnaire,
)
from apps.api.services import (
    assert_safe_result_public_id,
    build_fallback_ai_summary,
    build_student_question_list,
    integrity_code,
    next_result_public_id,
    extract_text_from_bank_upload,
    parse_pdf_questions,
    public_base_url,
    shuffle_in_place,
)
from apps.api.view_utils import norm_answers, parse_iso_datetime, safe_json_loads
from apps.core.models import (
    AppUser,
    Exam,
    ExamGroup,
    Group,
    Level,
    StudentExam,
    TestBankCategory,
    TestBankQuestion,
    ViolationLog,
)


def _check_pw(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


# --- Public / auth ---


@api_view(["GET"])
@permission_classes([AllowAny])
def health(_request):
    from django.db import connection

    try:
        connection.ensure_connection()
        db_ok = True
    except Exception:
        db_ok = False
    return Response({"ok": True, "database": db_ok})


@api_view(["POST"])
@throttle_classes([LoginThrottle])
@permission_classes([AllowAny])
def auth_login(request):
    uid = (request.data or {}).get("id")
    password = (request.data or {}).get("password")
    if not uid or not password:
        return Response({"error": "ID and password are required"}, status=400)
    user = AppUser.objects.filter(pk=uid).first()
    if not user or not _check_pw(password, user.password):
        return Response({"error": "Invalid credentials"}, status=401)
    if user.status == "Banned":
        return Response({"error": "Your account is banned. Contact administrator."}, status=403)
    if user.role == "teacher":
        return Response(
            {"error": "Teacher role is no longer supported. Use an admin or student account."},
            status=403,
        )
    return Response(
        {
            "token": issue_token(user),
            "user": {
                "id": user.id,
                "role": user.role,
                "name": user.name,
                "status": user.status,
                "group_id": user.group_id,
                "profile_image": user.profile_image or None,
            },
        }
    )


@api_view(["POST"])
@throttle_classes([FaceVerifyThrottle])
@permission_classes([IsAuthenticated])
def student_identity_compare(request):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    body = request.data or {}
    p_raw = body.get("profile_image_base64")
    l_raw = body.get("live_capture_base64")
    if not isinstance(p_raw, str) or not isinstance(l_raw, str):
        return Response({"error": "Invalid body"}, status=400)

    def strip(s: str) -> str:
        t = s.strip()
        return t.split(",", 1)[1].strip() if "," in t else t

    p, l = strip(p_raw), strip(l_raw)
    max_b64 = 14 * 1024 * 1024
    if len(p) < 80 or len(l) < 80 or len(p) > max_b64 or len(l) > max_b64:
        return Response({"error": "Invalid image payload"}, status=400)
    result = compare_faces(p_raw, l_raw)
    if not result.get("success"):
        code = result.get("code") or "GEMINI_ERROR"
        if code == "GEMINI_UNAVAILABLE":
            # Kalit sozlanmagan — tekshiruv ixtiyoriy, o'tkazib yuboramiz
            return Response({"match": True, "skipped": True, "code": code}, status=200)
        # GEMINI_ERROR: vaqtinchalik texnik xato — ixtiyoriy, o'tkazib yuboramiz
        return Response({"match": True, "skipped": True, "code": code}, status=200)
    return Response({"match": bool(result.get("match"))})


# --- Admin: users ---


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_users(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        rows = []
        for u in AppUser.objects.select_related("group").all():
            rows.append(
                {
                    "id": u.id,
                    "role": u.role,
                    "name": u.name,
                    "status": u.status,
                    "group_id": u.group_id,
                    "profile_image": u.profile_image,
                    "group_name": u.group.name if u.group_id else None,
                }
            )
        return Response(rows)
    d = request.data or {}
    uid, password, role, name = d.get("id"), d.get("password"), d.get("role"), d.get("name")
    group_id = d.get("group_id")
    profile_image = d.get("profile_image")
    if not uid or not password or not role or not name:
        return Response({"error": "Missing required fields"}, status=400)
    if role not in ("admin", "student"):
        return Response({"error": "Role must be admin or student"}, status=400)
    if role == "student" and (not profile_image or len(str(profile_image)) < 50):
        return Response({"error": "Talaba uchun profil rasmi majburiy"}, status=400)
    if AppUser.objects.filter(pk=uid).exists():
        return Response({"error": "User ID already exists"}, status=400)
    gid = None if group_id in ("", None) else group_id
    AppUser.objects.create(
        id=uid,
        password=_hash_pw(str(password)),
        role=role,
        name=name,
        group_id=gid,
        profile_image=profile_image or "",
    )
    return Response({"success": True})


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_user_detail(request, user_id: str):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "DELETE":
        if user_id == request.user.id:
            return Response({"error": "Cannot delete your own account"}, status=400)
        row = AppUser.objects.filter(pk=user_id).first()
        if not row:
            return Response({"error": "User not found"}, status=404)
        if row.role == "admin" and AppUser.objects.filter(role="admin").count() <= 1:
            return Response({"error": "Cannot delete the last admin"}, status=400)
        row.delete()
        return Response({"success": True})
    row = AppUser.objects.filter(pk=user_id).first()
    if not row:
        return Response({"error": "User not found"}, status=404)
    d = request.data or {}
    next_role = d["role"] if "role" in d else row.role
    next_profile = d["profile_image"] if "profile_image" in d else row.profile_image
    if "role" in d and d["role"] not in ("admin", "student"):
        return Response({"error": "Invalid role"}, status=400)
    if row.role == "admin" and next_role == "student":
        if AppUser.objects.filter(role="admin").count() <= 1:
            return Response({"error": "Cannot demote the last admin"}, status=400)
    if next_role == "student" and (not next_profile or len(str(next_profile)) < 50):
        return Response({"error": "Student requires a profile photo"}, status=400)
    if "status" in d and d["status"] not in ("Active", "Banned"):
        return Response({"error": "Invalid status"}, status=400)
    if "name" in d:
        row.name = str(d["name"])
    if "role" in d:
        row.role = next_role
    if "group_id" in d:
        v = d["group_id"]
        row.group_id = None if v in ("", None) else v
    if "status" in d:
        row.status = d["status"]
    if "profile_image" in d:
        row.profile_image = d["profile_image"] or ""
    if d.get("password"):
        if len(str(d["password"])) < 6:
            return Response({"error": "Password min 6 characters"}, status=400)
        row.password = _hash_pw(str(d["password"]))
    touched = any(
        k in d for k in ("name", "role", "group_id", "status", "profile_image", "password")
    )
    if not touched:
        return Response({"error": "No fields to update"}, status=400)
    row.save()
    return Response({"success": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_users_unban(request, user_id: str):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    with transaction.atomic():
        AppUser.objects.filter(pk=user_id).update(status="Active")
        StudentExam.objects.filter(student_id=user_id, status="Banned").update(status="Pending")
    return Response({"success": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_student_exams_retake(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    # Express: faqat status, answers_json, score — qayta topshirish uchun
    updated = StudentExam.objects.filter(pk=pk).update(
        status="Pending",
        answers_json="",
        score=None,
        draft_answers_json="{}",
        draft_flagged_json="[]",
        draft_updated_at=None,
    )
    if not updated:
        return Response({"error": "Not found"}, status=404)
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_stats(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response(
        {
            "totalUsers": AppUser.objects.count(),
            "totalExams": Exam.objects.count(),
            "totalViolations": ViolationLog.objects.count(),
            "bannedUsers": AppUser.objects.filter(status="Banned").count(),
        }
    )


# --- Admin: levels / groups ---


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_levels(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response(list(Level.objects.values()))


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_groups(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        out = []
        for g in Group.objects.select_related("level").all():
            out.append(
                {
                    "id": g.id,
                    "name": g.name,
                    "level_id": g.level_id,
                    "level_name": g.level.name,
                }
            )
        return Response(out)
    d = request.data or {}
    name, level_id = d.get("name"), d.get("level_id")
    if not name or not level_id:
        return Response({"error": "Name and level_id are required"}, status=400)
    g = Group.objects.create(name=name, level_id=level_id)
    return Response({"success": True, "id": g.id})


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_group_detail(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "DELETE":
        n, _ = Group.objects.filter(pk=pk).delete()
        if not n:
            return Response({"error": "Group not found"}, status=404)
        return Response({"success": True})
    g = Group.objects.filter(pk=pk).first()
    if not g:
        return Response({"error": "Group not found"}, status=404)
    d = request.data or {}
    if "level_id" in d and d["level_id"] is not None:
        if not Level.objects.filter(pk=d["level_id"]).exists():
            return Response({"error": "Invalid level"}, status=400)
    if "name" in d and "level_id" in d:
        g.name, g.level_id = d["name"], d["level_id"]
    elif "name" in d:
        g.name = d["name"]
    elif "level_id" in d:
        g.level_id = d["level_id"]
    else:
        return Response({"error": "No fields to update"}, status=400)
    g.save()
    return Response({"success": True})


# --- Test bank ---


def _get_or_create_bank_category(name: str, description: str) -> TestBankCategory:
    name_clean = (name or "").strip()[:300] or "Umumiy"
    existing = TestBankCategory.objects.filter(name__iexact=name_clean).first()
    if existing:
        desc = (description or "").strip()
        if desc and not (existing.description or "").strip():
            existing.description = desc[:10000]
            existing.save(update_fields=["description"])
        return existing
    return TestBankCategory.objects.create(
        name=name_clean,
        description=((description or "").strip()[:10000]) if description else "",
    )


@api_view(["POST"])
@throttle_classes([BankAiImportThrottle])
@permission_classes([IsAuthenticated])
def admin_test_bank_import_smart(request):
    """Savolnoma matni/PDF → Gemini: savollar + mavzu bo‘yicha kategoriyalar → bazaga."""
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    d = request.data or {}
    language = d.get("language") or "uz"
    if not isinstance(language, str) or len(language) > 10:
        language = "uz"
    text = ""
    f = request.FILES.get("file")
    if f:
        raw = f.read()
        safe_name = os.path.basename(getattr(f, "name", "") or "")
        try:
            text = extract_text_from_bank_upload(raw, safe_name)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
    elif d.get("raw_text") is not None:
        text = str(d["raw_text"])
    text = (text or "").strip()
    if not text:
        return Response({"error": "raw_text yoki file kerak"}, status=400)
    if len(text) > 400_000:
        text = text[:400_000]
    try:
        items = parse_and_classify_questionnaire(text, language)
    except RuntimeError as e:
        return Response({"error": str(e)}, status=503)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    except Exception as e:
        return Response({"error": "AI tahlil xatosi", "detail": str(e)[:500]}, status=502)
    categories_touched: dict[str, int] = {}
    inserted = 0
    with transaction.atomic():
        for it in items:
            cat = _get_or_create_bank_category(it["categoryName"], it.get("categoryDescription") or "")
            TestBankQuestion.objects.create(
                category=cat,
                text=it["text"],
                options_json=json.dumps(it["options"]),
                correct_answer=it["correctAnswer"],
                language=language,
            )
            inserted += 1
            categories_touched[cat.name] = categories_touched.get(cat.name, 0) + 1
    return Response(
        {
            "success": True,
            "inserted": inserted,
            "categories": [{"name": k, "questions_added": v} for k, v in sorted(categories_touched.items())],
        }
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_test_bank_categories(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        rows = []
        for c in TestBankCategory.objects.annotate(
            question_count=Count("testbankquestion")
        ).order_by("sort_order", "name"):
            rows.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "sort_order": c.sort_order,
                    "question_count": c.question_count,
                }
            )
        return Response(rows)
    d = request.data or {}
    if not d.get("name"):
        return Response({"error": "Name required"}, status=400)
    c = TestBankCategory.objects.create(
        name=d["name"],
        description=d.get("description") or "",
        sort_order=d.get("sort_order") or 0,
    )
    return Response({"id": c.id})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def admin_test_bank_categories_delete(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    TestBankCategory.objects.filter(pk=pk).delete()
    return Response({"success": True})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_test_bank_questions(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        cid = request.query_params.get("category_id")
        if cid:
            qs = TestBankQuestion.objects.filter(category_id=int(cid)).order_by("-id")
            return Response(
                [
                    {
                        "id": q.id,
                        "category_id": q.category_id,
                        "text": q.text,
                        "options_json": q.options_json,
                        "correct_answer": q.correct_answer,
                        "language": q.language,
                        "created_at": q.created_at.isoformat() if q.created_at else None,
                    }
                    for q in qs
                ]
            )
        qs = (
            TestBankQuestion.objects.select_related("category")
            .order_by("-id")[:500]
        )
        out = []
        for q in qs:
            out.append(
                {
                    "id": q.id,
                    "category_id": q.category_id,
                    "text": q.text,
                    "options_json": q.options_json,
                    "correct_answer": q.correct_answer,
                    "language": q.language,
                    "category_name": q.category.name,
                    "created_at": q.created_at.isoformat() if q.created_at else None,
                }
            )
        return Response(out)
    d = request.data or {}
    category_id, questions = d.get("category_id"), d.get("questions")
    language = d.get("language") or "uz"
    if not category_id or not isinstance(questions, list) or not questions:
        return Response({"error": "category_id and questions[] required"}, status=400)
    if not TestBankCategory.objects.filter(pk=category_id).exists():
        return Response({"error": "Invalid category"}, status=400)
    n = 0
    for q in questions:
        opts = [str(x) for x in (q.get("options") or [])]
        if len(opts) < 4:
            continue
        ca = str(q.get("correctAnswer") or opts[0])
        TestBankQuestion.objects.create(
            category_id=category_id,
            text=str(q.get("text") or ""),
            options_json=json.dumps(opts[:4]),
            correct_answer=ca,
            language=language,
        )
        n += 1
    return Response({"success": True, "inserted": n})


# --- Admin exams ---


def _exam_row_dict(e: Exam, teacher_name: str | None = None):
    return {
        "id": e.id,
        "teacher_id": e.teacher_id,
        "teacher_name": teacher_name,
        "title": e.title,
        "start_time": e.start_time.isoformat() if e.start_time else None,
        "end_time": e.end_time.isoformat() if e.end_time else None,
        "duration_minutes": e.duration_minutes,
        "questions_json": e.questions_json,
        "language": e.language,
        "pin": e.pin,
        "custom_rules": e.custom_rules,
        "exam_mode": e.exam_mode,
        "bank_category_ids": e.bank_category_ids,
        "bank_question_count": e.bank_question_count,
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_exams(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        out = []
        for e in Exam.objects.select_related("teacher").all():
            out.append(_exam_row_dict(e, e.teacher.name))
        return Response(out)
    return _admin_exams_create_impl(request)


def _bank_pool_check(cat_ids: list, lang: str, need_bank: int) -> tuple[bool, int]:
    pool_len = TestBankQuestion.objects.filter(category_id__in=cat_ids, language=lang).count()
    return pool_len >= need_bank, pool_len


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_exam_detail(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        e = Exam.objects.select_related("teacher").filter(pk=pk).first()
        if not e:
            return Response({"error": "Exam not found"}, status=404)
        gids = list(ExamGroup.objects.filter(exam_id=pk).values_list("group_id", flat=True))
        questions = safe_json_loads(e.questions_json, [])
        bank_category_ids = safe_json_loads(e.bank_category_ids, [])
        d = _exam_row_dict(e, e.teacher.name)
        d["group_ids"] = gids
        d["questions"] = questions
        d["bank_category_ids"] = bank_category_ids
        return Response(d)
    if request.method == "DELETE":
        n, _ = Exam.objects.filter(pk=pk).delete()
        if not n:
            return Response({"error": "Exam not found"}, status=404)
        return Response({"success": True})
    e = Exam.objects.filter(pk=pk).first()
    if not e:
        return Response({"error": "Exam not found"}, status=404)
    d = request.data or {}
    questions_json = e.questions_json
    bank_cats_json = e.bank_category_ids or "[]"
    bank_count = e.bank_question_count or 0
    lang = d.get("language", e.language)

    if e.exam_mode == "static" and d.get("questions") is not None:
        qs = d["questions"]
        if not isinstance(qs, list) or not qs:
            return Response({"error": "questions must be a non-empty array"}, status=400)
        normalized = []
        for i, q in enumerate(qs):
            opts = [str(x) for x in (q.get("options") or [])][:4]
            while len(opts) < 4:
                opts.append(f"Variant {len(opts) + 1}")
            cor = str(q.get("correctAnswer") or opts[0])
            if cor not in opts:
                cor = opts[0]
            normalized.append(
                {"id": i + 1, "text": str(q.get("text") or f"Savol {i+1}"), "options": opts, "correctAnswer": cor}
            )
        questions_json = json.dumps(normalized)

    if e.exam_mode == "bank_mixed" and (
        d.get("bank_category_ids") is not None or d.get("bank_question_count") is not None
    ):
        cat_ids = d.get("bank_category_ids")
        if cat_ids is None:
            cat_ids = safe_json_loads(e.bank_category_ids, [])
        if not isinstance(cat_ids, list) or not cat_ids:
            return Response({"error": "Select at least one test bank category"}, status=400)
        n = max(8, min(200, int(d.get("bank_question_count") or e.bank_question_count or 20)))
        need_bank = int(n * 0.75)
        ok, pool_len = _bank_pool_check(cat_ids, lang, need_bank)
        if not ok:
            return Response(
                {"error": f"Test bazasida yetarli savol yo'q ({pool_len}/{need_bank}, til: {lang})"},
                status=400,
            )
        bank_cats_json = json.dumps(cat_ids)
        bank_count = n

    title = d.get("title", e.title)
    st = parse_iso_datetime(d.get("start_time", e.start_time))
    et = parse_iso_datetime(d.get("end_time", e.end_time))
    dur = int(d.get("duration_minutes", e.duration_minutes))
    pin = d.get("pin", e.pin)
    rules = d.get("custom_rules", e.custom_rules or "")
    if not title or not st or not et or not dur:
        return Response({"error": "Missing required exam fields"}, status=400)

    try:
        with transaction.atomic():
            e.title = title
            e.start_time = st
            e.end_time = et
            e.duration_minutes = dur
            e.questions_json = questions_json
            e.language = lang
            e.pin = pin or ""
            e.custom_rules = rules or ""
            e.bank_category_ids = bank_cats_json
            e.bank_question_count = bank_count
            e.save()
            if d.get("group_ids") is not None:
                gids = d["group_ids"]
                if not isinstance(gids, list) or not gids:
                    raise ValueError("GROUP_IDS")
                ExamGroup.objects.filter(exam_id=pk).delete()
                ExamGroup.objects.bulk_create(
                    [ExamGroup(exam_id=pk, group_id=gid) for gid in gids]
                )
    except ValueError:
        return Response({"error": "Select at least one group"}, status=400)
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_exams_results(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    e = Exam.objects.filter(pk=pk).first()
    if not e:
        return Response({"error": "Exam not found"}, status=404)
    results = []
    for se in StudentExam.objects.filter(exam_id=pk).select_related("student"):
        results.append(
            {
                "id": se.id,
                "student_id": se.student_id,
                "name": se.student.name,
                "status": se.status,
                "score": se.score,
                "started_at": se.started_at.isoformat() if se.started_at else None,
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                "answers_json": se.answers_json,
                "flagged_questions_json": se.flagged_questions_json,
                "session_questions_json": se.session_questions_json,
                "questions_json": se.session_questions_json or e.questions_json,
            }
        )
    violations = list(
        ViolationLog.objects.filter(exam_id=pk).values("student_id", "violation_type", "timestamp")
    )
    for v in violations:
        if hasattr(v["timestamp"], "isoformat"):
            v["timestamp"] = v["timestamp"].isoformat()
    return Response(
        {
            "results": results,
            "violations": violations,
            "questions_json": e.questions_json,
            "exam_mode": e.exam_mode,
        }
    )


def _admin_exams_create_impl(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    d = request.data
    title = d.get("title")
    start_time = d.get("start_time")
    end_time = d.get("end_time")
    duration_minutes = d.get("duration_minutes")
    if not title or not start_time or not end_time or not duration_minutes:
        return Response({"error": "Missing required exam fields"}, status=400)

    lang = d.get("language") or "uz"
    mode = "bank_mixed" if d.get("exam_mode") == "bank_mixed" else "static"
    bank_cats_json = "[]"
    bank_count = 0
    questions: list = []

    if mode == "bank_mixed":
        cat_ids = safe_json_loads(d.get("bank_category_ids") or "[]", [])
        if not isinstance(cat_ids, list) or not cat_ids:
            return Response({"error": "Select at least one test bank category"}, status=400)
        n = max(8, min(200, int(d.get("bank_question_count") or 20)))
        need_bank = int(n * 0.75)
        ok, pool_len = _bank_pool_check(cat_ids, lang, need_bank)
        if not ok:
            return Response(
                {
                    "error": (
                        f"Test bazasida yetarli savol yo'q ({pool_len}/{need_bank} kerak, til: {lang}). "
                        "Kategoriyalarga savol qo'shing yoki sonni kamaytiring."
                    )
                },
                status=400,
            )
        bank_cats_json = json.dumps(cat_ids)
        bank_count = n
    elif request.FILES.get("pdf"):
        f = request.FILES["pdf"]
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            for chunk in f.chunks():
                tmp.write(chunk)
            path = tmp.name
        try:
            with open(path, "rb") as fh:
                questions = parse_pdf_questions(fh)
        except Exception:
            os.unlink(path)
            return Response({"error": "Failed to parse PDF"}, status=400)
        os.unlink(path)
    elif d.get("manual_questions"):
        try:
            questions = json.loads(d["manual_questions"])
            if not isinstance(questions, list) or not questions:
                raise ValueError()
        except Exception:
            return Response({"error": "Invalid manual questions format"}, status=400)
    else:
        return Response({"error": "No questions provided"}, status=400)

    st = parse_iso_datetime(start_time)
    et = parse_iso_datetime(end_time)
    if not st or not et:
        return Response({"error": "Invalid datetime"}, status=400)

    group_ids_raw = d.get("group_ids")
    gids = safe_json_loads(group_ids_raw, []) if isinstance(group_ids_raw, str) else (group_ids_raw or [])

    with transaction.atomic():
        ex = Exam.objects.create(
            teacher_id=request.user.id,
            title=title,
            start_time=st,
            end_time=et,
            duration_minutes=int(duration_minutes),
            questions_json=json.dumps(questions),
            language=lang,
            pin=d.get("pin") or "",
            custom_rules=d.get("custom_rules") or "",
            exam_mode=mode,
            bank_category_ids=bank_cats_json,
            bank_question_count=bank_count,
        )
        if isinstance(gids, list):
            ExamGroup.objects.bulk_create([ExamGroup(exam_id=ex.id, group_id=gid) for gid in gids])
        eid = ex.id
    return Response({"id": eid})


# --- Student ---


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exams_list(request):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    if not u.group_id:
        return Response([])
    assigned_ids = ExamGroup.objects.filter(group_id=u.group_id).values_list("exam_id", flat=True)
    out = []
    for eid in assigned_ids.distinct():
        e = Exam.objects.filter(pk=eid).first()
        if not e:
            continue
        se = StudentExam.objects.filter(student_id=u.id, exam_id=eid).first()
        if se is not None and se.status in ("Completed", "Banned"):
            continue
        out.append(
            {
                "id": e.id,
                "title": e.title,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                "duration_minutes": e.duration_minutes,
                "language": e.language,
                "has_pin": bool(e.pin),
                "custom_rules": e.custom_rules,
                "exam_mode": e.exam_mode,
                "bank_question_count": e.bank_question_count,
            }
        )
    return Response(out)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_exams_start(request, pk: int):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    pin = (request.data or {}).get("pin")
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    if exam.pin and exam.pin != pin:
        return Response({"error": "Invalid PIN"}, status=403)
    if not ExamGroup.objects.filter(exam_id=pk, group_id=u.group_id).exists():
        return Response({"error": "Exam not assigned to your group"}, status=403)
    now = dj_tz.now()
    if exam.start_time and now < exam.start_time:
        return Response({"error": "Exam has not started yet"}, status=403)
    if exam.end_time and now > exam.end_time:
        return Response({"error": "Exam has already ended"}, status=403)

    prof = AppUser.objects.filter(pk=u.id).values_list("profile_image", flat=True).first()
    if not prof or len(str(prof)) < 50:
        return Response(
            {"error": "Profil rasmsiz imtihon boshlash mumkin emas. Administratorga murojaat qiling."},
            status=403,
        )

    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se:
        se = StudentExam.objects.create(
            student_id=u.id,
            exam_id=pk,
            status="In Progress",
            started_at=dj_tz.now(),
        )
    elif se.status in ("Banned", "Completed"):
        return Response({"error": f"Exam already {se.status}"}, status=403)
    elif se.status == "Pending":
        se.status = "In Progress"
        se.started_at = se.started_at or dj_tz.now()
        se.save(update_fields=["status", "started_at"])

    full_questions: list[dict]
    if exam.exam_mode == "bank_mixed":
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
        else:
            n = max(8, exam.bank_question_count or 20)
            n_bank = int(n * 0.75)
            n_ai = n - n_bank
            cat_ids = safe_json_loads(exam.bank_category_ids, [])
            if not cat_ids:
                return Response({"error": "Invalid exam bank configuration"}, status=500)
            pool = list(
                TestBankQuestion.objects.filter(
                    category_id__in=cat_ids, language=exam.language or "uz"
                )
            )
            if len(pool) < n_bank:
                return Response(
                    {"error": "Test bazasida hozircha yetarli savol yo‘q. Administratorga murojaat qiling."},
                    status=400,
                )
            shuffle_in_place(pool)
            picked = []
            for i, row in enumerate(pool[:n_bank]):
                opts = safe_json_loads(row.options_json, [])
                picked.append(
                    {
                        "id": i + 1,
                        "text": row.text,
                        "options": opts[:4],
                        "correctAnswer": row.correct_answer,
                    }
                )
            cat_names = list(
                TestBankCategory.objects.filter(pk__in=cat_ids).values_list("name", flat=True)
            )
            samples = [{"text": q["text"], "options": q["options"], "correctAnswer": q["correctAnswer"]} for q in picked]
            ai_part = []
            try:
                ai_part = generate_bank_extension(samples, n_ai, exam.language or "uz", list(cat_names))
            except Exception as ex:
                import logging as _log
                _log.getLogger(__name__).warning(
                    "generate_bank_extension failed (bank-only fallback): %s", ex
                )
                # AI xato berdi - bankdan qoshimcha savollar olib toldiramiz
                extra_pool = pool[n_bank: n_bank + n_ai]
                for row in extra_pool:
                    opts = safe_json_loads(row.options_json, [])
                    ai_part.append({
                        "text": row.text,
                        "options": opts[:4],
                        "correctAnswer": row.correct_answer,
                    })
            next_id = len(picked) + 1
            ai_with_ids = [{**q, "id": next_id + j} for j, q in enumerate(ai_part)]
            merged = shuffle_in_place(picked + ai_with_ids)
            full_questions = [{**q, "id": idx + 1} for idx, q in enumerate(merged)]
            se.session_questions_json = json.dumps(full_questions)
            se.save(update_fields=["session_questions_json"])
    else:
        full_questions = safe_json_loads(exam.questions_json, [])

    shuffled = build_student_question_list(full_questions)
    deadline = submission_deadline(exam, se)
    exam_out = {
        "id": exam.id,
        "teacher_id": exam.teacher_id,
        "title": exam.title,
        "start_time": exam.start_time.isoformat() if exam.start_time else None,
        "end_time": exam.end_time.isoformat() if exam.end_time else None,
        "duration_minutes": exam.duration_minutes,
        "language": exam.language,
        "pin": exam.pin,
        "custom_rules": exam.custom_rules,
        "exam_mode": exam.exam_mode,
        "questions": shuffled,
        "submission_deadline": deadline.isoformat() if deadline else None,
    }
    return Response(
        {
            "exam": exam_out,
            "studentExamId": se.id,
            "startedAt": se.started_at.isoformat() if se.started_at else None,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_exams_submit(request, pk: int):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    answers = (request.data or {}).get("answers")
    flagged = (request.data or {}).get("flaggedQuestions")
    if not isinstance(answers, dict):
        return Response({"error": "Invalid answers format"}, status=400)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": "Cannot submit exam"}, status=403)
    deadline = submission_deadline(exam, se)
    if deadline and dj_tz.now() > deadline:
        return Response(
            {"error": "Imtihon vaqti tugagan. Javoblar qabul qilinmaydi."},
            status=403,
        )
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(exam.questions_json, [])
    norm = norm_answers(answers)
    score = sum(1 for q in questions if norm.get(str(q["id"])) == q.get("correctAnswer"))
    flagged_json = json.dumps(flagged) if flagged else "[]"
    completed_at = dj_tz.now()
    result_public_id = next_result_public_id()
    verify_secret = secrets.token_hex(32)
    total = len(questions)
    percentage = round((score / total) * 100) if total else 0
    ai_summary = generate_exam_ai_summary(questions, norm, exam.language or "uz")
    ai_summary_json = json.dumps(ai_summary)
    with transaction.atomic():
        se.status = "Completed"
        se.score = score
        se.answers_json = json.dumps(norm)
        se.flagged_questions_json = flagged_json
        se.completed_at = completed_at
        se.result_public_id = result_public_id
        se.result_verify_secret = verify_secret
        se.ai_summary_json = ai_summary_json
        se.draft_answers_json = "{}"
        se.draft_flagged_json = "[]"
        se.draft_updated_at = None
        se.save()

    completed_iso = completed_at.isoformat()
    icode = integrity_code(result_public_id, completed_iso, score, total, verify_secret)
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{result_public_id}?k={verify_secret}"
    per_q = []
    for q in questions:
        st = norm.get(str(q["id"]), "")
        ok = st == q.get("correctAnswer")
        ai_row = next((i for i in ai_summary.get("items", []) if i.get("questionId") == q["id"]), None)
        per_q.append(
            {
                "id": q["id"],
                "text": q.get("text"),
                "options": q.get("options"),
                "studentAnswer": st or None,
                "correctAnswer": q.get("correctAnswer"),
                "isCorrect": ok,
                "commentCorrect": (ai_row or {}).get("commentCorrect", "") if ok else "",
                "whyStudentWrong": "" if ok else (ai_row or {}).get("whyStudentWrong", ""),
                "whyCorrectIsRight": "" if ok else (ai_row or {}).get("whyCorrectIsRight", ""),
            }
        )
    return Response(
        {
            "success": True,
            "score": score,
            "total": total,
            "percentage": percentage,
            "exam_id": pk,
            "result_public_id": result_public_id,
            "verify_secret": verify_secret,
            "verify_url": verify_url,
            "integrity_code": icode,
            "completed_at": completed_iso,
            "overview": ai_summary.get("overview", ""),
            "questions": per_q,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exam_clock(request, pk: int):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": "No active session"}, status=400)
    deadline = submission_deadline(exam, se)
    now = dj_tz.now()
    sec = seconds_until_deadline(exam, se)
    return Response(
        {
            "server_now": now.isoformat(),
            "submission_deadline": deadline.isoformat() if deadline else None,
            "seconds_remaining": sec if sec is not None else 0,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exam_draft(request, pk: int):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"answers": {}, "flaggedQuestions": [], "updated_at": None})
    answers = safe_json_loads(se.draft_answers_json, {})
    flagged = safe_json_loads(se.draft_flagged_json, [])
    return Response(
        {
            "answers": answers,
            "flaggedQuestions": flagged,
            "updated_at": se.draft_updated_at.isoformat() if se.draft_updated_at else None,
        }
    )


@api_view(["POST"])
@throttle_classes([ExamAutosaveThrottle])
@permission_classes([IsAuthenticated])
def student_exam_save_progress(request, pk: int):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": "Exam not found"}, status=404)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": "No active session"}, status=400)
    deadline = submission_deadline(exam, se)
    if deadline and dj_tz.now() > deadline:
        return Response({"error": "Imtihon vaqti tugagan"}, status=403)
    answers = (request.data or {}).get("answers")
    flagged = (request.data or {}).get("flaggedQuestions")
    if not isinstance(answers, dict):
        return Response({"error": "Invalid answers format"}, status=400)
    if flagged is not None and not isinstance(flagged, list):
        return Response({"error": "Invalid flagged format"}, status=400)
    norm = norm_answers(answers)
    se.draft_answers_json = json.dumps(norm)
    if isinstance(flagged, list):
        se.draft_flagged_json = json.dumps(flagged)
    se.draft_updated_at = dj_tz.now()
    se.save(update_fields=["draft_answers_json", "draft_flagged_json", "draft_updated_at"])
    return Response({"ok": True, "saved_at": se.draft_updated_at.isoformat()})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_results(request):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    rows = (
        StudentExam.objects.filter(student_id=u.id, status__in=["Completed", "Banned"])
        .select_related("exam")
        .order_by("-completed_at")
    )
    out = []
    for se in rows:
        total = 0
        if se.session_questions_json:
            total = len(safe_json_loads(se.session_questions_json, []))
        else:
            total = len(safe_json_loads(se.exam.questions_json, []))
        pct = round((se.score / total) * 100) if total and se.score is not None else None
        out.append(
            {
                "id": se.id,
                "exam_id": se.exam_id,
                "title": se.exam.title,
                "status": se.status,
                "score": se.score,
                "total_questions": total,
                "percentage": pct,
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                "result_public_id": se.result_public_id,
            }
        )
    return Response(out)


def _result_details_bundle(se: StudentExam, request, for_pdf: bool = False):
    if se.status != "Completed" or not se.result_public_id or not se.result_verify_secret:
        return None
    exam = se.exam
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(exam.questions_json, [])
    answers = norm_answers(safe_json_loads(se.answers_json, {}))
    ai = safe_json_loads(se.ai_summary_json, {})
    if not ai.get("items"):
        return "corrupt"
    total = len(questions)
    completed_iso = se.completed_at.isoformat() if se.completed_at else ""
    icode = integrity_code(se.result_public_id, completed_iso, se.score, total, se.result_verify_secret)
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{se.result_public_id}?k={se.result_verify_secret}"
    per_q = []
    for q in questions:
        st = answers.get(str(q["id"]), "")
        ok = st == q.get("correctAnswer")
        ai_row = next((i for i in ai["items"] if i.get("questionId") == q["id"]), None)
        per_q.append(
            {
                "id": q["id"],
                "text": q.get("text"),
                "options": q.get("options"),
                "studentAnswer": st or None,
                "correctAnswer": q.get("correctAnswer"),
                "isCorrect": ok,
                "commentCorrect": (ai_row or {}).get("commentCorrect", "") if ok else "",
                "whyStudentWrong": "" if ok else (ai_row or {}).get("whyStudentWrong", ""),
                "whyCorrectIsRight": "" if ok else (ai_row or {}).get("whyCorrectIsRight", ""),
            }
        )
    return {
        "result_public_id": se.result_public_id,
        "verify_secret": se.result_verify_secret,
        "verify_url": verify_url,
        "integrity_code": icode,
        "overview": ai.get("overview", ""),
        "score": se.score,
        "total": total,
        "percentage": round((se.score / total) * 100) if total else 0,
        "completed_at": completed_iso,
        "exam_title": exam.title,
        "student_name": se.student.name,
        "questions": per_q,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_result_details(request, exam_id: int):
    if request.user.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    se = (
        StudentExam.objects.filter(student_id=request.user.id, exam_id=exam_id)
        .select_related("exam", "student")
        .first()
    )
    if not se:
        return Response({"error": "Result not found"}, status=404)
    b = _result_details_bundle(se, request)
    if b == "corrupt":
        return Response({"error": "Corrupt summary"}, status=500)
    if not b:
        return Response({"error": "Certificate not available for this attempt"}, status=404)
    return Response(b)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_certificate_pdf(request, exam_id: int):
    if request.user.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    se = (
        StudentExam.objects.filter(student_id=request.user.id, exam_id=exam_id)
        .select_related("exam", "student")
        .first()
    )
    if not se or se.status != "Completed":
        return HttpResponse("Not found", status=404)
    b = _result_details_bundle(se, request)
    if not b:
        return HttpResponse("Not found", status=404)
    rows = [{"index": i + 1, "text": q.get("text"), "isCorrect": q.get("isCorrect")} for i, q in enumerate(b["questions"])]
    pdf = build_certificate_pdf(
        result_id=b["result_public_id"],
        student_name=b["student_name"],
        exam_title=b["exam_title"],
        completed_at=b["completed_at"],
        score=b["score"],
        total=b["total"],
        verify_url=b["verify_url"],
        integrity_code=b["integrity_code"],
        overview=b["overview"],
        rows=rows,
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{b["result_public_id"]}.pdf"'
    return resp


# --- Public verify ---


@api_view(["GET"])
@throttle_classes([PublicVerifyThrottle])
@permission_classes([AllowAny])
def public_verify_result(request, result_id: str):
    result_id = result_id.strip()
    if not assert_safe_result_public_id(result_id):
        return Response({"error": "Invalid result id"}, status=400)
    k = request.query_params.get("k") or ""
    if len(k) < 32 or len(k) > 256:
        return Response({"error": "Missing or invalid verification key"}, status=400)
    se = (
        StudentExam.objects.filter(
            result_public_id=result_id, result_verify_secret=k, status="Completed"
        )
        .select_related("exam", "student")
        .first()
    )
    if not se:
        return Response({"error": "Not found or invalid link"}, status=404)
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(se.exam.questions_json, [])
    answers = norm_answers(safe_json_loads(se.answers_json, {}))
    ai = safe_json_loads(se.ai_summary_json, {})
    if not ai.get("items"):
        ai = build_fallback_ai_summary(questions, answers)
    total = len(questions)
    completed_iso = se.completed_at.isoformat() if se.completed_at else ""
    icode = integrity_code(result_id, completed_iso, se.score, total, k)
    per_q = []
    for q in questions:
        st = answers.get(str(q["id"]), "")
        ok = st == q.get("correctAnswer")
        ai_row = next((i for i in ai.get("items", []) if i.get("questionId") == q["id"]), None)
        per_q.append(
            {
                "id": q["id"],
                "text": q.get("text"),
                "options": q.get("options"),
                "studentAnswer": st or None,
                "correctAnswer": q.get("correctAnswer"),
                "isCorrect": ok,
                "commentCorrect": (ai_row or {}).get("commentCorrect", "") if ok else "",
                "whyStudentWrong": "" if ok else (ai_row or {}).get("whyStudentWrong", ""),
                "whyCorrectIsRight": "" if ok else (ai_row or {}).get("whyCorrectIsRight", ""),
            }
        )
    pdf_rel = f"/api/public/verify-result/{result_id}/certificate.pdf?k={k}"
    return Response(
        {
            "result_public_id": result_id,
            "integrity_code": icode,
            "overview": ai.get("overview", ""),
            "score": se.score,
            "total": total,
            "percentage": round((se.score / total) * 100) if total else 0,
            "completed_at": completed_iso,
            "exam_title": se.exam.title,
            "student_name": se.student.name,
            "questions": per_q,
            "pdf_url": pdf_rel,
        }
    )


@api_view(["GET"])
@throttle_classes([PublicVerifyThrottle])
@permission_classes([AllowAny])
def public_verify_certificate_pdf(request, result_id: str):
    result_id = result_id.strip()
    if not assert_safe_result_public_id(result_id):
        return HttpResponse("Invalid id", status=400)
    k = request.query_params.get("k") or ""
    if len(k) < 32 or len(k) > 256:
        return HttpResponse("Missing key", status=400)
    se = (
        StudentExam.objects.filter(
            result_public_id=result_id, result_verify_secret=k, status="Completed"
        )
        .select_related("exam", "student")
        .first()
    )
    if not se:
        return HttpResponse("Not found", status=404)
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(se.exam.questions_json, [])
    answers = norm_answers(safe_json_loads(se.answers_json, {}))
    ai = safe_json_loads(se.ai_summary_json, {})
    if not ai.get("items"):
        ai = build_fallback_ai_summary(questions, answers)
    total = len(questions)
    completed_iso = se.completed_at.isoformat() if se.completed_at else ""
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{result_id}?k={k}"
    icode = integrity_code(result_id, completed_iso, se.score, total, k)
    rows = []
    for i, q in enumerate(questions):
        st = answers.get(str(q["id"]), "")
        ok = st == q.get("correctAnswer")
        rows.append({"index": i + 1, "text": q.get("text"), "isCorrect": ok})
    pdf = build_certificate_pdf(
        result_id=result_id,
        student_name=se.student.name,
        exam_title=se.exam.title,
        completed_at=completed_iso,
        score=se.score,
        total=total,
        verify_url=verify_url,
        integrity_code=icode,
        overview=ai.get("overview", ""),
        rows=rows,
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{result_id}.pdf"'
    return resp


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_violations(request):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    d = request.data or {}
    exam_id, vtype = d.get("exam_id"), d.get("violation_type")
    screenshot = d.get("screenshot_url") or ""
    if not exam_id or not vtype:
        return Response({"error": "Missing required fields"}, status=400)
    if not Exam.objects.filter(pk=exam_id).exists():
        return Response({"error": "Exam not found"}, status=404)
    ViolationLog.objects.create(
        student_id=u.id,
        exam_id=exam_id,
        violation_type=vtype,
        timestamp=dj_tz.now(),
        screenshot_url=screenshot,
    )
    cnt = ViolationLog.objects.filter(student_id=u.id, exam_id=exam_id).count()
    if vtype == "IDENTITY_SUBSTITUTION":
        with transaction.atomic():
            AppUser.objects.filter(pk=u.id).update(status="Banned")
            StudentExam.objects.filter(student_id=u.id, exam_id=exam_id).update(status="Banned")
        return Response({"banned": True, "violationsCount": cnt})
    if cnt >= 3:
        with transaction.atomic():
            AppUser.objects.filter(pk=u.id).update(status="Banned")
            StudentExam.objects.filter(student_id=u.id, exam_id=exam_id).update(status="Banned")
        return Response({"banned": True, "violationsCount": cnt})
    return Response({"banned": False, "violationsCount": cnt})
