"""Testlar uchun ishga tushirgich: jonli server sozlamalari testlarga o'tmasin.

Konteyner muhitida DESKTOP_APP_REQUIRED=1, VAC_* himoyalari va rozilik talabi
yoqilgan. Testlar esa oddiy API mijozi bilan ishlaydi — ular 403 bilan yiqilardi.
Himoyalarning o'zini tekshiradigan testlar kerakli o'zgaruvchini o'zi yoqadi
(mock.patch.dict).
"""
import os

from django.test.runner import DiscoverRunner

TEST_ENV = {
    "DESKTOP_APP_REQUIRED": "0",
    "VAC_HMAC_GUARD": "0",
    "VAC_SEQ_GUARD": "0",
    "VAC_CHALLENGE_GUARD": "0",
    "VAC_CONSENT_REQUIRED": "0",
    "IDENTITY_VERIFY_REQUIRED": "0",
    "EXAM_MIN_SUBMIT_SECONDS": "0",
}
UNSET = (
    "DESKTOP_APP_KEY",
    "DESKTOP_MIN_VERSION",
    "PROCTOR_IDENTITY_BAN_MAX_SCORE",
    # Testlar kodning standart (qat'iy) rejimini tekshiradi; prod .env qiymati o'tmasin.
    "VAC_STRICT_MODE",
    "PROCTOR_INSTANT_BAN_VIOLATIONS",
    "PROCTOR_TECHNICAL_VIOLATIONS",
    "PROCTOR_MAX_WARNINGS_BEFORE_BAN",
    "PROCTOR_HARDENED_MODE",
    "PROCTOR_AUDIO_REVIEW_ONLY",
    "PROCTOR_NO_RETAKE_VIOLATIONS",
)


class IsolatedEnvRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        for k in UNSET:
            os.environ.pop(k, None)
        os.environ.update(TEST_ENV)
        super().setup_test_environment(**kwargs)
