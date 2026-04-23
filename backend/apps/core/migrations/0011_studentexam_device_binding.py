from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_ban_appeal_event_and_hash"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="device_bound_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="device_fingerprint",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
    ]
