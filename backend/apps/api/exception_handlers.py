"""JWT API uchun NotAuthenticated → 401; prod da 500 tafsilotlari yashirin."""
from django.conf import settings
from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler as drf_exception_handler


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None and isinstance(exc, NotAuthenticated):
        response.status_code = 401
    if response is not None and response.status_code >= 500 and not settings.DEBUG:
        response.data = {"detail": "Server error"}
    return response
