from django.apps import AppConfig
from django.db.backends.signals import connection_created


def _sqlite_enable_wal(sender, connection, **kwargs):
    """SQLite: WAL + synchronous=NORMAL — yozuvlar barqarorroq, kutilmagan o‘chishda yo‘qolish kamayadi."""
    if connection.vendor != "sqlite":
        return
    try:
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
    label = "core"
    verbose_name = "Core"

    def ready(self):
        from . import checks  # noqa: F401 — @register() system checks

        connection_created.connect(_sqlite_enable_wal)
