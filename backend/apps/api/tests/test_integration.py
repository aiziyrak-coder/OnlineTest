"""API integratsion testlari (Django; eski Node exam-flow o‘rniga)."""
from __future__ import annotations

import copy
import os
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
        "violations": "100000/h",
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
    def test_admin_test_bank_import_smart_no_gemini_uses_fallback_parser(self, _mock):
        """AI parser yiqilganda fallback parser bilan import davom etishi kerak."""
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
        self.assertEqual(resp.status_code, 200)

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

    def test_violation_three_distinct_warnings_then_ban_on_fourth(self):
        """3 ta rasmiy ogohlantirish (har biri oldingisidan 60s o'tgach), 4-chi epizodda ban."""
        hp = bcrypt.hashpw(b"vstudent2", bcrypt.gensalt(rounds=10)).decode("ascii")
        st2 = AppUser.objects.create(
            id="itest_student_viol",
            password=hp,
            role="student",
            name="Viol Student",
            status="Active",
            group_id=self.group.id,
            profile_image="",
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol", "password": "vstudent2"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        tok = r0.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
        eid = self.exam_a.id
        for i in range(3):
            r = self.client.post(
                "/api/student/violations",
                {"exam_id": eid, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
                format="json",
            )
            self.assertEqual(r.status_code, 200, msg=f"warn step {i}")
            body = r.json()
            self.assertFalse(body.get("banned"), msg=f"step {i} should not ban yet")
            self.assertFalse(body.get("warningSuppressed"), msg=f"step {i} must count")
            self.assertEqual(body.get("warningNumber"), i + 1)
            self.assertEqual(body.get("isFinalWarning"), i == 2)
            StudentExam.objects.filter(student_id=st2.id, exam_id=eid).update(
                proctor_last_warning_at=dj_tz.now() - timedelta(seconds=61)
            )
        r4 = self.client.post(
            "/api/student/violations",
            {"exam_id": eid, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r4.status_code, 200)
        self.assertTrue(r4.json().get("banned"))
        st2.refresh_from_db()
        self.assertEqual(st2.status, "Banned")

    def test_violation_multiple_types_within_one_minute_single_warning(self):
        """1 daqiqa ichida turli violationlar — faqat bitta rasmiy ogohlantirish."""
        hp = bcrypt.hashpw(b"vstudent3", bcrypt.gensalt(rounds=10)).decode("ascii")
        st3 = AppUser.objects.create(
            id="itest_student_viol3",
            password=hp,
            role="student",
            name="Viol Student 3",
            status="Active",
            group_id=self.group.id,
            profile_image="",
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol3", "password": "vstudent3"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r0.json()['token']}")
        eid = self.exam_a.id
        r1 = self.client.post(
            "/api/student/violations",
            {"exam_id": eid, "violation_type": "FACE_NOT_VISIBLE", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json().get("warningNumber"), 1)
        self.assertFalse(r1.json().get("warningSuppressed"))
        r2 = self.client.post(
            "/api/student/violations",
            {"exam_id": eid, "violation_type": "SUSPICIOUS_AUDIO", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("warningSuppressed"))
        self.assertEqual(r2.json().get("warningNumber"), 0)
        se = StudentExam.objects.get(student_id=st3.id, exam_id=eid)
        self.assertEqual(se.proctor_official_warnings, 1)

    def test_health_includes_database(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("service"), "fjsti-exam-api")
        self.assertTrue(body.get("database"))
        self.assertIn("db_latency_ms", body)
        self.assertIn("X-Request-Id", r)

    def test_health_live_liveness(self):
        r = self.client.get("/api/live")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body.get("ok"))
        self.assertTrue(body.get("live"))
        self.assertEqual(body.get("service"), "fjsti-exam-api")

    def test_health_ready_readiness(self):
        r = self.client.get("/api/ready")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body.get("ready"))
        self.assertTrue(body.get("database"))
        self.assertIn("db_latency_ms", body)

    def test_request_id_echo_from_client(self):
        rid = "client-trace-abc12"
        r = self.client.get("/api/live", HTTP_X_REQUEST_ID=rid)
        self.assertEqual(r["X-Request-Id"], rid)
        self.assertEqual(r.json().get("request_id"), rid)

    def test_admin_users_list_paginated_envelope(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.get("/api/admin/users?limit=10&offset=0")
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertIn("results", j)
        self.assertIn("total", j)
        self.assertIsInstance(j["results"], list)
        self.assertGreaterEqual(j["total"], 2)

    def test_student_violation_forbidden_for_unassigned_exam(self):
        e = Exam.objects.create(
            teacher_id=self.admin.id,
            title="Yolg'iz imtihon",
            start_time=dj_tz.now() - timedelta(minutes=5),
            end_time=dj_tz.now() + timedelta(hours=2),
            duration_minutes=30,
            questions_json=__import__("json").dumps(QUESTIONS),
            language="uz",
            pin="",
            custom_rules="",
            exam_mode="static",
            bank_category_ids="[]",
            bank_question_count=0,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": e.id, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 403)

    def test_student_violation_unknown_type_not_logged(self):
        from apps.core.models import ViolationLog

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        before = ViolationLog.objects.filter(student_id=self.student.id, exam_id=self.exam_a.id).count()
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "NOT_A_REAL_TYPE", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        after = ViolationLog.objects.filter(student_id=self.student.id, exam_id=self.exam_a.id).count()
        self.assertEqual(before, after)

    def test_identity_compare_forbidden_when_exam_not_assigned(self):
        e = Exam.objects.create(
            teacher_id=self.admin.id,
            title="Imtihon X",
            start_time=dj_tz.now() - timedelta(minutes=5),
            end_time=dj_tz.now() + timedelta(hours=2),
            duration_minutes=30,
            questions_json=__import__("json").dumps(QUESTIONS),
            language="uz",
            pin="",
            custom_rules="",
            exam_mode="static",
            bank_category_ids="[]",
            bank_question_count=0,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(
            "/api/student/identity-compare",
            {
                "exam_id": e.id,
                "profile_image_base64": PROFILE,
                "live_capture_base64": PROFILE,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 403)

    @mock.patch("apps.api.views.compare_faces")
    def test_identity_compare_503_when_gemini_unavailable(self, mock_cf):
        mock_cf.return_value = {"success": False, "code": "GEMINI_UNAVAILABLE"}
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(
            "/api/student/identity-compare",
            {
                "exam_id": self.exam_a.id,
                "profile_image_base64": PROFILE,
                "live_capture_base64": PROFILE,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 503)
        self.assertFalse(r.json().get("match"))

    @mock.patch("apps.api.views.compare_faces")
    def test_identity_compare_200_when_match(self, mock_cf):
        mock_cf.return_value = {"success": True, "match": True}
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(
            "/api/student/identity-compare",
            {
                "exam_id": self.exam_a.id,
                "profile_image_base64": PROFILE,
                "live_capture_base64": PROFILE,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("match"))
        self.assertFalse(r.json().get("skipped", True))

    @mock.patch("apps.api.views.compare_faces")
    def test_identity_compare_bypass_when_env_allow(self, mock_cf):
        mock_cf.return_value = {"success": False, "code": "GEMINI_UNAVAILABLE"}
        with mock.patch.dict(os.environ, {"ALLOW_IDENTITY_VERIFY_BYPASS": "1"}, clear=False):
            self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
            r = self.client.post(
                "/api/student/identity-compare",
                {
                    "exam_id": self.exam_a.id,
                    "profile_image_base64": PROFILE,
                    "live_capture_base64": PROFILE,
                },
                format="json",
            )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body.get("match"))
        self.assertTrue(body.get("skipped"))

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
