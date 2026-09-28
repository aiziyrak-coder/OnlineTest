from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0048_test_center"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="verify_state",
            field=models.CharField(blank=True, db_index=True, default="", max_length=16),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="verify_reason",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="verify_note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="verify_by",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="verify_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="verify_original_score",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
