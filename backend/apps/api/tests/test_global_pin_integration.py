from datetime import timedelta
from unittest import mock
from django.test import TestCase
from django.utils import timezone
from django.core.cache import cache
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.response import Response
from apps.core.models import AppUser, Exam, StudentExam
from apps.api.views.student import student_exams_start, student_exam_test_center

class GlobalPinIntegrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user=AppUser.objects.create(id='pin-test',role='student',name='PIN test')
        self.user.is_authenticated=True
        self.exam=Exam.objects.create(teacher=self.user,title='New exam without a per-exam PIN',
            start_time=timezone.now(),end_time=timezone.now()+timedelta(hours=1),duration_minutes=60)
        self.factory=APIRequestFactory()

    def request(self, view, data):
        req=self.factory.post('/test',data,format='json')
        force_authenticate(req,user=self.user)
        return view(req,pk=self.exam.id)

    def test_center_exam_cannot_start_without_pin(self):
        """Test markazi imtihoni (PIN belgilangan) PINsiz boshlanmaydi."""
        Exam.objects.filter(pk=self.exam.id).update(test_center_pin='87654321')
        result=self.request(student_exams_start,{})
        self.assertEqual(result.status_code,403)
        self.assertEqual(result.data['code'],'TEST_CENTER_PIN_REQUIRED')

    def test_remote_exam_starts_without_pin(self):
        """Uydan topshiriladigan imtihon PIN talab qilmaydi (aks holda kira olmaydi)."""
        Exam.objects.filter(pk=self.exam.id).update(
            test_center_pin='87654321', custom_rules='{"remote": true}')
        with mock.patch('apps.api.views.student._try_start_lock',return_value=True), \
             mock.patch('apps.api.views.student._release_start_lock'), \
             mock.patch('apps.api.views.student._student_exams_start_impl',
                        return_value=Response({'ok':True})) as start:
            result=self.request(student_exams_start,{})
        self.assertEqual(result.status_code,200,result.data)
        start.assert_called_once()

    @mock.patch('apps.api.views.student._student_assigned_to_exam',return_value=True)
    @mock.patch('apps.api.test_center_pin.configured_center_pin',return_value='87654321')
    def test_wrong_pin_rejected_correct_pin_unlocks(self, configured, assigned):
        wrong=self.request(student_exam_test_center,{'pin':'11112222'})
        self.assertEqual(wrong.status_code,403)
        self.assertFalse(StudentExam.objects.filter(student=self.user,test_center_mode=True).exists())
        correct=self.request(student_exam_test_center,{'pin':'87654321'})
        self.assertEqual(correct.status_code,200,correct.data)
        self.assertTrue(StudentExam.objects.get(student=self.user).test_center_mode)
        with mock.patch('apps.api.views.student._try_start_lock',return_value=True), \
             mock.patch('apps.api.views.student._release_start_lock'), \
             mock.patch('apps.api.views.student._student_exams_start_impl',return_value=Response({'ok':True})) as start:
            result=self.request(student_exams_start,{})
        self.assertEqual(result.status_code,200)
        start.assert_called_once()
