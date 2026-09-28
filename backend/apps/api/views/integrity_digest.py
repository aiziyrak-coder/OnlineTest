"""Kunlik nazorat hisoboti — gumonli natijalar va tasdiqlash navbati (admin).

Avtomatik jazo emas: faqat qaysi natijalarni ko'rib chiqish kerakligini bir joyda
ko'rsatadi. Belgilar: qarab-javob naqshi, tez va yuqori natija, ko'p qoidabuzarlik,
yuzma-yuz tasdiqlash holati.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.answer_timing import gaze_answer_assessment
from apps.core.models import ViolationLog

#: Hisobotda alohida sanaladigan og'ir qoidabuzarliklar.
SERIOUS_TYPES = (
    "GAZE_ANSWER_PATTERN",
    "MULTIPLE_FACES",
    "IDENTITY_MISMATCH",
    "PHONE_DETECTED",
    "FORBIDDEN_OBJECT",
    "SCREEN_SHARE_LOST",
    "TAB_SWITCH",
    "WHISPER_OR_CONVERSATION_SUSPECTED",
)


def _pct(se) -> tuple[int | None, int]:
    qs = safe_json_loads(se.session_questions_json or "[]", []) or []
    total = len(qs) or int(getattr(se.exam, "bank_question_count", 0) or 0)
    score = se.verify_original_score if (se.verify_state == "rejected" and se.verify_original_score is not None) else se.score
    if score is None or not total:
        return None, total
    return round(score / total * 100), total


def build_integrity_digest(days: int = 1) -> dict:
    now = dj_tz.now()
    since = now - timedelta(days=days)
    ses = list(
        StudentExam.objects.filter(completed_at__gte=since, status__in=["Completed", "Banned"])
        .select_related("student", "exam")
        .order_by("-completed_at")[:2000]
    )
    viol = defaultdict(Counter)
    for v in ViolationLog.objects.filter(timestamp__gte=since - timedelta(hours=6)).values("student_id", "exam_id", "violation_type"):
        viol[(str(v["student_id"]), v["exam_id"])][v["violation_type"]] += 1

    rows = []
    totals = Counter()
    for se in ses:
        totals["finished"] += 1
        if se.status == "Banned":
            totals["banned"] += 1
        pct, total = _pct(se)
        if pct is not None and pct >= 56 and se.status == "Completed":
            totals["passed"] += 1
        flags = []
        tm = safe_json_loads(se.answer_timings_json or "", {}) or {}
        ga = gaze_answer_assessment(tm) if tm else None
        if ga and ga["suspicious"]:
            flags.append({"code": "GAZE", "label": "javobdan oldin chetga qarash %d/%d" % (ga["glance"], ga["answered"])})
        if se.started_at and se.completed_at and se.exam.duration_minutes and pct is not None and pct >= 80:
            used = (se.completed_at - se.started_at).total_seconds() / 60
            if used < 0.35 * float(se.exam.duration_minutes):
                flags.append({"code": "FAST", "label": "%d daqiqada %d%%" % (round(used), pct)})
        vc = viol.get((str(se.student_id), se.exam_id), Counter())
        serious = sum(vc[t] for t in SERIOUS_TYPES)
        if serious >= 3:
            top = ", ".join("%s×%d" % (t, n) for t, n in vc.most_common(3))
            flags.append({"code": "VIOL", "label": "qoidabuzarlik: %s" % top})
        if se.verify_state:
            totals["verify_" + se.verify_state] += 1
        if not flags and se.verify_state not in ("pending", "rejected"):
            continue
        totals["flagged"] += 1
        rows.append(
            {
                "student_exam_id": se.id,
                "student_id": str(se.student_id),
                "student_name": str(getattr(se.student, "name", "") or ""),
                "exam_title": str(se.exam.title or ""),
                "audience": str(se.exam.audience or ""),
                "status": se.status,
                "percent": pct,
                "total": total,
                "completed_at": se.completed_at.isoformat() if se.completed_at else None,
                "verify_state": se.verify_state or "",
                "test_center": bool(se.test_center_mode),
                "flags": flags,
                "violations": sum(vc.values()),
            }
        )
    rows.sort(key=lambda r: (-(len(r["flags"])), -(r["percent"] or 0)))
    pending_all = StudentExam.objects.filter(verify_state="pending").count()
    return {
        "generated_at": now.isoformat(),
        "days": days,
        "totals": {
            "finished": totals["finished"],
            "passed": totals["passed"],
            "banned": totals["banned"],
            "flagged": totals["flagged"],
            "verify_pending_today": totals["verify_pending"],
            "verify_pending_all": pending_all,
            "verify_confirmed": totals["verify_confirmed"],
            "verify_rejected": totals["verify_rejected"],
        },
        "rows": rows[:500],
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_integrity_digest(request):
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    try:
        days = max(1, min(30, int(request.query_params.get("days") or 1)))
    except (TypeError, ValueError):
        days = 1
    return Response(build_integrity_digest(days))
