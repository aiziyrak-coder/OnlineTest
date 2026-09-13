"""Har bir savolga sarflangan vaqt (ko'chirish tahlili uchun)."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0043_studentexam_access_hold_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="answer_timings_json",
            field=models.TextField(blank=True, default=""),
        ),
    ]
