"""iMentor (cam.fermi.uz) yuz shablonlarini JSON fayldan import qilish.

Fayl deploy/sync-face-templates.sh tomonidan yaratiladi:
  [{"source_id": "...", "pinfl": "4280...", "full_name": "...", "embedding": "[...]"}, ...]
Jadval to'liq almashtiriladi (iMentor'da o'chirilgan/nofaol yuz bu yerda ham qolmaydi).
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.api.face_login import parse_embedding
from apps.core.models import FaceLoginTemplate


class Command(BaseCommand):
    help = "Yuz orqali kirish shablonlarini JSON fayldan yangilash"

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--min", type=int, default=50, help="Kamroq bo'lsa — import qilinmaydi (xato eksport)")

    def handle(self, path, min, **opts):
        try:
            with open(path, encoding="utf-8") as fh:
                rows = json.load(fh) or []
        except (OSError, ValueError) as ex:
            raise CommandError(f"Faylni o'qib bo'lmadi: {ex}")
        good = []
        seen = set()
        for r in rows:
            sid = str(r.get("source_id") or "").strip()[:64]
            if not sid or sid in seen or parse_embedding(r.get("embedding")) is None:
                continue
            seen.add(sid)
            pinfl = str(r.get("pinfl") or "").strip()
            good.append(
                FaceLoginTemplate(
                    source_id=sid,
                    # Xodim: 14 xonali JSHSHIR. Talaba/ordinator: OnlineTest hisob raqami
                    # (iMentor owner_key "ot_<id>"). Ikkalasi ham AppUser.pk.
                    pinfl=pinfl if (8 <= len(pinfl) <= 14 and pinfl.isdigit()) else "",
                    full_name=str(r.get("full_name") or "")[:255],
                    embedding=r.get("embedding") if isinstance(r.get("embedding"), str) else json.dumps(r.get("embedding")),
                )
            )
        # Bog'lanish faqat haqiqatda mavjud hisobga: aks holda begona raqam yuzni
        # "bog'langan" qilib qo'yardi.
        from apps.core.models import AppUser

        ids = {g.pinfl for g in good if g.pinfl}
        real = set(AppUser.objects.filter(pk__in=ids).values_list("pk", flat=True)) if ids else set()
        for g in good:
            if g.pinfl and g.pinfl not in real:
                g.pinfl = ""
        if len(good) < min:
            raise CommandError(f"Juda kam shablon ({len(good)} < {min}) — eski ma'lumot saqlab qolindi")
        with transaction.atomic():
            FaceLoginTemplate.objects.all().delete()
            FaceLoginTemplate.objects.bulk_create(good, batch_size=200)
        linked = sum(1 for g in good if g.pinfl)
        self.stdout.write(f"FACE_SYNC ok jami={len(good)} bog'langan={linked}")
