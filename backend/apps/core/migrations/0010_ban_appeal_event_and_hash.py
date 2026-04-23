from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_ban_appeal"),
    ]

    operations = [
        migrations.AddField(
            model_name="banappeal",
            name="evidence_sha256",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.CreateModel(
            name="BanAppealEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action", models.CharField(max_length=40)),
                ("note", models.TextField(blank=True, default="")),
                ("meta_json", models.TextField(blank=True, default="{}")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "actor",
                    models.ForeignKey(
                        blank=True,
                        db_column="actor_id",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="core.appuser",
                    ),
                ),
                (
                    "appeal",
                    models.ForeignKey(
                        db_column="appeal_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        to="core.banappeal",
                    ),
                ),
            ],
            options={"db_table": "ban_appeal_events"},
        ),
        migrations.AddIndex(
            model_name="banappealevent",
            index=models.Index(fields=["appeal", "created_at"], name="ban_appeal_appeal__7ee220_idx"),
        ),
    ]
