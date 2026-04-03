import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.core.models import AppUser


class JWTUser:
    """Ruxsatlar faqat bazadagi AppUser dan — JWT payload dagi role/name ishonchli emas."""

    __slots__ = ("id", "pk", "role", "name", "group_id", "is_authenticated")

    def __init__(self, uid: str, role: str, name: str, group_id):
        self.id = uid
        self.pk = uid
        self.role = role
        self.name = name
        self.group_id = group_id
        self.is_authenticated = True


class JWTAuthentication(BaseAuthentication):
    keyword = b"Bearer"

    def authenticate(self, request):
        auth = request.META.get("HTTP_AUTHORIZATION")
        if not auth or not auth.startswith("Bearer "):
            return None
        token = auth[7:].strip()
        if not token:
            return None
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET,
                algorithms=["HS256"],
                options={"require": ["exp"]},
            )
        except jwt.PyJWTError:
            raise AuthenticationFailed("Invalid token")
        uid = payload.get("id") or payload.get("sub")
        if not uid:
            raise AuthenticationFailed("Invalid token payload")
        user = AppUser.objects.filter(pk=uid).first()
        if not user:
            raise AuthenticationFailed("User not found")
        if user.status == "Banned":
            raise AuthenticationFailed("Banned")
        jwt_user = JWTUser(uid, user.role, user.name, user.group_id)
        return (jwt_user, None)


def issue_token(user: AppUser) -> str:
    import os
    from datetime import datetime, timedelta, timezone

    try:
        hours = int(os.environ.get("JWT_EXPIRE_HOURS", "24"))
    except ValueError:
        hours = 24
    hours = max(1, min(hours, 168))
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=hours)
    payload = {
        "id": user.id,
        "role": user.role,
        "name": user.name,
        "group_id": user.group_id,
        "iat": now,
        "exp": exp,
    }
    raw = jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
    return raw if isinstance(raw, str) else raw.decode("ascii")
