"""JWT API uchun NotAuthenticated → 401; prod da 500 tafsilotlari yashirin."""
import logging

from django.conf import settings
from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler as drf_exception_handler

from apps.core.request_context import get_request_id

logger = logging.getLogger("apps.api")


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None and isinstance(exc, NotAuthenticated):
        response.status_code = 401
    if response is not None and response.status_code >= 500:
        if not settings.DEBUG:
            logger.exception("API 500: %s", getattr(exc, "__class__", type(exc)).__name__)
            payload: dict = {"detail": "Server error"}
            rid = get_request_id()
            if rid:
                payload["request_id"] = rid
            response.data = payload
        else:
            logger.exception("API 500 (DEBUG): %s", exc)
    return response
