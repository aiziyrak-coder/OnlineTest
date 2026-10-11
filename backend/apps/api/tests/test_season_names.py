"""Test mavsumlari NOM bo'yicha (Exam.season).

Hisobot sana bo'yicha emas, mavsum nomi bo'yicha guruhlanishi kerak: bir
mavsum bir necha kun davom etsa ham bitta hisobot, ketma-ket kunlardagi ikki
mavsum esa qo'shilib ketmasligi kerak. Nomi berilmagan eski imtihonlar uchun
sanalardan aniqlash saqlanadi.
"""
from __future__ import annotations

import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone as dj_tz
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.core.models import AppUser, Exam

QUESTIONS = [{"id": 1, "text": "S", "options": ["A", "B", "C", "D"], "correctAnswer": "A"}]


def _exam(teacher_id: str, title: str, day_offset: int, *, season: str = "", course: int = 2,
          audience: str = "ordinator") -> Exam:
    start = dj_tz.now() - timedelta(days=day_offset)
    return Exam.objects.create(
        teacher_id=teacher_id, title=title, season=season, audience=audience, course=course,
        start_time=start, end_time=start + timedelta(hours=2), duration_minutes=60,
        questions_json=json.dumps(QUESTIONS), language="uz", exam_mode="static",
        bank_category_ids="[]", bank_question_count=0,
    )


class SeasonByNameTests(TestCase):
    def setUp(self):
        self.admin = AppUser.objects.create(id="sn-admin", role="admin", name="Admin")
        self.admin.is_authenticated = True
        self.f = APIRequestFactory()

    def _seasons(self):
        from apps.api.views.admin_reports import list_seasons

        return list_seasons()

    def test_one_name_spanning_two_days_is_a_single_season(self):
        _exam(self.admin.id, "A", 1, season="2-kurs ordinatura 2-imkoniyat")
        _exam(self.admin.id, "B", 2, season="2-kurs ordinatura 2-imkoniyat")
        named = [s for s in self._seasons() if s.get("named")]
        self.assertEqual(len(named), 1)
        self.assertEqual(named[0]["exam_count"], 2)
        self.assertEqual(named[0]["label"], "2-kurs ordinatura 2-imkoniyat")

    def test_two_names_on_the_same_day_stay_apart(self):
        _exam(self.admin.id, "A", 1, season="1-imkoniyat")
        _exam(self.admin.id, "B", 1, season="2-imkoniyat")
        named = sorted((s for s in self._seasons() if s.get("named")), key=lambda s: s["label"])
        self.assertEqual([s["label"] for s in named], ["1-imkoniyat", "2-imkoniyat"])
        self.assertEqual([s["exam_count"] for s in named], [1, 1])

    def test_the_label_carries_no_date(self):
        _exam(self.admin.id, "A", 1, season="2-kurs ordinatura 1-imkoniyat")
        sn = next(s for s in self._seasons() if s.get("named"))
        self.assertNotIn(".2", sn["label"])
        self.assertTrue(sn["date_label"])

    def test_exams_without_a_name_still_group_by_date(self):
        _exam(self.admin.id, "A", 1)
        _exam(self.admin.id, "B", 40)
        unnamed = [s for s in self._seasons() if not s.get("named")]
        self.assertEqual(len(unnamed), 2)

    def test_rename_writes_the_name_to_every_exam_of_the_season(self):
        from apps.api.views.admin_reports import admin_reports_season_rename

        e1 = _exam(self.admin.id, "A", 1)
        e2 = _exam(self.admin.id, "B", 2)
        key = next(s["key"] for s in self._seasons() if not s.get("named"))
        req = self.f.post("/x", {"season": key, "name": "2-kurs ordinatura 2-imkoniyat"}, format="json")
        force_authenticate(req, user=self.admin)
        res = admin_reports_season_rename(req)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        e1.refresh_from_db()
        e2.refresh_from_db()
        self.assertEqual(e1.season, "2-kurs ordinatura 2-imkoniyat")
        self.assertEqual(e2.season, "2-kurs ordinatura 2-imkoniyat")
        named = [s for s in self._seasons() if s.get("named")]
        self.assertEqual(len(named), 1)
        self.assertEqual(named[0]["key"], "name:2-kurs ordinatura 2-imkoniyat")

    def test_an_empty_name_puts_the_season_back_on_dates(self):
        from apps.api.views.admin_reports import admin_reports_season_rename

        e = _exam(self.admin.id, "A", 1, season="Nomli mavsum")
        req = self.f.post("/x", {"season": "name:Nomli mavsum", "name": ""}, format="json")
        force_authenticate(req, user=self.admin)
        res = admin_reports_season_rename(req)
        self.assertEqual(res.status_code, 200, getattr(res, "data", None))
        e.refresh_from_db()
        self.assertEqual(e.season, "")
        self.assertFalse([s for s in self._seasons() if s.get("named")])

    def test_a_name_already_used_by_another_season_is_refused(self):
        from apps.api.views.admin_reports import admin_reports_season_rename

        _exam(self.admin.id, "A", 1, season="Band nom")
        _exam(self.admin.id, "B", 40)
        key = next(s["key"] for s in self._seasons() if not s.get("named"))
        req = self.f.post("/x", {"season": key, "name": "Band nom"}, format="json")
        force_authenticate(req, user=self.admin)
        res = admin_reports_season_rename(req)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data.get("code"), "SEASON_NAME_TAKEN")

    def test_only_admin_may_rename(self):
        from apps.api.views.admin_reports import admin_reports_season_rename

        _exam(self.admin.id, "A", 1, season="Nom")
        staff = AppUser.objects.create(id="sn-staff", role="staff", name="Nazoratchi")
        staff.is_authenticated = True
        req = self.f.post("/x", {"season": "name:Nom", "name": "Boshqa"}, format="json")
        force_authenticate(req, user=staff)
        res = admin_reports_season_rename(req)
        self.assertEqual(res.status_code, 403)

    def test_report_follows_the_name(self):
        from apps.api.views.audience_reports import build_audience_report

        _exam(self.admin.id, "A", 1, season="2-kurs ordinatura 2-imkoniyat")
        data = build_audience_report("name:2-kurs ordinatura 2-imkoniyat")
        self.assertEqual((data.get("season") or {}).get("label"), "2-kurs ordinatura 2-imkoniyat")
