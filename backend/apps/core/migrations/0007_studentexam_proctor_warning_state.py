from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0006_production_indexes_and_db_ready"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentexam",
            name="proctor_official_warnings",
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text="Rasmiy ogohlantirishlar soni (1 daqiqada bir nechta hodisa = 1). 4-chi epizodda ban.",
            ),
        ),
        migrations.AddField(
            model_name="studentexam",
            name="proctor_last_warning_at",
            field=models.DateTimeField(
                null=True,
                blank=True,
                help_text="Oxirgi rasmiy ogohlantirish vaqti (keyingi 60s ichida hisoblanmaydi).",
            ),
        ),
    ]
