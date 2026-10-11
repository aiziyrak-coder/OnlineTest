"""Eski ekran/kamera kadrlarini tozalaydi.

Kadrlar imtihon davomida har ~20 soniyada saqlanadi va bazaning asosiy
hajmini egallaydi (11.10.2026: 1520 MB / 1776 MB — 86%). Hech qanday
tozalash tartibi yo'q edi, ya'ni baza cheksiz o'sardi va zaxira olish
ham shunchalik qimmatlashardi.

DALIL YO'QOLMASIN degan qoida: qoida buzilishi vaqtiga yaqin kadrlar va
har bir sessiyadan oxirgi bir nechta kadr HAR DOIM saqlanadi — chetlatish
va apellyatsiya aynan shularga tayanadi.

    python manage.py prune_snapshots                  # faqat ko'rsatadi
    python manage.py prune_snapshots --apply
    python manage.py prune_snapshots --days 30 --apply
"""
from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone as tz

from apps.core.models import ScreenSnapshot, StudentExam, ViolationLog

CHUNK = 2000


class Command(BaseCommand):
    help = "Eski ekran/kamera kadrlarini o'chiradi (dalillarni saqlab)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=60,
                            help="Shu kundan eski kadrlar nomzod (standart: 60)")
        parser.add_argument("--keep-per-session", type=int, default=4,
                            help="Har sessiyadan saqlanadigan oxirgi kadrlar soni (standart: 4)")
        parser.add_argument("--violation-window", type=int, default=10,
                            help="Qoida buzilishidan oldin/keyin saqlanadigan daqiqa (standart: 10)")
        parser.add_argument("--apply", action="store_true", help="Haqiqatan o'chirish")

    def handle(self, *args, **opts):
        days = max(1, int(opts["days"]))
        keep_n = max(0, int(opts["keep_per_session"]))
        win = max(0, int(opts["violation_window"]))
        apply = bool(opts["apply"])
        chegara = tz.now() - timedelta(days=days)

        eski = ScreenSnapshot.objects.filter(taken_at__lt=chegara)
        jami_eski = eski.count()
        self.stdout.write("Kadrlar: jami %d | %d kundan eski: %d"
                          % (ScreenSnapshot.objects.count(), days, jami_eski))
        if not jami_eski:
            self.stdout.write(self.style.SUCCESS("Tozalashga narsa yo'q."))
            return

        saqlanadi: set[int] = set()

        # 1) Har sessiyadan oxirgi `keep_n` kadr (tur bo'yicha) qoladi.
        if keep_n:
            se_ids = list(eski.values_list("student_exam_id", flat=True).distinct())
            for i in range(0, len(se_ids), 200):
                for se_id in se_ids[i:i + 200]:
                    for kind in ("screen", "webcam", "room"):
                        saqlanadi.update(
                            ScreenSnapshot.objects.filter(student_exam_id=se_id, kind=kind)
                            .order_by("-taken_at")
                            .values_list("id", flat=True)[:keep_n]
                        )

        # 2) Qoida buzilishi atrofidagi kadrlar — dalil.
        if win:
            se_by_key = {
                (str(s["student_id"]), s["exam_id"]): s["id"]
                for s in StudentExam.objects.values("id", "student_id", "exam_id")
            }
            for v in ViolationLog.objects.filter(timestamp__lt=chegara).values(
                "student_id", "exam_id", "timestamp"
            ).iterator(chunk_size=5000):
                se_id = se_by_key.get((str(v["student_id"]), v["exam_id"]))
                if not se_id:
                    continue
                saqlanadi.update(
                    ScreenSnapshot.objects.filter(
                        student_exam_id=se_id,
                        taken_at__gte=v["timestamp"] - timedelta(minutes=win),
                        taken_at__lte=v["timestamp"] + timedelta(minutes=win),
                    ).values_list("id", flat=True)
                )

        ochiriladi = list(eski.exclude(id__in=saqlanadi).values_list("id", flat=True))
        self.stdout.write("   dalil sifatida saqlanadi: %d" % len(saqlanadi))
        self.stdout.write("   o'chiriladi: %d" % len(ochiriladi))
        kinds = (
            eski.exclude(id__in=saqlanadi).values("kind").order_by().annotate(n=Count("id"))
        )
        for k in kinds:
            self.stdout.write("      %-8s %d" % (k["kind"], k["n"]))

        if not apply:
            self.stdout.write(self.style.WARNING("Ko'rish rejimi — o'chirish uchun --apply"))
            return

        ochdi = 0
        for i in range(0, len(ochiriladi), CHUNK):
            n, _ = ScreenSnapshot.objects.filter(id__in=ochiriladi[i:i + CHUNK]).delete()
            ochdi += n
        self.stdout.write(self.style.SUCCESS("O'chirildi: %d kadr" % ochdi))
        self.stdout.write("Joy bo'shashi uchun: VACUUM (ANALYZE) screen_snapshots")
