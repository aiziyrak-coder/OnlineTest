"""VAC (Virtual Anti-Cheat) muhit sozlamalari — prod da guardlar default yoqilgan."""
from __future__ import annotations

import os

from django.conf import settings


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes")


def _prod_default_on() -> bool:
    return not settings.DEBUG


def vac_hmac_guard_enabled() -> bool:
    return _env_bool("VAC_HMAC_GUARD", _prod_default_on())


def vac_seq_guard_enabled() -> bool:
    return _env_bool("VAC_SEQ_GUARD", _prod_default_on())


def vac_challenge_guard_enabled() -> bool:
    return _env_bool("VAC_CHALLENGE_GUARD", _prod_default_on())


def vac_any_guard_enabled() -> bool:
    return vac_hmac_guard_enabled() or vac_seq_guard_enabled() or vac_challenge_guard_enabled()


def identity_verify_required() -> bool:
    return _env_bool("IDENTITY_VERIFY_REQUIRED", _prod_default_on())


def vac_device_lock_enabled() -> bool:
    return _env_bool("VAC_DEVICE_LOCK", True)


def vac_pc_only_enabled() -> bool:
    return _env_bool("VAC_PC_ONLY", True)


def vac_block_tablet_enabled() -> bool:
    """Planshetni non-desktop deb hisoblash (VAC_PC_ONLY bilan birga)."""
    return _env_bool("VAC_BLOCK_TABLET", True)


def is_non_desktop_client(request) -> bool:
    """
    Telefon/planshet — True. Desktop/laptop — False.
    UA + ixtiyoriy X-Client-Form-Factor: desktop|mobile|tablet|phone
    """
    if not vac_pc_only_enabled():
        return False

    ff = str(request.META.get("HTTP_X_CLIENT_FORM_FACTOR") or "").strip().lower()
    if ff in ("mobile", "phone"):
        return True
    if ff == "tablet" and vac_block_tablet_enabled():
        return True

    ua = (request.META.get("HTTP_USER_AGENT") or "").lower()
    phone_markers = (
        "iphone",
        "ipod",
        "windows phone",
        "webos",
        "blackberry",
        "opera mini",
        "iemobile",
    )
    if any(m in ua for m in phone_markers):
        return True
    # "Mobile" odatda telefon; iPad ba'zan "Mobile" ham yozadi — tablet yo'li birinchi.
    tablet_markers = ("ipad", "tablet", "kindle", "silk", "playbook")
    is_tablet_ua = any(m in ua for m in tablet_markers) or (
        "android" in ua and "mobile" not in ua
    )
    if is_tablet_ua and vac_block_tablet_enabled():
        return True
    if "mobile" in ua and not is_tablet_ua:
        return True
    if "android" in ua and "mobile" in ua:
        return True
    # Form-factor desktop deb yolg'on yuborsa ham UA telefon/planshet bo'lsa yopamiz.
    if ff == "desktop":
        return False
    return False


def exam_min_submit_seconds() -> int:
    raw = os.environ.get("EXAM_MIN_SUBMIT_SECONDS")
    if raw is not None:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 30 if not settings.DEBUG else 0


def identity_verify_max_age_seconds() -> int:
    try:
        return max(60, int(os.environ.get("IDENTITY_VERIFY_MAX_AGE_SEC", "1800")))
    except ValueError:
        return 1800
