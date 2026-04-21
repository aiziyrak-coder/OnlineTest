"""Barcha AppUser va ularga bog‘liq yozuvlarni o‘chirib, yagona admin qoldiradi.

O‘chiriladi: unban dalillari, qonunbuzarliklar, student_exams, imtihon istisnolari,
qayta topshirish oynalari, exam_groups, exams (barcha imtihonlar).

Saqlanadi: levels, groups, test bank, result_id_sequence.

Standart: ID «admin», parol «fjsti123». Boshqa qiymat: --id va --password.

Faqat serverda, ehtiyotkorlik bilan:
  python manage.py reset_single_admin --yes
"""

from __future__ import annotations

import bcrypt
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.models import (
    AppUser,
    Exam,
    ExamGroup,
    ExamRetakeWindow,
    ExamStudentException,
    StudentExam,
    UnbanEvidence,
    ViolationLog,
)


class Command(BaseCommand):
    help = "Barcha foydalanuvchilarni va ularning imtihon/natija yozuvlarini o‘chiradi; faqat admin qoldiradi."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Tasdiq: ma’lumotlar yo‘qolishini qabul qilaman.",
        )
        parser.add_argument("--id", dest="admin_id", default="admin", help="Yagona admin ID (standart: admin)")
        parser.add_argument(
            "--password",
            default="fjsti123",
            help="Admin paroli (standart: fjsti123; kamida 6 belgi)",
        )

    def handle(self, *args, **options):
        if not options["yes"]:
            raise CommandError(
                "Bu operatsiya barcha foydalanuvchi va imtihonlarni o‘chiradi. "
                "Davom etish uchun: python manage.py reset_single_admin --yes"
            )

        admin_id = (options["admin_id"] or "").strip()[:64]
        raw_pw = options["password"] or ""
        if len(admin_id) < 2:
            raise CommandError("Admin ID kamida 2 belgi bo‘lsin.")
        if len(raw_pw) < 6:
            raise CommandError("Parol kamida 6 belgi bo‘lsin.")

        h = bcrypt.hashpw(raw_pw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")

        with transaction.atomic():
            UnbanEvidence.objects.all().delete()
            ViolationLog.objects.all().delete()
            StudentExam.objects.all().delete()
            ExamStudentException.objects.all().delete()
            ExamRetakeWindow.objects.all().delete()
            ExamGroup.objects.all().delete()
            Exam.objects.all().delete()
            AppUser.objects.all().delete()

            AppUser.objects.create(
                id=admin_id,
                password=h,
                role="admin",
                name="Administrator",
                status="Active",
                group_id=None,
                profile_image="",
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Tayyor: barcha foydalanuvchilar o‘chirildi. Kirish: ID «{admin_id}», parol — berilgan qiymat."
            )
        )
