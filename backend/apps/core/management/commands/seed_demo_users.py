"""Demo foydalanuvchilar: har rol uchun bitta — admin, staff, student.

Uchchalasi bitta parol bilan SPA (/api/auth/login) orqali kira oladi.
Talabaga profil maydoni uzunligi tekshiruvidan o'tadigan placeholder beriladi.

Parol: DEMO_SEED_PASSWORD muhitda berilsa o'sha, aks holda `DemoFJSTI2026!`.
"""

from __future__ import annotations

import os

import bcrypt
from django.core.management.base import BaseCommand, CommandError

from apps.core.models import AppUser, Group, Level, ResultIdCounter


def _hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


# Talaba imtihon boshlash / API tekshiruvlari: profil satri kamida ~50 belgi
_DEMO_PROFILE_IMAGE = "data:image/png;base64," + ("A" * 80)

DEFAULT_PASSWORD = "DemoFJSTI2026!"


class Command(BaseCommand):
    help = "3 ta demo user: demo_admin, demo_staff, demo_student (bitta parol)."

    def handle(self, *args, **options):
        raw = (os.environ.get("DEMO_SEED_PASSWORD") or "").strip() or DEFAULT_PASSWORD
        if len(raw) < 10:
            raise CommandError("DEMO_SEED_PASSWORD kamida 10 belgi bo'lsin.")

        ResultIdCounter.objects.get_or_create(pk=1, defaults={"next_num": 37923423})
        level, _ = Level.objects.get_or_create(name="Asosiy")
        group, _ = Group.objects.get_or_create(name="1-guruh", level=level)
        gid = group.id
        h = _hash_pw(raw)

        # Eski `teacher` roli / demo_teacher (login rad etiladi) — seed paytida tozalaymiz.
        AppUser.objects.filter(id="demo_teacher").delete()
        AppUser.objects.filter(role="teacher").delete()

        rows: list[tuple[str, str, str, str]] = [
            ("demo_admin", "admin", "Demo administrator", ""),
            ("demo_staff", "staff", "Demo hodim (kuzatuvchi)", ""),
            ("demo_student", "student", "Demo talaba", _DEMO_PROFILE_IMAGE),
        ]

        for uid, role, name, profile in rows:
            user, created = AppUser.objects.get_or_create(
                id=uid,
                defaults={
                    "password": h,
                    "role": role,
                    "name": name,
                    "status": "Active",
                    "group_id": gid,
                    "profile_image": profile,
                },
            )
            if created:
                continue

            # Mavjud demo userlarni yangilash — lekin admin panelda o'rnatilgan
            # profil rasmini har restartda placeholder bilan ustiga yozmaymiz.
            user.password = h
            user.role = role
            user.name = name
            user.status = "Active"
            user.group_id = gid
            if profile and not (user.profile_image and len(user.profile_image) > 50):
                user.profile_image = profile
            user.save(
                update_fields=["password", "role", "name", "status", "group_id", "profile_image"]
            )

        self.stdout.write(self.style.SUCCESS("3 ta demo user tayyor (bitta parol):"))
        self.stdout.write("")
        self.stdout.write("  ID            | Rol     | Parol")
        self.stdout.write("  --------------+---------+----------------")
        self.stdout.write(f"  demo_admin    | admin   | {raw}")
        self.stdout.write(f"  demo_staff    | staff   | {raw}")
        self.stdout.write(f"  demo_student  | student | {raw}")
