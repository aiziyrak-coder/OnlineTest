import unittest
from unittest import mock
from apps.api.test_center_policy import suppress_center_signal, confirmed_observer, center_frame_payload

class TestCenterPolicyTests(unittest.TestCase):
    def test_nearby_bystander_defers_identity_but_distant_face_does_not(self):
        from apps.api.face_embedding import center_identity_ambiguous
        with mock.patch('apps.api.face_embedding._get_engine', return_value={'test': True}), \
             mock.patch('apps.api.face_embedding._decode_frame_b64', return_value=b'image'), \
             mock.patch('apps.api.face_embedding._detect_faces_raw') as detect:
            detect.return_value = (object(), [[0,0,100,100],[0,0,80,80]])
            self.assertTrue(center_identity_ambiguous('frame'))
            detect.return_value = (object(), [[0,0,100,100],[0,0,20,20]])
            self.assertFalse(center_identity_ambiguous('frame'))

    def test_background_and_audio_never_punish(self):
        for kind in ['MULTIPLE_FACES','MICROPHONE_MUTED','SUSPICIOUS_AUDIO',
                     'MOUTH_MOVEMENT_TALKING','HAND_GESTURE_SUSPECTED','FORBIDDEN_OBJECT_LAPTOP']:
            self.assertTrue(suppress_center_signal(kind))

    def test_observer_requires_valid_six_second_evidence(self):
        for detail in ['', '{}', '[]', '{"policy":"center_observer_v1","continuous_ms":5999}',
                       '{"policy":"center_observer_v1","continuous_ms":true}']:
            self.assertFalse(confirmed_observer(detail))
        self.assertTrue(confirmed_observer('{"policy":"center_observer_v1","continuous_ms":6000}'))

    def test_still_frame_filters_background_but_keeps_phone_and_missing_face(self):
        result = center_frame_payload({'violations':['MULTIPLE_FACES','FORBIDDEN_OBJECT_LAPTOP',
                                                    'FORBIDDEN_OBJECT_CELL_PHONE','FACE_NOT_VISIBLE']})
        self.assertEqual(result['violations'],['FORBIDDEN_OBJECT_CELL_PHONE','FACE_NOT_VISIBLE'])
