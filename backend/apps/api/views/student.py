"""Talaba imtihon oqimi: identity, start/submit, draft, violations, proctoring."""
from __future__ import annotations

from django.db.models import Q

from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.tasks import analyze_proctor_frame_task
from apps.api.services import auto_finalize_student_exam_if_expired, bank_row_to_exam_dict_multilingual, exam_questions_add_translations, fill_missing_exam_translations, prepare_questions_for_grading, question_has_api_explanations, question_references, resolve_ui_language
from apps.api.student_api_i18n import student_api_msg
from apps.api.proctor_config import max_warnings_before_ban, warn_suppress_seconds
from apps.api.proctor_escalation import (
    apply_official_warning_or_ban,
    notify_banned as _notify_banned,
)
from apps.api.proctor_exam_retake import (
    exam_identity_retakes_allowed,
    exam_violation_retakes_allowed,
    IDENTITY_VIOLATION_TYPE,
    try_apply_exam_retake,
    notify_exam_retake,
    violation_retakes_budget,
    violation_retakes_remaining,
    identity_retakes_remaining,
    exam_retakes_exhausted,
)
from apps.api.proctor_attempt_history import build_attempt_history
from apps.api.proctor_violation_labels import violation_reason_text
from apps.api.proctor_ban_reason import (
    BAN_REASON_HARDENED,
    BAN_REASON_IDENTITY,
    BAN_REASON_VIOLATION_LIMIT,
    apply_exam_ban,
    session_phase,
)

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _notify_student_unblocked(
    student_id: str,
    student_exam_id: int,
    exam_id: int,
    *,
    can_retake: bool = True,
    unblocked_by: str | None = None,
) -> None:
    """Admin ban yechganda talabaga WebSocket orqali xabar."""
    try:
        layer = get_channel_layer()
        if layer:
            payload: dict = {
                "type": "exam.student_unblocked",
                "student_id": str(student_id),
                "student_exam_id": student_exam_id,
                "exam_id": exam_id,
                "can_retake": can_retake,
            }
            if unblocked_by:
                payload["unblocked_by"] = str(unblocked_by)
            async_to_sync(layer.group_send)(f"exam_{exam_id}", payload)
    except Exception:
        pass


@api_view(["POST"])
@throttle_classes([FaceVerifyThrottle])
@permission_classes([IsAuthenticated])
def student_identity_compare(request):
    u = request.user
    log_identity("identity_compare_enter", user_id=getattr(u, "id", None), role=getattr(u, "role", None))
    if not _is_student_user(u):
        log_identity("identity_reject", reason="STUDENT_ONLY", user_id=getattr(u, "id", None))
        return Response(
            {"error": "Forbidden", "code": "STUDENT_ONLY"},
            status=403,
        )
    body = request.data or {}
    p_raw = body.get("profile_image_base64")
    l_raw = body.get("live_capture_base64")
    if not isinstance(p_raw, str) or not isinstance(l_raw, str):
        log_identity("identity_reject", reason="invalid_body", user_id=u.id)
        return Response({"error": "Invalid body"}, status=400)

    def strip(s: str) -> str:
        t = s.strip()
        return t.split(",", 1)[1].strip() if "," in t else t

    p, l = strip(p_raw), strip(l_raw)
    max_b64 = 14 * 1024 * 1024
    if len(p) < 80 or len(l) < 80 or len(p) > max_b64 or len(l) > max_b64:
        log_identity(
            "identity_reject",
            reason="invalid_image_payload",
            user_id=u.id,
            profile_len=len(p),
            live_len=len(l),
        )
        return Response({"error": "Invalid image payload"}, status=400)
    exam_id_raw = body.get("exam_id")
    eid: int | None = None
    se: StudentExam | None = None
    if exam_id_raw is not None and exam_id_raw != "":
        try:
            eid = int(exam_id_raw)
        except (TypeError, ValueError):
            return Response({"error": "Invalid exam_id"}, status=400)
        if not Exam.objects.filter(pk=eid).exists():
            return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
        if not _student_assigned_to_exam(u, eid):
            return Response(
                {"error": "Forbidden", "code": "EXAM_NOT_ASSIGNED"},
                status=403,
            )
        se = StudentExam.objects.filter(student_id=u.id, exam_id=eid).first()
        if se and (se.status or "").strip() == "In Progress":
            pc_err = _reject_non_desktop_or_none(request)
            if pc_err is not None:
                return pc_err
            if not _request_has_exam_session_guard(request):
                _reset_abandoned_in_progress(se)
                se.refresh_from_db()
            else:
                mismatch = _enforce_bound_device_or_403(se, request)
                if mismatch is not None:
                    body = getattr(mismatch, "data", None) or {}
                    if isinstance(body, dict) and "code" not in body:
                        body = {**body, "code": "DEVICE_MISMATCH"}
                        return Response(body, status=mismatch.status_code)
                    return mismatch
                sig_err = _verify_exam_hmac_or_403(se, request)
                if sig_err is not None:
                    return sig_err
    elif identity_verify_required():
        return Response(
            {"error": "exam_id is required for identity verification", "code": "EXAM_ID_REQUIRED"},
            status=400,
        )
    log_identity(
        "identity_request",
        student_id=u.id,
        exam_id=eid,
        profile_b64_len=len(p),
        live_b64_len=len(l),
    )
    result = compare_faces(p_raw, l_raw)
    if not result.get("success"):
        code = result.get("code") or "GEMINI_ERROR"
        log_identity(
            "identity_api_fail",
            student_id=u.id,
            exam_id=eid,
            code=code,
            detail=(result.get("detail") or "")[:200],
        )
        bypass = settings.DEBUG and os.environ.get("ALLOW_IDENTITY_VERIFY_BYPASS", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if bypass and code in (
            "GEMINI_UNAVAILABLE",
            "GEMINI_ERROR",
            "GEMINI_MODEL_INVALID",
            "FACE_ENGINE_UNAVAILABLE",
        ):
            log_identity("identity_bypass", student_id=u.id, exam_id=eid, code=code)
            resp = Response({"match": True, "skipped": True, "code": code}, status=200)
            if eid is not None:
                se_row, _ = StudentExam.objects.get_or_create(
                    student_id=u.id,
                    exam_id=eid,
                    defaults={"status": "Pending"},
                )
                now_ = dj_tz.now()
                se_row.identity_verified_at = now_
                se_row.identity_last_checked_at = now_
                se_row.identity_last_matched = True
                se_row.identity_last_score = None
                se_row.identity_last_method = "bypass"
                se_row.identity_last_code = code
                se_row.save(
                    update_fields=[
                        "identity_verified_at",
                        "identity_last_checked_at",
                        "identity_last_matched",
                        "identity_last_score",
                        "identity_last_method",
                        "identity_last_code",
                    ]
                )
            return _exam_guarded_response(request, resp) if se else resp
        log_identity("identity_http_503", student_id=u.id, exam_id=eid, code=code)
        return Response({"match": False, "skipped": False, "code": code}, status=503)
    matched = bool(result.get("match"))
    log_identity(
        "identity_result",
        student_id=u.id,
        exam_id=eid,
        match=matched,
        verified_saved=matched and eid is not None,
        ai_note="NO_MATCH — kameraga to'g'ri qarang" if not matched else "OK",
    )
    if eid is not None:
        se_row, _ = StudentExam.objects.get_or_create(
            student_id=u.id,
            exam_id=eid,
            defaults={"status": "Pending"},
        )
        now_ = dj_tz.now()
        if matched:
            # Har 3s'da chaqiriladigan poll — har safar yozmasdan, tashqarida
            # (throttle oralig'i) yoki holat o'zgarganda (fail->match) yozamiz.
            throttle_s = max(5, int(os.environ.get("IDENTITY_SCORE_WRITE_INTERVAL_SECONDS", "30")))
            should_write = (
                se_row.identity_last_checked_at is None
                or (now_ - se_row.identity_last_checked_at) >= timedelta(seconds=throttle_s)
                or se_row.identity_last_matched is not True
            )
            se_row.identity_verified_at = now_
            fields = ["identity_verified_at"]
            if should_write:
                se_row.identity_last_checked_at = now_
                se_row.identity_last_matched = True
                se_row.identity_last_score = result.get("score")
                se_row.identity_last_method = result.get("method") or ""
                se_row.identity_last_code = ""
                fields += [
                    "identity_last_checked_at",
                    "identity_last_matched",
                    "identity_last_score",
                    "identity_last_method",
                    "identity_last_code",
                ]
            se_row.save(update_fields=fields)
        else:
            # Mos kelmagan urinish — hajm o'zi cheklangan (3 marta ketma-ket fail
            # bo'lsa IDENTITY_SUBSTITUTION bilan ban bo'ladi), shuning uchun har
            # doim darhol yoziladi — audit uchun muhim.
            se_row.identity_last_checked_at = now_
            se_row.identity_last_matched = False
            se_row.identity_last_score = result.get("score")
            se_row.identity_last_method = result.get("method") or ""
            se_row.identity_last_code = result.get("code") or ""
            se_row.save(
                update_fields=[
                    "identity_last_checked_at",
                    "identity_last_matched",
                    "identity_last_score",
                    "identity_last_method",
                    "identity_last_code",
                ]
            )
    resp = Response(
        {
            "match": matched,
            "skipped": False,
            "score": result.get("score"),
            "method": result.get("method"),
            **({"code": result.get("code")} if not matched and result.get("code") else {}),
        }
    )
    return _exam_guarded_response(request, resp) if se else resp


# --- Admin: users ---
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exams_list(request):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    role = _request_user_role_norm(u)
    # vacancy (ishga kiruvchi) o'qituvchi bilan bir xil: kafedra bo'yicha.
    if role in ("faculty", "ordinator", "magistr", "vacancy", "entrant"):
        exams_qs = Exam.objects.filter(audience=role).order_by("-id")
        if role in ("faculty", "ordinator", "magistr", "vacancy", "entrant"):
            # O'qituvchi faqat o'z kafedrasiga biriktirilgan imtihonlarni ko'radi.
            uid_kaf = getattr(u, "kafedra_id", None)
            if uid_kaf is None:
                uid_kaf = AppUser.objects.filter(pk=u.id).values_list("kafedra_id", flat=True).first()
            if uid_kaf:
                exams_qs = exams_qs.filter(kafedra_id=uid_kaf)
            else:
                exams_qs = exams_qs.none()
            # Ordinator/magistr KURSI bo'yicha ajratish: 1-kurs ordinatori
            # 2-kurs DAK imtihonini ko'rmasligi kerak. course=0 bo'lgan
            # imtihonlar (kurs belgilanmagan) hammaga ko'rinadi.
            if role in ("ordinator", "magistr"):
                _course = int(getattr(u, "course", 0) or 0)
                if not _course:
                    _course = int(
                        AppUser.objects.filter(pk=u.id)
                        .values_list("course", flat=True)
                        .first() or 0
                    )
                if _course:
                    exams_qs = exams_qs.filter(Q(course=0) | Q(course=_course))
            exams_qs = exams_qs.select_related("kafedra").order_by(
                "kafedra__name", "faculty_subject", "-id"
            )
            # O'qituvchilarni baholash mavsumi tugagach: muddati o'tgan (yopilgan)
            # imtihonlar o'qituvchi kabinetidan yashiriladi. Hisobotlar (admin)
            # StudentExam yozuvlaridan o'qiladi va saqlanadi.
            if role == "faculty":
                exams_qs = exams_qs.filter(end_time__gte=dj_tz.now())
        assigned_ids = list(exams_qs.values_list("id", flat=True))
        if role == "vacancy" and not assigned_ids and uid_kaf:
            # Nomzod kabineti BO'SH qolmasin: kafedra uchun vakansiya imtihoni
            # bo'lmasa avtomatik ochiladi (vakansiya doim ochiq turadi).
            from apps.api.views.vacancy import ensure_vacancy_exam

            if ensure_vacancy_exam(int(uid_kaf)) is not None:
                exams_qs = (
                    Exam.objects.filter(audience=role, kafedra_id=uid_kaf)
                    .select_related("kafedra")
                    .order_by("kafedra__name", "faculty_subject", "-id")
                )
                assigned_ids = list(exams_qs.values_list("id", flat=True))
    else:
        if not u.group_id:
            return Response([])
        assigned_ids = list(
            ExamGroup.objects.filter(group_id=u.group_id).values_list("exam_id", flat=True).distinct()
        )
        if not assigned_ids:
            return Response([])
        exams_qs = Exam.objects.filter(pk__in=assigned_ids).filter(
            Q(audience="student") | Q(audience="") | Q(audience__isnull=True)
        ).order_by("-id")
        assigned_ids = list(exams_qs.values_list("id", flat=True))
        if not assigned_ids:
            return Response([])
    ses_by_exam = {
        se.exam_id: se
        for se in StudentExam.objects.filter(student_id=u.id, exam_id__in=assigned_ids)
    }
    last_violations: dict[int, str] = {}
    if assigned_ids:
        for row in (
            ViolationLog.objects.filter(student_id=u.id, exam_id__in=assigned_ids)
            .order_by("exam_id", "-timestamp")
            .values("exam_id", "violation_type")
        ):
            eid = row["exam_id"]
            if eid not in last_violations:
                last_violations[eid] = str(row.get("violation_type") or "")
    # Faol retake oynalari — talaba imtihonning UMUMIY vaqti tugagach ham
    # kirishi mumkin bo'lgan holat. Klient haqiqiy muddatni bilmasa, imtihon
    # oldi tekshiruvida kamera/AI sarflab, oxirida "Imtihon allaqachon tugagan"
    # xatosiga urilardi (yoki aksincha — haqli retake'ni bloklardi).
    now = dj_tz.now()
    retake_window_end: dict[int, object] = {}
    for row in (
        ExamRetakeWindow.objects.filter(
            student_id=u.id, exam_id__in=assigned_ids, window_end__gte=now
        )
        .order_by("exam_id", "-window_end")
        .values("exam_id", "window_start", "window_end")
    ):
        eid = row["exam_id"]
        if eid in retake_window_end:
            continue
        if row["window_start"] and row["window_start"] > now:
            continue  # hali ochilmagan oyna
        retake_window_end[eid] = row["window_end"]

    out = []
    ui_lang = resolve_ui_language(request)
    from apps.api.views.ordinator import FREE_TECH_RETRIES, access_state, is_paid_role

    _paid_role_list = is_paid_role(role)
    _last_receipt: dict[int, dict] = {}
    _receipt_any = None
    if _paid_role_list:
        from apps.core.models import PaymentReceipt

        for r in PaymentReceipt.objects.filter(student_id=u.id).order_by("-created_at"):
            info = {
                "id": r.id,
                "status": r.status,
                "admin_note": r.admin_note,
                "created_at": r.created_at.isoformat(),
            }
            if _receipt_any is None:
                _receipt_any = info
            if r.exam_id and r.exam_id not in _last_receipt:
                _last_receipt[r.exam_id] = info
    for e in exams_qs:
        se = ses_by_exam.get(e.id)
        if se is not None and (se.status or "").strip() == "In Progress":
            if auto_finalize_student_exam_if_expired(se, e, str(u.id)):
                se.refresh_from_db()
                ses_by_exam[e.id] = se
        if se is not None and se.status in ("Completed", "Banned", "Failed"):
            # Ordinator/magistr uchun yakunlangan imtihon ham ko'rinib turadi:
            # kabinetda "imkoniyat tugadi -> kvitansiya yuklash" oynasi shu
            # kartochkada ochiladi. Ban esa har doim yashiriladi.
            if not (_paid_role_list and se.status in ("Completed", "Failed")):
                continue
        in_progress = se is not None and (se.status or "").strip() == "In Progress" and bool(se.started_at)
        if se is not None:
            v_used = int(getattr(se, "technical_retakes_used", 0) or 0)
            id_used = int(getattr(se, "identity_retakes_used", 0) or 0)
            v_remaining = violation_retakes_remaining(se, e)
            v_budget = violation_retakes_budget(se, e)
            id_remaining = identity_retakes_remaining(se, e)
        else:
            v_used = 0
            id_used = 0
            v_budget = exam_violation_retakes_allowed(e)
            v_remaining = v_budget
            id_remaining = exam_identity_retakes_allowed(e)
        last_vtype = last_violations.get(e.id, "")
        bank_n = len(safe_json_loads(e.questions_json, []))
        kaf_name = ""
        if getattr(e, "kafedra_id", None) and getattr(e, "kafedra", None):
            kaf_name = str(e.kafedra.name or "").strip()
        out.append(
            {
                "id": e.id,
                "title": e.title,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                # Talaba UCHUN haqiqiy oxirgi muddat: umumiy tugash vaqti yoki
                # (agar berilgan bo'lsa) faol retake oynasining oxiri — qaysi
                # kechroq bo'lsa. Klient shu bo'yicha imtihon tugaganini biladi.
                "access_until": (
                    max(e.end_time, retake_window_end[e.id]).isoformat()
                    if e.end_time and e.id in retake_window_end
                    else (
                        retake_window_end[e.id].isoformat()
                        if e.id in retake_window_end
                        else (e.end_time.isoformat() if e.end_time else None)
                    )
                ),
                "duration_minutes": e.duration_minutes,
                "language": e.language,
                "custom_rules": e.custom_rules,
                "exam_mode": e.exam_mode,
                "bank_question_count": e.bank_question_count,
                "faculty_subject": getattr(e, "faculty_subject", None) or "",
                "kafedra_id": getattr(e, "kafedra_id", None),
                "kafedra_name": kaf_name,
                "questions_ready": bank_n >= max(5, int(e.bank_question_count or 20) // 2),
                "questions_count": bank_n,
                "in_progress": in_progress,
                "started_at": se.started_at.isoformat() if in_progress and se.started_at else None,
                "student_exam_id": se.id if se else None,
                "access": (
                    {
                        **access_state(se, e, role),
                        "free_tech_retries": FREE_TECH_RETRIES,
                        "receipt": _last_receipt.get(e.id) or _receipt_any,
                    }
                    if _paid_role_list
                    else None
                ),
                "violation_retakes_used": v_used,
                "violation_retakes_remaining": v_remaining,
                "violation_retakes_budget": v_budget,
                "identity_retakes_used": id_used,
                "identity_retakes_remaining": id_remaining,
                "last_violation_type": last_vtype,
                "last_violation_reason": (
                    violation_reason_text(last_vtype, ui_lang) if last_vtype else ""
                ),
                "exam_retakes_blocked": (
                    exam_retakes_exhausted(se, e) if se is not None else False
                ),
                "session_phase": session_phase(se),
                "identity_refresh_required": bool(
                    se is not None
                    and identity_verify_required()
                    and not _identity_verification_fresh(se, now)
                ),
                "attempt_history": (
                    build_attempt_history(u.id, e.id, lang=ui_lang) if se else []
                ),
            }
        )
    return Response(out)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_vac_rules(request, pk: int):
    """Imtihon nazorati qoidalari — topshiruvchiga ko'rsatiladigan matn.

    Matn JONLI sozlamalardan yaratiladi, shuning uchun u tizimning
    haqiqiy xatti-harakatidan hech qachon farq qilmaydi.
    """
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response(
            {"error": student_api_msg("exam_not_found", resolve_ui_language(request))},
            status=404,
        )
    from apps.api.vac_rules import build_vac_rules

    lang = resolve_ui_language(request) or "uz"
    doc = build_vac_rules(exam, lang, str(u.id))
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    doc["already_accepted"] = bool(se and se.vac_consent_at)
    return Response(doc)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_vac_consent(request, pk: int):
    """Qoidalarga rozilikni QAYD ETADI (apellyatsiya uchun dalil).

    Saqlanadi: vaqt, ko'rsatilgan matnning barmoq izi va IP. Shu uchtasi
    birgalikda "u aynan SHU qoidalarga, SHU paytda rozi bo'lgan" degan
    dalilni beradi.

    Shu bilan birga imtihon oldida O'LCHANGAN mikrofon darajasi ham
    yoziladi — keyin mikrofon jim bo'lib qolsa, uning boshida
    ishlaganini isbotlaydi.
    """
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden"}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response(
            {"error": student_api_msg("exam_not_found", resolve_ui_language(request))},
            status=404,
        )
    if not _student_assigned_to_exam(u, pk):
        return Response(
            {"error": student_api_msg("forbidden", resolve_ui_language(request))},
            status=403,
        )

    d = request.data or {}
    accepted = bool(d.get("accepted"))
    if not accepted:
        return Response({"error": "CONSENT_REQUIRED"}, status=400)

    from apps.api.vac_rules import build_vac_rules

    lang = resolve_ui_language(request) or "uz"
    expected = str(build_vac_rules(exam, lang, str(u.id)).get("version") or "")
    got = str(d.get("version") or "")
    # Klient ko'rsatgan matn serverdagi bilan bir xilmi. Mos kelmasa —
    # qoidalar shu orada o'zgargan; eski matnga berilgan rozilik
    # qabul qilinmaydi va nomzodga yangisi ko'rsatiladi.
    if got and expected and got != expected:
        return Response(
            {"error": "RULES_CHANGED", "version": expected}, status=409,
        )

    try:
        mic = float(d.get("mic_level") or 0) or None
    except (TypeError, ValueError):
        mic = None

    se, _ = StudentExam.objects.get_or_create(
        student_id=u.id, exam_id=pk, defaults={"status": "Pending"},
    )
    se.vac_consent_at = dj_tz.now()
    se.vac_consent_version = expected[:64]
    se.vac_consent_ip = str(
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR", "")
    )[:64]
    fields = ["vac_consent_at", "vac_consent_version", "vac_consent_ip"]
    if mic is not None:
        se.mic_level_at_start = mic
        fields.append("mic_level_at_start")
    se.save(update_fields=fields)

    logger.info(
        "[VAC-CONSENT] student=%s exam=%s version=%s ip=%s mic=%s",
        u.id, pk, se.vac_consent_version, se.vac_consent_ip, mic,
    )
    return Response({"success": True, "version": expected})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_proctor_diagnostics(request):
    """Brauzerdagi proctoring engine holatini SERVER LOGIGA yozadi.

    NEGA KERAK: real-time engine (MediaPipe) talaba brauzerida yiqilsa, xato
    faqat o'sha brauzer konsolida qolardi — va production build `console.warn`
    ni butunlay olib tashlaydi (`vite.config.ts` `pure_funcs`), ya'ni xato
    hech qayerda ko'rinmasdi. Natijada nazorat jimgina o'chib turishi mumkin
    edi va buni hech kim bilmasdi.

    Endi klient sababni shu yerga yuboradi va u `docker compose logs` da
    ko'rinadi. Qidirish uchun: [PROCTOR-DIAG].

    DIQQAT: bu QOIDABUZARLIK EMAS va bazaga hech narsa yozmaydi — faqat log.
    Talaba aybdor emas (eski qurilma, GPU yo'q, tarmoq CDN'ni bloklagan).
    """
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)

    d = request.data or {}
    stage = str(d.get("stage") or "")[:40]
    ok = bool(d.get("ok"))
    detail = str(d.get("detail") or "")[:600]
    env = str(d.get("env") or "")[:400]
    exam_id = str(d.get("exam_id") or "")[:20]

    line = (
        f"[PROCTOR-DIAG] student={getattr(u, 'id', '?')} exam={exam_id or '-'} "
        f"stage={stage or '-'} ok={ok} detail={detail or '-'}"
        + (f" env=[{env}]" if env else "")
    )
    # Yiqilish `error` darajasida — prod log filtrlarida ham ko'rinsin.
    if ok:
        logger.info(line)
    else:
        logger.error(line)
    # Konteyner stdout'iga ham (gunicorn/uvicorn logger sozlamalaridan qat'i nazar).
    print(line, flush=True)

    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_proctor_config(request):
    if not _is_student_user(request.user):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    return Response(
        {
            "max_warnings_before_ban": max_warnings_before_ban(),
            "warn_suppress_seconds": warn_suppress_seconds(),
        }
    )
