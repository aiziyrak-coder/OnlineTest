"""«Tashqi shovqin nazorati» (ambient_audio_enabled) sozlamasi uchun testlar.

Zanjir: admin imtihon yaratadi (o'chirilgan) → admin ro'yxati/detali → talaba
`/start` javobi. Talaba tomonidagi nazorat aynan shu maydonga qarab ishlaydi.
"""
from __future__ import annotations

import copy
import json
import os
from datetime import timedelta
from unittest import mock

import bcrypt
from django.conf import settings
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone as dj_tz
from rest_framework.test import APIClient

from apps.core.models import AppUser, Exam, ExamGroup, Group, Level

PROFILE = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlcZ/"
)

QUESTIONS = [
    {"id": 1, "text": "2+2=?", "options": ["3", "4", "5", "6"], "correctAnswer": "4"},
]


def _rf_throttle_off():
    rf = copy.deepcopy(settings.REST_FRAMEWORK)
    rf["DEFAULT_THROTTLE_CLASSES"] = []
    rf["DEFAULT_THROTTLE_RATES"] = {k: "100000/h" for k in rf.get("DEFAULT_THROTTLE_RATES", {})}
    return rf


@override_settings(REST_FRAMEWORK=_rf_throttle_off())
class AmbientAudioToggleTests(TestCase):
    def setUp(self):
        cache.clear()
        self._env = mock.patch.dict(
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
        self._env.start()
        self.addCleanup(self._env.stop)
        self.client = APIClient()
        self.client.defaults["HTTP_X_DEVICE_FINGERPRINT"] = "amb-device-fp"
        self.level = Level.objects.create(name="Amb level")
        self.group = Group.objects.create(name="Amb group", level=self.level)
        hp = bcrypt.hashpw(b"amb-pass-9", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.student = AppUser.objects.create(
            id="amb_student", password=hp, role="student", name="Amb Student",
            status="Active", group_id=self.group.id, profile_image=PROFILE,
        )
        ha = bcrypt.hashpw(b"amb-admin-9", bcrypt.gensalt(rounds=10)).decode("ascii")
        self.admin = AppUser.objects.create(
            id="amb_admin", password=ha, role="admin", name="Amb Admin",
            status="Active", group_id=self.group.id, profile_image="",
        )
        self.student_token = self.client.post(
            "/api/auth/login", {"id": "amb_student", "password": "amb-pass-9"}, format="json"
        ).json()["token"]
        self.admin_token = self.client.post(
            "/api/auth/login", {"id": "amb_admin", "password": "amb-admin-9"}, format="json"
        ).json()["token"]

    def _create_exam_via_api(self, *, ambient: bool) -> int:
        now = dj_tz.now()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post(
            "/api/admin/exams",
            {
                "title": "Ambient imtihon",
                "start_time": (now - timedelta(minutes=2)).isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
                "duration_minutes": 45,
                "language": "uz",
                "ambient_audio_enabled": ambient,
                "group_ids": [self.group.id],
                "exam_mode": "static",
                "manual_questions": json.dumps(QUESTIONS),
            },
            format="json",
        )
        self.assertIn(r.status_code, (200, 201), r.content)
        return int(r.json().get("id") or r.json().get("exam", {}).get("id"))

    def test_create_disabled_persists_and_reaches_student_start(self):
        exam_id = self._create_exam_via_api(ambient=False)
        self.assertFalse(Exam.objects.get(pk=exam_id).ambient_audio_enabled)

        # Admin detali (tahrirlash modali shu javobdan o'qiydi)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        rd = self.client.get(f"/api/admin/exams/{exam_id}")
        self.assertEqual(rd.status_code, 200, rd.content)
        self.assertIs(rd.json()["ambient_audio_enabled"], False)

        # Talaba sessiyasi — ExamRoom aynan shu maydonni o'qiydi
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        rs = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(rs.status_code, 200, rs.content)
        self.assertIs(rs.json()["exam"]["ambient_audio_enabled"], False)

    def test_create_default_is_enabled(self):
        now = dj_tz.now()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        r = self.client.post(
            "/api/admin/exams",
            {
                "title": "Default ambient",
                "start_time": (now - timedelta(minutes=2)).isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
                "duration_minutes": 45,
                "language": "uz",
                "group_ids": [self.group.id],
                "exam_mode": "static",
                "manual_questions": json.dumps(QUESTIONS),
            },
            format="json",
        )
        self.assertIn(r.status_code, (200, 201), r.content)
        exam_id = int(r.json().get("id") or r.json().get("exam", {}).get("id"))
        self.assertTrue(Exam.objects.get(pk=exam_id).ambient_audio_enabled)

    def test_update_toggles_both_directions(self):
        exam_id = self._create_exam_via_api(ambient=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token}")
        ru = self.client.patch(
            f"/api/admin/exams/{exam_id}",
            {"ambient_audio_enabled": False},
            format="json",
        )
        self.assertIn(ru.status_code, (200, 204), ru.content)
        self.assertFalse(Exam.objects.get(pk=exam_id).ambient_audio_enabled)

        ru2 = self.client.patch(
            f"/api/admin/exams/{exam_id}",
            {"ambient_audio_enabled": True},
            format="json",
        )
        self.assertIn(ru2.status_code, (200, 204), ru2.content)
        self.assertTrue(Exam.objects.get(pk=exam_id).ambient_audio_enabled)

    def test_ambient_violation_ignored_when_disabled(self):
        """Sozlama o'chirilgan bo'lsa, server SUSPICIOUS_AUDIO ni hisobga olmasligi kerak
        (klient o'zgartirilgan bo'lsa ham soxta ogohlantirish berilmasin)."""
        exam_id = self._create_exam_via_api(ambient=False)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        rs = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(rs.status_code, 200, rs.content)
        tok = rs.json().get("deviceToken")
        if tok:
            self.client.defaults["HTTP_X_DEVICE_SESSION_TOKEN"] = tok

        for vtype in ("SUSPICIOUS_AUDIO", "WHISPER_OR_CONVERSATION_SUSPECTED"):
            rv = self.client.post(
                "/api/student/violations",
                {"exam_id": exam_id, "violation_type": vtype},
                format="json",
            )
            self.assertEqual(rv.status_code, 200, rv.content)
            body = rv.json()
            self.assertTrue(body.get("warningSuppressed"), (vtype, body))
            self.assertFalse(body.get("banned"), (vtype, body))

        from apps.core.models import StudentExam, ViolationLog

        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam_id)
        self.assertEqual(int(se.proctor_official_warnings or 0), 0)
        self.assertEqual(ViolationLog.objects.filter(student_id=self.student.id, exam_id=exam_id).count(), 0)

    def test_student_own_speech_still_counted_when_ambient_disabled(self):
        """Talabaning o'zi gapirishi (og'iz harakati) sozlamadan qat'i nazar hisoblanadi."""
        exam_id = self._create_exam_via_api(ambient=False)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        rs = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(rs.status_code, 200, rs.content)
        tok = rs.json().get("deviceToken")
        if tok:
            self.client.defaults["HTTP_X_DEVICE_SESSION_TOKEN"] = tok

        rv = self.client.post(
            "/api/student/violations",
            {"exam_id": exam_id, "violation_type": "MOUTH_MOVEMENT_TALKING"},
            format="json",
        )
        self.assertEqual(rv.status_code, 200, rv.content)
        self.assertFalse(rv.json().get("warningSuppressed"), rv.json())
        self.assertEqual(rv.json().get("warningNumber"), 1, rv.json())

    def _start_ambient_exam(self, *, audio_review_only: str) -> int:
        """Ovoz siyosatini aniq belgilab, sozlama YOQILGAN imtihonni boshlaydi.

        Konteyner muhitidagi PROCTOR_AUDIO_REVIEW_ONLY / PROCTOR_MAX_WARNINGS_*
        testga o'tmasin — test qoidani tekshirsin, muhitni emas.
        """
        env = mock.patch.dict(
            os.environ,
            {
                "PROCTOR_AUDIO_REVIEW_ONLY": audio_review_only,
                "PROCTOR_STARTUP_GRACE_SECONDS": "0",
                "PROCTOR_HARDENED_MODE": "1",
                "PROCTOR_HARDENED_STARTUP_GRACE_SECONDS": "60",
                "PROCTOR_MAX_WARNINGS_BEFORE_BAN": "3",
                "PROCTOR_WARN_SUPPRESS_SECONDS": "10",
                "PROCTOR_EVENT_MIN_INTERVAL_SECONDS": "5",
                "PROCTOR_AUTO_BAN_NON_IDENTITY": "1",
                "PROCTOR_IGNORED_VIOLATIONS": (
                    "GAZE_AWAY_DOWN,GAZE_AWAY_UP,FACE_TURNED_AWAY,FACE_OFF_CENTER,"
                    "FACE_TOO_FAR,FACE_TOO_CLOSE,EXCESSIVE_MOVEMENT"
                ),
            },
            clear=False,
        )
        env.start()
        self.addCleanup(env.stop)
        for key in ("PROCTOR_TECHNICAL_VIOLATIONS", "PROCTOR_REVIEW_ONLY_TYPES"):
            os.environ.pop(key, None)

        exam_id = self._create_exam_via_api(ambient=True)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.student_token}")
        rs = self.client.post(f"/api/student/exams/{exam_id}/start", {"pin": ""}, format="json")
        self.assertEqual(rs.status_code, 200, rs.content)
        tok = rs.json().get("deviceToken")
        if tok:
            self.client.defaults["HTTP_X_DEVICE_SESSION_TOKEN"] = tok
        return exam_id

    def _post_audio(self, exam_id: int, vtype: str = "SUSPICIOUS_AUDIO"):
        rv = self.client.post(
            "/api/student/violations",
            {"exam_id": exam_id, "violation_type": vtype},
            format="json",
        )
        self.assertEqual(rv.status_code, 200, rv.content)
        return rv.json()

    def test_ambient_violation_review_only_when_enabled_without_camera_evidence(self):
        """Standart siyosat (11.09): sozlama yoqilgan, lekin ovoz signali YOLG'IZ —
        jazo emas: qayd (outcome=review), talabaga ogohlantirish matni, rasmiy
        ogohlantirish yo'q. O'chirilgan sozlamadan farqi — hodisa YOZILADI."""
        from apps.core.models import StudentExam, ViolationLog

        exam_id = self._start_ambient_exam(
            audio_review_only="WHISPER_OR_CONVERSATION_SUSPECTED,SUSPICIOUS_AUDIO"
        )
        for vtype in ("SUSPICIOUS_AUDIO", "WHISPER_OR_CONVERSATION_SUSPECTED"):
            body = self._post_audio(exam_id, vtype)
            self.assertTrue(body.get("audioReview"), (vtype, body))
            self.assertTrue(body.get("warningSuppressed"), (vtype, body))
            self.assertFalse(body.get("ambientDisabled"), (vtype, body))
            self.assertFalse(body.get("banned"), (vtype, body))
            self.assertEqual(body.get("warningNumber"), 0, (vtype, body))
            self.assertTrue(body.get("violationReason"), (vtype, body))

        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam_id)
        self.assertEqual(se.status, "In Progress")
        self.assertEqual(int(se.proctor_official_warnings or 0), 0)
        logs = ViolationLog.objects.filter(student_id=self.student.id, exam_id=exam_id)
        self.assertEqual(
            sorted(logs.values_list("violation_type", "outcome")),
            [("SUSPICIOUS_AUDIO", "review"), ("WHISPER_OR_CONVERSATION_SUSPECTED", "review")],
        )

    def test_ambient_violation_counted_when_enabled(self):
        """Sozlama yoqilgan va so'nggi 2 daqiqada KAMERADA dalil bor (masalan, ikkinchi
        yuz) — ovoz signali odatdagi rasmiy ogohlantirish oqimiga tushadi."""
        from apps.core.models import StudentExam, ViolationLog

        exam_id = self._start_ambient_exam(
            audio_review_only="WHISPER_OR_CONVERSATION_SUSPECTED,SUSPICIOUS_AUDIO"
        )
        ViolationLog.objects.create(
            student_id=self.student.id,
            exam_id=exam_id,
            violation_type="MULTIPLE_FACES",
            timestamp=dj_tz.now(),
            screenshot_url="",
        )
        body = self._post_audio(exam_id)
        self.assertFalse(body.get("audioReview"), body)
        self.assertFalse(body.get("warningSuppressed"), body)
        self.assertEqual(body.get("warningNumber"), 1, body)
        se = StudentExam.objects.get(student_id=self.student.id, exam_id=exam_id)
        self.assertEqual(int(se.proctor_official_warnings or 0), 1)

    def test_ambient_violation_counted_when_audio_review_policy_disabled(self):
        """Operator PROCTOR_AUDIO_REVIEW_ONLY ni bo'shatsa — yolg'iz ovoz signali ham
        (sozlama yoqilgan imtihonda) darhol rasmiy ogohlantirish beradi."""
        exam_id = self._start_ambient_exam(audio_review_only="")
        body = self._post_audio(exam_id)
        self.assertFalse(body.get("audioReview"), body)
        self.assertFalse(body.get("warningSuppressed"), body)
        self.assertEqual(body.get("warningNumber"), 1, body)
