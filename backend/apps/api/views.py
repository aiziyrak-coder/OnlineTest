"""REST marshrutlar — Express server.ts bilan mos."""
from __future__ import annotations

import json
import os
import secrets
import tempfile
import base64
import math
from datetime import datetime, timedelta
from django.core import signing
import jwt

import bcrypt
from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.http import HttpResponse
from django.utils import timezone as dj_tz
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
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
    ViolationThrottle,
)
from apps.api.certificate_pdf import build_ban_report_pdf, build_certificate_pdf
from apps.api.gemini_tools import (
    compare_faces,
    detect_question_language,
    generate_bank_extension,
    generate_exam_ai_summary,
    parse_and_classify_questionnaire,
    parse_and_classify_document_bytes,
    parse_flexible_questionnaire,
    parse_structured_questionnaire,
    paraphrase_medical_mcqs,
    translate_questions_batch,
    translate_questions_to_other_languages,
)
from apps.api.services import (
    assert_safe_result_public_id,
    bank_row_to_exam_dict,
    build_fallback_ai_summary,
    build_student_question_list,
    extract_text_from_bank_upload,
    filter_bank_questions_for_group,
    integrity_code,
    next_result_public_id,
    parse_pdf_questions,
    public_base_url,
    shuffle_in_place,
)
from apps.api.view_utils import norm_answers, parse_iso_datetime, safe_json_loads
from apps.core.models import (
    AppUser,
    Exam,
    ExamGroup,
    ExamRetakeWindow,
    ExamStudentException,
    Group,
    Level,
    StudentExam,
    TestBankCategory,
    TestBankQuestion,
    UnbanEvidence,
    ViolationLog,
)


