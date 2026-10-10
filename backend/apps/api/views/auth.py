"""Autentifikatsiya (login) endpointi."""
from __future__ import annotations

from apps.api.views._helpers import *  # noqa: F401,F403


@api_view(["POST"])
@throttle_classes([LoginThrottle])
@permission_classes([AllowAny])
def auth_login(request):
    payload = request.data or {}
    uid = (
        payload.get("id")
        or payload.get("userId")
        or payload.get("user_id")
        or payload.get("username")
    )
    password = payload.get("password") or payload.get("pass") or payload.get("pwd")
    uid = str(uid or "").strip()
    password = str(password or "").strip()
    if not uid or not password:
        return Response({"error": "ID and password are required"}, status=400)
    user = AppUser.objects.select_related("group", "kafedra").filter(pk=uid).first()
    if not user or not _check_pw(password, user.password):
        return Response({"error": "Invalid credentials"}, status=401)
    if user.status == "Banned":
        return Response({"error": "Your account is banned. Contact administrator."}, status=403)
    if user.role == "teacher":
        return Response(
            {
                "error": "Teacher account is disabled. Create a «staff» (hodim) user in admin panel and use that login.",
                "code": "TEACHER_DEPRECATED",
            },
            status=403,
        )
    role_out = (user.role or "").strip().lower().replace("\ufeff", "").strip()
    _remember_login(request, user)
    return Response(
        {
            "token": issue_token(user),
            "user": _auth_user_payload(user, role_out),
        }
    )


def _remember_login(request, user) -> None:
    """Oxirgi kirish vaqti va IP — tekshiruvlarda "qachon, qayerdan kirgan"."""
    ip = str(
        request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR", "")
    )[:64]
    try:
        AppUser.objects.filter(pk=user.pk).update(last_login_at=dj_tz.now(), last_login_ip=ip)
    except Exception:  # noqa: BLE001 — kirishni to'xtatmasin
        logger.warning("[AUTH] oxirgi kirish yozilmadi user=%s", user.pk, exc_info=True)
    logger.info("[AUTH] kirdi user=%s role=%s ip=%s", user.pk, user.role, ip)


