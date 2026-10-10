"""Test markazida pasport + PIN bilan kirish (10.10.2026)."""
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.api.center_login import normalize_passport, valid_passport
from apps.api.views.auth import auth_center_login
from apps.core.models import AppUser

PIN = {"TEST_CENTER_LOGIN_PIN": "2005"}


class PassportHelpersTests(TestCase):
    def test_normalisation_forgives_spaces_and_case(self):
        self.assertEqual(normalize_passport(" ab 123 45 67 "), "AB1234567")
        self.assertTrue(valid_passport("AB1234567"))
        self.assertFalse(valid_passport("AB123456"))
        self.assertFalse(valid_passport("1234567890"))


class CenterLoginTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = AppUser.objects.create(id="344251300221", role="ordinator",
                                           name="Talaba Nomi", passport="AB1234567", course=1)
        self.f = APIRequestFactory()

    def _post(self, **body):
        req = self.f.post("/api/auth/center-login", body, format="json")
        return auth_center_login(req)

    def test_login_with_passport_and_pin(self):
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="ab 123 45 67", pin="2005")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["token"])
        self.assertEqual(res.data["user"]["id"], "344251300221")
        self.assertEqual(res.data["method"], "center")

    def test_wrong_pin_is_refused(self):
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="AB1234567", pin="1111")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "WRONG_PIN")

    def test_unknown_passport(self):
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="ZZ9999999", pin="2005")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.data["code"], "PASSPORT_NOT_FOUND")

    def test_malformed_passport(self):
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="123", pin="2005")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "PASSPORT_INVALID")

    def test_banned_account_cannot_enter(self):
        AppUser.objects.filter(pk=self.user.pk).update(status="Banned")
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="AB1234567", pin="2005")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "BANNED")

    def test_admin_account_cannot_use_this_door(self):
        AppUser.objects.create(id="adm-1", role="admin", name="Admin", passport="CD7654321")
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="CD7654321", pin="2005")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "ROLE_DENIED")

    def test_outside_computer_is_refused(self):
        with mock.patch.dict("os.environ", {**PIN, "TEST_CENTER_IPS": "45.150.24."}, clear=False):
            res = self._post(passport="AB1234567", pin="2005")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "CENTER_IP_DENIED")

    def test_pin_not_configured(self):
        with mock.patch.dict("os.environ", {"TEST_CENTER_LOGIN_PIN": ""}, clear=False):
            res = self._post(passport="AB1234567", pin="2005")
        self.assertEqual(res.status_code, 503)

    def test_guessing_is_locked_out(self):
        with mock.patch.dict("os.environ", {**PIN, "CENTER_LOGIN_MAX_WRONG": "5"}, clear=False):
            codes = [self._post(passport="AB1234567", pin="%04d" % i).status_code
                     for i in range(7)]
        self.assertIn(429, codes)

    def test_same_passport_on_two_accounts_is_reported(self):
        AppUser.objects.create(id="dup-1", role="student", name="Boshqa", passport="AB1234567")
        with mock.patch.dict("os.environ", PIN, clear=False):
            res = self._post(passport="AB1234567", pin="2005")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "PASSPORT_AMBIGUOUS")


class ScoreEditPasswordTests(TestCase):
    """Ballni tahrirlash alohida parol bilan (10.10.2026)."""

    def setUp(self):
        from datetime import timedelta
        import json as _json
        from django.utils import timezone
        from apps.core.models import Exam, StudentExam

        self.admin = AppUser.objects.create(id="sc-admin", role="admin", name="Admin")
        self.admin.is_authenticated = True
        self.exam = Exam.objects.create(
            teacher=self.admin, title="Imtihon", start_time=timezone.now() - timedelta(hours=2),
            end_time=timezone.now() - timedelta(minutes=5), duration_minutes=60,
            questions_json=_json.dumps([{"id": i, "text": "S%d" % i, "options": ["A", "B"],
                                         "correctAnswer": "A"} for i in range(1, 11)]))
        st = AppUser.objects.create(id="sc-student", role="student", name="Talaba")
        self.se = StudentExam.objects.create(student=st, exam=self.exam, status="Completed",
                                             score=5)
        self.f = APIRequestFactory()

    def _edit(self, score, password=None, header=True):
        from rest_framework.test import force_authenticate
        from apps.api.views.admin import admin_student_exams_score

        body = {"score": score}
        kw = {}
        if password is not None:
            if header:
                kw["HTTP_X_SCORE_PASSWORD"] = password
            else:
                body["edit_password"] = password
        req = self.f.post("/x", body, format="json", **kw)
        force_authenticate(req, user=self.admin)
        return admin_student_exams_score(req, pk=self.se.pk)

    def test_without_password_score_is_not_changed(self):
        with mock.patch.dict("os.environ", {}, clear=False), \
             self.settings(SCORE_EDIT_PASSWORD="1998091234"):
            res = self._edit(9)
        self.assertEqual(res.status_code, 423)
        self.assertEqual(res.data["code"], "SCORE_PASSWORD_REQUIRED")
        self.se.refresh_from_db()
        self.assertEqual(self.se.score, 5)

    def test_wrong_password_refused(self):
        with self.settings(SCORE_EDIT_PASSWORD="1998091234"):
            res = self._edit(9, password="0000")
        self.assertEqual(res.status_code, 423)
        self.se.refresh_from_db()
        self.assertEqual(self.se.score, 5)

    def test_correct_password_allows_edit(self):
        with self.settings(SCORE_EDIT_PASSWORD="1998091234"):
            res = self._edit(9, password="1998091234")
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.se.refresh_from_db()
        self.assertEqual(self.se.score, 9)

    def test_password_may_come_in_the_body(self):
        with self.settings(SCORE_EDIT_PASSWORD="1998091234"):
            res = self._edit(8, password="1998091234", header=False)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.se.refresh_from_db()
        self.assertEqual(self.se.score, 8)
