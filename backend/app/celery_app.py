"""Celery application configuration."""

import ssl
from celery import Celery
from app.config import get_settings

settings = get_settings()

# Strip the rediss:// ssl_cert_reqs param we may have added, and use plain URLs
# — SSL is configured separately via broker_use_ssl / redis_backend_use_ssl
broker_url = settings.CELERY_BROKER_URL
backend_url = settings.CELERY_RESULT_BACKEND

celery_app = Celery(
    "product_hub",
    broker=broker_url,
    backend=backend_url,
    include=[
        "app.tasks.csv_tasks",
        "app.tasks.webhook_tasks",
    ],
)

# Build SSL config for Upstash (rediss://) — Celery needs it set explicitly
_ssl_config = {"ssl_cert_reqs": ssl.CERT_NONE} if broker_url.startswith("rediss://") else None

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
    task_time_limit=1800,           # 30 min hard limit
    task_soft_time_limit=1500,      # 25 min soft limit
    worker_max_tasks_per_child=50,  # Recycle workers to prevent memory leaks
    task_routes={
        "app.tasks.csv_tasks.*": {"queue": "csv"},
        "app.tasks.webhook_tasks.*": {"queue": "webhooks"},
    },
    # SSL settings for Upstash (rediss://) — applied at Celery level, not URL level
    broker_use_ssl=_ssl_config,
    redis_backend_use_ssl=_ssl_config,
)