def _plan_ai_share(plan: list, ai_total: int) -> dict[int, int]:
    """AI savollarini fanlar bo'yicha taqsimlaydi (nisbatni saqlab).

    30 savol / 12 AI / 3 fan  ->  har fanga 4 ta AI (6 bank + 4 AI = 10).
    Bo'linmaganda qoldiq eng katta fanlarga beriladi.
    """
    counts = []
    for i, item in enumerate(plan):
        if not isinstance(item, dict):
            continue
        try:
            c = int(item.get("count") or 0)
        except (TypeError, ValueError):
            c = 0
        if c > 0:
            counts.append((i, c))
    total = sum(c for _, c in counts)
    if total <= 0 or ai_total <= 0:
        return {}
    share: dict[int, int] = {}
    for i, c in counts:
        # Fanning o'z hajmiga mutanosib, lekin kamida 1 ta bank savoli qolsin.
        share[i] = min(c - 1, int(ai_total * c / total))
    # Yaxlitlash qoldig'ini kattaroq fanlarga tarqatamiz.
    left = ai_total - sum(share.values())
    for i, c in sorted(counts, key=lambda x: -x[1]):
        while left > 0 and share.get(i, 0) < c - 1:
            share[i] = share.get(i, 0) + 1
            left -= 1
        if left <= 0:
            break
    return share


