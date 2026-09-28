import unittest
from unittest.mock import patch
from apps.api.ai_question_gen import _acceptable, _balanced_options, _para_key, _answer_extreme, preferred_bank_pool, verify_question, verify_batch


class QuestionQualityTests(unittest.TestCase):
    def question(self, correct=0):
        opts = ['choice alpha one', 'choice beta two', 'choice gamma tri', 'choice delta four', 'choice eps five']
        return {'text': ' '.join('clinical%d' % n for n in range(90)), 'options': opts,
                'correctAnswer': opts[correct], 'distractor_rationale': 'independent justification ' * 6}

    def test_correct_length_rank_is_not_forced(self):
        for n in range(5):
            self.assertTrue(_acceptable(self.question(n), set(), 'clinical'))

    def test_short_stems_and_unbalanced_options_rejected(self):
        q = self.question(); q['text'] = 'short clinical question'
        self.assertFalse(_acceptable(q, set(), 'clinical'))
        for correct in (0, 1):
            q = self.question(correct); q['options'][correct] = 'explanation ' * 20
            q['correctAnswer'] = q['options'][correct]
            self.assertFalse(_acceptable(q, set(), 'clinical'))
        self.assertFalse(_balanced_options(['x', 'a much longer choice', 'another lengthy choice']))

    def test_old_paraphrases_are_not_reused(self):
        self.assertTrue(_para_key(1, 'uz', self.question()).startswith('para_v3_hard:'))

    def test_bank_preference_preserves_keys_and_question_count(self):
        balanced = [self.question(i % 5) for i in range(12)]
        poor = self.question(); poor['options'] = ['x', 'much too long']
        pool = balanced + [poor]
        chosen = preferred_bank_pool(pool, 10)
        self.assertEqual(chosen, balanced)
        self.assertIs(chosen[0], balanced[0])
        self.assertEqual(preferred_bank_pool(pool, 13), pool)

    def test_extreme_rank_and_equal_lengths(self):
        q = self.question()
        q['options'] = ['a' * n for n in [10, 11, 12, 13, 14]]
        for i, expected in [(0, 'shortest'), (2, ''), (4, 'longest')]:
            q['correctAnswer'] = q['options'][i]
            self.assertEqual(_answer_extreme(q), expected)
        q['options'] = ['alpha', 'bravo', 'gamma', 'delta', 'other']
        q['correctAnswer'] = 'alpha'
        self.assertEqual(_answer_extreme(q), '')

    @patch('apps.api.openai_client.chat_text', side_effect=RuntimeError('offline'))
    def test_unavailable_verification_never_approves(self, chat):
        self.assertFalse(verify_question(self.question())[0])
        self.assertEqual(verify_batch([self.question()]), [False])

    @patch('apps.api.openai_client.chat_text', return_value='{"ok":"false"}')
    def test_string_boolean_never_approves(self, chat):
        self.assertFalse(verify_question(self.question())[0])
