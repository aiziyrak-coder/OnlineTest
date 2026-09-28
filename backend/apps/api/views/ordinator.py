"""Ordinator / magistr moduli: to'lov nazorati, kvitansiya va urinishlar.

QOIDALAR (institut talabi):
  * Birinchi urinish BEPUL EMAS. Imtihon yopiq turadi — admin to'lovni
    tasdiqlagach ochiladi (`StudentExam.access_granted`).
  * Ball past bo'lgani uchun yiqilsa — yangi urinish PULLIK. Nomzod
    kvitansiyani rasmga olib yuklaydi, admin buxgalteriya bilan tekshirib
    tasdiqlaydi va bitta urinish ochadi.
  * Tizim aybi bilan uzilsa (ban, texnik nosozlik) — 3 martagacha BEPUL
    qayta urinish. Urinishlar soni foydalanuvchiga ko'rinib turadi.
  * Har urinishda BOSHQA savollar: allaqachon berilgan savol raqamlari
    `served_question_ids` da saqlanadi va keyingi urinishda chetlab o'tiladi.
"""
from __future__ import annotations

import base64
import json
import os

from django.utils import timezone as dj_tz
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.api.views._helpers import (
    IsAuthenticated,
    _is_student_user,
    _request_user_role_norm,
    audit,
    safe_json_loads,
)
from apps.core.models import AppUser, Exam, PaymentReceipt, StudentExam

# Tizim aybi bilan uzilgan urinishlar uchun bepul qayta boshlash chegarasi.
FREE_TECH_RETRIES = 3
MAX_RECEIPT_BYTES = 8 * 1024 * 1024
ALLOWED_MIME = ("image/jpeg", "image/png", "image/webp", "application/pdf")

PAID_ROLES = ("ordinator", "magistr")


def is_paid_role(role: str) -> bool:
    return str(role or "").strip().lower() in PAID_ROLES


# Bir martalik imtihonlar (1-kurs grant attestatsiyasi): to'lov, kvitansiya va
# avtomatik qayta urinish YO'Q. Ruxsat faqat admin ro'yxati bo'yicha beriladi;
# urinish ishlatilgach yangisini faqat administrator "Qayta imkon berish"
# orqali ochadi (audit jurnaliga yoziladi).
def one_attempt_courses() -> set[int]:
    raw = os.environ.get("ORDINATOR_ONE_ATTEMPT_COURSES", "1")
    return {int(x) for x in str(raw).split(",") if x.strip().isdigit()}


def is_one_attempt_exam(exam) -> bool:
    if exam is None:
        return False
    if str(getattr(exam, "audience", "") or "").strip().lower() != "ordinator":
        return False
    return int(getattr(exam, "course", 0) or 0) in one_attempt_courses()


class OneAttemptUsed(Exception):
    """Bir martalik imtihonda urinish allaqachon boshlangan yoki ishlatilgan."""


class SessionInProgress(OneAttemptUsed):
    """Kishi hozir imtihon topshirmoqda — ruxsatni qayta berish uni tozalab yuborardi."""

    msg = "Hozir imtihon topshirmoqda — tugaguncha ruxsatni qayta berib bo'lmaydi."
    code = "SESSION_IN_PROGRESS"


def attempt_error_payload(ex: Exception) -> dict:
    return {
        "error": getattr(ex, "msg", None) or ONE_ATTEMPT_USED_MSG,
        "code": getattr(ex, "code", None) or "ONE_ATTEMPT_USED",
    }


ONE_ATTEMPT_USED_MSG = (
    "Bu imtihon bir martalik: urinish allaqachon boshlangan yoki ishlatilgan. "
    "Qayta topshirishga faqat administrator 'Qayta imkon berish' orqali ruxsat beradi."
)


def hold_contact() -> str:
    return os.environ.get("ORDINATOR_HOLD_CONTACT", "+998 90 786 38 88").strip()


def debt_hold_message() -> str:
    return (
        "Sizda fandan qarzdorlik mavjud, shu sababli test topshira olmaysiz. "
        "Administratorga murojaat qiling: %s" % hold_contact()
    )