def _compose_from_plan(
    plan: list, se, paid: bool, *, ai_total: int = 0, language: str = "uz",
) -> list[dict]:
    """Ko'p fanli imtihon tarkibini yig'adi.

    plan = [{"exam_id": 406, "count": 10}, ...] — har bir manba imtihonning
    bankidan shuncha savol olinadi. Qayta urinishda avval berilganlari
    chetlab o'tiladi, ya'ni savollar takrorlanmaydi.

    `ai_total` berilsa, AI savollari HAR BIR FAN ICHIDA o'rin egallaydi —
    fanlar nisbati («3 fandan 10 tadan») shu tarzda saqlanadi.
    """
    import random as _r

    from apps.api.views.ordinator import pick_unseen, remember_served

    ai_share = _plan_ai_share(plan, ai_total)
    out: list[dict] = []
    for _idx, item in enumerate(plan):
        if not isinstance(item, dict):
            continue
        try:
            src_id = int(item.get("exam_id") or 0)
            cnt = int(item.get("count") or 0)
        except (TypeError, ValueError):
            continue
        if src_id <= 0 or cnt <= 0:
            continue
        src = (
            Exam.objects.filter(pk=src_id)
            .only("questions_json", "faculty_subject", "title")
            .first()
        )
        if not src:
            logger.warning("question_plan: manba imtihon topilmadi id=%s", src_id)
            continue
        bank = safe_json_loads(src.questions_json, []) or []
        bank = [q for q in bank if isinstance(q, dict) and q.get("text")]
        # Reja fanni ham belgilashi mumkin: shunda imtihonning O'Z
        # bankidan aynan shu fanning savollari olinadi. Ko'p fanli
        # imtihonda («3 fandan 10 tadan») nisbat shu yo'l bilan saqlanadi.
        _want_subject = str(item.get("subject") or "").strip().lower()
        if _want_subject:
            bank = [
                q for q in bank
                if str(q.get("subject") or "").strip().lower() == _want_subject
            ]
        if not bank:
            logger.warning(
                "question_plan: bank bo'sh (manba=%s fan=%r)", src_id, _want_subject,
            )
            continue
        for q in bank:
            if not q.get("source_id"):
                q["source_id"] = q.get("id")
        # Shu fanga tegishli AI ulushi — qolgani bankdan olinadi.
        _ai_n = max(0, min(int(ai_share.get(_idx, 0)), cnt - 1))
        _bank_n = max(1, cnt - _ai_n)

        if paid:
            picked = pick_unseen(bank, se, _bank_n)
            remember_served(se, picked)
        else:
            picked = _r.sample(bank, min(_bank_n, len(bank)))

        if _ai_n > 0:
            from apps.api.ai_question_gen import (
                _norm as _ai_norm,
                generate_harder_similar,
            )

            _subject = (
                str(item.get("subject") or "").strip()
                or str(getattr(src, "faculty_subject", "") or "")
                or str(getattr(src, "title", "") or "")
            )
            try:
                _gen = generate_harder_similar(
                    picked or bank[:6],
                    _ai_n,
                    language=language,
                    subject=_subject,
                    avoid_texts={_ai_norm(q.get("text"))[:180] for q in bank},
                )
            except Exception:
                logger.exception(
                    "reja AI savol yaratish yiqildi manba=%s", src_id,
                )
                _gen = []
            picked = list(picked) + list(_gen)
            # AI yetarli bermasa — o'sha FANNING bankidan to'ldiramiz,
            # aks holda bu fandan savol soni kamayib qolardi.
            _short = cnt - len(picked)
            if _short > 0:
                _used = {q.get("text") for q in picked}
                _rest = [q for q in bank if q.get("text") not in _used]
                if _rest:
                    _extra = _r.sample(_rest, min(_short, len(_rest)))
                    if paid:
                        remember_served(se, _extra)
                    picked += _extra
                logger.warning(
                    "reja: %s fanidan AI %d ta yetmadi, bankdan to'ldirildi",
                    _subject[:40], _short,
                )
        out.extend(picked)
    _r.shuffle(out)
    return out


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def _student_exams_start_impl(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
    role = _request_user_role_norm(u)
    exam_audience = str(getattr(exam, "audience", None) or "student").strip().lower() or "student"
    if role in ("faculty", "ordinator", "magistr", "vacancy", "entrant"):
        if exam_audience != role:
            return Response({"error": student_api_msg("exam_not_assigned", resolve_ui_language(request))}, status=403)
    else:
        if not ExamGroup.objects.filter(exam_id=pk, group_id=u.group_id).exists():
            return Response({"error": student_api_msg("exam_not_assigned", resolve_ui_language(request))}, status=403)

    # Kurs mos kelmasa — boshqa kursning imtihonini boshlab bo'lmaydi.
    if role in ("ordinator", "magistr"):
        _ecourse = int(getattr(exam, "course", 0) or 0)
        _ucourse = int(
            AppUser.objects.filter(pk=u.id).values_list("course", flat=True).first() or 0
        )
        if _ecourse and _ucourse and _ecourse != _ucourse:
            return Response(
                {"error": student_api_msg("exam_not_assigned", resolve_ui_language(request))},
                status=403,
            )

    # Start: faculty imtihoni — faqat o'z kafedrasidagi imtihon.
    if role in ("faculty", "ordinator", "magistr", "vacancy", "entrant") and exam.audience == role:
        exam_kaf = getattr(exam, "kafedra_id", None)
        user_kaf = getattr(u, "kafedra_id", None)
        if user_kaf is None:
            user_kaf = AppUser.objects.filter(pk=u.id).values_list("kafedra_id", flat=True).first()
        if not user_kaf:
            return Response(
                {"error": "O'qituvchi kafedrasi belgilanmagan. Admin bilan bog'laning."},
                status=400,
            )
        if not exam_kaf or int(exam_kaf) != int(user_kaf):
            return Response(
                {"error": student_api_msg("exam_not_assigned", resolve_ui_language(request))},
                status=403,
            )

    # Baholash: bir o'qituvchi faqat bitta fan imtihonini topshiradi.
    if role == "faculty" and exam.exam_mode == "faculty_ai_books":
        other_active = (
            StudentExam.objects.filter(
                student_id=u.id,
                exam__audience="faculty",
                exam__exam_mode="faculty_ai_books",
                status__in=("Completed", "In Progress"),
            )
            .exclude(exam_id=pk)
            .exists()
        )
        if other_active:
            return Response(
                {
                    "error": student_api_msg(
                        "faculty_assessment_one_exam_only", resolve_ui_language(request)
                    ),
                },
                status=403,
            )

    if role == "faculty" and exam.exam_mode == "faculty_ai_books":
        bank_n = len(safe_json_loads(exam.questions_json, []))
        need = max(5, int(exam.bank_question_count or 20) // 2)
        if bank_n < need:
            return Response(
                {
                    "error": student_api_msg(
                        "faculty_questions_not_ready", resolve_ui_language(request)
                    ),
                    "code": "QUESTIONS_NOT_READY",
                },
                status=503,
            )

    if vac_pc_only_enabled():
        pc_err = _reject_non_desktop_or_none(request)
        if pc_err is not None:
            return pc_err

    ex_row = ExamStudentException.objects.filter(exam_id=pk, student_id=u.id).first()
    if ex_row:
        return Response({"error": ex_row.reason, "code": "EXAM_BLOCKED"}, status=403)

    stale = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if stale is not None and (stale.status or "").strip() == "In Progress":
        if auto_finalize_student_exam_if_expired(stale, exam, str(u.id)):
            stale.refresh_from_db()

    now = dj_tz.now()
    in_general = bool(
        exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time
    )
    in_retake = ExamRetakeWindow.objects.filter(
        exam_id=pk, student_id=u.id, window_start__lte=now, window_end__gte=now
    ).exists()
    if not in_general and not in_retake:
        if exam.start_time and now < exam.start_time:
            return Response({"error": student_api_msg("exam_not_started", resolve_ui_language(request))}, status=403)
        return Response({"error": student_api_msg("exam_already_ended", resolve_ui_language(request))}, status=403)

    # Ordinator/magistr: imtihon TO'LOVDAN keyin ochiladi.
    from apps.api.views.ordinator import access_state, is_paid_role

    if is_paid_role(role):
        # Sessiya bu yerda hali ochilmagan - mavjudini alohida o'qiymiz.
        _se_now = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
        _st = access_state(_se_now, exam, role)
        if _st.get("locked"):
            return Response(
                {
                    "error": _st.get("message")
                    or student_api_msg("forbidden", resolve_ui_language(request)),
                    "code": _st.get("code") or "PAYMENT_REQUIRED",
                    "tech_retries_left": _st.get("tech_retries_left"),
                },
                status=403,
            )

    prof = AppUser.objects.filter(pk=u.id).values_list("profile_image", flat=True).first()
    if role not in ("faculty", "ordinator", "magistr") and (not prof or len(str(prof)) < 50):
        return Response(
            {"error": student_api_msg("profile_photo_required", resolve_ui_language(request))},
            status=403,
        )

    vac_device_lock = vac_device_lock_enabled()
    device_fp = _device_fp_from_request(request)
    if vac_device_lock and not device_fp:
        return Response(
            {"error": "Device fingerprint is required", "code": "DEVICE_FINGERPRINT_REQUIRED"},
            status=403,
        )

    pending_se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    resuming = bool(
        pending_se
        and (pending_se.status or "").strip() == "In Progress"
        and pending_se.started_at
    )
    if (
        identity_verify_required()
        and not resuming
        and not _identity_verification_fresh(pending_se, now)
    ):
        return Response(
            {
                "error": student_api_msg("identity_required", resolve_ui_language(request)),
                "code": "IDENTITY_NOT_VERIFIED",
            },
            status=403,
        )

    # ROZILIK MAJBURIY: qoidalar ko'rsatilmagan va tasdiqlanmagan bo'lsa
    # imtihon boshlanmaydi. Bu yuridik talab — chetlatilgan topshiruvchi
    # "meni ogohlantirishmagan" deya olmasligi kerak.
    # Boshlab bo'lingan sessiyani (resume) to'smaymiz: odam imtihon
    # o'rtasida sahifani yangilaganda qulflanib qolmasligi kerak.
    _consent_se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not resuming and not (_consent_se and _consent_se.vac_consent_at):
        return Response(
            {
                "error": student_api_msg("vac_consent_required", resolve_ui_language(request)),
                "code": "VAC_CONSENT_REQUIRED",
            },
            status=403,
        )

    device_token = secrets.token_urlsafe(32)
    with transaction.atomic():
        se = (
            StudentExam.objects.select_for_update()
            .filter(student_id=u.id, exam_id=pk)
            .first()
        )
        if not se:
            session_key = secrets.token_hex(32)
            session_challenge = secrets.token_hex(16)
            se = StudentExam.objects.create(
                student_id=u.id,
                exam_id=pk,
                status="In Progress",
                started_at=dj_tz.now(),
                device_fingerprint=device_fp if vac_device_lock else "",
                device_session_token=device_token if vac_device_lock else "",
                device_bound_at=dj_tz.now() if vac_device_lock else None,
                session_signing_key=session_key,
                session_request_seq=1,
                session_challenge=session_challenge,
            )
        elif se.status in ("Banned", "Completed", "Failed"):
            return Response({"error": student_api_msg("exam_already_status", resolve_ui_language(request), status=se.status)}, status=403)
        elif se.status == "Pending":
            if exam_retakes_exhausted(se, exam):
                return Response(
                    {
                        "error": student_api_msg("retake_exhausted", resolve_ui_language(request)),
                        "code": "RETAKE_EXHAUSTED",
                    },
                    status=403,
                )
            se.status = "In Progress"
            se.started_at = dj_tz.now()
            se.proctor_official_warnings = 0
            se.proctor_last_warning_at = None
            if not se.session_signing_key:
                se.session_signing_key = secrets.token_hex(32)
            if not se.session_request_seq:
                se.session_request_seq = 1
            if not se.session_challenge:
                se.session_challenge = secrets.token_hex(16)
            if vac_device_lock:
                se.device_fingerprint = device_fp or se.device_fingerprint
                se.device_session_token = device_token
                se.device_bound_at = dj_tz.now()
            se.save(
                update_fields=[
                    "status",
                    "started_at",
                    "device_fingerprint",
                    "device_session_token",
                    "device_bound_at",
                    "session_signing_key",
                    "session_request_seq",
                    "session_challenge",
                    "proctor_official_warnings",
                    "proctor_last_warning_at",
                ]
            )
        elif se.status == "In Progress":
            if vac_device_lock:
                mismatch = _enforce_bound_device_or_403(se, request)
                if mismatch is not None:
                    if se.started_at and _try_rebind_device_for_resume(se, request, device_token, device_fp):
                        device_token = se.device_session_token or device_token
                        mismatch = None
                    elif not se.started_at and _student_exam_draft_is_empty(se):
                        se.device_fingerprint = device_fp or ""
                        se.device_session_token = device_token
                        se.device_bound_at = dj_tz.now()
                        se.started_at = now
                        se.proctor_official_warnings = 0
                        se.proctor_last_warning_at = None
                        mismatch = None
                    else:
                        return mismatch
            if not se.session_signing_key:
                se.session_signing_key = secrets.token_hex(32)
            if not se.session_request_seq:
                se.session_request_seq = 1
            if not se.session_challenge:
                se.session_challenge = secrets.token_hex(16)
            if vac_device_lock and not se.device_session_token:
                se.device_session_token = device_token
                if device_fp and not se.device_fingerprint:
                    se.device_fingerprint = device_fp
                    se.device_bound_at = dj_tz.now()
            else:
                device_token = se.device_session_token or device_token
            se.save(
                update_fields=[
                    "session_signing_key",
                    "session_request_seq",
                    "session_challenge",
                    "device_session_token",
                    "device_fingerprint",
                    "device_bound_at",
                    "started_at",
                    "proctor_official_warnings",
                    "proctor_last_warning_at",
                ]
            )

        retake_only = in_retake and not in_general
        if retake_only:
            # Retake oynasi — yangi sessiya sifatida boshlansin (eski ogohlantirishlar qoldig’i o’tmasin).
            se.started_at = now
            se.proctor_official_warnings = 0
            se.proctor_last_warning_at = None
            se.draft_answers_json = "{}"
            se.draft_flagged_json = "[]"
            retake_update_fields = [
                "started_at",
                "proctor_official_warnings",
                "proctor_last_warning_at",
                "draft_answers_json",
                "draft_flagged_json",
            ]
            if exam.exam_mode in (
                "bank_mixed",
                "imentor_mixed",
                "faculty_ai_books",
                "static",
                "",
            ):
                se.session_questions_json = None
                retake_update_fields.append("session_questions_json")
            se.save(update_fields=retake_update_fields)

    full_questions: list[dict]
    student_lang = resolve_student_exam_language(request, exam)
    ex_lang = effective_exam_language(exam, student_lang)
    is_auto_exam = (exam.language or "uz").lower() == "auto"
    group = Group.objects.filter(pk=u.group_id).first() if u.group_id else None
    track = (group.program_track or "bachelor").lower() if group else "bachelor"
    if exam.exam_mode == "bank_mixed":
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
            if is_auto_exam:
                upgraded = fill_missing_exam_translations(full_questions)
                if upgraded is not full_questions:
                    full_questions = upgraded
                    se.session_questions_json = json.dumps(full_questions)
                    se.save(update_fields=["session_questions_json"])
        else:
            n = max(8, exam.bank_question_count or 20)
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
            pool_count = base_qs.count()
            if pool_count < n_bank:
                return Response(
                    {
                        "error": student_api_msg(
                            "bank_pool_insufficient", resolve_ui_language(request)
                        )
                    },
                    status=400,
                )
            picked_rows = list(base_qs.order_by("?")[:n_bank])
            if is_auto_exam:
                picked = [bank_row_to_exam_dict_multilingual(row) for row in picked_rows]
            else:
                picked = [bank_row_to_exam_dict(row, ex_lang) for row in picked_rows]
            if track == "bachelor" and picked:
                n_para = max(1, int(len(picked) * 0.25))
                idxs = list(range(len(picked)))
                shuffle_in_place(idxs)
                para_idxs = sorted(idxs[:n_para])
                # MUHIM: barcha tanlangan savollarni BITTA AI chaqiruvida paraphrase qilamiz.
                # (Avval har savol uchun alohida chaqirilardi — N ta ketma-ket Gemini so'rovi
                #  imtihon startini 10-30s sekinlashtirardi.)
                to_para = [picked[i] for i in para_idxs]
                try:
                    para_results = paraphrase_medical_mcqs(to_para, ex_lang)
                except Exception:
                    para_results = []
                if para_results and len(para_results) == len(to_para):
                    for pos, i in enumerate(para_idxs):
                        picked[i] = para_results[pos]
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
                    extra_pool = list(base_qs.order_by("?")[n_bank : n_bank + n_ai])
                    for row in extra_pool:
                        if is_auto_exam:
                            ai_part.append(bank_row_to_exam_dict_multilingual(row))
                        else:
                            ai_part.append(bank_row_to_exam_dict(row, ex_lang))
            next_id = len(picked) + 1
            ai_with_ids = [{**q, "id": next_id + j} for j, q in enumerate(ai_part)]
            merged = shuffle_in_place(picked + ai_with_ids)
            full_questions = [{**q, "id": idx + 1} for idx, q in enumerate(merged)]
            if is_auto_exam:
                full_questions = fill_missing_exam_translations(full_questions)
            se.session_questions_json = json.dumps(full_questions)
            se.save(update_fields=["session_questions_json"])
    elif exam.exam_mode == "imentor_mixed":
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
            if is_auto_exam:
                upgraded = fill_missing_exam_translations(full_questions)
                if upgraded is not full_questions:
                    full_questions = upgraded
                    se.session_questions_json = json.dumps(full_questions)
                    se.save(update_fields=["session_questions_json"])
        elif safe_json_loads(exam.questions_json, []):
            # Yaratishda oldindan olib kelib 3 tilga tarjima qilingan FIKSIRLANGAN
            # savollar to'plami (barcha talaba uchun bir xil, admin tanlovi bo'yicha
            # — tezlik uchun). Talaba kirganda iMentor'ga qayta murojaat qilinmaydi,
            # AI chaqiruvi ham kerak emas — darhol boshlanadi.
            full_questions = safe_json_loads(exam.questions_json, [])
            if is_auto_exam:
                full_questions = fill_missing_exam_translations(full_questions)
            se.session_questions_json = json.dumps(full_questions)
            se.save(update_fields=["session_questions_json"])
        else:
            # Eski (ushbu o'zgarishdan oldin yaratilgan) imtihonlar — questions_json
            # bo'sh, shu sabab avvalgidek har talaba uchun jonli olib kelinadi.
            from apps.api.imentor_service import fetch_random_imentor_questions, parse_imentor_selection

            selection = parse_imentor_selection(
                safe_json_loads(getattr(exam, "imentor_subject_codes", None) or "[]", [])
            )
            codes = selection.get("subject_codes") or []
            if not isinstance(codes, list) or not codes:
                return Response({"error": "Invalid iMentor exam configuration"}, status=500)
            max_q = int(exam.bank_question_count or 0)
            try:
                picked, _meta = fetch_random_imentor_questions(
                    codes,
                    max_questions=max_q,
                    add_translations=False,
                    source_language=ex_lang if ex_lang in ("uz", "ru", "en") else None,
                    variant_label=selection.get("variant_label") or None,
                    topic_code=selection.get("topic_code") or None,
                )
            except Exception as ex:
                from apps.api.imentor_client import IMentorApiError

                msg = str(ex)
                if isinstance(ex, IMentorApiError):
                    return Response({"error": msg}, status=502 if ex.status and ex.status >= 500 else 400)
                return Response(
                    {"error": student_api_msg("imentor_load_failed", resolve_ui_language(request))},
                    status=502,
                )
            para_lang = ex_lang
            if is_auto_exam and picked:
                from apps.api.gemini_tools import detect_question_language

                sample = " ".join(str(q.get("text") or "") for q in picked[:8])
                para_lang = detect_question_language(sample)
            if track in ("residency", "master") and picked:
                try:
                    picked = paraphrase_medical_mcqs(picked, para_lang)
                except Exception:
                    pass
            elif track == "bachelor" and picked:
                n_para = max(1, int(len(picked) * 0.25))
                idxs = list(range(len(picked)))
                shuffle_in_place(idxs)
                para_idxs = sorted(idxs[:n_para])
                to_para = [picked[i] for i in para_idxs]
                try:
                    para_results = paraphrase_medical_mcqs(to_para, para_lang)
                    if para_results and len(para_results) == len(to_para):
                        for pos, i in enumerate(para_idxs):
                            picked[i] = para_results[pos]
                except Exception:
                    pass
            if is_auto_exam and picked:
                picked = exam_questions_add_translations(picked, None)
            full_questions = [{**q, "id": idx + 1} for idx, q in enumerate(picked)]
            if is_auto_exam:
                full_questions = fill_missing_exam_translations(full_questions)
            se.session_questions_json = json.dumps(full_questions)
            se.save(update_fields=["session_questions_json"])
            # BIR MARTALIK MIGRATSIYA: eski imtihonni "oldindan yuklangan"
            # holatga o'tkazamiz. Aks holda HAR talaba iMentor'ga jonli so'rov
            # + AI paraphrase qilardi — imtihon starti 10-30s cho'zilardi va,
            # eng yomoni, har talabaga BOSHQA savollar tushib, bitta imtihon
            # ichida tenglik buzilardi. Endi birinchi talaba yuklaydi,
            # qolganlari o'sha to'plamni oladi.
            #
            # Poyga xavfsizligi: imtihon qatori qulflanadi va faqat hali ham
            # bo'sh bo'lsa yoziladi (ikki talaba bir vaqtda boshlasa —
            # birinchisining to'plami qoladi).
            try:
                with transaction.atomic():
                    exam_row = (
                        Exam.objects.select_for_update().filter(pk=exam.id).first()
                    )
                    if exam_row and not safe_json_loads(exam_row.questions_json, []):
                        exam_row.questions_json = json.dumps(full_questions)
                        exam_row.save(update_fields=["questions_json"])
            except Exception:
                logger.warning(
                    "imentor savollarini imtihonga saqlab bo'lmadi exam_id=%s",
                    exam.id,
                    exc_info=True,
                )
    elif role == "vacancy":
        # Ishga kiruvchi nomzod: savollar HAR NOMZODGA ALOHIDA, uning
        # ro'yxatdan o'tishda tanlagan FANI bo'yicha o'sha zahoti yaratiladi.
        # Umumiy bank ishlatilmaydi — savollar nomzodlar orasida tarqalmasin.
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
        else:
            from apps.api.faculty_ai_throttle import faculty_ai_generate_slot
            from apps.api.imentor_client import IMentorApiError
            from apps.api.imentor_service import (
                fetch_faculty_ai_mcq_questions,
                fetch_random_imentor_questions,
            )

            db_user = AppUser.objects.select_related("kafedra").filter(pk=u.id).first()
            kafedra = getattr(db_user, "kafedra", None) if db_user else None
            if not kafedra and getattr(exam, "kafedra_id", None):
                kafedra = Kafedra.objects.filter(pk=exam.kafedra_id).first()
            if not kafedra:
                return Response(
                    {"error": "Kafedra belgilanmagan. Administrator bilan bog'laning."},
                    status=400,
                )
            subject = str(getattr(db_user, "vacancy_subject", "") or "").strip()
            subject_code = str(getattr(db_user, "vacancy_subject_code", "") or "").strip()
            if not subject:
                subject = str(getattr(exam, "faculty_subject", None) or "").strip()
            n = max(5, min(30, int(exam.bank_question_count or 20)))
            gen_lang = ex_lang if ex_lang in ("uz", "ru", "en") else "uz"

            from apps.api.views.vacancy import (
                _norm_txt as _vac_norm,
                drop_weak_questions,
                hard_bank_questions,
            )

            # Qayta urinishda BOSHQA savollar tushsin.
            _seen = set()
            for _t in safe_json_loads(getattr(se, "served_question_ids", "") or "[]", []):
                if isinstance(_t, str):
                    _seen.add(_t)

            # Tarkib: yarmi ordinatura DAK bankidan, yarmi AI dan.
            # `ai_question_count` imtihonda saqlanadi (standart: yarmi).
            _ai_n = int(getattr(exam, "ai_question_count", 0) or 0)
            if _ai_n <= 0:
                _ai_n = n // 2
            _ai_n = max(0, min(_ai_n, n - 1))
            _bank_n = max(1, n - _ai_n)

            # 1) ASOSIY MANBA: ordinatura DAK banki — institut tayyorlagan
            #    mutaxassislik savollari (klinik holat + 4-5 chalg'ituvchi).
            picked = hard_bank_questions(kafedra.id, _bank_n, _seen, subject=subject)
            if picked:
                logger.info(
                    "vacancy: DAK bankidan %d savol kafedra=%s", len(picked), kafedra.id
                )

            # 1a) Kafedrada DAK banki bo'lmasa — iMentor savollari asos bo'ladi.
            ai_error = None
            _raw_ai: list = []
            if not picked:
                try:
                    with faculty_ai_generate_slot():
                        _raw_ai, _meta = fetch_faculty_ai_mcq_questions(
                            department_name=kafedra.name,
                            department_code=getattr(kafedra, "code", None) or None,
                            subject=subject or None,
                            count=_bank_n,
                            language=gen_lang,
                        )
                    picked = drop_weak_questions(_raw_ai)
                    if len(_raw_ai) != len(picked):
                        logger.info(
                            "vacancy: sifat filtri %d ta oson savolni chetladi",
                            len(_raw_ai) - len(picked),
                        )
                    if len(picked) < _bank_n and _raw_ai:
                        _have = {str(q.get("text")) for q in picked}
                        for q in _raw_ai:
                            if len(picked) >= _bank_n:
                                break
                            if str(q.get("text")) not in _have:
                                picked.append(q)
                                _have.add(str(q.get("text")))
                except TimeoutError as ex:
                    return Response(
                        {"error": str(ex), "code": "FACULTY_AI_BUSY"}, status=503
                    )
                except (IMentorApiError, Exception) as ex:  # noqa: B014
                    ai_error = ex
                    picked = []
                    logger.warning(
                        "vacancy: AI yaratolmadi subject=%s xato=%s",
                        subject, str(ex)[:200],
                    )

            # 2) AI QISMI: aynan yuqoridagi savollarni namuna qilib olib,
            #    ULARDAN QIYINROQ savollar yoziladi. Har nomzodga boshqacha.
            if picked and _ai_n > 0:
                try:
                    from apps.api.ai_question_gen import generate_harder_similar

                    _harder = generate_harder_similar(
                        picked,
                        _ai_n,
                        language=gen_lang,
                        subject=subject or kafedra.name,
                        avoid_texts={
                            _vac_norm(q.get("text"))[:180] for q in (picked + _raw_ai)
                        },
                    )
                    if _harder:
                        picked = picked + _harder
                        logger.info(
                            "vacancy: %d ta qiyinroq AI savoli qo'shildi", len(_harder)
                        )
                    else:
                        logger.warning("vacancy: AI qiyinroq savol bermadi")
                except Exception:
                    logger.warning("vacancy: qiyinroq generator yiqildi", exc_info=True)

                # AI yetmasa — bankdan/iMentordan to'ldiramiz (imtihon to'xtamasin).
                if len(picked) < n:
                    _have = {str(q.get("text")) for q in picked}
                    _fill = hard_bank_questions(
                        kafedra.id, n - len(picked), _seen | _have, subject=subject
                    ) or [q for q in _raw_ai if str(q.get("text")) not in _have]
                    for q in _fill:
                        if len(picked) >= n:
                            break
                        if str(q.get("text")) not in _have:
                            picked.append(q)
                            _have.add(str(q.get("text")))

            import random as _vac_rnd

            _vac_rnd.shuffle(picked)

            # 2) ZAXIRA: AI ishlamasa — fanning tayyor sillabus testlaridan.
            if len(picked) < 5 and subject_code:
                try:
                    picked, _m = fetch_random_imentor_questions(
                        [subject_code],
                        max_questions=n,
                        add_translations=False,
                    )
                except Exception:
                    logger.warning(
                        "vacancy: fan testlaridan ham olinmadi subject=%s",
                        subject_code,
                        exc_info=True,
                    )

            if len(picked) < 5:
                return Response(
                    {
                        "error": student_api_msg(
                            "imentor_load_failed", resolve_ui_language(request)
                        ),
                        "code": "VACANCY_QUESTIONS_UNAVAILABLE",
                    },
                    status=502,
                )
            picked = picked[:n]
            if os.environ.get("VACANCY_PARAPHRASE", "1") != "0" and gen_lang == "uz":
                from apps.api.ai_question_gen import paraphrase_bank_part_safe

                picked = paraphrase_bank_part_safe(
                    exam.id, picked, language="uz", subject=subject or kafedra.name,
                )
            if is_auto_exam:
                picked = exam_questions_add_translations(picked, None)
            full_questions = [{**q, "id": idx + 1} for idx, q in enumerate(picked)]
            if is_auto_exam:
                full_questions = fill_missing_exam_translations(full_questions)
            # Nomzodning shaxsiy to'plami sessiyaga saqlanadi.
            se.session_questions_json = json.dumps(full_questions)
            # Qayta urinishda boshqa savollar tushishi uchun berilganlarini
            # matn bo'yicha eslab qolamiz (bank savollarida id barqaror emas).
            from apps.api.views.vacancy import _norm_txt as _nt

            _served = list(_seen) + [
                _nt(q.get("text"))[:120] for q in full_questions if q.get("text")
            ]
            se.served_question_ids = json.dumps(
                sorted(set(x for x in _served if x))[:2000]
            )
            se.save(update_fields=["session_questions_json", "served_question_ids"])

    elif exam.exam_mode == "faculty_ai_books":
        # 100+ parallel start: har kishiga alohida OpenAI = qotish.
        # Bitta imtihon = bitta savollar to'plami (exam.questions_json),
        # har ishtirokchiga shuffle (session_questions_json).
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
            if is_auto_exam:
                upgraded = fill_missing_exam_translations(full_questions)
                if upgraded is not full_questions:
                    full_questions = upgraded
                    se.session_questions_json = json.dumps(full_questions)
                    se.save(update_fields=["session_questions_json"])
        else:
            bank = safe_json_loads(exam.questions_json, [])
            if not bank:
                from apps.api.faculty_ai_throttle import faculty_ai_generate_slot
                from apps.api.imentor_client import IMentorApiError
                from apps.api.imentor_service import fetch_faculty_ai_mcq_questions

                kafedra = None
                if getattr(exam, "kafedra_id", None):
                    kafedra = Kafedra.objects.filter(pk=exam.kafedra_id).first()
                if not kafedra:
                    db_user = (
                        AppUser.objects.select_related("kafedra").filter(pk=u.id).first()
                    )
                    kafedra = getattr(db_user, "kafedra", None) if db_user else None
                if not kafedra:
                    return Response(
                        {
                            "error": "O'qituvchi kafedrasi belgilanmagan. Admin bilan bog'laning.",
                        },
                        status=400,
                    )
                n = max(5, min(30, int(exam.bank_question_count or 20)))
                subject = str(getattr(exam, "faculty_subject", None) or "").strip()
                try:
                    with faculty_ai_generate_slot():
                        # Double-check under slot — boshqa worker allaqachon yozgan bo'lishi mumkin
                        exam.refresh_from_db(fields=["questions_json"])
                        bank = safe_json_loads(exam.questions_json, [])
                        if not bank:
                            picked, _meta = fetch_faculty_ai_mcq_questions(
                                department_name=kafedra.name,
                                department_code=getattr(kafedra, "code", None) or None,
                                subject=subject or None,
                                count=n,
                                language=ex_lang if ex_lang in ("uz", "ru", "en") else "uz",
                            )
                            if is_auto_exam and picked:
                                picked = exam_questions_add_translations(picked, None)
                            bank = [{**q, "id": idx + 1} for idx, q in enumerate(picked)]
                            if is_auto_exam:
                                bank = fill_missing_exam_translations(bank)
                            with transaction.atomic():
                                exam_row = (
                                    Exam.objects.select_for_update()
                                    .filter(pk=exam.id)
                                    .first()
                                )
                                if exam_row and not safe_json_loads(exam_row.questions_json, []):
                                    exam_row.questions_json = json.dumps(bank)
                                    exam_row.save(update_fields=["questions_json"])
                                elif exam_row:
                                    bank = safe_json_loads(exam_row.questions_json, []) or bank
                except TimeoutError as ex:
                    return Response({"error": str(ex), "code": "FACULTY_AI_BUSY"}, status=503)
                except IMentorApiError as ex:
                    return Response(
                        {"error": str(ex)},
                        status=502 if (ex.status and ex.status >= 500) else 400,
                    )
                except Exception:
                    logger.exception("faculty_ai_books generate failed exam_id=%s", exam.id)
                    return Response(
                        {"error": student_api_msg("imentor_load_failed", resolve_ui_language(request))},
                        status=502,
                    )
            if not bank:
                return Response(
                    {"error": student_api_msg("imentor_load_failed", resolve_ui_language(request))},
                    status=502,
                )
            # Bank kerakligidan katta bo'lsa — har ishtirokchiga TASODIFIY
            # qism beriladi. Ilgari butun bank berilardi, ya'ni hamma bir xil
            # savollarni olardi va birinchi topshirgan keyingilariga aytib
            # berishi mumkin edi. Tanlangan qism session_questions_json ga
            # saqlanadi — uzilib qayta kirilsa ham o'sha savollar qoladi.
            import random as _rnd

            _need = max(1, int(exam.bank_question_count or 20))
            # Ishtirokchi rus/ingliz tilini tanlagan bo'lsa, tarjimasi BOR
            # savollardan tanlaymiz. Aks holda tilni almashtirsa ham o'zbekcha
            # matn chiqib qolardi (bank kengaytirilganda ko'p savol faqat
            # o'zbek tilida yaratilgan edi).
            _lang = str(student_lang or '').lower().strip()[:2]
            _pool = bank
            if _lang in ('ru', 'en'):
                _tr = [q for q in bank
                       if str(q.get('text_ru') or '').strip()
                       and str(q.get('text_en') or '').strip()]
                if len(_tr) >= _need:
                    _pool = _tr
            if is_paid_role(role):
                # Har urinishda BOSHQA savollar: avval berilganlari chetlanadi.
                from apps.api.views.ordinator import pick_unseen

                full_questions = pick_unseen(_pool, se, _need)
            else:
                full_questions = (
                    _rnd.sample(_pool, _need) if len(_pool) > _need else list(_pool)
                )
            if is_paid_role(role):
                # DIQQAT: renumber qilishdan OLDIN eslab qolamiz. Aks holda
                # har urinishda 1..20 yozilib, "takrorlanmasin" qoidasi
                # ishlamay qolardi.
                from apps.api.views.ordinator import remember_served

                remember_served(se, full_questions)
            # Tarqalgan bankni yodlash foyda bermasin: har topshiruvchiga savollar boshqa
            # so'zlar bilan (keshdagi tekshirilgan variant yoki yangi qayta yozilgan).
            if (
                os.environ.get("FACULTY_PARAPHRASE", "1") != "0"
                and _lang in ("", "uz")
                and str(exam.language or "uz").lower() in ("uz", "auto")
            ):
                from apps.api.ai_question_gen import paraphrase_bank_part_safe

                full_questions = paraphrase_bank_part_safe(
                    exam.id, full_questions, language="uz",
                    subject=str(getattr(exam, "faculty_subject", "") or ""),
                )
            # O'qituvchi baholashida bank bitta va hammaga ma'lum (57 sessiyada 0 ta yangi
            # savol, o'rtacha 3-6 daqiqa, 93-100% o'tish). Endi har topshiruvchiga bank
            # mavzularidan YANGI, qiyinroq klinik savollar yaratiladi (ordinatordagi kabi).
            try:
                _fac_ai = int(getattr(exam, "ai_question_count", 0) or 0) or int(
                    os.environ.get("FACULTY_AI_COUNT", "10")
                )
            except ValueError:
                _fac_ai = 10
            _fac_ai = max(0, min(_fac_ai, len(full_questions) - 1))
            if _fac_ai > 0:
                try:
                    from apps.api.ai_question_gen import (
                        _norm as _fnorm,
                        generate_harder_similar,
                        verify_many,
                    )

                    _fsub = str(getattr(exam, "faculty_subject", "") or "") or str(
                        getattr(getattr(exam, "kafedra", None), "name", "") or ""
                    )
                    _fdiff = os.environ.get("FACULTY_AI_DIFFICULTY", "clinical")
                    _flang = _lang if _lang in ("ru", "en") else "uz"
                    _fgen = generate_harder_similar(
                        _rnd.sample(_pool, min(len(_pool), 30)),
                        _fac_ai,
                        language=_flang,
                        difficulty=_fdiff,
                        subject=_fsub,
                        avoid_texts={_fnorm(q.get("text"))[:180] for q in _pool},
                    )
                    if _fgen and os.environ.get("FACULTY_AI_VERIFY", "1") != "0":
                        _fok = verify_many(_fgen, subject=_fsub)
                        _fgen = [g for g, o in zip(_fgen, _fok) if o]
                    if _fgen:
                        full_questions = full_questions[: len(full_questions) - len(_fgen)] + [
                            {
                                "text": g["text"],
                                "options": list(g["options"]),
                                "correctAnswer": g["correctAnswer"],
                                "source": "ai_generated",
                            }
                            for g in _fgen
                        ]
                        _rnd.shuffle(full_questions)
                    logger.info("faculty AI savollar exam=%s yaratildi=%d", exam.id, len(_fgen))
                except Exception:
                    logger.exception("faculty AI savol yaratish yiqildi exam=%s", exam.id)
            for _i, _q in enumerate(full_questions):
                _q["id"] = _i + 1
            se.session_questions_json = json.dumps(full_questions)
            se.save(update_fields=["session_questions_json"])
    else:
        # "static" — savollarni ADMIN yuklaydi. Ordinator/magistr imtihonlari
        # aynan shu yo'l bilan ishlaydi: bank katta, `bank_question_count`
        # esa har bir ishtirokchiga nechta savol tushishini belgilaydi.
        # Tanlangan qism sessiyaga yoziladi — uzilib qayta kirsa o'sha
        # savollar qoladi; yangi urinishda esa sessiya tozalanib, boshqa
        # savollar tushadi (`reset_fields_for_exam_retake`).
        if se.session_questions_json:
            full_questions = safe_json_loads(se.session_questions_json, [])
            if is_auto_exam:
                upgraded = fill_missing_exam_translations(full_questions)
                if upgraded is not full_questions:
                    full_questions = upgraded
                    se.session_questions_json = json.dumps(full_questions)
                    se.save(update_fields=["session_questions_json"])
        else:
            full_questions = safe_json_loads(exam.questions_json, [])
            if is_auto_exam:
                full_questions = fill_missing_exam_translations(full_questions)
            # Ko'p fanli tarkib: har fandan belgilangan miqdorda savol.
            # Maxsus kirish imtihonida masalan 3 fandan 10 tadan.
            _plan = safe_json_loads(getattr(exam, "question_plan", "") or "[]", [])
            if isinstance(_plan, list) and _plan:
                full_questions = _compose_from_plan(
                    _plan, se, is_paid_role(role),
                    ai_total=int(getattr(exam, "ai_question_count", 0) or 0),
                    language=(exam.language or "uz"),
                )

            _need_st = int(exam.bank_question_count or 0)
            # Savollarning bir qismini AI yaratadi: bank talabalar orasida
            # tarqalgan bo'lishi mumkin, shuning uchun har bir topshiruvchi
            # uchun yangi savollar qo'shiladi.
            _ai_n = int(getattr(exam, "ai_question_count", 0) or 0)
            _ai_n = max(0, min(_ai_n, max(0, _need_st - 1)))
            _bank_n = max(0, _need_st - _ai_n)

            if isinstance(_plan, list) and _plan:
                # Tarkib rejadan yig'ildi. AI ulushi `_compose_from_plan`
                # ichida HAR BIR FAN bo'yicha taqsimlangan — bu yerda
                # qo'shimcha almashtirish qilinmaydi, aks holda fanlar
                # nisbati yana buzilardi (10/10/10 -> 7/8/3 bo'lib qolgandi).
                for _i, _q in enumerate(full_questions):
                    _q["id"] = _i + 1
                se.session_questions_json = json.dumps(full_questions, ensure_ascii=False)
                se.save(update_fields=["session_questions_json"])
            elif _need_st > 0 and (len(full_questions) > _bank_n or _ai_n):
                import random as _rnd_st

                for _q in full_questions:
                    if not _q.get("source_id"):
                        _q["source_id"] = _q.get("id")
                _pool_st = list(full_questions)
                if is_paid_role(role):
                    from apps.api.views.ordinator import pick_unseen, remember_served

                    picked_st = pick_unseen(_pool_st, se, _bank_n)
                    remember_served(se, picked_st)
                elif len(_pool_st) > _bank_n:
                    picked_st = _rnd_st.sample(_pool_st, _bank_n)
                else:
                    picked_st = list(_pool_st)

                # --- AI qismi ---
                if _ai_n > 0:
                    from apps.api.ai_question_gen import (
                        _norm as _ai_norm,
                        generate_harder_similar,
                    )

                    # AI bankdagi savolni qaytadan yozib bermasin.
                    _avoid = {_ai_norm(q.get("text"))[:180] for q in _pool_st}
                    # Namuna — butun bank MAVZULARIDAN (faqat tushgan savollardan
                    # emas): yangi savollar bankdagi mavzular kesimida, ulardan
                    # biroz qiyinroq bo'ladi. Savollar tarqatilib yodlab olinsa
                    # ham, har topshiruvchiga baribir yangi savollar tushadi.
                    import time as _time_ai
                    from concurrent.futures import ThreadPoolExecutor as _TPE

                    from apps.api.ai_question_gen import paraphrase_questions, verify_many

                    _others = [q for q in _pool_st if q not in picked_st]
                    _samples = list(picked_st) + _rnd_st.sample(_others, min(len(_others), 30))
                    _bank_lang = exam.language if exam.language in ("uz", "ru", "en") else "uz"
                    _gen_lang = (
                        exam.language
                        if exam.language in ("uz", "ru", "en")
                        else (student_lang if student_lang in ("uz", "ru", "en") else "uz")
                    )
                    _subject = str(getattr(exam, "faculty_subject", "") or "")
                    _diff = os.environ.get("ORDINATOR_AI_DIFFICULTY", "clinical")
                    _verify_on = os.environ.get("ORDINATOR_AI_VERIFY", "1") != "0"
                    _para_on = (
                        os.environ.get("ORDINATOR_PARAPHRASE_BANK", "1") != "0"
                        and _gen_lang == _bank_lang
                    )
                    _t0_ai = _time_ai.monotonic()

                    def _gen_more(_n, _have):
                        try:
                            return generate_harder_similar(
                                _samples or _pool_st,
                                _n,
                                language=_gen_lang,
                                difficulty=_diff,
                                subject=_subject,
                                avoid_texts=_avoid | {_ai_norm(g.get("text"))[:180] for g in _have},
                            )
                        except Exception:
                            logger.exception("ordinator AI savol yaratish yiqildi exam=%s", exam.id)
                            return []

                    # 1) 15 ta YANGI savol yaratish va 10 ta bank savolini boshqa so'zlar
                    #    bilan qayta yozish — PARALLEL (talaba kamroq kutadi). Qayta
                    #    yozilgan bank savolini yodlangan ro'yxatdan tanib bo'lmaydi.
                    #    TOKEN TEJASH: bank savolining yetarlicha TEKSHIRILGAN qayta
                    #    yozilgan varianti keshda bo'lsa — o'shalardan biri olinadi
                    #    (AI so'rovi ham, qayta tekshiruv ham yo'q).
                    from apps.api.ai_question_gen import cached_paraphrase, remember_paraphrases

                    _para_cached = {}
                    _para_idx = []
                    if _para_on:
                        for _ix_p, _q_p in enumerate(picked_st):
                            _cv = cached_paraphrase(exam.id, _gen_lang, _q_p)
                            if _cv:
                                _para_cached[_ix_p] = _cv
                            else:
                                _para_idx.append(_ix_p)
                    with _TPE(max_workers=2) as _ex_ai:
                        _f_gen = _ex_ai.submit(_gen_more, _ai_n, [])
                        _f_par = (
                            _ex_ai.submit(paraphrase_questions, [picked_st[_ix_p] for _ix_p in _para_idx],
                                          language=_gen_lang, subject=_subject)
                            if _para_on and _para_idx else None
                        )
                        _gen = list(_f_gen.result() or [])
                        try:
                            _para = list((_f_par.result() if _f_par else None) or [])
                        except Exception:
                            logger.exception("bank savollarini qayta yozish yiqildi exam=%s", exam.id)
                            _para = []
                    _cands = [(_para_idx[i], pq) for i, pq in enumerate(_para) if pq and i < len(_para_idx)]

                    # 2) Talabaga berishdan OLDIN har bir savol mustaqil tekshiriladi:
                    #    kaliti noto'g'ri, bema'ni variantli, sayoz yoki mavzudan
                    #    tashqari savol chiqarib tashlanadi (hammasi parallel).
                    if _verify_on and (_gen or _cands):
                        _ng = len(_gen)
                        _oks = verify_many(_gen + [pq for _, pq in _cands], subject=_subject)
                        _gen = [g for g, k in zip(_gen, _oks[:_ng]) if k]
                        _cands = [c for c, k in zip(_cands, _oks[_ng:]) if k]
                        if _cands:
                            remember_paraphrases(exam.id, _gen_lang, [(picked_st[_i_c], _pq_c) for _i_c, _pq_c in _cands])
                    if _para_cached:
                        _cands += list(_para_cached.items())
                        logger.info("[AI-START] exam=%s keshdan_qayta_yozilgan=%d", exam.id, len(_para_cached))
                    # 3) Yetmay qolsa — vaqt bo'lsa yangisi yaratiladi va yana tekshiriladi.
                    for _round in range(2):
                        if len(_gen) >= _ai_n or _time_ai.monotonic() - _t0_ai > 150:
                            break
                        _more = _gen_more(_ai_n - len(_gen) + 2, _gen)
                        if _verify_on and _more:
                            _mok = verify_many(_more, subject=_subject)
                            _more = [g for g, k in zip(_more, _mok) if k]
                        _gen += _more
                    _gen = _gen[:_ai_n]
                    # Qayta yozilgan (va tekshiruvdan o'tgan) bank savollari qo'yiladi;
                    # qolganlari asl holicha. source_id saqlanadi (takrorlanmaslik va tahlil).
                    if _cands:
                        _np = list(picked_st)
                        for _i_p, _pq in _cands:
                            _np[_i_p] = {
                                **picked_st[_i_p],
                                "text": _pq["text"],
                                "options": _pq["options"],
                                "correctAnswer": _pq["correctAnswer"],
                                "paraphrased": True,
                            }
                        picked_st = _np
                    if _gen and _gen_lang == _bank_lang:
                        # Tekshiruvdan o'tgan yangi savollar bankka ham qo'shiladi (fonda).
                        try:
                            from apps.api.tasks import bank_ai_questions

                            bank_ai_questions.delay(
                                exam.id,
                                [
                                    {
                                        "text": g.get("text"),
                                        "options": list(g.get("options") or []),
                                        "correctAnswer": g.get("correctAnswer"),
                                    }
                                    for g in _gen
                                ],
                                _verify_on,
                            )
                        except Exception:
                            logger.exception("AI savollarni bankka yuborib bo'lmadi exam=%s", exam.id)
                    logger.info(
                        "[AI-START] exam=%s yangi=%d qayta_yozilgan_bank=%d vaqt=%.0fs",
                        exam.id, len(_gen), len(_cands), _time_ai.monotonic() - _t0_ai,
                    )
                    if _gen:
                        picked_st = picked_st + _gen
                        _rnd_st.shuffle(picked_st)
                    # AI yetarli bermasa — bankdan to'ldiramiz, imtihon
                    # hech qachon kam savol bilan boshlanmasin.
                    _short = _need_st - len(picked_st)
                    if _short > 0:
                        _used = {q.get("text") for q in picked_st}
                        _rest = [q for q in _pool_st if q.get("text") not in _used]
                        if _rest:
                            _extra = _rnd_st.sample(_rest, min(_short, len(_rest)))
                            if is_paid_role(role):
                                remember_served(se, _extra)
                            picked_st += _extra
                            _rnd_st.shuffle(picked_st)
                        logger.warning(
                            "ordinator: AI %d ta yetmadi, bankdan to'ldirildi exam=%s",
                            _short, exam.id,
                        )

                for _i, _q in enumerate(picked_st):
                    _q["id"] = _i + 1
                full_questions = picked_st
                se.session_questions_json = json.dumps(full_questions, ensure_ascii=False)
                se.save(update_fields=["session_questions_json"])

    full_questions = apply_exam_language_to_questions(
        full_questions, exam.language or "uz", student_lang
    )
    shuffled = build_student_question_list(full_questions)

    # Savollar tayyor — vaqt hisobi ANA ENDI boshlanadi. Bank tanlash va AI
    # savol yaratish sekin bo'lishi mumkin; u vaqt topshiruvchining hisobidan
    # ketmasligi kerak. Resume (qayta ochish) holatida tegilmaydi.
    if not resuming:
        se.started_at = dj_tz.now()
        se.save(update_fields=["started_at"])

    deadline = submission_deadline(exam, se, student_id=str(u.id))
    from apps.api.proctor_profile import screen_share_required, secure_text_enabled
    from apps.api.question_lock import start_state as _qlock_start, webcam_snapshots_enabled

    # Savolga vaqt va orqaga qaytmaslik — faqat buni qo'llaydigan ilova so'rasa.
    _feats = (request.data or {}).get("client_features")
    _feats = [str(x) for x in _feats] if isinstance(_feats, list) else []
    _qlock = _qlock_start(se, exam, len(full_questions), _feats, resuming)

    exam_out = {
        "id": exam.id,
        "teacher_id": exam.teacher_id,
        "title": exam.title,
        "start_time": exam.start_time.isoformat() if exam.start_time else None,
        "end_time": exam.end_time.isoformat() if exam.end_time else None,
        "duration_minutes": exam.duration_minutes,
        "language": ex_lang,
        "language_mode": exam.language,
        "custom_rules": exam.custom_rules,
        # Tashqi shovqin nazorati shu imtihonda yoqilganmi (talaba tomonida
        # faqat SUSPICIOUS_AUDIO ga ta'sir qiladi; gapirish har doim ishlaydi).
        "ambient_audio_enabled": bool(getattr(exam, "ambient_audio_enabled", True)),
        "exam_mode": exam.exam_mode,
        "questions": shuffled,
        # Savol matni <canvas> ga chiziladi (DOM'ni o'qiydigan kengaytmalardan himoya).
        "secure_text": secure_text_enabled(exam, str(u.id)),
        # Butun ekranni ulashish talab qilinadimi (imtihon oynasi nazorat qiladi).
        "screen_share": screen_share_required(exam, str(u.id)),
        # Har bir savolga vaqt, orqaga qaytmaslik (None — rejim yo'q).
        "question_lock": _qlock,
        # Imtihon davomida kamera kadri (dalil) saqlanadimi.
        "webcam_snapshots": webcam_snapshots_enabled(),
        "submission_deadline": deadline.isoformat() if deadline else None,
    }
    return Response(
        {
            "exam": exam_out,
            "studentExamId": se.id,
            "startedAt": se.started_at.isoformat() if se.started_at else None,
            "sessionKey": se.session_signing_key,
            "sessionSeqStart": int(se.session_request_seq or 1),
            "sessionChallenge": se.session_challenge,
            "deviceToken": device_token if vac_device_lock else None,
            "resumed": resuming,
        }
    )
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_exams_submit(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    answers = (request.data or {}).get("answers")
    flagged = (request.data or {}).get("flaggedQuestions")
    if not isinstance(answers, dict):
        return Response({"error": student_api_msg("invalid_answers", resolve_ui_language(request))}, status=400)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)

    pc_err = _reject_non_desktop_or_none(request)
    if pc_err is not None:
        return pc_err

    with transaction.atomic():
        se = (
            StudentExam.objects.select_for_update()
            .filter(student_id=u.id, exam_id=pk)
            .select_related("exam")
            .first()
        )
        if not se or se.status != "In Progress":
            return Response({"error": student_api_msg("cannot_submit", resolve_ui_language(request))}, status=403)
        mismatch = _enforce_bound_device_or_403(se, request)
        if mismatch is not None:
            return mismatch
        sig_err = _verify_exam_hmac_or_403(se, request)
        if sig_err is not None:
            return sig_err
        exam = se.exam
        now_submit = dj_tz.now()
        # Muddat tugagan zahoti 403 qaytarilardi. Oxirgi savolni belgilab
        # "Yakunlash" bosgan o'qituvchining so'rovi bir necha soniya kechiksa
        # (sekin internet, oxirgi save-progress) butun ishi yo'qolardi. Taymer
        # va imtihon davomiyligi o'zgarmaydi — faqat yo'lda kechikkan yakunlash
        # so'rovi qabul qilinadi.
        try:
            _grace_s = max(0, int(os.getenv("EXAM_SUBMIT_GRACE_SECONDS", "120")))
        except (TypeError, ValueError):
            _grace_s = 120
        grace = timedelta(seconds=_grace_s)
        deadline = submission_deadline(exam, se, student_id=str(u.id))
        within_grace = bool(deadline and now_submit <= deadline + grace)
        if not within_grace and not student_in_exam_access_window(exam, str(u.id), now_submit):
            return Response(
                {"error": student_api_msg("exam_time_expired", resolve_ui_language(request))},
                status=403,
            )
        if deadline and now_submit > deadline + grace:
            return Response(
                {"error": student_api_msg("exam_time_expired", resolve_ui_language(request))},
                status=403,
            )
        min_sec = exam_min_submit_seconds()
        if min_sec > 0 and se.started_at:
            elapsed = (now_submit - se.started_at).total_seconds()
            if elapsed < min_sec:
                return Response(
                    {
                        "error": student_api_msg(
                            "submit_min_wait", resolve_ui_language(request), n=min_sec
                        ),
                        "code": "SUBMIT_TOO_EARLY",
                    },
                    status=403,
                )
        if identity_verify_required() and not _identity_verification_fresh(se, now_submit):
            return Response(
                {
                    "error": student_api_msg("identity_verify_expired", resolve_ui_language(request)),
                    "code": "IDENTITY_VERIFY_EXPIRED",
                },
                status=403,
            )
        if se.session_questions_json:
            questions = safe_json_loads(se.session_questions_json, [])
        else:
            questions = safe_json_loads(exam.questions_json, [])
        student_lang = resolve_student_exam_language(request, exam)
        from apps.api.question_lock import final_answers as _qlock_final, load_lock as _qlock_load

        _lk = _qlock_load(se)
        if _lk:
            # Savolga vaqt rejimi: brauzer nima yuborsa ham, faqat o'z vaqtida qulflangan javoblar.
            answers = _qlock_final(_lk, questions, {str(k): v for k, v in answers.items()}, now_submit)
        questions = prepare_questions_for_grading(questions, exam, answers, student_lang=student_lang)
        # Bardoshli rejim: mos kelmagan javob javobsiz hisoblanadi, lekin imtihonni
        # yakunlashga to'sqinlik qilmaydi. Ilgari bu yerda 400 qaytarilardi va
        # talaba imtihonni umuman topshira olmay qolardi.
        norm = validate_exam_answers(questions, answers, strict=False)
        score = sum(1 for q in questions if norm.get(str(q["id"])) == q.get("correctAnswer"))
        flagged_json = json.dumps(flagged) if flagged else "[]"
        completed_at = now_submit
        result_public_id = next_result_public_id()
        verify_secret = secrets.token_hex(32)
        total = len(questions)
        percentage = round((score / total) * 100) if total else 0
        from apps.api.certificate_pdf import exam_pass_threshold

        # TEZKOR shablon darhol saqlanadi — haqiqiy AI tushuntirish (OpenAI chaqiruvi,
        # bir necha soniya) endi "Yakunlash" bosilganda emas, talaba natijani birinchi
        # marta ochganda hisoblanadi (`_upgrade_ai_summary_if_needed`, student_results.py).
        # Sabab: submit darhol javob berishi kerak — AI kutish talabani osilib qolgan
        # tugma oldida ushlab turmasin.
        quick_lang = detect_grading_language(exam, norm, student_lang=student_lang, raw_questions=questions)
        ai_summary_json = json.dumps(build_fallback_ai_summary(questions, norm, quick_lang))
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
        from apps.api.answer_timing import clean_timings as _clean_tm

        _tm = _clean_tm((request.data or {}).get("timings"))
        if _tm:
            se.answer_timings_json = json.dumps(_tm)
        se.save()

    completed_iso = completed_at.isoformat()
    icode = integrity_code(result_public_id, completed_iso, score, total, verify_secret)
    base = public_base_url(request)
    verify_url = f"{base}/verify/result/{result_public_id}?k={verify_secret}"
    ai_summary = safe_json_loads(ai_summary_json, {})
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
                "explanationSource": (ai_row or {}).get("explanationSource")
                or ("api" if question_has_api_explanations(q) else (ai_summary.get("source") or "fallback")),
                "references": (ai_row or {}).get("references") or question_references(q),
            }
        )
    from apps.api.result_privacy import review_hidden as _review_hidden

    # Attestatsiya/tanlov imtihonida savollar va to'g'ri javoblar imtihon
    # muddati tugaguncha ko'rsatilmaydi — topshirganlar bankni tarqatmasin.
    _hidden = _review_hidden(exam)
    if _hidden:
        per_q = []
    return _exam_guarded_response(
        request,
        Response(
            {
                "success": True,
                "score": score,
                "total": total,
                "percentage": percentage,
                "pass_threshold": exam_pass_threshold(exam),
                "passed": percentage >= exam_pass_threshold(exam),
                "exam_id": pk,
                "result_public_id": result_public_id,
                "verify_secret": verify_secret,
                "verify_url": verify_url,
                "integrity_code": icode,
                "completed_at": completed_iso,
                "overview": "" if _hidden else ai_summary.get("overview", ""),
                "ai_summary_source": ai_summary.get("source") or "fallback",
                "ai_summary_pending": needs_ai_summary_upgrade(ai_summary),
                "questions": per_q,
                "questions_hidden": _hidden,
                "questions_visible_from": (
                    exam.end_time.isoformat() if (_hidden and exam.end_time) else None
                ),
            }
        ),
    )
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exam_clock(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    pc_err = _reject_non_desktop_or_none(request)
    if pc_err is not None:
        return pc_err
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": student_api_msg("no_active_session", resolve_ui_language(request)), "code": "NO_ACTIVE_SESSION", "sessionStatus": str(getattr(se, "status", "") or ""), "banReason": str(getattr(se, "ban_reason", "") or "")}, status=400)
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se, request)
    if sig_err is not None:
        return sig_err
    deadline = submission_deadline(exam, se, student_id=str(u.id))
    now = dj_tz.now()
    sec = seconds_until_deadline(exam, se, student_id=str(u.id))

    # Liveness watchdog: nazorat kadrlari boshlangan, lekin uzoq vaqt kelmayotgan bo'lsa
    # (kamera o'chirilgan / oqim to'xtatilgan) — client PROCTOR_FEED_LOST loglaydi.
    liveness_gap = max(40, int(os.environ.get("PROCTOR_LIVENESS_MAX_GAP_SECONDS", "75")))
    feed_lost = bool(
        se.proctor_last_frame_at
        and (now - se.proctor_last_frame_at) > timedelta(seconds=liveness_gap)
    )

    return _exam_guarded_response(
        request,
        Response(
            {
                "server_now": now.isoformat(),
                "submission_deadline": deadline.isoformat() if deadline else None,
                "seconds_remaining": sec if sec is not None else 0,
                "proctorFeedLost": feed_lost,
            }
        ),
    )
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_exam_draft(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    if not Exam.objects.filter(pk=pk).exists():
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    pc_err = _reject_non_desktop_or_none(request)
    if pc_err is not None:
        return pc_err
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"answers": {}, "flaggedQuestions": [], "updated_at": None})
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se, request)
    if sig_err is not None:
        return sig_err
    answers = safe_json_loads(se.draft_answers_json, {})
    flagged = safe_json_loads(se.draft_flagged_json, [])
    return _exam_guarded_response(
        request,
        Response(
            {
                "answers": answers,
                "flaggedQuestions": flagged,
                "updated_at": se.draft_updated_at.isoformat() if se.draft_updated_at else None,
            }
        ),
    )
