"""Testlar uchun ishga tushirgich: jonli server sozlamalari testlarga o'tmasin.

Konteyner muhitida DESKTOP_APP_REQUIRED=1, VAC_* himoyalari va rozilik talabi
yoqilgan. Testlar esa oddiy API mijozi bilan ishlaydi — ular 403 bilan yiqilardi.
Himoyalarning o'zini tekshiradigan testlar kerakli o'zgaruvchini o'zi yoqadi
(mock.patch.dict).
"""
import os

from django.test.runner import DiscoverRunner
from django.test.utils import override_settings

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
    # Nazoratchi vakolatlari: testlar ikki rejimni ham o'zi aniq belgilaydi.
    "STAFF_FULL_POWERS",
    # Test markazi sozlamalari: prod .env dagi qiymat testlarga o'tsa, "PIN
    # so'ralsinmi" degan testlar serverda boshqacha natija berardi.
    "TEST_CENTER_IPS",
    "TEST_CENTER_LOGIN_PIN",
    "SCORE_EDIT_PASSWORD",
    "CENTER_LOGIN_MAX_WRONG",
)


#: Testlar TASHQI xizmatlarga ulanmaydi. Sozlamalarda REDIS_URL bo'lsa, kesh va
#: WebSocket qatlami Redis'ga qarab turadi; Redis o'chiq bo'lsa (CI, yangi
#: dasturchi kompyuteri, yarim ko'tarilgan stek) har bir so'rov nom aniqlash
#: xatosi bilan yiqilardi — bitta sababdan 137 ta test "ERROR" bo'lib chiqardi
#: va asl muammo ko'rinmay ketardi.
ISOLATED_SETTINGS = {
    "CACHES": {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "test-isolated",
        }
    },
    "CHANNEL_LAYERS": {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
    # Fon vazifalari broker kutmasin — darhol shu yerda bajariladi.
    "CELERY_TASK_ALWAYS_EAGER": True,
    "CELERY_TASK_EAGER_PROPAGATES": True,
}


class IsolatedEnvRunner(DiscoverRunner):
    def setup_test_environment(self, **kwargs):
        for k in UNSET:
            os.environ.pop(k, None)
        os.environ.update(TEST_ENV)
        super().setup_test_environment(**kwargs)
        self._isolation = override_settings(**ISOLATED_SETTINGS)
        self._isolation.enable()
        # Channels qatlam nusxasini keshlab qo'yadi — eski (Redis) qatlam qolmasin.
        try:
            from channels.layers import channel_layers

            channel_layers.backends = {}
        except Exception:  # noqa: BLE001 — qatlam bo'lmasa ham testlar ishlayversin
            pass

    def teardown_test_environment(self, **kwargs):
        iso = getattr(self, "_isolation", None)
        if iso is not None:
            iso.disable()
        super().teardown_test_environment(**kwargs)
