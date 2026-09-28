from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0047_violationlog_detail_outcome"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="test_center_pin",
            field=models.CharField(blank=True, default="", max_length=8),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="test_center_mode",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="test_center_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
