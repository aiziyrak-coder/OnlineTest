from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0012_studentexam_session_signing_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="session_request_seq",
            field=models.PositiveIntegerField(default=1),
        ),
    ]
