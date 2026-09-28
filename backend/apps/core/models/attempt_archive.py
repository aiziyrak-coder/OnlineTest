"""Imtihon urinishlari arxivi.

Sessiya "qayta imkon" yoki tozalash bilan Pending holatiga qaytarilganda eski
urinishning javoblari, bali va vaqtlari butunlay o'chib ketardi. 21.09.2026 da
shu sabab tugatilgan natijalar yo'qoldi va ularni faqat butun bazaning
zaxirasidan tiklash mumkin bo'ldi. Endi har bir tozalashdan OLDIN urinishning
to'liq nusxasi shu jadvalga yoziladi.

Ataylab ForeignKey YO'Q: sessiya, foydalanuvchi yoki imtihon o'chirilsa ham
arxiv qatori saqlanib qoladi.
"""
from django.db import models


class StudentExamAttempt(models.Model):
    student_exam_id = models.IntegerField(db_index=True)
    student_id = models.CharField(max_length=64, db_index=True)
    exam_id = models.IntegerField(db_index=True)
    status = models.CharField(max_length=20, blank=True, default="")
    score = models.IntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    result_public_id = models.CharField(max_length=100, blank=True, default="")
    #: Sessiya qatorining barcha maydonlari (JSON).
    snapshot = models.TextField()
    reason = models.CharField(max_length=200, blank=True, default="")
    archived_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        app_label = "core"
        db_table = "student_exam_attempts"
        ordering = ["-archived_at"]
