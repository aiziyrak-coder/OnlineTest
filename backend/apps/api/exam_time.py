"""Imtihon tugash vaqti — faqat server vaqti (masofaviy semestr uchun)."""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from django.utils import timezone as dj_tz

from apps.core.models import Exam, ExamRetakeWindow, StudentExam


def student_in_exam_access_window(exam: Exam, student_id: str, now: dj_tz.datetime | None = None) -> bool:
    """Umumiy oyna yoki shaxsiy retake oynasi ichidami."""
    now = now or dj_tz.now()
    in_general = bool(
        exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time
    )
    if in_general:
        return True
    return ExamRetakeWindow.objects.filter(
        exam_id=exam.id,
        student_id=student_id,
        window_start__lte=now,
        window_end__gte=now,
    ).exists()


def submission_deadline(
    exam: Exam,
    student_exam: StudentExam,
    *,
    student_id: str | None = None,
    now: dj_tz.datetime | None = None,
) -> Optional[dj_tz.datetime]:
    """
    Eng erta tugash: min(mavjud chegaralar).
    Retake oynasida umumiy exam.end_time o'tib ketgan bo'lsa, retake window_end ishlatiladi.
    """
    now = now or dj_tz.now()
    ends: list[dj_tz.datetime] = []
    in_general = bool(
        exam.start_time and exam.end_time and exam.start_time <= now <= exam.end_time
    )
    rw_end = None
    if in_general and exam.end_time:
        ends.append(exam.end_time)
    elif student_id:
        rw_end = (
            ExamRetakeWindow.objects.filter(
                exam_id=exam.id,
                student_id=student_id,
                window_start__lte=now,
                window_end__gte=now,
            )
            .order_by("window_end")
            .values_list("window_end", flat=True)
            .first()
        )
        if rw_end:
            ends.append(rw_end)
    # Umumiy oyna tugagan va faol retake oynasi yo'q — umumiy tugash vaqti amal qiladi.
    # Ilgari `elif student_id` shoxi hech narsa qo'shmasa ham bu shartga yetib
    # kelinmasdi va end_time dan keyin ham `started_at + davomiylik` gacha topshirish
    # qabul qilinardi.
    if not ends and exam.end_time and not in_general and rw_end is None:
        ends.append(exam.end_time)

    if student_exam.started_at and exam.duration_minutes is not None:
        ends.append(student_exam.started_at + timedelta(minutes=int(exam.duration_minutes)))
    if not ends:
        return None
    return min(ends)


def is_student_exam_expired(
    exam: Exam,
    student_exam: StudentExam,
    student_id: str,
    now: dj_tz.datetime | None = None,
) -> bool:
    """In Progress sessiya vaqti tugagan yoki kirish oynasi yopilgan."""
    now = now or dj_tz.now()
    if (student_exam.status or "").strip() != "In Progress":
        return False
    if not student_in_exam_access_window(exam, student_id, now):
        return True
    deadline = submission_deadline(exam, student_exam, student_id=student_id, now=now)
    return bool(deadline and now > deadline)


def seconds_until_deadline(
    exam: Exam,
    student_exam: StudentExam,
    *,
    student_id: str | None = None,
) -> int | None:
    deadline = submission_deadline(exam, student_exam, student_id=student_id)
    if deadline is None:
        return None
    delta = deadline - dj_tz.now()
    sec = int(delta.total_seconds())
    return max(0, sec)
