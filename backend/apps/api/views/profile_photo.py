"""Profil rasmini o'zi yangilash — pasport rasmi + jonli selfi orqali.

NEGA KERAK: o'qituvchilar HR bazasidan 47x60 piksellik kichik kadrlar bilan
import qilingan. Bunday rasmda yuz ~40 piksel bo'ladi va imtihonga kirishdagi
solishtiruv ishonchsiz ishlaydi ("Profil rasmingiz bilan mos kelmadi").
Odam pasportidagi sifatli rasmni yuklab, o'zining jonli selfisi bilan
tasdiqlasa — profil rasmi yangilanadi va tekshiruv barqaror bo'ladi.

TEKSHIRUV: pasportdagi yuz va jonli selfi LOKAL OpenCV bilan solishtiriladi
(apps.api.face_embedding). Tashqi AI chaqirilmaydi, xarajat yo'q.

Ism-familyani pasportdan o'qish (OCR) ataylab QILINMAYDI: u AI talab qiladi va
ortiqcha — foydalanuvchi allaqachon o'z login-paroli bilan kirgan, yuz
solishtiruvi esa pasport aynan o'shanikimi degan savolga javob beradi.
"""
from __future__ import annotations

import base64
import io

from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.api.gemini_tools import compare_faces
from apps.api.identity_log import log_identity
from apps.api.face_embedding import crop_face_b64
from apps.api.throttles import FaceVerifyThrottle
from apps.api.views._helpers import _is_student_user
from apps.core.models import AppUser

MAX_B64 = 14 * 1024 * 1024
MIN_B64 = 80
#: Shundan katta profil rasmi yuzni solishtirishga yaroqli hisoblanadi (HEMIS
#: rasmlari ~6-20 KB). HR bazasidagi 47x60 piksellik kadrlar bundan kichik —
#: aynan ular uchun o'zi yangilash imkoni qoldiriladi.
PROFILE_TRUST_MIN_B64 = 6000
# Profilga saqlanadigan rasm o'lchami: yuz aniq ko'rinishi uchun yetarli,
# lekin bazani shishirmaydigan darajada.
STORE_MAX_SIDE = 600
STORE_QUALITY = 88


def _shrink_to_jpeg_b64(raw_b64: str) -> str | None:
    """Rasmni oqilona o'lchamga keltirib, JPEG base64 qaytaradi."""
    try:
        from PIL import Image

        b64 = raw_b64.split(",", 1)[1] if "," in raw_b64 else raw_b64
        data = base64.b64decode(b64 + "=" * (-len(b64) % 4))
        im = Image.open(io.BytesIO(data)).convert("RGB")
        if max(im.width, im.height) > STORE_MAX_SIDE:
            ratio = STORE_MAX_SIDE / float(max(im.width, im.height))
            im = im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio))))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=STORE_QUALITY)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


@api_view(["POST"])
@throttle_classes([FaceVerifyThrottle])
@permission_classes([IsAuthenticated])
def student_profile_photo_update(request):
    u = request.user
    if not _is_student_user(u):
        return Response({"error": "Forbidden", "code": "STUDENT_ONLY"}, status=403)

    body = request.data or {}
    passport = body.get("passport_image_base64")
    live = body.get("live_capture_base64")
    if not isinstance(passport, str) or not isinstance(live, str):
        return Response({"error": "Invalid body", "code": "INVALID_BODY"}, status=400)
    if not (MIN_B64 <= len(passport) <= MAX_B64) or not (MIN_B64 <= len(live) <= MAX_B64):
        return Response({"error": "Invalid image payload", "code": "INVALID_IMAGE"}, status=400)

    # Pasportdagi yuz <-> jonli selfi (lokal, bepul)
    # Nima kelayotgani va nima uchun rad etilayotgani logda ko'rinsin —
    # busiz "hammada yuz aniqlanmadi" shikoyatini tekshirib bo'lmasdi.
    log_identity(
        "profile_photo_request",
        user_id=getattr(u, "id", None),
        passport_b64_len=len(passport),
        live_b64_len=len(live),
    )
    result = compare_faces(passport, live)
    log_identity(
        "profile_photo_result",
        user_id=getattr(u, "id", None),
        success=bool(result.get("success")),
        match=result.get("match"),
        score=result.get("score"),
        code=result.get("code"),
    )
    if not result.get("success"):
        return Response(
            {"ok": False, "code": result.get("code") or "COMPARE_FAILED"},
            status=503,
        )
    if not result.get("match"):
        return Response(
            {
                "ok": False,
                "code": result.get("code") or "NO_MATCH",
                "score": result.get("score"),
            },
            status=200,
        )

    # Profilga BUTUN pasport sahifasi emas, YUZNING O'ZI saqlanadi. Sahifa
    # saqlanganda yuz kadrning kichik, yon burilgan va yaltiragan bo'lagi
    # bo'lib qolardi — imtihon oldidagi solishtiruv deyarli nol natija berardi.
    stored = crop_face_b64(passport)
    used_crop = bool(stored)
    if not stored:
        stored = _shrink_to_jpeg_b64(passport)
    if not stored:
        return Response({"ok": False, "code": "INVALID_IMAGE"}, status=400)

    row = AppUser.objects.filter(pk=u.id).first()
    if not row:
        return Response({"error": "User not found"}, status=404)
    from apps.core.models import AuditLog, StudentExam

    # Imtihon davomida shaxsni tekshirish rasmi almashtirilmaydi.
    if StudentExam.objects.filter(student_id=row.pk, status="In Progress").exists():
        return Response(
            {"ok": False, "code": "EXAM_IN_PROGRESS",
             "error": "Imtihon davomida profil rasmini almashtirib bo'lmaydi."},
            status=409,
        )
    # Ilgari pasport rasmi faqat SELFI bilan solishtirilardi — ya'ni login-parolni
    # bilgan BOSHQA odam o'z pasporti va o'z yuzini qo'yib, imtihondagi shaxs
    # tekshiruvidan o'tib ketardi. Endi sifatli eski rasm bo'lsa, jonli yuz UNGA
    # ham mos kelishi shart; aks holda rasmni faqat administrator almashtiradi.
    old = (row.profile_image or "").strip()
    if len(old) >= PROFILE_TRUST_MIN_B64:
        owner = compare_faces(old, live)
        if owner.get("success") and not owner.get("match"):
            log_identity("profile_photo_owner_mismatch", user_id=row.pk, score=owner.get("score"))
            return Response(
                {"ok": False, "code": "OWNER_MISMATCH",
                 "error": "Jonli yuz hozirgi profil rasmingizga mos kelmadi. Rasmni almashtirish "
                          "uchun administratorga murojaat qiling."},
                status=409,
            )
    row.profile_image = stored
    row.save(update_fields=["profile_image"])
    AuditLog.objects.create(
        actor_id=str(row.pk), actor_name=str(row.name or ""), action="profile_photo_self_update",
        target_type="user", target_id=str(row.pk), target_name=str(row.name or ""),
        detail="pasport-selfi o'xshashligi=%s; eski rasm %d belgi" % (result.get("score"), len(old)),
    )

    # Saqlangan rasmni javobda ham qaytaramiz. Klient uni brauzerdagi
    # keshlangan `user` obyektiga yozadi — busiz odam rasmni yangilagandan
    # keyin ham imtihonga ESKI rasm bilan kirardi va yuz tanilmasdi.
    return Response(
        {
            "ok": True,
            "score": result.get("score"),
            "method": result.get("method"),
            "photo": stored,
            "cropped": used_crop,
        }
    )
