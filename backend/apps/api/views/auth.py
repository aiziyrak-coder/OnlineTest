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
    return Response(
        {
            "token": issue_token(user),
            "user": _auth_user_payload(user, role_out),
        }
    )


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
