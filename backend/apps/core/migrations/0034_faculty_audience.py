# Generated manually for faculty + exam audience

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0033_direction_taught_kafedralar"),
    ]

    operations = [
        migrations.AddField(
            model_name="appuser",
            name="kafedra",
            field=models.ForeignKey(
                blank=True,
                db_column="kafedra_id",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="users",
                to="core.kafedra",
            ),
        ),
        migrations.AddField(
            model_name="appuser",
            name="position",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="appuser",
            name="stavka",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="exam",
            name="audience",
            field=models.CharField(default="student", max_length=20),
        ),
    ]
