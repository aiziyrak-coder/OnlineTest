import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0037_vacancy_subject_and_clinical"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="access_granted",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="paid_attempts_granted",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="served_question_ids",
            field=models.TextField(blank=True, default="[]"),
        ),
        migrations.CreateModel(
            name="PaymentReceipt",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file_name", models.CharField(max_length=255)),
                ("file_mime", models.CharField(max_length=100)),
                ("file_base64", models.TextField()),
                ("note", models.TextField(blank=True, default="")),
                ("status", models.CharField(default="Pending", max_length=16)),
                ("admin_note", models.TextField(blank=True, default="")),
                ("reviewed_by", models.CharField(blank=True, default="", max_length=64)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "exam",
                    models.ForeignKey(
                        blank=True,
                        db_column="exam_id",
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.exam",
                    ),
                ),
                (
                    "student",
                    models.ForeignKey(
                        db_column="student_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payment_receipts",
                        to="core.appuser",
                    ),
                ),
            ],
            options={
                "db_table": "payment_receipts",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="paymentreceipt",
            index=models.Index(fields=["status"], name="payment_receipts_status_idx"),
        ),
        migrations.AddIndex(
            model_name="paymentreceipt",
            index=models.Index(fields=["student"], name="payment_receipts_student_idx"),
        ),
    ]
