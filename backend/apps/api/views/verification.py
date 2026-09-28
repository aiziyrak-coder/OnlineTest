"""Yuqori natijani yuzma-yuz tasdiqlash — admin navbati va qaror (result_verification.py)."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.result_verification import CONFIRMED, PENDING, REJECTED, decide


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_verifications(request):
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    state = str(request.query_params.get("state") or PENDING).strip().lower()
    base = StudentExam.objects.exclude(verify_state="")
    counts = {s: base.filter(verify_state=s).count() for s in (PENDING, CONFIRMED, REJECTED)}
    qs = base if state == "all" else base.filter(verify_state=state)
    qs = qs.select_related("student", "exam", "exam__kafedra").order_by("-completed_at")[:500]
    rows = []
    for se in qs:
        total = len(safe_json_loads(se.session_questions_json or "[]", []) or []) or int(se.exam.bank_question_count or 0)
        shown = se.verify_original_score if (se.verify_state == REJECTED and se.verify_original_score is not None) else se.score
        pct = round(shown / total * 100) if (shown is not None and total) else None
        rows.append(
            {
                "student_exam_id": se.id,
                "student_id": str(se.student_id),
                "student_name": str(getattr(se.student, "name", "") or ""),
                "exam_title": str(se.exam.title or ""),
                "audience": str(se.exam.audience or ""),
                "kafedra_name": str(getattr(se.exam.kafedra, "name", "") or "") if se.exam.kafedra_id else "",
                "score": se.score,
                "original_score": se.verify_original_score,
                "total": total,
                "percent": pct,
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                "reason": se.verify_reason or "",
                "state": se.verify_state,
                "note": se.verify_note or "",
                "decided_by": se.verify_by or "",
                "decided_at": se.verify_at.isoformat() if se.verify_at else None,
            }
        )
    return Response({"results": rows, "counts": counts})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def admin_student_exam_verification(request, pk: int):
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if not se:
        return Response({"error": "Not found"}, status=404)
    d = request.data or {}
    decision = str(d.get("decision") or "").strip().lower()
    note = str(d.get("note") or "").strip()
    if decision not in ("confirm", "reject", "pending"):
        return Response({"error": "decision: confirm | reject | pending"}, status=400)
    if decision == "reject" and len(note) < 5:
        return Response({"error": "Rad etish sababini yozing (kamida 5 belgi)."}, status=400)
    if (se.status or "").strip() != "Completed":
        return Response({"error": "Faqat yakunlangan natija tasdiqlanadi."}, status=409)
    decide(se, decision, note, str(request.user.id))
    audit(
        request,
        "verify_result",
        "student_exam",
        str(pk),
        str(getattr(se.student, "name", "") or pk),
        "%s: %s" % (decision, note[:300]),
    )
    return Response({"ok": True, "state": se.verify_state, "score": se.score})
