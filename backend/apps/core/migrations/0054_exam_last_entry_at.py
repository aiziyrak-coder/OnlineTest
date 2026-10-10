from django.db import migrations, models


class Migration(migrations.Migration):
    """Imtihonga "oxirgi kirish vaqti" maydoni.

    Shundan keyin yangi sessiya boshlanmaydi, boshlangani davom etadi.
    """

    dependencies = [("core", "0053_passport_login")]

    operations = [
        migrations.AddField(
            model_name="exam",
            name="last_entry_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
