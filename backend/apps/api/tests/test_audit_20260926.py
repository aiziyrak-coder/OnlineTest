"""26.09.2026 auditida topilgan nosozliklar qayta paydo bo'lmasligi uchun testlar.

Har bir test bitta aniq holatni yozib qo'yadi — haqiqiy hodisa qavs ichida.
"""
import json
from datetime import timedelta
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.api.authentication import JWTAuthentication, issue_token
from apps.api.proctor_exam_retake import reset_fields_for_exam_retake
from apps.api.tasks import run_finalize_ended_exams
from apps.api.views._helpers import _hash_pw, _student_assigned_to_exam
from apps.core.models import (
    AppUser, Exam, ExamGroup, ExamStudentException, Group, Kafedra, Level, StudentExam,
    StudentExamAttempt,
)


def _admin(uid="aud-admin"):
    u = AppUser.objects.create(id=uid, role="admin", name="Admin", password=_hash_pw("Parol12345!"))
    u.is_authenticated = True
    return u


def _exam(owner, **kw):
    d = dict(teacher=owner, title="Imtihon", start_time=timezone.now() - timedelta(hours=1),
             end_time=timezone.now() + timedelta(hours=2), duration_minutes=60)
    d.update(kw)
    return Exam.objects.create(**d)


class ExceptionListTests(TestCase):
    """Istisno ro'yxatidagilar (harbiylar imtihonidagi guruhdoshlar)."""

    def setUp(self):
        self.owner = _admin()
        lvl = Level.objects.create(name="1-kurs")
        self.group = Group.objects.create(name="G-1", level=lvl)
        self.inside = AppUser.objects.create(id="st-in", role="student", name="Ruxsatli", group=self.group)
        self.out = AppUser.objects.create(id="st-out", role="student", name="Istisno", group=self.group)

    def test_finalize_does_not_fail_excluded_students(self):
        # (Nevrologiya №562: 14 kishiga soxta "kelmadi" yozilgan edi)
        exam = _exam(self.owner, start_time=timezone.now() - timedelta(hours=5),
                     end_time=timezone.now() - timedelta(hours=1))
        ExamGroup.objects.create(exam=exam, group=self.group)
        ExamStudentException.objects.create(exam=exam, student=self.out, reason="boshqa talaba uchun")
        run_finalize_ended_exams()
        self.assertTrue(StudentExam.objects.filter(exam=exam, student=self.inside, status="Failed").exists())
        self.assertFalse(StudentExam.objects.filter(exam=exam, student=self.out).exists())

    def test_excluded_exam_hidden_from_student_list(self):
        from apps.api.views.student import student_exams_list

        exam = _exam(self.owner)
        ExamGroup.objects.create(exam=exam, group=self.group)
        ExamStudentException.objects.create(exam=exam, student=self.out, reason="x")
        f = APIRequestFactory()
        for user, visible in ((self.inside, True), (self.out, False)):
            user.is_authenticated = True
            req = f.get("/api/student/exams")
            force_authenticate(req, user=user)
            ids = [row["id"] for row in student_exams_list(req).data]
            self.assertEqual(exam.id in ids, visible, user.id)

    def test_excluded_student_is_not_assigned(self):
        exam = _exam(self.owner)
        ExamGroup.objects.create(exam=exam, group=self.group)
        ExamStudentException.objects.create(exam=exam, student=self.out, reason="x")
        self.assertTrue(_student_assigned_to_exam(self.inside, exam.id))
        self.assertFalse(_student_assigned_to_exam(self.out, exam.id))


class OrdinatorKafedraAssignmentTests(TestCase):
    def test_ordinator_not_assigned_to_other_kafedra_exam(self):
        # JWT foydalanuvchisida kafedra maydoni yo'q edi -> istalgan kafedra "mos" chiqardi.
        owner = _admin()
        k1 = Kafedra.objects.create(name="Pediatriya")
        k2 = Kafedra.objects.create(name="Xirurgiya")
        AppUser.objects.create(id="ord-1", role="ordinator", name="Ordinator", kafedra=k1, course=1)
        exam = _exam(owner, audience="ordinator", kafedra=k2, course=1)

        class JwtLike:  # JWTUser kabi: kafedra_id atributi yo'q
            id = "ord-1"
            role = "ordinator"
            group_id = None

        self.assertFalse(_student_assigned_to_exam(JwtLike(), exam.id))
        own = _exam(owner, audience="ordinator", kafedra=k1, course=1)
        self.assertTrue(_student_assigned_to_exam(JwtLike(), own.id))


