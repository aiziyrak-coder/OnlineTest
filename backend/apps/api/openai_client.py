"""OpenAI Chat Completions — matn va vision (yuz, skan/rasm)."""

from __future__ import annotations

import base64
import logging
from typing import Any

from django.conf import settings

_logger = logging.getLogger(__name__)


def api_key_configured() -> bool:
    return bool((getattr(settings, "OPENAI_API_KEY", None) or "").strip())


def _client():
    key = (getattr(settings, "OPENAI_API_KEY", None) or "").strip()
    if not key:
        return None
    from openai import OpenAI

    return OpenAI(api_key=key, timeout=90.0, max_retries=2)


def _model_not_found(exc: BaseException) -> bool:
    code = getattr(exc, "status_code", None)
    if code in (404, 400):
        detail = str(exc).lower()
        if "model" in detail and ("not found" in detail or "does not exist" in detail or "invalid" in detail):
            return True
    detail = str(exc).lower()
    return (
        "model_not_found" in detail
        or "does not exist" in detail
        or "invalid model" in detail
        or "no longer available" in detail
    )


def _text_model_candidates() -> list[str]:
    primary = (getattr(settings, "OPENAI_MODEL", None) or "").strip()
    raw_fb = (getattr(settings, "OPENAI_MODEL_FALLBACKS", None) or "").strip()
    parts: list[str] = []
    if primary:
        parts.append(primary)
    if raw_fb:
        parts.extend(x.strip() for x in raw_fb.split(",") if x.strip())
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        key = p.lower()
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _vision_model() -> str:
    return (getattr(settings, "OPENAI_VISION_MODEL", None) or "gpt-4o").strip() or "gpt-4o"


#: Token hisobi Redis'da shuncha kun saqlanadi.
_USAGE_TTL = 60 * 60 * 24 * 40


def _caller_feature() -> str:
    """Qaysi funksiya so'rov yubordi (hisobotda sarfni funksiya bo'yicha ajratish uchun)."""
    import sys

    f = sys._getframe(2)
    for _ in range(8):
        if f is None:
            break
        mod = str(f.f_globals.get("__name__", ""))
        name = f.f_code.co_name
        if not mod.endswith("openai_client") and name not in ("_generate", "<lambda>"):
            return name
        f = f.f_back
    return "unknown"


def _record_usage(resp: Any, model: str) -> None:
    """Har bir so'rovning token sarfini logga va kunlik hisoblagichga yozadi. Hech qachon yiqilmaydi."""
    try:
        u = getattr(resp, "usage", None)
        if u is None:
            return
        pin = int(getattr(u, "prompt_tokens", 0) or 0)
        pout = int(getattr(u, "completion_tokens", 0) or 0)
        det = getattr(u, "prompt_tokens_details", None)
        cached = int(getattr(det, "cached_tokens", 0) or 0) if det is not None else 0
        feat = _caller_feature()
        _logger.info(
            "[AI-USAGE] feature=%s model=%s in=%d cached=%d out=%d", feat, model, pin, cached, pout
        )
        from django.core.cache import cache
        from django.utils import timezone

        day = timezone.localdate().strftime("%Y%m%d")
        base = "ai_usage:%s:%s:%s" % (day, feat, model)
        for suffix, val in (("calls", 1), ("in", pin), ("cached", cached), ("out", pout)):
            k = base + ":" + suffix
            cache.add(k, 0, _USAGE_TTL)
            try:
                cache.incr(k, val)
            except ValueError:
                cache.set(k, val, _USAGE_TTL)
        idx = "ai_usage_idx:%s" % day
        combos = cache.get(idx) or []
        if base not in combos:
            combos.append(base)
            cache.set(idx, combos, _USAGE_TTL)
    except Exception:  # noqa: BLE001
        pass


def usage_report(days: int = 7) -> list[dict]:
    """Oxirgi `days` kunlik token sarfi: [{day, feature, model, calls, in, cached, out}]."""
    from datetime import timedelta

    from django.core.cache import cache
    from django.utils import timezone

    rows: list[dict] = []
    today = timezone.localdate()
    for d in range(days):
        day = (today - timedelta(days=d)).strftime("%Y%m%d")
        for base in cache.get("ai_usage_idx:%s" % day) or []:
            _, _, feat, model = base.split(":", 3)
            row = {"day": day, "feature": feat, "model": model}
            for suffix in ("calls", "in", "cached", "out"):
                row[suffix] = int(cache.get(base + ":" + suffix) or 0)
            rows.append(row)
    return rows


def chat_text(
    prompt: str,
    *,
    temperature: float = 0.0,
    model: str | None = None,
    timeout: float | None = None,
    max_retries: int | None = None,
    prompt_cache_key: str | None = None,
) -> str:
    """Matn so'rovi. `model` berilsa — avval o'sha model sinaladi.

    Imtihon savollari kabi sifat muhim joylarda kuchliroq model ishlatish
    uchun (OPENAI_EXAM_MODEL). Model topilmasa odatdagi ro'yxatga tushadi.

    `timeout`/`max_retries` — uzun so'rovlar uchun: 90 s da uzilib, SDK
    o'zi qayta yuborsa, OpenAI birinchi (tugagan) javob uchun ham token
    hisoblaydi — ya'ni bir savol to'plami uchun 2-3 marta to'lanardi.
    """
    client = _client()
    if not client:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if timeout is not None or max_retries is not None:
        opts: dict[str, Any] = {}
        if timeout is not None:
            opts["timeout"] = float(timeout)
        if max_retries is not None:
            opts["max_retries"] = int(max_retries)
        client = client.with_options(**opts)
    candidates = _text_model_candidates()
    if model and str(model).strip():
        candidates = [str(model).strip()] + [
            c for c in candidates if c.lower() != str(model).strip().lower()
        ]
    if not candidates:
        raise RuntimeError("OPENAI_MODEL is empty")
    last_exc: BaseException | None = None
    for model in candidates:
        try:
            extra: dict[str, Any] = {}
            if prompt_cache_key:
                # Bir xil boshlanishli so'rovlarni bitta kesh serveriga yo'naltiradi —
                # keshlangan qism yarim narxda (sinovda 1489 tokendan 1280 tasi).
                extra["prompt_cache_key"] = prompt_cache_key
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                **extra,
            )
            _record_usage(resp, model)
            return (resp.choices[0].message.content or "").strip()
        except Exception as exc:
            if _model_not_found(exc):
                _logger.warning("OpenAI model %r rejected (%s); trying fallback.", model, exc)
                last_exc = exc
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("OpenAI chat completion failed")


def chat_vision(
    prompt: str,
    images: list[tuple[bytes, str]],
    *,
    temperature: float = 0.0,
    model: str | None = None,
    detail: str | None = None,
) -> str:
    """images: (bytes, mime_type) ro'yxati. detail="low" — arzon (kichik kadr uchun yetarli)."""
    client = _client()
    if not client:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    use_model = (model or _vision_model()).strip()
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for data, mime in images:
        b64 = base64.b64encode(data).decode("ascii")
        content.append(
            {
                "type": "image_url",
                "image_url": (
                    {"url": f"data:{mime};base64,{b64}", "detail": detail}
                    if detail
                    else {"url": f"data:{mime};base64,{b64}"}
                ),
            }
        )
    resp = client.chat.completions.create(
        model=use_model,
        messages=[{"role": "user", "content": content}],
        temperature=temperature,
    )
    _record_usage(resp, use_model)
    return (resp.choices[0].message.content or "").strip()
