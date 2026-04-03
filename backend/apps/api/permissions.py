from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import BasePermission


class IsAuthenticatedStrict(BasePermission):
    """JWT/session yo‘q bo‘lsa 401 (API uchun aniqroq)."""

    def has_permission(self, request, view):
        u = request.user
        if u is None or not getattr(u, "is_authenticated", False):
            raise NotAuthenticated()
        return True


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(getattr(u, "is_authenticated", False) and getattr(u, "role", None) == "admin")


class IsStudent(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(getattr(u, "is_authenticated", False) and getattr(u, "role", None) == "student")
