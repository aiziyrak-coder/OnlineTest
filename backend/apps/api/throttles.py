"""Tezlik cheklovi (login, yuz tekshiruvi, ochiq verify)."""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginThrottle(AnonRateThrottle):
    scope = "login"


class FaceVerifyThrottle(UserRateThrottle):
    scope = "face_verify"


class PublicVerifyThrottle(AnonRateThrottle):
    scope = "public_verify"


class ExamAutosaveThrottle(UserRateThrottle):
    """Javoblarni serverga avtosaqlash (har talaba)."""

    scope = "exam_autosave"


class BankAiImportThrottle(UserRateThrottle):
    """Test bazasiga AI orqali yuklash (qimmat)."""

    scope = "bank_ai_import"


class ViolationThrottle(UserRateThrottle):
    """Proktoring buzilishlari — server va bazani himoya qilish."""

    scope = "violations"
