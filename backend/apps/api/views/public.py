"""Ochiq (auth talab qilmaydigan) verify + internal realtime endpointlari."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.certificate_pdf import exam_pass_threshold as _exam_pass_thr


def academic_catalog_api_keys() -> frozenset[str]:
    raw = os.environ.get("ONLINE_TEST_PUBLIC_API_KEYS", "") or ""
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def public_academic_catalog(request):
    """Kafedra -> Yo'nalish -> Guruh daraxti — tashqi hamkorlar (masalan iMentor)
    uchun, X-Api-Key header bilan himoyalangan. Faqat o'qish uchun."""
    keys = academic_catalog_api_keys()
    header = (request.headers.get("X-Api-Key") or request.META.get("HTTP_X_API_KEY") or "").strip()
    if not keys or not header or header not in keys:
        return Response({"error": "Valid X-Api-Key header required."}, status=403)

    from django.db.models import Count

    student_counts = {
        row["group_id"]: row["cnt"]
        for row in AppUser.objects.filter(role="student", group_id__isnull=False)
        .values("group_id")
        .annotate(cnt=Count("id"))
    }

    groups_by_direction: dict[int | None, list[dict]] = {}
    for g in Group.objects.filter(is_active=True).select_related("level", "direction"):
        groups_by_direction.setdefault(g.direction_id, []).append(
            {
                "id": g.id,
                "name": g.name,
                "level": g.level.name,
                "student_count": student_counts.get(g.id, 0),
            }
        )

    directions_by_kafedra: dict[int | None, list[dict]] = {}
    for d in Direction.objects.select_related("kafedra").prefetch_related("taught_kafedralar").order_by("name"):
        payload = {
            "id": d.id,
            "name": d.name,
            "groups": groups_by_direction.get(d.id, []),
        }
        kafedra_ids = [k.id for k in d.taught_kafedralar.all()]
        if not kafedra_ids and d.kafedra_id:
            kafedra_ids = [d.kafedra_id]
        if not kafedra_ids:
            directions_by_kafedra.setdefault(None, []).append(payload)
            continue
        for kid in kafedra_ids:
            directions_by_kafedra.setdefault(kid, []).append(payload)

    kafedralar = []
    for kf in Kafedra.objects.filter(is_active=True):
        kafedralar.append(
            {
                "id": kf.id,
                "name": kf.name,
                "code": kf.code,
                "directions": directions_by_kafedra.get(kf.id, []),
            }
        )

    return Response(
        {
            "kafedralar": kafedralar,
            # Kafedraga bog'lanmagan yo'nalishlar (hali qo'lda bog'lanmagan) —
            # iMentor tomonida "kafedrasiz" deb ko'rsatilishi uchun alohida.
            "unassigned_directions": directions_by_kafedra.get(None, []),
        }
    )


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def internal_realtime_exam_access(request):
    """Socket.IO join-exam dan oldin imtihon assignment tekshiruvi (shared secret)."""
    secret = (request.META.get("HTTP_X_REALTIME_SECRET") or "").strip()
    expected = (os.environ.get("REALTIME_INTERNAL_SECRET") or "").strip()
    if not expected or not secret or not hmac.compare_digest(expected, secret):
        return Response({"allowed": False, "error": "forbidden"}, status=403)
    try:
        exam_id = int(request.query_params.get("exam_id", ""))
    except (TypeError, ValueError):
        return Response({"allowed": False, "error": "invalid exam_id"}, status=400)
    user_id = str(request.query_params.get("user_id", "")).strip()
    role = str(request.query_params.get("role", "")).strip().lower()
    if not user_id or exam_id < 1 or role not in ("student", "proctor"):
        return Response({"allowed": False, "error": "invalid params"}, status=400)
    user = AppUser.objects.filter(pk=user_id).first()
    if not user:
        return Response({"allowed": False, "error": "user not found"}, status=403)
    user_role = _request_user_role_norm(user)
    if role == "student":
        if user_role != "student":
            return Response({"allowed": False}, status=403)
        if not _student_assigned_to_exam(user, exam_id):
            return Response({"allowed": False}, status=403)
        return Response({"allowed": True, "role": "student"})
    if user_role not in ("admin", "staff"):
        return Response({"allowed": False}, status=403)
    if user_role == "staff" and not Exam.objects.filter(pk=exam_id, teacher_id=user_id).exists():
        return Response({"allowed": False}, status=403)
    return Response({"allowed": True, "role": user_role})


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
    from apps.api.result_verification import certificate_blocked, notice

    if certificate_blocked(se):
        return Response(
            {"error": notice(se.verify_state, "uz"), "code": "VERIFICATION_" + se.verify_state.upper()},
            status=409,
        )
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(se.exam.questions_json, [])
    if isinstance(questions, list) and questions and any(
        isinstance(q, dict) and not question_references(q) for q in questions
    ):
        try:
            from apps.api.imentor_service import (
                enrich_questions_with_imentor_references,
                sync_ai_summary_item_references,
            )

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
            pass
    answers = norm_answers(safe_json_loads(se.answers_json, {}))
    ai = safe_json_loads(se.ai_summary_json, {})
    if not ai.get("items"):
        ai = build_fallback_ai_summary(
            questions, answers, detect_grading_language(se.exam, answers, raw_questions=questions)
        )
    total = len(questions)
    completed_iso = se.completed_at.isoformat() if se.completed_at else ""
    icode = integrity_code(result_id, completed_iso, se.score, total, k)
    per_q = []
    from apps.api.services import localize_exam_question as _loc, result_display_language as _rdl

    # auto imtihon: talaba javob bergan tilda solishtiramiz — aks holda RU/EN javoblar
    # "noto'g'ri" ko'rinardi, ball esa to'g'ri edi.
    _vlang = _rdl(se.exam, answers, questions, (se.exam.language or "uz").lower())
    if (se.exam.language or "").lower() == "auto":
        questions = [_loc(q, _vlang) for q in questions]
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
                "explanationSource": (ai_row or {}).get("explanationSource")
                or (
                    "api"
                    if question_has_api_explanations(q)
                    else (ai.get("source") or "fallback")
                ),
                "references": (ai_row or {}).get("references") or question_references(q),
            }
        )
    from apps.api.result_privacy import review_hidden as _review_hidden

    _hidden = _review_hidden(se.exam)
    if _hidden:
        per_q = []
        ai = {**ai, "overview": ""}
    pdf_rel = f"/api/public/verify-result/{result_id}/certificate.pdf?k={k}"
    return Response(
        {
            "result_public_id": result_id,
            "integrity_code": icode,
            "overview": ai.get("overview", ""),
            "score": se.score,
            "total": total,
            "percentage": round((se.score / total) * 100) if total else 0,
            # Imtihonning o'z o'tish bali (56%) — sahifa 50% deb taxmin qilmasin.
            "pass_threshold": _exam_pass_thr(se.exam),
            "passed": bool(total) and round((se.score / total) * 100) >= _exam_pass_thr(se.exam),
            "completed_at": completed_iso,
            "exam_title": se.exam.title,
            "student_name": se.student.name,
            "student_group": se.student.group.name if se.student.group_id else "",
            "questions": per_q,
            "questions_hidden": _hidden,
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
    from apps.api.result_verification import certificate_blocked as _v_blocked

    if _v_blocked(se):
        return HttpResponse("Natija tasdiqlanmagan", status=409)
    from apps.api.views.student_results import _upgrade_ai_summary_if_needed

    _upgrade_ai_summary_if_needed(se, request)
    if se.session_questions_json:
        questions = safe_json_loads(se.session_questions_json, [])
    else:
        questions = safe_json_loads(se.exam.questions_json, [])
    if isinstance(questions, list) and questions and any(
        isinstance(q, dict) and not question_references(q) for q in questions
    ):
        try:
            from apps.api.imentor_service import (
                enrich_questions_with_imentor_references,
                sync_ai_summary_item_references,
            )

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
            pass
    answers = norm_answers(safe_json_loads(se.answers_json, {}))
    ai = safe_json_loads(se.ai_summary_json, {})
    if not ai.get("items"):
        ai = build_fallback_ai_summary(
            questions, answers, detect_grading_language(se.exam, answers, raw_questions=questions)
        )
    total = len(questions)
    completed_iso = se.completed_at.isoformat() if se.completed_at else ""
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{result_id}?k={k}"
    icode = integrity_code(result_id, completed_iso, se.score, total, k)
    per_q = []
    from apps.api.pdf_i18n import resolve_pdf_language
    from apps.api.services import localize_exam_question

    lang = resolve_pdf_language(request, se.exam)
    from apps.api.services import result_display_language as _rdl

    lang = _rdl(se.exam, answers, questions, lang)
    for q in questions:
        q_loc = localize_exam_question(q, lang)
        st = answers.get(str(q["id"]), "")
        ok = st == q_loc.get("correctAnswer")
        ai_row = next((i for i in ai.get("items", []) if i.get("questionId") == q["id"]), None)
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
    from apps.api.result_privacy import review_hidden as _review_hidden

    if _review_hidden(se.exam):
        per_q = []
        ai = {**ai, "overview": ""}
    rows = result_questions_to_pdf_rows(per_q)
    pdf = build_certificate_pdf(
        result_id=result_id,
        student_name=se.student.name,
        student_group=se.student.group.name if se.student.group_id else "",
        exam_title=se.exam.title,
        completed_at=completed_iso,
        score=se.score,
        total=total,
        verify_url=verify_url,
        integrity_code=icode,
        overview=ai.get("overview", ""),
        rows=rows,
        pass_threshold=_exam_pass_thr(se.exam),
        lang=lang,
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{result_id}.pdf"'
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


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def public_desktop_info(request):
    """FerMI Exam Platform ilovasi: talab qilinadimi, joriy versiya va yuklab olish manzili."""
    from apps.api.desktop_guard import desktop_download_info

    resp = Response(desktop_download_info())
    resp["Cache-Control"] = "no-store"
    return resp
