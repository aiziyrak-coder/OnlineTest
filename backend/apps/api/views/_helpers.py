"""
views/ package — API endpoint handlerlari.

Keyingi bosqichlarda bo'linishi rejalashtirilgan:
  _helpers.py      — shared helpers (lines 105-518)
  health.py        — health, health_live, health_ready
  auth.py          — auth_login
  student.py       — student exam flow (start, submit, draft, violations)
  student_results.py — results, cert, ban report, appeals
  admin.py         — admin management (users, exams, test bank, groups)
  staff.py         — staff views
  public.py        — public verify + internal realtime
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import tempfile
import base64
import math
import hashlib
import hmac
import time
from datetime import datetime, timedelta
from django.core import signing
import jwt

import bcrypt
from django.conf import settings
from django.db import transaction
from django.db.models import Count, F, Max
from django.http import HttpResponse
from django.utils import timezone as dj_tz
from django.core.cache import cache
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.api.authentication import issue_token
from apps.api.permissions import IsAuthenticatedStrict as IsAuthenticated
from apps.api.exam_time import seconds_until_deadline, student_in_exam_access_window, submission_deadline
from apps.api.throttles import (
    BankAiImportThrottle,
    ExamAutosaveThrottle,
    FaceVerifyThrottle,
    LoginThrottle,
    ProctorFrameThrottle,
    PublicVerifyThrottle,
    ViolationThrottle,
)
from apps.api.certificate_pdf import build_ban_report_pdf, build_certificate_pdf, PASS_PERCENT_THRESHOLD, exam_pass_threshold, result_questions_to_pdf_rows
from apps.api.pdf_i18n import resolve_pdf_language
from apps.api.identity_log import log_identity
from apps.api.proctor_exam_retake import (
    exam_identity_retakes_allowed,
    exam_violation_retakes_allowed,
    violation_retakes_remaining,
)
from apps.api.face_embedding import analyze_proctor_frame_local
from apps.api.gemini_tools import (
    analyze_proctor_frame,
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
    build_exam_ai_summary,
    build_fallback_ai_summary,
    build_student_question_list,
    detect_grading_language,
    exam_questions_add_translations,
    apply_exam_language_to_questions,
    effective_exam_language,
    extract_text_from_bank_upload,
    filter_bank_questions_for_group,
    integrity_code,
    localize_exam_question,
    needs_ai_summary_upgrade,
    next_result_public_id,
    parse_pdf_questions,
    prepare_questions_for_grading,
    public_base_url,
    question_has_api_explanations,
    question_references,
    resolve_student_exam_language,
    resolve_ui_language,
    shuffle_in_place,
)
from apps.api.admin_api_i18n import admin_api_msg
from apps.api.student_api_i18n import student_api_msg  # noqa: F401 — re-export for views
from apps.api.imentor_service import (
    enrich_questions_with_imentor_references,
    sync_ai_summary_item_references,
)
from apps.api.vac_settings import (
    exam_min_submit_seconds,
    identity_verify_max_age_seconds,
    identity_verify_required,
    is_non_desktop_client,
    vac_challenge_guard_enabled,
    vac_device_lock_enabled,
    vac_hmac_guard_enabled,
    vac_pc_only_enabled,
    vac_seq_guard_enabled,
)
from apps.api.view_utils import (
    norm_answers,
    parse_iso_datetime,
    safe_json_loads,
    validate_exam_answers,
    validate_profile_image_b64,
)
from apps.core.models import (
    AppUser,
    AuditLog,
    BanAppeal,
    BanAppealEvent,
    Direction,
    Exam,
    ExamGroup,
    ExamRetakeWindow,
    ExamStudentException,
    Group,
    Kafedra,
    Level,
    StudentExam,
    TestBankCategory,
    TestBankQuestion,
    UnbanEvidence,
    ViolationLog,
)


def audit(request, action: str, target_type: str = "", target_id: str = "", target_name: str = "", detail: str = "") -> None:
    """Fire-and-forget audit log entry. Silently swallows errors."""
    try:
        actor = request.user
        AuditLog.objects.create(
            actor_id=str(actor.id),
            actor_name=str(actor.name or actor.id),
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            target_name=str(target_name),
            detail=str(detail)[:500],
        )
    except Exception:
        pass

logger = logging.getLogger("apps.api")


def _check_pw(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


#: Guruhga emas, KAFEDRAGA biriktiriladigan auditoriyalar.
KAFEDRA_AUDIENCES = ("faculty", "ordinator", "magistr", "vacancy", "entrant")

MIN_APP_PASSWORD_LEN = 10


def _student_assigned_to_exam(user, exam_id: int) -> bool:
    """Talaba guruhi ushbu imtihonga biriktirilgan bo‘lsa True.

    O'qituvchi (faculty) va ordinator GURUHGA kirmaydi — ular imtihonga
    KAFEDRA orqali biriktiriladi. Guruh tekshiruvi ular uchun doim False
    berardi va pre-exam identity bosqichida 403 EXAM_NOT_ASSIGNED chiqib,
    imtihonga umuman kira olmasdilar. Mantiq student_exams_list va
    student_exams_start dagi kafedra tekshiruvi bilan bir xil.
    """
    role = _request_user_role_norm(user)
    if role in ("faculty", "ordinator", "magistr", "vacancy", "entrant"):
        ex = Exam.objects.filter(pk=exam_id).values("audience", "kafedra_id").first()
        if not ex:
            return False
        if str(ex.get("audience") or "student").strip().lower() != role:
            return False
        # Ordinator va magistr ham KAFEDRA orqali biriktiriladi - DAK va
        # bitiruv imtihonlari mutaxassislik kafedrasiga tegishli.
        if not getattr(user, "kafedra_id", None) and role == "ordinator":
            return True
        user_kaf = getattr(user, "kafedra_id", None)
        if user_kaf is None:
            user_kaf = AppUser.objects.filter(pk=user.id).values_list("kafedra_id", flat=True).first()
        exam_kaf = ex.get("kafedra_id")
        if not user_kaf or not exam_kaf:
            return False
        return int(exam_kaf) == int(user_kaf)
    gid = getattr(user, "group_id", None)
    if gid is None:
        return False
    return ExamGroup.objects.filter(exam_id=exam_id, group_id=gid).exists()


def _request_user_role_norm(user) -> str:
    """JWT / DB rollari uchun tekislash (BOM, bo‘shliq, registr)."""
    raw = getattr(user, "role", None)
    if raw is None:
        return ""
    return str(raw).strip().lower().replace("\ufeff", "").strip()


def _is_student_user(user) -> bool:
    """Examinee rollari (talaba / o'qituvchi / ordinator) — imtihon API uchun."""
    # vacancy — ishga kiruvchi nomzod: u ham imtihon topshiradi.
    return _request_user_role_norm(user) in (
        "student", "faculty", "ordinator", "magistr", "vacancy", "entrant"
    )


def _is_bachelor_student(user) -> bool:
    return _request_user_role_norm(user) == "student"


def _is_admin_user(user) -> bool:
    return _request_user_role_norm(user) == "admin"


def _is_staff_user(user) -> bool:
    return _request_user_role_norm(user) == "staff"


def _resolve_exam_teacher_id(request, d: dict) -> str:
    """Imtihon yaratishda mas'ul: admin yoki staff; aks holda joriy admin."""
    raw = d.get("teacher_id")
    if raw in (None, ""):
        return str(request.user.id)
    tid = str(raw).strip()
    assignee = AppUser.objects.filter(pk=tid).first()
    if not assignee:
        return str(request.user.id)
    rn = _request_user_role_norm(assignee)
    if rn in ("admin", "staff"):
        return tid
    return str(request.user.id)


# --- Public / auth ---


def _health_build_ref() -> str | None:
    return (os.environ.get("APP_BUILD_REF") or os.environ.get("GIT_COMMIT") or "").strip() or None


def _request_id(request) -> str | None:
    return getattr(request, "request_id", None)


def _device_session_token_from_request(request) -> str:
    raw = (request.META.get("HTTP_X_DEVICE_SESSION_TOKEN") or "").strip()
    return raw[:128] if raw else ""


def _try_rebind_device_for_resume(se: StudentExam, request, new_token: str, device_fp: str) -> bool:
    """Token yo'qolgan (logout), lekin bir xil qurilma — sessiyani davom ettirish."""
    if not se or not se.started_at:
        return False
    if (se.device_session_token or "").strip():
        got = _device_session_token_from_request(request)
        if got and hmac.compare_digest((se.device_session_token or "").strip(), got):
            return True
    fp = (device_fp or "").strip()
    bound_fp = (se.device_fingerprint or "").strip()
    if fp and bound_fp and fp == bound_fp:
        se.device_session_token = new_token
        se.device_bound_at = dj_tz.now()
        se.save(update_fields=["device_session_token", "device_bound_at"])
        return True
    return False


def _device_fp_from_request(request) -> str:
    raw = (request.META.get("HTTP_X_DEVICE_FINGERPRINT") or "").strip()
    if not raw:
        return ""
    return raw[:128]


def _request_has_exam_session_guard(request) -> bool:
    """Imtihon davomidagi VAC imzoli so'rov (pre-exam identity emas)."""
    return bool(
        str(request.META.get("HTTP_X_EXAM_SEQ") or "").strip()
        or str(request.META.get("HTTP_X_EXAM_SIGNATURE") or "").strip()
    )


def _student_exam_draft_is_empty(se: StudentExam | None) -> bool:
    if not se:
        return True
    raw = (se.draft_answers_json or "").strip() or "{}"
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return True
    if not isinstance(data, dict) or not data:
        return True
    return not any(str(v or "").strip() for v in data.values())


def _reset_abandoned_in_progress(se: StudentExam) -> bool:
    """
    Pre-exam: status In Progress qolib ketgan, lekin imtihon haqiqatan boshlanmagan
    (started_at yo'q). Haqiqiy boshlangan sessiyalarni hech qachon reset qilmaymiz.
    """
    if (se.status or "").strip() != "In Progress":
        return False
    if se.started_at:
        return False
    if not _student_exam_draft_is_empty(se):
        return False
    se.status = "Pending"
    se.started_at = None
    se.device_session_token = ""
    se.device_fingerprint = ""
    se.device_bound_at = None
    se.proctor_official_warnings = 0
    se.proctor_last_warning_at = None
    se.save(
        update_fields=[
            "status",
            "started_at",
            "device_session_token",
            "device_fingerprint",
            "device_bound_at",
            "proctor_official_warnings",
            "proctor_last_warning_at",
        ]
    )
    return True


def _enforce_bound_device_or_403(se: StudentExam, request) -> Response | None:
    """Imtihon sessiyasi faqat server bergan token (yoki eski fingerprint) bilan davom etadi."""
    if not se:
        return None
    expected_token = (se.device_session_token or "").strip()
    if expected_token:
        got = _device_session_token_from_request(request)
        if got and hmac.compare_digest(expected_token, got):
            return None
        # Qurilma tokeni brauzerda domen bo'yicha bitta kalitda saqlanadi.
        # Kompyuter sinfida bir mashinadan ketma-ket kirgan ikkinchi o'qituvchi
        # birinchisining tokenini ustidan yozadi va birinchi sessiya butunlay
        # qulflanib qoladi (save-progress, clock, submit — hammasi 403).
        # Qurilma barmoq izi o'zgarmagan bo'lsa, bu IKKINCHI QURILMA emas:
        # qulfning maqsadi buzilmaydi, sessiyani shu mashinaga qayta bog'laymiz.
        bound_fp = (se.device_fingerprint or "").strip()
        req_fp = _device_fp_from_request(request)
        if req_fp and bound_fp and hmac.compare_digest(req_fp, bound_fp):
            se.device_session_token = got or expected_token
            se.device_bound_at = dj_tz.now()
            se.save(update_fields=["device_session_token", "device_bound_at"])
            return None
        if not got:
            return Response(
                {"error": "Missing device session token", "code": "DEVICE_TOKEN_REQUIRED"},
                status=403,
            )
        return Response(
            {
                "error": "This exam session is locked to another device",
                "code": "DEVICE_MISMATCH",
            },
            status=403,
        )
    expected = (se.device_fingerprint or "").strip()
    if not expected:
        return None
    got = _device_fp_from_request(request)
    if not got:
        return Response({"error": "Missing device fingerprint", "code": "DEVICE_FINGERPRINT_REQUIRED"}, status=403)
    if got != expected:
        return Response(
            {
                "error": "This exam session is locked to another device",
                "code": "DEVICE_MISMATCH",
            },
            status=403,
        )
    return None


def _exam_guarded_response(request, response: Response) -> Response:
    return _attach_vac_response_headers(response, request)


def _reject_non_desktop_or_none(request) -> Response | None:
    """VAC_PC_ONLY: telefon/planshet → 403 VAC_PC_ONLY."""
    if not is_non_desktop_client(request):
        return None
    ui = resolve_ui_language(request)
    return Response(
        {
            "error": student_api_msg("desktop_only", ui),
            "code": "VAC_PC_ONLY",
        },
        status=403,
    )


def _identity_verification_fresh(se: StudentExam | None, now) -> bool:
    """Imtihonni boshlash uchun shaxs tasdig'i YETARLIMI.

    DIQQAT: `identity_verified_at` YANGI bo'lishining o'zi kamlik qiladi.
    Oxirgi tekshiruv MOS KELMAGAN bo'lsa (`identity_last_matched is False`)
    imtihon boshlanmasligi kerak — auditda aynan shu holatdagi 61 ta sessiya
    bemalol yakunlangani aniqlandi. Endi oxirgi natija salbiy bo'lsa,
    talaba qaytadan kameraga qarab tasdiqdan o'tishi shart.
    """
    if not se or not se.identity_verified_at:
        return False
    if getattr(se, "identity_last_matched", None) is False:
        return False
    age = (now - se.identity_verified_at).total_seconds()
    return age <= identity_verify_max_age_seconds()


def _verify_exam_hmac_or_403(se: StudentExam, request) -> Response | None:
    """
    Imtihon davomida request imzosini tekshiradi:
    - X-Exam-Ts (unix sec)
    - X-Exam-Nonce (unikal, qisqa TTL)
    - X-Exam-Signature (HMAC-SHA256)
    """
    enabled_hmac = vac_hmac_guard_enabled()
    enabled_seq = vac_seq_guard_enabled()
    enabled_challenge = vac_challenge_guard_enabled()
    if not enabled_hmac and not enabled_seq and not enabled_challenge:
        return None
    if not se or not se.session_signing_key:
        return Response({"error": "Session signing key missing", "code": "VAC_HMAC_SESSION_MISSING"}, status=403)
    seq_raw = str(request.META.get("HTTP_X_EXAM_SEQ") or "").strip()
    if enabled_seq:
        if not seq_raw:
            return Response({"error": "Missing seq header", "code": "VAC_SEQ_REQUIRED"}, status=403)
        try:
            seq_i = int(seq_raw)
        except (TypeError, ValueError):
            return Response({"error": "Invalid seq", "code": "VAC_SEQ_INVALID"}, status=403)
        if seq_i != int(se.session_request_seq or 1):
            return Response(
                {
                    "error": "Request sequence mismatch",
                    "code": "VAC_SEQ_MISMATCH",
                    "expected_seq": int(se.session_request_seq or 1),
                },
                status=403,
            )

    if enabled_challenge:
        got_challenge = str(request.META.get("HTTP_X_EXAM_CHALLENGE") or "").strip().lower()
        seed = str(se.session_challenge or "").strip()
        if not seed:
            return Response({"error": "Session challenge missing", "code": "VAC_CHALLENGE_SESSION_MISSING"}, status=403)
        if not got_challenge:
            return Response({"error": "Missing challenge header", "code": "VAC_CHALLENGE_REQUIRED"}, status=403)
        expected_challenge = hashlib.sha256(f"{seed}:{int(se.session_request_seq or 1)}".encode("utf-8")).hexdigest()
        if got_challenge != expected_challenge:
            return Response({"error": "Invalid challenge", "code": "VAC_CHALLENGE_MISMATCH"}, status=403)

    if enabled_hmac:
        ts_raw = str(request.META.get("HTTP_X_EXAM_TS") or "").strip()
        nonce = str(request.META.get("HTTP_X_EXAM_NONCE") or "").strip()[:64]
        sig = str(request.META.get("HTTP_X_EXAM_SIGNATURE") or "").strip().lower()
        if not ts_raw or not nonce or not sig:
            return Response({"error": "Missing signed headers", "code": "VAC_HMAC_REQUIRED"}, status=403)
    else:
        ts_raw = "0"
        nonce = ""
        sig = ""
    if enabled_hmac:
        try:
            ts_i = int(ts_raw)
        except (TypeError, ValueError):
            return Response({"error": "Invalid ts", "code": "VAC_HMAC_TS_INVALID"}, status=403)
        max_drift = max(20, int(os.environ.get("VAC_HMAC_MAX_DRIFT_SEC", "90")))
        now_i = int(time.time())
        if abs(now_i - ts_i) > max_drift:
            return Response({"error": "Signed request expired", "code": "VAC_HMAC_TS_EXPIRED"}, status=403)
        cache_key = f"vac:hmac:nonce:{se.id}:{nonce}"
        if not cache.add(cache_key, 1, timeout=max_drift * 2):
            return Response({"error": "Replay detected", "code": "VAC_HMAC_REPLAY"}, status=403)
        try:
            body_bytes = request.body if request.body is not None else b""
        except Exception:
            body_bytes = b""
        body_hash = hashlib.sha256(body_bytes).hexdigest()
        msg = f"{se.id}:{se.student_id}:{se.exam_id}:{ts_i}:{nonce}:{request.method}:{request.path}:{body_hash}"
        exp = hmac.new(se.session_signing_key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(exp, sig):
            return Response({"error": "Invalid signature", "code": "VAC_HMAC_INVALID"}, status=403)

    if enabled_seq:
        updated = StudentExam.objects.filter(pk=se.pk, session_request_seq=se.session_request_seq).update(
            session_request_seq=F("session_request_seq") + 1
        )
        if not updated:
            return Response({"error": "Request sequence race", "code": "VAC_SEQ_RACE"}, status=403)
        se.session_request_seq = int(se.session_request_seq or 1) + 1
        setattr(request, "_vac_next_seq", int(se.session_request_seq or 1))
    if enabled_challenge or enabled_seq:
        new_challenge = secrets.token_hex(16)
        StudentExam.objects.filter(pk=se.pk).update(session_challenge=new_challenge)
        se.session_challenge = new_challenge
        setattr(request, "_vac_next_challenge", new_challenge)
    return None


def _attach_vac_response_headers(resp: Response, request) -> Response:
    nxt_seq = getattr(request, "_vac_next_seq", None)
    nxt_ch = getattr(request, "_vac_next_challenge", None)
    if nxt_seq is not None:
        resp["X-Exam-Seq-Next"] = str(nxt_seq)
    if nxt_ch:
        resp["X-Exam-Challenge-Next"] = str(nxt_ch)
    return resp


def _violation_priority(vtype: str) -> str:
    """Violationlarni review prioritetiga ajratish (admin triage tezlashadi)."""
    critical = {
        "IDENTITY_SUBSTITUTION",
        "REMOTE_CONTROL_SUSPECTED",
        "FORBIDDEN_OBJECT_CELL_PHONE",
        "FORBIDDEN_OBJECT_LAPTOP",
        "FORBIDDEN_OBJECT_BOOK",
    }
    high = {
        "TAB_SWITCH_HARD",
        "FULLSCREEN_EXIT_HARD",
        "MULTIPLE_FACES",
        "WHISPER_OR_CONVERSATION_SUSPECTED",
        "MOUTH_MOVEMENT_TALKING",
        "VIRTUAL_WEBCAM_SUSPECTED",
        "CLIPBOARD_ATTEMPT",
        "PRINT_SCREEN",
    }
    if vtype in critical:
        return "critical"
    if vtype in high:
        return "high"
    return "medium"


def _violations_with_priority(exam_id: int) -> list[dict]:
    rows = list(
        ViolationLog.objects.filter(exam_id=exam_id).values("student_id", "violation_type", "timestamp")
    )
    out: list[dict] = []
    for v in rows:
        ts = v.get("timestamp")
        out.append(
            {
                "student_id": v.get("student_id"),
                "violation_type": v.get("violation_type"),
                "timestamp": ts.isoformat() if hasattr(ts, "isoformat") else ts,
                "priority": _violation_priority(str(v.get("violation_type") or "")),
            }
        )
    return out


def _priority_weight(priority: str) -> int:
    if priority == "critical":
        return 5
    if priority == "high":
        return 3
    return 1


def _student_risk_summary(violations: list[dict]) -> dict[str, dict]:
    per_student: dict[str, dict] = {}
    rank = {"critical": 3, "high": 2, "medium": 1}
    for v in violations:
        sid = str(v.get("student_id") or "")
        if not sid:
            continue
        p = str(v.get("priority") or "medium")
        if sid not in per_student:
            per_student[sid] = {
                "violations_count": 0,
                "risk_score": 0,
                "highest_priority": "medium",
                "recommended_review": False,
            }
        row = per_student[sid]
        row["violations_count"] += 1
        row["risk_score"] += _priority_weight(p)
        if rank.get(p, 1) > rank.get(str(row["highest_priority"]), 1):
            row["highest_priority"] = p
    for sid, row in per_student.items():
        row["recommended_review"] = bool(
            row["highest_priority"] in ("critical", "high") or int(row["violations_count"]) >= 3
        )
    return per_student


def _question_risk_timeline(se: StudentExam, exam: Exam) -> list[dict]:
    questions = safe_json_loads(se.session_questions_json or exam.questions_json, [])
    answers = norm_answers(safe_json_loads(se.answers_json or "{}", {}))
    flagged = set(safe_json_loads(se.flagged_questions_json or "[]", []))
    out: list[dict] = []
    for idx, q in enumerate(questions):
        qid = q.get("id")
        if qid is None:
            continue
        qid_s = str(qid)
        student_answer = answers.get(qid_s)
        correct = q.get("correctAnswer")
        is_incorrect = bool(student_answer and student_answer != correct)
        is_flagged = qid in flagged
        risk_score = (2 if is_flagged else 0) + (1 if is_incorrect else 0)
        if risk_score <= 0:
            continue
        out.append(
            {
                "question_id": qid,
                "question_no": idx + 1,
                "flagged": is_flagged,
                "incorrect": is_incorrect,
                "risk_score": risk_score,
            }
        )
    out.sort(key=lambda x: (x["risk_score"], -x["question_no"]), reverse=True)
    return out[:20]


def _review_queue_rows(limit: int = 100, teacher_id: str | None = None) -> list[dict]:
    rows = list(
        ViolationLog.objects.values("exam_id", "student_id", "violation_type")
        .annotate(cnt=Count("id"), last_ts=Max("timestamp"))
    )
    if teacher_id:
        allowed = set(Exam.objects.filter(teacher_id=teacher_id).values_list("id", flat=True))
        rows = [r for r in rows if int(r["exam_id"]) in allowed]
    by_key: dict[tuple[int, str], dict] = {}
    rank = {"critical": 3, "high": 2, "medium": 1}
    for r in rows:
        exam_id = int(r["exam_id"])
        student_id = str(r["student_id"])
        vtype = str(r["violation_type"])
        cnt = int(r["cnt"] or 0)
        p = _violation_priority(vtype)
        key = (exam_id, student_id)
        if key not in by_key:
            by_key[key] = {
                "exam_id": exam_id,
                "student_id": student_id,
                "violations_count": 0,
                "risk_score": 0,
                "highest_priority": "medium",
                "last_ts": None,
            }
        row = by_key[key]
        last_ts = r.get("last_ts")
        if last_ts and (row["last_ts"] is None or last_ts > row["last_ts"]):
            row["last_ts"] = last_ts
        row["violations_count"] += cnt
        row["risk_score"] += _priority_weight(p) * cnt
        if rank.get(p, 1) > rank.get(row["highest_priority"], 1):
            row["highest_priority"] = p

    out: list[dict] = []
    for (exam_id, student_id), row in by_key.items():
        se = (
            StudentExam.objects.filter(exam_id=exam_id, student_id=student_id)
            .select_related("student", "exam")
            .first()
        )
        if not se:
            continue
        # Admin qatorni yopgan (blokdan chiqargan yoki qayta imkon bergan)
        # bo'lsa va undan keyin yangi buzilish bo'lmagan bo'lsa — navbatda
        # ko'rsatmaymiz. Aks holda bajarilgan ish qaytib turaverardi.
        cleared_at = getattr(se, "review_cleared_at", None)
        if cleared_at and row.get("last_ts") and row["last_ts"] <= cleared_at:
            continue
        pending_appeals = BanAppeal.objects.filter(
            student_id=student_id, exam_id=exam_id, status="Pending"
        ).count()
        status = str(se.status or "")
        if status == "Banned":
            sla = "urgent"
        elif row["highest_priority"] == "critical":
            sla = "high"
        elif row["highest_priority"] == "high":
            sla = "normal"
        else:
            sla = "low"
        out.append(
            {
                "exam_id": exam_id,
                # Admin panelda "Blokdan chiqarish" va "Qayta imkon berish"
                # tugmalari shu id orqali ishlaydi (ilgari qator faqat
                # ma'lumot edi, hech qanday amal bajarib bo'lmasdi).
                "student_exam_id": se.id,
                "exam_title": se.exam.title,
                "student_id": student_id,
                "student_name": se.student.name,
                "status": status,
                "risk_score": row["risk_score"],
                "violations_count": row["violations_count"],
                "highest_priority": row["highest_priority"],
                "pending_appeals": pending_appeals,
                "sla_bucket": sla,
                "recommended_review": bool(
                    status == "Banned"
                    or row["highest_priority"] in ("critical", "high")
                    or row["violations_count"] >= 3
                ),
            }
        )
    out.sort(
        key=lambda x: (
            3 if x["sla_bucket"] == "urgent" else 2 if x["sla_bucket"] == "high" else 1 if x["sla_bucket"] == "normal" else 0,
            x["risk_score"],
            x["violations_count"],
        ),
        reverse=True,
    )
    return out[:limit]


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

def _exam_languages_ready(e: Exam) -> int | None:
    """
    Auto-til imtihonlar uchun: saqlangan savollarning nechtasi UZ/RU/EN uchalasida
    ham to'liq (0..3). Aniq bitta tilli imtihonlarda tushuncha qo'llanilmaydi — None.
    Ro'yxatda "3/3 til tayyor" kabi belgi ko'rsatish uchun ishlatiladi.
    """
    if (e.language or "").lower() != "auto":
        return None
    qs = safe_json_loads(e.questions_json, [])
    if not qs:
        return 0

    def _has(q: dict, lang: str) -> bool:
        if lang == "en":
            return bool((q.get("text_en") or q.get("text") or "").strip())
        if lang == "ru":
            return bool((q.get("text_ru") or "").strip())
        return bool((q.get("text_uz") or q.get("text") or "").strip())

    return sum(1 for lg in ("uz", "ru", "en") if all(_has(q, lg) for q in qs))


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
        "custom_rules": e.custom_rules,
        "exam_mode": e.exam_mode,
        "bank_category_ids": e.bank_category_ids,
        "bank_question_count": e.bank_question_count,
        "imentor_subject_codes": safe_json_loads(getattr(e, "imentor_subject_codes", None) or "[]", []),
        "direction_id": e.direction_id,
        "direction_name": e.direction.name if e.direction_id else None,
        # Yagona manba — `or 3` yozilsa admin qo'ygan 0 jimgina 3 ga aylanardi.
        "technical_retakes_allowed": exam_violation_retakes_allowed(e),
        "identity_retakes_allowed": exam_identity_retakes_allowed(e),
        "proctor_profile": str(getattr(e, "proctor_profile", "") or "standard"),
        "ambient_audio_enabled": bool(getattr(e, "ambient_audio_enabled", True)),
        # Test markazi PIN — admin va kuzatuvchi (test markazidagi tekshiruvchi) ko'radi.
        "test_center_pin": str(getattr(e, "test_center_pin", "") or ""),
        "test_center_enabled": bool(getattr(e, "test_center_pin", "") or "")
        and str(getattr(e, "audience", "") or "") != "vacancy",
        "audience": str(getattr(e, "audience", None) or "student"),
        "languages_ready": _exam_languages_ready(e),
        # Hisobot oynasi uchun: qaysi kafedra va qaysi fan. Nomni frontend
        # /api/admin/kafedralar dan oladi; bu yerda JOIN qilsak har imtihon
        # uchun bitta qo'shimcha so'rov ketardi (56 ta imtihon = 56 so'rov).
        "kafedra_id": getattr(e, "kafedra_id", None),
        "faculty_subject": str(getattr(e, "faculty_subject", None) or ""),
        "course": int(getattr(e, "course", 0) or 0),
        "ai_question_count": int(getattr(e, "ai_question_count", 0) or 0),
    }

def _int_arg(raw, lo: int, hi: int) -> int:
    """Butun son argumenti, chegara ichida qisiladi."""
    try:
        v = int(raw or 0)
    except (TypeError, ValueError):
        return lo
    return max(lo, min(hi, v))


def _course_arg(raw) -> int:
    """Kurs raqami: 0 = belgilanmagan, 1-6 oralig'ida."""
    try:
        v = int(raw or 0)
    except (TypeError, ValueError):
        return 0
    return v if 0 <= v <= 6 else 0


def _test_center_pin_arg(raw) -> str:
    """Test markazi PIN: faqat raqamlar, aniq 4 ta. Aks holda bo'sh (rejim o'chiq)."""
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    return digits if len(digits) == 4 else ""


def _bool_arg(raw, default: bool) -> bool:
    """Form-data ham, JSON ham keladi: "false"/"0"/False hammasi False."""
    if raw is None or raw == "":
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() not in ("0", "false", "no", "off")


def _bank_pool_check(cat_ids: list, need_bank: int) -> tuple[bool, int]:
    pool_len = TestBankQuestion.objects.filter(category_id__in=cat_ids).count()
    return pool_len >= need_bank, pool_len

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

    lang = str(d.get("language") or "uz").lower().strip()[:10]
    if lang not in ("uz", "ru", "en", "auto"):
        lang = "uz"
    raw_mode = str(d.get("exam_mode") or "static").strip()
    if raw_mode == "imentor_mixed":
        mode = "imentor_mixed"
    elif raw_mode == "bank_mixed":
        mode = "bank_mixed"
    elif raw_mode == "faculty_ai_books":
        mode = "faculty_ai_books"
    else:
        mode = "static"
    audience = str(d.get("audience") or "student").strip().lower()
    if audience not in ("student", "faculty", "ordinator", "magistr",
                        "vacancy", "entrant"):
        audience = "student"
    # AI-kitob rejimi kafedra asosidagi auditoriyalar uchun: o'qituvchi va
    # ishga kiruvchi (vakansiya). Ilgari bu yer har doim "faculty" qilib
    # qo'yardi va vakansiya imtihoni o'qituvchilarnikiga aylanib qolardi.
    if mode == "faculty_ai_books" and audience not in ("faculty", "vacancy"):
        audience = "faculty"
    bank_cats_json = "[]"
    imentor_codes_json = "[]"
    bank_count = 0
    questions: list = []
    variant_label_for_direction: str | None = None

    if mode == "faculty_ai_books":
        # Savollar start paytida kafedra kitoblaridan AI bilan yaratiladi.
        bank_count = 20
        questions = []
    elif mode == "imentor_mixed":
        from apps.api.imentor_service import (
            dump_imentor_selection,
            parse_imentor_selection,
            validate_imentor_subjects,
        )

        raw_codes = d.get("imentor_subject_codes")
        selection = parse_imentor_selection(raw_codes if isinstance(raw_codes, (list, dict)) else safe_json_loads(raw_codes or "[]", []))
        # Alohida maydonlar (UI) — selection ustidan ustun
        if d.get("imentor_variant_label"):
            selection["variant_label"] = str(d.get("imentor_variant_label") or "").strip()
        if d.get("imentor_topic_code"):
            selection["topic_code"] = str(d.get("imentor_topic_code") or "").strip().lower()
        variant_label_for_direction = selection.get("variant_label") or None
        raw_list = selection["subject_codes"]
        ok, err, _total = validate_imentor_subjects(
            raw_list,
            variant_label=selection.get("variant_label") or None,
            topic_code=selection.get("topic_code") or None,
        )
        if not ok:
            return Response({"error": err}, status=400)
        from apps.api.imentor_service import (
            fetch_random_imentor_questions,
            normalize_exam_question_count,
            resolve_imentor_subject_codes,
        )

        try:
            codes = resolve_imentor_subject_codes(raw_list)
            bank_count = normalize_exam_question_count(d.get("bank_question_count"))
        except Exception as ex:
            from apps.api.imentor_client import IMentorApiError

            if isinstance(ex, IMentorApiError):
                return Response({"error": str(ex)}, status=400)
            return Response(
                {"error": admin_api_msg("invalid_question_count", resolve_ui_language(request))},
                status=400,
            )
        imentor_codes_json = json.dumps(
            dump_imentor_selection(
                codes,
                variant_label=selection.get("variant_label"),
                topic_code=selection.get("topic_code"),
            )
        )

        # Savollar YARATISHDA olib kelinadi. Til=auto bo'lsa: avvalo iMentor
        # payload.translations (UZ/RU/EN) ishlatiladi — AI qayta tarjima qilmaydi.
        # Tarjima yo'q eski testlarda AI fallback.
        try:
            questions, _meta = fetch_random_imentor_questions(
                codes,
                max_questions=bank_count,
                add_translations=(lang == "auto"),
                # Til belgilangan bo'lsa (uz/ru/en) — API o'sha tildagi matnni
                # tayyor beradi, savol asosiy tili shu bo'lsin.
                source_language=lang if lang in ("uz", "ru", "en") else None,
                variant_label=selection.get("variant_label") or None,
                topic_code=selection.get("topic_code") or None,
            )
        except Exception as ex:
            from apps.api.imentor_client import IMentorApiError

            if isinstance(ex, IMentorApiError):
                return Response({"error": str(ex)}, status=400)
            return Response(
                {"error": admin_api_msg("imentor_load_failed", resolve_ui_language(request))},
                status=502,
            )
    elif mode == "bank_mixed":
        raw_cat_ids = d.get("bank_category_ids")
        if isinstance(raw_cat_ids, list):
            cat_ids = raw_cat_ids
        else:
            cat_ids = safe_json_loads(raw_cat_ids or "[]", [])
        if not isinstance(cat_ids, list) or not cat_ids:
            return Response(
                {"error": admin_api_msg("bank_category_required", resolve_ui_language(request))},
                status=400,
            )
        n = max(1, min(200, int(d.get("bank_question_count") or 20)))
        need_bank = n
        ok, pool_len = _bank_pool_check(cat_ids, need_bank)
        if not ok:
            return Response(
                {
                    "error": admin_api_msg(
                        "bank_pool_short",
                        resolve_ui_language(request),
                        have=pool_len,
                        need=need_bank,
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
    elif audience in ("ordinator", "magistr"):
        # Ordinator/magistr DAK imtihoni: savol bankini admin alohida oynada
        # yuklaydi (`admin/exams/<id>/question-bank`). Imtihon avval bo'sh
        # bank bilan yaratiladi — sana/kafedra tasdiqlansin, savollar keyin.
        questions = []
        try:
            bank_count = max(1, min(200, int(d.get("bank_question_count") or 20)))
        except (TypeError, ValueError):
            bank_count = 20
    else:
        return Response({"error": "No questions provided"}, status=400)

    if lang == "auto" and mode == "static" and questions:
        questions = exam_questions_add_translations(questions)

    st = parse_iso_datetime(start_time)
    et = parse_iso_datetime(end_time)
    if not st or not et:
        return Response({"error": "Invalid datetime"}, status=400)
    if st >= et:
        return Response(
            {"error": admin_api_msg("start_before_end", resolve_ui_language(request))},
            status=400,
        )
    try:
        dur = int(duration_minutes)
    except (TypeError, ValueError):
        return Response(
            {"error": admin_api_msg("duration_invalid", resolve_ui_language(request))},
            status=400,
        )
    if dur <= 0:
        return Response(
            {"error": admin_api_msg("duration_positive", resolve_ui_language(request))},
            status=400,
        )
    # Qoidalar profili tanlovi olib tashlandi — har doim standart profil.
    # Retake chegaralari shundan olinadi (admin ularni alohida o'zgartira oladi).
    from apps.api.proctor_profiles import DEFAULT_PROCTOR_PROFILE, retake_limits_for_profile

    profile = DEFAULT_PROCTOR_PROFILE
    profile_limits = retake_limits_for_profile(profile)
    violation_retakes = max(0, min(20, int(d.get("technical_retakes_allowed") or profile_limits["technical_retakes_allowed"])))
    identity_retakes = max(0, min(5, int(d.get("identity_retakes_allowed") or profile_limits["identity_retakes_allowed"])))
    window_minutes = int((et - st).total_seconds() // 60)
    if dur > window_minutes:
        return Response(
            {
                "error": admin_api_msg(
                    "duration_exceeds_window",
                    resolve_ui_language(request),
                    dur=dur,
                    window=window_minutes,
                )
            },
            status=400,
        )

    group_ids_raw = d.get("group_ids")
    gids = safe_json_loads(group_ids_raw, []) if isinstance(group_ids_raw, str) else (group_ids_raw or [])
    if mode == "faculty_ai_books" or audience in KAFEDRA_AUDIENCES:
        # Kafedra bo'yicha biriktiriladigan auditoriyalar (o'qituvchi,
        # ordinator, magistr, vakansiya) guruhga kirmaydi.
        gids = []
    elif not isinstance(gids, list) or not gids:
        return Response(
            {"error": admin_api_msg("group_required", resolve_ui_language(request))},
            status=400,
        )

    # Direction — Kafedra→Yo'nalish→Guruh integratsiyasi (Bosqich 8). Admin
    # to'g'ridan-to'g'ri direction_id yuborishi mumkin; yubormasa, imentor_mixed
    # rejimida tanlangan variant_label OnlineTest'ning haqiqiy Direction.name
    # bilan solishtiriladi (mos kelsa avtomatik bog'lanadi, mos kelmasa —
    # jim o'tkazib yuboriladi, imtihon yaratish bloklanmaydi).
    direction_id = None
    raw_direction_id = d.get("direction_id")
    if raw_direction_id not in (None, "", "null"):
        if not Direction.objects.filter(pk=raw_direction_id).exists():
            return Response({"error": "Invalid direction"}, status=400)
        direction_id = raw_direction_id
    elif variant_label_for_direction:
        matched = Direction.objects.filter(name__iexact=variant_label_for_direction).first()
        if matched:
            direction_id = matched.id

    ex_raw = d.get("exam_exceptions")
    if isinstance(ex_raw, str):
        ex_list = safe_json_loads(ex_raw, [])
    elif isinstance(ex_raw, list):
        ex_list = ex_raw
    else:
        ex_list = []

    with transaction.atomic():
        kafedra_id = None
        faculty_subject = ""
        if mode == "faculty_ai_books" or audience in KAFEDRA_AUDIENCES:
            faculty_subject = str(d.get("faculty_subject") or d.get("subject") or "").strip()[:300]
            if not faculty_subject:
                return Response(
                    {"error": admin_api_msg("faculty_subject_required", resolve_ui_language(request))},
                    status=400,
                )
            raw_kaf = d.get("kafedra_id")
            if raw_kaf in (None, "", "null"):
                return Response(
                    {"error": admin_api_msg("kafedra_required", resolve_ui_language(request))},
                    status=400,
                )
            try:
                kafedra_id = int(raw_kaf)
            except (TypeError, ValueError):
                return Response({"error": "Invalid kafedra_id"}, status=400)
            if not Kafedra.objects.filter(pk=kafedra_id).exists():
                return Response({"error": "Invalid kafedra"}, status=400)
        ex = Exam.objects.create(
            teacher_id=_resolve_exam_teacher_id(request, d),
            title=title,
            start_time=st,
            end_time=et,
            duration_minutes=dur,
            questions_json=json.dumps(questions),
            language=lang,
            custom_rules=d.get("custom_rules") or "",
            exam_mode=mode,
            audience=audience,
            bank_category_ids=bank_cats_json,
            bank_question_count=bank_count,
            imentor_subject_codes=imentor_codes_json,
            direction_id=direction_id,
            kafedra_id=kafedra_id,
            faculty_subject=faculty_subject,
            course=_course_arg(d.get("course")),
            ai_question_count=_int_arg(d.get("ai_question_count"), 0, 50),
            technical_retakes_allowed=violation_retakes,
            identity_retakes_allowed=identity_retakes,
            proctor_profile=profile,
            # Tashqi shovqin nazorati — default YOQILGAN.
            ambient_audio_enabled=_bool_arg(d.get("ambient_audio_enabled"), True),
            test_center_pin=_test_center_pin_arg(d.get("test_center_pin")),
        )
        if gids:
            ExamGroup.objects.bulk_create([ExamGroup(exam_id=ex.id, group_id=gid) for gid in gids])
        eid = ex.id
        for item in ex_list:
            if not isinstance(item, dict):
                continue
            sid = item.get("student_id")
            if not sid:
                continue
            reason = str(item.get("reason") or "Imtihonga kiritilmadingiz.").strip()[:8000]
            # Istisnolar barcha topshiruvchi rollariga tegishli.
            if not AppUser.objects.filter(
                pk=sid,
                role__in=("student", "faculty", "ordinator", "magistr",
                          "vacancy", "entrant"),
            ).exists():
                continue
            ExamStudentException.objects.update_or_create(
                exam_id=eid, student_id=sid, defaults={"reason": reason}
            )
    audit(request, "create_exam", "exam", eid, title, f"mode={mode}, groups={len(gids)}")
    return Response({"id": eid})

def _result_details_bundle(se: StudentExam, request, for_pdf: bool = False, lang: str | None = None):
    if se.status != "Completed" or not se.result_public_id or not se.result_verify_secret:
        return None
    exam = se.exam
    if lang is None:
        lang = resolve_pdf_language(request, exam)
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(exam.questions_json, [])
    # iMentor backfill dan keyin eski sessiyalarda references bo'sh qolishi mumkin —
    # natija ochilganda bir marta boyitib saqlaymiz.
    if isinstance(questions, list) and questions and any(
        isinstance(q, dict) and not question_references(q) for q in questions
    ):
        try:
            enriched, n = enrich_questions_with_imentor_references(questions)
            if n > 0:
                questions = enriched
                se.session_questions_json = json.dumps(questions, ensure_ascii=False)
                fields = ["session_questions_json"]
                ai_tmp = safe_json_loads(se.ai_summary_json, {})
                if ai_tmp.get("items"):
                    se.ai_summary_json = json.dumps(
                        sync_ai_summary_item_references(ai_tmp, questions),
                        ensure_ascii=False,
                    )
                    fields.append("ai_summary_json")
                se.save(update_fields=fields)
        except Exception:
            logger.warning(
                "imentor references enrich failed se_id=%s exam_id=%s",
                se.id,
                se.exam_id,
                exc_info=True,
            )
    answers = norm_answers(safe_json_loads(se.answers_json, {}))
    from apps.api.services import result_display_language as _rdl

    lang = _rdl(exam, answers, questions, lang)
    ai = safe_json_loads(se.ai_summary_json, {})
    if not ai.get("items"):
        # Fallback: eski yoki buzilgan summary — hisoblash
        ai = build_fallback_ai_summary(questions, answers, lang)
        if not ai.get("items"):
            return "corrupt"
    total = len(questions)
    completed_iso = se.completed_at.isoformat() if se.completed_at else ""
    icode = integrity_code(se.result_public_id, completed_iso, se.score, total, se.result_verify_secret)
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{se.result_public_id}?k={se.result_verify_secret}"
    per_q = []
    for q in questions:
        q_loc = localize_exam_question(q, lang)
        st = answers.get(str(q["id"]), "")
        ok = st == q_loc.get("correctAnswer")
        ai_row = next((i for i in ai["items"] if i.get("questionId") == q["id"]), None)
        per_q.append(
            {
                "id": q["id"],
                "text": q_loc.get("text"),
                "options": q_loc.get("options"),
                "studentAnswer": st or None,
                "correctAnswer": q_loc.get("correctAnswer"),
                "isCorrect": ok,
                "commentCorrect": (ai_row or {}).get("commentCorrect", "") if ok else "",
                "whyStudentWrong": "" if ok else (ai_row or {}).get("whyStudentWrong", ""),
                "whyCorrectIsRight": "" if ok else (ai_row or {}).get("whyCorrectIsRight", ""),
                "explanationSource": (ai_row or {}).get("explanationSource")
                or (
                    "api"
                    if question_has_api_explanations(q_loc) or question_has_api_explanations(q)
                    else (ai.get("source") or "fallback")
                ),
                "references": (ai_row or {}).get("references")
                or question_references(q_loc)
                or question_references(q),
            }
        )
    pct = round((se.score / total) * 100) if total else 0
    return {
        "result_public_id": se.result_public_id,
        "verify_secret": se.result_verify_secret,
        "verify_url": verify_url,
        "integrity_code": icode,
        "overview": ai.get("overview", ""),
        "ai_summary_source": ai.get("source") or "fallback",
        "ai_summary_pending": needs_ai_summary_upgrade(ai),
        "score": se.score,
        "total": total,
        "percentage": pct,
        "pass_threshold": exam_pass_threshold(exam),
        "passed": pct >= exam_pass_threshold(exam),
        "completed_at": completed_iso,
        "exam_title": exam.title,
        "student_name": se.student.name,
        "student_group": se.student.group.name if se.student.group_id else "",
        "questions": per_q,
        "verify_state": str(getattr(se, "verify_state", "") or ""),
        "verify_notice": __import__("apps.api.result_verification", fromlist=["notice"]).notice(
            str(getattr(se, "verify_state", "") or ""), lang or "uz"
        ),
    }

_FORBIDDEN_OBJECT_MAP = {
    "cell_phone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "cellphone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "phone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "mobile": "FORBIDDEN_OBJECT_CELL_PHONE",
    "smartphone": "FORBIDDEN_OBJECT_CELL_PHONE",
    "tablet": "FORBIDDEN_OBJECT_CELL_PHONE",
    "laptop": "FORBIDDEN_OBJECT_LAPTOP",
    "computer": "FORBIDDEN_OBJECT_LAPTOP",
    "book": "FORBIDDEN_OBJECT_BOOK",
    "notes": "FORBIDDEN_OBJECT_BOOK",
    "notebook": "FORBIDDEN_OBJECT_BOOK",
    "paper": "FORBIDDEN_OBJECT_BOOK",
    "notepad": "FORBIDDEN_OBJECT_BOOK",
    "copybook": "FORBIDDEN_OBJECT_BOOK",
    "textbook": "FORBIDDEN_OBJECT_BOOK",
}


# Re-export every module-level symbol (imports + helpers) so endpoint
# modules can do `from apps.api.views._helpers import *`.
__all__ = [_n for _n in dir() if not _n.startswith("__")]
