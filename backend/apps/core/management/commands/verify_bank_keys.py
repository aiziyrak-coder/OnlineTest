"""Imtihon bankidagi "to'g'ri javob" kalitlarini mustaqil tekshiradi.

25.09.2026 da tashqi fayldan o'girilgan bankda kalitlarning ~75% i noto'g'ri
chiqdi (fayl formatida "birinchi variant to'g'ri" degan taxmin xato edi) va
talabalar to'g'ri javob berib ham yiqilishdi. Yangi bank imtihonga qo'yilishidan
OLDIN shu buyruq bilan tekshiriladi:

    python manage.py verify_bank_keys --exam 561            # 40 ta tasodifiy savol
    python manage.py verify_bank_keys --exam 561 --sample 80

Model kalitni KO'RMAYDI, variantlar aralashtiriladi. Mos kelish 70% dan past
bo'lsa buyruq 1 kod bilan tugaydi — bankni imtihonga qo'ymang.
"""
import json
import random
from concurrent.futures import ThreadPoolExecutor

from django.core.management.base import BaseCommand

from apps.core.models import Exam

PROMPT = (
    "Sen {subject} bo'yicha professorsan. Quyidagi bir tanlovli test savoliga qaysi variant "
    "TO'G'RI javob ekanini aniqla. Faqat JSON qaytar: "
    '{{"correct": "<variant matnini AYNAN ko\'chir>"}}\n\nSAVOL: {q}\nVARIANTLAR:\n{o}'
)


def _n(s):
    return " ".join(str(s or "").lower().replace("\u2019", "'").replace("\u2018", "'").split())


class Command(BaseCommand):
    help = "Imtihon bankidagi kalitlarni mustaqil (kalitni ko'rsatmasdan) tekshiradi."

    def add_arguments(self, parser):
        parser.add_argument("--exam", type=int, required=True)
        parser.add_argument("--sample", type=int, default=40)
        parser.add_argument("--subject", default="")

    def handle(self, *args, **o):
        from apps.api.ai_question_gen import _exam_model
        from apps.api.openai_client import api_key_configured, chat_text

        if not api_key_configured():
            self.stderr.write("AI kaliti sozlanmagan — tekshirib bo'lmaydi.")
            raise SystemExit(2)
        e = Exam.objects.get(pk=o["exam"])
        bank = [q for q in json.loads(e.questions_json or "[]") if isinstance(q, dict)]
        if not bank:
            self.stdout.write("Bank bo'sh.")
            return
        subject = o["subject"] or (e.faculty_subject or e.title)
        rnd = random.Random(e.id)
        pool = rnd.sample(bank, min(o["sample"], len(bank)))

        def ask(q):
            opts = list(q.get("options") or [])
            rnd_local = random.Random(hash(str(q.get("text"))) & 0xFFFF)
            rnd_local.shuffle(opts)
            try:
                raw = chat_text(PROMPT.format(subject=subject, q=q.get("text"),
                                              o="\n".join("- %s" % x for x in opts)),
                                temperature=0.0, model=_exam_model())
                i, j = raw.find("{"), raw.rfind("}")
                return _n(json.loads(raw[i:j + 1]).get("correct"))
            except Exception:  # noqa: BLE001
                return ""

        with ThreadPoolExecutor(max_workers=8) as ex:
            picks = list(ex.map(ask, pool))
        checked = [(q, p) for q, p in zip(pool, picks) if p]
        ok = [q for q, p in checked if p == _n(q.get("correctAnswer"))]
        bad = [(q, p) for q, p in checked if p != _n(q.get("correctAnswer"))]
        pct = round(len(ok) / len(checked) * 100) if checked else 0
        self.stdout.write("[%s] %s" % (e.id, e.title))
        self.stdout.write("Tekshirildi: %d | kalit mos: %d | mos emas: %d | MOSLIK: %d%%"
                          % (len(checked), len(ok), len(bad), pct))
        for q, p in bad[:10]:
            self.stdout.write("  - %s" % str(q.get("text"))[:110])
            self.stdout.write("      bankda: %s | tekshiruv: %s" % (str(q.get("correctAnswer"))[:60], p[:60]))
        if pct < 70:
            self.stdout.write("\nKALIT SHUBHALI — bu bankni imtihonga qo'ymang, manbani tekshiring.")
            raise SystemExit(1)
        self.stdout.write("\nKalitlar ishonchli.")
