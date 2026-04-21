"""Demo foydalanuvchilar: admin, student, teacher (teacher SPA login qo‘llab-quvvatlanmaydi).

Talaba uchun profil maydoni uzunligi tekshiruvidan o‘tadigan placeholder beriladi (rasm emas).

Mahalliy (DEBUG=1): parol ixtiyoriy; berilmasa standart `DemoFJSTI2026!` (12 belgi).
Production (DEBUG=0): `DEMO_SEED_PASSWORD` muhitda majburiy, kamida 12 belgi.

Misol:
  python manage.py seed_demo_users
  DEMO_SEED_PASSWORD='o‘z-parolingiz-12+' python manage.py seed_demo_users
"""

from __future__ import annotations

import os

import bcrypt
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.core.models import AppUser, Group, Level, ResultIdCounter


def _hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


# Talaba imtihon boshlash / API tekshiruvlari: profil satri kamida ~50 belgi
_DEMO_PROFILE_IMAGE = "data:image/png;base64," + ("A" * 80)


class Command(BaseCommand):
    help = "demo_admin, demo_student, demo_teacher — bitta parol (muhit yoki DEBUG standarti)."

    def handle(self, *args, **options):
        raw_env = (os.environ.get("DEMO_SEED_PASSWORD") or "").strip()
        if settings.DEBUG:
            raw = raw_env or "DemoFJSTI2026!"
            min_len = 10
        else:
            raw = raw_env
            min_len = 12
            if not raw:
                raise CommandError(
                    "Production (DEBUG=0): DEMO_SEED_PASSWORD muhitda majburiy (kamida 12 belgi)."
                )
        if len(raw) < min_len:
            raise CommandError(f"DEMO_SEED_PASSWORD kamida {min_len} belgi bo‘lsin.")

        ResultIdCounter.objects.get_or_create(pk=1, defaults={"next_num": 37923423})
        level, _ = Level.objects.get_or_create(name="Asosiy")
        group, _ = Group.objects.get_or_create(name="1-guruh", level=level)
        gid = group.id
        h = _hash_pw(raw)

        rows: list[tuple[str, str, str, int | None, str]] = [
            ("demo_admin", "admin", "Demo administrator", gid, ""),
            ("demo_student", "student", "Demo talaba", gid, _DEMO_PROFILE_IMAGE),
            ("demo_teacher", "teacher", "Demo o‘qituvchi (faqat DB)", gid, ""),
        ]

        for uid, role, name, group_id, profile in rows:
            AppUser.objects.update_or_create(
                id=uid,
                defaults={
                    "password": h,
                    "role": role,
                    "name": name,
                    "status": "Active",
                    "group_id": group_id,
                    "profile_image": profile,
                },
            )

        self.stdout.write(self.style.SUCCESS("Demo foydalanuvchilar yangilandi (parol bir xil)."))
        self.stdout.write("")
        self.stdout.write("  ID              | Rol      | SPA login")
        self.stdout.write("  ----------------+----------+----------------------------------")
        self.stdout.write("  demo_admin      | admin    | Ha")
        self.stdout.write("  demo_student    | student  | Ha (imtihon uchun admin sozlaydi)")
        self.stdout.write("  demo_teacher    | teacher  | Yo'q (SPA /api/auth/login 403)")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Production da keyin parollarni o‘zgartiring yoki foydalanuvchilarni o‘chiring."))
