"""Celery tasks for asynchronous webhook delivery."""

import logging
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.config import get_settings
from app.services.webhook_service import (
    send_webhook,
    log_webhook_delivery,
    get_webhooks_for_event,
)

logger = logging.getLogger(__name__)
settings = get_settings()

sync_engine = create_engine(settings.DATABASE_SYNC_URL)
SyncSession = sessionmaker(bind=sync_engine)


@celery_app.task(
    bind=True,
    name="app.tasks.webhook_tasks.fire_webhook",
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(ConnectionError,),
    retry_backoff=True,
    retry_backoff_max=600,
)
def fire_webhook(self, webhook_id: str, url: str, event_type: str,
                 payload: dict, secret: str = None):
    """Send a webhook delivery and log the result."""
    db = SyncSession()
    try:
        success, status_code, response_time, error = send_webhook(
            url=url,
            event_type=event_type,
            payload=payload,
            secret=secret,
        )

        log_webhook_delivery(
            db=db,
            webhook_id=webhook_id,
            event_type=event_type,
            request_body=payload,
            response_code=status_code,
            response_time=response_time,
            error_message=error,
        )

        if not success:
            logger.warning(
                f"Webhook delivery failed: webhook={webhook_id}, "
                f"url={url}, status={status_code}, error={error}"
            )
            # Retry on failure
            if self.request.retries < self.max_retries:
                raise self.retry(exc=Exception(error or "Delivery failed"))

        return {
            "webhook_id": webhook_id,
            "success": success,
            "status_code": status_code,
            "response_time": response_time,
        }
    finally:
        db.close()


@celery_app.task(name="app.tasks.webhook_tasks.dispatch_event")
def dispatch_event(event_type: str, payload: dict):
    """
    Find all webhooks subscribed to an event type and enqueue individual deliveries.
    This is the main entry point for triggering webhooks from the application.
    """
    db = SyncSession()
    try:
        webhooks = get_webhooks_for_event(db, event_type)
        for webhook in webhooks:
            fire_webhook.delay(
                webhook_id=str(webhook.id),
                url=webhook.url,
                event_type=event_type,
                payload=payload,
                secret=webhook.secret,
            )
        logger.info(
            f"Dispatched event '{event_type}' to {len(webhooks)} webhooks"
        )
    finally:
        db.close()
