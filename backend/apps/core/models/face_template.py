from django.db import models


class FaceLoginTemplate(models.Model):
    """Yuz orqali kirish uchun shablon — iMentor (cam.fermi.uz) bazasidan nusxa.

    `pinfl` bo'sh bo'lsa — shablon hech kimga bog'lanmagan. U baribir saqlanadi:
    aniqlashda "boshqa odam" sifatida qatnashadi, aks holda bazada yo'q odam
    o'ziga o'xshash o'qituvchi nomidan kirib ketishi mumkin edi.
    """

    source_id = models.CharField(max_length=64, unique=True)
    pinfl = models.CharField(max_length=14, blank=True, default="", db_index=True)
    full_name = models.CharField(max_length=255, blank=True, default="")
    embedding = models.TextField()
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "face_login_template"

    def __str__(self) -> str:
        return f"{self.full_name} ({self.pinfl or '-'})"
