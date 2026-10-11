"""Imtihon banklarini markaziy bazaga ko'chirish.

Talab: bir fanning savollari bitta joyda bo'lsin, takroriy nusxa
saqlanmasin, imtihonlarning o'z banki esa buzilmasin (ertangi imtihon
va tayyorlangan to'plamlar o'zgarmasligi kerak).
"""
from __future__ import annotations

import json
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone as dj_tz

from apps.core.models import AppUser, Exam, TestBankCategory, TestBankQuestion


def _q(i: int, text: str | None = None) -> dict:
    return {
        "id": i,
        "text": text or ("45 yoshli erkak ko'krak og'rig'i bilan keldi. Savol %d?" % i),
        "options": ["A%d" % i, "B%d" % i, "C%d" % i, "D%d" % i, "E%d" % i],
        "correctAnswer": "C%d" % i,
    }


class BankMigrationTests(TestCase):
    def setUp(self):
        self.admin = AppUser.objects.create(id="bm-admin", role="admin", name="Admin")
        now = dj_tz.now()
        self.common = dict(
            teacher_id=self.admin.id, start_time=now, end_time=now + timedelta(hours=2),
            duration_minutes=60, language="uz", exam_mode="static",
            bank_category_ids="[]", bank_question_count=25,
        )

    def _exam(self, title: str, bank: list[dict], **kw) -> Exam:
        data = dict(self.common)
        data.update(kw)
        return Exam.objects.create(title=title, questions_json=json.dumps(bank), **data)

    def _run(self, *extra) -> str:
        out = StringIO()
        call_command("migrate_banks_to_base", *extra, stdout=out)
        return out.getvalue()

    def test_dry_run_writes_nothing(self):
        self._exam("DAK — Pediatriya", [_q(1), _q(2)], audience="ordinator", course=2,
                   faculty_subject="Pediatriya")
        self._run()
        self.assertEqual(TestBankQuestion.objects.count(), 0)
        self.assertEqual(TestBankCategory.objects.count(), 0)

    def test_one_category_per_subject_and_course(self):
        self._exam("DAK — Pediatriya", [_q(1)], audience="ordinator", course=2,
                   faculty_subject="Pediatriya")
        self._exam("1-kurs — Pediatriya", [_q(2)], audience="ordinator", course=1,
                   faculty_subject="Pediatriya")
        self._run("--apply")
        nomlar = sorted(TestBankCategory.objects.values_list("name", flat=True))
        self.assertEqual(nomlar, ["Pediatriya — ordinatura 1-kurs",
                                  "Pediatriya — ordinatura 2-kurs"])

    def test_the_same_question_in_two_exams_is_stored_once(self):
        bank = [_q(1), _q(2), _q(3)]
        self._exam("DAK — LOR 1", bank, audience="ordinator", course=2,
                   faculty_subject="Otorinolaringologiya")
        self._exam("DAK — LOR 2", bank, audience="ordinator", course=2,
                   faculty_subject="Otorinolaringologiya")
        self._run("--apply")
        self.assertEqual(TestBankQuestion.objects.count(), 3)

    def test_group_numbers_in_the_subject_are_merged(self):
        self._exam("DAK — AG 124", [_q(1)], audience="ordinator", course=2,
                   faculty_subject="Akusherlik va ginekologiya 124")
        self._exam("DAK — AG 224", [_q(2)], audience="ordinator", course=2,
                   faculty_subject="Akusherlik va ginekologiya 224")
        self._run("--apply")
        self.assertEqual(TestBankCategory.objects.count(), 1)
        self.assertEqual(TestBankQuestion.objects.count(), 2)

    def test_defective_questions_are_left_behind(self):
        yomon = {"id": 9, "text": "Rasmda ko'rsatilgan o'zgarish nima?",
                 "options": ["A", "B", "C", "D"], "correctAnswer": "A"}
        kalitsiz = {"id": 10, "text": "To'liq savol matni shu yerda?",
                    "options": ["A", "B", "C", "D"], "correctAnswer": "Z"}
        self._exam("DAK — Gigiyena", [_q(1), yomon, kalitsiz], audience="ordinator",
                   course=2, faculty_subject="Gigiyena")
        self._run("--apply")
        self.assertEqual(TestBankQuestion.objects.count(), 1)

    def test_the_exam_bank_is_untouched(self):
        bank = [_q(1), _q(2)]
        e = self._exam("DAK — Urologiya", bank, audience="ordinator", course=2,
                       faculty_subject="Urologiya")
        before = e.questions_json
        self._run("--apply")
        e.refresh_from_db()
        self.assertEqual(e.questions_json, before)

    def test_running_twice_adds_nothing_new(self):
        self._exam("DAK — Nevrologiya", [_q(1), _q(2)], audience="ordinator", course=2,
                   faculty_subject="Nevrologiya")
        self._run("--apply")
        n = TestBankQuestion.objects.count()
        self._run("--apply")
        self.assertEqual(TestBankQuestion.objects.count(), n)

    def test_a_new_question_is_added_on_a_second_run(self):
        e = self._exam("DAK — Ftiziatriya", [_q(1)], audience="ordinator", course=2,
                       faculty_subject="Ftiziatriya")
        self._run("--apply")
        e.questions_json = json.dumps([_q(1), _q(5)])
        e.save(update_fields=["questions_json"])
        self._run("--apply")
        self.assertEqual(TestBankQuestion.objects.count(), 2)

    def test_the_category_carries_the_right_track(self):
        self._exam("DAK — Kardiologiya", [_q(1)], audience="ordinator", course=2,
                   faculty_subject="Kardiologiya")
        self._exam("Baholash — Gistologiya", [_q(2)], audience="faculty", course=0,
                   faculty_subject="Gistologiya")
        self._run("--apply")
        ordinator = TestBankCategory.objects.get(name__startswith="Kardiologiya")
        faculty = TestBankCategory.objects.get(name__startswith="Gistologiya")
        self.assertEqual(ordinator.program_track, "residency")
        self.assertEqual(ordinator.academic_year, 2)
        self.assertEqual(faculty.program_track, "any")
        self.assertIsNone(faculty.academic_year)

    def test_translations_travel_with_the_question(self):
        q = _q(1)
        q["text_ru"] = "Мужчина 45 лет с болью в груди. Вопрос 1?"
        q["options_ru"] = ["А1", "Б1", "В1", "Г1", "Д1"]
        self._exam("DAK — Ichki kasalliklar", [q], audience="ordinator", course=2,
                   faculty_subject="Ichki kasalliklar")
        self._run("--apply")
        row = TestBankQuestion.objects.get()
        self.assertTrue(row.text_ru)
        self.assertEqual(json.loads(row.options_ru_json)[2], "В1")
        # To'g'ri javob ruscha variantga mos tushgan (pozitsiya bo'yicha).
        self.assertEqual(row.correct_answer_ru, "В1")
