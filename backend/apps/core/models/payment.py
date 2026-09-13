"""To'lov kvitansiyasi — ordinator/magistr qayta urinish uchun to'lasa.

Birinchi urinish bepul EMAS: imtihon yopiq turadi, admin to'lovni tasdiqlagach
ochiladi. Imkoniyat tugagach nomzod kvitansiyani rasmga olib yuklaydi, u shu
yerga tushadi, admin buxgalteriya bilan tekshirib tasdiqlaydi yoki rad etadi.
"""
from django.db import models

from apps.core.models.user import AppUser
from apps.core.models.exam import Exam


class PaymentReceipt(models.Model):
    STATUS_PENDING = "Pending"
    STATUS_APPROVED = "Approved"
    STATUS_REJECTED = "Rejected"

    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id",
        related_name="payment_receipts",
    )
    exam = models.ForeignKey(
        Exam, on_delete=models.CASCADE, db_column="exam_id", null=True, blank=True,
    )
    file_name = models.CharField(max_length=255)
    file_mime = models.CharField(max_length=100)
    file_base64 = models.TextField()
    note = models.TextField(blank=True, default="")
    status = models.CharField(max_length=16, default=STATUS_PENDING)
    admin_note = models.TextField(blank=True, default="")
    reviewed_by = models.CharField(max_length=64, blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "core"
        db_table = "payment_receipts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"], name="payment_receipts_status_idx"),
            models.Index(fields=["student"], name="payment_receipts_student_idx"),
        ]
