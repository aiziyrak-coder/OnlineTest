"""Talaba natijalari, sertifikat, ban report va appeal endpointlari."""
from __future__ import annotations

from django.db.models import F

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.proctor_attempt_history import build_attempt_history


def _upgrade_ai_summary_if_needed(se, request) -> None:
    """
    Submit paytida TEZKOR shablon (`build_fallback_ai_summary`) saqlanadi — haqiqiy
    AI tushuntirish (`build_exam_ai_summary`) esa shu yerda, natija birinchi marta
    SO'RALGANDA (natija sahifasi yoki PDF) hisoblanadi. Sabab: AI chaqiruvi
    talabani "Yakunlash" tugmasi oldida kutdirmasin — imtihonni topshirish darhol
    bo'lishi kerak, tushuntirish sifat/tezlik almashinuvi natija ko'rish tomonga
    ko'chiriladi.
    """
    ai_stored = safe_json_loads(se.ai_summary_json, {})
    if not needs_ai_summary_upgrade(ai_stored):
        return
    try:
        if se.session_questions_json:
            raw_questions = safe_json_loads(se.session_questions_json, [])
        else:
            raw_questions = safe_json_loads(se.exam.questions_json, [])
        answers = norm_answers(safe_json_loads(se.answers_json, {}))
        student_lang = resolve_student_exam_language(request, se.exam)
        questions = prepare_questions_for_grading(
            raw_questions, se.exam, answers, student_lang=student_lang
        )
        summary_lang = detect_grading_language(
            se.exam, answers, student_lang=student_lang, raw_questions=raw_questions
        )
        upgraded = build_exam_ai_summary(questions, answers, summary_lang)
        if upgraded.get("items"):
            se.ai_summary_json = json.dumps(upgraded)
            se.save(update_fields=["ai_summary_json"])
    except Exception:
        logger.warning("AI summary upgrade failed for exam_id=%s", se.exam_id, exc_info=True)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def student_ban_appeals(request):
    if not _is_student_user(request.user):
        return Response({"error": "Forbidden"}, status=403)
    u = request.user
    if request.method == "GET":
        rows = (
            BanAppeal.objects.filter(student_id=u.id)
            .select_related("exam", "reviewed_by")
            .order_by("-created_at")[:50]
        )
        out = []
        for r in rows:
            out.append(
                {
                    "id": r.id,
                    "exam_id": r.exam_id,
                    "exam_title": r.exam.title if r.exam_id else None,
                    "status": r.status,
                    "reason": r.reason,
                    "review_note": r.review_note,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                    "reviewed_by": r.reviewed_by_id,
                }
            )
        return Response(out)

    d = request.data or {}
    exam_id = d.get("exam_id")
    reason = str(d.get("reason") or "").strip()
    if not exam_id or not reason:
        return Response(
            {"error": student_api_msg("appeal_fields_required", resolve_ui_language(request))},
            status=400,
        )
    if len(reason) < 12:
        return Response(
            {"error": student_api_msg("appeal_reason_short", resolve_ui_language(request))},
            status=400,
        )
    try:
        exam_id_int = int(exam_id)
    except (TypeError, ValueError):
        return Response({"error": "Invalid exam_id"}, status=400)

    se = StudentExam.objects.filter(student_id=u.id, exam_id=exam_id_int, status="Banned").first()
    if not se and u.status != "Banned":
        return Response(
            {"error": student_api_msg("appeal_no_ban", resolve_ui_language(request))},
            status=400,
        )
    if BanAppeal.objects.filter(student_id=u.id, exam_id=exam_id_int, status="Pending").exists():
        return Response(
            {"error": student_api_msg("appeal_pending_exists", resolve_ui_language(request))},
            status=400,
        )

    evidence_data = str(d.get("evidence_base64") or "")
    evidence_name = str(d.get("evidence_name") or "")[:255]
    evidence_mime = str(d.get("evidence_mime") or "")[:100]
    if evidence_data and len(evidence_data) > 2_500_000:
        return Response({"error": "Evidence payload too large"}, status=400)
    evidence_sha256 = ""
    if evidence_data:
        try:
            if "," in evidence_data:
                raw_b64 = evidence_data.split(",", 1)[1]
            else:
                raw_b64 = evidence_data
            raw_bytes = base64.b64decode(raw_b64, validate=False)
            evidence_sha256 = hashlib.sha256(raw_bytes).hexdigest()
        except Exception:
            evidence_sha256 = hashlib.sha256(evidence_data.encode("utf-8")).hexdigest()

    row = BanAppeal.objects.create(
        student_id=u.id,
        exam_id=exam_id_int,
        reason=reason[:5000],
        evidence_name=evidence_name,
        evidence_mime=evidence_mime,
        evidence_base64=evidence_data,
        evidence_sha256=evidence_sha256,
        status="Pending",
    )
    BanAppealEvent.objects.create(
        appeal_id=row.id,
        actor_id=u.id,
        action="CREATED",
        note=reason[:500],
        meta_json=json.dumps({"exam_id": exam_id_int, "evidence_sha256": evidence_sha256}),
    )
    return Response({"success": True, "id": row.id})
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_results(request):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    # O'qituvchi (faculty) va ordinator GURUHGA kirmaydi - ular imtihonga
    # kafedra orqali biriktiriladi. Guruh sharti ular uchun har doim rost
    # bo'lib chiqardi va natijalar ro'yxati BO'SH qaytardi: imtihonni
    # topshirgan kishi o'z ballini ko'ra olmasdi. Quyidagi so'rov baribir
    # student_id bo'yicha filtrlaydi, ya'ni guruh tekshiruvi ortiqcha.
    _role = str(getattr(u, "role", "") or "").strip().lower()
    if not u.group_id and _role not in (
        "faculty", "ordinator", "magistr", "vacancy", "entrant"
    ):
        return Response([])
    rows = (
        StudentExam.objects.filter(student_id=u.id, status__in=["Completed", "Banned", "Failed"])
        .select_related("exam")
        .order_by(F("completed_at").desc(nulls_last=True), "-id")
    )
    out = []
    for se in rows:
        total = 0
        if se.session_questions_json:
            total = len(safe_json_loads(se.session_questions_json, []))
        else:
            total = len(safe_json_loads(se.exam.questions_json, []))
        pct = round((se.score / total) * 100) if total and se.score is not None else None
        attempts_count = 1 + int(se.technical_retakes_used or 0) + int(se.identity_retakes_used or 0)
        # KELMAGAN (absent): imtihon vaqti tugaganda umuman kirmagan talaba uchun fon
        # vazifa "Failed" + started_at=None yozadi. Buni natijalarda ajratib ko'rsatamiz.
        is_absent = (se.status or "").strip() == "Failed" and se.started_at is None and se.score is None
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
                "ban_reason": (getattr(se, "ban_reason", "") or "").strip(),
                "attempts_count": attempts_count,
                "attempt_history": (
                    build_attempt_history(u.id, se.exam_id, lang=resolve_ui_language(request))
                    if attempts_count > 1
                    else []
                ),
                "absent": is_absent,
            }
        )
    return Response(out)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_result_details(request, exam_id: int):
    if not _is_student_user(request.user):
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
        # Eski natija — AI summary yo'q, qayta hisoblash
        if se.session_questions_json:
            raw_questions = safe_json_loads(se.session_questions_json, [])
        else:
            raw_questions = safe_json_loads(se.exam.questions_json, [])
        answers = norm_answers(safe_json_loads(se.answers_json, {}))
        student_lang = resolve_student_exam_language(request, se.exam)
        questions = prepare_questions_for_grading(
            raw_questions, se.exam, answers, student_lang=student_lang
        )
        summary_lang = detect_grading_language(
            se.exam, answers, student_lang=student_lang, raw_questions=raw_questions
        )
        rebuilt_ai = build_exam_ai_summary(questions, answers, summary_lang)
        se.ai_summary_json = json.dumps(rebuilt_ai)
        se.save(update_fields=["ai_summary_json"])
        b = _result_details_bundle(se, request)
    if not b:
        return Response({"error": "Certificate not available for this attempt"}, status=404)
    _upgrade_ai_summary_if_needed(se, request)
    b = _result_details_bundle(se, request) or b
    from apps.api.result_privacy import hide_review

    return Response(hide_review(b, se.exam))
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_certificate_pdf(request, exam_id: int):
    if not _is_student_user(request.user):
        return Response({"error": "Forbidden"}, status=403)
    se = (
        StudentExam.objects.filter(student_id=request.user.id, exam_id=exam_id)
        .select_related("exam", "student")
        .first()
    )
    if not se or se.status != "Completed":
        return HttpResponse("Not found", status=404)
    lang = resolve_pdf_language(request, se.exam)
    b = _result_details_bundle(se, request, lang=lang)
    if not b:
        return HttpResponse("Not found", status=404)
    _upgrade_ai_summary_if_needed(se, request)
    b = _result_details_bundle(se, request, lang=lang) or b
    from apps.api.result_privacy import hide_review

    b = hide_review(b, se.exam)
    rows = result_questions_to_pdf_rows(b["questions"])
    pdf = build_certificate_pdf(
        result_id=b["result_public_id"],
        student_name=b["student_name"],
        student_group=b.get("student_group", ""),
        exam_title=b["exam_title"],
        completed_at=b["completed_at"],
        score=b["score"],
        total=b["total"],
        verify_url=b["verify_url"],
        integrity_code=b["integrity_code"],
        overview=b["overview"],
        rows=rows,
        pass_threshold=exam_pass_threshold(se.exam),
        lang=lang,
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{b["result_public_id"]}.pdf"'
    return resp


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_student_exam_certificate_pdf(request, pk: int):
    """Admin HAR QANDAY topshiruvchining sertifikatini yuklab oladi.

    Ilgari sertifikatni faqat topshiruvchining o'zi kabinetidan olardi.
    HR va kafedra mudiriga nomzod natijasini hujjat sifatida biriktirish
    kerak bo'ladi — endi "Nomzodlar" sahifasidan to'g'ridan-to'g'ri
    yuklab olinadi.
    """
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    se = (
        StudentExam.objects.select_related("exam", "student")
        .filter(pk=pk)
        .first()
    )
    if not se:
        return HttpResponse("Not found", status=404)
    if se.status != "Completed":
        return HttpResponse("Exam not completed", status=409)

    lang = resolve_pdf_language(request, se.exam)
    b = _result_details_bundle(se, request, lang=lang)
    if not b or b == "corrupt":
        return HttpResponse("Not found", status=404)
    rows = result_questions_to_pdf_rows(b["questions"])
    pdf = build_certificate_pdf(
        result_id=b["result_public_id"],
        student_name=b["student_name"],
        student_group=b.get("student_group", ""),
        exam_title=b["exam_title"],
        completed_at=b["completed_at"],
        score=b["score"],
        total=b["total"],
        verify_url=b["verify_url"],
        integrity_code=b["integrity_code"],
        overview=b["overview"],
        rows=rows,
        pass_threshold=exam_pass_threshold(se.exam),
        lang=lang,
    )
    audit(
        request,
        "download_certificate",
        "student_exam",
        pk,
        str(getattr(se.student, "name", "") or ""),
        "exam=" + str(getattr(se.exam, "title", "")),
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = (
        'attachment; filename="%s.pdf"' % b["result_public_id"]
    )
    return resp


# --- Internal (realtime server) ---
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
        return Response(
            {"error": student_api_msg("ban_report_missing", resolve_ui_language(request))},
            status=404,
        )
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
    last_vtype = str(violations[0].get("violation_type") or "") if violations else ""
    official_warnings = int(getattr(se, "proctor_official_warnings", 0) or 0) if se else 0
    lang = resolve_pdf_language(request, se.exam if se else None)
    pdf = build_ban_report_pdf(
        student_id=sid,
        student_name=u.name,
        exam_title=se.exam.title if se else "N/A",
        issued_at=dj_tz.now().isoformat(),
        violations=violations,
        verify_url=verify_url,
        official_warnings=official_warnings,
        last_violation_type=last_vtype,
        lang=lang,
    )
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="BAN_REPORT_{sid}.pdf"'
    return resp