def served_ids(se: StudentExam) -> list[int]:
    raw = safe_json_loads(getattr(se, "served_question_ids", "") or "[]", [])
    out = []
    for x in raw if isinstance(raw, list) else []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def remember_served(se: StudentExam, questions: list[dict]) -> None:
    """Berilgan savollarni eslab qoladi — qayta urinishda takrorlanmasin."""
    known = set(served_ids(se))
    for q in questions or []:
        raw = q.get("bank_id") or q.get("source_id") or q.get("id")
        try:
            known.add(int(raw))
        except (TypeError, ValueError):
            continue
    se.served_question_ids = json.dumps(sorted(known))
    se.save(update_fields=["served_question_ids"])


def pick_unseen(bank: list[dict], se: StudentExam, need: int) -> list[dict]:
    """Bankdan avval berilmagan savollarni tanlaydi.

    Yangi savollar yetmay qolsa — bank tugagan degani; shundagina eskilari
    qayta ishlatiladi (imtihon umuman boshlanmay qolgandan ko'ra yaxshiroq).
    """
    import random

    seen = set(served_ids(se))

    def qid(q: dict):
        raw = q.get("bank_id") or q.get("source_id") or q.get("id")
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    fresh = [q for q in bank if qid(q) not in seen]
    if len(fresh) >= need:
        return random.sample(fresh, need)
    out = list(fresh)
    rest = [q for q in bank if q not in fresh]
    if rest:
        out += random.sample(rest, min(need - len(out), len(rest)))
    return out[:need]


