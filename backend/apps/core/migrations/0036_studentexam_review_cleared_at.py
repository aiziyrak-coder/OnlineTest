from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0035_exam_kafedra_faculty_subject"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="review_cleared_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