def _check_pw(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


MIN_APP_PASSWORD_LEN = 10


def _student_assigned_to_exam(user, exam_id: int) -> bool:
    """Talaba guruhi ushbu imtihonga biriktirilgan bo‘lsa True."""
    gid = getattr(user, "group_id", None)
    if gid is None:
        return False
    return ExamGroup.objects.filter(exam_id=exam_id, group_id=gid).exists()


# --- Public / auth ---


def _health_build_ref() -> str | None:
    return (os.environ.get("APP_BUILD_REF") or os.environ.get("GIT_COMMIT") or "").strip() or None


def _request_id(request) -> str | None:
    return getattr(request, "request_id", None)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Umumiy holat + DB tekshiruvi (monitoring / eski mijozlar bilan mos)."""
    import time

    from django.db import connection

    db_ok = False
    db_ms = None
    try:
        t0 = time.perf_counter()
        connection.ensure_connection()
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        db_ms = round((time.perf_counter() - t0) * 1000, 2)
        db_ok = True
    except Exception:
        db_ok = False
    return Response(
        {
            "ok": True,
            "service": "fjsti-exam-api",
            "request_id": _request_id(request),
            "database": db_ok,
            "db_latency_ms": db_ms,
            "build": _health_build_ref(),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health_live(request):
    """Kubernetes / load balancer liveness — DBsiz, tez."""
    return Response(
        {
            "ok": True,
            "live": True,
            "service": "fjsti-exam-api",
            "request_id": _request_id(request),
            "build": _health_build_ref(),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def health_ready(request):
    """Readiness — baza ulanishi bo‘lmasa 503."""
    import time

    from django.db import connection

    try:
        t0 = time.perf_counter()
        connection.ensure_connection()
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        db_ms = round((time.perf_counter() - t0) * 1000, 2)
    except Exception:
        return Response(
            {
                "ok": False,
                "ready": False,
                "service": "fjsti-exam-api",
                "request_id": _request_id(request),
                "database": False,
            },
            status=503,
        )
    return Response(
        {
            "ok": True,
            "ready": True,
            "service": "fjsti-exam-api",
            "request_id": _request_id(request),
            "database": True,
            "db_latency_ms": db_ms,
            "build": _health_build_ref(),
        }
    )


@api_view(["POST"])
@throttle_classes([LoginThrottle])
@permission_classes([AllowAny])
def auth_login(request):
    payload = request.data or {}
    uid = (
        payload.get("id")
        or payload.get("userId")
        or payload.get("user_id")
        or payload.get("username")
    )
    password = payload.get("password") or payload.get("pass") or payload.get("pwd")
    uid = str(uid or "").strip()
    password = str(password or "").strip()
    if not uid or not password:
        return Response({"error": "ID and password are required"}, status=400)
    user = AppUser.objects.select_related("group").filter(pk=uid).first()
    if not user or not _check_pw(password, user.password):
        return Response({"error": "Invalid credentials"}, status=401)
    if user.status == "Banned":
        return Response({"error": "Your account is banned. Contact administrator."}, status=403)
    if user.role == "teacher":
        return Response(
            {"error": "Teacher role is no longer supported. Use an admin or student account."},
            status=403,
        )
    role_out = (user.role or "").strip().lower()
    return Response(
        {
            "token": issue_token(user),
            "user": {
                "id": user.id,
                "role": role_out,
                "name": user.name,
                "status": user.status,
                "group_id": user.group_id,
                "profile_image": user.profile_image or None,
                "program_track": getattr(user.group, "program_track", None) if user.group_id else None,
                "academic_year": getattr(user.group, "academic_year", None) if user.group_id else None,
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
    exam_id_raw = body.get("exam_id")
    if exam_id_raw is not None and exam_id_raw != "":
        try:
            eid = int(exam_id_raw)
        except (TypeError, ValueError):
            return Response({"error": "Invalid exam_id"}, status=400)
        if not Exam.objects.filter(pk=eid).exists():
            return Response({"error": "Exam not found"}, status=404)
        if not _student_assigned_to_exam(u, eid):
            return Response({"error": "Forbidden"}, status=403)
    result = compare_faces(p_raw, l_raw)
    if not result.get("success"):
        code = result.get("code") or "GEMINI_ERROR"
        bypass = os.environ.get("ALLOW_IDENTITY_VERIFY_BYPASS", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if bypass and code in ("GEMINI_UNAVAILABLE", "GEMINI_ERROR"):
            return Response({"match": True, "skipped": True, "code": code}, status=200)
        # Prod: solishtirish bo'lmasa — tasdiqlanmaydi (boshqa odamni tasdiqlash xavfi)
        return Response(
            {
                "match": False,
                "skipped": False,
                "code": code,
                "detail": "Face verification service unavailable or failed.",
            },
            status=503,
        )
    return Response({"match": bool(result.get("match")), "skipped": False})


# --- Admin: users ---


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_users(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        qs = AppUser.objects.select_related("group").all()
        gid = request.query_params.get("group_id")
        if gid not in (None, ""):
            try:
                qs = qs.filter(group_id=int(gid))
            except (TypeError, ValueError):
                pass
        role_f = request.query_params.get("role")
        if role_f:
            qs = qs.filter(role=role_f)
        status_f = request.query_params.get("status")
        if status_f:
            qs = qs.filter(status=status_f)
        qs = qs.order_by("name")
        total = qs.count()
        try:
            limit = int(request.query_params.get("limit", 200))
        except (TypeError, ValueError):
            limit = 200
        limit = max(1, min(limit, 500))
        try:
            offset = int(request.query_params.get("offset", 0))
        except (TypeError, ValueError):
            offset = 0
        offset = max(0, offset)
        rows = []
        for u in qs[offset : offset + limit]:
            rows.append(
                {
                    "id": u.id,
                    "role": u.role,
                    "name": u.name,
                    "status": u.status,
                    "group_id": u.group_id,
                    "has_photo": bool(u.profile_image and len(u.profile_image) > 50),
                    "profile_image": None,
                    "group_name": u.group.name if u.group_id else None,
                }
            )
        resp = Response({"results": rows, "total": total, "limit": limit, "offset": offset})
        resp["X-Total-Count"] = str(total)
        return resp
    d = request.data or {}
    uid, password, role, name = d.get("id"), d.get("password"), d.get("role"), d.get("name")
    group_id = d.get("group_id")
    profile_image = d.get("profile_image")
    if not uid or not password or not role or not name:
        return Response({"error": "Missing required fields"}, status=400)
    if len(str(password)) < MIN_APP_PASSWORD_LEN:
        return Response(
            {"error": f"Parol kamida {MIN_APP_PASSWORD_LEN} belgi bo‘lishi kerak"},
            status=400,
        )
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
        if len(str(d["password"])) < MIN_APP_PASSWORD_LEN:
            return Response(
                {"error": f"Password min {MIN_APP_PASSWORD_LEN} characters"},
                status=400,
            )
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
    row = AppUser.objects.filter(pk=user_id).first()
    if not row:
        return Response({"error": "User not found"}, status=404)
    reason = str((request.data or {}).get("reason") or "").strip()
    if len(reason) < 8:
        return Response({"error": "Unban reason is required (min 8 chars)"}, status=400)
    ev = request.FILES.get("evidence")
    if not ev:
        return Response({"error": "JPG yoki PDF evidence fayli majburiy"}, status=400)
    mime = (getattr(ev, "content_type", "") or "").lower()
    ok_mime = mime in ("application/pdf", "image/jpeg")
    if not ok_mime:
        return Response({"error": "Faqat JPG yoki PDF qabul qilinadi"}, status=400)
    raw = ev.read()
    if not raw or len(raw) > 5 * 1024 * 1024:
        return Response({"error": "Evidence fayl hajmi 5MB dan oshmasin"}, status=400)
    ext = os.path.splitext(getattr(ev, "name", "") or "")[1].lower()
    if mime == "application/pdf" and ext != ".pdf":
        return Response({"error": "PDF fayl yuklang"}, status=400)
    if mime == "image/jpeg" and ext not in (".jpg", ".jpeg"):
        return Response({"error": "JPG fayl yuklang"}, status=400)
    with transaction.atomic():
        AppUser.objects.filter(pk=user_id).update(status="Active")
        StudentExam.objects.filter(student_id=user_id, status="Banned").update(status="Pending")
        UnbanEvidence.objects.create(
            student_id=user_id,
            admin_id=request.user.id,
            reason=reason[:5000],
            file_name=os.path.basename(getattr(ev, "name", "") or "evidence.bin")[:255],
            file_mime=mime,
            file_base64=base64.b64encode(raw).decode("ascii"),
        )
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


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_levels(request):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if request.method == "GET":
        return Response(list(Level.objects.order_by("name").values()))
    name = (request.data or {}).get("name")
    if not name or not str(name).strip():
        return Response({"error": "Name required"}, status=400)
    name = str(name).strip()[:200]
    if Level.objects.filter(name__iexact=name).exists():
        return Response({"error": "Bu nomdagi level allaqachon bor"}, status=400)
    lv = Level.objects.create(name=name)
    return Response({"id": lv.id, "name": lv.name})


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
                    "program_track": getattr(g, "program_track", "bachelor") or "bachelor",
                    "academic_year": getattr(g, "academic_year", None),
                }
            )
        return Response(out)
    d = request.data or {}
    name, level_id = d.get("name"), d.get("level_id")
    if not name or not level_id:
        return Response({"error": "Name and level_id are required"}, status=400)
    pt = (d.get("program_track") or "bachelor").strip()[:20]
    ay = d.get("academic_year")
    ay_val = None
    if ay not in (None, "", "null"):
        try:
            ay_val = int(ay)
        except (TypeError, ValueError):
            ay_val = None
    g = Group.objects.create(name=name, level_id=level_id, program_track=pt, academic_year=ay_val)
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
    uf = []
    if "name" in d and "level_id" in d:
        g.name, g.level_id = d["name"], d["level_id"]
        uf.extend(["name", "level_id"])
    elif "name" in d:
        g.name = d["name"]
        uf.append("name")
    elif "level_id" in d:
        g.level_id = d["level_id"]
        uf.append("level_id")
    if "program_track" in d:
        g.program_track = str(d["program_track"] or "bachelor").strip()[:20] or "bachelor"
        uf.append("program_track")
    if "academic_year" in d:
        v = d["academic_year"]
        if v in ("", None, "null"):
            g.academic_year = None
        else:
            try:
                g.academic_year = int(v)
            except (TypeError, ValueError):
                return Response({"error": "academic_year noto‘g‘ri"}, status=400)
        uf.append("academic_year")
    if not uf:
        return Response({"error": "No fields to update"}, status=400)
    g.save(update_fields=list(dict.fromkeys(uf)))
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


def _split_large_text(text: str, chunk_size: int = 95_000, max_chunks: int = 8) -> list[str]:
    """Katta matnni AI uchun xavfsizroq bo'laklarga bo'ladi."""
    t = (text or "").strip()
    if len(t) <= chunk_size:
        return [t]
    chunks: list[str] = []
    i = 0
    while i < len(t) and len(chunks) < max_chunks:
        j = min(len(t), i + chunk_size)
        cut = t.rfind("\n", i + math.floor(chunk_size * 0.5), j)
        if cut <= i:
            cut = j
        chunks.append(t[i:cut].strip())
        i = cut
    if i < len(t):
        chunks.append(t[i:].strip())
    return [c for c in chunks if c]


@api_view(["POST"])
@throttle_classes([BankAiImportThrottle])
@permission_classes([IsAuthenticated])
def admin_test_bank_import_smart(request):
    """PDF/DOCX/matn → Gemini: MCQ (inglizcha 3–5 variant, javob kaliti) → baza + uz/ru tarjima."""
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    d = request.data or {}
    language = d.get("language") or "auto"
    if not isinstance(language, str) or len(language) > 10:
        language = "en"
    collection_name = (d.get("collection_name") or "").strip()[:300]
    single_cat = None
    if collection_name and language not in ("en", "uz", "ru", "auto"):
        language = "auto"
        single_cat, _ = TestBankCategory.objects.get_or_create(
            name=collection_name,
            defaults={
                "description": "",
                "sort_order": 0,
                "program_track": "any",
                "source_language": "en",
            },
        )
    target_cat_id = None if single_cat else d.get("target_category_id")
    try:
        target_cat_id = int(target_cat_id) if target_cat_id not in (None, "", "0") else None
    except (TypeError, ValueError):
        target_cat_id = None
    text = ""
    raw_doc: bytes | None = None
    safe_name = ""
    f = request.FILES.get("file")
    if f:
        raw_doc = f.read()
        safe_name = os.path.basename(getattr(f, "name", "") or "")
        try:
            text = extract_text_from_bank_upload(raw_doc, safe_name)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
    elif d.get("raw_text") is not None:
        text = str(d["raw_text"])
    text = (text or "").strip()
    if not text and not raw_doc:
        return Response({"error": "raw_text yoki file kerak"}, status=400)
    if len(text) > 400_000:
        text = text[:400_000]
    source_language = language if language in ("en", "uz", "ru") else detect_question_language(text)
    # OCR/scan hujjatlar: matn juda kam bo'lsa multimodal parserga tushiramiz.
    if raw_doc and safe_name and len(text) < 180:
        try:
            items = parse_and_classify_document_bytes(raw_doc, safe_name, source_language)
            chunks = [text] if text else ["visual"]
        except Exception:
            items = []
            chunks = []
    else:
        items = []
        chunks = []
    if not items:
        chunks = _split_large_text(text)
    # Juda katta fayllarda AI chaqiruvlari worker timeout berishi mumkin.
    force_local_parse = len(text) > 180_000 or len(chunks) >= 3
    for chunk in chunks:
        if force_local_parse:
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
            items.extend(parsed or [])
            continue
        try:
            parsed = parse_and_classify_questionnaire(chunk, source_language)
        except RuntimeError:
            # Gemini vaqtincha ishlamasa ham structured fallback bilan davom etamiz.
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
        except ValueError:
            # AI javobi yaroqsiz bo'lsa local parserlarga tushamiz.
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
        except Exception:
            try:
                parsed = parse_flexible_questionnaire(chunk, source_language)
            except Exception:
                try:
                    parsed = parse_structured_questionnaire(chunk, source_language)
                except Exception:
                    parsed = []
        items.extend(parsed or [])

    if raw_doc and safe_name and len(items) < 5 and len(raw_doc) <= 20 * 1024 * 1024:
        # Kam topilsa multimodal parsing bilan to'ldirishga harakat qilamiz.
        try:
            visual_items = parse_and_classify_document_bytes(raw_doc, safe_name, source_language)
            seen = {f"{x.get('text','')}||{'|'.join(x.get('options', []))}" for x in items}
            for vi in visual_items:
                sig = f"{vi.get('text','')}||{'|'.join(vi.get('options', []))}"
                if sig not in seen:
                    items.append(vi)
                    seen.add(sig)
        except Exception:
            pass

    if not items:
        return Response(
            {
                "error": "Savollarni avtomatik ajratib bo‘lmadi. Fayl juda murakkab bo‘lsa uni 2-3 bo‘lak qilib import qiling.",
            },
            status=400,
        )

    # --- Tarjima (yangi: bitta API call da barcha tillar, chunk size=8) ---
    translations: list[dict] = []
    payload = [
        {"text": x["text"], "options": x["options"], "correctAnswer": x["correctAnswer"]}
        for x in items
    ]
    # Max 120 ta savol uchun tarjima qilamiz (timeout oldini olish)
    translate_limit = 120
    try:
        if len(payload) <= translate_limit:
            translations = translate_questions_batch(payload, source_language)
        else:
            head = translate_questions_batch(payload[:translate_limit], source_language)
            translations = head + ([{}] * max(0, len(payload) - len(head)))
    except Exception:
        translations = [{} for _ in payload]

    categories_touched: dict[str, int] = {}
    inserted = 0
    with transaction.atomic():
        fixed_cat = None
        if target_cat_id:
            fixed_cat = TestBankCategory.objects.filter(pk=target_cat_id).first()
            if not fixed_cat:
                return Response({"error": "Tanlangan kategoriya topilmadi"}, status=400)
            uf = ["source_language"]
            pt = d.get("category_program_track")
            if isinstance(pt, str) and pt.strip():
                fixed_cat.program_track = pt.strip()[:20]
                uf.append("program_track")
            ay = d.get("category_academic_year")
            if ay not in (None, "", "null"):
                try:
                    fixed_cat.academic_year = int(ay)
                    uf.append("academic_year")
                except (TypeError, ValueError):
                    pass
            fixed_cat.source_language = source_language
            fixed_cat.save(update_fields=uf)

        for idx, it in enumerate(items):
            if single_cat:
                cat = single_cat
            elif fixed_cat:
                cat = fixed_cat
            else:
                cat = _get_or_create_bank_category(it["categoryName"], it.get("categoryDescription") or "")
                cat.source_language = source_language
                cat.save(update_fields=["source_language"])

            tr = translations[idx] if idx < len(translations) else {}

            # Manba tiliga qarab to'g'ri maydonlarni olish
            def _tr_str(key: str) -> str:
                return str(tr.get(key) or "")[:50000]

            def _tr_list(key: str) -> list:
                v = tr.get(key)
                return v if isinstance(v, list) else []

            # text: manba tilida original, qolganlar tarjima
            # DB: text (asosiy), text_uz, text_ru, options_uz_json, options_ru_json
            text_main = it["text"]
            opts_main = it["options"]
            ca_main = it["correctAnswer"]

            if source_language == "en":
                # EN asl matn, UZ/RU tarjima
                text_uz = _tr_str("text_uz")
                text_ru = _tr_str("text_ru")
                opts_uz = _tr_list("options_uz")
                opts_ru = _tr_list("options_ru")
                ca_uz = _tr_str("correct_answer_uz")
                ca_ru = _tr_str("correct_answer_ru")
            elif source_language == "ru":
                # RU asl matn → text_ru = asl, text_uz = tarjima
                text_uz = _tr_str("text_uz")
                text_ru = text_main  # asl
                opts_uz = _tr_list("options_uz")
                opts_ru = opts_main  # asl
                ca_uz = _tr_str("correct_answer_uz")
                ca_ru = ca_main  # asl
            else:
                # UZ yoki other → text_uz = asl, text_ru = tarjima
                text_uz = text_main  # asl
                text_ru = _tr_str("text_ru")
                opts_uz = opts_main  # asl
                opts_ru = _tr_list("options_ru")
                ca_uz = ca_main  # asl
                ca_ru = _tr_str("correct_answer_ru")

            TestBankQuestion.objects.create(
                category=cat,
                text=text_main,
                options_json=json.dumps(opts_main),
                correct_answer=ca_main,
                language=source_language,
                text_uz=text_uz[:50000],
                text_ru=text_ru[:50000],
                options_uz_json=json.dumps(opts_uz) if opts_uz else "[]",
                options_ru_json=json.dumps(opts_ru) if opts_ru else "[]",
                correct_answer_uz=ca_uz[:500],
                correct_answer_ru=ca_ru[:500],
            )
            inserted += 1
            categories_touched[cat.name] = categories_touched.get(cat.name, 0) + 1

    return Response(
        {
            "success": True,
            "inserted": inserted,
            "detected": len(items),
            "source_language": source_language,
            "categories": [{"name": k, "questions_added": v} for k, v in sorted(categories_touched.items())],
            "chunks": len(chunks),
            "translation_limited": len(payload) > translate_limit,
            "ai_skipped_for_size": force_local_parse,
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
            fq = (
                TestBankQuestion.objects.filter(category_id=c.id)
                .order_by("-id")
                .only("text", "text_uz", "text_ru")
                .first()
            )
            preview = None
            if fq:
                preview = {
                    "text_en": (fq.text or "")[:280],
                    "text_uz": (fq.text_uz or "")[:280],
                    "text_ru": (fq.text_ru or "")[:280],
                }
            rows.append(
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "sort_order": c.sort_order,
                    "question_count": c.question_count,
                    "source_language": getattr(c, "source_language", "en"),
                    "preview": preview,
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
        # Texnik talabga mos: 2-10 ta variant
        if len(opts) < 2:
            continue
        opts = opts[:10]
        ca = str(q.get("correctAnswer") or opts[0])
        if ca not in opts:
            ca = opts[0]
        text = str(q.get("text") or "").strip()
        if not text:
            continue
        TestBankQuestion.objects.create(
            category_id=category_id,
            text=text,
            options_json=json.dumps(opts),
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


def _bank_pool_check(cat_ids: list, need_bank: int) -> tuple[bool, int]:
    pool_len = TestBankQuestion.objects.filter(category_id__in=cat_ids).count()
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
        d["exceptions"] = [
            {"student_id": x.student_id, "reason": x.reason}
            for x in ExamStudentException.objects.filter(exam_id=pk)
        ]
        d["retake_windows"] = [
            {
                "id": x.id,
                "student_id": x.student_id,
                "window_start": x.window_start.isoformat(),
                "window_end": x.window_end.isoformat(),
                "note": x.note or "",
            }
            for x in ExamRetakeWindow.objects.filter(exam_id=pk).order_by("-window_start")
        ]
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
        n = max(1, min(200, int(d.get("bank_question_count") or e.bank_question_count or 20)))
        need_bank = n
        ok, pool_len = _bank_pool_check(cat_ids, need_bank)
        if not ok:
            return Response(
                {"error": f"Test bazasida yetarli savol yo'q ({pool_len}/{need_bank})"},
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
        raw_cat_ids = d.get("bank_category_ids")
        if isinstance(raw_cat_ids, list):
            cat_ids = raw_cat_ids
        else:
            cat_ids = safe_json_loads(raw_cat_ids or "[]", [])
        if not isinstance(cat_ids, list) or not cat_ids:
            return Response({"error": "Select at least one test bank category"}, status=400)
        n = max(1, min(200, int(d.get("bank_question_count") or 20)))
        need_bank = n
        ok, pool_len = _bank_pool_check(cat_ids, need_bank)
        if not ok:
            return Response(
                {
                    "error": (
                        f"Test bazasida yetarli savol yo'q ({pool_len}/{need_bank} kerak). "
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

    ex_raw = d.get("exam_exceptions")
    if isinstance(ex_raw, str):
        ex_list = safe_json_loads(ex_raw, [])
    elif isinstance(ex_raw, list):
        ex_list = ex_raw
    else:
        ex_list = []

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
        for item in ex_list:
            if not isinstance(item, dict):
                continue
            sid = item.get("student_id")
            if not sid:
                continue
            reason = str(item.get("reason") or "Imtihonga kiritilmadingiz.").strip()[:8000]
            if not AppUser.objects.filter(pk=sid, role="student").exists():
                continue
            ExamStudentException.objects.update_or_create(
                exam_id=eid, student_id=sid, defaults={"reason": reason}
            )
    return Response({"id": eid})


@api_view(["PUT"])
@permission_classes([IsAuthenticated])
def admin_exam_exceptions(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    items = (request.data or {}).get("items")
    if not isinstance(items, list):
        return Response({"error": "items[] kerak"}, status=400)
    with transaction.atomic():
        ExamStudentException.objects.filter(exam_id=pk).delete()
        for item in items:
            if not isinstance(item, dict):
                continue
            sid = item.get("student_id")
            if not sid:
                continue
            reason = str(item.get("reason") or "Imtihonga kiritilmadingiz.").strip()[:8000]
            if AppUser.objects.filter(pk=sid, role="student").exists():
                ExamStudentException.objects.create(exam_id=pk, student_id=sid, reason=reason)
    return Response({"success": True})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_exam_retake_windows(request, pk: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    if request.method == "GET":
        return Response(
            [
                {
                    "id": x.id,
                    "student_id": x.student_id,
                    "window_start": x.window_start.isoformat(),
                    "window_end": x.window_end.isoformat(),
                    "note": x.note or "",
                }
                for x in ExamRetakeWindow.objects.filter(exam_id=pk).order_by("-window_start")
            ]
        )
    d = request.data or {}
    sid = d.get("student_id")
    ws = parse_iso_datetime(d.get("window_start"))
    we = parse_iso_datetime(d.get("window_end"))
    if not sid or not ws or not we:
        return Response({"error": "student_id, window_start, window_end kerak"}, status=400)
    if ws >= we:
        return Response({"error": "Vaqt oralig‘i noto‘g‘ri"}, status=400)
    if not AppUser.objects.filter(pk=sid, role="student").exists():
        return Response({"error": "Talaba topilmadi"}, status=404)
    note = str(d.get("note") or "")[:2000]
    w = ExamRetakeWindow.objects.create(
        exam_id=pk, student_id=sid, window_start=ws, window_end=we, note=note
    )
    return Response({"id": w.id})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def admin_exam_retake_window_delete(request, pk: int, wid: int):
    if request.user.role != "admin":
        return Response({"error": "Forbidden"}, status=403)
    n, _ = ExamRetakeWindow.objects.filter(pk=wid, exam_id=pk).delete()
    if not n:
        return Response({"error": "Not found"}, status=404)
    return Response({"success": True})


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

    ex_row = ExamStudentException.objects.filter(exam_id=pk, student_id=u.id).first()
    if ex_row:
        return Response({"error": ex_row.reason, "code": "EXAM_BLOCKED"}, status=403)

    now = dj_tz.now()
    in_general = bool(
        exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time
    )
    in_retake = ExamRetakeWindow.objects.filter(
        exam_id=pk, student_id=u.id, window_start__lte=now, window_end__gte=now
    ).exists()
    if not in_general and not in_retake:
        if exam.start_time and now < exam.start_time:
            return Response({"error": "Exam has not started yet"}, status=403)
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

    retake_only = in_retake and not in_general
    if retake_only and exam.exam_mode == "bank_mixed" and se:
        se.session_questions_json = None
        se.draft_answers_json = "{}"
        se.draft_flagged_json = "[]"
        se.save(update_fields=["session_questions_json", "draft_answers_json", "draft_flagged_json"])

    full_questions: list[dict]
    if exam.exam_mode == "bank_mixed":
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
        else:
            n = max(8, exam.bank_question_count or 20)
            group = Group.objects.filter(pk=u.group_id).first() if u.group_id else None
            track = (group.program_track or "bachelor").lower() if group else "bachelor"
            if track in ("residency", "master"):
                n_ai = 0
                n_bank = n
            else:
                n_bank = int(n * 0.75)
                n_ai = n - n_bank
            cat_ids = safe_json_loads(exam.bank_category_ids, [])
            if not cat_ids:
                return Response({"error": "Invalid exam bank configuration"}, status=500)
            base_qs = TestBankQuestion.objects.filter(category_id__in=cat_ids).select_related(
                "category"
            )
            base_qs = filter_bank_questions_for_group(base_qs, group)
            pool = list(base_qs)
            if len(pool) < n_bank:
                return Response(
                    {
                        "error": "Sizning guruhingiz (kurs/dastur) uchun tanlangan kategoriyalarda "
                        "yetarli savol yo'q. Administrator kategoriya yoki guruh sozlamalarini tekshirsin."
                    },
                    status=400,
                )
            shuffle_in_place(pool)
            picked_rows = pool[:n_bank]
            ex_lang = exam.language or "uz"
            picked = [bank_row_to_exam_dict(row, ex_lang) for row in picked_rows]
            if track == "bachelor" and picked:
                n_para = max(1, int(len(picked) * 0.25))
                idxs = list(range(len(picked)))
                shuffle_in_place(idxs)
                para_idxs = set(idxs[:n_para])
                new_picked: list[dict] = []
                for i, qd in enumerate(picked):
                    if i in para_idxs:
                        try:
                            pr = paraphrase_medical_mcqs([qd], ex_lang)
                            new_picked.append(pr[0] if pr else qd)
                        except Exception:
                            new_picked.append(qd)
                    else:
                        new_picked.append(qd)
                picked = new_picked
            elif track in ("residency", "master") and picked:
                try:
                    picked = paraphrase_medical_mcqs(picked, ex_lang)
                except Exception:
                    pass
            for i, qd in enumerate(picked):
                qd["id"] = i + 1
            cat_names = list(
                TestBankCategory.objects.filter(pk__in=cat_ids).values_list("name", flat=True)
            )
            samples = [{"text": q["text"], "options": q["options"], "correctAnswer": q["correctAnswer"]} for q in picked]
            ai_part: list[dict] = []
            if n_ai > 0:
                try:
                    ai_part = generate_bank_extension(samples, n_ai, ex_lang, list(cat_names))
                except Exception as ex:
                    import logging as _log

                    _log.getLogger(__name__).warning(
                        "generate_bank_extension failed (bank-only fallback): %s", ex
                    )
                    extra_pool = pool[n_bank : n_bank + n_ai]
                    for row in extra_pool:
                        ai_part.append(bank_row_to_exam_dict(row, ex_lang))
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
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)

    with transaction.atomic():
        se = (
            StudentExam.objects.select_for_update()
            .filter(student_id=u.id, exam_id=pk)
            .select_related("exam")
            .first()
        )
        if not se or se.status != "In Progress":
            return Response({"error": "Cannot submit exam"}, status=403)
        exam = se.exam
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
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)
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
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)
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
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": "Forbidden"}, status=403)
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
    if not u.group_id:
        return Response([])
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
        # Fallback: eski yoki buzilgan summary — hisoblash
        ai = build_fallback_ai_summary(questions, answers)
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
        # Eski natija — AI summary yo'q, fallback bilan qayta hisoblash
        if se.session_questions_json:
            questions = safe_json_loads(se.session_questions_json, [])
        else:
            questions = safe_json_loads(se.exam.questions_json, [])
        answers = norm_answers(safe_json_loads(se.answers_json, {}))
        fallback_ai = build_fallback_ai_summary(questions, answers)
        se.ai_summary_json = json.dumps(fallback_ai)
        se.save(update_fields=["ai_summary_json"])
        b = _result_details_bundle(se, request)
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


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def student_ban_report_pdf(request):
    auth = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth.startswith("Bearer "):
        return Response({"error": "Unauthorized"}, status=401)
    token = auth[7:].strip()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp"]},
            leeway=60,
        )
    except jwt.PyJWTError:
        return Response({"error": "Invalid token"}, status=401)
    sid = (payload.get("id") or payload.get("sub") or "").strip()
    if not sid:
        return Response({"error": "Invalid token payload"}, status=401)
    u = AppUser.objects.filter(pk=sid).first()
    if not u or (u.role or "").strip().lower() != "student":
        return Response({"error": "Forbidden"}, status=403)
    exam_id = request.query_params.get("exam_id")
    se = None
    if exam_id:
        try:
            se = StudentExam.objects.filter(student_id=sid, exam_id=int(exam_id)).select_related("exam").first()
        except (TypeError, ValueError):
            se = None
    if se is None:
        se = (
            StudentExam.objects.filter(student_id=sid, status="Banned")
            .select_related("exam")
            .order_by("-id")
            .first()
        )
    if u.status != "Banned" and (not se or se.status != "Banned"):
        return Response({"error": "Ban report mavjud emas"}, status=404)
    ex_id = se.exam_id if se else 0
    verify_token = signing.dumps({"sid": sid, "eid": ex_id}, salt="ban-report")
    base = public_base_url(request)
    verify_url = f"{base}/api/public/verify-ban-report?token={verify_token}"
    violations = list(
        ViolationLog.objects.filter(student_id=sid, exam_id=ex_id if ex_id else None)
        .order_by("-timestamp")
        .values("violation_type", "timestamp")[:60]
    ) if ex_id else list(
        ViolationLog.objects.filter(student_id=sid).order_by("-timestamp").values("violation_type", "timestamp")[:60]
    )
    pdf = build_ban_report_pdf(
        student_id=sid,
        student_name=u.name,
        exam_title=se.exam.title if se else "N/A",
        issued_at=dj_tz.now().isoformat(),
        violations=violations,
        verify_url=verify_url,
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="BAN_REPORT_{sid}.pdf"'
    return resp


@api_view(["GET"])
@throttle_classes([PublicVerifyThrottle])
@permission_classes([AllowAny])
def public_verify_ban_report(request):
    token = (request.query_params.get("token") or "").strip()
    if not token:
        return Response({"valid": False, "error": "token required"}, status=400)
    try:
        data = signing.loads(token, salt="ban-report", max_age=60 * 60 * 24 * 90)
    except signing.BadSignature:
        return Response({"valid": False, "error": "invalid token"}, status=400)
    sid = str(data.get("sid") or "")
    eid = data.get("eid")
    user = AppUser.objects.filter(pk=sid).first()
    if not user:
        return Response({"valid": False, "error": "student not found"}, status=404)
    se = StudentExam.objects.filter(student_id=sid, exam_id=eid).select_related("exam").first()
    violations_count = ViolationLog.objects.filter(student_id=sid, exam_id=eid).count() if eid else ViolationLog.objects.filter(student_id=sid).count()
    return Response(
        {
            "valid": True,
            "student_id": sid,
            "student_name": user.name,
            "student_status": user.status,
            "exam_id": eid,
            "exam_title": se.exam.title if se else None,
            "violations_count": violations_count,
        }
    )


@api_view(["POST"])
@throttle_classes([ViolationThrottle])
@permission_classes([IsAuthenticated])
def student_violations(request):
    u = request.user
    if u.role != "student":
        return Response({"error": "Forbidden"}, status=403)
    d = request.data or {}
    exam_id, vtype_raw = d.get("exam_id"), d.get("violation_type")
    if exam_id is None or exam_id == "" or vtype_raw is None or vtype_raw == "":
        return Response({"error": "Missing required fields"}, status=400)
    if not isinstance(vtype_raw, str):
        return Response({"error": "Invalid violation_type"}, status=400)
    vtype = vtype_raw.strip()[:80]
    if not vtype:
        return Response({"error": "Invalid violation_type"}, status=400)
    screenshot = str(d.get("screenshot_url") or "")[:50_000]

    instant_ban_types = frozenset(
        {
            "IDENTITY_SUBSTITUTION",
            "REMOTE_CONTROL_SUSPECTED",
        }
    )
    warn_types = frozenset(
        {
            "TAB_SWITCH_HARD",
            "TAB_SWITCH_SOFT",
            "FULLSCREEN_EXIT_HARD",
            "SUSPICIOUS_AUDIO",
            "WHISPER_OR_CONVERSATION_SUSPECTED",
            "CAMERA_MIC_ACCESS_FAILED",
            "FACE_NOT_VISIBLE",
            "MULTIPLE_FACES",
            "GAZE_AWAY_LEFT",
            "GAZE_AWAY_RIGHT",
            "GAZE_AWAY_UP",
            "GAZE_AWAY_DOWN",
            "FORBIDDEN_OBJECT_CELL_PHONE",
            "FORBIDDEN_OBJECT_LAPTOP",
            "FORBIDDEN_OBJECT_BOOK",
            "CLIPBOARD_ATTEMPT",
            "PRINT_SCREEN",
        }
    )
    if vtype not in instant_ban_types and vtype not in warn_types:
        return Response({"error": "Unknown or disallowed violation_type"}, status=400)

    try:
        exam_id_int = int(exam_id)
    except (TypeError, ValueError):
        return Response({"error": "Invalid exam_id"}, status=400)
    if not Exam.objects.filter(pk=exam_id_int).exists():
        return Response({"error": "Exam not found"}, status=404)
    if not _student_assigned_to_exam(u, exam_id_int):
        return Response({"error": "Forbidden"}, status=403)

    # Violation sababini matn sifatida qaytarish
    violation_reason_map = {
        "SUSPICIOUS_AUDIO": "Shubhali ovoz aniqlandi (gapirish yoki shovqin)",
        "FACE_NOT_VISIBLE": "Yuzingiz kamerada ko'rinmayapti",
        "MULTIPLE_FACES": "Kadrda bir nechta shaxs aniqlandi",
        "FORBIDDEN_OBJECT_CELL_PHONE": "Telefon aniqlandi",
        "FORBIDDEN_OBJECT_LAPTOP": "Noutbuk aniqlandi",
        "FORBIDDEN_OBJECT_BOOK": "Kitob aniqlandi",
        "TAB_SWITCH_SOFT": "Boshqa oynaga o'tildi",
        "TAB_SWITCH_HARD": "Imtihon oynasidan chiqib ketildi",
        "CLIPBOARD_ATTEMPT": "Nusxa ko'chirish urinishi",
        "PRINT_SCREEN": "Ekran surati urinishi",
        "FULLSCREEN_EXIT_HARD": "To'liq ekrandan chiqildi",
        "REMOTE_CONTROL_SUSPECTED": "Masofaviy boshqaruv aniqlandi",
        "IDENTITY_SUBSTITUTION": "Boshqa shaxs aniqlandi",
        "GAZE_AWAY_LEFT": "Kamera markazidan chapga uzoq qaraldi (nojo'ya harakat)",
        "GAZE_AWAY_RIGHT": "Kamera markazidan o'ngga uzoq qaraldi (nojo'ya harakat)",
        "GAZE_AWAY_UP": "Tepaga uzoq qaraldi (nojo'ya harakat)",
        "GAZE_AWAY_DOWN": "Pastga uzoq qaraldi (nojo'ya harakat)",
        "WHISPER_OR_CONVERSATION_SUSPECTED": "Past ovoz / gapirish yoki suhbat shubhasi",
        "CAMERA_MIC_ACCESS_FAILED": "Kamera yoki mikrofonni ishga tushirib bo'lmadi",
    }
    reason_text = violation_reason_map.get(vtype, vtype)

    WARN_SUPPRESS_SECONDS = 60
    MAX_WARNINGS_BEFORE_BAN = 3  # 3 ta modal; 4-chi rasmiy epizodda ban

    with transaction.atomic():
        se = (
            StudentExam.objects.select_for_update()
            .filter(student_id=u.id, exam_id=exam_id_int)
            .first()
        )
        if se is None:
            se = StudentExam.objects.create(student_id=u.id, exam_id=exam_id_int, status="Pending")
            se = StudentExam.objects.select_for_update().get(pk=se.pk)

        ViolationLog.objects.create(
            student_id=u.id,
            exam_id=exam_id_int,
            violation_type=vtype,
            timestamp=dj_tz.now(),
            screenshot_url=screenshot,
        )

        cnt_all = ViolationLog.objects.filter(student_id=u.id, exam_id=exam_id_int).count()

        if vtype in instant_ban_types:
            AppUser.objects.filter(pk=u.id).update(status="Banned")
            StudentExam.objects.filter(pk=se.pk).update(status="Banned")
            return Response(
                {
                    "banned": True,
                    "violationsCount": cnt_all,
                    "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                    "violationReason": reason_text,
                    "isFinalWarning": False,
                    "warningSuppressed": False,
                    "officialWarnings": se.proctor_official_warnings,
                }
            )

        now = dj_tz.now()
        last = se.proctor_last_warning_at
        if last is not None and (now - last) < timedelta(seconds=WARN_SUPPRESS_SECONDS):
            return Response(
                {
                    "banned": False,
                    "warningSuppressed": True,
                    "violationsCount": cnt_all,
                    "warningNumber": 0,
                    "violationReason": reason_text,
                    "isFinalWarning": False,
                    "officialWarnings": se.proctor_official_warnings,
                }
            )

        se.proctor_official_warnings = int(se.proctor_official_warnings or 0) + 1
        se.proctor_last_warning_at = now

        if se.proctor_official_warnings >= 4:
            AppUser.objects.filter(pk=u.id).update(status="Banned")
            se.status = "Banned"
            se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at", "status"])
            return Response(
                {
                    "banned": True,
                    "violationsCount": cnt_all,
                    "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                    "violationReason": reason_text,
                    "isFinalWarning": False,
                    "warningSuppressed": False,
                    "officialWarnings": se.proctor_official_warnings,
                }
            )

        se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
        cnt_warn = se.proctor_official_warnings
        is_final = cnt_warn == MAX_WARNINGS_BEFORE_BAN
        return Response(
            {
                "banned": False,
                "warningSuppressed": False,
                "violationsCount": cnt_all,
                "warningNumber": cnt_warn,
                "violationReason": reason_text,
                "isFinalWarning": is_final,
                "officialWarnings": cnt_warn,
            }
        )
