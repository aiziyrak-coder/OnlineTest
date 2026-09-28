import copy
from unittest.mock import patch
from django.test import SimpleTestCase,override_settings
from django.core.cache import cache
from apps.api import ai_question_gen as gen
from apps.api.text_only_questions import requires_visual,text_only_pool,reusable_clinical

def sample():
    return {'id':1,'text':' '.join(['clinical']*70),'options':['Aaaaa','Bbbbb','Ccccc','Ddddd','Eeeee'],'correctAnswer':'Aaaaa','source':'ai_generated'}

@override_settings(CACHES={'default':{'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}})
class CostPolicyTests(SimpleTestCase):
    def setUp(self):cache.clear()
    def test_visual_languages(self):
        for text in ['Rasmda nima berilgan?','Suratga qarang','Расмда нима?','На рисунке показано','На снимке','See the following ECG','Refer to the image','The diagram shows','<img src="x">','![scan](x)']:
            with self.subTest(text=text):self.assertTrue(requires_visual({'text':text}))
    def test_text_imaging_is_allowed(self):
        for text in ['KT tekshiruvida chap o‘pkada 3 sm o‘choq topildi.','ECG: ST elevation in leads II, III, aVF.','МРТ выявила очаг 3 см.']:
            self.assertFalse(requires_visual({'text':text}))
    def test_media_fields(self):self.assertTrue(requires_visual({'text':'clinical','imageUrl':'x'}))
    def test_translation(self):self.assertTrue(requires_visual({'text':'normal','translations':{'ru':{'text':'На рисунке'}}}))
    def test_options(self):self.assertTrue(requires_visual({'text':'normal','options':['See figure A']}))
    def test_pool(self):self.assertEqual(len(text_only_pool([sample(),{'text':'Rasmda'}])),1)
    def test_reusable(self):self.assertTrue(reusable_clinical(sample()))
    def test_reusable_quality(self):
        for change in [{'source':'bank'},{'text':'too short'},{'options':['Aaaaa','B']},{'image':'x'}]:
            self.assertFalse(reusable_clinical({**sample(),**change}))
    def test_exact_verification_reuse(self):
        with patch.object(gen,'_verify_many_uncached',return_value=[True]) as mock:
            self.assertEqual(gen.verify_many([sample()],'subject'),[True])
            self.assertEqual(gen.verify_many([sample()],'subject'),[True]);self.assertEqual(mock.call_count,1)
    def test_duplicate_one_request(self):
        with patch.object(gen,'_verify_many_uncached',return_value=[True]) as mock:
            self.assertEqual(gen.verify_many([sample(),sample()]),[True,True]);self.assertEqual(len(mock.call_args.args[0]),1)
    def test_changed_answer_rechecks(self):
        with patch.object(gen,'_verify_many_uncached',return_value=[True]) as mock:
            gen.verify_many([sample()]);q=sample();q['correctAnswer']='Bbbbb';gen.verify_many([q]);self.assertEqual(mock.call_count,2)
    def test_changed_subject_rechecks(self):
        with patch.object(gen,'_verify_many_uncached',return_value=[True]) as mock:
            gen.verify_many([sample()],'one');gen.verify_many([sample()],'two');self.assertEqual(mock.call_count,2)
    def test_failures_not_cached(self):
        with patch.object(gen,'_verify_many_uncached',return_value=[False]) as mock:
            self.assertEqual(gen.verify_many([sample()]),[False]);gen.verify_many([sample()]);self.assertEqual(mock.call_count,2)
    def test_visual_no_api(self):
        with patch.object(gen,'_verify_many_uncached') as mock:
            self.assertEqual(gen.verify_many([{'text':'Rasmda'}]),[False]);mock.assert_not_called()
    def test_one_verified_paraphrase_is_enough(self):
        q=sample();pq={**q,'text':' '.join(['different']*70)}
        gen.remember_paraphrases(5,'uz',[(q,pq)])
        self.assertIsNotNone(gen.cached_paraphrase(5,'uz',q))
    def test_visual_paraphrase_cache_rejected(self):
        q=sample();gen.remember_paraphrases(5,'uz',[(q,{**q,'text':'Rasmda'})])
        self.assertIsNone(gen.cached_paraphrase(5,'uz',q))
    def test_generation_prompt(self):self.assertIn('FAQAT MATNLI',gen._prompt([sample()],2,'uz','test'))
