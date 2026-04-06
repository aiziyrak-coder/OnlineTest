import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_bank_program_tracks_translations"),
    ]

    operations = [
        migrations.CreateModel(
            name="ExamStudentException",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reason", models.TextField()),
                (
                    "exam",
                    models.ForeignKey(
                        db_column="exam_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.exam",
                    ),
                ),
                (
                    "student",
                    models.ForeignKey(
                        db_column="student_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.appuser",
                        to_field="id",
                    ),
                ),
            ],
            options={
                "db_table": "exam_student_exceptions",
                "unique_together": {("exam", "student")},
            },
        ),
        migrations.CreateModel(
            name="ExamRetakeWindow",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("window_start", models.DateTimeField()),
                ("window_end", models.DateTimeField()),
                ("note", models.TextField(blank=True)),
                (
                    "exam",
                    models.ForeignKey(
                        db_column="exam_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.exam",
                    ),
                ),
                (
                    "student",
                    models.ForeignKey(
                        db_column="student_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.appuser",
                        to_field="id",
                    ),
                ),
            ],
            options={
                "db_table": "exam_retake_windows",
            },
        ),
        migrations.AddIndex(
            model_name="examretakewindow",
            index=models.Index(fields=["exam", "student"], name="exam_retake_exam_student_idx"),
        ),
    ]