class AttemptArchiveTests(TestCase):
    def test_reset_archives_finished_attempt_and_clears_consent(self):
        # (21.09: Xaydarova 17/25 — tozalashda iz qolmay o'chgan, bazaning zaxirasidan tiklandi)
        owner = _admin()
        st = AppUser.objects.create(id="arch-st", role="student", name="Talaba")
        exam = _exam(owner)
        se = StudentExam.objects.create(
            student=st, exam=exam, status="Completed", score=17,
            started_at=timezone.now() - timedelta(minutes=25), completed_at=timezone.now(),
            answers_json=json.dumps({"1": "A"}), result_public_id="FJSTI_TEST_1",
            vac_consent_at=timezone.now() - timedelta(minutes=26), vac_consent_version="uz:abc",
        )
        fields = reset_fields_for_exam_retake(se, reason="sinov")
        se.save(update_fields=fields)
        se.refresh_from_db()
        self.assertEqual(se.status, "Pending")
        self.assertIsNone(se.vac_consent_at)
        arch = StudentExamAttempt.objects.get(student_exam_id=se.id)
        self.assertEqual(arch.score, 17)
        self.assertEqual(arch.status, "Completed")
        self.assertEqual(json.loads(arch.snapshot)["answers_json"], json.dumps({"1": "A"}))

    def test_untouched_session_is_not_archived(self):
        owner = _admin()
        st = AppUser.objects.create(id="arch-st2", role="student", name="Talaba")
        se = StudentExam.objects.create(student=st, exam=_exam(owner), status="Pending")
        reset_fields_for_exam_retake(se)
        self.assertFalse(StudentExamAttempt.objects.exists())


