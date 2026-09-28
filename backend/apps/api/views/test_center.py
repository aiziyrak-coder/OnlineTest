"""Test markazi — jonli nazorat.

Test markazi xodimi uchun: hozir imtihon topshirayotganlar ro'yxati, ularning
ekrani va kamera kadri, imtihonni o'sha zahoti yakunlash (belgilangan javoblar
bilan) va texnik muammoda qayta ruxsat berish.

Ekran/kamera kadrlari imtihon davomida har ~20 soniyada saqlanadi
(student.py: student_screen_snapshot), shuning uchun bu yerda faqat oxirgisi olinadi.
"""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.core.models import ScreenSnapshot, ViolationLog


def _staff_or_admin(request) -> bool:
    return _request_user_role_norm(request.user) in ("admin", "staff")


def _row(se, viol_by_se, last_shot):
    exam = se.exam
    qs = safe_json_loads(se.session_questions_json or "", []) or []
    draft = safe_json_loads(se.draft_answers_json or "", {}) or {}
    answered = sum(1 for v in draft.values() if v)
    total = len(qs) or int(getattr(exam, "bank_question_count", 0) or 0)
    from apps.api.exam_time import seconds_until_deadline

    left = seconds_until_deadline(exam, se, student_id=str(se.student_id))
    v = viol_by_se.get(se.id) or {}
    shot = last_shot.get(se.id) or {}
    now = dj_tz.now()
    return {
        "student_exam_id": se.id,
        "student_id": str(se.student_id),
        "student_name": str(getattr(se.student, "name", "") or ""),
        "exam_id": exam.id,
        "exam_title": str(exam.title or ""),
        "subject": str(getattr(exam, "faculty_subject", "") or ""),
        "course": int(getattr(exam, "course", 0) or 0),
        "audience": str(getattr(exam, "audience", "") or ""),
        "test_center": bool(se.test_center_mode),
        "started_at": se.started_at.isoformat() if se.started_at else None,
        "elapsed_min": round((now - se.started_at).total_seconds() / 60) if se.started_at else None,
        "seconds_left": left,
        "answered": answered,
        "total": total,
        "warnings": int(getattr(se, "proctor_official_warnings", 0) or 0),
        "last_violation": v.get("type", ""),
        "last_violation_at": v.get("at"),
        "violations": v.get("count", 0),
        "screen_at": shot.get("screen"),
        "webcam_at": shot.get("webcam"),
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_test_center_live(request):
    """Hozir imtihon topshirayotganlar (standart: faqat test markazi rejimi)."""
    if not _staff_or_admin(request):
        return Response({"error": "Forbidden"}, status=403)
    only_center = str(request.query_params.get("all") or "").strip() not in ("1", "true", "yes")
    qs = StudentExam.objects.filter(status="In Progress").select_related("student", "exam")
    if only_center:
        qs = qs.filter(test_center_mode=True)
    if _request_user_role_norm(request.user) == "staff":
        qs = qs.filter(exam__teacher_id=request.user.id)
    rows = list(qs.order_by("started_at")[:300])
    ids = [se.id for se in rows]

    viol_by_se: dict[int, dict] = {}
    if ids:
        se_by_key = {(str(se.student_id), se.exam_id): se for se in rows}
        for v in (
            ViolationLog.objects.filter(exam_id__in=[se.exam_id for se in rows])
            .order_by("-timestamp")
            .values("student_id", "exam_id", "violation_type", "timestamp")[:2000]
        ):
            se = se_by_key.get((str(v["student_id"]), v["exam_id"]))
            if not se or (se.started_at and v["timestamp"] < se.started_at):
                continue
            cur = viol_by_se.setdefault(se.id, {"count": 0, "type": "", "at": None})
            cur["count"] += 1
            if not cur["type"]:
                cur["type"] = str(v["violation_type"] or "")
                cur["at"] = v["timestamp"].isoformat()

    last_shot: dict[int, dict] = {}
    if ids:
        for s in (
            ScreenSnapshot.objects.filter(student_exam_id__in=ids)
            .order_by("student_exam_id", "kind", "-taken_at")
            .values("student_exam_id", "kind", "taken_at")
        ):
            d = last_shot.setdefault(s["student_exam_id"], {})
            if s["kind"] not in d:
                d[s["kind"]] = s["taken_at"].isoformat()

    out = [_row(se, viol_by_se, last_shot) for se in rows]
    return Response({"generated_at": dj_tz.now().isoformat(), "count": len(out), "results": out})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_test_center_frames(request, pk: int):
    """Bitta topshiruvchining oxirgi ekran va kamera kadri."""
    if not _staff_or_admin(request):
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)
    out = {"student_name": str(getattr(se.student, "name", "") or ""), "exam_title": str(se.exam.title or "")}
    for kind in ("screen", "webcam"):
        s = (
            ScreenSnapshot.objects.filter(student_exam_id=pk, kind=kind)
            .order_by("-taken_at")
            .values("taken_at", "image")
            .first()
        )
        out[kind] = {"at": s["taken_at"].isoformat(), "image": s["image"]} if s else None
    return Response(out)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_test_center_finish(request, pk: int):
    """Imtihonni shu zahoti yakunlaydi — belgilangan javoblar hisobga olinadi."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)
    if (se.status or "").strip() != "In Progress":
        return Response({"error": "Sessiya endi faol emas", "code": "NOT_IN_PROGRESS", "status": se.status}, status=409)
    note = str((request.data or {}).get("note") or "").strip()[:300]
    from apps.api.services import finalize_in_progress_locked

    done = finalize_in_progress_locked(se.pk, se.exam)
    se.refresh_from_db()
    audit(
        request,
        "test_center_finish",
        "student_exam",
        str(pk),
        str(getattr(se.student, "name", "") or pk),
        "test markazi: imtihon to'xtatildi, ball=%s; %s" % (se.score, note),
    )
    return Response({"ok": bool(done), "status": se.status, "score": se.score, "result_id": se.result_public_id})
