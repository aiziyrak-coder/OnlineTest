"""Har bir topshiruvchiga savol to'plamini OLDINDAN tayyorlaydi.

Imtihon boshlanganda savol tanlash (ba'zi rejimlarda AI chaqiruvi ham)
bo'lardi — eng kritik daqiqada, yuz kishi bir vaqtda kirganda. Bu buyruq
to'plamlarni imtihondan oldin yig'ib navbatga qo'yadi:

  * har kishiga boshqa savollar, bank bo'ylab teng taqsimlanadi;
  * bir odamning urinishlarida umumiy savol yo'q (2-urinish butunlay yangi);
  * savollar tartibi ham, har savolning javoblari tartibi ham aralashtiriladi;
  * qayta ruxsat berilganda navbatdagi tayyor to'plam olinadi.

    python manage.py prepare_exam_variants --season "2-kurs ordinatura 2-imkoniyat"
    python manage.py prepare_exam_variants --season "..." --attempts 3 --apply
    python manage.py prepare_exam_variants --exam 570 571 --apply --force

Boshlangan yoki topshirilgan sessiyaga TEGILMAYDI (--force ham tegmaydi):
imtihon ustida ishlayotgan odamning savollari o'zgarmasligi kerak.
"""
from __future__ import annotations

import json
import random
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.api.exam_variants import build_variants, question_key, set_prepared
from apps.core.models import AuditLog, Exam, StudentExam


class Command(BaseCommand):
    help = "Topshiruvchilarga savol to'plamlarini oldindan tayyorlaydi."

    def add_arguments(self, parser):
        parser.add_argument("--season", help="Mavsum nomi (Exam.season)")
        parser.add_argument("--exam", nargs="*", type=int, help="Imtihon raqamlari")
        parser.add_argument("--attempts", type=int, default=2,
                            help="Har kishiga nechta to'plam (standart: 2)")
        parser.add_argument("--seed", type=int, help="Takrorlanadigan tasodif (sinov uchun)")
        parser.add_argument("--force", action="store_true",
                            help="Tayyorlangan to'plamlarni qaytadan yig'adi")
        parser.add_argument("--apply", action="store_true", help="Haqiqatan yozish")

    def handle(self, *args, **opts):
        season = (opts.get("season") or "").strip()
        exam_ids = opts.get("exam") or []
        if not season and not exam_ids:
            raise CommandError("--season yoki --exam kerak")
        attempts = max(1, int(opts["attempts"]))
        apply = bool(opts["apply"])
        force = bool(opts["force"])
        rnd = random.Random(opts.get("seed"))

        exams = Exam.objects.filter(season=season) if season else Exam.objects.filter(id__in=exam_ids)
        exams = list(exams.order_by("id"))
        if not exams:
            raise CommandError("Imtihon topilmadi")

        self.stdout.write("Imtihonlar: %d | har kishiga %d to'plam | rejim: %s"
                          % (len(exams), attempts, "YOZISH" if apply else "ko'rish"))
        jami_kishi = jami_toplam = tegilmadi = yetmadi = 0
        yozuvlar: list[StudentExam] = []

        for e in exams:
            bank = [q for q in json.loads(e.questions_json or "[]") if isinstance(q, dict)]
            need = int(e.bank_question_count or 0)
            nom = (e.title or "").split("—")[-1].split("(")[0].strip()[:38]
            if not need or not bank:
                self.stdout.write(self.style.WARNING(
                    "   [%s] %-38s o'tkazib yuborildi (bank %d, kerak %d)"
                    % (e.id, nom, len(bank), need)))
                continue
            ses = list(
                StudentExam.objects.filter(exam_id=e.id, access_granted=True)
                .select_related("student").order_by("student_id")
            )
            if not ses:
                continue
            usage: Counter = Counter()
            # Mavjud to'plamlar ham hisobga olinadi — qaytadan yig'ilmaydigan
            # odamlarning savollari boshqalarga kam tushishi uchun.
            for se in ses:
                for q in json.loads(se.session_questions_json or "[]") or []:
                    if isinstance(q, dict):
                        usage[question_key(q)] += 1
            kishi = toplam = 0
            for se in ses:
                band = (se.status or "").strip() not in ("", "Pending") or se.started_at
                if band:
                    tegilmadi += 1
                    continue
                if se.session_questions_json and not force:
                    tegilmadi += 1
                    continue
                avoid = set()
                for x in json.loads(se.served_question_ids or "[]") or []:
                    try:
                        avoid.add(int(x))
                    except (TypeError, ValueError):
                        continue
                variants = build_variants(bank, need, attempts, usage=usage, rnd=rnd, avoid=avoid)
                if any(len(v) < need for v in variants):
                    yetmadi += 1
                se.session_questions_json = json.dumps(variants[0], ensure_ascii=False)
                set_prepared(se, variants[1:])
                ids = sorted({question_key(q) for v in variants for q in v
                              if isinstance(question_key(q), int)} | avoid)
                se.served_question_ids = json.dumps(ids)
                yozuvlar.append(se)
                kishi += 1
                toplam += len(variants)
            jami_kishi += kishi
            jami_toplam += toplam
            # Bank qanchalik teng ishlatilgani: bir savol necha kishiga tushgan.
            if kishi:
                vals = [usage[question_key(q)] for q in bank]
                self.stdout.write(
                    "   [%s] %-38s %3d kishi × %d to'plam | bank %4d | bir savol %d-%d marta"
                    % (e.id, nom, kishi, attempts, len(bank), min(vals), max(vals)))

        self.stdout.write("")
        self.stdout.write("Tayyorlanadi: %d kishi, %d to'plam | tegilmaydi: %d"
                          % (jami_kishi, jami_toplam, tegilmadi))
        if yetmadi:
            self.stdout.write(self.style.WARNING(
                "   %d kishida bank yetmadi — eski savollar qayta ishlatildi" % yetmadi))
        if not apply:
            self.stdout.write(self.style.WARNING("Ko'rish rejimi — yozish uchun --apply"))
            return
        with transaction.atomic():
            for se in yozuvlar:
                se.save(update_fields=["session_questions_json", "prepared_variants_json",
                                       "served_question_ids"])
            AuditLog.objects.create(
                actor_id="", actor_name="prepare_exam_variants", action="update_exam",
                target_type="exam", target_id=",".join(str(e.id) for e in exams)[:128],
                target_name=season or "imtihon variantlari",
                detail="Oldindan tayyorlangan to'plamlar: %d kishi, %d to'plam (har kishiga %d). "
                       "Imtihon boshlanganda savol tanlanmaydi." % (jami_kishi, jami_toplam, attempts),
            )
        self.stdout.write(self.style.SUCCESS("BAJARILDI: %d kishi" % jami_kishi))
