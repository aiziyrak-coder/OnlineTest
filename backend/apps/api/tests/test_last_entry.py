"""Oxirgi kirish vaqti (Exam.last_entry_at).

Kun bo'yi navbat bilan topshiriladigan imtihonda oyna 17:00 da yopilsa ham
kirish ertaroq (masalan 15:45) to'xtaydi — aks holda oxirida kirgan odam
davomiylikni to'liq olmaydi. Boshlab bo'lingan sessiya bundan zarar
ko'rmasligi kerak.
"""
from __future__ import annotations

import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone as dj_tz
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam

QUESTIONS = [
    {"id": 1, "text": "Savol bir", "options": ["A", "B", "C", "D"], "correctAnswer": "A"},
    {"id": 2, "text": "Savol ikki", "options": ["A", "B", "C", "D"], "correctAnswer": "B"},
]


class LastEntryTests(TestCase):
    def setUp(self):
        self.level = Level.objects.create(name="Daraja")
        self.group = Group.objects.create(name="Guruh", level=self.level)
        self.admin = AppUser.objects.create(id="le-admin", role="admin", name="Admin")
        self.student = AppUser.objects.create(
            id="le-student", role="student", name="Talaba", status="Active",
            group_id=self.group.id, profile_image="data:image/png;base64," + "A" * 80,
        )
        self.student.is_authenticated = True
        now = dj_tz.now()
        self.exam = Exam.objects.create(
            teacher_id=self.admin.id, title="Kun bo'yi imtihon",
            start_time=now - timedelta(hours=3), end_time=now + timedelta(hours=2),
            duration_minutes=75, questions_json=json.dumps(QUESTIONS),
            language="uz", exam_mode="static", bank_category_ids="[]", bank_question_count=0,
        )
        ExamGroup.objects.create(exam_id=self.exam.id, group_id=self.group.id)
        self.f = APIRequestFactory()

    def _start(self):
        from apps.api.views.student import _student_exams_start_impl

        req = self.f.post("/x", {}, format="json")
        force_authenticate(req, user=self.student)
        req.user = self.student
        return _student_exams_start_impl(req, pk=self.exam.pk)

    def test_new_entry_is_refused_after_the_cutoff(self):
        self.exam.last_entry_at = dj_tz.now() - timedelta(minutes=5)
        self.exam.save(update_fields=["last_entry_at"])
        res = self._start()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("code"), "ENTRY_CLOSED")

    def test_entry_before_the_cutoff_is_not_blocked_by_it(self):
        self.exam.last_entry_at = dj_tz.now() + timedelta(minutes=30)
        self.exam.save(update_fields=["last_entry_at"])
        res = self._start()
        self.assertNotEqual(getattr(res, "data", {}).get("code"), "ENTRY_CLOSED")

    def test_a_session_already_in_progress_still_resumes_after_the_cutoff(self):
        StudentExam.objects.create(
            student_id=self.student.id, exam_id=self.exam.id, status="In Progress",
            started_at=dj_tz.now() - timedelta(minutes=10), access_granted=True,
            session_questions_json=json.dumps(QUESTIONS),
        )
        self.exam.last_entry_at = dj_tz.now() - timedelta(minutes=5)
        self.exam.save(update_fields=["last_entry_at"])
        res = self._start()
        self.assertNotEqual(getattr(res, "data", {}).get("code"), "ENTRY_CLOSED")

    def test_a_check_started_in_time_may_finish_after_the_cutoff(self):
        """15:44 da tekshiruvni boshlagan odam 15:48 da imkoniyatini yo'qotmasin."""
        cutoff = dj_tz.now() - timedelta(minutes=4)
        StudentExam.objects.create(
            student_id=self.student.id, exam_id=self.exam.id, status="Pending",
            access_granted=True, vac_consent_at=cutoff - timedelta(minutes=1),
        )
        self.exam.last_entry_at = cutoff
        self.exam.save(update_fields=["last_entry_at"])
        res = self._start()
        self.assertNotEqual(getattr(res, "data", {}).get("code"), "ENTRY_CLOSED")

    def test_the_grace_runs_out(self):
        cutoff = dj_tz.now() - timedelta(minutes=25)
        StudentExam.objects.create(
            student_id=self.student.id, exam_id=self.exam.id, status="Pending",
            access_granted=True, vac_consent_at=cutoff - timedelta(minutes=1),
        )
        self.exam.last_entry_at = cutoff
        self.exam.save(update_fields=["last_entry_at"])
        res = self._start()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("code"), "ENTRY_CLOSED")

    def test_a_consent_given_after_the_cutoff_earns_no_grace(self):
        cutoff = dj_tz.now() - timedelta(minutes=4)
        StudentExam.objects.create(
            student_id=self.student.id, exam_id=self.exam.id, status="Pending",
            access_granted=True, vac_consent_at=cutoff + timedelta(minutes=1),
        )
        self.exam.last_entry_at = cutoff
        self.exam.save(update_fields=["last_entry_at"])
        res = self._start()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("code"), "ENTRY_CLOSED")

    def test_without_the_field_nothing_changes(self):
        self.assertIsNone(self.exam.last_entry_at)
        res = self._start()
        self.assertNotEqual(getattr(res, "data", {}).get("code"), "ENTRY_CLOSED")

    def test_student_exam_list_reports_the_cutoff(self):
        from apps.api.views.student import student_exams_list

        at = dj_tz.now() + timedelta(minutes=30)
        self.exam.last_entry_at = at
        self.exam.save(update_fields=["last_entry_at"])
        req = self.f.get("/x")
        force_authenticate(req, user=self.student)
        res = student_exams_list(req)
        self.assertEqual(res.status_code, 200)
        row = next(r for r in res.data if r["id"] == self.exam.id)
        self.assertIsNotNone(row["last_entry_at"])

    def test_the_list_reports_the_grace_only_for_a_check_started_in_time(self):
        from apps.api.views.student import student_exams_list

        cutoff = dj_tz.now() - timedelta(minutes=2)
        se = StudentExam.objects.create(
            student_id=self.student.id, exam_id=self.exam.id, status="Pending",
            access_granted=True, vac_consent_at=cutoff - timedelta(minutes=1),
        )
        self.exam.last_entry_at = cutoff
        self.exam.save(update_fields=["last_entry_at"])
        req = self.f.get("/x")
        force_authenticate(req, user=self.student)
        row = next(r for r in student_exams_list(req).data if r["id"] == self.exam.id)
        self.assertIsNotNone(row["entry_grace_until"])

        # Rozilik cheklovdan KEYIN qo'yilgan bo'lsa muhlat berilmaydi.
        se.vac_consent_at = cutoff + timedelta(minutes=1)
        se.save(update_fields=["vac_consent_at"])
        req2 = self.f.get("/x")
        force_authenticate(req2, user=self.student)
        row2 = next(r for r in student_exams_list(req2).data if r["id"] == self.exam.id)
        self.assertIsNone(row2["entry_grace_until"])

    def test_admin_can_set_and_clear_the_cutoff(self):
        from apps.api.views.admin import admin_exam_detail

        self.admin.is_authenticated = True
        at = (dj_tz.now() + timedelta(minutes=45)).isoformat()
        req = self.f.patch("/x", {"last_entry_at": at}, format="json")
        force_authenticate(req, user=self.admin)
        with mock.patch("apps.api.views.admin.audit", lambda *a, **k: None):
            res = admin_exam_detail(req, pk=self.exam.pk)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.exam.refresh_from_db()
        self.assertIsNotNone(self.exam.last_entry_at)

        req2 = self.f.patch("/x", {"last_entry_at": ""}, format="json")
        force_authenticate(req2, user=self.admin)
        with mock.patch("apps.api.views.admin.audit", lambda *a, **k: None):
            res2 = admin_exam_detail(req2, pk=self.exam.pk)
        self.assertEqual(res2.status_code, 200, getattr(res2, "data", None))
        self.exam.refresh_from_db()
        self.assertIsNone(self.exam.last_entry_at)

    def test_cutoff_outside_the_window_is_clamped_into_it(self):
        from apps.api.views.admin import admin_exam_detail

        self.admin.is_authenticated = True
        far = (self.exam.end_time + timedelta(days=1)).isoformat()
        req = self.f.patch("/x", {"last_entry_at": far}, format="json")
        force_authenticate(req, user=self.admin)
        with mock.patch("apps.api.views.admin.audit", lambda *a, **k: None):
            res = admin_exam_detail(req, pk=self.exam.pk)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.exam.refresh_from_db()
        self.assertEqual(self.exam.last_entry_at, self.exam.end_time)
