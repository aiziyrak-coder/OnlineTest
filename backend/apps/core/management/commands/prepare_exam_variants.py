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
from apps.api.usmle_screen import norm, usmle_score
from apps.core.models import (AuditLog, Exam, StudentExam, StudentExamAttempt,
                              TestBankCategory, TestBankQuestion)


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


def _seen_texts(student_id: str, exam_id: int) -> set[str]:
    """Shu odamga ILGARI berilgan savollar matni.

    Savol raqamiga tayanib bo'lmaydi: imtihonning o'z bankidagi raqam va
    markaziy bazadagi raqam boshqa-boshqa, bitta savol ikki joyda ikki xil
    raqam bilan turadi. Shuning uchun matn bo'yicha solishtiriladi — sentabr
    imtihonida ko'rilgan savol oktabrda qaytib tushmaydi.
    """
    out: set[str] = set()

    def yig(raw):
        for q in json.loads(raw or "[]") or []:
            if isinstance(q, dict) and q.get("text"):
                out.add(norm(q["text"])[:200])

    for row in (StudentExam.objects.filter(student_id=student_id)
                .exclude(exam_id=exam_id).values_list("session_questions_json", flat=True)):
        yig(row)
    # Arxivda alohida maydon yo'q: butun sessiya `snapshot` ichida JSON
    # bo'lib saqlanadi.
    for snap in (StudentExamAttempt.objects.filter(student_id=student_id)
                 .values_list("snapshot", flat=True)):
        try:
            d = json.loads(snap or "{}")
        except (TypeError, ValueError):
            continue
        if isinstance(d, dict):
            yig(d.get("session_questions_json"))
    return out


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
        parser.add_argument("--keep-seen", action="store_true",
                            help="Odamga ilgari berilgan savollarni ham tanlovda qoldirish "
                                 "(standart: ular chetlanadi)")
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
            # Kimga to'plam yig'iladi. Boshlangan yoki topshirilgan sessiyaga
            # tegilmaydi — imtihon ustida ishlayotgan odamning savollari
            # o'zgarmasligi kerak.
            maqsadlar = []
            for se in ses:
                band = (se.status or "").strip() not in ("", "Pending") or se.started_at
                if band or (se.session_questions_json and not force):
                    tegilmadi += 1
                    continue
                # Qaytadan yig'ishda (--force) eski "berilgan" ro'yxat
                # hisobga olinmaydi: o'sha to'plamlar hech kimga
                # ko'rsatilmagan, lekin ular tanlovni kichraytirib
                # savollarni takrorlanishga majbur qilardi.
                avoid = set()
                if not (force and se.session_questions_json):
                    for x in json.loads(se.served_question_ids or "[]") or []:
                        try:
                            avoid.add(int(x))
                        except (TypeError, ValueError):
                            continue
                # ILGARI KO'RILGAN SAVOLLAR chetlanadi (matn bo'yicha): sentabr
                # imtihonida tushgan savol oktabrda qaytmasligi kerak. Tanlov
                # yetmay qolsa chetlash bekor qilinadi, aks holda imtihon
                # savolsiz qolardi.
                korilgan: set[str] = set()
                if not opts.get("keep_seen"):
                    korilgan = _seen_texts(str(se.student_id), e.id)
                maqsadlar.append((se, avoid, korilgan))

            # NAVBAT MUHIM: avval HAMMAGA 1-to'plam, keyin hammaga 2-to'plam.
            # Ilgari bir odamning uchta to'plami ketma-ket yig'ilardi: uning
            # 2 va 3-to'plami bankni "band" qilib qo'yardi, keyingi odamning
            # BIRINCHI to'plami esa allaqachon ishlatilgan savollardan
            # tushardi. Shu sababli imtihonda qo'shni ikki kishining
            # savollari 19 tagacha ustma-ust tushgan edi. Endi birinchi
            # to'plamlar butun bank bo'ylab birinchi navbatda taqsimlanadi.
            toplamlar: dict[int, list] = {id(se): [] for se, _a, _k in maqsadlar}
            olingan: dict[int, set] = {id(se): set(av) for se, av, _k in maqsadlar}
            # Har bir odam uchun o'z tanlovi: ilgari ko'rgan savollari olib
            # tashlangan. Yetmasa to'liq tanlov qoldiriladi.
            shaxsiy: dict[int, list] = {}
            chetlangan = 0
            for se, _av, korilgan in maqsadlar:
                if not korilgan:
                    shaxsiy[id(se)] = tanlov
                    continue
                qisqa = [q for q in tanlov if norm(q.get("text"))[:200] not in korilgan]
                if len(qisqa) >= need * attempts:
                    chetlangan += len(tanlov) - len(qisqa)
                    shaxsiy[id(se)] = qisqa
                elif len(qisqa) >= need:
                    chetlangan += len(tanlov) - len(qisqa)
                    shaxsiy[id(se)] = qisqa
                else:
                    shaxsiy[id(se)] = tanlov
            if chetlangan:
                self.stdout.write("        ilgari ko'rilgani uchun chetlandi: %d (jami urinish)"
                                  % chetlangan)
            for _urinish in range(attempts):
                # Shu bosqichda boshqalarga tushgan savollar — QATTIQ
                # chetlanadi. Faqat tartib bilan (kam ishlatilgani oldinda)
                # yetmaydi: sifat tartibi qat'iy bo'lgani uchun bir sikldan
                # keyin hamma yana eng kuchli savollarga qaytib kelardi va
                # qo'shni ikki kishining imtihon to'plami 13 tagacha ustma-ust
                # tushardi. Tanlov yetmasa chetlash bekor qilinadi — imtihon
                # savolsiz qolmasligi kerak.
                band: set = set()
                for se, _av, _k in maqsadlar:
                    mening = shaxsiy[id(se)]
                    chetla = olingan[id(se)] | band
                    qoldiq = sum(1 for q in mening if question_key(q) not in chetla)
                    if qoldiq < need:
                        chetla = olingan[id(se)]
                    v = build_variants(mening, need, 1, usage=usage, rnd=rnd,
                                       avoid=chetla, quality=usmle_score)[0]
                    toplamlar[id(se)].append(v)
                    kalitlar = {question_key(q) for q in v}
                    olingan[id(se)] |= kalitlar
                    band |= kalitlar
                    if len(v) < need:
                        yetmadi += 1

            for se, avoid, _k in maqsadlar:
                variants = toplamlar[id(se)]
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
