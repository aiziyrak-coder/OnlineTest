from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0008_sync_model_state"),
    ]

    operations = [
        migrations.CreateModel(
            name="BanAppeal",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reason", models.TextField()),
                ("evidence_name", models.CharField(blank=True, default="", max_length=255)),
                ("evidence_mime", models.CharField(blank=True, default="", max_length=100)),
                ("evidence_base64", models.TextField(blank=True, default="")),
                ("status", models.CharField(default="Pending", max_length=20)),
                ("review_note", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "exam",
                    models.ForeignKey(
                        blank=True,
                        db_column="exam_id",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="core.exam",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        db_column="reviewed_by",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="ban_appeals_reviewed",
                        to="core.appuser",
                    ),
                ),
                (
                    "student",
                    models.ForeignKey(
                        db_column="student_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.appuser",
                    ),
                ),
            ],
            options={
                "db_table": "ban_appeals",
            },
        ),
        migrations.AddIndex(
            model_name="banappeal",
            index=models.Index(fields=["student", "status"], name="ban_appeals_student_4c2869_idx"),
        ),
        migrations.AddIndex(
            model_name="banappeal",
            index=models.Index(fields=["status", "created_at"], name="ban_appeals_status_4ec8b1_idx"),
        ),
    ]
