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

from apps.core.models import (
    AppUser,
    BanAppeal,
    BanAppealEvent,
    Exam,
    ExamGroup,
    Group,
    Level,
    StudentExam,
    TestBankCategory,
    TestBankQuestion,
    UnbanEvidence,
    ViolationLog,
)

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


#: Proktor eskalatsiya sozlamalarining KOD standarti. Konteyner (prod .env)
#: qiymatlari — masalan PROCTOR_MAX_WARNINGS_BEFORE_BAN=4, PROCTOR_HARDENED_MODE=0,
#: PROCTOR_IDENTITY_BAN_MAX_SCORE=0 — testga o'tib, qoidani emas muhitni
#: tekshirib qo'ymasin. Qoidaga bog'liq testlar shu qiymatlarni aniq o'rnatadi.
PROCTOR_POLICY_DEFAULTS = {
    "VAC_STRICT_MODE": "1",
    "PROCTOR_MAX_WARNINGS_BEFORE_BAN": "3",
    "PROCTOR_WARN_SUPPRESS_SECONDS": "10",
    "PROCTOR_EVENT_MIN_INTERVAL_SECONDS": "5",
    "PROCTOR_STARTUP_GRACE_SECONDS": "0",
    "PROCTOR_HARDENED_MODE": "1",
    "PROCTOR_HARD_WINDOW_MIN": "10",
    "PROCTOR_HARD_MAX_POINTS": "22",
    "PROCTOR_HARDENED_STARTUP_GRACE_SECONDS": "60",
    "PROCTOR_AUTO_BAN_NON_IDENTITY": "1",
    "PROCTOR_AUTO_BAN_IDENTITY": "1",
    "PROCTOR_IDENTITY_BAN_MAX_SCORE": "0.10",
    "PROCTOR_AUDIO_REVIEW_ONLY": "WHISPER_OR_CONVERSATION_SUSPECTED,SUSPICIOUS_AUDIO",
    "PROCTOR_IGNORED_VIOLATIONS": (
        "GAZE_AWAY_DOWN,GAZE_AWAY_UP,FACE_TURNED_AWAY,FACE_OFF_CENTER,"
        "FACE_TOO_FAR,FACE_TOO_CLOSE,EXCESSIVE_MOVEMENT"
    ),
    "VAC_GLOBAL_ACCOUNT_BAN": "0",
}
#: Standarti ro'yxat ko'rinishida kodda yozilgan — o'zgaruvchi umuman bo'lmasin.
PROCTOR_POLICY_UNSET = (
    "PROCTOR_INSTANT_BAN_VIOLATIONS",
    "PROCTOR_TECHNICAL_VIOLATIONS",
    "PROCTOR_NO_RETAKE_VIOLATIONS",
    "PROCTOR_REVIEW_ONLY_TYPES",
)