@api_view(["POST"])
@throttle_classes([ExamAutosaveThrottle])
@permission_classes([IsAuthenticated])
def student_exam_save_progress(request, pk: int):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    pc_err = _reject_non_desktop_or_none(request)
    if pc_err is not None:
        return pc_err
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": student_api_msg("no_active_session", resolve_ui_language(request)), "code": "NO_ACTIVE_SESSION", "sessionStatus": str(getattr(se, "status", "") or ""), "banReason": str(getattr(se, "ban_reason", "") or "")}, status=400)
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se, request)
    if sig_err is not None:
        return sig_err
    deadline = submission_deadline(exam, se, student_id=str(u.id))
    if deadline and dj_tz.now() > deadline:
        return Response(
            {"error": student_api_msg("exam_time_expired_short", resolve_ui_language(request))},
            status=403,
        )
    answers = (request.data or {}).get("answers")
    flagged = (request.data or {}).get("flaggedQuestions")
    if not isinstance(answers, dict):
        return Response({"error": student_api_msg("invalid_answers", resolve_ui_language(request))}, status=400)
    if flagged is not None and not isinstance(flagged, list):
        return Response({"error": "Invalid flagged format"}, status=400)
    if se.session_questions_json:
        q_list = safe_json_loads(se.session_questions_json, [])
    else:
        q_list = safe_json_loads(exam.questions_json, [])
    student_lang = resolve_student_exam_language(request, exam)
    q_list = prepare_questions_for_grading(q_list, exam, answers, student_lang=student_lang)
    # Qoralama avtomatik saqlanadi — bitta nomuvofiq javob tufayli butun saqlash
    # yiqilmasin (aks holda talabaning qolgan javoblari ham saqlanmay qolardi).
    norm = validate_exam_answers(q_list, answers, strict=False)
    from apps.api.question_lock import final_answers as _qlock_final, load_lock as _qlock_load

    _lk = _qlock_load(se)
    if _lk:
        # Savolga vaqt rejimi: qulflangan javob o'zgarmaydi, keyingi savollarga javob yozilmaydi.
        norm = _qlock_final(_lk, q_list, norm, dj_tz.now())
    se.draft_answers_json = json.dumps(norm)
    if isinstance(flagged, list):
        se.draft_flagged_json = json.dumps(flagged)
    se.draft_updated_at = dj_tz.now()
    _upd = ["draft_answers_json", "draft_flagged_json", "draft_updated_at"]
    from apps.api.answer_timing import clean_timings

    _tm = clean_timings((request.data or {}).get("timings"))
    if _tm:
        se.answer_timings_json = json.dumps(_tm)
        _upd.append("answer_timings_json")
    se.save(update_fields=_upd)
    return _exam_guarded_response(
        request,
        Response({"ok": True, "saved_at": se.draft_updated_at.isoformat()}),
    )
