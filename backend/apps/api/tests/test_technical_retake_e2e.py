"""Qoidabuzarlik → qayta topshirish API E2E."""
from __future__ import annotations

import copy
import json
import os
from datetime import timedelta
from unittest import mock

import bcrypt
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone as dj_tz
from rest_framework.test import APIClient

from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam, ViolationLog

PROFILE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
    "2wBDAQwSERMWGR8lJx8lPz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09P//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
)

QUESTIONS = [{"id": 1, "text": "2+2=?", "options": ["3", "4", "5", "6"], "correctAnswer": "4"}]


def _rf_throttle_off():
    from django.conf import settings

    rf = copy.deepcopy(settings.REST_FRAMEWORK)
    rf["DEFAULT_THROTTLE_CLASSES"] = []
    rf["DEFAULT_THROTTLE_RATES"] = {"login": "100000/h", "violations": "100000/h"}
    return rf


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class ExamRetakeE2ETests(TestCase):
    def setUp(self):
        cache.clear()
        self._env = mock.patch.dict(
            os.environ,
            {
                "VAC_HMAC_GUARD": "0",
                "VAC_SEQ_GUARD": "0",
                "VAC_CHALLENGE_GUARD": "0",
                "IDENTITY_VERIFY_REQUIRED": "0",
                "PROCTOR_STARTUP_GRACE_SECONDS": "0",
                "PROCTOR_WARN_SUPPRESS_SECONDS": "5",
                "PROCTOR_EVENT_MIN_INTERVAL_SECONDS": "1",
                "PROCTOR_MAX_WARNINGS_BEFORE_BAN": "3",
            },
            clear=False,
        )
        self._env.start()
        self.addCleanup(self._env.stop)

        self.client = APIClient()
        self.client.defaults["HTTP_X_DEVICE_FINGERPRINT"] = "e2e-device-fp"
        self.level = Level.objects.create(name="E2E level")
        self.group = Group.objects.create(name="E2E group", level=self.level)

        hp_s = bcrypt.hashpw(b"student-e2e", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.student = AppUser.objects.create(
            id="e2e_student", password=hp_s, role="student", name="E2E Student",
            status="Active", group_id=self.group.id, profile_image=PROFILE,
        )
        hp_a = bcrypt.hashpw(b"admin-e2e", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.admin = AppUser.objects.create(
            id="e2e_admin", password=hp_a, role="admin", name="E2E Admin", status="Active", group_id=self.group.id,
        )
        hp_t = bcrypt.hashpw(b"staff-e2e", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.staff = AppUser.objects.create(
            id="e2e_staff", password=hp_t, role="staff", name="E2E Staff", status="Active", group_id=self.group.id,
        )
        self.student_token = self._login("e2e_student", "student-e2e")
        self.admin_token = self._login("e2e_admin", "admin-e2e")
        self.staff_token = self._login("e2e_staff", "staff-e2e")

    def _login(self, user_id: str, password: str) -> str:
        r = self.client.post("/api/auth/login", {"id": user_id, "password": password}, format="json")
        self.assertEqual(r.status_code, 200)
        return r.json()["token"]

    def _create_exam(self, *, retakes: int = 3) -> Exam:
        now = dj_tz.now()
        exam = Exam.objects.create(
            teacher_id=self.staff.id,
            title="E2E retake",
            start_time=now - timedelta(minutes=5),
            end_time=now + timedelta(hours=2),
            duration_minutes=45,
            questions_json=json.dumps(QUESTIONS),
            language="uz",
            exam_mode="static",
            technical_retakes_allowed=retakes,
            identity_retakes_allowed=1,
        )
        ExamGroup.objects.create(exam=exam, group=self.group)
        return exam

    def _start_session(self, exam_id: int) -> None:
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(r.status_code, 200)
        dt = r.json().get("deviceToken")
        if dt:
            self.client.defaults["HTTP_X_DEVICE_SESSION_TOKEN"] = dt
        StudentExam.objects.filter(student_id=self.student.id, exam_id=exam_id).update(
            started_at=dj_tz.now() - timedelta(minutes=3)
        )

    def _post_violation(self, exam_id: int, vtype: str) -> dict:
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": exam_id, "violation_type": vtype, "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        return r.json()

    def _advance_warning_merge(self, exam_id: int) -> None:
        StudentExam.objects.filter(student_id=self.student.id, exam_id=exam_id).update(
            proctor_last_warning_at=dj_tz.now() - timedelta(seconds=61)
        )
        ViolationLog.objects.filter(student_id=self.student.id, exam_id=exam_id).update(
            timestamp=dj_tz.now() - timedelta(seconds=120)
        )

    def test_e2e_three_warnings_then_retake_on_third(self):
        exam = self._create_exam(retakes=3)
        self._start_session(exam.id)
        for step in range(2):
            body = self._post_violation(exam.id, "TAB_SWITCH_SOFT")
            self.assertFalse(body.get("banned"))
            self.assertFalse(body.get("examRetake"))
            self._advance_warning_merge(exam.id)

        body3 = self._post_violation(exam.id, "TAB_SWITCH_SOFT")
        self.assertFalse(body3.get("banned"))
        self.assertTrue(body3.get("examRetake"))
        self.assertEqual(body3.get("retakesRemaining"), 2)
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam.id)
        self.assertEqual(se.status, "Pending")
        self.assertEqual(se.technical_retakes_used, 1)

    def _identity_policy(self, *, no_retake=None):
        """Shaxs almashtirish siyosatini kod standartiga qotiradi.

        PROCTOR_IDENTITY_BAN_MAX_SCORE=0.10 (kod standarti) — faqat yuz mosligi
        balli shundan past (butunlay boshqa odam) bo'lsa jazo; chegaraviy ball
        admin ko'rib chiqishiga ketadi. PROCTOR_NO_RETAKE_VIOLATIONS: None —
        kod standarti (DELIBERATE_CHEAT_VIOLATIONS, identity ham ichida).
        """
        p = mock.patch.dict(
            os.environ,
            {
                "PROCTOR_IDENTITY_BAN_MAX_SCORE": "0.10",
                "PROCTOR_AUTO_BAN_IDENTITY": "1",
                "VAC_STRICT_MODE": "1",
            },
            clear=False,
        )
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("PROCTOR_INSTANT_BAN_VIOLATIONS", None)
        if no_retake is None:
            os.environ.pop("PROCTOR_NO_RETAKE_VIOLATIONS", None)
        else:
            os.environ["PROCTOR_NO_RETAKE_VIOLATIONS"] = no_retake

    def _set_identity_score(self, exam_id: int, score) -> None:
        StudentExam.objects.filter(student_id=self.student.id, exam_id=exam_id).update(
            identity_last_score=score
        )

    def test_e2e_identity_retake_once_then_ban(self):
        """Standart siyosat: aniq shaxs almashtirish (ball < 0.10) — retake'siz DARHOL ban.

        identity_retakes_allowed=1 bo'lsa ham: IDENTITY_SUBSTITUTION ataylab
        chiterlik (DELIBERATE_CHEAT_VIOLATIONS) — ikkinchi imkoniyat berilmaydi.
        """
        self._identity_policy()
        exam = self._create_exam(retakes=3)
        self._start_session(exam.id)
        self._set_identity_score(exam.id, 0.02)
        body = self._post_violation(exam.id, "IDENTITY_SUBSTITUTION")
        self.assertTrue(body.get("banned"), body)
        self.assertFalse(body.get("examRetake"), body)
        self.assertEqual(body.get("banReason"), "IDENTITY")
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam.id)
        self.assertEqual(se.status, "Banned")
        self.assertEqual(se.ban_reason, "IDENTITY")
        self.assertEqual(se.identity_retakes_used, 0)

        r_start = self.client.post(f"/api/student/exams/{exam.id}/start", {"pin": ""}, format="json")
        self.assertEqual(r_start.status_code, 403)

    def test_e2e_identity_borderline_score_is_review_not_ban(self):
        """Chegaraviy ball (yoki ball yo'q) — ban emas: qayd (outcome=review), sessiya davom etadi."""
        self._identity_policy()
        exam = self._create_exam(retakes=3)
        self._start_session(exam.id)
        for score in (0.25, None):
            self._set_identity_score(exam.id, score)
            body = self._post_violation(exam.id, "IDENTITY_SUBSTITUTION")
            self.assertFalse(body.get("banned"), (score, body))
            self.assertTrue(body.get("identityReview"), (score, body))
            self.assertTrue(body.get("warningSuppressed"), (score, body))
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam.id)
        self.assertEqual(se.status, "In Progress")
        self.assertEqual(int(se.proctor_official_warnings or 0), 0)
        self.assertEqual(se.identity_retakes_used, 0)
        # 60 soniya ichidagi takror qayd qilinmaydi — bitta review yozuvi.
        logs = ViolationLog.objects.filter(
            student_id=self.student.id, exam_id=exam.id, violation_type="IDENTITY_SUBSTITUTION"
        )
        self.assertEqual(logs.count(), 1)
        self.assertEqual(logs.first().outcome, "review")

    def test_e2e_identity_retake_once_then_ban_when_operator_allows_identity_retake(self):
        """Operator IDENTITY_SUBSTITUTION ni no-retake ro'yxatidan chiqarsa —
        identity_retakes_allowed=1: birinchi marta retake, ikkinchisida ban."""
        self._identity_policy(no_retake="FORBIDDEN_OBJECT_CELL_PHONE")
        exam = self._create_exam(retakes=3)
        self._start_session(exam.id)
        self._set_identity_score(exam.id, 0.02)
        body1 = self._post_violation(exam.id, "IDENTITY_SUBSTITUTION")
        self.assertTrue(body1.get("examRetake"), body1)
        self.assertTrue(body1.get("identityRetake"))
        self.assertFalse(body1.get("banned"))
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam.id)
        self.assertEqual(se.identity_retakes_used, 1)
        self.assertEqual(se.status, "Pending")

        self._start_session(exam.id)
        self._set_identity_score(exam.id, 0.02)
        body2 = self._post_violation(exam.id, "IDENTITY_SUBSTITUTION")
        self.assertTrue(body2.get("banned"), body2)
        self.assertEqual(body2.get("banReason"), "IDENTITY")
        se.refresh_from_db()
        self.assertEqual(se.status, "Banned")
        self.assertEqual(se.ban_reason, "IDENTITY")

        r_start = self.client.post(f"/api/student/exams/{exam.id}/start", {"pin": ""}, format="json")
        self.assertEqual(r_start.status_code, 403)

    def test_e2e_staff_grant_and_retake_for_completed(self):
        exam = self._create_exam(retakes=0)
        self._start_session(exam.id)
        for step in range(2):
            self._post_violation(exam.id, "FACE_NOT_VISIBLE")
            self._advance_warning_merge(exam.id)
        body = self._post_violation(exam.id, "FACE_NOT_VISIBLE")
        self.assertTrue(body.get("banned"))
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam.id)

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.staff_token}")
        r_grant = self.client.post(f"/api/admin/student_exams/{se.id}/grant-technical-retakes", {}, format="json")
        self.assertEqual(r_grant.status_code, 200)
        se.refresh_from_db()
        self.assertEqual(se.status, "Pending")

        # Completed pastki ball — faqat manual retake
        se.status = "Completed"
        se.score = 30
        se.save(update_fields=["status", "score"])
        r_retake = self.client.post(f"/api/admin/student_exams/{se.id}/retake", {}, format="json")
        self.assertEqual(r_retake.status_code, 200)
        se.refresh_from_db()
        self.assertEqual(se.status, "Pending")
        self.assertIsNone(se.score)
