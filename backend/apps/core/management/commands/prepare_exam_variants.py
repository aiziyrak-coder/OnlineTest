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
import re
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.api.exam_variants import build_variants, question_key, set_prepared
from apps.api.usmle_screen import usmle_score
from apps.core.models import AuditLog, Exam, StudentExam, TestBankCategory, TestBankQuestion


def _norm_subject(s: str) -> str:
    """Fan nomini taqqoslash uchun tekislaydi.

    Banklarda bir fan turlicha yozilgan: "Laboratoriya ish" / "Laboratoriya
    ishi", "Neonatologiya" / "Neonatalogiya", "Yuz jag' jarroxligi" /
    "Yuz-jag' xirurgiyasi". Oxirgi harflar va tinish belgilari tashlab
    yuboriladi, shunda bir fanning to'plamlari topiladi.
    """
    t = re.sub(r"[^a-zЀ-ӿ ]+", " ", str(s or "").lower().replace("'", ""))
    t = re.sub(r"\s+", " ", t).strip()
    return t[:14]


def _as_exam_q(row: TestBankQuestion) -> dict:
    opts = json.loads(row.options_uz_json or row.options_json or "[]")
    q = {
        "bank_id": row.id,
        "source_id": row.id,
        "text": row.text_uz or row.text,
        "options": [str(o) for o in opts],
        "correctAnswer": row.correct_answer_uz or row.correct_answer,
    }
    for lang in ("ru", "en"):
        t = getattr(row, "text_%s" % lang, "") or ""
        if t:
            q["text_%s" % lang] = t
            o = json.loads(getattr(row, "options_%s_json" % lang, "") or "[]")
            if isinstance(o, list) and len(o) == len(q["options"]):
                q["options_%s" % lang] = [str(x) for x in o]
    return q


def _base_pool(e: Exam, merge_courses: bool) -> tuple[list[dict], str]:
    """Markaziy bazadan shu imtihonga mos savollar."""
    from apps.core.management.commands.migrate_banks_to_base import category_name, subject_of

    fan = subject_of(e)
    nom = category_name(fan, str(e.audience or ""), int(e.course or 0))
    cats = list(TestBankCategory.objects.filter(name=nom))
    if merge_courses:
        kalit = _norm_subject(fan)
        for c in TestBankCategory.objects.all():
            if c.id in [x.id for x in cats]:
                continue
            # Bir fanning boshqa kursi / boshqa yozilishi.
            if _norm_subject(c.name.split("—")[0]) == kalit:
                cats.append(c)
    if not cats:
        return [], "bazada to'plam yo'q"
    rows = TestBankQuestion.objects.filter(category_id__in=[c.id for c in cats])
    out = [_as_exam_q(r) for r in rows]
    out = [q for q in out if q["text"] and q["correctAnswer"] in q["options"]]
    return out, "baza: %d to'plam" % len(cats)


