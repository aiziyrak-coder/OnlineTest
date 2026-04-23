from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0011_studentexam_device_binding"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="session_signing_key",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
    ]
