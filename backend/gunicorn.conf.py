"""Gunicorn — prod (systemd / Docker). Muhit orqali sozlash."""
from __future__ import annotations

import multiprocessing
import os

bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:8000")
workers = int(os.environ.get("WEB_CONCURRENCY", str(min(multiprocessing.cpu_count() * 2 + 1, 9))))
workers = max(2, workers)
worker_class = "sync"
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "900"))
graceful_timeout = int(os.environ.get("GUNICORN_GRACEFUL_TIMEOUT", "30"))
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", "2000"))
max_requests_jitter = int(os.environ.get("GUNICORN_MAX_REQUESTS_JITTER", "200"))
preload_app = os.environ.get("GUNICORN_PRELOAD_APP", "0").strip() in ("1", "true", "yes")
accesslog = "-"
errorlog = "-"
capture_output = True
