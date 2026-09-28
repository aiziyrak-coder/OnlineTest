import os,json
from datetime import timedelta
from unittest import mock
from django.test import TestCase
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIRequestFactory,force_authenticate
from apps.core.models import AppUser,Exam,StudentExam,ViolationLog
from apps.api.views.student import student_violations

class ObjectEnforcementTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user=AppUser.objects.create(id='object-test',role='student',name='Object test')
        self.user.is_authenticated=True
        now=timezone.now()
        self.exam=Exam.objects.create(teacher=self.user,title='Object test',start_time=now-timedelta(minutes=10),
            end_time=now+timedelta(hours=1),duration_minutes=60)
        self.se=StudentExam.objects.create(student=self.user,exam=self.exam,status='In Progress',
            started_at=now-timedelta(minutes=5),test_center_mode=True)
        env=mock.patch.dict(os.environ,{'VAC_STRICT_MODE':'1','PROCTOR_AUTO_BAN_IDENTITY':'1',
            'PROCTOR_STARTUP_GRACE_SECONDS':'0','PROCTOR_IGNORED_VIOLATIONS':'',
            'PROCTOR_HARDENED_MODE':'1','PROCTOR_HARDENED_MAX_POINTS':'8'})
        env.start();self.addCleanup(env.stop)
        for name,result in [('_student_assigned_to_exam',True),('_reject_non_desktop_or_none',None),
                            ('_enforce_bound_device_or_403',None),('_verify_exam_hmac_or_403',None),('_notify_banned',None)]:
            patch=mock.patch('apps.api.views.student.'+name,return_value=result)
            patch.start();self.addCleanup(patch.stop)

    def post(self,kind='FORBIDDEN_OBJECT_CELL_PHONE',detail=''):
        req=APIRequestFactory().post('/api/student/violations',{'exam_id':self.exam.id,'violation_type':kind,
            'detail':detail,'screenshot_url':'data:image/jpeg;base64,'+'a'*100},format='json')
        force_authenticate(req,user=self.user)
        result=student_violations(req)
        self.assertEqual(result.status_code,200,result.data)
        self.se.refresh_from_db()
        return result.data

    def detail(self):
        return json.dumps({'policy':'visible_object_v2','frames':7,'continuous_ms':1800,'score':.95})

    @mock.patch('apps.api.gemini_tools.analyze_proctor_frame',return_value={'ok':True,'object_evidence':[]})
    def test_hand_misclassified_as_phone_never_bans(self,vision):
        result=self.post(detail=self.detail())
        self.assertTrue(result['warningSuppressed'])
        self.assertEqual(self.se.status,'In Progress')
        self.assertEqual(self.se.proctor_official_warnings,0)
        self.assertEqual(ViolationLog.objects.get(exam=self.exam).outcome,'review')

    @mock.patch('apps.api.gemini_tools.analyze_proctor_frame')
    def test_visible_phone_in_centre_is_evidence_not_ban(self,vision):
        """Test markazida telefon ham avtomatik chetlatmaydi — dalil yoziladi,
        qarorni xonadagi nazoratchi chiqaradi."""
        vision.return_value={'ok':True,'object_evidence':[{'type':'cell_phone','confidence':.95,
            'bbox':[.2,.2,.1,.2],'features':['device_body','screen'],'near_candidate':True}]}
        result=self.post(detail=self.detail())
        self.assertFalse(result['banned'],result)
        self.assertTrue(result['warningSuppressed'],result)
        self.assertEqual(self.se.status,'In Progress')
        self.assertEqual(ViolationLog.objects.filter(exam=self.exam).first().outcome,'review')

    @mock.patch('apps.api.gemini_tools.analyze_proctor_frame')
    def test_visible_phone_outside_centre_blocks_attempt(self,vision):
        """Uydan topshirganda esa tasdiqlangan telefon imtihonni to'xtatadi."""
        self.se.test_center_mode=False
        self.se.save(update_fields=['test_center_mode'])
        self.exam.test_center_pin=''
        self.exam.save(update_fields=['test_center_pin'])
        vision.return_value={'ok':True,'object_evidence':[{'type':'cell_phone','confidence':.95,
            'bbox':[.2,.2,.1,.2],'features':['device_body','screen'],'near_candidate':True}]}
        result=self.post(detail=self.detail())
        self.assertTrue(result['banned'],result)
        self.assertEqual(self.se.status,'Banned')

    def test_hand_near_ear_is_not_a_phone(self):
        result=self.post('HAND_NEAR_EAR')
        self.assertTrue(result['warningSuppressed'])
        self.assertFalse(ViolationLog.objects.filter(exam=self.exam).exists())

    def test_staffed_room_behaviour_never_accumulates_penalties(self):
        from apps.api.test_center_policy import CENTER_IGNORED
        for kind in sorted(CENTER_IGNORED):
            result = self.post(kind, json.dumps({'policy': 'center_observer_v1', 'continuous_ms': 10000}))
            self.assertTrue(result.get('warningSuppressed'), (kind, result))
            self.assertFalse(result.get('banned'), (kind, result))
        self.assertEqual(self.se.proctor_official_warnings, 0)
        self.assertEqual(self.se.status, 'In Progress')
        self.assertFalse(ViolationLog.objects.filter(exam=self.exam).exists())

    def test_unconfirmed_reviews_do_not_accumulate_into_a_ban(self):
        ViolationLog.objects.bulk_create([ViolationLog(student=self.user,exam=self.exam,
            violation_type='FORBIDDEN_OBJECT_CELL_PHONE',timestamp=timezone.now()-timedelta(seconds=90),outcome='review') for _ in range(12)])
        result=self.post('GAZE_AWAY_LEFT')
        self.assertFalse(result.get('banned'),result)
        self.assertEqual(self.se.status,'In Progress')