def access_state(se: StudentExam | None, exam: Exam, role: str) -> dict:
    """Foydalanuvchi imtihonga kira oladimi va nega yo'q."""
    if not is_paid_role(role):
        return {"locked": False}

    if is_one_attempt_exam(exam):
        one = {"one_attempt": True, "tech_retries_left": 0, "paid_attempts": 0}
        if se is None or not bool(getattr(se, "access_granted", False)):
            if se is not None and str(getattr(se, "access_hold_reason", "") or "") == "DEBT":
                return {
                    **one,
                    "locked": True,
                    "code": "DEBT_HOLD",
                    "contact": hold_contact(),
                    "message": debt_hold_message(),
                }
            return {**one, "locked": True, "code": "NOT_ALLOWED"}
        if str(se.status or "").strip() in ("Completed", "Failed"):
            return {**one, "locked": True, "code": "ATTEMPT_USED"}
        return {**one, "locked": False}

    if se is None:
        return {
            "locked": True,
            "code": "PAYMENT_REQUIRED",
            "tech_retries_left": FREE_TECH_RETRIES,
            "paid_attempts": 0,
        }

    status = str(se.status or "").strip()
    tech_used = int(getattr(se, "technical_retakes_used", 0) or 0)
    tech_left = max(0, FREE_TECH_RETRIES - tech_used)

    base = {
        "tech_retries_left": tech_left,
        "paid_attempts": int(getattr(se, "paid_attempts_granted", 0) or 0),
        "attempts_used": tech_used,
    }
    if not bool(getattr(se, "access_granted", False)):
        return {**base, "locked": True, "code": "PAYMENT_REQUIRED"}
    if status in ("Completed", "Failed"):
        return {**base, "locked": True, "code": "ATTEMPT_USED"}
    return {**base, "locked": False}


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def student_payment_receipts(request):
    """Nomzod kvitansiyasi: ro'yxatini ko'rish va yangisini yuklash."""
    u = request.user
    if not _is_student_user(u) or not is_paid_role(_request_user_role_norm(u)):
        return Response({"error": "Forbidden"}, status=403)

    if request.method == "GET":
        rows = [
            {
                "id": r.id,
                "exam_id": r.exam_id,
                "status": r.status,
                "admin_note": r.admin_note,
                "file_name": r.file_name,
                "created_at": r.created_at.isoformat(),
            }
            for r in PaymentReceipt.objects.filter(student_id=u.id)[:50]
        ]
        return Response({"receipts": rows})

    d = request.data or {}
    file_b64 = str(d.get("file_base64") or "").strip()
    file_name = str(d.get("file_name") or "kvitansiya").strip()[:255]
    file_mime = str(d.get("file_mime") or "").strip().lower()[:100]
    note = str(d.get("note") or "").strip()[:1000]
    try:
        exam_id = int(d.get("exam_id") or 0) or None
    except (TypeError, ValueError):
        exam_id = None

    # Bir martalik imtihonga kvitansiya qabul qilinmaydi (to'lovli urinish yo'q).
    _ex = Exam.objects.filter(pk=exam_id).first() if exam_id else None
    _ucourse = int(getattr(AppUser.objects.filter(pk=u.id).first(), "course", 0) or 0)
    if is_one_attempt_exam(_ex) or (
        _ex is None
        and _request_user_role_norm(u) == "ordinator"
        and _ucourse in one_attempt_courses()
    ):
        return Response(
            {
                "error": "ONE_ATTEMPT_EXAM",
                "detail": "Bu imtihon bir martalik: to'lov va kvitansiya orqali urinish ochilmaydi.",
            },
            status=403,
        )

    if "," in file_b64:
        file_b64 = file_b64.split(",", 1)[1]
    if not file_b64:
        return Response({"error": "FILE_REQUIRED"}, status=400)
    if file_mime not in ALLOWED_MIME:
        return Response({"error": "FILE_TYPE_INVALID"}, status=400)
    try:
        size = len(base64.b64decode(file_b64 + "=" * (-len(file_b64) % 4)))
    except Exception:
        return Response({"error": "FILE_INVALID"}, status=400)
    if size > MAX_RECEIPT_BYTES:
        return Response({"error": "FILE_TOO_LARGE"}, status=400)

    if PaymentReceipt.objects.filter(
        student_id=u.id, status=PaymentReceipt.STATUS_PENDING
    ).exists():
        return Response({"error": "ALREADY_PENDING"}, status=409)

    r = PaymentReceipt.objects.create(
        student_id=u.id,
        exam_id=exam_id,
        file_name=file_name,
        file_mime=file_mime,
        file_base64=file_b64,
        note=note,
    )
    audit(request, "payment_receipt_upload", "payment_receipt", r.id, getattr(u, "name", ""), "")
    return Response({"ok": True, "id": r.id, "status": r.status}, status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_payment_receipts(request):
    """Adminga tushgan kvitansiyalar ro'yxati."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)

    status_f = str(request.query_params.get("status") or "").strip()
    qs = PaymentReceipt.objects.select_related("student", "exam").all()
    if status_f:
        qs = qs.filter(status=status_f)
    rows = []
    for r in qs[:300]:
        rows.append(
            {
                "id": r.id,
                "student_id": str(r.student_id),
                "student_name": str(getattr(r.student, "name", "") or ""),
                "role": str(getattr(r.student, "role", "") or ""),
                "kafedra_name": str(getattr(getattr(r.student, "kafedra", None), "name", "") or ""),
                "exam_id": r.exam_id,
                "exam_title": str(getattr(r.exam, "title", "") or ""),
                "file_name": r.file_name,
                "file_mime": r.file_mime,
                "note": r.note,
                "status": r.status,
                "admin_note": r.admin_note,
                "created_at": r.created_at.isoformat(),
            }
        )
    return Response(
        {
            "receipts": rows,
            "pending": PaymentReceipt.objects.filter(
                status=PaymentReceipt.STATUS_PENDING
            ).count(),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_payment_receipt_file(request, pk: int):
    """Kvitansiya faylining o'zi — admin ko'rishi uchun."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    r = PaymentReceipt.objects.filter(pk=pk).first()
    if not r:
        return Response({"error": "Not found"}, status=404)
    return Response(
        {
            "file_name": r.file_name,
            "file_mime": r.file_mime,
            "file_base64": r.file_base64,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_payment_receipt_resolve(request, pk: int):
    """Kvitansiyani tasdiqlash yoki rad etish.

    Tasdiqlansa — o'sha imtihonga BITTA urinish ochiladi: sessiya tozalanadi,
    ruxsat beriladi. Savollar `served_question_ids` sabab takrorlanmaydi.
    """
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    r = PaymentReceipt.objects.select_related("student").filter(pk=pk).first()
    if not r:
        return Response({"error": "Not found"}, status=404)

    decision = str((request.data or {}).get("decision") or "").strip().lower()
    note = str((request.data or {}).get("note") or "").strip()[:1000]
    if decision not in ("approve", "reject"):
        return Response({"error": "DECISION_INVALID"}, status=400)
    if decision == "approve" and r.exam_id:
        _ex = Exam.objects.filter(pk=r.exam_id).first()
        _se = StudentExam.objects.filter(student_id=r.student_id, exam_id=r.exam_id).first()
        if is_one_attempt_exam(_ex) and _se is not None and str(_se.status or "") != "Pending":
            return Response({"error": ONE_ATTEMPT_USED_MSG, "code": "ONE_ATTEMPT_USED"}, status=409)

    r.status = (
        PaymentReceipt.STATUS_APPROVED if decision == "approve" else PaymentReceipt.STATUS_REJECTED
    )
    r.admin_note = note
    r.reviewed_by = str(getattr(request.user, "id", "") or "")
    r.reviewed_at = dj_tz.now()
    r.save(update_fields=["status", "admin_note", "reviewed_by", "reviewed_at"])

    opened = None
    if decision == "approve":
        try:
            opened = grant_paid_attempt(str(r.student_id), r.exam_id)
        except OneAttemptUsed as ex:
            return Response(attempt_error_payload(ex), status=409)
    audit(
        request,
        "payment_receipt_" + decision,
        "payment_receipt",
        r.id,
        str(getattr(r.student, "name", "") or ""),
        note,
    )
    return Response({"ok": True, "status": r.status, "opened": opened})


def grant_paid_attempt(student_id: str, exam_id: int | None) -> dict | None:
    """To'lov tasdiqlangach bitta urinish ochadi."""
    from apps.api.proctor_exam_retake import reset_fields_for_exam_retake

    qs = StudentExam.objects.filter(student_id=student_id)
    if exam_id:
        qs = qs.filter(exam_id=exam_id)
    else:
        # Imtihon ko'rsatilmagan (masalan imtihonsiz kvitansiya): eng oxirgi
        # sessiyani ko'r-ko'rona tozalash BOSHQA imtihonning tayyor natijasini
        # o'chirib yuborardi. Faqat hali boshlanmagan sessiya ochiladi.
        qs = qs.filter(status="Pending")
    se = qs.select_related("exam").order_by("-id").first()
    if se is not None and str(se.status or "").strip() == "In Progress":
        raise SessionInProgress()

    # Bir martalik imtihon: boshlangan/tugagan sessiyani "ruxsat" tugmasi
    # tozalab yubormasin (natija o'chib, ikkinchi urinish ochilib qolardi).
    if (
        se is not None
        and is_one_attempt_exam(se.exam)
        and str(se.status or "").strip() != "Pending"
    ):
        raise OneAttemptUsed()

    if se is None:
        exam = Exam.objects.filter(pk=exam_id).first() if exam_id else None
        if exam is None:
            return None
        se = StudentExam.objects.create(
            student_id=student_id, exam_id=exam.id, status="Pending"
        )
        fields = []
    else:
        fields = reset_fields_for_exam_retake(se, reason="ruxsat berildi (to'lov/ro'yxat)")

    se.access_granted = True
    se.access_hold_reason = ""
    se.paid_attempts_granted = int(getattr(se, "paid_attempts_granted", 0) or 0) + 1
    fields = list(
        dict.fromkeys(
            list(fields) + ["access_granted", "access_hold_reason", "paid_attempts_granted"]
        )
    )
    se.save(update_fields=fields)
    return {"student_exam_id": se.id, "exam_id": se.exam_id, "status": se.status}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_grant_exam_access(request, pk: int):
    """Admin to'lovni tasdiqlab imtihonni ochadi (kvitansiyasiz ham)."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)
    try:
        opened = grant_paid_attempt(str(se.student_id), se.exam_id)
    except OneAttemptUsed as ex:
        return Response(attempt_error_payload(ex), status=409)
    audit(
        request,
        "grant_exam_access",
        "student_exam",
        pk,
        str(getattr(se.student, "name", "") or ""),
        "to'lov asosida urinish ochildi",
    )
    return Response({"ok": True, "opened": opened})
