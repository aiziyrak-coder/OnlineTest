"""Kadrlarni tozalash buyrug'i dalilni o'chirmasligi kerak."""
from __future__ import annotations

import json
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone as tz

from apps.core.models import AppUser, Exam, ScreenSnapshot, StudentExam, ViolationLog


class PruneSnapshotsTests(TestCase):
    def setUp(self):
        admin = AppUser.objects.create(id="ps-admin", role="admin", name="Admin")
        self.student = AppUser.objects.create(id="ps-student", role="student", name="Talaba")
        start = tz.now() - timedelta(days=120)
        self.exam = Exam.objects.create(
            teacher_id=admin.id, title="Eski imtihon", start_time=start,
            end_time=start + timedelta(hours=2), duration_minutes=60,
            questions_json=json.dumps([{"id": 1, "text": "S", "options": ["A", "B"],
                                        "correctAnswer": "A"}]),
            language="uz", exam_mode="static", bank_category_ids="[]", bank_question_count=0,
        )
        self.se = StudentExam.objects.create(
            student_id=self.student.id, exam_id=self.exam.id, status="Completed",
            started_at=start, score=10,
        )
        self.old = tz.now() - timedelta(days=100)
        # 20 ta eski kadr
        self.shots = [
            ScreenSnapshot.objects.create(student_exam=self.se, kind="screen",
                                          taken_at=self.old + timedelta(minutes=i), image="x" * 50)
            for i in range(20)
        ]
        # Qoida buzilishi 5-kadr vaqtida — atrofidagi kadrlar dalil
        self.viol_at = self.old + timedelta(minutes=5)
        ViolationLog.objects.create(student_id=self.student.id, exam_id=self.exam.id,
                                    violation_type="tab_switch", timestamp=self.viol_at)

    def _run(self, *args):
        out = StringIO()
        call_command("prune_snapshots", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_deletes_nothing(self):
        before = ScreenSnapshot.objects.count()
        txt = self._run("--days", "30")
        self.assertIn("Ko'rish rejimi", txt)
        self.assertEqual(ScreenSnapshot.objects.count(), before)

    def test_evidence_around_a_violation_survives(self):
        self._run("--days", "30", "--violation-window", "10", "--keep-per-session", "0", "--apply")
        qoldi = set(ScreenSnapshot.objects.values_list("taken_at", flat=True))
        # Buzilishdan 10 daqiqa ichidagi kadrlar qolishi kerak
        for s in self.shots:
            yaqin = abs((s.taken_at - self.viol_at).total_seconds()) <= 600
            if yaqin:
                self.assertIn(s.taken_at, qoldi, "dalil o'chib ketdi: %s" % s.taken_at)

    def test_the_last_frames_of_a_session_survive(self):
        self._run("--days", "30", "--violation-window", "0", "--keep-per-session", "3", "--apply")
        self.assertGreaterEqual(ScreenSnapshot.objects.filter(student_exam=self.se).count(), 3)

    def test_recent_frames_are_never_touched(self):
        yangi = ScreenSnapshot.objects.create(student_exam=self.se, kind="screen",
                                              taken_at=tz.now(), image="y" * 50)
        self._run("--days", "30", "--keep-per-session", "0", "--violation-window", "0", "--apply")
        self.assertTrue(ScreenSnapshot.objects.filter(pk=yangi.pk).exists())

    def test_old_frames_without_evidence_value_are_removed(self):
        self._run("--days", "30", "--keep-per-session", "0", "--violation-window", "0", "--apply")
        self.assertEqual(ScreenSnapshot.objects.filter(taken_at__lt=tz.now() - timedelta(days=30)).count(), 0)
