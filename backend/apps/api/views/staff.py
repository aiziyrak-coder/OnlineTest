"""Staff (kuzatuvchi) endpointlari."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def staff_exams_list(request):
    """Nazoratchi ko'radigan imtihonlar.

    STAFF_FULL_POWERS yoqilganda — hammasi. Markazda bir vaqtda o'nlab fan
    topshiriladi, nazoratchi imtihon kimning nomiga yaratilganini bilmaydi.
    O'chirilganda — faqat o'ziga biriktirilgani (teacher_id).
    """
    u = request.user
    if not _is_staff_user(u):
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.views.admin import STAFF_FULL_POWERS

    qs = Exam.objects.all() if STAFF_FULL_POWERS else Exam.objects.filter(teacher_id=u.id)
    exams = list(qs.select_related("teacher").order_by("-start_time")[:400])
    exam_ids = [e.id for e in exams]
    group_map: dict[int, list[int]] = {}
    for eg in ExamGroup.objects.filter(exam_id__in=exam_ids):
        group_map.setdefault(eg.exam_id, []).append(eg.group_id)
    out = []
    for e in exams:
        gids = group_map.get(e.id, [])
        out.append(
            {
                "id": e.id,
                "title": e.title,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                "duration_minutes": e.duration_minutes,
                "language": e.language,
                "exam_mode": e.exam_mode,
                "bank_question_count": e.bank_question_count,
                "group_ids": gids,
            }
        )
    return Response(out)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def staff_exams_results(request, pk: int):
    """Nazoratchi uchun natijalar (admin bilan bir xil struktura).

    STAFF_FULL_POWERS yoqilganda har qanday imtihon natijasi ko'rinadi.
    """
    u = request.user
    if not _is_staff_user(u):
        return Response({"error": "Forbidden"}, status=403)
    from apps.api.views.admin import STAFF_FULL_POWERS

    e = Exam.objects.filter(pk=pk).first() if STAFF_FULL_POWERS else Exam.objects.filter(pk=pk, teacher_id=u.id).first()
    if not e:
        return Response({"error": "Exam not found"}, status=404)
    violations = _violations_with_priority(pk)
    risk_by_student = _student_risk_summary(violations)
    results = []
    for se in StudentExam.objects.filter(exam_id=pk).select_related("student"):
        risk = risk_by_student.get(
            str(se.student_id),
            {
                "violations_count": 0,
                "risk_score": 0,
                "highest_priority": "medium",
                "recommended_review": False,
            },
        )
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
                "risk_score": risk["risk_score"],
                "violations_count": risk["violations_count"],
                "highest_priority": risk["highest_priority"],
                "recommended_review": risk["recommended_review"],
                "question_risk_timeline": _question_risk_timeline(se, e),
                "identity_last_checked_at": (
                    se.identity_last_checked_at.isoformat() if se.identity_last_checked_at else None
                ),
                "identity_last_matched": se.identity_last_matched,
                "identity_last_score": se.identity_last_score,
                "identity_last_method": se.identity_last_method,
                "identity_last_code": se.identity_last_code,
            }
        )
    review_priority_counts = {
        "critical": sum(1 for v in violations if v.get("priority") == "critical"),
        "high": sum(1 for v in violations if v.get("priority") == "high"),
        "medium": sum(1 for v in violations if v.get("priority") == "medium"),
    }
    return Response(
        {
            "results": results,
            "violations": violations,
            "review_priority_counts": review_priority_counts,
            "questions_json": e.questions_json,
            "exam_mode": e.exam_mode,
        }
    )
