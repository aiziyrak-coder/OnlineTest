from unittest.mock import patch
from rest_framework.test import APIRequestFactory, force_authenticate
from apps.api.tests.test_object_evidence_integration import ObjectEnforcementTests
from apps.core.models import ViolationLog

class PersonDisabledTests(ObjectEnforcementTests):
    def test_person_signals_ignored_only_in_centre_mode(self):
        """Xonada nazoratchi bor — test markazida "ikkinchi odam" signali e'tiborsiz.

        Uydan topshirganda bu signal eng muhimi, shuning uchun u yerda ishlaydi:
        hodisa qayd etiladi va odatdagi qoidaga ko'ra baholanadi."""
        self.se.test_center_mode=True
        self.se.save(update_fields=['test_center_mode'])
        for kind in ('IDENTITY_SUBSTITUTION','MULTIPLE_FACES'):
            response=self.post(kind)
            self.assertTrue(response['warningSuppressed'])
            self.assertFalse(response['banned'])
        self.assertEqual(self.se.proctor_official_warnings,0)
        self.assertFalse(ViolationLog.objects.filter(exam=self.exam).exists())

    def test_person_signals_active_outside_centre_mode(self):
        self.se.test_center_mode=False
        self.se.save(update_fields=['test_center_mode'])
        self.exam.test_center_pin=''
        self.exam.save(update_fields=['test_center_pin'])
        self.post('MULTIPLE_FACES')
        self.assertTrue(ViolationLog.objects.filter(exam=self.exam,
                                                    violation_type='MULTIPLE_FACES').exists())

    def test_in_exam_identity_requests_are_neutral_for_existing_clients(self):
        from apps.api.views.student import student_identity_compare
        request=APIRequestFactory().post('/identity',{'exam_id':self.exam.id,
            'profile_image_base64':'a'*200,'live_capture_base64':'b'*200},format='json')
        force_authenticate(request,user=self.user)
        with patch('apps.api.views.student._request_has_exam_session_guard',return_value=True), \
             patch('apps.api.views.student.compare_faces') as compare, \
             patch.object(student_identity_compare.cls,'throttle_classes',[]):
            result=student_identity_compare(request)
        self.assertEqual(result.status_code,503)
        self.assertEqual(result.data['code'],'IDENTITY_MONITORING_DISABLED')
        compare.assert_not_called()

    def test_pre_exam_identity_is_not_disabled(self):
        from apps.api.views.student import student_identity_compare
        self.se.status='Pending';self.se.save(update_fields=['status'])
        request=APIRequestFactory().post('/identity',{'exam_id':self.exam.id,
            'profile_image_base64':'a'*200,'live_capture_base64':'b'*200},format='json')
        force_authenticate(request,user=self.user)
        with patch('apps.api.face_embedding.center_identity_ambiguous',return_value=False), \
             patch('apps.api.views.student.compare_faces',return_value={'success':False,'code':'FACE_NOT_DETECTED'}) as compare, \
             patch.object(student_identity_compare.cls,'throttle_classes',[]):
            result=student_identity_compare(request)
        compare.assert_called_once()
        self.assertNotEqual(result.data.get('code'),'IDENTITY_MONITORING_DISABLED')

    def test_queued_background_identity_jobs_are_skipped(self):
        from apps.api.tasks import random_identity_check_task
        result=random_identity_check_task.run(self.se.id,'invalid-frame')
        self.assertTrue(result['skipped'])
        self.assertFalse(ViolationLog.objects.filter(exam=self.exam).exists())

    def test_submission_does_not_require_disabled_periodic_identity_refresh(self):
        import json
        from apps.api.views.student import student_exams_submit
        self.se.session_questions_json=json.dumps([{'id':1,'text':'Fixture question',
            'options':['one','two'],'correctAnswer':'one'}])
        self.se.save(update_fields=['session_questions_json'])
        request=APIRequestFactory().post('/submit',{'answers':{'1':'one'}},format='json')
        force_authenticate(request,user=self.user)
        with patch('apps.api.views.student.identity_verify_required',return_value=True), \
             patch('apps.api.views.student._identity_verification_fresh',return_value=False) as fresh, \
             patch.object(student_exams_submit.cls,'throttle_classes',[]):
            result=student_exams_submit(request,self.exam.id)
        self.assertEqual(result.status_code,200,result.data)
        fresh.assert_not_called()
        self.se.refresh_from_db()
        self.assertEqual(self.se.status,'Completed')
