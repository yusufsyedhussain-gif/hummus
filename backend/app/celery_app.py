"""Celery application configuration."""

from celery import Celery
from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "product_hub",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.csv_tasks",
        "app.tasks.webhook_tasks",
    ],
)

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
)
