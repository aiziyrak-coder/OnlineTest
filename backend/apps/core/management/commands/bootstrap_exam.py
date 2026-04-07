"""Boshlang‘ich: ResultIdCounter, daraja, guruh, admin (fjstiadmin / fjsti123)."""
import os

import bcrypt
from django.core.management.base import BaseCommand

from apps.core.models import AppUser, Group, Level, ResultIdCounter


class Command(BaseCommand):
    help = "Minimal seed: counter, level, guruh, admin (ADMIN_BOOTSTRAP_ID/ADMIN_BOOTSTRAP_PASSWORD, standart fjstiadmin / fjsti123)"

    def _ensure_fjsti_admin(self, group_id: int | None) -> None:
        aid = (os.environ.get("ADMIN_BOOTSTRAP_ID") or "fjstiadmin").strip()[:64]
        raw = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD") or "fjsti123"
        if len(aid) < 2:
            self.stderr.write("ADMIN_BOOTSTRAP_ID juda qisqa.")
            return
        if len(raw) < 6:
            self.stderr.write("ADMIN_BOOTSTRAP_PASSWORD kamida 6 belgi bo‘lsin.")
            return
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
            self.stdout.write(
                self.style.SUCCESS(
                    f"Admin yaratildi: ID «{aid}». Parol: muhit o‘zgaruvchisi ADMIN_BOOTSTRAP_PASSWORD yoki standart fjsti123."
                )
            )
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
