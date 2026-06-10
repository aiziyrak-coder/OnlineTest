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


def chat_text(prompt: str, *, temperature: float = 0.0) -> str:
    client = _client()
    if not client:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    candidates = _text_model_candidates()
    if not candidates:
        raise RuntimeError("OPENAI_MODEL is empty")
    last_exc: BaseException | None = None
    for model in candidates:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
            )
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
) -> str:
    """images: (bytes, mime_type) ro'yxati."""
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
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
        )
    resp = client.chat.completions.create(
        model=use_model,
        messages=[{"role": "user", "content": content}],
        temperature=temperature,
    )
    return (resp.choices[0].message.content or "").strip()
