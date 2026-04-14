"""HTTP so‘rov konteksti (structured logging, kuzatuvchanlik)."""
from __future__ import annotations

import contextvars

_request_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    return _request_id_ctx.get()


def set_request_id(value: str | None) -> contextvars.Token[str | None]:
    return _request_id_ctx.set(value)


def reset_request_id(token: contextvars.Token[str | None]) -> None:
    _request_id_ctx.reset(token)
