from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0046_question_lock_and_snapshot_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="violationlog",
            name="detail",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="violationlog",
            name="outcome",
            field=models.CharField(blank=True, default="", max_length=40),
        ),
    ]
