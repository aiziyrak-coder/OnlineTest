"""Uydan topshiriladigan imtihon va ro'yxat bo'yicha ruxsat berish qoidalari.

Bu testlar 24.09.2026 dagi qarorlarni yozib qo'yadi:
  * PIN faqat test markazi imtihonida talab qilinadi (uydan topshirish bloklanmaydi);
  * `auto_retake_all` yoqilgan imtihonda chetlatish o'rniga qayta urinish beriladi;
  * kutubxonadagi kitob test markazida qoidabuzarlik emas va dalillarda ko'rinmaydi;
  * ro'yxatdan odam qidirish imlo farqlarini (x/h, apostrof, bir harf) kechiradi.
"""
import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from apps.api.proctor_exam_retake import (
    exam_auto_retake_all,
    exam_is_remote,
    try_apply_exam_retake,
    violation_retakes_remaining,
)
from apps.api.test_center_policy import CENTER_IGNORED, PROCTOR_ONLY, suppress_center_signal
from apps.api.views.bulk_access import _close, _match, _norm_name
from apps.core.models import AppUser, Exam, StudentExam


def make_exam(**kw):
    owner = AppUser.objects.create(id=kw.pop("owner_id", "remote-owner"), role="admin", name="Owner")
    defaults = dict(
        teacher=owner,
        title="Uydan topshiriladigan imtihon",
        start_time=timezone.now(),
        end_time=timezone.now() + timedelta(hours=3),
        duration_minutes=75,
        bank_question_count=25,
        ai_question_count=0,
    )
    defaults.update(kw)
    return Exam.objects.create(**defaults)


class RemoteExamPolicyTests(TestCase):
    def test_remote_flag_and_vacancy_skip_pin(self):
        center = make_exam(owner_id="o1", test_center_pin="12345678")
        self.assertFalse(exam_is_remote(center))
        center.custom_rules = json.dumps({"remote": True})
        self.assertTrue(exam_is_remote(center))
        self.assertTrue(exam_is_remote(make_exam(owner_id="o2", audience="vacancy")))

    def test_broken_rules_json_never_crashes(self):
        exam = make_exam(owner_id="o3", custom_rules="{buzuq")
        self.assertFalse(exam_is_remote(exam))
        self.assertFalse(exam_auto_retake_all(exam))

    def test_auto_retake_all_turns_ban_into_new_attempt(self):
        exam = make_exam(owner_id="o4", custom_rules=json.dumps({"auto_retake_all": True}),
                         technical_retakes_allowed=2)
        student = AppUser.objects.create(id="remote-student", role="student", name="Talaba")
        se = StudentExam.objects.create(student=student, exam=exam, status="In Progress")
        # Telefon odatda "ataylab chiterlik" — bu imtihonda esa yangi urinish beriladi.
        result = try_apply_exam_retake(se, exam, reason_text="telefon", violations_count=1,
                                       violation_type="FORBIDDEN_OBJECT_CELL_PHONE")
        self.assertIsNotNone(result)
        se.refresh_from_db()
        self.assertEqual(se.status, "Pending")
        self.assertEqual(violation_retakes_remaining(se, exam), 1)

    def test_without_flag_deliberate_cheating_still_bans(self):
        exam = make_exam(owner_id="o5", technical_retakes_allowed=3)
        student = AppUser.objects.create(id="strict-student", role="student", name="Talaba 2")
        se = StudentExam.objects.create(student=student, exam=exam, status="In Progress")
        self.assertIsNone(try_apply_exam_retake(se, exam, reason_text="telefon", violations_count=1,
                                                violation_type="FORBIDDEN_OBJECT_CELL_PHONE"))


class CentreLibraryPolicyTests(TestCase):
    def test_books_are_ignored_in_the_centre(self):
        self.assertIn("FORBIDDEN_OBJECT_BOOK", CENTER_IGNORED)
        self.assertTrue(suppress_center_signal("FORBIDDEN_OBJECT_BOOK"))

    def test_centre_is_proctor_only(self):
        self.assertTrue(PROCTOR_ONLY)

    def test_phone_is_still_watched_in_the_centre(self):
        self.assertFalse(suppress_center_signal("FORBIDDEN_OBJECT_CELL_PHONE"))


class BulkAccessMatchingTests(TestCase):
    def setUp(self):
        self.people = []
        for pk, name in [
            ("1", "O‘LMASOVA DINORA NO‘MONJON QIZI"),
            ("2", "DADAJANOV SHOXTEMUR RAVSHAN O‘G‘LI"),
            ("3", "MAXAMMADIBROXIMOVA MASHRABXON MUSAJONOVNA"),
            ("4", "ABDUXALIMOV ABDULLO ABDUBANNOB O‘G‘LI"),
        ]:
            self.people.append((pk, name, _norm_name(name)))

    def find(self, text):
        return [p[0] for p in _match(_norm_name(text), self.people)]

    def test_spelling_differences_still_find_the_person(self):
        self.assertEqual(self.find("Olmasova Dinara"), ["1"])          # bir harf farqi
        self.assertEqual(self.find("Dadajonov Shoxtemur"), ["2"])      # a/o farqi
        self.assertEqual(self.find("Maxamadibrohimova Mashrabhon"), ["3"])  # x/h va bir harf
        self.assertEqual(self.find("Abduhalimov Abdullo"), ["4"])      # x/h

    def test_unknown_name_matches_nobody(self):
        self.assertEqual(self.find("Petrov Ivan"), [])

    def test_single_word_is_not_enough(self):
        self.assertEqual(self.find("Dadajanov"), [])

    def test_close_helper_limits(self):
        self.assertTrue(_close("dinora", "dinara"))
        self.assertTrue(_close("solih", "solix"))
        self.assertFalse(_close("aliyev", "valiyev"))
        self.assertFalse(_close("ali", "olи"))
