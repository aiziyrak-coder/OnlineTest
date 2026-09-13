from django.db import models

from .exam import Exam
from .user import AppUser


class StudentExam(models.Model):
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    status = models.CharField(max_length=20, default="Pending")
    score = models.IntegerField(null=True, blank=True)
    answers_json = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    flagged_questions_json = models.TextField(default="[]")
    session_questions_json = models.TextField(blank=True, null=True)
    draft_answers_json = models.TextField(default="{}")
    draft_flagged_json = models.TextField(default="[]")
    draft_updated_at = models.DateTimeField(null=True, blank=True)
    result_public_id = models.CharField(max_length=100, blank=True, null=True, unique=True)
    result_verify_secret = models.CharField(max_length=128, blank=True, null=True)
    ai_summary_json = models.TextField(blank=True, null=True)
    device_fingerprint = models.CharField(max_length=128, blank=True, default="")
    device_bound_at = models.DateTimeField(null=True, blank=True)
    session_signing_key = models.CharField(max_length=128, blank=True, default="")
    session_request_seq = models.PositiveIntegerField(default=1)
    session_challenge = models.CharField(max_length=64, blank=True, default="")
    device_session_token = models.CharField(max_length=128, blank=True, default="")
    identity_verified_at = models.DateTimeField(null=True, blank=True)
    identity_last_checked_at = models.DateTimeField(null=True, blank=True)
    identity_last_matched = models.BooleanField(null=True, blank=True, default=None)
    identity_last_score = models.FloatField(null=True, blank=True)
    identity_last_method = models.CharField(max_length=20, blank=True, default="")
    identity_last_code = models.CharField(max_length=40, blank=True, default="")
    proctor_official_warnings = models.PositiveSmallIntegerField(default=0)
    proctor_last_warning_at = models.DateTimeField(null=True, blank=True)
    proctor_last_frame_at = models.DateTimeField(null=True, blank=True)
    technical_retakes_used = models.PositiveSmallIntegerField(default=0)
    bonus_technical_retakes = models.PositiveSmallIntegerField(default=0)
    identity_retakes_used = models.PositiveSmallIntegerField(default=0)
    ban_reason = models.CharField(max_length=32, blank=True, default="")
    # Admin "Ko'rib chiqish navbati"da qatorni yopgan payt. Navbat
    # violations_log dan quriladi va yozuvlar hech qachon o'chmaydi, shuning
    # uchun blokdan chiqarilgan/qayta imkon berilgan kishi ham navbatda qolib
    # ketardi — admin bir xil qatorni qayta-qayta bosardi. Shu vaqtdan oldingi
    # buzilishlar ko'rib chiqilgan hisoblanadi.
    review_cleared_at = models.DateTimeField(null=True, blank=True)
    # Ordinator/magistr: imtihon TO'LOVDAN keyin ochiladi. Standart holatda
    # yopiq turadi, admin to'lovni tasdiqlagach True bo'ladi.
    access_granted = models.BooleanField(default=False)
    # Admin to'lov asosida nechta urinish bergani (kvitansiya tasdiqlangani).
    paid_attempts_granted = models.PositiveSmallIntegerField(default=0)
    # Shu kishiga ALLAQACHON berilgan savol raqamlari. Qayta urinishda
    # ular chetlab o'tiladi - savollar takrorlanmasligi kerak.
    served_question_ids = models.TextField(blank=True, default="[]")
    # Ruxsatni ushlab turish sababi ("DEBT" — fandan qarzdorlik). Ruxsat
    # berilmagan bo'lsa talabaga sababi va murojaat telefoni ko'rsatiladi.
    # Admin "Ruxsat berish"ni bossa tozalanadi (qarz yopildi degani).
    access_hold_reason = models.CharField(max_length=32, blank=True, default="")
    # Har bir savolga sarflangan vaqt (frontend yuboradi, answer_timing.clean_timings
    # bilan tozalanadi): uzun klinik savolga bir necha soniyada to'g'ri javob — belgi.
    answer_timings_json = models.TextField(blank=True, default="")
    # Savolga vaqt va orqaga qaytmaslik holati (apps.api.question_lock):
    # {"enabled", "idx", "shown_at", "seconds", "locked": {qid: javob}, "armed"}.
    question_lock_json = models.TextField(blank=True, default="")

    # --- Nazorat qoidalariga ROZILIK (apellyatsiya uchun dalil) ---------
    #: Rozilik berilgan payt. Bo'sh bo'lsa imtihon boshlanmaydi.
    vac_consent_at = models.DateTimeField(null=True, blank=True)
    #: Ko'rsatilgan qoidalar matnining barmoq izi (sha256, 16 belgi) va
    #: tili. Qoidalar keyin o'zgarsa ham, u AYNAN nimaga rozi bo'lgani
    #: aniqlanadi.
    vac_consent_version = models.CharField(max_length=64, blank=True, default="")
    #: Rozilik berilgan IP va qurilma — kim va qayerdan tasdiqlagani.
    vac_consent_ip = models.CharField(max_length=64, blank=True, default="")
    #: Imtihon boshida O'LCHANGAN mikrofon darajasi (RMS 0..1).
    #: Keyinchalik mikrofon jim bo'lib qolsa, bu qiymat uning boshida
    #: ishlaganini isbotlaydi.
    mic_level_at_start = models.FloatField(null=True, blank=True)

    class Meta:
        app_label = "core"
        db_table = "student_exams"
        indexes = [
            models.Index(fields=["student", "exam"]),
        ]
