"""Tezlik cheklovi (login, yuz tekshiruvi, ochiq verify)."""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class FaceVerifyThrottle(UserRateThrottle):
    scope = "face_verify"


class PublicVerifyThrottle(AnonRateThrottle):
    scope = "public_verify"
