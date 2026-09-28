"""Vaqti tugagan imtihonlarni avtomatik yakunlash (finalize_ended_exams) — unit testlar."""
from __future__ import annotations

import json
from datetime import timedelta

import bcrypt
from django.test import TestCase
from django.utils import timezone as dj_tz

from apps.api.tasks import run_finalize_ended_exams
from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam

QUESTIONS = [
    {"id": 1, "text": "2+2=?", "options": ["3", "4"], "correctAnswer": "4"},
    {"id": 2, "text": "3+1=?", "options": ["4", "5"], "correctAnswer": "4"},
]


class FinalizeEndedExamsTests(TestCase):
    def setUp(self):
        self.level = Level.objects.create(name="Fin level")
        self.group = Group.objects.create(name="Fin group", level=self.level)
        hp = bcrypt.hashpw(b"pass", bcrypt.gensalt(rounds=4)).decode("ascii")
        self.admin = AppUser.objects.create(
            id="fin_admin", password=hp, role="admin", name="Admin",
            status="Active", group_id=self.group.id, profile_image="",
        )
        # 3 talaba: kirib tugatmagan, retake-pending, umuman kirmagan.
        self.st_inprogress = AppUser.objects.create(
            id="fin_inprogress", password=hp, role="student", name="InProgress",
            status="Active", group_id=self.group.id, profile_image="",
        )
        self.st_pending = AppUser.objects.create(
            id="fin_pending", password=hp, role="student", name="Pending",
            status="Active", group_id=self.group.id, profile_image="",
        )
        self.st_absent = AppUser.objects.create(
            id="fin_absent", password=hp, role="student", name="Absent",
            status="Active", group_id=self.group.id, profile_image="",
        )
        now = dj_tz.now()
        # Vaqti ENDIGINA tugagan imtihon.
        self.exam = Exam.objects.create(
            teacher_id=self.admin.id,
            title="Ended exam",
            start_time=now - timedelta(hours=2),
            end_time=now - timedelta(minutes=1),
            duration_minutes=45,
            questions_json=json.dumps(QUESTIONS),
            language="uz",
        )
        ExamGroup.objects.create(exam_id=self.exam.id, group_id=self.group.id)

    def test_in_progress_finalized_with_draft_answers(self):
        se = StudentExam.objects.create(
            student_id=self.st_inprogress.id, exam_id=self.exam.id,
            status="In Progress", started_at=dj_tz.now() - timedelta(hours=1),
            draft_answers_json=json.dumps({"1": "4", "2": "5"}),  # 1 to'g'ri, 1 xato
            draft_flagged_json="[]",
        )
        out = run_finalize_ended_exams()
        se.refresh_from_db()
        self.assertEqual(se.status, "Completed")
        self.assertEqual(se.score, 1)
        # Sessiya muddati (started_at + 45 daqiqa) ham tugagan, shuning uchun uni
        # birinchi bosqich — run_finalize_expired_sessions() yopadi (guruhga
        # bog'liq bo'lmagan umumiy yo'l). Guruh bo'yicha skan unga qayta tegmaydi.
        self.assertEqual(out["expired_finalized"], 1)
        self.assertEqual(out["expired_failed"], 0)
        self.assertEqual(out["finalized"], 0)

    def test_in_progress_within_own_duration_finalized_by_exam_window(self):
        """Imtihon oynasi yopilgan, lekin sessiyaning O'Z muddati hali tugamagan —
        guruh bo'yicha skan (finalized hisoblagichi) yakunlaydi."""
        se = StudentExam.objects.create(
            student_id=self.st_inprogress.id, exam_id=self.exam.id,
            status="In Progress", started_at=dj_tz.now() - timedelta(minutes=10),
            draft_answers_json=json.dumps({"1": "4", "2": "4"}),
            draft_flagged_json="[]",
        )
        out = run_finalize_ended_exams()
        se.refresh_from_db()
        self.assertEqual(se.status, "Completed")
        self.assertEqual(se.score, 2)
        self.assertEqual(out["expired_finalized"] + out["finalized"], 1)

    def test_pending_retake_not_resumed_becomes_failed(self):
        se = StudentExam.objects.create(
            student_id=self.st_pending.id, exam_id=self.exam.id,
            status="Pending", started_at=None, technical_retakes_used=1,
        )
        run_finalize_ended_exams()
        se.refresh_from_db()
        self.assertEqual(se.status, "Failed")

    def test_absent_student_gets_failed_record(self):
        # st_absent uchun sessiya YO'Q.
        self.assertFalse(
            StudentExam.objects.filter(student_id=self.st_absent.id, exam_id=self.exam.id).exists()
        )
        out = run_finalize_ended_exams()
        se = StudentExam.objects.get(student_id=self.st_absent.id, exam_id=self.exam.id)
        self.assertEqual(se.status, "Failed")
        self.assertIsNone(se.started_at)
        self.assertIsNone(se.score)
        self.assertGreaterEqual(out["absent"], 1)

    def test_idempotent_no_duplicate_absent_records(self):
        run_finalize_ended_exams()
        run_finalize_ended_exams()
        self.assertEqual(
            StudentExam.objects.filter(student_id=self.st_absent.id, exam_id=self.exam.id).count(),
            1,
        )

    def test_completed_session_untouched(self):
        se = StudentExam.objects.create(
            student_id=self.st_inprogress.id, exam_id=self.exam.id,
            status="Completed", score=2, started_at=dj_tz.now() - timedelta(hours=1),
            completed_at=dj_tz.now() - timedelta(minutes=30),
        )
        run_finalize_ended_exams()
        se.refresh_from_db()
        self.assertEqual(se.status, "Completed")
        self.assertEqual(se.score, 2)

    def test_open_exam_not_finalized(self):
        # Vaqti hali tugamagan imtihon — tegilmaydi.
        now = dj_tz.now()
        open_exam = Exam.objects.create(
            teacher_id=self.admin.id, title="Open exam",
            start_time=now - timedelta(minutes=10), end_time=now + timedelta(hours=1),
            duration_minutes=45, questions_json=json.dumps(QUESTIONS), language="uz",
        )
        ExamGroup.objects.create(exam_id=open_exam.id, group_id=self.group.id)
        run_finalize_ended_exams()
        self.assertFalse(
            StudentExam.objects.filter(exam_id=open_exam.id, student_id=self.st_absent.id).exists()
        )
