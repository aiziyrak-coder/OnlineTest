"""Imtihonlar ichidagi savollarni MARKAZIY test bazaga ko'chiradi.

Hozircha har bir imtihonning savollari o'z ichida (`Exam.questions_json`)
saqlanadi: bitta fanning savoli o'n xil imtihonda nusxa bo'lib yuradi,
yangi savol qo'shish uchun esa har imtihonni alohida tahrirlash kerak.
Shu sababli bir fanda bank tor bo'lib qoladi va savollar odamlar orasida
takrorlanadi.

Bu buyruq savollarni `TestBankQuestion` ga ko'chiradi va fan + kurs
kesimida to'plam (`TestBankCategory`) yasaydi. Shundan keyin:
  * bir fanning hamma savoli bitta joyda — imtihon shu to'plamdan oladi;
  * yangi savol bir marta qo'shiladi va hamma imtihonga yetadi;
  * takroriy nusxalar yo'qoladi (bir xil matn bir marta saqlanadi).

IMTIHONLARGA TEGILMAYDI: `questions_json` o'z joyida qoladi, shuning
uchun ertangi imtihon ham, tayyorlangan to'plamlar ham o'zgarmaydi.
Ko'chirish faqat QO'SHADI, va qayta ishga tushirsa yangi savollarnigina
qo'shadi (bir xil matn ikki marta tushmaydi).

    python manage.py migrate_banks_to_base
    python manage.py migrate_banks_to_base --apply
    python manage.py migrate_banks_to_base --audience ordinator --apply
"""
from __future__ import annotations

import json
import re

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.api.usmle_screen import appeal_risks, norm
from apps.core.models import AuditLog, Exam, TestBankCategory, TestBankQuestion

AUD_LABEL = {
    "ordinator": "ordinatura",
    "magistr": "magistratura",
    "student": "talaba",
    "faculty": "o'qituvchi baholash",
    "vacancy": "ishga qabul",
    "entrant": "maxsus kiruvchi",
}
TRACK = {
    "ordinator": "residency",
    "magistr": "master",
    "student": "bachelor",
}
CHUNK = 500


def subject_of(e: Exam) -> str:
    """Imtihonning fani — to'plam nomi uchun."""
    s = str(getattr(e, "faculty_subject", "") or "").strip()
    if not s:
        title = str(e.title or "")
        s = title.split("—")[-1].split("(")[0].strip() if "—" in title else title.strip()
    # "Akusherlik va ginekologiya 124" / "... 224" — bir fanning guruh raqami.
    s = re.sub(r"\s*\d{2,4}\s*$", "", s).strip()
    return re.sub(r"\s+", " ", s)[:260] or "Belgilanmagan"


def category_name(subject: str, audience: str, course: int) -> str:
    aud = AUD_LABEL.get(audience, audience or "boshqa")
    kurs = (" %d-kurs" % course) if course else ""
    return ("%s — %s%s" % (subject, aud, kurs))[:300]


