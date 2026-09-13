# Generated manually for faculty assessment exams (kafedra + subject)

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0034_faculty_audience"),
    ]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="kafedra",
            field=models.ForeignKey(
                blank=True,
                db_column="kafedra_id",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="exams",
                to="core.kafedra",
            ),
        ),
        migrations.AddField(
            model_name="exam",
            name="faculty_subject",
            field=models.CharField(blank=True, default="", max_length=300),
        ),
    ]
