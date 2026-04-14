"""Platforma (SPA) admini: parolni bcrypt bilan o‘rnatish yoki foydalanuvchini yaratish.

Faqat serverda SSH orqali ishlating; parolni repoga yozmaymiz.

Misol:
  python3 manage.py reset_platform_admin --id adminfjsti --password 'fjsti123'
"""

import bcrypt
from django.core.management.base import BaseCommand, CommandError

from apps.core.models import AppUser, Group


def _hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


class Command(BaseCommand):
    help = "AppUser admin: ID va parolni o‘rnatadi (kirish /api/auth/login uchun)."

    def add_arguments(self, parser):
        parser.add_argument("--id", dest="user_id", required=True, help="Foydalanuvchi ID (masalan adminfjsti)")
        parser.add_argument("--password", required=True, help="Yangi parol")

    def handle(self, *args, **options):
        uid = (options["user_id"] or "").strip()[:64]
        raw = options["password"] or ""
        if len(uid) < 2:
            raise CommandError("ID kamida 2 belgi bo‘lishi kerak.")
        if len(raw) < 6:
            raise CommandError("Parol kamida 6 belgi bo‘lsin.")

        first_group = Group.objects.order_by("id").first()
        gid = first_group.id if first_group else None

        h = _hash_pw(raw)
        u, created = AppUser.objects.update_or_create(
            id=uid,
            defaults={
                "password": h,
                "role": "admin",
                "name": "Administrator",
                "status": "Active",
                "group_id": gid,
                "profile_image": "",
            },
        )
        action = "Yaratildi" if created else "Yangilandi"
        self.stdout.write(self.style.SUCCESS(f"{action}: admin «{uid}» (rol: admin, holat: Active)."))
