"""Boshlang‘ich: ResultIdCounter, daraja, guruh, admin (muhit orqali parol)."""
import os

import bcrypt
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.core.models import AppUser, Group, Level, ResultIdCounter


class Command(BaseCommand):
    help = (
        "Minimal seed: counter, level, guruh, admin. "
        "DEBUG=1: ADMIN_BOOTSTRAP_PASSWORD ixtiyoriy (standart fjsti123). "
        "DEBUG=0: ADMIN_BOOTSTRAP_PASSWORD majburiy, kamida 12 belgi."
    )

    def _ensure_fjsti_admin(self, group_id: int | None) -> None:
        aid = (os.environ.get("ADMIN_BOOTSTRAP_ID") or "fjstiadmin").strip()[:64]
        raw_env = (os.environ.get("ADMIN_BOOTSTRAP_PASSWORD") or "").strip()
        if settings.DEBUG:
            raw = raw_env or "fjsti123"
            min_len = 6
        else:
            raw = raw_env
            min_len = 12
            if not raw:
                raise CommandError(
                    "Production (DEBUG=0): ADMIN_BOOTSTRAP_PASSWORD muhitda majburiy (kamida 12 belgi). "
                    "Standart parol ishlatilmaydi."
                )
        if len(aid) < 2:
            raise CommandError("ADMIN_BOOTSTRAP_ID juda qisqa.")
        if len(raw) < min_len:
            raise CommandError(
                f"ADMIN_BOOTSTRAP_PASSWORD kamida {min_len} belgi bo‘lsin"
                + (" (production)." if not settings.DEBUG else ".")
            )
        h = bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
        u, created = AppUser.objects.get_or_create(
            id=aid,
            defaults={
                "password": h,
                "role": "admin",
                "name": "Administrator",
                "status": "Active",
                "group_id": group_id,
                "profile_image": "",
            },
        )
        if created:
            hint = (
                "Parol: ADMIN_BOOTSTRAP_PASSWORD (muhit)."
                if not settings.DEBUG
                else "Parol: ADMIN_BOOTSTRAP_PASSWORD yoki (o‘rnatilmagan bo‘lsa) mahalliy standart fjsti123."
            )
            self.stdout.write(self.style.SUCCESS(f"Admin yaratildi: ID «{aid}». {hint}"))
            return
        fix: list[str] = []
        if u.role != "admin":
            u.role = "admin"
            fix.append("role")
        if fix:
            u.save(update_fields=fix)
            self.stdout.write(self.style.SUCCESS(f"Mavjud foydalanuvchi «{aid}» admin roliga moslashtirildi."))
        else:
            self.stdout.write(self.style.WARNING(f"«{aid}» allaqachon bor — parol o‘zgartirilmadi (xavfsizlik)."))

    def handle(self, *args, **options):
        ResultIdCounter.objects.get_or_create(pk=1, defaults={"next_num": 37923423})
        level, _ = Level.objects.get_or_create(name="Asosiy")
        g, _ = Group.objects.get_or_create(name="1-guruh", level=level)
        gid = g.id

        self._ensure_fjsti_admin(gid)
