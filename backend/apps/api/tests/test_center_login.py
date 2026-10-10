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


class CenterAutoModeTests(TestCase):
    """Markaz kompyuterida PIN ikkinchi marta so'ralmaydi."""

    def setUp(self):
        from datetime import timedelta
        import json as _json
        from django.utils import timezone
        from apps.core.models import Exam, ExamGroup, Group, Level, StudentExam

        self.owner = AppUser.objects.create(id="ac-admin", role="admin", name="Admin")
        lvl = Level.objects.create(name="Kurs")
        self.group = Group.objects.create(name="G", level=lvl)
        self.user = AppUser.objects.create(id="ac-student", role="student", name="Talaba",
                                           group=self.group)
        self.user.is_authenticated = True
        self.exam = Exam.objects.create(
            teacher=self.owner, title="Markaz imtihoni",
            start_time=timezone.now() - timedelta(minutes=5),
            end_time=timezone.now() + timedelta(hours=2), duration_minutes=60,
            test_center_pin="2005",
            questions_json=_json.dumps([{"id": 1, "text": "S", "options": ["A", "B"],
                                         "correctAnswer": "A"}]))
        ExamGroup.objects.create(exam=self.exam, group=self.group)
        self.f = APIRequestFactory()

    def _start(self, ip):
        from rest_framework.test import force_authenticate
        from apps.api.views.student import student_exams_start

        req = self.f.post("/x", {}, format="json", REMOTE_ADDR=ip)
        force_authenticate(req, user=self.user)
        return student_exams_start(req, pk=self.exam.id)

    def test_centre_computer_does_not_ask_for_pin_again(self):
        from apps.core.models import StudentExam

        with mock.patch.dict("os.environ", {"TEST_CENTER_IPS": "45.150.24."}, clear=False), \
             mock.patch("apps.api.views.student._try_start_lock", return_value=True), \
             mock.patch("apps.api.views.student._release_start_lock"), \
             mock.patch("apps.api.views.student._student_exams_start_impl") as impl:
            from rest_framework.response import Response as R
            impl.return_value = R({"ok": True})
            res = self._start("45.150.24.91")
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.assertTrue(StudentExam.objects.get(student=self.user, exam=self.exam).test_center_mode)

    def test_outside_computer_still_needs_the_pin(self):
        with mock.patch.dict("os.environ", {"TEST_CENTER_IPS": "45.150.24."}, clear=False):
            res = self._start("8.8.8.8")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "TEST_CENTER_PIN_REQUIRED")


class StaffPowersTests(TestCase):
    """Nazoratchi (staff) imtihon jarayonidagi amallarni bajara oladi."""

    def setUp(self):
        from datetime import timedelta
        import json as _json
        from django.utils import timezone
        from apps.core.models import Exam, StudentExam

        self.owner = AppUser.objects.create(id="sp-admin", role="admin", name="Admin")
        self.staff = AppUser.objects.create(id="sp-staff", role="staff", name="Nazoratchi")
        self.staff.is_authenticated = True
        st = AppUser.objects.create(id="sp-student", role="student", name="Talaba")
        # Imtihon BOSHQA odam nomiga yaratilgan — markazdagi odatiy holat.
        self.exam = Exam.objects.create(
            teacher=self.owner, title="Markaz imtihoni",
            start_time=timezone.now() - timedelta(minutes=10),
            end_time=timezone.now() + timedelta(hours=2), duration_minutes=60,
            questions_json=_json.dumps([{"id": 1, "text": "S", "options": ["A", "B"],
                                         "correctAnswer": "A"}]))
        self.se = StudentExam.objects.create(student=st, exam=self.exam, status="In Progress",
                                             started_at=timezone.now(), access_granted=True)
        self.f = APIRequestFactory()

    def _post(self, view, **kw):
        from rest_framework.test import force_authenticate

        req = self.f.post("/x", {}, format="json")
        force_authenticate(req, user=self.staff)
        return view(req, **kw)

    def test_without_full_powers_staff_cannot_touch_other_exams(self):
        from apps.api.views import admin as admin_views

        with mock.patch.object(admin_views, "STAFF_FULL_POWERS", False):
            res = self._post(admin_views.admin_student_exams_unblock, pk=self.se.pk)
        self.assertEqual(res.status_code, 403)

    def test_with_full_powers_staff_can_unblock(self):
        from apps.api.views import admin as admin_views

        with mock.patch.object(admin_views, "STAFF_FULL_POWERS", True):
            res = self._post(admin_views.admin_student_exams_unblock, pk=self.se.pk)
        self.assertNotEqual(res.status_code, 403)

    def test_with_full_powers_staff_can_finish_a_session(self):
        from apps.api.views import admin as admin_views
        from apps.api.views.test_center import admin_test_center_finish
        from apps.core.models import StudentExam

        with mock.patch.object(admin_views, "STAFF_FULL_POWERS", True):
            res = self._post(admin_test_center_finish, pk=self.se.pk)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        self.assertEqual(StudentExam.objects.get(pk=self.se.pk).status, "Completed")

    def test_student_role_still_cannot(self):
        from apps.api.views import admin as admin_views
        from rest_framework.test import force_authenticate

        other = AppUser.objects.create(id="sp-other", role="student", name="Boshqa")
        other.is_authenticated = True
        req = self.f.post("/x", {}, format="json")
        force_authenticate(req, user=other)
        with mock.patch.object(admin_views, "STAFF_FULL_POWERS", True):
            res = admin_views.admin_student_exams_unblock(req, pk=self.se.pk)
        self.assertEqual(res.status_code, 403)
