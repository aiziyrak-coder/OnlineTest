import unittest
import json
from apps.api.object_evidence import browser_object_evidence,has_physical_evidence,side_conversation_evidence

class ObjectEvidenceTests(unittest.TestCase):
    def test_phone_label_or_hand_alone_not_enough(self):
        self.assertFalse(has_physical_evidence({'ok':True,'forbidden_objects':['cell_phone']},'FORBIDDEN_OBJECT_CELL_PHONE'))
        self.assertFalse(has_physical_evidence(self.result(['hand']),'FORBIDDEN_OBJECT_CELL_PHONE'))

    def result(self,features,near=True,confidence=.95):
        return {'ok':True,'object_evidence':[{'type':'cell_phone','confidence':confidence,
            'bbox':[.2,.2,.1,.2],'features':features,'near_candidate':near}]}

    def test_phone_needs_housing_and_screen_or_lenses(self):
        self.assertTrue(has_physical_evidence(self.result(['device_body','screen']),'FORBIDDEN_OBJECT_CELL_PHONE'))
        self.assertFalse(has_physical_evidence(self.result(['device_body']),'FORBIDDEN_OBJECT_CELL_PHONE'))
        self.assertFalse(has_physical_evidence(self.result(['device_body','screen'],False),'FORBIDDEN_OBJECT_CELL_PHONE'))
        self.assertFalse(has_physical_evidence(self.result(['device_body','screen'],True,.7),'FORBIDDEN_OBJECT_CELL_PHONE'))

    def test_browser_evidence_requires_time_frames_and_confidence(self):
        good={'policy':'visible_object_v2','frames':6,'continuous_ms':1800,'score':.9}
        self.assertTrue(browser_object_evidence(json.dumps(good)))
        for field,value in [('frames',1),('score',.2),('continuous_ms',100),('frames',True)]:
            self.assertFalse(browser_object_evidence(json.dumps({**good,field:value})))

    def test_conversation_needs_six_seconds(self):
        self.assertFalse(side_conversation_evidence('{}'))
        self.assertFalse(side_conversation_evidence('{"policy":"side_conversation_v1","continuous_ms":5999}'))
        self.assertTrue(side_conversation_evidence('{"policy":"side_conversation_v1","continuous_ms":6000}'))
