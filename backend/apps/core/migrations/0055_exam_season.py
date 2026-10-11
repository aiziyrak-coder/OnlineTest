from django.db import migrations, models


class Migration(migrations.Migration):
    """Imtihonga test mavsumi nomi — hisobotlar shu bo'yicha guruhlanadi."""

    dependencies = [("core", "0054_exam_last_entry_at")]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="season",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddIndex(
            model_name="exam",
            index=models.Index(fields=["season"], name="core_exam_season_idx"),
        ),
    ]
