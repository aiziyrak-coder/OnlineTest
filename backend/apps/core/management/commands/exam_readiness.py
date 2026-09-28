"""Imtihon kuniga tayyorlikni bir buyruq bilan tekshiradi.

Har imtihon oldidan bir xil narsalar qo'lda tekshirilardi: oyna ochiqmi, kimga
ruxsat berilgan, profil rasmi bormi, PIN kerakmi, savol banki yetadimi, AI
ishlayaptimi. Endi hammasi bitta joyda:

    python manage.py exam_readiness                # bugun
    python manage.py exam_readiness --date 25.09.2026
    python manage.py exam_readiness --exam 561 562

Muammo topilsa buyruq 1 kod bilan tugaydi (skriptlarda ishlatish uchun).
"""
import datetime
import json

from django.core.management.base import BaseCommand
from django.utils import timezone as tz

from apps.core.models import AppUser, Exam, StudentExam


class Command(BaseCommand):
    help = "Imtihon kuniga tayyorlikni tekshiradi (oyna, ruxsat, rasm, bank, PIN, ilova)."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="KK.OO.YYYY (standart: bugun)")
        parser.add_argument("--exam", nargs="*", type=int, help="Faqat shu imtihonlar")
        parser.add_argument("--quiet", action="store_true", help="Faqat muammolarni ko'rsat")

    def handle(self, *args, **opts):
        problems = []
        warn = []
        if opts.get("exam"):
            exams = list(Exam.objects.filter(id__in=opts["exam"]))
            title = "tanlangan imtihonlar"
        else:
            if opts.get("date"):
                d = datetime.datetime.strptime(opts["date"], "%d.%m.%Y").date()
            else:
                d = tz.localtime().date()
            start = tz.make_aware(datetime.datetime.combine(d, datetime.time.min))
            end = tz.make_aware(datetime.datetime.combine(d, datetime.time.max))
            exams = list(Exam.objects.filter(start_time__lte=end, end_time__gte=start))
            title = d.strftime("%d.%m.%Y")

        self.stdout.write("IMTIHON TAYYORLIGI — %s (tekshiruv: %s)"
                          % (title, tz.localtime().strftime("%d.%m.%Y %H:%M")))
        if not exams:
            self.stdout.write("  Bu sanada imtihon yo'q.")
            return

        from apps.api.desktop_guard import desktop_min_version, desktop_required
        from apps.api.openai_client import api_key_configured
        from apps.api.proctor_exam_retake import (
            exam_auto_retake_all, exam_identity_retakes_allowed, exam_is_remote,
            exam_violation_retakes_allowed,
        )

        total_people = 0
        for e in sorted(exams, key=lambda x: (x.start_time or tz.now(), x.id)):
            ses = list(StudentExam.objects.filter(exam_id=e.id, access_granted=True).select_related("student"))
            bank = len(json.loads(e.questions_json or "[]"))
            need = int(e.bank_question_count or 0)
            ai = int(e.ai_question_count or 0)
            pending = [s for s in ses if (s.status or "") == "Pending"]
            no_photo = [s for s in ses if not (s.student.profile_image and len(s.student.profile_image) > 50)]
            blocked = [s for s in ses if (s.student.status or "") != "Active"]
            total_people += len(ses)
            self.stdout.write("\n[%s] %s" % (e.id, e.title[:70]))
            self.stdout.write("   oyna: %s - %s | davomiyligi %s daq | savol %s (bank %s, AI %s) | o'tish %s%%"
                              % (tz.localtime(e.start_time).strftime("%d.%m.%Y %H:%M") if e.start_time else "-",
                                 tz.localtime(e.end_time).strftime("%d.%m.%Y %H:%M") if e.end_time else "-",
                                 e.duration_minutes, need, bank, ai, e.pass_percent))
            self.stdout.write("   PIN: %s | uydan: %s | avto qayta urinish: %s+%s%s | ruxsat: %d kishi (kutilmoqda %d)"
                              % (e.test_center_pin or "yo'q", "ha" if exam_is_remote(e) else "yo'q",
                                 exam_violation_retakes_allowed(e), exam_identity_retakes_allowed(e),
                                 " (har qanday sababga)" if exam_auto_retake_all(e) else "",
                                 len(ses), len(pending)))
            if not ses:
                warn.append("[%s] hech kimga ruxsat berilmagan" % e.id)
            # Savollari imtihon paytida tuziladigan rejimlar (vacancy_ai, bank_mixed,
            # imentor_mixed, faculty_ai_books) uchun `questions_json` bo'sh bo'lishi normal —
            # ular bankni kafedra/AI manbasidan oladi. Faqat tayyor bankli imtihon tekshiriladi.
            if str(e.exam_mode or "static") in ("static", "") and bank < max(need, 1):
                problems.append("[%s] savol banki yetarli emas: %d < %d" % (e.id, bank, need))
            if ai and not api_key_configured():
                warn.append("[%s] AI savollar so'ralgan, lekin AI kaliti sozlanmagan" % e.id)
            if no_photo:
                problems.append("[%s] profil rasmi yo'q: %d kishi (%s)"
                                % (e.id, len(no_photo), ", ".join(s.student.name[:22] for s in no_photo[:3])))
            if blocked:
                problems.append("[%s] hisobi faol emas: %d kishi" % (e.id, len(blocked)))
            if e.end_time and e.start_time and (e.end_time - e.start_time).total_seconds() < (e.duration_minutes or 0) * 60:
                problems.append("[%s] oyna imtihon davomiyligidan qisqa" % e.id)
            if e.test_center_pin and exam_is_remote(e):
                warn.append("[%s] PIN ham, 'uydan' belgisi ham qo'yilgan — PIN e'tiborga olinmaydi" % e.id)

        self.stdout.write("\nUMUMIY: %d imtihon, %d ta ruxsat" % (len(exams), total_people))
        self.stdout.write("Ilova: majburiy=%s, eng kam versiya=%s | AI kaliti: %s"
                          % (desktop_required(), desktop_min_version() or "-",
                             "bor" if api_key_configured() else "yo'q"))
        running = StudentExam.objects.filter(status="In Progress").count()
        if running:
            self.stdout.write("Hozir imtihonda: %d kishi" % running)

        for w in warn:
            self.stdout.write("OGOHLANTIRISH: " + w)
        for p in problems:
            self.stdout.write("MUAMMO: " + p)
        if problems:
            self.stdout.write("\nTAYYOR EMAS — yuqoridagi muammolarni hal qiling.")
            raise SystemExit(1)
        self.stdout.write("\nHAMMASI TAYYOR.")
