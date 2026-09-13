from django.db import models

from .exam import Exam
from .user import AppUser


class ViolationLog(models.Model):
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    violation_type = models.CharField(max_length=80)
    timestamp = models.DateTimeField()
    screenshot_url = models.TextField(blank=True)
    # Aniq fakt: qaysi dastur, nechta monitor, nima qilindi (ilova/brauzer yuboradi).
    detail = models.TextField(blank=True, default="")
    # Server qarori: warning:N | ban | retake | merged | technical | review
    outcome = models.CharField(max_length=40, blank=True, default="")

    class Meta:
        app_label = "core"
        db_table = "violations_log"
        indexes = [
            models.Index(fields=["student", "exam"]),
            models.Index(fields=["exam", "timestamp"]),
        ]


class UnbanEvidence(models.Model):
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    admin = models.ForeignKey(
        AppUser,
        on_delete=models.CASCADE,
        db_column="admin_id",
        related_name="unban_actions",
        to_field="id",
    )
    reason = models.TextField()
    file_name = models.CharField(max_length=255)
    file_mime = models.CharField(max_length=100)
    file_base64 = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "core"
        db_table = "unban_evidence"


class BanAppeal(models.Model):
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    exam = models.ForeignKey(
        Exam, on_delete=models.SET_NULL, null=True, blank=True, db_column="exam_id"
    )
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
        app_label = "core"
        db_table = "ban_appeals"
        indexes = [
            models.Index(fields=["student", "status"]),
            models.Index(fields=["status", "created_at"]),
        ]


class BanAppealEvent(models.Model):
    appeal = models.ForeignKey(BanAppeal, on_delete=models.CASCADE, db_column="appeal_id")
    actor = models.ForeignKey(
        AppUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="actor_id",
        to_field="id",
    )
    action = models.CharField(max_length=40)
    note = models.TextField(blank=True, default="")
    meta_json = models.TextField(blank=True, default="{}")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "core"
        db_table = "ban_appeal_events"
        indexes = [
            models.Index(fields=["appeal", "created_at"]),
        ]
