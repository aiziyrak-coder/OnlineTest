"""Nazorat qoidalariga rozilik va mikrofon darajasi (yuridik dalil)."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0041_exam_pass_plan"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="vac_consent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="vac_consent_version",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="vac_consent_ip",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="mic_level_at_start",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