class Command(BaseCommand):
    help = "Topshiruvchilarga savol to'plamlarini oldindan tayyorlaydi."

    def add_arguments(self, parser):
        parser.add_argument("--season", help="Mavsum nomi (Exam.season)")
        parser.add_argument("--exam", nargs="*", type=int, help="Imtihon raqamlari")
        parser.add_argument("--attempts", type=int, default=2,
                            help="Har kishiga nechta to'plam (standart: 2)")
        parser.add_argument("--seed", type=int, help="Takrorlanadigan tasodif (sinov uchun)")
        parser.add_argument("--min-usmle", default="auto",
                            help="USMLE ball kesimi: 'auto' (bank ruxsat bergancha baland) "
                                 "yoki aniq son, yoki 'off'")
        parser.add_argument("--force", action="store_true",
                            help="Tayyorlangan to'plamlarni qaytadan yig'adi")
        parser.add_argument("--from-base", action="store_true",
                            help="Savollar imtihonning o'z bankidan emas, MARKAZIY "
                                 "test bazadan olinadi (fan + kurs to'plami)")
        parser.add_argument("--merge-courses", action="store_true",
                            help="--from-base bilan: bir fanning boshqa kurs to'plami ham "
                                 "qo'shiladi (bank torligini yopish uchun)")
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
        tor_banklar: list[str] = []
        yozuvlar: list[StudentExam] = []

        for e in exams:
            if opts.get("from_base"):
                bank, manba = _base_pool(e, bool(opts.get("merge_courses")))
            else:
                bank = [q for q in json.loads(e.questions_json or "[]") if isinstance(q, dict)]
                manba = "imtihon banki"
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
            # USMLE KESIMI: past balli savollar tanlovdan chiqadi. Lekin
            # tanlov juda torayib ketmasligi kerak — aks holda savollar
            # odamlar orasida takrorlanib ketadi. Shuning uchun kesim ikki
            # shartni bir vaqtda qondiradi:
            #   * bir odamning HAMMA urinishiga boshqa savol yetsin
            #     (need × attempts), ustiga biroz zaxira;
            #   * hamma odamga kerak bo'ladigan joylarning yarmidan kam
            #     bo'lmasin, ya'ni bir savol o'rtacha ikki kishidan ko'pga
            #     tushmasin.
            kerakli = need * attempts
            joylar = len(ses) * attempts * need
            maqsad = max(int(kerakli * 1.5), min(len(bank), (joylar + 1) // 2))
            kesim = 0
            if str(opts["min_usmle"]).strip().lower() not in ("off", "0", ""):
                if str(opts["min_usmle"]).strip().lower() == "auto":
                    for t_ball in range(12, -1, -1):
                        if len([q for q in bank if usmle_score(q) >= t_ball]) >= maqsad:
                            kesim = t_ball
                            break
                else:
                    kesim = int(opts["min_usmle"])
            tanlov = [q for q in bank if usmle_score(q) >= kesim] if kesim else list(bank)
            if len(tanlov) < kerakli:
                tanlov = list(bank)
                kesim = 0
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
                # Qaytadan yig'ishda (--force) eski "berilgan" ro'yxat
                # hisobga olinmaydi: o'sha to'plamlar hech kimga
                # ko'rsatilmagan, lekin ular tanlovni kichraytirib
                # savollarni takrorlanishga majbur qilardi. Haqiqatan
                # topshirilgan urinishlar baribir chetlanadi — ularning
                # sessiyasiga bu buyruq tegmaydi.
                avoid = set()
                if not (force and se.session_questions_json):
                    for x in json.loads(se.served_question_ids or "[]") or []:
                        try:
                            avoid.add(int(x))
                        except (TypeError, ValueError):
                            continue
                variants = build_variants(tanlov, need, attempts, usage=usage, rnd=rnd,
                                          avoid=avoid, quality=usmle_score)
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
            # Bank bir odamning hamma urinishiga yetadimi: `attempts` ta
            # to'plam uchun need*attempts ta boshqa savol kerak.
            if len(tanlov) < need * attempts:
                tor_banklar.append("[%s] %s — tanlov %d, kerak %d (%d urinish × %d savol)"
                                   % (e.id, nom, len(tanlov), need * attempts, attempts, need))
            if kishi:
                vals = [usage[question_key(q)] for q in tanlov]
                ortacha_matn = sum(len(str(q.get("text") or "")) for q in tanlov) // max(1, len(tanlov))
                self.stdout.write(
                    "   [%s] %-30s %3d kishi × %d | tanlov %4d/%4d (USMLE>=%d) | "
                    "matn o'rt %4d belgi | bir savol %d-%d marta | %s"
                    % (e.id, nom[:30], kishi, attempts, len(tanlov), len(bank), kesim,
                       ortacha_matn, min(vals), max(vals), manba))

        self.stdout.write("")
        self.stdout.write("Tayyorlanadi: %d kishi, %d to'plam | tegilmaydi: %d"
                          % (jami_kishi, jami_toplam, tegilmadi))
        if yetmadi:
            self.stdout.write(self.style.WARNING(
                "   %d kishida bank yetmadi — eski savollar qayta ishlatildi" % yetmadi))
        if tor_banklar:
            self.stdout.write(self.style.WARNING(
                "   Bank tor — oxirgi urinishlarda savollar qisman takrorlanadi:"))
            for t in tor_banklar:
                self.stdout.write("      " + t)
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
