import os
from pathlib import Path

from dotenv import load_dotenv
from django.core.wsgi import get_wsgi_application

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "exam_platform.settings")
application = get_wsgi_application()
