# Generated manually — yagona test baza, kurs/dastur, tarjimalar

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_studentexam_draft_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="group",
            name="program_track",
            field=models.CharField(default="bachelor", max_length=20),
        ),
        migrations.AddField(
            model_name="group",
            name="academic_year",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="testbankcategory",
            name="program_track",
            field=models.CharField(default="any", max_length=20),
        ),
        migrations.AddField(
            model_name="testbankcategory",
            name="academic_year",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="testbankcategory",
            name="source_language",
            field=models.CharField(default="en", max_length=10),
        ),
        migrations.AddField(
            model_name="testbankquestion",
            name="text_uz",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="testbankquestion",
            name="text_ru",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="testbankquestion",
            name="options_uz_json",
            field=models.TextField(blank=True, default="[]"),
        ),
        migrations.AddField(
            model_name="testbankquestion",
            name="options_ru_json",
            field=models.TextField(blank=True, default="[]"),
        ),
        migrations.AddField(
            model_name="testbankquestion",
            name="correct_answer_uz",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="testbankquestion",
            name="correct_answer_ru",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AlterField(
            model_name="testbankquestion",
            name="language",
            field=models.CharField(default="en", max_length=10),
        ),
    ]
