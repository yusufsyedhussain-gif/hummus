"""Webhook dispatch service — sends HTTP POST to configured webhook URLs."""

import hashlib
import hmac
import json
import logging
import time
from typing import Optional

import httpx
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.config import get_settings
from app.models.webhook import Webhook, WebhookLog

logger = logging.getLogger(__name__)
settings = get_settings()


def sign_payload(payload: str, secret: str) -> str:
    """Generate HMAC-SHA256 signature for webhook payload."""
    return hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def send_webhook(
    url: str,
    event_type: str,
    payload: dict,
    secret: Optional[str] = None,
    timeout: int = None,
) -> tuple[bool, Optional[int], Optional[float], Optional[str]]:
    """
    Send an HTTP POST to the webhook URL.
    Returns (success, status_code, response_time_seconds, error_message).
    """
    timeout = timeout or settings.WEBHOOK_TIMEOUT_SECONDS
    body = json.dumps(payload, default=str)

    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event_type,
        "User-Agent": "ProductHub/1.0",
    }

    if secret:
        signature = sign_payload(body, secret)
        headers["X-Webhook-Signature"] = f"sha256={signature}"

    start = time.monotonic()

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, content=body, headers=headers)
            elapsed = time.monotonic() - start
            success = 200 <= response.status_code < 300
            return success, response.status_code, elapsed, None

    except httpx.TimeoutException:
        elapsed = time.monotonic() - start
        return False, None, elapsed, f"Timeout after {timeout}s"

    except httpx.ConnectError as e:
        elapsed = time.monotonic() - start
        return False, None, elapsed, f"Connection error: {str(e)}"

    except Exception as e:
        elapsed = time.monotonic() - start
        logger.exception(f"Webhook delivery failed for {url}")
        return False, None, elapsed, f"Unexpected error: {str(e)}"


def log_webhook_delivery(
    db: Session,
    webhook_id: str,
    event_type: str,
    request_body: dict,
    response_code: Optional[int],
    response_time: Optional[float],
    error_message: Optional[str],
):
    """Record a webhook delivery attempt in the database."""
    import uuid
    log_entry = WebhookLog(
        id=uuid.uuid4(),
        webhook_id=webhook_id,
        event_type=event_type,
        request_body=request_body,
        response_code=response_code,
        response_time=response_time,
        error_message=error_message,
    )
    db.add(log_entry)
    db.commit()


def get_webhooks_for_event(db: Session, event_type: str) -> list[Webhook]:
    """Find all enabled webhooks subscribed to a given event type."""
    result = db.execute(
        select(Webhook).where(
            Webhook.is_enabled == True,
            Webhook.events.any(event_type),
        )
    )
    return result.scalars().all()
