"""Maxsus kirish imtihoni: o'tish chegarasi va ko'p fanli tarkib."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0040_exam_ai_question_count"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="pass_percent",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="exam",
            name="question_plan",
            field=models.TextField(blank=True, default=""),
        ),
    ]
