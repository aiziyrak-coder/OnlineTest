"""Imtihonda AI yaratadigan savollar soni."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0039_exam_user_course"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="ai_question_count",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
