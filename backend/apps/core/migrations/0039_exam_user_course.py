"""Ordinatura/magistratura kursi: 1-kurs va 2-kurs imtihonlarini ajratish."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0038_ordinator_payment_access"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="course",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="appuser",
            name="course",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
