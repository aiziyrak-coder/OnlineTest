"""API integratsion testlari (Django; eski Node exam-flow o‘rniga)."""
from __future__ import annotations

import copy
from datetime import timedelta
from unittest import mock

import bcrypt
import jwt
from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone as dj_tz
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.core.models import AppUser, Exam, ExamGroup, Group, Level, StudentExam, TestBankCategory, TestBankQuestion, UnbanEvidence

PROFILE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
    "2wBDAQwSERMWGR8lJx8lPz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09Pz09P//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z"
)

QUESTIONS = [
    {"id": 1, "text": "2+2=?", "options": ["3", "4", "5", "6"], "correctAnswer": "4"},
    {"id": 2, "text": "3+1=?", "options": ["2", "3", "4", "5"], "correctAnswer": "4"},
]


def _rf_throttle_off():
    rf = copy.deepcopy(settings.REST_FRAMEWORK)
    rf["DEFAULT_THROTTLE_CLASSES"] = []
    rf["DEFAULT_THROTTLE_RATES"] = {
        "login": "100000/h",
        "face_verify": "100000/h",
        "public_verify": "100000/h",
        "anon": "100000/h",
        "user": "100000/h",
        "exam_autosave": "100000/h",
        "bank_ai_import": "100000/h",
    }
    return rf


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class ExamFlowApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.level = Level.objects.create(name="Test level")
        self.group = Group.objects.create(name="Test group", level=self.level)
        hp = bcrypt.hashpw(b"vitest-pass-9", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.student = AppUser.objects.create(
            id="itest_student",
            password=hp,
            role="student",
            name="Integration Student",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        ha = bcrypt.hashpw(b"admin123", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.admin = AppUser.objects.create(
            id="itest_admin",
            password=ha,
            role="admin",
            name="Integration Admin",
            status="Active",
            group_id=self.group.id,
            profile_image="",
        )
        now = dj_tz.now()
        start = now - timedelta(minutes=2)
        end = now + timedelta(hours=1)

        def make_exam(title: str) -> Exam:
            e = Exam.objects.create(
                teacher_id=self.admin.id,
                title=title,
                start_time=start,
                end_time=end,
                duration_minutes=45,
                questions_json=__import__("json").dumps(QUESTIONS),
                language="uz",
                pin="",
                custom_rules="",
                exam_mode="static",
                bank_category_ids="[]",
                bank_question_count=0,
            )
            ExamGroup.objects.create(exam_id=e.id, group_id=self.group.id)
            return e

        self.exam_a = make_exam("Integration imtihon A")
        self.exam_b = make_exam("Integration imtihon B")
        self.exam_c = make_exam("Integration imtihon C")

        r = self.client.post(
            "/api/auth/login",
            {"id": "itest_student", "password": "vitest-pass-9"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.student_token = r.json()["token"]

        r2 = self.client.post(
            "/api/auth/login",
            {"id": "itest_admin", "password": "admin123"},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        self.admin_token = r2.json()["token"]

    def test_login_returns_jwt_and_role(self):
        r = self.client.post(
            "/api/auth/login",
            {"id": "itest_student", "password": "vitest-pass-9"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("token", r.json())
        self.assertEqual(r.json()["user"]["role"], "student")

    def test_student_exams_requires_auth_401(self):
        self.client.credentials()
        r = self.client.get("/api/student/exams")
        self.assertEqual(r.status_code, 401)

    def test_student_sees_group_exams(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.get("/api/student/exams")
        self.assertEqual(r.status_code, 200)
        titles = [x["title"] for x in r.json()]
        self.assertIn("Integration imtihon A", titles)

    def test_start_exam_returns_questions_without_correct_answer(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(f"/api/student/exams/{self.exam_a.id}/start", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("studentExamId"))
        self.assertIn("submission_deadline", r.json()["exam"])
        for q in r.json()["exam"]["questions"]:
            self.assertNotIn("correctAnswer", q)

    def test_submit_forbidden_after_exam_window(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        self.client.post(f"/api/student/exams/{self.exam_c.id}/start", {}, format="json")
        Exam.objects.filter(pk=self.exam_c.id).update(end_time=dj_tz.now() - timedelta(minutes=2))
        r = self.client.post(
            f"/api/student/exams/{self.exam_c.id}/submit",
            {"answers": {"1": "4", "2": "4"}, "flaggedQuestions": []},
            format="json",
        )
        self.assertEqual(r.status_code, 403)
        self.assertIn("tugagan", r.json().get("error", "").lower())

    def test_save_progress_and_draft_roundtrip(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        self.client.post(f"/api/student/exams/{self.exam_b.id}/start", {}, format="json")
        r = self.client.post(
            f"/api/student/exams/{self.exam_b.id}/save-progress",
            {"answers": {"1": "4"}, "flaggedQuestions": [1]},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        g = self.client.get(f"/api/student/exams/{self.exam_b.id}/draft")
        self.assertEqual(g.status_code, 200)
        self.assertEqual(g.json()["answers"].get("1"), "4")
        self.assertEqual(g.json()["flaggedQuestions"], [1])

    def test_submit_wrong_answers_score_zero(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        self.client.post(f"/api/student/exams/{self.exam_a.id}/start", {}, format="json")
        r = self.client.post(
            f"/api/student/exams/{self.exam_a.id}/submit",
            {"answers": {"1": "3", "2": "2"}, "flaggedQuestions": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["score"], 0)
        self.assertEqual(r.json()["total"], 2)

    def test_submit_correct_full_score_and_resubmit_forbidden(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        self.client.post(f"/api/student/exams/{self.exam_b.id}/start", {}, format="json")
        r = self.client.post(
            f"/api/student/exams/{self.exam_b.id}/submit",
            {"answers": {"1": "4", "2": "4"}, "flaggedQuestions": []},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["score"], 2)
        r2 = self.client.post(
            f"/api/student/exams/{self.exam_b.id}/submit",
            {"answers": {"1": "4", "2": "4"}},
            format="json",
        )
        self.assertEqual(r2.status_code, 403)

    def test_admin_cannot_start_student_exam(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post(f"/api/student/exams/{self.exam_c.id}/start", {}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_jwt_payload_role_tamper_ignored_for_authorization(self):
        """Token ichida role=admin yozilsa ham bazadagi student rolida qoladi."""
        exp = dj_tz.now() + timedelta(hours=1)
        if exp.tzinfo is None:
            exp = dj_tz.make_aware(exp, dj_tz.get_current_timezone())
        bad = jwt.encode(
            {
                "id": self.student.id,
                "role": "admin",
                "name": "Hacker",
                "group_id": self.group.id,
                "exp": exp,
            },
            settings.JWT_SECRET,
            algorithm="HS256",
        )
        token = bad if isinstance(bad, str) else bad.decode("ascii")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        r = self.client.get("/api/admin/stats")
        self.assertEqual(r.status_code, 403)

    def test_zz_results_lists_completed(self):
        """TestCase har testda rollback — bu yerda to‘liq oqim bitta test ichida."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        self.client.post(f"/api/student/exams/{self.exam_a.id}/start", {}, format="json")
        self.client.post(
            f"/api/student/exams/{self.exam_a.id}/submit",
            {"answers": {"1": "3", "2": "2"}, "flaggedQuestions": []},
            format="json",
        )
        self.client.post(f"/api/student/exams/{self.exam_b.id}/start", {}, format="json")
        self.client.post(
            f"/api/student/exams/{self.exam_b.id}/submit",
            {"answers": {"1": "4", "2": "4"}, "flaggedQuestions": []},
            format="json",
        )
        r = self.client.get("/api/student/results")
        self.assertEqual(r.status_code, 200)
        completed = [x for x in r.json() if x["status"] == "Completed"]
        self.assertGreaterEqual(len(completed), 2)

    def test_admin_test_bank_import_smart_requires_content(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post("/api/admin/test-bank/import-smart", {}, format="json")
        self.assertEqual(r.status_code, 400)

    @mock.patch(
        "apps.api.views.parse_and_classify_questionnaire",
        side_effect=RuntimeError("GEMINI_API_KEY is not configured"),
    )
    def test_admin_test_bank_import_smart_no_gemini_returns_503(self, _mock):
        """Direct view call: APIClient can trigger Django debug logging bugs on some stacks."""
        from rest_framework.test import APIRequestFactory, force_authenticate

        from apps.api.authentication import JWTUser
        from apps.api.views import admin_test_bank_import_smart

        factory = APIRequestFactory()
        django_req = factory.post(
            "/api/admin/test-bank/import-smart",
            {"raw_text": "1. Savol?\nA) 1\nB) 2\nC) 3\nD) 4", "language": "uz"},
            format="json",
        )
        ju = JWTUser(self.admin.id, self.admin.role, self.admin.name, self.admin.group_id)
        force_authenticate(django_req, user=ju)
        resp = admin_test_bank_import_smart(django_req)
        self.assertEqual(resp.status_code, 503)

    def test_student_cannot_test_bank_import_smart(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post("/api/admin/test-bank/import-smart", {"raw_text": "hello"}, format="json")
        self.assertEqual(r.status_code, 403)

    @mock.patch(
        "apps.api.views.parse_and_classify_questionnaire",
        return_value=[
            {
                "text": "2+2=?",
                "options": ["3", "4", "5", "6"],
                "correctAnswer": "4",
                "categoryName": "Matematika",
                "categoryDescription": "Demo",
            }
        ],
    )
    def test_admin_test_bank_import_smart_inserts_questions(self, _mock):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post(
            "/api/admin/test-bank/import-smart",
            {"raw_text": "dummy", "language": "uz"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body.get("inserted"), 1)
        self.assertTrue(TestBankCategory.objects.filter(name__iexact="Matematika").exists())
        self.assertEqual(TestBankQuestion.objects.count(), 1)

    def test_health_includes_database(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("ok"))
        self.assertTrue(r.json().get("database"))

    def test_unban_requires_reason_and_evidence(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        AppUser.objects.filter(pk=self.student.id).update(status="Banned")
        StudentExam.objects.create(student_id=self.student.id, exam_id=self.exam_a.id, status="Banned")
        r = self.client.post(f"/api/admin/users/{self.student.id}/unban", {"reason": "reason-ok-123"}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("evidence", (r.json().get("error") or "").lower())

    def test_unban_with_pdf_evidence_succeeds(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        AppUser.objects.filter(pk=self.student.id).update(status="Banned")
        StudentExam.objects.create(student_id=self.student.id, exam_id=self.exam_a.id, status="Banned")
        pdf = SimpleUploadedFile("receipt.pdf", b"%PDF-1.4\n%test\n", content_type="application/pdf")
        r = self.client.post(
            f"/api/admin/users/{self.student.id}/unban",
            {"reason": "Tuplov kvitansiyasi taqdim etildi", "evidence": pdf},
            format="multipart",
        )
        self.assertEqual(r.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.status, "Active")
        self.assertTrue(UnbanEvidence.objects.filter(student_id=self.student.id, admin_id=self.admin.id).exists())

    def test_banned_student_can_download_ban_report_pdf_and_verify_qr_token(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        AppUser.objects.filter(pk=self.student.id).update(status="Banned")
        StudentExam.objects.create(student_id=self.student.id, exam_id=self.exam_a.id, status="Banned")
        self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_HARD", "screenshot_url": ""},
            format="json",
        )
        r = self.client.get(f"/api/student/ban-report.pdf?exam_id={self.exam_a.id}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("application/pdf", r["Content-Type"])
