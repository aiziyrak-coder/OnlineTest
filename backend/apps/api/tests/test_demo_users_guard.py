"""Prodda demo hisoblar qayta tiklanmasligi.

Konteyner entrypointi har ishga tushganda `seed_demo_users` ni chaqiradi.
Prodda bu buyruq ishlaganda demo_admin hisobi ochiq hujjatdagi parol bilan
qaytib tiklanardi — ya'ni har deploydan keyin prod admin paneli hammaga
ochiq bo'lardi. Shu test o'sha yo'lni yopiq ushlab turadi.
"""
from __future__ import annotations

from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from apps.core.models import AppUser


def _env(**extra):
    """Muhitni aniq belgilaymiz — prod .env qiymatlari testga ta'sir qilmasin."""
    env = mock.patch.dict("os.environ", extra, clear=False)
    return env


class DemoUsersGuardTests(TestCase):
    def setUp(self):
        for key in ("ALLOW_DEMO_USERS", "DEMO_SEED_PASSWORD"):
            patcher = mock.patch.dict("os.environ", {}, clear=False)
            patcher.start()
            self.addCleanup(patcher.stop)
            import os

            os.environ.pop(key, None)

    @override_settings(DEBUG=False)
    def test_production_run_creates_nothing(self):
        out = StringIO()
        call_command("seed_demo_users", stdout=out)
        self.assertIn("Prod rejimi", out.getvalue())
        self.assertFalse(AppUser.objects.filter(id="demo_admin").exists())

    @override_settings(DEBUG=False)
    def test_production_run_does_not_revive_a_closed_demo_account(self):
        AppUser.objects.create(id="demo_admin", role="admin", name="Demo administrator",
                               status="Banned", password="x")
        call_command("seed_demo_users", stdout=StringIO())
        u = AppUser.objects.get(id="demo_admin")
        self.assertEqual(u.status, "Banned")
        self.assertEqual(u.password, "x")

    @override_settings(DEBUG=False)
    def test_deliberate_production_seed_needs_its_own_password(self):
        with _env(ALLOW_DEMO_USERS="1"):
            with self.assertRaises(CommandError):
                call_command("seed_demo_users", stdout=StringIO())

    @override_settings(DEBUG=True)
    def test_dev_run_still_creates_the_demo_accounts(self):
        call_command("seed_demo_users", stdout=StringIO())
        self.assertTrue(AppUser.objects.filter(id="demo_admin", status="Active").exists())
        self.assertTrue(AppUser.objects.filter(id="demo_staff", role="staff").exists())
