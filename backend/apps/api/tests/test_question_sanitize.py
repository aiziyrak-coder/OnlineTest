"""Savollarni saqlashdan oldin tekshirish va bir vaqtda ikki imtihon taqiqi.

10.10.2026 auditi: imtihon yaratishda savollar tekshirilmasdan saqlanardi va
bir kishi ikki imtihonni birdan ochib qo'ya olardi.
"""
import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.api.question_sanitize import merge_banks, sanitize_questions
from apps.api.views._helpers import _hash_pw
from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam


class SanitizeTests(TestCase):
    def test_good_question_gets_id_and_is_kept(self):
        out, bad = sanitize_questions([{"text": "Savol", "options": ["A", "B", "C"],
                                        "correctAnswer": "B"}])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], 1)
        self.assertEqual(out[0]["correctAnswer"], "B")
        self.assertEqual(bad, [])

    def test_answer_as_letter_or_number_is_resolved(self):
        out, _ = sanitize_questions([
            {"text": "Harf bilan", "options": ["Birinchi", "Ikkinchi"], "answer": "B"},
            {"text": "Raqam bilan", "options": ["Birinchi", "Ikkinchi"], "answer": "2"},
        ])
        self.assertEqual([q["correctAnswer"] for q in out], ["Ikkinchi", "Ikkinchi"])

    def test_answer_outside_options_is_rejected(self):
        out, bad = sanitize_questions([{"text": "Savol", "options": ["A", "B"],
                                        "correctAnswer": "C"}])
        self.assertEqual(out, [])
        self.assertIn("to'g'ri javob", bad[0])

    def test_duplicate_options_rejected(self):
        # Bir xil ikki variant — qaysi biri to'g'ri ekani noaniq, apellyatsiya sababi.
        out, bad = sanitize_questions([{"text": "Savol", "options": ["Ha", "ha", "Yo'q"],
                                        "correctAnswer": "Ha"}])
        self.assertEqual(out, [])
        self.assertIn("bir xil variant", bad[0])

    def test_repeated_question_dropped_once(self):
        out, bad = sanitize_questions([
            {"text": "Bir xil savol", "options": ["A", "B"], "correctAnswer": "A"},
            {"text": "bir xil   savol!", "options": ["A", "B"], "correctAnswer": "B"},
        ])
        self.assertEqual(len(out), 1)
        self.assertIn("takrorlangan", bad[0])

    def test_too_few_options_and_empty_text(self):
        out, bad = sanitize_questions([
            {"text": "", "options": ["A", "B"], "correctAnswer": "A"},
            {"text": "Savol", "options": ["A"], "correctAnswer": "A"},
        ])
        self.assertEqual(out, [])
        self.assertEqual(len(bad), 2)

    def test_merge_banks_skips_existing(self):
        cur = [{"text": "Eski", "options": ["A", "B"], "correctAnswer": "A"}]
        new = [{"text": "Eski", "options": ["A", "B"], "correctAnswer": "B"},
               {"text": "Yangi", "options": ["A", "B"], "correctAnswer": "B"}]
        out, problems = merge_banks(cur, new)
        self.assertEqual([q["text"] for q in out], ["Eski", "Yangi"])
        self.assertEqual([q["id"] for q in out], [1, 2])
        self.assertTrue(any("takrorlangan" in p for p in problems))


class ExamCreateValidationTests(TestCase):
    def setUp(self):
        self.admin = AppUser.objects.create(id="q-admin", role="admin", name="Admin",
                                            password=_hash_pw("Parol12345!"))
        self.admin.is_authenticated = True
        lvl = Level.objects.create(name="Kurs")
        self.group = Group.objects.create(name="G", level=lvl)
        self.f = APIRequestFactory()

    def _create(self, questions):
        from apps.api.views.admin import admin_exams

        now = timezone.now()
        req = self.f.post("/api/admin/exams", {
            "title": "Sinov imtihoni",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=2)).isoformat(),
            "duration_minutes": 30,
            "group_ids": [self.group.id],
            "manual_questions": json.dumps(questions),
        }, format="json")
        force_authenticate(req, user=self.admin)
        return admin_exams(req)

    def test_broken_questions_are_refused(self):
        res = self._create([{"text": "Savol", "options": ["A", "B"], "correctAnswer": "C"}])
        self.assertEqual(res.status_code, 400, res.data)
        self.assertFalse(Exam.objects.exists())

    def test_good_questions_are_stored_with_ids(self):
        res = self._create([{"text": "To'g'ri savol", "options": ["A", "B"], "answer": "A"}])
        self.assertEqual(res.status_code, 200, res.data)
        bank = json.loads(Exam.objects.get().questions_json)
        self.assertEqual(bank[0]["id"], 1)
        self.assertEqual(bank[0]["correctAnswer"], "A")


