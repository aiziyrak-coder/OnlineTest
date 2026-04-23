from django.db import models


class Level(models.Model):
    name = models.CharField(max_length=200, unique=True)

    class Meta:
        db_table = "levels"


class Group(models.Model):
    name = models.CharField(max_length=200)
    level = models.ForeignKey(Level, on_delete=models.CASCADE, db_column="level_id")
    # Talaba yo‘nalishi: bakalavr (1–6 kurs), ordinatura, magistratura — test bazasi filtri uchun
    program_track = models.CharField(max_length=20, default="bachelor")
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = "groups"


class AppUser(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    password = models.CharField(max_length=128)
    role = models.CharField(max_length=20)
    name = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default="Active")
    group = models.ForeignKey(Group, null=True, blank=True, on_delete=models.SET_NULL, db_column="group_id")
    profile_image = models.TextField(blank=True)

    class Meta:
        db_table = "users"


class Exam(models.Model):
    teacher = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="teacher_id", to_field="id")
    title = models.CharField(max_length=500)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration_minutes = models.IntegerField()
    questions_json = models.TextField(default="[]")
    language = models.CharField(max_length=10, default="uz")
    pin = models.CharField(max_length=50, blank=True)
    custom_rules = models.TextField(blank=True)
    exam_mode = models.CharField(max_length=20, default="static")
    bank_category_ids = models.TextField(default="[]")
    bank_question_count = models.IntegerField(default=0)

    class Meta:
        db_table = "exams"


class ExamGroup(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    group = models.ForeignKey(Group, on_delete=models.CASCADE, db_column="group_id")

    class Meta:
        db_table = "exam_groups"
        unique_together = [("exam", "group")]


class ExamStudentException(models.Model):
    """Tanlangan talaba ushbu imtihonni boshlay olmaydi (sabab ko‘rsatiladi)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    student = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id")
    reason = models.TextField()

    class Meta:
        db_table = "exam_student_exceptions"
        unique_together = [("exam", "student")]


class ExamRetakeWindow(models.Model):
    """Imtihon yopilgandan keyin ma’lum talaba uchun qayta kirish vaqti."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    student = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id")
    window_start = models.DateTimeField()
    window_end = models.DateTimeField()
    note = models.TextField(blank=True)

    class Meta:
        db_table = "exam_retake_windows"
        indexes = [
            models.Index(fields=["exam", "student"]),
        ]


class StudentExam(models.Model):
    student = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id")
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
    # VAC: imtihon birinchi boshlangan qurilma fingerprintiga sessiyani bog'lash
    device_fingerprint = models.CharField(max_length=128, blank=True, default="")
    device_bound_at = models.DateTimeField(null=True, blank=True)
    # VAC next phase: request-level imzo uchun per-session secret
    session_signing_key = models.CharField(max_length=128, blank=True, default="")
    # VAC sequence chain: har request ketma-ketligi tekshiriladi
    session_request_seq = models.PositiveIntegerField(default=1)
    # VAC challenge chain: har requestdan keyin yangilanadigan bir martalik challenge
    session_challenge = models.CharField(max_length=64, blank=True, default="")
    # Proktorlik: rasmiy ogohlantirish (1 daqiqada bir nechta qonunbuzarlik = 1 ta); 4-chi epizodda ban
    proctor_official_warnings = models.PositiveSmallIntegerField(default=0)
    proctor_last_warning_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "student_exams"
        indexes = [
            models.Index(fields=["student", "exam"]),
        ]


class ViolationLog(models.Model):
    student = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id")
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    violation_type = models.CharField(max_length=80)
    timestamp = models.DateTimeField()
    screenshot_url = models.TextField(blank=True)

    class Meta:
        db_table = "violations_log"
        indexes = [
            models.Index(fields=["student", "exam"]),
            models.Index(fields=["exam", "timestamp"]),
        ]


class UnbanEvidence(models.Model):
    student = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id")
    admin = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="admin_id", related_name="unban_actions", to_field="id")
    reason = models.TextField()
    file_name = models.CharField(max_length=255)
    file_mime = models.CharField(max_length=100)
    file_base64 = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "unban_evidence"


class BanAppeal(models.Model):
    student = models.ForeignKey(AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id")
    exam = models.ForeignKey(Exam, on_delete=models.SET_NULL, null=True, blank=True, db_column="exam_id")
    reason = models.TextField()
    evidence_name = models.CharField(max_length=255, blank=True, default="")
    evidence_mime = models.CharField(max_length=100, blank=True, default="")
    evidence_base64 = models.TextField(blank=True, default="")
    evidence_sha256 = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=20, default="Pending")
    review_note = models.TextField(blank=True, default="")
    reviewed_by = models.ForeignKey(
        AppUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="reviewed_by",
        related_name="ban_appeals_reviewed",
        to_field="id",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ban_appeals"
        indexes = [
            models.Index(fields=["student", "status"]),
            models.Index(fields=["status", "created_at"]),
        ]


class BanAppealEvent(models.Model):
    appeal = models.ForeignKey(BanAppeal, on_delete=models.CASCADE, db_column="appeal_id")
    actor = models.ForeignKey(AppUser, on_delete=models.SET_NULL, null=True, blank=True, db_column="actor_id", to_field="id")
    action = models.CharField(max_length=40)
    note = models.TextField(blank=True, default="")
    meta_json = models.TextField(blank=True, default="{}")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ban_appeal_events"
        indexes = [
            models.Index(fields=["appeal", "created_at"]),
        ]


class TestBankCategory(models.Model):
    name = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    sort_order = models.IntegerField(default=0)
    # Kategoriya qaysi talabalar uchun: bachelor + kurs, residency, master, any (hammasi)
    program_track = models.CharField(max_length=20, default="any")
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)
    source_language = models.CharField(max_length=10, default="en")

    class Meta:
        db_table = "test_bank_categories"


class TestBankQuestion(models.Model):
    category = models.ForeignKey(TestBankCategory, on_delete=models.CASCADE, db_column="category_id")
    # Asosiy (odatda inglizcha) matn va variantlar
    text = models.TextField()
    options_json = models.TextField()
    correct_answer = models.CharField(max_length=500)
    language = models.CharField(max_length=10, default="en")
    created_at = models.DateTimeField(auto_now_add=True)
    # O‘zbek va ruscha tarjimalar (imtihon tili bo‘yicha)
    text_uz = models.TextField(blank=True)
    text_ru = models.TextField(blank=True)
    options_uz_json = models.TextField(blank=True, default="[]")
    options_ru_json = models.TextField(blank=True, default="[]")
    correct_answer_uz = models.CharField(max_length=500, blank=True)
    correct_answer_ru = models.CharField(max_length=500, blank=True)

    class Meta:
        db_table = "test_bank_questions"


class ResultIdCounter(models.Model):
    """Yagona qator: id=1 (migratsiyada insert)."""

    id = models.IntegerField(primary_key=True)
    next_num = models.IntegerField(default=37923423)

    class Meta:
        db_table = "result_id_sequence"
