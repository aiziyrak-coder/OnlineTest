"""Django /admin/ uchun auth.User superuser (AppUser /api/auth/login dan alohida)."""

from __future__ import annotations

import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Django admin panel (/admin/) uchun superuser yaratadi yoki parolini yangilaydi."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="", help="Standart: admin yoki DJANGO_ADMIN_USERNAME")
        parser.add_argument("--password", default="", help="DJANGO_ADMIN_PASSWORD yoki --password")
        parser.add_argument("--email", default="", help="Standart: admin@local.test")

    def handle(self, *args, **options):
        User = get_user_model()
        username = (options["username"] or os.environ.get("DJANGO_ADMIN_USERNAME") or "admin").strip()
        email = (options["email"] or os.environ.get("DJANGO_ADMIN_EMAIL") or "admin@local.test").strip()
        raw_env = (options["password"] or os.environ.get("DJANGO_ADMIN_PASSWORD") or "").strip()

        if settings.DEBUG:
            raw = raw_env or "AdminLocal123"
            min_len = 10
        else:
            raw = raw_env
            min_len = 12
            if not raw:
                if User.objects.filter(is_superuser=True).exists():
                    self.stdout.write(
                        self.style.WARNING(
                            "Production: superuser mavjud — parol o'zgartirilmadi "
                            "(DJANGO_ADMIN_PASSWORD bermasangiz xavfsizlik uchun)."
                        )
                    )
                    return
                raise CommandError(
                    "Production (DEBUG=0): DJANGO_ADMIN_PASSWORD muhitda majburiy (kamida 12 belgi)."
                )

        if len(username) < 2:
            raise CommandError("username kamida 2 belgi bo'lsin.")
        if len(raw) < min_len:
            raise CommandError(f"Parol kamida {min_len} belgi bo'lsin.")

        u, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email, "is_staff": True, "is_superuser": True},
        )
        u.email = email
        u.is_staff = True
        u.is_superuser = True
        u.set_password(raw)
        u.save()

        action = "Yaratildi" if created else "Yangilandi"
        hint = (
            "Mahalliy standart parol: AdminLocal123 (DEBUG=1)."
            if settings.DEBUG and not raw_env
            else "Parol: DJANGO_ADMIN_PASSWORD / --password."
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"{action}: Django admin «{username}» — http://127.0.0.1:8000/admin/ . {hint}"
            )
        )