@api_view(["POST"])
@throttle_classes([ViolationThrottle])
@permission_classes([IsAuthenticated])
def student_violations(request):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
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
    detail = str(d.get("detail") or "").strip()[:1000]
    if screenshot.startswith("note:"):
        # Eski ilova versiyalari faktni rasm o'rnida yuborardi.
        if not detail:
            detail = screenshot[5:1000]
        screenshot = ""

    vac_strict_mode = str(os.environ.get("VAC_STRICT_MODE", "1")).strip() not in ("0", "false", "False")
    # Strict: faqat yuz almashtirish (identity) darhol ban; qolganlari 1-3 rasmiy ogohlantirish + hardening.
    # Masofaviy dastur / keng oyna+touch (false positive) uchun remote/devtools/virtual kamera ogohlantirish oqimiga o‘tadi.
    # Darhol to'xtatiladigan turlar. Ilgari bu yerda faqat IDENTITY_SUBSTITUTION
    # turardi va telefon ko'rinishi oddiy ogohlantirish bo'lib qolardi — ya'ni
    # 3 marta telefonga qarab, keyin ham imtihonni davom ettirish mumkin edi.
    # Endi qo'lda tutilgan qurilma/yordamchi vosita — imtihonning tugashi.
    _instant_default = (
        "IDENTITY_SUBSTITUTION,"
        "FORBIDDEN_OBJECT_CELL_PHONE,"
        "FORBIDDEN_OBJECT_LAPTOP,"
        "FORBIDDEN_OBJECT_BOOK,"
        "REMOTE_CONTROL_SUSPECTED,"
        "VIRTUAL_WEBCAM_SUSPECTED"
    )
    # TEXNIK nosozlik — jazolanmaydi, faqat qayd etiladi. Kamera uzilishi
    # yoki mikrofonga ruxsat berilmasligi talabaning niyati emas, qurilma
    # yoki aloqa muammosi. Bularni ogohlantirishga aylantirish aloqasi
    # zaif halol nomzodni imtihondan chiqarib yuborardi.
    _tech_raw = os.environ.get(
        "PROCTOR_TECHNICAL_VIOLATIONS",
        "PROCTOR_FEED_LOST,CAMERA_MIC_ACCESS_FAILED",
    )
    technical_types = {x.strip().upper() for x in _tech_raw.split(",") if x.strip()}
    _instant_raw = os.environ.get("PROCTOR_INSTANT_BAN_VIOLATIONS", _instant_default)
    instant_ban_types = (
        frozenset({x.strip().upper() for x in _instant_raw.split(",") if x.strip()})
        if vac_strict_mode
        else frozenset()
    )
    warn_types = frozenset(
        {
            "TAB_SWITCH_HARD",
            "TAB_SWITCH_SOFT",
            "FULLSCREEN_EXIT_HARD",
            "SUSPICIOUS_AUDIO",
            "WHISPER_OR_CONVERSATION_SUSPECTED",
            "CAMERA_MIC_ACCESS_FAILED",
            # Mikrofon ATAYLAB o'chirilgan (imtihon oldida ishlashi
            # tasdiqlangan edi) — texnik nosozlik emas, jazolanadi.
            "MICROPHONE_MUTED",
            "VIRTUAL_WEBCAM_SUSPECTED",
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
            "DEVTOOLS_OPEN",
            "REMOTE_CONTROL_SUSPECTED",
            "MULTI_MONITOR_DETECTED",
            # Real-time brauzer proctoring (MediaPipe) signallari
            "FACE_TURNED_AWAY",
            "EXCESSIVE_MOVEMENT",
            "HAND_GESTURE_SUSPECTED",
            "MOUTH_MOVEMENT_TALKING",
            # Yuz pozitsiyasi (masofа va markaz)
            "FACE_TOO_FAR",
            "FACE_TOO_CLOSE",
            "FACE_OFF_CENTER",
            # Liveness watchdog (server kadr kelmasligini aniqlaganda)
            "PROCTOR_FEED_LOST",
            # Brauzer kengaytmasi / begona kod — faqat qayd (review_only_types)
            "BROWSER_EXTENSION_SUSPECTED",
            # Butun ekranni ulashishni to'xtatish (screen_share yoqilgan imtihonda)
            "SCREEN_SHARE_STOPPED",
            # FerMI Exam ilovasi: imtihon paytida taqiqlangan dastur ochildi
            "DESKTOP_FORBIDDEN_APP",
            # Imtihon davomida jami uzoq pastga qarash (telefon tizzada)
            "GAZE_DOWN_TOTAL",
            # FerMI Exam ilovasi: simsiz (Bluetooth) quloqchin ulangan
            "BLUETOOTH_AUDIO_DEVICE",
            # Qo'l uzoq vaqt quloq yonida (telefon / quloqchin)
            "HAND_NEAR_EAR",
            # Imtihon davomida jami uzoq chetga (yon) qarash — yonidagi kishi/qog'oz
            "GAZE_SIDE_TOTAL",
        }
    )
    if vtype not in instant_ban_types and vtype not in warn_types:
        return Response({"error": "Unknown or disallowed violation_type"}, status=400)

    try:
        exam_id_int = int(exam_id)
    except (TypeError, ValueError):
        return Response({"error": "Invalid exam_id"}, status=400)
    exam_row = (
        Exam.objects.filter(pk=exam_id_int)
        .only("id", "ambient_audio_enabled", "audience")
        .first()
    )
    if exam_row is None:
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)

    # Yumshatilgan profil (maxsus kiruvchilar): qo'l harakati va shovqin
    # jazolanmaydi, "kitob" darhol to'xtatmaydi, chegara 3 ta. Qoidalar
    # matni ham shu profildan o'qiladi — `apps.api.proctor_profile`.
    from apps.api.proctor_profile import relaxed_profile

    _relaxed = relaxed_profile(exam_row)
    if _relaxed:
        instant_ban_types = frozenset(
            t for t in instant_ban_types if t not in _relaxed["no_instant"]
        )
    if not _student_assigned_to_exam(u, exam_id_int):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)

    pc_err = _reject_non_desktop_or_none(request)
    if pc_err is not None:
        return pc_err

    se_for_device = StudentExam.objects.filter(student_id=u.id, exam_id=exam_id_int).first()
    if not se_for_device or se_for_device.status != "In Progress":
        return Response({"error": student_api_msg("no_active_session", resolve_ui_language(request)), "code": "NO_ACTIVE_SESSION", "sessionStatus": str(getattr(se_for_device, "status", "") or ""), "banReason": str(getattr(se_for_device, "ban_reason", "") or "")}, status=409)
    mismatch = _enforce_bound_device_or_403(se_for_device, request)
    if mismatch is not None:
        return mismatch
    sig_err = _verify_exam_hmac_or_403(se_for_device, request)
    if sig_err is not None:
        return sig_err

    def _guard(payload, status=200):
        return _exam_guarded_response(request, Response(payload, status=status))

    reason_text = violation_reason_text(vtype, resolve_ui_language(request))

    # «Tashqi shovqin nazorati» imtihon sozlamasida O'CHIRILGAN bo'lsa — atrofdagi
    # ovozga bog'liq turlar umuman yozilmaydi va ogohlantirish bermaydi.
    # SUSPICIOUS_AUDIO — shovqin; WHISPER_OR_CONVERSATION_SUSPECTED — nutq
    # eshitildi, lekin talabaning og'zi qimirlamayapti, ya'ni ovoz BOSHQA
    # odamdan (institut binosida imtihon o'tayotganda tabiiy holat).
    # Talabaning O'ZI gapirishi (MOUTH_MOVEMENT_TALKING) bundan mustasno — u
    # har doim hisobga olinadi.
    AMBIENT_ONLY_TYPES = frozenset({"SUSPICIOUS_AUDIO", "WHISPER_OR_CONVERSATION_SUSPECTED"})
    if vtype in AMBIENT_ONLY_TYPES and not bool(
        getattr(exam_row, "ambient_audio_enabled", True)
    ):
        return _guard(
            {
                "banned": False,
                "warningSuppressed": True,
                "ambientDisabled": True,
                "violationsCount": ViolationLog.objects.filter(
                    student_id=u.id, exam_id=exam_id_int
                ).count(),
                "warningNumber": 0,
                "violationReason": "",
                "isFinalWarning": False,
                "officialWarnings": int(se_for_device.proctor_official_warnings or 0),
            }
        )

    WARN_SUPPRESS_SECONDS = warn_suppress_seconds()
    EVENT_MIN_INTERVAL_SECONDS = max(1, int(os.environ.get("PROCTOR_EVENT_MIN_INTERVAL_SECONDS", "5")))
    # Imtihon startida texnik tebranishlar (kamera/GPU) uchun grace — yozuvsiz.
    STARTUP_GRACE_SECONDS = max(0, int(os.environ.get("PROCTOR_STARTUP_GRACE_SECONDS", "0")))
    MAX_WARNINGS_BEFORE_BAN = max_warnings_before_ban()
    HARDENED_MODE = str(os.environ.get("PROCTOR_HARDENED_MODE", "1")).strip() not in ("0", "false", "False")
    HARDENED_WINDOW_MIN = max(3, int(os.environ.get("PROCTOR_HARD_WINDOW_MIN", "10")))
    HARDENED_MAX_POINTS = max(8, int(os.environ.get("PROCTOR_HARD_MAX_POINTS", "22")))
    if _relaxed:
        MAX_WARNINGS_BEFORE_BAN = max(MAX_WARNINGS_BEFORE_BAN, _relaxed["max_warnings"])
        HARDENED_MAX_POINTS = max(HARDENED_MAX_POINTS, _relaxed["hard_max_points"])
    # Boshida turli turlar ketma-ket tushganda (rolling score) haddan tashqari xavf — vaqtincha o‘chirish.
    HARDENED_STARTUP_GRACE = max(0, int(os.environ.get("PROCTOR_HARDENED_STARTUP_GRACE_SECONDS", "60")))
    GLOBAL_ACCOUNT_BAN = str(os.environ.get("VAC_GLOBAL_ACCOUNT_BAN", "0")).strip().lower() in ("1", "true", "yes")
    AUTO_BAN_NON_IDENTITY = str(os.environ.get("PROCTOR_AUTO_BAN_NON_IDENTITY", "1")).strip().lower() in (
        "1",
        "true",
        "yes",
    )
    AUTO_BAN_IDENTITY = str(os.environ.get("PROCTOR_AUTO_BAN_IDENTITY", "1")).strip().lower() in (
        "1",
        "true",
        "yes",
    )
    HARDENED_COMBO_TYPES = frozenset({
        "MULTIPLE_FACES",
        "WHISPER_OR_CONVERSATION_SUSPECTED",
        "MOUTH_MOVEMENT_TALKING",
    })

    try:
        with transaction.atomic():
            se = (
                StudentExam.objects.select_for_update()
                .filter(student_id=u.id, exam_id=exam_id_int)
                .first()
            )
            if se is None or se.status != "In Progress":
                return _guard({"error": "No active session"}, status=409)

            now = dj_tz.now()
            logs_qs = ViolationLog.objects.filter(student_id=u.id, exam_id=exam_id_int)
            # Oldingi urinish/sessiya yozuvlari yangi urinishga aralashmasin.
            if se.started_at:
                logs_qs = logs_qs.filter(timestamp__gte=se.started_at)
            # Kamera burchagi sabab chiqadigan SOXTA signallar.
            # Stol kompyuterida veb-kamera monitor TEPASIDA turadi, shuning
            # uchun savolni ekrandan o'qiyotgan odam kameraga nisbatan
            # "pastga qaragan" bo'lib ko'rinadi. Ustiga ko'z qisilishi
            # (eyesNarrow) ham "pastga qaradi" deb hisoblanadi — o'qiyotgan
            # odamda ko'z doim qisiladi. Natijada 4 soniya o'qigan kishi
            # qoidabuzar bo'lib, 3 ogohlantirishdan keyin imtihondan
            # chiqarib yuborilardi (2026-09-04 imtihonida shu yuz berdi).
            #
            # Bu turlar endi na yoziladi, na ogohlantirish beradi. Telefon,
            # kitob va noutbukni brauzerdagi obyekt aniqlagichi baribir
            # ushlaydi; yon tomonga qarash (LEFT/RIGHT) ham kuchda qoladi.
            # Ro'yxat qayta yig'ishsiz o'zgaradi: PROCTOR_IGNORED_VIOLATIONS
            _ignored_raw = os.environ.get(
                "PROCTOR_IGNORED_VIOLATIONS",
                "GAZE_AWAY_DOWN,GAZE_AWAY_UP,FACE_TURNED_AWAY,FACE_OFF_CENTER,"
                "FACE_TOO_FAR,FACE_TOO_CLOSE,EXCESSIVE_MOVEMENT",
            )
            _ignored = {x.strip().upper() for x in _ignored_raw.split(",") if x.strip()}
            if _relaxed:
                _ignored |= set(_relaxed["ignored"])
            if vtype in _ignored:
                return _guard(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "startupGrace": True,
                        "violationsCount": logs_qs.count(),
                        "warningNumber": 0,
                        "violationReason": "",
                        "isFinalWarning": False,
                        "officialWarnings": se.proctor_official_warnings,
                    }
                )

            # HOLAT turidagi signallar (ilova har 10 soniyada qayta xabar beradi): bir tur
            # 10 daqiqada BIR MARTA hisoblanadi. Aks holda ikkinchi monitor yoki qayta ishga
            # tushgan dastur oddiy talabani 10-60 soniyada chetlatib yuborardi.
            STATE_TYPES = frozenset({
                "DESKTOP_FORBIDDEN_APP", "MULTI_MONITOR_DETECTED", "GAZE_DOWN_TOTAL", "SCREEN_SHARE_STOPPED",
                "BLUETOOTH_AUDIO_DEVICE", "GAZE_SIDE_TOTAL",
            })
            # Ikkinchi monitor ulangan paytda ilova butunlay to'sib qo'yiladi — ulab o'tirish
            # har 2 daqiqada yangi ogohlantirish (3 tadan keyin ban).
            _state_cooldown_min = {
                "MULTI_MONITOR_DETECTED": 2,
                "BLUETOOTH_AUDIO_DEVICE": 2,
                # Imtihon oldidan hamma dastur yopilgan: qayta ochish tezroq qayta sanaladi.
                "DESKTOP_FORBIDDEN_APP": 3,
            }.get(vtype, 10)
            if vtype in STATE_TYPES and logs_qs.filter(
                violation_type=vtype, timestamp__gte=now - timedelta(minutes=_state_cooldown_min)
            ).exists():
                return _guard(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "stateCooldown": True,
                        "violationsCount": logs_qs.count(),
                        "warningNumber": 0,
                        "violationReason": reason_text,
                        "isFinalWarning": False,
                        "officialWarnings": int(se.proctor_official_warnings or 0),
                    }
                )

            if se.started_at and (now - se.started_at) < timedelta(seconds=STARTUP_GRACE_SECONDS):
                return _guard(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "startupGrace": True,
                        "violationsCount": logs_qs.count(),
                        "warningNumber": 0,
                        "violationReason": f"Startup grace ({STARTUP_GRACE_SECONDS}s): {reason_text}",
                        "isFinalWarning": False,
                        "officialWarnings": se.proctor_official_warnings,
                    }
                )

            # Yuz mosligi CHEGARAVIY (ball chegaradan sal past) — ban emas.
            # Mahalliy embedding bir odamni ham 0.16-0.39 ball bilan "mos emas"
            # deb topadi (yorug'lik, ro'mol, burchak). 11.09 da 25 savolni
            # belgilab bo'lgan ordinator bitta shunday kadr uchun chetlatilgan.
            # Endi: yuz butunlay boshqa (ball < PROCTOR_IDENTITY_BAN_MAX_SCORE)
            # bo'lsagina ban; aks holda qayd etiladi va admin ko'rib chiqadi.
            if vtype == IDENTITY_VIOLATION_TYPE:
                try:
                    _id_score = (
                        float(se.identity_last_score)
                        if se.identity_last_score is not None
                        else None
                    )
                except (TypeError, ValueError):
                    _id_score = None
                try:
                    _id_ban_max = float(os.environ.get("PROCTOR_IDENTITY_BAN_MAX_SCORE", "0.10"))
                except (TypeError, ValueError):
                    _id_ban_max = 0.10
                if _id_score is None or _id_score >= _id_ban_max:
                    if not logs_qs.filter(
                        violation_type=vtype, timestamp__gte=now - timedelta(seconds=60)
                    ).exists():
                        ViolationLog.objects.create(
                            student_id=u.id,
                            exam_id=exam_id_int,
                            violation_type=vtype,
                            timestamp=now,
                            screenshot_url=screenshot,
                            detail=detail,
                            outcome="review",
                        )
                    return _guard(
                        {
                            "banned": False,
                            "warningSuppressed": True,
                            "identityReview": True,
                            "violationsCount": logs_qs.count(),
                            "warningNumber": 0,
                            "violationReason": reason_text,
                            "isFinalWarning": False,
                            "officialWarnings": int(se.proctor_official_warnings or 0),
                        }
                    )

            # Brauzer kengaytmasi / begona kod — JAZO EMAS: qayd (tafsilot bilan) va
            # admin ko'rib chiqadi; talabaga kengaytmani o'chirish so'raladi.
            from apps.api.proctor_profile import review_only_types

            if vtype in review_only_types():
                if not logs_qs.filter(
                    violation_type=vtype, timestamp__gte=now - timedelta(minutes=10)
                ).exists():
                    ViolationLog.objects.create(
                        student_id=u.id,
                        exam_id=exam_id_int,
                        violation_type=vtype,
                        timestamp=now,
                        screenshot_url=screenshot,
                        detail=detail,
                        outcome="review",
                    )
                _ext_msg = {'uz': "Brauzer kengaytmasi yoki sahifaga qo'shilgan begona dastur aniqlandi. Holat qayd etildi va admin tomonidan ko'rib chiqiladi. Iltimos, barcha kengaytmalarni o'chiring.", 'ru': 'Обнаружено расширение браузера или посторонняя программа на странице. Это зафиксировано и будет рассмотрено администратором. Пожалуйста, отключите все расширения.', 'en': 'A browser extension or foreign tool injected into the page was detected. It has been logged for administrator review. Please disable all extensions.'}
                return _guard(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "reviewOnly": True,
                        "violationsCount": logs_qs.count(),
                        "warningNumber": 0,
                        "violationReason": _ext_msg.get(resolve_ui_language(request), _ext_msg["uz"]),
                        "isFinalWarning": False,
                        "officialWarnings": int(se.proctor_official_warnings or 0),
                    }
                )

            # OVOZ gumoni (pichirlash, shubhali tovush) — yolg'iz o'zi JAZO EMAS
            # (admin qarori, 11.09): ovoz yozib olinmaydi, signal taxminiy va
            # keyin isbotlab bo'lmaydi. So'nggi 2 daqiqada kamerada ko'rinadigan
            # dalil bo'lmasa — talabaga ogohlantirish, qayd, admin ko'rib chiqadi;
            # rasmiy ogohlantirish yozilmaydi va imtihon to'xtatilmaydi.
            from apps.api.proctor_profile import (
                AUDIO_CORROBORATING_TYPES,
                AUDIO_CORROBORATION_WINDOW_SECONDS,
                audio_review_types,
            )

            if vtype in audio_review_types():
                _corroborated = logs_qs.filter(
                    violation_type__in=list(AUDIO_CORROBORATING_TYPES),
                    timestamp__gte=now - timedelta(seconds=AUDIO_CORROBORATION_WINDOW_SECONDS),
                ).exists()
                if not _corroborated:
                    if not logs_qs.filter(
                        violation_type=vtype, timestamp__gte=now - timedelta(seconds=30)
                    ).exists():
                        ViolationLog.objects.create(
                            student_id=u.id,
                            exam_id=exam_id_int,
                            violation_type=vtype,
                            timestamp=now,
                            screenshot_url=screenshot,
                            detail=detail,
                            outcome="review",
                        )
                    _audio_msg = {'uz': "Xonada gaplashish yoki pichirlash aniqlandi. Holat qayd etildi va admin tomonidan ko'rib chiqiladi. Iltimos, jim ishlang.", 'ru': 'Обнаружен разговор или шёпот в помещении. Это зафиксировано и будет рассмотрено администратором. Пожалуйста, работайте молча.', 'en': 'Talking or whispering was detected in the room. It has been logged for administrator review. Please work silently.'}
                    return _guard(
                        {
                            "banned": False,
                            "warningSuppressed": True,
                            "audioReview": True,
                            "violationsCount": logs_qs.count(),
                            "warningNumber": 0,
                            "violationReason": _audio_msg.get(
                                resolve_ui_language(request), _audio_msg["uz"]
                            ),
                            "isFinalWarning": False,
                            "officialWarnings": int(se.proctor_official_warnings or 0),
                        }
                    )

            bypass_dedupe = (HARDENED_MODE and vtype in HARDENED_COMBO_TYPES) or vtype in instant_ban_types

            # TASHQI YORDAM belgisi: 30 soniya ichida ovoz (pichirlash/shovqin) va chetga
            # (yon) qarash BIRGA uchrasa — yonida kishi javob aytayotgan bo'lishi mumkin.
            # Bunday hodisa merge oynasida yutilmasin — albatta rasmiy ogohlantirish bo'lsin.
            _COMBO_VOICE = {"WHISPER_OR_CONVERSATION_SUSPECTED", "SUSPICIOUS_AUDIO"}
            _COMBO_SIDE = {"GAZE_AWAY_LEFT", "GAZE_AWAY_RIGHT", "GAZE_SIDE_TOTAL"}
            if (vtype in _COMBO_VOICE or vtype in _COMBO_SIDE) and logs_qs.filter(
                violation_type__in=list(_COMBO_SIDE if vtype in _COMBO_VOICE else _COMBO_VOICE),
                timestamp__gte=now - timedelta(seconds=30),
            ).exists():
                bypass_dedupe = True
                detail = ((detail + " | ") if detail else "") + (
                    "[TASHQI YORDAM] 30 soniya ichida ovoz va chetga qarash birga aniqlandi "
                    "— yonida kishi yordam berayotgan bo'lishi mumkin"
                )

            # Bir xil turdagi signal juda qisqa intervalda takrorlansa, log spam bo'lmasin.
            if not bypass_dedupe:
                if logs_qs.filter(
                    violation_type=vtype,
                    timestamp__gte=now - timedelta(seconds=EVENT_MIN_INTERVAL_SECONDS),
                ).exists():
                    return _guard(
                        {
                            "banned": False,
                            "warningSuppressed": True,
                            "violationsCount": logs_qs.count(),
                            "warningNumber": 0,
                            "violationReason": reason_text,
                            "isFinalWarning": False,
                            "officialWarnings": se.proctor_official_warnings,
                            "mergeWindowSeconds": EVENT_MIN_INTERVAL_SECONDS,
                        }
                    )

            # Rasmiy ogohlantirish merge oynasida bo'lsa, ogohlantirish/ban hisoblagichi oshmaydi —
            # lekin hodisaning o'zi baribir ViolationLog'ga yoziladi (audit to'liq bo'lishi uchun;
            # avval bu holatda yozuv umuman qolmas edi va admin buzilishni ko'ra olmas edi).
            last = se.proctor_last_warning_at
            warning_merge_suppressed = bool(
                not bypass_dedupe
                and last is not None
                and (now - last) < timedelta(seconds=WARN_SUPPRESS_SECONDS)
            )

            _vl = ViolationLog.objects.create(
                student_id=u.id,
                exam_id=exam_id_int,
                violation_type=vtype,
                timestamp=now,
                screenshot_url=screenshot,
                detail=detail,
            )

            def _gv(payload, status=200):
                # Qaydga server qarori yoziladi: admin har bir hodisa nima bilan tugaganini ko'radi.
                try:
                    ViolationLog.objects.filter(pk=_vl.pk).update(outcome=_violation_outcome(payload))
                except Exception:  # noqa: BLE001
                    pass
                return _guard(payload, status=status)

            # Shubhali kadr — AI (vision) fonda ko'rib chiqadi, xulosa qaydga fakt sifatida yoziladi.
            if screenshot.startswith("data:image") and vtype in AI_REVIEW_TYPES:
                _enqueue_ai_review(_vl.pk, screenshot, u.id, exam_id_int)

            cnt_all = logs_qs.count()

            # Texnik nosozlik: hodisa yozildi va proktor ko'radi, lekin
            # rasmiy ogohlantirish hisoblanmaydi va sessiya yopilmaydi.
            if vtype.upper() in technical_types:
                return _gv(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "technicalIssue": True,
                        "violationsCount": cnt_all,
                        "warningNumber": 0,
                        "violationReason": reason_text,
                        "isFinalWarning": False,
                        "officialWarnings": int(se.proctor_official_warnings or 0),
                    }
                )

            if warning_merge_suppressed:
                return _gv(
                    {
                        "banned": False,
                        "warningSuppressed": True,
                        "violationsCount": cnt_all,
                        "warningNumber": 0,
                        "violationReason": reason_text,
                        "isFinalWarning": False,
                        "officialWarnings": se.proctor_official_warnings,
                        "mergeWindowSeconds": WARN_SUPPRESS_SECONDS,
                    }
                )

            hardened_in_startup_window = bool(
                se.started_at
                and (now - se.started_at) < timedelta(seconds=HARDENED_STARTUP_GRACE)
            )
            if HARDENED_MODE and not hardened_in_startup_window:
                win_from = now - timedelta(minutes=HARDENED_WINDOW_MIN)
                if se.started_at and se.started_at > win_from:
                    win_from = se.started_at
                recent = list(
                    logs_qs.filter(timestamp__gte=win_from).values(
                        "violation_type", "timestamp"
                    )
                )
                hard_points = 0
                seen_types = set()
                for rr in recent:
                    tp = str(rr.get("violation_type") or "")
                    # Texnik nosozlik xavf balliga qo'shilmaydi: aks holda
                    # aloqasi uzilib turgan nomzod bir necha daqiqada
                    # chegaradan oshib, avtomatik to'xtatilardi.
                    if tp.upper() in technical_types or tp == IDENTITY_VIOLATION_TYPE:
                        continue
                    seen_types.add(tp)
                    # Ovoz gumoni xavf balliga qo'shilmaydi (yolg'iz jazo emas), lekin
                    # "ikkinchi odam + pichirlash" birikmasi uchun seen_types'da qoladi.
                    if tp.upper() in audio_review_types():
                        continue
                    hard_points += _priority_weight(_violation_priority(tp))

                # Real hayot: F12 + clipboard yoki tab+fullscreen bir vaqtda — alohida "combo" ban emas (ogohlantirish oqimi).
                combo_ban = "MULTIPLE_FACES" in seen_types and "WHISPER_OR_CONVERSATION_SUSPECTED" in seen_types
                if combo_ban or hard_points >= HARDENED_MAX_POINTS:
                    if not AUTO_BAN_NON_IDENTITY:
                        se.proctor_last_warning_at = now
                        if int(se.proctor_official_warnings or 0) < MAX_WARNINGS_BEFORE_BAN:
                            se.proctor_official_warnings = MAX_WARNINGS_BEFORE_BAN
                        se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
                        return _gv(
                            {
                                "banned": False,
                                "requiresHumanReview": True,
                                "reviewReason": "HARDENED_RISK",
                                "violationsCount": cnt_all,
                                "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                                "violationReason": f"{reason_text} (hardened)",
                                "isFinalWarning": True,
                                "warningSuppressed": False,
                                "officialWarnings": int(se.proctor_official_warnings or 0),
                                "hardenedRiskPoints": hard_points,
                                "hardenedCombo": combo_ban,
                            }
                        )
                    exam_obj = Exam.objects.filter(pk=exam_id_int).first()
                    if exam_obj:
                        retake_payload = try_apply_exam_retake(
                            se,
                            exam_obj,
                            reason_text=f"{reason_text} (hardened)",
                            violations_count=cnt_all,
                            violation_type=vtype,
                        )
                        if retake_payload:
                            if retake_payload.get("banned"):
                                _notify_banned(
                                    str(u.id), getattr(u, "name", str(u.id)), se.id,
                                    exam_id_int, f"{reason_text} (hardened)", cnt_all,
                                )
                            else:
                                notify_exam_retake(
                                    str(u.id),
                                    se.id,
                                    exam_id_int,
                                    remaining=int(retake_payload.get("retakesRemaining") or 0),
                                    reason=f"{reason_text} (hardened)",
                                    retakes_used=int(retake_payload.get("retakesUsed") or retake_payload.get("technicalRetakesUsed") or 0),
                                    identity_retake=bool(retake_payload.get("identityRetake")),
                                )
                            return _gv(retake_payload)
                    if GLOBAL_ACCOUNT_BAN:
                        AppUser.objects.filter(pk=u.id).update(status="Banned")
                    ban_fields = apply_exam_ban(se, BAN_REASON_HARDENED)
                    se.save(update_fields=ban_fields)
                    _notify_banned(
                        str(u.id), getattr(u, "name", str(u.id)), se.id,
                        exam_id_int, f"{reason_text} (hardened)", cnt_all,
                    )
                    return _gv(
                        {
                            "banned": True,
                            "banReason": BAN_REASON_HARDENED,
                            "violationsCount": cnt_all,
                            "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                            "violationReason": f"{reason_text} (hardened)",
                            "isFinalWarning": False,
                            "warningSuppressed": False,
                            "officialWarnings": se.proctor_official_warnings,
                            "hardenedRiskPoints": hard_points,
                            "hardenedCombo": combo_ban,
                        }
                    )

            if vtype in instant_ban_types:
                _is_identity = vtype == IDENTITY_VIOLATION_TYPE
                _ban_reason_code = (
                    BAN_REASON_IDENTITY if _is_identity else BAN_REASON_VIOLATION_LIMIT
                )
                if not AUTO_BAN_IDENTITY:
                    se.proctor_last_warning_at = now
                    if int(se.proctor_official_warnings or 0) < MAX_WARNINGS_BEFORE_BAN:
                        se.proctor_official_warnings = MAX_WARNINGS_BEFORE_BAN
                    se.save(update_fields=["proctor_official_warnings", "proctor_last_warning_at"])
                    return _gv(
                        {
                            "banned": False,
                            "requiresHumanReview": True,
                            "reviewReason": "IDENTITY_RISK",
                            "violationsCount": cnt_all,
                            "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                            "violationReason": reason_text,
                            "isFinalWarning": True,
                            "warningSuppressed": False,
                            "officialWarnings": int(se.proctor_official_warnings or 0),
                        }
                    )
                exam_obj = Exam.objects.filter(pk=exam_id_int).first()
                if exam_obj:
                    retake_payload = try_apply_exam_retake(
                        se,
                        exam_obj,
                        reason_text=reason_text,
                        violations_count=cnt_all,
                        violation_type=vtype,
                    )
                    if retake_payload:
                        if retake_payload.get("banned"):
                            _notify_banned(
                                str(u.id), getattr(u, "name", str(u.id)), se.id,
                                exam_id_int, reason_text, cnt_all,
                            )
                        else:
                            notify_exam_retake(
                                str(u.id),
                                se.id,
                                exam_id_int,
                                remaining=int(retake_payload.get("retakesRemaining") or 0),
                                reason=reason_text,
                                retakes_used=int(retake_payload.get("retakesUsed") or retake_payload.get("technicalRetakesUsed") or 0),
                                identity_retake=_is_identity,
                            )
                        return _gv(retake_payload)
                if GLOBAL_ACCOUNT_BAN:
                    AppUser.objects.filter(pk=u.id).update(status="Banned")
                apply_exam_ban(se, _ban_reason_code)
                se.save(update_fields=["status", "ban_reason"])
                _notify_banned(
                    str(u.id), getattr(u, "name", str(u.id)), se.id,
                    exam_id_int, reason_text, cnt_all,
                )
                return _gv(
                    {
                        "banned": True,
                        "banReason": _ban_reason_code,
                        "violationsCount": cnt_all,
                        "warningNumber": MAX_WARNINGS_BEFORE_BAN,
                        "violationReason": reason_text,
                        "isFinalWarning": False,
                        "warningSuppressed": False,
                        "officialWarnings": se.proctor_official_warnings,
                    }
                )

            payload = apply_official_warning_or_ban(
                se,
                student_id=str(u.id),
                student_name=getattr(u, "name", str(u.id)),
                exam_id=exam_id_int,
                reason_text=reason_text,
                violations_count=cnt_all,
                max_warnings_before_ban=MAX_WARNINGS_BEFORE_BAN,
                auto_ban=AUTO_BAN_NON_IDENTITY,
                global_account_ban=GLOBAL_ACCOUNT_BAN,
                exam=Exam.objects.filter(pk=exam_id_int).first(),
                violation_type=vtype,
            )
            return _gv(payload)
    except Exception:
        logger.exception(
            "student_violations: saqlashda xato exam_id=%s vtype=%s student_id=%s",
            exam_id_int,
            vtype,
            getattr(u, "id", None),
        )
        return _guard(
            {
                "error": "Could not record violation",
                "code": "VIOLATION_PERSIST_FAILED",
            },
            status=500,
        )


