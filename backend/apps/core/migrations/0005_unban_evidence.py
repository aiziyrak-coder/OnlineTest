from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_exam_exceptions_retake"),
    ]

    operations = [
        migrations.CreateModel(
            name="UnbanEvidence",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reason", models.TextField()),
                ("file_name", models.CharField(max_length=255)),
                ("file_mime", models.CharField(max_length=100)),
                ("file_base64", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "admin",
                    models.ForeignKey(
                        db_column="admin_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="unban_actions",
                        to="core.appuser",
                        to_field="id",
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
                "db_table": "unban_evidence",
            },
        ),
    ]
