from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_studentexam_session_request_seq"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="session_challenge",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
    ]
