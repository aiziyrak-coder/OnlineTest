import unittest
from unittest import mock
from apps.api.test_center_pin import configured_center_pin, center_start_allowed

class CenterPinTests(unittest.TestCase):
    def test_missing_and_unconfirmed_sessions_cannot_start(self):
        for session in [None, {}, {'test_center_mode':False}, {'status':'In Progress','test_center_mode':False}]:
            self.assertFalse(center_start_allowed(session))
        self.assertTrue(center_start_allowed({'test_center_mode':True}))

    def test_unconfigured_secret_fails_closed(self):
        with mock.patch('pathlib.Path.read_text',side_effect=FileNotFoundError):
            self.assertIsNone(configured_center_pin())

    def test_secret_format(self):
        for pin in ['', 'abc', '123', '123456789']:
            with mock.patch('pathlib.Path.read_text',return_value=pin):
                self.assertIsNone(configured_center_pin())
        with mock.patch('pathlib.Path.read_text',return_value='87654321\n'):
            self.assertEqual(configured_center_pin(),'87654321')
