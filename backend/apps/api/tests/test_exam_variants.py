"""Oldindan tayyorlangan savol to'plamlari.

Talab: har kishiga boshqa savollar tushsin, qayta ruxsat berilganda yangi
to'plam tushsin, imtihon boshlanganda esa hech narsa tanlanmasin.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone as dj_tz
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.api.exam_variants import build_variants, question_key, shuffle_options, take_prepared
from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam


def _bank(n: int) -> list[dict]:
    return [
        {
            "id": i,
            "text": "Savol %d" % i,
            "options": ["A%d" % i, "B%d" % i, "C%d" % i, "D%d" % i],
            "correctAnswer": "C%d" % i,
            "options_ru": ["A%d-ru" % i, "B%d-ru" % i, "C%d-ru" % i, "D%d-ru" % i],
            "optionExplanations": ["a", "b", "c", "d"],
        }
        for i in range(1, n + 1)
    ]


class ShuffleOptionsTests(TestCase):
    def test_parallel_lists_move_with_the_options(self):
        q = _bank(1)[0]
        out = shuffle_options(q, random.Random(7))
        self.assertEqual(sorted(out["options"]), sorted(q["options"]))
        # Rus tilidagi variant o'z javobi bilan birga ko'chadi.
        for i, opt in enumerate(out["options"]):
            j = q["options"].index(opt)
            self.assertEqual(out["options_ru"][i], q["options_ru"][j])
            self.assertEqual(out["optionExplanations"][i], q["optionExplanations"][j])

    def test_the_correct_answer_text_is_unchanged(self):
        q = _bank(1)[0]
        out = shuffle_options(q, random.Random(3))
        self.assertEqual(out["correctAnswer"], q["correctAnswer"])
        self.assertIn(out["correctAnswer"], out["options"])


class BuildVariantsTests(TestCase):
    def test_a_persons_two_variants_share_no_question(self):
        v1, v2 = build_variants(_bank(100), 25, 2, rnd=random.Random(1))
        self.assertEqual(len(v1), 25)
        self.assertEqual(len(v2), 25)
        self.assertFalse({question_key(q) for q in v1} & {question_key(q) for q in v2})

    def test_different_people_get_different_sets(self):
        bank = _bank(200)
        usage: Counter = Counter()
        rnd = random.Random(5)
        sets = [build_variants(bank, 25, 1, usage=usage, rnd=rnd)[0] for _ in range(6)]
        keys = [{question_key(q) for q in s} for s in sets]
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                self.assertNotEqual(keys[i], keys[j])

    def test_the_bank_is_used_evenly(self):
        bank = _bank(100)
        usage: Counter = Counter()
        rnd = random.Random(9)
        for _ in range(8):  # 8 kishi × 25 savol = 200 ta joy, 100 ta savol
            build_variants(bank, 25, 1, usage=usage, rnd=rnd)
        vals = [usage[question_key(q)] for q in bank]
        self.assertLessEqual(max(vals) - min(vals), 1)

    def test_questions_already_served_are_avoided(self):
        bank = _bank(60)
        avoid = {1, 2, 3, 4, 5}
        v = build_variants(bank, 25, 1, rnd=random.Random(2), avoid=avoid)[0]
        self.assertFalse(avoid & {question_key(q) for q in v})

    def test_a_short_bank_still_produces_a_full_set(self):
        v1, v2 = build_variants(_bank(30), 25, 2, rnd=random.Random(4))
        self.assertEqual(len(v1), 25)
        self.assertEqual(len(v2), 25)


class PreparedVariantFlowTests(TestCase):
    def setUp(self):
        self.level = Level.objects.create(name="D")
        self.group = Group.objects.create(name="G", level=self.level)
        admin = AppUser.objects.create(id="pv-admin", role="admin", name="Admin")
        self.people = []
        for i in range(4):
            u = AppUser.objects.create(
                id="pv-%d" % i, role="ordinator", name="Talaba %d" % i, status="Active",
                course=2, group_id=self.group.id,
                profile_image="data:image/png;base64," + "A" * 80,
            )
            u.is_authenticated = True
            self.people.append(u)
        now = dj_tz.now()
        self.exam = Exam.objects.create(
            teacher_id=admin.id, title="Imtihon — Fan", season="Sinov mavsumi",
            audience="ordinator", course=2,
            start_time=now - timedelta(minutes=5), end_time=now + timedelta(hours=3),
            duration_minutes=60, questions_json=json.dumps(_bank(300)),
            language="uz", exam_mode="static", bank_category_ids="[]",
            bank_question_count=25, ai_question_count=0,
        )
        ExamGroup.objects.create(exam_id=self.exam.id, group_id=self.group.id)
        self.ses = [
            StudentExam.objects.create(student_id=u.id, exam_id=self.exam.id,
                                       status="Pending", access_granted=True)
            for u in self.people
        ]
        self.f = APIRequestFactory()

    def _prepare(self, *extra):
        out = StringIO()
        call_command("prepare_exam_variants", "--season", "Sinov mavsumi",
                     "--seed", "11", *extra, stdout=out)
        return out.getvalue()

    def test_dry_run_writes_nothing(self):
        self._prepare()
        self.assertFalse(
            StudentExam.objects.exclude(session_questions_json=None)
            .exclude(session_questions_json="")
            .exists()
        )

    def test_everyone_gets_a_prepared_set_and_a_spare(self):
        self._prepare("--attempts", "2", "--apply")
        for se in StudentExam.objects.all():
            first = json.loads(se.session_questions_json)
            spare = json.loads(se.prepared_variants_json)
            self.assertEqual(len(first), 25)
            self.assertEqual(len(spare), 1)
            self.assertEqual(len(spare[0]), 25)
            self.assertFalse({question_key(q) for q in first}
                             & {question_key(q) for q in spare[0]})

    def test_the_sets_differ_between_people(self):
        self._prepare("--apply")
        keys = [{question_key(q) for q in json.loads(se.session_questions_json)}
                for se in StudentExam.objects.order_by("student_id")]
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                self.assertNotEqual(keys[i], keys[j])

    def test_starting_the_exam_adds_no_new_selection(self):
        from apps.api.views.student import _student_exams_start_impl

        self._prepare("--apply")
        se = self.ses[0]
        se.refresh_from_db()
        before = se.session_questions_json
        req = self.f.post("/x", {}, format="json")
        force_authenticate(req, user=self.people[0])
        req.user = self.people[0]
        _student_exams_start_impl(req, pk=self.exam.pk)
        se.refresh_from_db()
        self.assertEqual(json.loads(se.session_questions_json), json.loads(before))

    def test_a_retake_hands_over_the_prepared_spare(self):
        from apps.api.proctor_exam_retake import reset_fields_for_exam_retake

        self._prepare("--attempts", "2", "--apply")
        se = self.ses[1]
        se.refresh_from_db()
        se.status = "Failed"
        se.started_at = dj_tz.now()
        se.score = 5
        se.save(update_fields=["status", "started_at", "score"])
        first = json.loads(se.session_questions_json)
        se.exam = self.exam
        fields = reset_fields_for_exam_retake(se, "sinov")
        se.save(update_fields=list(set(fields)))
        se.refresh_from_db()
        second = json.loads(se.session_questions_json or "[]")
        self.assertEqual(len(second), 25)
        self.assertFalse({question_key(q) for q in first} & {question_key(q) for q in second})
        self.assertEqual(json.loads(se.prepared_variants_json), [])

    def test_an_exam_in_progress_is_not_touched(self):
        se = self.ses[2]
        se.status = "In Progress"
        se.started_at = dj_tz.now()
        se.session_questions_json = json.dumps(_bank(25))
        se.save(update_fields=["status", "started_at", "session_questions_json"])
        before = se.session_questions_json
        self._prepare("--apply", "--force")
        se.refresh_from_db()
        self.assertEqual(se.session_questions_json, before)

    def test_take_prepared_reports_an_empty_queue(self):
        se = self.ses[3]
        self.assertFalse(take_prepared(se))