def _auth_user_payload(user, role_out: str | None = None) -> dict:
    role = role_out
    if role is None:
        role = (user.role or "").strip().lower().replace("\ufeff", "").strip()
    return {
        "id": user.id,
        "role": role,
        "name": user.name,
        "status": user.status,
        "group_id": user.group_id,
        "group_name": user.group.name if user.group_id else None,
        "kafedra_id": getattr(user, "kafedra_id", None),
        "kafedra_name": user.kafedra.name if getattr(user, "kafedra_id", None) else None,
        "position": getattr(user, "position", "") or "",
        "stavka": getattr(user, "stavka", "") or "",
        "profile_image": user.profile_image or None,
        "program_track": getattr(user.group, "program_track", None) if user.group_id else None,
        "academic_year": getattr(user.group, "academic_year", None) if user.group_id else None,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    """JWT → joriy foydalanuvchi (iMentor SSO / talaba tanib olish)."""
    uid = str(getattr(request.user, "id", "") or "").strip()
    if not uid:
        return Response({"error": "Unauthorized"}, status=401)
    user = AppUser.objects.select_related("group", "kafedra").filter(pk=uid).first()
    if not user:
        return Response({"error": "Unauthorized"}, status=401)
    if user.status == "Banned":
        return Response({"error": "Your account is banned. Contact administrator."}, status=403)
    return Response({"user": _auth_user_payload(user)})


# ---------------------------------------------------------------- yuz orqali kirish
from rest_framework.throttling import AnonRateThrottle  # noqa: E402


class FaceLoginThrottle(AnonRateThrottle):
    """Institut kompyuterlari bitta NAT IP orqali chiqadi — ertalab ko'p o'qituvchi birdan kiradi."""

    scope = "face_login"

    def get_rate(self):
        import os as _os

        return _os.environ.get("FACE_LOGIN_RATE", "240/min")


_FACE_MSG = {
    "FACE_BAD_REQUEST": "Kameradan 2 ta kadr yuborilishi kerak.",
    "FACE_NO_FACE": "Kadrda yuz aniq ko'rinmadi. Kameraga to'g'ri qarang, yorug' joyda turing va qayta urining.",
    "FACE_UNKNOWN": "Yuz tanilmadi. Kameraga to'g'ri qarab qayta urining yoki cam.fermi.uz da ro'yxatdan o'ting.",
    "FACE_UNLINKED": "Yuzingiz tanildi, lekin hisobingizga (JShShIR) hali bog'lanmagan. Login va parol bilan kiring.",
    "FACE_NO_ACCOUNT": "Yuzingiz tanildi, lekin bu platformada hisobingiz topilmadi. Administratorga murojaat qiling.",
    "FACE_ROLE": "Bu hisobga yuz orqali kirib bo'lmaydi. Login va parol bilan kiring.",
    "FACE_BANNED": "Your account is banned. Contact administrator.",
    "FACE_UNAVAILABLE": "Yuz orqali kirish hozir ishlamayapti. Login va parol bilan kiring.",
}


def _face_err(code: str, status: int):
    return Response({"error": _FACE_MSG[code], "code": code}, status=status)


@api_view(["POST"])
@throttle_classes([FaceLoginThrottle])
@permission_classes([AllowAny])
def auth_face_login(request):
    """Yuz orqali kirish: 2-3 ta JPEG kadr (base64) -> o'qituvchi hisobi.

    Yuzlar cam.fermi.uz -> iMentor bazasidan (FaceLoginTemplate); topilgan
    JShShIR bizdagi hisob ID siga teng bo'lishi kerak.
    """
    import base64
    import binascii

    from apps.api.face_login import identify, login_roles

    raw = (request.data or {}).get("frames")
    if not isinstance(raw, list) or not 2 <= len(raw) <= 3:
        return _face_err("FACE_BAD_REQUEST", 422)
    frames: list[bytes] = []
    for item in raw:
        s = str(item or "")
        if s.startswith("data:"):
            s = s.split(",", 1)[-1]
        try:
            data = base64.b64decode(s, validate=False)
        except (binascii.Error, ValueError):
            return _face_err("FACE_BAD_REQUEST", 422)
        if not data or len(data) > 2 * 1024 * 1024:
            return _face_err("FACE_BAD_REQUEST", 422)
        frames.append(data)

    d = identify(frames)
    if d.status == "unavailable":
        return _face_err("FACE_UNAVAILABLE", 503)
    if d.status == "no_face":
        return _face_err("FACE_NO_FACE", 422)
    if d.status == "unknown":
        return _face_err("FACE_UNKNOWN", 401)
    if d.status == "unlinked":
        return _face_err("FACE_UNLINKED", 404)

    user = AppUser.objects.select_related("group", "kafedra").filter(pk=d.pinfl).first()
    if user is None:
        return _face_err("FACE_NO_ACCOUNT", 404)
    role_out = (user.role or "").strip().lower().replace("\ufeff", "").strip()
    if role_out not in login_roles():
        return _face_err("FACE_ROLE", 403)
    if user.status == "Banned":
        return _face_err("FACE_BANNED", 403)
    # Profil rasmi yo'q o'qituvchi: yuzi cam.fermi.uz bazasidagi yuzi bilan tasdiqlandi —
    # shu kirish kadri profil rasmi bo'ladi (pasport surati so'ralmaydi).
    if not (user.profile_image or "").strip():
        try:
            from apps.api.face_embedding import crop_face_b64

            first = str(raw[0] or "")
            if first.startswith("data:"):
                first = first.split(",", 1)[-1]
            stored = crop_face_b64(first)
            if stored:
                user.profile_image = stored
                user.save(update_fields=["profile_image"])
                logger.info("[FACE-LOGIN] profil rasmi kirish kadridan saqlandi user=%s", user.pk)
        except Exception:  # noqa: BLE001 — rasm saqlanmasa ham kirish davom etadi
            logger.warning("[FACE-LOGIN] profil rasmini saqlab bo'lmadi user=%s", user.pk, exc_info=True)
    logger.info("[FACE-LOGIN] kirdi user=%s sim=%.3f", user.pk, d.similarity)
    _remember_login(request, user)
    return Response(
        {
            "token": issue_token(user),
            "user": _auth_user_payload(user, role_out),
            "method": "face",
        }
    )


# ------------------------------------------------- test markazida kirish --
class CenterLoginThrottle(AnonRateThrottle):
    """Markazda o'nlab kompyuter bitta IP dan chiqadi — cheklov keng, lekin bor."""

    scope = "center_login"

    def get_rate(self):
        import os as _os

        return _os.environ.get("CENTER_LOGIN_RATE", "600/min")


@api_view(["POST"])
@throttle_classes([CenterLoginThrottle])
@permission_classes([AllowAny])
def auth_center_login(request):
    """Pasport raqami + markaz PIN kodi bilan kirish (parol yo'q).

    Topshiruvchi 12 xonali talaba ID va alohida parolni yodlamaydi: pasportini
    yozadi, nazoratchi aytgan PIN ni kiritadi. Faqat markaz kompyuterlaridan
    ishlaydi va noto'g'ri urinishlar sanaladi.
    """
    from django.core.cache import cache

    from apps.api.center_login import (
        CENTER_ROLES, center_pin, client_ip, ip_allowed, normalize_passport, valid_passport,
    )

    ip = client_ip(request)
    if not ip_allowed(ip):
        logger.warning("[CENTER-LOGIN] ruxsatsiz IP: %s", ip)
        return Response(
            {"error": "Bu kompyuterdan imtihonga kirib bo'lmaydi. Test markazidagi "
                      "kompyuterdan foydalaning.", "code": "CENTER_IP_DENIED"},
            status=403,
        )
    expected = center_pin()
    if not expected:
        return Response(
            {"error": "Markaz PIN kodi sozlanmagan. Administratorga murojaat qiling.",
             "code": "CENTER_PIN_UNSET"},
            status=503,
        )

    d = request.data or {}
    passport = normalize_passport(d.get("passport") or d.get("login"))
    pin = "".join(ch for ch in str(d.get("pin") or "") if ch.isdigit())

    key = "centerlogin:%s" % ip
    tries = int(cache.get(key) or 0)
    if tries >= int(os.environ.get("CENTER_LOGIN_MAX_WRONG", "40") or 40):
        return Response(
            {"error": "Juda ko'p noto'g'ri urinish. Nazoratchiga murojaat qiling.",
             "code": "CENTER_LOCKED"},
            status=429,
        )

    if not valid_passport(passport):
        cache.set(key, tries + 1, 10 * 60)
        return Response(
            {"error": "Pasport raqami noto'g'ri yozilgan. Namuna: AB1234567.",
             "code": "PASSPORT_INVALID"},
            status=400,
        )
    import hmac as _hmac

    if not _hmac.compare_digest(pin.encode(), expected.encode()):
        cache.set(key, tries + 1, 10 * 60)
        logger.warning("[CENTER-LOGIN] noto'g'ri PIN ip=%s pasport=%s***", ip, passport[:4])
        return Response({"error": "PIN kod noto'g'ri.", "code": "WRONG_PIN"}, status=403)

    matches = list(
        AppUser.objects.select_related("group", "kafedra").filter(passport=passport)[:2]
    )
    if not matches:
        cache.set(key, tries + 1, 10 * 60)
        return Response(
            {"error": "Bu pasport raqami ro'yxatda topilmadi. Nazoratchiga murojaat qiling.",
             "code": "PASSPORT_NOT_FOUND"},
            status=404,
        )
    if len(matches) > 1:
        logger.error("[CENTER-LOGIN] bitta pasport ikki hisobda: %s", passport)
        return Response(
            {"error": "Bu pasport raqami bir nechta hisobga biriktirilgan. "
                      "Nazoratchiga murojaat qiling.", "code": "PASSPORT_AMBIGUOUS"},
            status=409,
        )

    user = matches[0]
    role_out = (user.role or "").strip().lower().replace("\ufeff", "").strip()
    if role_out not in CENTER_ROLES:
        return Response(
            {"error": "Bu hisob bilan imtihonga kirib bo'lmaydi.", "code": "ROLE_DENIED"},
            status=403,
        )
    if user.status == "Banned":
        return Response(
            {"error": "Hisobingiz bloklangan. Administratorga murojaat qiling.",
             "code": "BANNED"},
            status=403,
        )
    cache.delete(key)
    _remember_login(request, user)
    logger.info("[CENTER-LOGIN] kirdi user=%s ip=%s", user.pk, ip)
    return Response(
        {
            "token": issue_token(user),
            "user": _auth_user_payload(user, role_out),
            "method": "center",
        }
    )
