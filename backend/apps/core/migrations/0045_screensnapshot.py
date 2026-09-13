"""Imtihon davomida olinadigan butun ekran rasmlari (dalil)."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0044_studentexam_answer_timings"),
    ]

    operations = [
        migrations.CreateModel(
            name="ScreenSnapshot",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("taken_at", models.DateTimeField()),
                ("image", models.TextField()),
                (
                    "student_exam",
                    models.ForeignKey(
                        db_column="student_exam_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="screen_snapshots",
                        to="core.studentexam",
                    ),
                ),
            ],
            options={
                "db_table": "screen_snapshots",
                "indexes": [
                    models.Index(fields=["student_exam", "taken_at"], name="screen_snap_se_taken_idx"),
                ],
            },
        ),
    ]
