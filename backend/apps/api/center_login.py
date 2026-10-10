"""Test markazida KIRISH: pasport raqami + markaz PIN kodi.

Nega: ilgari topshiruvchi 12 xonali talaba ID sini va alohida parolni yozishi
kerak edi. Markazda bu eng ko'p vaqt ketadigan va eng ko'p xato chiqadigan
qadam bo'ldi — odamlar ID sini adashtirardi, parolni unutardi, navbat
to'planardi. Pasport raqami esa odamning o'zida turadi va qisqa.

Qoidalar:
  * faqat ro'yxatdagi markaz kompyuterlaridan (IP) kirish mumkin;
  * PIN kodi imtihon kuniga beriladi va faqat nazoratchilarda bo'ladi;
  * pasport raqami bo'yicha BITTA odam topilishi shart;
  * noto'g'ri urinishlar sanaladi — taxmin qilib kirib bo'lmaydi.
"""
from __future__ import annotations

import os
import re

_PASSPORT_RE = re.compile(r"^[A-Z]{2}\d{7}$")
#: Kirishga ruxsat etilgan toifalar (admin/hodim bu yo'ldan kirmaydi).
CENTER_ROLES = ("student", "ordinator", "magistr", "faculty", "entrant")


def normalize_passport(raw) -> str:
    """Bo'shliq, tire va kichik harf farqini yo'qotadi: "ab 123 45 67" -> "AB1234567"."""
    return re.sub(r"[^A-Za-z0-9]", "", str(raw or "")).upper()


def valid_passport(value: str) -> bool:
    return bool(_PASSPORT_RE.match(value))


def center_pin() -> str:
    """Imtihon kuni uchun markaz PIN kodi (env: TEST_CENTER_LOGIN_PIN)."""
    pin = str(os.environ.get("TEST_CENTER_LOGIN_PIN", "") or "").strip()
    return pin if pin.isdigit() and 4 <= len(pin) <= 8 else ""


def allowed_networks() -> list[str]:
    """Markaz kompyuterlarining IP yoki tarmoq prefikslari (env: TEST_CENTER_IPS).

    Bo'sh bo'lsa IP tekshiruvi o'tkazilmaydi — sozlanmagan serverda kirish
    butunlay to'xtab qolmasin (nazorat baribir PIN va yuz tekshiruvida).
    """
    raw = str(os.environ.get("TEST_CENTER_IPS", "") or "")
    return [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]


def ip_allowed(ip: str) -> bool:
    nets = allowed_networks()
    if not nets:
        return True
    ip = str(ip or "").strip()
    return any(ip == n or ip.startswith(n.rstrip("*")) for n in nets)


def client_ip(request) -> str:
    fwd = str(request.META.get("HTTP_X_FORWARDED_FOR", "") or "")
    return (fwd.split(",")[0].strip() or str(request.META.get("REMOTE_ADDR", "") or ""))[:64]
