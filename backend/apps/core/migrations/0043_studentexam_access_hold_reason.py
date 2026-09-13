"""Ruxsatni ushlab turish sababi (masalan, fandan qarzdorlik)."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0042_vac_consent"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="access_hold_reason",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
