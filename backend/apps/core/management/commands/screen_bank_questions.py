"""Bankni USMLE o'lchoviga solib tekshiradi va nuqsonli savollarni chiqaradi.

Maqsad: imtihon maksimal qiyin bo'lsin, lekin qiyinlik KLINIK FIKRLASHdan
kelsin — savolning nuqsonidan emas. Shuning uchun apellyatsiyaga sabab
bo'ladigan savollar (ikki varianti bir xil ma'noda, matni kesilgan, rasmga
havola qilgan-u rasmi yo'q, "hammasi to'g'ri" turidagi variant) bankdan
chiqariladi, qolganlari USMLE balli bo'yicha saralanadi.

Savol matni QAYTA YOZILMAYDI — faqat baholanadi va tanlanadi.

    python manage.py screen_bank_questions --season "2-kurs ordinatura 2-imkoniyat"
    python manage.py screen_bank_questions --season "..." --apply
    python manage.py screen_bank_questions --exam 606 --show 5

Bank kerakli sondan kichkina bo'lib qolmasin: har imtihonda kamida
`--min-keep` × savol soni qoldiriladi (standart 2 barobar), aks holda
faqat eng xavfli nuqsonlar chiqariladi.
"""
from __future__ import annotations

import json
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.api.usmle_screen import appeal_risks, review_flags, usmle_score
from apps.core.models import AuditLog, Exam

# `appeal_risks` ning o'zi mexanik tasdiqlanadigan nuqsonlar ro'yxati —
# hammasi chiqarilishi kerak. Bank juda kichik bo'lib qolsa, shu yerdagi
# eng xavflilari (javobi noto'g'ri yoki javobsiz savol) baribir chiqariladi.
ENG_XAVFLI = (
    "matn yo'q",
    "kalit yo'q",
    "to'g'ri javob variantlar ichida yo'q",
    "ikki variant bir xil matn",
    "rasmga havola, rasm yo'q",
)


def _jiddiy(risks: list[str]) -> bool:
    return any(r.startswith(ENG_XAVFLI) for r in risks)


class Command(BaseCommand):
    help = "Bankdagi nuqsonli savollarni topadi va (--apply bilan) chiqaradi."

    def add_arguments(self, parser):
        parser.add_argument("--season")
        parser.add_argument("--exam", nargs="*", type=int)
        parser.add_argument("--min-keep", type=float, default=2.0,
                            help="Bank savol sonidan necha barobar katta qolsin (standart 2)")
        parser.add_argument("--show", type=int, default=0,
                            help="Har imtihondan nechta nuqson namunasi ko'rsatilsin")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        season = (opts.get("season") or "").strip()
        exam_ids = opts.get("exam") or []
        if not season and not exam_ids:
            raise CommandError("--season yoki --exam kerak")
        apply = bool(opts["apply"])
        show = int(opts["show"] or 0)
        min_keep = float(opts["min_keep"])

        exams = Exam.objects.filter(season=season) if season else Exam.objects.filter(id__in=exam_ids)
        exams = list(exams.order_by("id"))
        if not exams:
            raise CommandError("Imtihon topilmadi")

        self.stdout.write("Imtihonlar: %d | rejim: %s"
                          % (len(exams), "YOZISH" if apply else "ko'rish"))
        hammasi: Counter = Counter()
        shubha: Counter = Counter()
        jami_chiqdi = jami_qoldi = 0
        rejalar: list[tuple[Exam, list[dict], list[dict]]] = []

        for e in exams:
            bank = [q for q in json.loads(e.questions_json or "[]") if isinstance(q, dict)]
            if not bank:
                continue
            need = max(1, int(e.bank_question_count or 25))
            nom = (e.title or "").split("—")[-1].split("(")[0].strip()[:34]
            risks = {id(q): appeal_risks(q) for q in bank}
            for r in risks.values():
                for x in r:
                    hammasi[x.split(" (")[0].split(":")[0]] += 1
            # Shubhalar — faqat sanaladi, o'chirilmaydi.
            for q in bank:
                for x in review_flags(q):
                    shubha[x.split(" (")[0]] += 1

            yomon = [q for q in bank if risks[id(q)]]
            jiddiy = [q for q in bank if _jiddiy(risks[id(q)])]
            # Avval hammasini chiqarishga harakat qilamiz; bank juda kichik
            # bo'lib qolsa — faqat jiddiylarini.
            keep = [q for q in bank if not risks[id(q)]]
            level = "hammasi"
            if len(keep) < need * min_keep:
                keep = [q for q in bank if not _jiddiy(risks[id(q)])]
                level = "faqat jiddiy"
            if len(keep) < need:
                keep = bank
                level = "tegilmadi"
            drop = [q for q in bank if q not in keep]
            jami_chiqdi += len(drop)
            jami_qoldi += len(keep)
            rejalar.append((e, bank, keep))

            ball = [usmle_score(q) for q in keep]
            o_rta = sum(ball) / len(ball) if ball else 0
            top = sorted(ball, reverse=True)[:need]
            self.stdout.write(
                "   [%s] %-34s bank %4d -> %4d (-%3d, %s) | nuqson %3d (jiddiy %3d) | "
                "USMLE ball o'rtacha %.1f, eng yaxshi %d tasi %.1f"
                % (e.id, nom, len(bank), len(keep), len(drop), level, len(yomon),
                   len(jiddiy), o_rta, need, sum(top) / len(top) if top else 0))
            if show:
                for q in yomon[:show]:
                    self.stdout.write("        - %s | %s"
                                      % ("; ".join(risks[id(q)])[:90],
                                         str(q.get("text") or "")[:60].replace("\n", " ")))

        self.stdout.write("")
        self.stdout.write("Nuqson turlari:")
        for k, n in hammasi.most_common():
            self.stdout.write("   %-44s %d" % (k, n))
        self.stdout.write("Chiqariladi: %d | qoladi: %d" % (jami_chiqdi, jami_qoldi))
        if shubha:
            self.stdout.write("")
            self.stdout.write("Shubhalar (O'CHIRILMAYDI — odam ko'rishi uchun):")
            for k, n in shubha.most_common():
                self.stdout.write("   %-44s %d" % (k, n))

        if not apply:
            self.stdout.write(self.style.WARNING("Ko'rish rejimi — yozish uchun --apply"))
            return

        with transaction.atomic():
            for e, bank, keep in rejalar:
                if len(keep) == len(bank):
                    continue
                with open("/tmp/bank_usmle_zaxira_%d.json" % e.id, "w") as fh:
                    json.dump(bank, fh, ensure_ascii=False)
                for i, q in enumerate(keep, 1):
                    q["id"] = i
                e.questions_json = json.dumps(keep, ensure_ascii=False)
                e.save(update_fields=["questions_json"])
            AuditLog.objects.create(
                actor_id="", actor_name="screen_bank_questions", action="update_exam",
                target_type="exam", target_id=",".join(str(e.id) for e, _b, _k in rejalar)[:128],
                target_name=season or "bank saralandi",
                detail="Apellyatsiyaga sabab bo'luvchi %d savol bankdan chiqarildi "
                       "(ikki varianti bir xil ma'noda, matni kesilgan, rasmsiz havola, "
                       "'hammasi to'g'ri'). Kalitlarga tegilmadi. Zaxira: "
                       "/tmp/bank_usmle_zaxira_<id>.json" % jami_chiqdi,
            )
        self.stdout.write(self.style.SUCCESS("BAJARILDI: %d savol chiqarildi" % jami_chiqdi))
