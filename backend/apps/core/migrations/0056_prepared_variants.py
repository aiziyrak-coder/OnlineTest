from django.db import migrations, models


class Migration(migrations.Migration):
    """Oldindan tayyorlangan savol to'plamlari navbati."""

    dependencies = [("core", "0055_exam_season")]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="prepared_variants_json",
            field=models.TextField(blank=True, default="[]"),
        ),
    ]
