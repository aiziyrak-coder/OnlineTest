"""AppUser «superadmin» (rol: admin) — parolni xavfsiz berish.

Parol muhitdan yoki flag orqali (serverda bir marta):

  export SUPERADMIN_PASSWORD='kuchli-parol-min-12'
  python manage.py ensure_superadmin

Yoki:

  python manage.py ensure_superadmin --password 'kuchli-parol'

Aslida reset_platform_admin ni chaqiradi (ma'lumotlar o'chilmaydi).
"""

from __future__ import annotations

import os

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "superadmin (yoki boshqa ID) — admin AppUser yaratadi/yangilaydi."

    def add_arguments(self, parser):
        parser.add_argument(
            "--id",
            dest="user_id",
            default="superadmin",
            help="Kirish ID (standart: superadmin)",
        )
        parser.add_argument(
            "--password",
            default="",
            help="Bo'sh bo'lsa SUPERADMIN_PASSWORD muhitidan olinadi",
        )

    def handle(self, *args, **options):
        uid = (options["user_id"] or "superadmin").strip()[:64]
        raw = (options["password"] or os.environ.get("SUPERADMIN_PASSWORD") or "").strip()
        if len(uid) < 2:
            raise CommandError("ID kamida 2 belgi bo'lsin.")
        if len(raw) < 6:
            raise CommandError(
                "Parol kamida 6 belgi. SUPERADMIN_PASSWORD muhitida yoki --password bilan bering."
            )
        call_command("reset_platform_admin", user_id=uid, password=raw)
        self.stdout.write(
            self.style.SUCCESS(
                f"Tayyor: «{uid}» admin sifatida saqlandi. Kirish: /api/auth/login (ID + parol)."
            )
        )
