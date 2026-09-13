"""Savolga vaqt/orqaga qaytmaslik holati va dalil rasmlari turi (ekran/kamera/xona)."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0045_screensnapshot"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="question_lock_json",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="screensnapshot",
            name="kind",
            field=models.CharField(db_index=True, default="screen", max_length=16),
        ),
    ]