class DestructiveDeleteGuardTests(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.f = APIRequestFactory()

    def _delete(self, view, **kw):
        req = self.f.delete("/x")
        force_authenticate(req, user=self.admin)
        return view(req, **kw)

    def test_exam_with_results_cannot_be_deleted(self):
        from apps.api.views.admin import admin_exam_detail

        exam = _exam(self.admin)
        st = AppUser.objects.create(id="del-st", role="student", name="T")
        StudentExam.objects.create(student=st, exam=exam, status="Completed", score=10)
        self.assertEqual(self._delete(admin_exam_detail, pk=exam.id).status_code, 409)
        self.assertTrue(Exam.objects.filter(pk=exam.id).exists())

    def test_user_owning_exams_cannot_be_deleted(self):
        from apps.api.views.admin import admin_user_detail

        other = AppUser.objects.create(id="123", role="admin", name="Eski admin")
        _exam(other)
        self.assertEqual(self._delete(admin_user_detail, user_id="123").status_code, 409)
        self.assertTrue(AppUser.objects.filter(pk="123").exists())


class TestCentrePinTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = AppUser.objects.create(id="pin-u", role="student", name="PIN")
        self.user.is_authenticated = True
        self.f = APIRequestFactory()

    def _pin(self, exam, pin):
        from apps.api.views.student import student_exam_test_center

        req = self.f.post("/x", {"pin": pin}, format="json")
        force_authenticate(req, user=self.user)
        return student_exam_test_center(req, pk=exam.id)

    @mock.patch("apps.api.views.student._student_assigned_to_exam", return_value=True)
    @mock.patch("apps.api.test_center_pin.configured_center_pin", return_value="4321")
    def test_pin_guessing_is_locked_out(self, *_):
        exam = _exam(self.user)
        codes = [self._pin(exam, "%04d" % i).status_code for i in range(10)]
        self.assertIn(429, codes)
        self.assertEqual(self._pin(exam, "4321").status_code, 429)  # to'g'ri PIN ham kutadi

    @mock.patch("apps.api.views.student._student_assigned_to_exam", return_value=True)
    @mock.patch("apps.api.test_center_pin.configured_center_pin", return_value="4321")
    def test_remote_exam_refuses_centre_mode(self, *_):
        exam = _exam(self.user, custom_rules=json.dumps({"remote": True}))
        self.assertEqual(self._pin(exam, "4321").status_code, 409)


class TokenRevocationTests(TestCase):
    def test_password_change_invalidates_old_token(self):
        u = AppUser.objects.create(id="tok-u", role="student", name="T", password=_hash_pw("Birinchi123!"))
        token = issue_token(u)
        req = APIRequestFactory().get("/x", HTTP_AUTHORIZATION="Bearer " + token)
        self.assertIsNotNone(JWTAuthentication().authenticate(req))
        u.password = _hash_pw("Ikkinchi456!")
        u.save(update_fields=["password"])
        from rest_framework.exceptions import AuthenticationFailed

        with self.assertRaises(AuthenticationFailed):
            JWTAuthentication().authenticate(req)


class BulkGrantValidationTests(TestCase):
    def test_grant_refuses_exam_of_other_kafedra(self):
        # ("Test ko'rinmayapti": ruxsat berilgan, lekin imtihon boshqa kafedraniki edi)
        from apps.api.views.bulk_access import admin_bulk_access_grant

        admin = _admin()
        k1 = Kafedra.objects.create(name="Onkologiya")
        k2 = Kafedra.objects.create(name="Urologiya")
        AppUser.objects.create(id="ord-b", role="ordinator", name="Ordinator", kafedra=k1, course=1)
        exam = _exam(admin, audience="ordinator", kafedra=k2, course=1)
        req = APIRequestFactory().post("/x", {"items": [{"user_id": "ord-b", "exam_id": exam.id}]}, format="json")
        force_authenticate(req, user=admin)
        res = admin_bulk_access_grant(req)
        self.assertEqual(res.data["granted"], 0)
        self.assertIn("kafedra", res.data["results"][0]["error"])


class ProfilePhotoOwnerTests(TestCase):
    """Login-parolni bilgan boshqa odam o'z yuzini profil rasmi qila olmasin."""

    def _post(self, user):
        from apps.api.views.profile_photo import student_profile_photo_update

        req = APIRequestFactory().post("/x", {"passport_image_base64": "p" * 200,
                                              "live_capture_base64": "l" * 200}, format="json")
        force_authenticate(req, user=user)
        return student_profile_photo_update(req)

    def _user(self, uid, photo):
        u = AppUser.objects.create(id=uid, role="student", name="T", profile_image=photo)
        u.is_authenticated = True
        return u

    @mock.patch("apps.api.views.profile_photo.crop_face_b64", return_value="yangi-rasm")
    def test_stranger_face_rejected_when_good_photo_exists(self, _crop):
        u = self._user("ph-1", "x" * 8000)
        # pasport == selfi (bir odam), lekin eski profil rasmiga mos EMAS
        with mock.patch("apps.api.views.profile_photo.compare_faces",
                        side_effect=[{"success": True, "match": True, "score": 0.9},
                                     {"success": True, "match": False, "score": 0.1}]):
            res = self._post(u)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(AppUser.objects.get(pk="ph-1").profile_image, "x" * 8000)

    @mock.patch("apps.api.views.profile_photo.crop_face_b64", return_value="yangi-rasm")
    def test_tiny_hr_photo_can_still_be_replaced(self, _crop):
        u = self._user("ph-2", "x" * 900)
        with mock.patch("apps.api.views.profile_photo.compare_faces",
                        return_value={"success": True, "match": True, "score": 0.9}):
            res = self._post(u)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(AppUser.objects.get(pk="ph-2").profile_image, "yangi-rasm")

    def test_blocked_during_exam(self):
        u = self._user("ph-3", "")
        StudentExam.objects.create(student=u, exam=_exam(_admin("ph-admin")), status="In Progress")
        with mock.patch("apps.api.views.profile_photo.compare_faces",
                        return_value={"success": True, "match": True, "score": 0.9}), \
             mock.patch("apps.api.views.profile_photo.crop_face_b64", return_value="r"):
            self.assertEqual(self._post(u).status_code, 409)


class BankCategoryGuardTests(TestCase):
    def test_category_used_by_open_exam_is_kept(self):
        from apps.api.views.admin import admin_test_bank_categories_delete
        from apps.core.models import TestBankCategory

        admin = _admin()
        cat = TestBankCategory.objects.create(name="Pediatriya banki")
        _exam(admin, bank_category_ids=json.dumps([cat.id]))
        req = APIRequestFactory().delete("/x")
        force_authenticate(req, user=admin)
        self.assertEqual(admin_test_bank_categories_delete(req, pk=cat.id).status_code, 409)
        self.assertTrue(TestBankCategory.objects.filter(pk=cat.id).exists())
