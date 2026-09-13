from django.db import models

from .student_exam import StudentExam


class ScreenSnapshot(models.Model):
    """Imtihon davomida olingan butun ekran rasmi (dalil, jazo bermaydi)."""

    id = models.BigAutoField(primary_key=True)
    student_exam = models.ForeignKey(
        StudentExam,
        on_delete=models.CASCADE,
        db_column="student_exam_id",
        related_name="screen_snapshots",
    )
    taken_at = models.DateTimeField()
    image = models.TextField()
    #: "screen" — ekran rasmi, "webcam" — kamera kadri, "room" — imtihon oldidan xonani ko'rsatish.
    kind = models.CharField(max_length=16, default="screen", db_index=True)

    class Meta:
        app_label = "core"
        db_table = "screen_snapshots"
        indexes = [
            models.Index(fields=["student_exam", "taken_at"], name="screen_snap_se_taken_idx"),
        ]