class Command(BaseCommand):
    help = "Imtihon savollarini markaziy test bazaga ko'chiradi (qo'shadi)."

    def add_arguments(self, parser):
        parser.add_argument("--audience", nargs="*", help="Faqat shu auditoriyalar")
        parser.add_argument("--exam", nargs="*", type=int, help="Faqat shu imtihonlar")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **opts):
        apply = bool(opts["apply"])
        exams = Exam.objects.all().order_by("id")
        if opts.get("audience"):
            exams = exams.filter(audience__in=opts["audience"])
        if opts.get("exam"):
            exams = exams.filter(id__in=opts["exam"])

        # To'plam bo'yicha yig'amiz: (fan, auditoriya, kurs) -> savollar
        guruh: dict[tuple, list[dict]] = {}
        manba: dict[tuple, set[int]] = {}
        jami_oqildi = nuqsonli = uzun_kalit = 0
        for e in exams:
            bank = [q for q in json.loads(e.questions_json or "[]") if isinstance(q, dict)]
            if not bank:
                continue
            key = (subject_of(e), str(e.audience or "student"), int(e.course or 0))
            bucket = guruh.setdefault(key, [])
            manba.setdefault(key, set()).add(e.id)
            for q in bank:
                jami_oqildi += 1
                if appeal_risks(q):
                    nuqsonli += 1
                    continue
                # Kalit maydoni 500 belgi. Undan uzun javob qirqilib yozilsa,
                # kalit variantlar bilan mos kelmay qoladi va savol butunlay
                # buziladi — shunday savol ko'chirilmaydi.
                if len(str(q.get("correctAnswer") or "")) > 500:
                    uzun_kalit += 1
                    continue
                bucket.append(q)

        self.stdout.write("Imtihonlardan o'qildi: %d savol | nuqsonli (olinmaydi): %d | "
                          "kaliti 500 belgidan uzun (olinmaydi): %d | to'plam: %d | rejim: %s"
                          % (jami_oqildi, nuqsonli, uzun_kalit, len(guruh),
                             "YOZISH" if apply else "ko'rish"))

        jami_yangi = jami_takror = 0
        reja: list[tuple] = []
        for key in sorted(guruh, key=lambda k: (-len(guruh[k]), k[0])):
            subject, audience, course = key
            nom = category_name(subject, audience, course)
            cat = TestBankCategory.objects.filter(name=nom).first()
            mavjud: set[str] = set()
            if cat:
                mavjud = {
                    norm(t or u or "")
                    for t, u in TestBankQuestion.objects.filter(category_id=cat.id)
                    .values_list("text_uz", "text")
                }
            yangi: list[dict] = []
            korilgan = set(mavjud)
            for q in guruh[key]:
                k = norm(q.get("text"))
                if not k or k in korilgan:
                    jami_takror += 1
                    continue
                korilgan.add(k)
                yangi.append(q)
            jami_yangi += len(yangi)
            reja.append((nom, audience, course, cat, yangi, len(mavjud), manba[key]))
            if yangi or mavjud:
                self.stdout.write(
                    "   %-56s %5d yangi (bazada %4d) | %d imtihondan"
                    % (nom[:56], len(yangi), len(mavjud), len(manba[key])))

        self.stdout.write("")
        self.stdout.write("Qo'shiladi: %d savol | takroriy nusxa tashlab ketildi: %d"
                          % (jami_yangi, jami_takror))
        if not apply:
            self.stdout.write(self.style.WARNING("Ko'rish rejimi — yozish uchun --apply"))
            return

        yaratilgan = 0
        with transaction.atomic():
            for nom, audience, course, cat, yangi, _bor, _src in reja:
                if cat is None:
                    cat = TestBankCategory.objects.create(
                        name=nom,
                        description="Imtihon banklaridan ko'chirildi (migrate_banks_to_base).",
                        sort_order=0,
                        program_track=TRACK.get(audience, "any"),
                        academic_year=course or None,
                        source_language="uz",
                    )
                    yaratilgan += 1
                rows = []
                for q in yangi:
                    opts_list = [str(o) for o in (q.get("options") or [])]
                    row = TestBankQuestion(
                        category_id=cat.id,
                        text=str(q.get("text") or ""),
                        options_json=json.dumps(opts_list, ensure_ascii=False),
                        correct_answer=str(q.get("correctAnswer") or "")[:500],
                        language="uz",
                        text_uz=str(q.get("text") or ""),
                        options_uz_json=json.dumps(opts_list, ensure_ascii=False),
                        correct_answer_uz=str(q.get("correctAnswer") or "")[:500],
                    )
                    for lang in ("ru", "en"):
                        t = str(q.get("text_%s" % lang) or "").strip()
                        if not t:
                            continue
                        o = q.get("options_%s" % lang)
                        setattr(row, "text_%s" % lang, t)
                        if isinstance(o, list) and len(o) == len(opts_list):
                            setattr(row, "options_%s_json" % lang,
                                    json.dumps([str(x) for x in o], ensure_ascii=False))
                            ans = str(q.get("correctAnswer") or "")
                            if ans in opts_list:
                                setattr(row, "correct_answer_%s" % lang,
                                        str(o[opts_list.index(ans)])[:500])
                    rows.append(row)
                for i in range(0, len(rows), CHUNK):
                    TestBankQuestion.objects.bulk_create(rows[i:i + CHUNK])
            AuditLog.objects.create(
                actor_id="", actor_name="migrate_banks_to_base", action="update_exam",
                target_type="test_bank", target_id="markaziy baza",
                target_name="imtihon banklari markaziy bazaga ko'chirildi",
                detail="%d savol qo'shildi, %d to'plam yaratildi, %d takroriy nusxa va %d "
                       "nuqsonli savol olinmadi. Imtihonlarning questions_json i o'z joyida "
                       "qoldi." % (jami_yangi, yaratilgan, jami_takror, nuqsonli),
            )
        self.stdout.write(self.style.SUCCESS(
            "BAJARILDI: %d savol, %d yangi to'plam" % (jami_yangi, yaratilgan)))
