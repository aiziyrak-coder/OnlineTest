"""Imtihon tugash vaqti — faqat server vaqti (masofaviy semestr uchun)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from django.utils import timezone as dj_tz

from apps.core.models import Exam, StudentExam


def submission_deadline(exam: Exam, student_exam: StudentExam) -> Optional[datetime]:
    """
    Eng erta tugash: min(imtihon oynasi tugashi, talaba boshlagan vaqt + davomiylik).
    Ikkalasi ham bo‘lsa ikkalasining minimumi.
    """
    ends: list[dj_tz.datetime] = []
    if exam.end_time:
        ends.append(exam.end_time)
    if student_exam.started_at and exam.duration_minutes is not None:
        ends.append(student_exam.started_at + timedelta(minutes=int(exam.duration_minutes)))
    if not ends:
        return None
    return min(ends)


def seconds_until_deadline(exam: Exam, student_exam: StudentExam) -> int | None:
    deadline = submission_deadline(exam, student_exam)
    if deadline is None:
        return None
    delta = deadline - dj_tz.now()
    sec = int(delta.total_seconds())
    return max(0, sec)
