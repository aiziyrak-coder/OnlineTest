"""Boshlang‘ich: ResultIdCounter, daraja, guruh, admin foydalanuvchi."""
from django.core.management.base import BaseCommand

from apps.core.models import AppUser, Group, Level, ResultIdCounter


class Command(BaseCommand):
    help = "Minimal seed: counter, level, group, admin (parol env ADMIN_BOOTSTRAP_PASSWORD yoki 'admin123')"

    def handle(self, *args, **options):
        import os
        import bcrypt

        ResultIdCounter.objects.get_or_create(pk=1, defaults={"next_num": 37923423})
        level, _ = Level.objects.get_or_create(name="Asosiy")
        Group.objects.get_or_create(name="1-guruh", level=level)
        if AppUser.objects.filter(role="admin").exists():
            self.stdout.write(self.style.WARNING("Admin allaqachon bor — o‘tkazib yuborildi."))
            return
        raw = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
        if len(raw) < 6:
            self.stderr.write("ADMIN_BOOTSTRAP_PASSWORD kamida 6 belgi bo‘lsin.")
            return
        h = bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
        g = Group.objects.first()
        AppUser.objects.create(
            id="admin",
            password=h,
            role="admin",
            name="Administrator",
            status="Active",
            group_id=g.id if g else None,
            profile_image="",
        )
        self.stdout.write(
            self.style.SUCCESS(
                "admin yaratildi (ID: admin). Parol: ADMIN_BOOTSTRAP_PASSWORD (env) yoki standart admin123 — "
                "productionda /etc/onlinetest/api.env yoki /root/onlinetest-admin-once.txt ni tekshiring."
            )
        )
