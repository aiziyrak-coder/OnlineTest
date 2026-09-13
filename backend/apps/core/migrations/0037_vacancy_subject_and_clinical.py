from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0036_studentexam_review_cleared_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="kafedra",
            name="is_clinical",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="appuser",
            name="vacancy_subject",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="appuser",
            name="vacancy_subject_code",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
