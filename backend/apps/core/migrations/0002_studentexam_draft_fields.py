from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="draft_answers_json",
            field=models.TextField(default="{}"),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="draft_flagged_json",
            field=models.TextField(default="[]"),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="draft_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