def pin_proctor_policy(testcase, **overrides):
    """Test davomida proktor siyosatini kod standartiga qotiradi (tugagach tiklanadi)."""
    patch = mock.patch.dict(os.environ, {**PROCTOR_POLICY_DEFAULTS, **overrides}, clear=False)
    patch.start()
    testcase.addCleanup(patch.stop)
    for key in PROCTOR_POLICY_UNSET:
        if key not in overrides:
            os.environ.pop(key, None)


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class ExamFlowApiTests(TestCase):
    def setUp(self):
        cache.clear()
        # Testlar dev rejimida: VAC/identity default o‘chiq (prod defaultlari testni buzmasin)
        self._vac_env_patch = mock.patch.dict(
            os.environ,
            {
                "VAC_HMAC_GUARD": "0",
                "VAC_SEQ_GUARD": "0",
                "VAC_CHALLENGE_GUARD": "0",
                "IDENTITY_VERIFY_REQUIRED": "0",
                "EXAM_MIN_SUBMIT_SECONDS": "0",
            },
            clear=False,
        )
        self._vac_env_patch.start()
        self.addCleanup(self._vac_env_patch.stop)
        self.client = APIClient()
        self.client.defaults["HTTP_X_DEVICE_FINGERPRINT"] = "itest-device-fp"
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

    def _apply_device_headers_from_start(self, start_response) -> None:
        data = start_response.json()
        device_token = data.get("deviceToken")
        if device_token:
            self.client.defaults["HTTP_X_DEVICE_SESSION_TOKEN"] = device_token
        # Fingerprint saqlanadi — keyingi imtihon start uchun kerak.
        self.client.defaults.setdefault("HTTP_X_DEVICE_FINGERPRINT", "itest-device-fp")

    def _start_exam_session(self, token: str, exam_id: int, student_id: str) -> None:
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        rs = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(rs.status_code, 200)
        self._apply_device_headers_from_start(rs)
        StudentExam.objects.filter(student_id=student_id, exam_id=exam_id).update(
            started_at=dj_tz.now() - timedelta(minutes=3)
        )

    def _post_start(self, exam_id: int, **extra):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        rs = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json", **extra)
        if rs.status_code == 200:
            self._apply_device_headers_from_start(rs)
        return rs

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
        r = self._post_start(self.exam_a.id)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("studentExamId"))
        self.assertTrue(r.json().get("sessionKey"))
        self.assertTrue(r.json().get("sessionChallenge"))
        self.assertTrue(r.json().get("deviceToken"))
        self.assertIn("submission_deadline", r.json()["exam"])
        for q in r.json()["exam"]["questions"]:
            self.assertNotIn("correctAnswer", q)

    def test_hmac_guard_blocks_unsigned_clock_when_enabled(self):
        r_start = self._post_start(self.exam_a.id)
        self.assertEqual(r_start.status_code, 200)
        with mock.patch.dict(os.environ, {"VAC_HMAC_GUARD": "1"}, clear=False):
            r = self.client.get(f"/api/student/exams/{self.exam_a.id}/clock")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "VAC_HMAC_REQUIRED")

    def test_seq_guard_blocks_missing_seq_when_enabled(self):
        r_start = self._post_start(self.exam_a.id)
        self.assertEqual(r_start.status_code, 200)
        with mock.patch.dict(os.environ, {"VAC_SEQ_GUARD": "1"}, clear=False):
            r = self.client.get(f"/api/student/exams/{self.exam_a.id}/clock")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "VAC_SEQ_REQUIRED")

    def test_challenge_guard_blocks_missing_header_when_enabled(self):
        r_start = self._post_start(self.exam_a.id)
        self.assertEqual(r_start.status_code, 200)
        with mock.patch.dict(os.environ, {"VAC_CHALLENGE_GUARD": "1"}, clear=False):
            r = self.client.get(
                f"/api/student/exams/{self.exam_a.id}/clock",
                HTTP_X_EXAM_SEQ="1",
            )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "VAC_CHALLENGE_REQUIRED")

    def test_start_exam_blocked_for_mobile_user_agent(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(
            f"/api/student/exams/{self.exam_a.id}/start",
            {},
            format="json",
            HTTP_USER_AGENT="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "VAC_PC_ONLY")

    def test_device_lock_blocks_mismatch_on_submit(self):
        """Boshqa qurilma (boshqa token VA boshqa barmoq izi) — 403 DEVICE_MISMATCH.

        Faqat token farq qilib, barmoq izi bir xil bo'lsa bu ataylab ruxsat
        etilgan (kompyuter sinfida token ustidan yozilishi —
        _helpers._enforce_bound_device_or_403 sessiyani shu mashinaga qayta
        bog'laydi). Shuning uchun haqiqiy ikkinchi qurilma ikkala belgisi bilan ham
        farq qiladi.
        """
        r_start = self._post_start(self.exam_a.id)
        self.assertEqual(r_start.status_code, 200)
        se_before = StudentExam.objects.get(student_id=self.student.id, exam_id=self.exam_a.id)
        self.assertTrue(se_before.device_session_token)
        r_submit = self.client.post(
            f"/api/student/exams/{self.exam_a.id}/submit",
            {"answers": {"1": "4", "2": "4"}, "flaggedQuestions": []},
            format="json",
            HTTP_X_DEVICE_SESSION_TOKEN="wrong-device-token",
            HTTP_X_DEVICE_FINGERPRINT="other-device-fp",
        )
        self.assertEqual(r_submit.status_code, 403)
        self.assertEqual(r_submit.json().get("code"), "DEVICE_MISMATCH")
        # Rad etilgan so'rov sessiyani o'ziga qayta bog'lab ololmaydi va uni yakunlamaydi.
        se_after = StudentExam.objects.get(pk=se_before.pk)
        self.assertEqual(se_after.status, "In Progress")
        self.assertEqual(se_after.device_session_token, se_before.device_session_token)
        self.assertEqual(se_after.device_fingerprint, se_before.device_fingerprint)

    def test_device_lock_same_fingerprint_rebinds_overwritten_token(self):
        """Token ustidan yozilgan, lekin barmoq izi o'sha — bir mashina: ruxsat va qayta bog'lash."""
        r_start = self._post_start(self.exam_a.id)
        self.assertEqual(r_start.status_code, 200)
        r_save = self.client.post(
            f"/api/student/exams/{self.exam_a.id}/submit",
            {"answers": {"1": "4", "2": "4"}, "flaggedQuestions": []},
            format="json",
            HTTP_X_DEVICE_SESSION_TOKEN="overwritten-token",
            HTTP_X_DEVICE_FINGERPRINT="itest-device-fp",
        )
        self.assertEqual(r_save.status_code, 200, r_save.content)
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=self.exam_a.id)
        self.assertEqual(se.status, "Completed")

    @mock.patch("apps.api.views.student.compare_faces", return_value={"success": True, "match": True})
    def test_identity_compare_sets_verified_at(self, _mock_faces):
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
        se = StudentExam.objects.filter(student_id=self.student.id, exam_id=self.exam_a.id).first()
        self.assertIsNotNone(se)
        self.assertIsNotNone(se.identity_verified_at)

    @mock.patch(
        "apps.api.views.student.compare_faces",
        return_value={"success": True, "match": True, "score": 0.87, "method": "embedding"},
    )
    def test_identity_compare_match_sets_last_match_fields(self, _mock_faces):
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
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=self.exam_a.id)
        self.assertTrue(se.identity_last_matched)
        self.assertEqual(se.identity_last_score, 0.87)
        self.assertEqual(se.identity_last_method, "embedding")
        self.assertIsNotNone(se.identity_last_checked_at)

    @mock.patch(
        "apps.api.views.student.compare_faces",
        return_value={"success": True, "match": True, "score": 0.5, "method": "embedding"},
    )
    def test_identity_compare_match_write_throttled_within_interval(self, _mock_faces):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r1 = self.client.post(
            "/api/student/identity-compare",
            {"exam_id": self.exam_a.id, "profile_image_base64": PROFILE, "live_capture_base64": PROFILE},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=self.exam_a.id)
        first_checked = se.identity_last_checked_at
        self.assertIsNotNone(first_checked)

        _mock_faces.return_value = {"success": True, "match": True, "score": 0.91, "method": "embedding"}
        r2 = self.client.post(
            "/api/student/identity-compare",
            {"exam_id": self.exam_a.id, "profile_image_base64": PROFILE, "live_capture_base64": PROFILE},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        se.refresh_from_db()
        # Throttle oralig'i (default 30s) ichida — checked_at/score o'zgarmasligi kerak.
        self.assertEqual(se.identity_last_checked_at, first_checked)
        self.assertEqual(se.identity_last_score, 0.5)

    @mock.patch(
        "apps.api.views.student.compare_faces",
        return_value={
            "success": True,
            "match": False,
            "score": 0.11,
            "method": "embedding",
            "code": "FACE_NOT_DETECTED",
        },
    )
    def test_identity_compare_mismatch_records_attempt_without_verifying(self, _mock_faces):
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
        self.assertFalse(r.json().get("match"))
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=self.exam_a.id)
        self.assertFalse(se.identity_last_matched)
        self.assertEqual(se.identity_last_score, 0.11)
        self.assertEqual(se.identity_last_code, "FACE_NOT_DETECTED")
        self.assertIsNone(se.identity_verified_at)

    @mock.patch.dict(
        os.environ,
        {"IDENTITY_VERIFY_REQUIRED": "1", "EXAM_MIN_SUBMIT_SECONDS": "0"},
        clear=False,
    )
    @mock.patch("apps.api.views.student.compare_faces", return_value={"success": True, "match": True})
    def test_start_blocked_without_identity_in_prod(self, _mock_faces):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.post(f"/api/student/exams/{self.exam_a.id}/start", {}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "IDENTITY_NOT_VERIFIED")

    def test_internal_realtime_exam_access(self):
        with mock.patch.dict(os.environ, {"REALTIME_INTERNAL_SECRET": "test-realtime-secret-32chars"}, clear=False):
            r_bad = self.client.get("/api/internal/realtime/exam-access?exam_id=1&user_id=x&role=student")
            self.assertEqual(r_bad.status_code, 403)
            r_ok = self.client.get(
                f"/api/internal/realtime/exam-access?exam_id={self.exam_a.id}&user_id={self.student.id}&role=student",
                HTTP_X_REALTIME_SECRET="test-realtime-secret-32chars",
            )
            self.assertEqual(r_ok.status_code, 200)
            self.assertTrue(r_ok.json().get("allowed"))

    def test_submit_forbidden_after_exam_window(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        self._post_start(self.exam_c.id)
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
        self._post_start(self.exam_b.id)
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
        self._post_start(self.exam_a.id)
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
        self._post_start(self.exam_b.id)
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
        self._start_exam_session(self.student_token, self.exam_a.id, self.student.id)
        r1 = self.client.post(
            f"/api/student/exams/{self.exam_a.id}/submit",
            {"answers": {"1": "3", "2": "2"}, "flaggedQuestions": []},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        self._start_exam_session(self.student_token, self.exam_b.id, self.student.id)
        r2 = self.client.post(
            f"/api/student/exams/{self.exam_b.id}/submit",
            {"answers": {"1": "4", "2": "4"}, "flaggedQuestions": []},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        r = self.client.get("/api/student/results")
        self.assertEqual(r.status_code, 200)
        completed = [x for x in r.json() if x["status"] == "Completed"]
        self.assertGreaterEqual(len(completed), 2)

    def test_admin_test_bank_import_smart_requires_content(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post("/api/admin/test-bank/import-smart", {}, format="json")
        self.assertEqual(r.status_code, 400)

    @mock.patch(
        "apps.api.views.admin.parse_and_classify_questionnaire",
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
        "apps.api.views.admin.parse_and_classify_questionnaire",
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

    def test_violation_three_distinct_warnings_then_ban_on_third(self):
        """3 ta rasmiy ogohlantirish — 3-chi epizodda retake yoki ban."""
        # Chegara (3) kod standarti; konteynerdagi PROCTOR_MAX_WARNINGS_BEFORE_BAN o'tmasin.
        pin_proctor_policy(self)
        hp = bcrypt.hashpw(b"vstudent2", bcrypt.gensalt(rounds=10)).decode("ascii")
        st2 = AppUser.objects.create(
            id="itest_student_viol",
            password=hp,
            role="student",
            name="Viol Student",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol", "password": "vstudent2"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        tok = r0.json()["token"]
        self._start_exam_session(tok, self.exam_a.id, st2.id)
        eid = self.exam_a.id
        Exam.objects.filter(pk=eid).update(technical_retakes_allowed=0)
        types = ["TAB_SWITCH_SOFT", "FACE_NOT_VISIBLE"]
        for i, vtype in enumerate(types):
            r = self.client.post(
                "/api/student/violations",
                {"exam_id": eid, "violation_type": vtype, "screenshot_url": ""},
                format="json",
            )
            self.assertEqual(r.status_code, 200, msg=f"warn step {i}")
            body = r.json()
            self.assertFalse(body.get("banned"), msg=f"step {i} should not ban yet")
            self.assertFalse(body.get("warningSuppressed"), msg=f"step {i} must count")
            self.assertEqual(body.get("warningNumber"), i + 1)
            self.assertEqual(body.get("isFinalWarning"), i == 1)
            StudentExam.objects.filter(student_id=st2.id, exam_id=eid).update(
                proctor_last_warning_at=dj_tz.now() - timedelta(seconds=61)
            )
        ViolationLog.objects.filter(student_id=st2.id, exam_id=eid).update(
            timestamp=dj_tz.now() - timedelta(seconds=120)
        )
        r3 = self.client.post(
            "/api/student/violations",
            {"exam_id": eid, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r3.status_code, 200)
        self.assertTrue(r3.json().get("banned"), r3.json())
        self.assertEqual(r3.json().get("banReason"), "VIOLATION_LIMIT")
        se = StudentExam.objects.get(student_id=st2.id, exam_id=eid)
        self.assertEqual(se.status, "Banned")
        self.assertEqual(se.proctor_official_warnings, 3)
        st2.refresh_from_db()
        self.assertEqual(st2.status, "Active")

    def test_violation_multiple_types_within_one_minute_single_warning(self):
        """Bitta merge oynasi ichida turli violationlar — faqat bitta rasmiy ogohlantirish."""
        hp = bcrypt.hashpw(b"vstudent3", bcrypt.gensalt(rounds=10)).decode("ascii")
        st3 = AppUser.objects.create(
            id="itest_student_viol3",
            password=hp,
            role="student",
            name="Viol Student 3",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol3", "password": "vstudent3"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self._start_exam_session(r0.json()["token"], self.exam_a.id, st3.id)
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
        # Ikkalasi ham log qilinadi (audit to'liq bo'lishi uchun) — faqat rasmiy
        # ogohlantirish/ban hisoblagichi suppress qilinadi, ViolationLog yozuvi emas.
        logged_types = set(
            ViolationLog.objects.filter(student_id=st3.id, exam_id=eid).values_list(
                "violation_type", flat=True
            )
        )
        self.assertEqual(logged_types, {"FACE_NOT_VISIBLE", "SUSPICIOUS_AUDIO"})

    def test_violation_same_type_spam_is_deduped_without_extra_logs(self):
        hp = bcrypt.hashpw(b"vstudent12", bcrypt.gensalt(rounds=10)).decode("ascii")
        st12 = AppUser.objects.create(
            id="itest_student_viol12",
            password=hp,
            role="student",
            name="Viol Student 12",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol12", "password": "vstudent12"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self._start_exam_session(r0.json()["token"], self.exam_a.id, st12.id)
        eid = self.exam_a.id
        r1 = self.client.post(
            "/api/student/violations",
            {"exam_id": eid, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        self.assertFalse(r1.json().get("warningSuppressed"))
        r2 = self.client.post(
            "/api/student/violations",
            {"exam_id": eid, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("warningSuppressed"))
        self.assertEqual(ViolationLog.objects.filter(student_id=st12.id, exam_id=eid).count(), 1)

    def test_identity_substitution_instant_ban_in_strict_vac(self):
        """Strict VAC: aniq boshqa yuz (ball < PROCTOR_IDENTITY_BAN_MAX_SCORE=0.10) — darhol ban.

        11.09 dan beri chegaraviy ball (yoki ball yo'q) ban emas, faqat admin
        ko'rib chiqishi (identityReview) — buni ham shu yerda tekshiramiz.
        """
        pin_proctor_policy(self)
        hp = bcrypt.hashpw(b"vstudent4", bcrypt.gensalt(rounds=10)).decode("ascii")
        st4 = AppUser.objects.create(
            id="itest_student_viol4",
            password=hp,
            role="student",
            name="Viol Student 4",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol4", "password": "vstudent4"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self._start_exam_session(r0.json()["token"], self.exam_a.id, st4.id)
        # Retake imkoniyati bo'lmagan (strict) imtihon — identity substitution DARHOL ban.
        # (Default imtihonda avval 1 ta identity retake beriladi; bu test aynan
        #  retake-siz stsenariyni tekshiradi.)
        Exam.objects.filter(pk=self.exam_a.id).update(
            identity_retakes_allowed=0, technical_retakes_allowed=0
        )
        se_qs = StudentExam.objects.filter(student_id=st4.id, exam_id=self.exam_a.id)

        # 1) Chegaraviy ball — ban YO'Q, review sifatida qayd.
        se_qs.update(identity_last_score=0.3)
        r0 = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "IDENTITY_SUBSTITUTION", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.assertFalse(r0.json().get("banned"), r0.json())
        self.assertTrue(r0.json().get("identityReview"), r0.json())
        self.assertEqual(se_qs.get().status, "In Progress")
        self.assertEqual(
            list(
                ViolationLog.objects.filter(student_id=st4.id, exam_id=self.exam_a.id).values_list(
                    "outcome", flat=True
                )
            ),
            ["review"],
        )

        # 2) Yuz butunlay boshqa — darhol ban (ogohlantirishlarsiz).
        se_qs.update(identity_last_score=0.02)
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "IDENTITY_SUBSTITUTION", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body.get("banned"), body)
        self.assertEqual(body.get("banReason"), "IDENTITY")
        se = StudentExam.objects.get(student_id=st4.id, exam_id=self.exam_a.id)
        self.assertEqual(se.status, "Banned")
        self.assertEqual(se.ban_reason, "IDENTITY")
        st4.refresh_from_db()
        self.assertEqual(st4.status, "Active")

    def test_retake_resets_proctor_warning_state(self):
        hp = bcrypt.hashpw(b"vstudent5", bcrypt.gensalt(rounds=10)).decode("ascii")
        st5 = AppUser.objects.create(
            id="itest_student_viol5",
            password=hp,
            role="student",
            name="Viol Student 5",
            status="Active",
            group_id=self.group.id,
            profile_image="",
        )
        se = StudentExam.objects.create(
            student_id=st5.id,
            exam_id=self.exam_a.id,
            status="Banned",
            proctor_official_warnings=3,
            proctor_last_warning_at=dj_tz.now(),
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post(f"/api/admin/student_exams/{se.id}/retake", {}, format="json")
        self.assertEqual(r.status_code, 200)
        se.refresh_from_db()
        self.assertEqual(se.status, "Pending")
        self.assertEqual(se.proctor_official_warnings, 0)
        self.assertIsNone(se.proctor_last_warning_at)

    def test_start_from_pending_resets_proctor_warning_state(self):
        hp = bcrypt.hashpw(b"vstudent10", bcrypt.gensalt(rounds=10)).decode("ascii")
        st10 = AppUser.objects.create(
            id="itest_student_viol10",
            password=hp,
            role="student",
            name="Viol Student 10",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        old_started = dj_tz.now() - timedelta(hours=5)
        StudentExam.objects.create(
            student_id=st10.id,
            exam_id=self.exam_a.id,
            status="Pending",
            started_at=old_started,
            proctor_official_warnings=3,
            proctor_last_warning_at=dj_tz.now() - timedelta(minutes=2),
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol10", "password": "vstudent10"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        tok = r0.json()["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tok}")
        rs = self.client.post(
            f"/api/student/exams/{self.exam_a.id}/start",
            {"pin": ""},
            format="json",
        )
        self.assertEqual(rs.status_code, 200)
        se = StudentExam.objects.get(student_id=st10.id, exam_id=self.exam_a.id)
        self.assertEqual(se.status, "In Progress")
        self.assertEqual(se.proctor_official_warnings, 0)
        self.assertIsNone(se.proctor_last_warning_at)
        self.assertIsNotNone(se.started_at)
        self.assertGreaterEqual(se.started_at, old_started)

    def test_violation_counts_immediately_after_exam_start(self):
        hp = bcrypt.hashpw(b"vstudent6", bcrypt.gensalt(rounds=10)).decode("ascii")
        st6 = AppUser.objects.create(
            id="itest_student_viol6",
            password=hp,
            role="student",
            name="Viol Student 6",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        se = StudentExam.objects.create(
            student_id=st6.id,
            exam_id=self.exam_a.id,
            status="In Progress",
            started_at=dj_tz.now(),
        )
        self.client.credentials()
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol6", "password": "vstudent6"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r0.json()['token']}")
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertFalse(body.get("startupGrace"))
        self.assertFalse(body.get("warningSuppressed"))
        self.assertEqual(body.get("warningNumber"), 1)
        se.refresh_from_db()
        self.assertEqual(se.proctor_official_warnings, 1)

    @mock.patch.dict(os.environ, {"PROCTOR_STARTUP_GRACE_SECONDS": "40"})
    def test_violation_startup_grace_suppresses_when_configured(self):
        hp = bcrypt.hashpw(b"vstudent6b", bcrypt.gensalt(rounds=10)).decode("ascii")
        st6 = AppUser.objects.create(
            id="itest_student_viol6b",
            password=hp,
            role="student",
            name="Viol Student 6b",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        se = StudentExam.objects.create(
            student_id=st6.id,
            exam_id=self.exam_a.id,
            status="In Progress",
            started_at=dj_tz.now(),
        )
        self.client.credentials()
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol6b", "password": "vstudent6b"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r0.json()['token']}")
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("startupGrace"))
        se.refresh_from_db()
        self.assertEqual(se.proctor_official_warnings, 0)

    def test_violation_rejected_without_in_progress_session(self):
        hp = bcrypt.hashpw(b"vstudent11", bcrypt.gensalt(rounds=10)).decode("ascii")
        st11 = AppUser.objects.create(
            id="itest_student_viol11",
            password=hp,
            role="student",
            name="Viol Student 11",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        StudentExam.objects.create(
            student_id=st11.id,
            exam_id=self.exam_a.id,
            status="Pending",
            started_at=dj_tz.now() - timedelta(minutes=2),
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol11", "password": "vstudent11"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r0.json()['token']}")
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 409)

    def test_violation_count_ignores_logs_before_current_started_at(self):
        hp = bcrypt.hashpw(b"vstudent9", bcrypt.gensalt(rounds=10)).decode("ascii")
        st9 = AppUser.objects.create(
            id="itest_student_viol9",
            password=hp,
            role="student",
            name="Viol Student 9",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        se = StudentExam.objects.create(
            student_id=st9.id,
            exam_id=self.exam_a.id,
            status="In Progress",
            started_at=dj_tz.now() - timedelta(minutes=1),
        )
        ViolationLog.objects.create(
            student_id=st9.id,
            exam_id=self.exam_a.id,
            violation_type="TAB_SWITCH_SOFT",
            timestamp=se.started_at - timedelta(hours=2),
            screenshot_url="",
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol9", "password": "vstudent9"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r0.json()['token']}")
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_SOFT", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body.get("violationsCount"), 1)
        self.assertEqual(body.get("warningNumber"), 1)

    def test_admin_results_include_violation_priority_counts(self):
        self._start_exam_session(self.student_token, self.exam_a.id, self.student.id)
        self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_HARD", "screenshot_url": ""},
            format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.get(f"/api/admin/exams/{self.exam_a.id}/results")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("review_priority_counts", body)
        self.assertIn("critical", body["review_priority_counts"])
        self.assertIn("high", body["review_priority_counts"])
        self.assertIn("medium", body["review_priority_counts"])
        self.assertTrue(len(body.get("results") or []) >= 1)
        row = body["results"][0]
        self.assertIn("risk_score", row)
        self.assertIn("violations_count", row)
        self.assertIn("highest_priority", row)
        self.assertIn("recommended_review", row)
        self.assertIn("question_risk_timeline", row)

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

    @mock.patch("apps.api.views.student.compare_faces")
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

    @mock.patch("apps.api.views.student.compare_faces")
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

    @override_settings(DEBUG=True)
    @mock.patch("apps.api.views.student.compare_faces")
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

    def test_student_can_submit_ban_appeal_and_admin_can_resolve(self):
        AppUser.objects.filter(pk=self.student.id).update(status="Banned")
        StudentExam.objects.create(student_id=self.student.id, exam_id=self.exam_a.id, status="Banned")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r_create = self.client.post(
            "/api/student/ban-appeals",
            {
                "exam_id": self.exam_a.id,
                "reason": "Iltimos qayta tekshirib chiqing, tarmoq uzilgani sabab false positive bo'lgan.",
                "evidence_name": "note.txt",
                "evidence_mime": "text/plain",
                "evidence_base64": "data:text/plain;base64,dGVzdA==",
            },
            format="json",
        )
        self.assertEqual(r_create.status_code, 200)
        aid = r_create.json().get("id")
        self.assertTrue(BanAppeal.objects.filter(pk=aid, student_id=self.student.id).exists())
        self.assertTrue(BanAppeal.objects.filter(pk=aid).exclude(evidence_sha256="").exists())
        self.assertTrue(BanAppealEvent.objects.filter(appeal_id=aid, action="CREATED").exists())

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r_list = self.client.get("/api/admin/ban-appeals?status=Pending")
        self.assertEqual(r_list.status_code, 200)
        self.assertTrue(any(x.get("id") == aid for x in r_list.json()))

        r_resolve = self.client.post(
            f"/api/admin/ban-appeals/{aid}/resolve",
            {"decision": "approve", "note": "Appeal approved after review"},
            format="json",
        )
        self.assertEqual(r_resolve.status_code, 200)
        self.assertTrue(BanAppealEvent.objects.filter(appeal_id=aid, action="RESOLVED_APPROVE").exists())
        self.student.refresh_from_db()
        self.assertEqual(self.student.status, "Active")

    def test_admin_review_queue_endpoint(self):
        self._start_exam_session(self.student_token, self.exam_a.id, self.student.id)
        self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "TAB_SWITCH_HARD", "screenshot_url": ""},
            format="json",
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.get("/api/admin/review-queue?limit=10")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("results", body)
        self.assertTrue(isinstance(body["results"], list))

    def test_hardened_combo_ban_faces_and_whisper(self):
        """Hardened: faqat yuz + gapirish kombinatsiyasi darhol ban (tab+fullscreen emas).

        Pichirlash yolg'iz o'zi faqat review (PROCTOR_AUDIO_REVIEW_ONLY), lekin
        oldinroq kamerada ikkinchi yuz (MULTIPLE_FACES) ko'ringan bo'lsa u
        tasdiqlangan hisoblanadi va hardened kombinatsiya ishlaydi.
        """
        pin_proctor_policy(self)
        hp = bcrypt.hashpw(b"vstudent7", bcrypt.gensalt(rounds=10)).decode("ascii")
        st7 = AppUser.objects.create(
            id="itest_student_viol7",
            password=hp,
            role="student",
            name="Viol Student 7",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol7", "password": "vstudent7"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self._start_exam_session(r0.json()["token"], self.exam_a.id, st7.id)
        # Retake-siz (strict) imtihon — hardened kombinatsiya DARHOL ban qilishi kerak.
        Exam.objects.filter(pk=self.exam_a.id).update(
            identity_retakes_allowed=0, technical_retakes_allowed=0
        )
        r1 = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "MULTIPLE_FACES", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)
        self.assertFalse(r1.json().get("banned"))
        r2 = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "WHISPER_OR_CONVERSATION_SUSPECTED", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("banned"), r2.json())
        self.assertTrue(r2.json().get("hardenedCombo"), r2.json())
        self.assertFalse(r2.json().get("audioReview"), r2.json())
        se = StudentExam.objects.get(student_id=st7.id, exam_id=self.exam_a.id)
        self.assertEqual(se.status, "Banned")
        st7.refresh_from_db()
        self.assertEqual(st7.status, "Active")

    def test_vac_strict_devtools_open_is_warning_not_instant_ban(self):
        hp = bcrypt.hashpw(b"vstudent8", bcrypt.gensalt(rounds=10)).decode("ascii")
        st8 = AppUser.objects.create(
            id="itest_student_viol8",
            password=hp,
            role="student",
            name="Viol Student 8",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_viol8", "password": "vstudent8"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self._start_exam_session(r0.json()["token"], self.exam_a.id, st8.id)
        r = self.client.post(
            "/api/student/violations",
            {"exam_id": self.exam_a.id, "violation_type": "DEVTOOLS_OPEN", "screenshot_url": ""},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertFalse(j.get("banned"))
        self.assertEqual(j.get("warningNumber"), 1)
        st8.refresh_from_db()
        self.assertEqual(st8.status, "Active")

    def test_staff_exams_forbidden_for_student(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.get("/api/staff/exams")
        self.assertEqual(r.status_code, 403)

    def test_staff_sees_only_assigned_exams_and_results(self):
        hs = bcrypt.hashpw(b"staff-pass-10", bcrypt.gensalt(rounds=10)).decode("ascii")
        staff = AppUser.objects.create(
            id="itest_staff",
            password=hs,
            role="staff",
            name="Integration Staff",
            status="Active",
            group_id=None,
            profile_image="",
        )
        now = dj_tz.now()
        e_staff = Exam.objects.create(
            teacher_id=staff.id,
            title="Staff-only exam",
            start_time=now - timedelta(minutes=5),
            end_time=now + timedelta(hours=2),
            duration_minutes=30,
            questions_json=__import__("json").dumps(QUESTIONS),
            language="uz",
            pin="",
            custom_rules="",
            exam_mode="static",
            bank_category_ids="[]",
            bank_question_count=0,
        )
        ExamGroup.objects.create(exam_id=e_staff.id, group_id=self.group.id)

        r_login = self.client.post(
            "/api/auth/login",
            {"id": "itest_staff", "password": "staff-pass-10"},
            format="json",
        )
        self.assertEqual(r_login.status_code, 200)
        staff_token = r_login.json()["token"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token}")
        r_list = self.client.get("/api/staff/exams")
        self.assertEqual(r_list.status_code, 200)
        ids = {row["id"] for row in r_list.json()}
        self.assertIn(e_staff.id, ids)
        self.assertNotIn(self.exam_a.id, ids)

        r_other = self.client.get(f"/api/staff/exams/{self.exam_a.id}/results")
        self.assertEqual(r_other.status_code, 404)

        r_own = self.client.get(f"/api/staff/exams/{e_staff.id}/results")
        self.assertEqual(r_own.status_code, 200)
        body = r_own.json()
        self.assertIn("results", body)
        self.assertIn("violations", body)

    def test_expired_in_progress_session_auto_finalized_on_exam_list(self):
        now = dj_tz.now()
        past_exam = Exam.objects.create(
            teacher_id=self.admin.id,
            title="Expired window",
            start_time=now - timedelta(days=3),
            end_time=now - timedelta(days=2),
            duration_minutes=60,
            questions_json=__import__("json").dumps(QUESTIONS),
            language="uz",
            pin="",
            custom_rules="",
            exam_mode="static",
            bank_category_ids="[]",
            bank_question_count=0,
        )
        ExamGroup.objects.create(exam_id=past_exam.id, group_id=self.group.id)
        se = StudentExam.objects.create(
            student_id=self.student.id,
            exam_id=past_exam.id,
            status="In Progress",
            started_at=now - timedelta(days=3, hours=1),
            draft_answers_json='{"1":"A"}',
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.get("/api/student/exams")
        self.assertEqual(r.status_code, 200)
        ids = {row["id"] for row in r.json()}
        self.assertNotIn(past_exam.id, ids)
        se.refresh_from_db()
        self.assertEqual(se.status, "Completed")
        self.assertIsNotNone(se.completed_at)


    def test_proctor_diagnostics_logs_engine_failure(self):
        """Brauzerdagi engine yiqilsa sabab SERVER LOGIGA tushadi.

        Bu qoidabuzarlik emas va bazaga hech narsa yozmaydi — maqsad faqat
        nosozlikni ko'rinadigan qilish. Ilgari sabab talaba brauzerining
        konsolida qolar, prod build esa `console.*` ni olib tashlagani uchun
        hech qayerda ko'rinmasdi.
        """
        hp = bcrypt.hashpw(b"vstudent-diag", bcrypt.gensalt(rounds=10)).decode("ascii")
        st = AppUser.objects.create(
            id="itest_student_diag",
            password=hp,
            role="student",
            name="Diag Student",
            status="Active",
            group_id=self.group.id,
            profile_image=PROFILE,
        )
        r0 = self.client.post(
            "/api/auth/login",
            {"id": "itest_student_diag", "password": "vstudent-diag"},
            format="json",
        )
        self.assertEqual(r0.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {r0.json()['token']}")

        with self.assertLogs("apps.api", level="ERROR") as cm:
            r = self.client.post(
                "/api/student/proctor-diagnostics",
                {
                    "stage": "realtime-proctor",
                    "ok": False,
                    "detail": "GPU delegate yaratilmadi",
                    "exam_id": self.exam_a.id,
                },
                format="json",
            )
        self.assertEqual(r.status_code, 200)
        logged = "\n".join(cm.output)
        self.assertIn("[PROCTOR-DIAG]", logged)
        self.assertIn("realtime-proctor", logged)
        self.assertIn("GPU delegate yaratilmadi", logged)
        self.assertIn(st.id, logged)

        # Muvaffaqiyat holati — INFO darajasida, xato emas.
        with self.assertLogs("apps.api", level="INFO") as cm2:
            ok_res = self.client.post(
                "/api/student/proctor-diagnostics",
                {"stage": "realtime-proctor", "ok": True, "exam_id": self.exam_a.id},
                format="json",
            )
        self.assertEqual(ok_res.status_code, 200)
        self.assertIn("ok=True", "\n".join(cm2.output))

        # Hech qanday qoidabuzarlik yozilmasligi SHART.
        self.assertFalse(ViolationLog.objects.filter(student_id=st.id).exists())


    def test_student_exams_expose_access_until(self):
        """`access_until` — talaba UCHUN haqiqiy oxirgi muddat.

        Klient shu bo'yicha imtihon tugaganini biladi. `end_time` ga qarab
        bo'lmaydi: retake oynasi berilgan talaba umumiy vaqtdan keyin ham haqli
        ravishda kiradi, aks holda imtihon oldi sahifasi uni noto'g'ri bloklardi.
        """
        from apps.core.models import ExamRetakeWindow

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        r = self.client.get("/api/student/exams")
        self.assertEqual(r.status_code, 200)
        row = next((x for x in r.json() if x["id"] == self.exam_a.id), None)
        self.assertIsNotNone(row)
        self.assertIn("access_until", row)
        # Retake oynasi yo'q — umumiy tugash vaqti bilan bir xil.
        self.assertEqual(row["access_until"], row["end_time"])

        # Retake oynasi umumiy vaqtdan KEYIN tugasa — muddat cho'ziladi.
        later = self.exam_a.end_time + timedelta(hours=3)
        ExamRetakeWindow.objects.create(
            exam=self.exam_a,
            student=self.student,
            window_start=dj_tz.now() - timedelta(minutes=1),
            window_end=later,
        )
        r2 = self.client.get("/api/student/exams")
        row2 = next((x for x in r2.json() if x["id"] == self.exam_a.id), None)
        self.assertIsNotNone(row2)
        self.assertNotEqual(row2["access_until"], row2["end_time"])
        self.assertEqual(row2["access_until"], later.isoformat())


class BankExamOptionsTests(TestCase):
  def test_bank_row_empty_uz_options_fallback(self):
    from apps.api.services import bank_row_to_exam_dict
    from types import SimpleNamespace

    row = SimpleNamespace(
      text="Question EN?",
      options_json='["Opt A", "Opt B", "Opt C", "Opt D"]',
      options_uz_json='["", "", "", "", ""]',
      options_ru_json="[]",
      text_uz="Savol UZ?",
      text_ru="",
      correct_answer="Opt A",
      correct_answer_uz="",
      correct_answer_ru="",
    )
    out = bank_row_to_exam_dict(row, "uz")
    self.assertGreaterEqual(len(out["options"]), 2)
    self.assertTrue(all(str(x).strip() for x in out["options"]))
    self.assertIn(out["correctAnswer"], out["options"])
