import json
import os
from unittest import mock
from apps.api.tests.test_ambient_audio_toggle import AmbientAudioToggleTests
from apps.core.models import StudentExam, ViolationLog

class CenterIntegrationTests(AmbientAudioToggleTests):
    def prepare_center(self):
        eid = self._start_ambient_exam(audio_review_only='')
        StudentExam.objects.filter(student_id=self.student.id, exam_id=eid).update(test_center_mode=True)
        return eid

    def test_center_background_is_ignored(self):
        eid = self.prepare_center()
        for kind in ['MULTIPLE_FACES','MICROPHONE_MUTED','MOUTH_MOVEMENT_TALKING',
                     'FORBIDDEN_OBJECT_LAPTOP','HAND_GESTURE_SUSPECTED']:
            response = self.client.post('/api/student/violations',
                {'exam_id':eid,'violation_type':kind}, format='json')
            self.assertEqual(response.status_code,200,response.content)
            self.assertTrue(response.json().get('warningSuppressed'),response.json())
        self.assertFalse(ViolationLog.objects.filter(exam_id=eid).exists())
        self.assertEqual(StudentExam.objects.get(exam_id=eid).status,'In Progress')

    @mock.patch('apps.api.views.student._notify_banned')
    def test_center_observer_is_logged_not_banned(self, notify):
        """Test markazida qaror nazoratchida: imtihon avtomatik to'xtatilmaydi."""
        eid = self.prepare_center()
        with mock.patch.dict(os.environ, {'PROCTOR_AUTO_BAN_IDENTITY':'1','VAC_STRICT_MODE':'1'}):
            response = self.client.post('/api/student/violations',
                {'exam_id':eid,'violation_type':'MULTIPLE_FACES',
                 'detail':json.dumps({'policy':'center_observer_v1','continuous_ms':6000})},format='json')
        self.assertEqual(response.status_code,200,response.content)
        body = response.json()
        self.assertFalse(body.get('banned'), body)
        self.assertTrue(body.get('warningSuppressed'), body)
        self.assertEqual(StudentExam.objects.get(exam_id=eid).status,'In Progress')
        notify.assert_not_called()
