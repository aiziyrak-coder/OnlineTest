"""Boshlang‘ich: ResultIdCounter, daraja, guruh, admin va demo talaba."""
import os

import bcrypt
from django.core.management.base import BaseCommand

from apps.core.models import AppUser, Group, Level, ResultIdCounter

# Login / imtihon boshlash uchun profil rasmi maydoni kamida 50 belgi (1x1 jpeg fragmenti).
_DEMO_PROFILE_IMAGE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
    "2wBDAQwSERMWGR8lJx8lPz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09P//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
)


class Command(BaseCommand):
    help = "Minimal seed: counter, level, group, admin (ADMIN_BOOTSTRAP_PASSWORD yoki admin123), demo talaba (student / student123)"

    def _ensure_demo_student(self, group):
        raw = os.environ.get("DEMO_STUDENT_PASSWORD", "student123")
        if len(raw) < 6:
            self.stderr.write("DEMO_STUDENT_PASSWORD kamida 6 belgi bo‘lsin.")
            return
        h = bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
        gid = group.id if group else None
        stu, created = AppUser.objects.get_or_create(
            id="student",
            defaults={
                "password": h,
                "role": "student",
                "name": "Demo talaba",
                "status": "Active",
                "group_id": gid,
                "profile_image": _DEMO_PROFILE_IMAGE,
            },
        )
        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    "Demo talaba yaratildi: ID student, parol DEMO_STUDENT_PASSWORD (env) yoki student123."
                )
            )
            return
        fix: list[str] = []
        if not stu.profile_image or len(str(stu.profile_image)) < 50:
            stu.profile_image = _DEMO_PROFILE_IMAGE
            fix.append("profile_image")
        if stu.role != "student":
            stu.role = "student"
            fix.append("role")
        if gid and stu.group_id != gid:
            stu.group_id = gid
            fix.append("group_id")
        if fix:
            stu.save(update_fields=fix)
            self.stdout.write(self.style.SUCCESS(f"Demo talaba yangilandi: {', '.join(fix)}"))

    def handle(self, *args, **options):
        ResultIdCounter.objects.get_or_create(pk=1, defaults={"next_num": 37923423})
        level, _ = Level.objects.get_or_create(name="Asosiy")
        g, _ = Group.objects.get_or_create(name="1-guruh", level=level)
        first_group = Group.objects.first()

        if AppUser.objects.filter(role="admin").exists():
            self.stdout.write(self.style.WARNING("Admin allaqachon bor — admin yaratish o‘tkazildi."))
        else:
            raw = os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
            if len(raw) < 6:
                self.stderr.write("ADMIN_BOOTSTRAP_PASSWORD kamida 6 belgi bo‘lsin.")
                self._ensure_demo_student(g)
                return
            h = bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
            AppUser.objects.create(
                id="admin",
                password=h,
                role="admin",
                name="Administrator",
                status="Active",
                group_id=first_group.id if first_group else None,
                profile_image="",
            )
            self.stdout.write(
                self.style.SUCCESS(
                    "admin yaratildi (ID: admin). Parol: ADMIN_BOOTSTRAP_PASSWORD (env) yoki standart admin123 — "
                    "productionda /etc/onlinetest/api.env yoki /root/onlinetest-admin-once.txt ni tekshiring."
                )
            )

        self._ensure_demo_student(g)