class OneExamAtATimeTests(TestCase):
    def setUp(self):
        self.owner = AppUser.objects.create(id="oe-admin", role="admin", name="Admin")
        lvl = Level.objects.create(name="Kurs")
        self.group = Group.objects.create(name="G2", level=lvl)
        self.user = AppUser.objects.create(id="oe-student", role="student", name="Talaba",
                                           group=self.group)
        self.user.is_authenticated = True
        self.f = APIRequestFactory()

    def _exam(self, **kw):
        now = timezone.now()
        d = dict(teacher=self.owner, title="Imtihon", start_time=now - timedelta(minutes=5),
                 end_time=now + timedelta(hours=2), duration_minutes=60,
                 questions_json=json.dumps([{"id": 1, "text": "S", "options": ["A", "B"],
                                             "correctAnswer": "A"}]))
        d.update(kw)
        e = Exam.objects.create(**d)
        ExamGroup.objects.create(exam=e, group=self.group)
        return e

    def _start(self, exam):
        from apps.api.views.student import _student_exams_start_impl

        req = self.f.post("/x", {}, format="json")
        force_authenticate(req, user=self.user)
        return _student_exams_start_impl(req, pk=exam.id)

    def test_second_exam_is_refused_while_first_runs(self):
        a, b = self._exam(title="Birinchi"), self._exam(title="Ikkinchi")
        StudentExam.objects.create(student=self.user, exam=a, status="In Progress",
                                   started_at=timezone.now(), access_granted=True)
        res = self._start(b)
        self.assertEqual(res.status_code, 409, getattr(res, "data", None))
        self.assertEqual(res.data["code"], "ANOTHER_EXAM_IN_PROGRESS")
        self.assertIn("Birinchi", res.data["error"])

    def test_resuming_the_same_exam_is_allowed(self):
        a = self._exam(title="Birinchi")
        StudentExam.objects.create(student=self.user, exam=a, status="In Progress",
                                   started_at=timezone.now(), access_granted=True)
        res = self._start(a)
        self.assertNotEqual(getattr(res, "status_code", 200), 409)

    def test_abandoned_expired_session_does_not_block(self):
        old = self._exam(title="Eski", start_time=timezone.now() - timedelta(days=2),
                         end_time=timezone.now() - timedelta(days=1))
        new = self._exam(title="Yangi")
        StudentExam.objects.create(student=self.user, exam=old, status="In Progress",
                                   started_at=timezone.now() - timedelta(days=2),
                                   access_granted=True)
        with mock.patch("apps.api.views.student._try_start_lock", return_value=True), \
             mock.patch("apps.api.views.student._release_start_lock"):
            res = self._start(new)
        self.assertNotEqual(getattr(res, "status_code", 200), 409)
        self.assertEqual(StudentExam.objects.get(exam=old).status, "Completed")


class ExamEditDuringExamTests(TestCase):
    """Imtihon davom etayotganda xavfli tahrir to'xtatiladi."""

    def setUp(self):
        self.admin = AppUser.objects.create(id="ed-admin", role="admin", name="Admin")
        self.admin.is_authenticated = True
        lvl = Level.objects.create(name="Kurs")
        self.group = Group.objects.create(name="G3", level=lvl)
        self.student = AppUser.objects.create(id="ed-student", role="student", name="Talaba",
                                              group=self.group)
        now = timezone.now()
        self.exam = Exam.objects.create(
            teacher=self.admin, title="Imtihon", start_time=now - timedelta(minutes=10),
            end_time=now + timedelta(hours=3), duration_minutes=90,
            questions_json=json.dumps([{"id": 1, "text": "S", "options": ["A", "B"],
                                        "correctAnswer": "A"}]))
        ExamGroup.objects.create(exam=self.exam, group=self.group)
        StudentExam.objects.create(student=self.student, exam=self.exam, status="In Progress",
                                   started_at=now, access_granted=True)
        self.f = APIRequestFactory()

    def _patch(self, **body):
        from apps.api.views.admin import admin_exam_detail

        now = timezone.now()
        payload = {
            "title": "Imtihon",
            "start_time": (now - timedelta(minutes=10)).isoformat(),
            "end_time": (now + timedelta(hours=3)).isoformat(),
            "duration_minutes": 90,
        }
        payload.update(body)
        req = self.f.patch("/x", payload, format="json")
        force_authenticate(req, user=self.admin)
        return admin_exam_detail(req, pk=self.exam.id)

    def test_shortening_the_window_is_blocked(self):
        # Oyna davomiylikdan katta bo'lib qoladi (95 daq > 90), lekin avvalgisidan qisqa.
        res = self._patch(end_time=(timezone.now() + timedelta(minutes=95)).isoformat())
        self.assertEqual(res.status_code, 409, getattr(res, "data", None))
        self.assertEqual(res.data["code"], "EXAM_IN_PROGRESS")
        self.exam.refresh_from_db()
        self.assertGreater(self.exam.end_time, timezone.now() + timedelta(hours=2))

    def test_shortening_duration_is_blocked(self):
        res = self._patch(duration_minutes=30)
        self.assertEqual(res.status_code, 409)
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.duration_minutes, 90)

    def test_force_lets_the_admin_through(self):
        res = self._patch(duration_minutes=30, force=True)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.duration_minutes, 30)

    def test_harmless_edit_is_allowed(self):
        res = self._patch(title="Yangi nom", end_time=(timezone.now() + timedelta(hours=5)).isoformat())
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.title, "Yangi nom")
