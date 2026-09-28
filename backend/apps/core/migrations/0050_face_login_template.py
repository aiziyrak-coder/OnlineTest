from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0049_result_verification"),
    ]

    operations = [
        migrations.CreateModel(
            name="FaceLoginTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source_id", models.CharField(max_length=64, unique=True)),
                ("pinfl", models.CharField(blank=True, db_index=True, default="", max_length=14)),
                ("full_name", models.CharField(blank=True, default="", max_length=255)),
                ("embedding", models.TextField()),
                ("synced_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "face_login_template"},
        ),
    ]