# ---------------------------------------------------------------------------
# Server-side proktor kadr tahlili (Browser AI o'rniga)
# ---------------------------------------------------------------------------
def _proctor_result_payload(data: dict | None) -> dict:
    data = data or {}
    return {
        "status": "done",
        "violations": list(data.get("violations") or []),
        "face_count": int(data.get("face_count") or 0),
        "skipped": bool(data.get("skipped")),
        "method": data.get("method"),
        "code": data.get("code"),
    }


@api_view(["POST"])
@throttle_classes([ProctorFrameThrottle])
@permission_classes([IsAuthenticated])
def student_proctor_frame(request, pk: int):
    """
    Server-side AI kadr tahlili — Celery worker'da bajariladi.

    Eager rejim (broker yo'q) yoki natija darhol tayyor bo'lsa: 200 + violations
    (eski sync xulq, frontend o'zgartirishsiz ishlaydi).
    Async (worker bor): 202 + {task_id} — client GET .../proctor-frame/{task_id} bilan poll qiladi.
    Client violations'ni /api/student/violations orqali yuboradi.
    """
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)

    pc_err = _reject_non_desktop_or_none(request)
    if pc_err is not None:
        return pc_err

    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response({"error": student_api_msg("no_active_session", resolve_ui_language(request)), "code": "NO_ACTIVE_SESSION", "sessionStatus": str(getattr(se, "status", "") or ""), "banReason": str(getattr(se, "ban_reason", "") or "")}, status=409)

    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch

    # Liveness watchdog: oxirgi kadr kelgan vaqtni belgilaymiz (clock staleness uchun).
    StudentExam.objects.filter(pk=se.pk).update(proctor_last_frame_at=dj_tz.now())

    d = request.data or {}
    frame_b64 = str(d.get("frame") or "").strip()
    if not frame_b64:
        return Response({"error": "frame required"}, status=400)
    if len(frame_b64) > 2_000_000:
        return Response({"error": "frame too large (max ~1.5 MB base64)"}, status=413)

    # Telefon/kitob/noutbuk — Vision AI. Default YOQILGAN.
    # Explicit o'chirish: PROCTOR_OPENAI_OBJECTS=0. Kalit yo'q bo'lsa ham urinmaymiz.
    from apps.api.openai_client import api_key_configured

    env_flag = str(os.environ.get("PROCTOR_OPENAI_OBJECTS", "1")).strip().lower()
    enrich_objects = env_flag not in ("0", "false", "no", "off") and api_key_configured()

    try:
        task = analyze_proctor_frame_task.delay(frame_b64, enrich_objects)
    except Exception:
        logger.exception("proctor_frame enqueue failed")
        return Response({"status": "done", "violations": [], "skipped": True, "code": "QUEUE_UNAVAILABLE"}, status=200)

    if task.ready():
        # Eager yoki natija darhol tayyor — sync javob (eski xulq).
        try:
            return Response(_proctor_result_payload(task.result))
        except Exception:
            return Response({"status": "done", "violations": [], "skipped": True, "code": "TASK_FAILED"}, status=200)

    return Response({"status": "queued", "task_id": task.id, "poll_after_ms": 1500}, status=202)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def student_proctor_frame_result(request, pk: int, task_id: str):
    """Async proctor task natijasini olish (poll). Tayyor bo'lmasa 202."""
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)

    from celery.result import AsyncResult

    from exam_platform.celery import app as celery_app

    res = AsyncResult(str(task_id), app=celery_app)
    if not res.ready():
        return Response({"status": "pending"}, status=202)
    if res.failed():
        return Response({"status": "done", "violations": [], "skipped": True, "code": "TASK_FAILED"}, status=200)
    try:
        return Response(_proctor_result_payload(res.result))
    except Exception:
        return Response({"status": "done", "violations": [], "skipped": True, "code": "TASK_FAILED"}, status=200)


def _revert_failed_start(user_id: str, exam_id: int, before: str | None) -> None:
    """Boshlash muvaffaqiyatsiz bo'lsa sessiya toza "Pending" ga qaytadi.

    Boshlashda sessiya avval "In Progress" ga o'tadi, keyin savollar tuziladi
    (vakansiyada AI orqali). Tuzish xato bersa so'rov xato bilan qaytardi-yu,
    sessiya SAVOLSIZ "In Progress" bo'lib qolardi: server har 5 daqiqada
    "kamera uzildi" deb yozar, odam qayta kirmasa vaqt tugagach 0 ball bilan
    yakunlanishi mumkin edi (8-9 sentyabrda 7 nomzodda shunday bo'lgan).

    Faqat SHU so'rov "In Progress" ga o'tkazgan, savoli va javobi yo'q
    sessiyaga tegiladi — davom ettirilayotgan imtihon hech qachon qaytarilmaydi.
    """
    import logging

    from apps.api.views._helpers import _student_exam_draft_is_empty

    if before not in (None, "Pending"):
        return
    se = StudentExam.objects.filter(student_id=user_id, exam_id=exam_id).first()
    if se is None or (se.status or "").strip() != "In Progress":
        return
    if safe_json_loads(se.session_questions_json or "", []):
        return
    if not _student_exam_draft_is_empty(se):
        return
    se.status = "Pending"
    se.started_at = None
    se.device_session_token = ""
    se.device_fingerprint = ""
    se.device_bound_at = None
    se.save(
        update_fields=[
            "status",
            "started_at",
            "device_session_token",
            "device_fingerprint",
            "device_bound_at",
        ]
    )
    logging.getLogger("apps.api").warning(
        "[START-REVERT] student=%s exam=%s — boshlash muvaffaqiyatsiz, sessiya Pending ga qaytarildi",
        user_id,
        exam_id,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_exams_start(request, pk: int):
    """Imtihonni boshlash — muvaffaqiyatsiz boshlash sessiyani buzib qo'ymasin."""
    uid = str(getattr(request.user, "id", "") or "")
    before = (
        StudentExam.objects.filter(student_id=uid, exam_id=pk)
        .values_list("status", flat=True)
        .first()
    )
    try:
        resp = _student_exams_start_impl(request._request, pk=pk)
    except Exception:
        _revert_failed_start(uid, pk, before)
        raise
    if int(getattr(resp, "status_code", 200) or 200) >= 400:
        _revert_failed_start(uid, pk, before)
    return resp


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_screen_snapshot(request, pk: int):
    """Butun ekran rasmi — imtihon davomida vaqti-vaqti bilan yuboriladi.

    Hech qachon jazo bermaydi: faqat saqlanadi, admin "Dalillar"da ko'radi.
    Juda tez-tez yuborilsa (20 soniyadan kam) yangisi yozilmaydi.
    """
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or se.status != "In Progress":
        return Response(
            {
                "error": student_api_msg("no_active_session", resolve_ui_language(request)),
                "code": "NO_ACTIVE_SESSION",
                "sessionStatus": str(getattr(se, "status", "") or ""),
            },
            status=409,
        )
    mismatch = _enforce_bound_device_or_403(se, request)
    if mismatch is not None:
        return mismatch
    kind = str((request.data or {}).get("kind") or "screen").strip().lower()
    if kind not in ("screen", "webcam"):
        kind = "screen"
    image = str((request.data or {}).get("image") or "")
    if not image.startswith("data:image/jpeg;base64,"):
        return Response({"error": "image required"}, status=400)
    if len(image) > 700_000:
        return Response({"error": "image too large"}, status=413)
    from apps.core.models import ScreenSnapshot

    now = dj_tz.now()
    last = (
        ScreenSnapshot.objects.filter(student_exam_id=se.id, kind=kind)
        .order_by("-taken_at")
        .values_list("taken_at", flat=True)
        .first()
    )
    if last is not None and (now - last).total_seconds() < 20:
        return Response({"ok": True, "skipped": True})
    ScreenSnapshot.objects.create(student_exam_id=se.id, taken_at=now, image=image, kind=kind)
    if kind == "webcam":
        # Server o'zi tasodifiy paytda kadrdagi yuzni profil rasmi bilan solishtiradi —
        # ilova/brauzer tekshiruvidan mustaqil.
        _maybe_random_identity_check(se.id, image)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_question_advance(request, pk: int):
    """Savolga vaqt rejimi: joriy savol javobini qulflash (action=advance) yoki
    birinchi savol soatini imtihon oynasi tayyor bo'lganda boshlash (action=arm)."""
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    exam = Exam.objects.filter(pk=pk).first()
    if not exam:
        return Response({"error": student_api_msg("exam_not_found", resolve_ui_language(request))}, status=404)
    from apps.api import question_lock as _ql

    with transaction.atomic():
        se = StudentExam.objects.select_for_update().filter(student_id=u.id, exam_id=pk).first()
        if not se or se.status != "In Progress":
            return Response(
                {
                    "error": student_api_msg("no_active_session", resolve_ui_language(request)),
                    "code": "NO_ACTIVE_SESSION",
                    "sessionStatus": str(getattr(se, "status", "") or ""),
                    "banReason": str(getattr(se, "ban_reason", "") or ""),
                },
                status=409,
            )
        mismatch = _enforce_bound_device_or_403(se, request)
        if mismatch is not None:
            return mismatch
        # Sessiyaga saqlanmagan (bank = imtihon savollari) holatda ham submit bilan bir xil ro'yxat.
        questions = safe_json_loads(se.session_questions_json, []) or safe_json_loads(exam.questions_json, []) or []
        d = request.data or {}
        if str(d.get("action") or "advance") == "arm":
            code, body = _ql.arm(se, len(questions), deadline=submission_deadline(exam, se, student_id=str(u.id)))
            return Response(body, status=code)
        qid = str(d.get("qid") or "")
        raw = str(d.get("answer") or "")
        norm_ans = ""
        if raw and qid:
            student_lang = resolve_student_exam_language(request, exam)
            q_list = prepare_questions_for_grading(questions, exam, {qid: raw}, student_lang=student_lang)
            norm_ans = str(validate_exam_answers(q_list, {qid: raw}, strict=False).get(qid, "") or "")
        code, body = _ql.advance(se, questions, qid, norm_ans)
        return Response(body, status=code)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def student_room_scan(request, pk: int):
    """Imtihon oldidan xonani ko'rsatish: kamera kadrlari saqlanadi (admin ko'rib chiqadi)."""
    u = request.user
    if not _is_student_user(u):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    if not _student_assigned_to_exam(u, pk):
        return Response({"error": student_api_msg("forbidden", resolve_ui_language(request))}, status=403)
    se = StudentExam.objects.filter(student_id=u.id, exam_id=pk).first()
    if not se or not se.vac_consent_at or se.status not in ("Pending", "In Progress"):
        return Response({"error": "Avval nazorat qoidalariga rozilik bering.", "code": "CONSENT_REQUIRED"}, status=403)
    images = (request.data or {}).get("images")
    if not isinstance(images, list):
        return Response({"error": "images required"}, status=400)
    good = [str(x) for x in images[:12] if str(x).startswith("data:image/jpeg;base64,") and len(str(x)) <= 500_000]
    if len(good) < 3:
        return Response({"error": "Kamera kadrlari yetarli emas. Qayta urinib ko'ring.", "code": "ROOM_SCAN_TOO_FEW"}, status=400)
    from apps.core.models import ScreenSnapshot

    now = dj_tz.now()
    with transaction.atomic():
        ScreenSnapshot.objects.filter(student_exam_id=se.id, kind="room").delete()
        ScreenSnapshot.objects.bulk_create(
            [ScreenSnapshot(student_exam_id=se.id, taken_at=now, image=img, kind="room") for img in good]
        )
    return Response({"ok": True, "count": len(good)})


def _violation_outcome(payload: dict) -> str:
    """student_violations javobidan qayd natijasi (admin dalillar oynasi uchun)."""
    p = payload or {}
    if p.get("banned"):
        return "ban"
    if p.get("examRetake") or p.get("technicalRetake") or p.get("identityRetake"):
        return "retake"
    if p.get("requiresHumanReview"):
        return "review"
    if p.get("technicalIssue"):
        return "technical"
    if p.get("warningSuppressed"):
        return "merged"
    n = int(p.get("warningNumber") or 0)
    return "warning:%d" % n if n > 0 else "logged"


#: AI ko'rib chiqadigan (kadrli) qoidabuzarlik turlari.
AI_REVIEW_TYPES = frozenset({
    "FORBIDDEN_OBJECT_CELL_PHONE",
    "FORBIDDEN_OBJECT_BOOK",
    "FORBIDDEN_OBJECT_LAPTOP",
    "MULTIPLE_FACES",
    "FACE_NOT_VISIBLE",
    "GAZE_DOWN_TOTAL",
    "GAZE_AWAY_LEFT",
    "GAZE_AWAY_RIGHT",
    "HAND_GESTURE_SUSPECTED",
    "HAND_NEAR_EAR",
    "IDENTITY_SUBSTITUTION",
})


def _env_on(name: str, default: str = "1") -> bool:
    return str(os.environ.get(name, default)).strip().lower() not in ("0", "false", "no", "off", "")


def _enqueue_ai_review(log_id: int, image: str, student_id, exam_id: int) -> None:
    """Qoidabuzarlik kadrini AI ga yuborish (sessiyaga cheklangan son, faqat kalit bo'lsa)."""
    try:
        if not _env_on("AI_EVIDENCE_REVIEW"):
            return
        from apps.api.openai_client import api_key_configured

        if not api_key_configured():
            return
        from django.core.cache import cache

        try:
            cap = int(os.environ.get("AI_EVIDENCE_REVIEW_MAX_PER_SESSION", "12"))
        except ValueError:
            cap = 12
        key = "aireview:%s:%s" % (student_id, exam_id)
        cache.add(key, 0, 6 * 3600)
        if int(cache.incr(key)) > cap:
            return
        from apps.api.tasks import ai_review_violation_task

        transaction.on_commit(lambda: ai_review_violation_task.delay(int(log_id), image))
    except Exception:  # noqa: BLE001
        logger.exception("ai review enqueue failed log_id=%s", log_id)


def _maybe_random_identity_check(student_exam_id: int, image: str) -> None:
    """Kamera kadrlarining tasodifiy qismi serverda yuz bo'yicha tekshiriladi."""
    try:
        if not _env_on("RANDOM_IDENTITY_CHECK"):
            return
        import random

        try:
            prob = float(os.environ.get("RANDOM_IDENTITY_PROBABILITY", "0.35"))
        except ValueError:
            prob = 0.35
        if random.random() > prob:
            return
        from apps.api.tasks import random_identity_check_task

        random_identity_check_task.delay(int(student_exam_id), image)
    except Exception:  # noqa: BLE001
        logger.exception("random identity enqueue failed se=%s", student_exam_id)
