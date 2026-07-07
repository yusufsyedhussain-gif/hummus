"""Webhook management API endpoints."""

import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.webhook import Webhook, WebhookLog
from app.schemas.webhook import (
    WebhookCreate,
    WebhookUpdate,
    WebhookResponse,
    WebhookTestResponse,
    WebhookLogResponse,
    VALID_EVENT_TYPES,
)
from app.services.webhook_service import send_webhook

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


@router.get("/event-types")
async def list_event_types():
    """Return all valid webhook event types."""
    return {"event_types": VALID_EVENT_TYPES}


@router.get("", response_model=list[WebhookResponse])
async def list_webhooks(
    db: AsyncSession = Depends(get_db),
):
    """List all configured webhooks."""
    result = await db.execute(
        select(Webhook).order_by(Webhook.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=WebhookResponse, status_code=201)
async def create_webhook(
    webhook: WebhookCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new webhook configuration."""
    # Validate event types
    invalid_events = [e for e in webhook.events if e not in VALID_EVENT_TYPES]
    if invalid_events:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event types: {invalid_events}. Valid types: {VALID_EVENT_TYPES}",
        )

    db_webhook = Webhook(
        url=webhook.url,
        events=webhook.events,
        is_enabled=webhook.is_enabled,
        secret=webhook.secret,
    )
    db.add(db_webhook)
    await db.flush()
    await db.refresh(db_webhook)
    return db_webhook


@router.get("/{webhook_id}", response_model=WebhookResponse)
async def get_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single webhook by ID."""
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return webhook


@router.put("/{webhook_id}", response_model=WebhookResponse)
async def update_webhook(
    webhook_id: UUID,
    webhook_update: WebhookUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing webhook."""
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    update_data = webhook_update.model_dump(exclude_unset=True)

    # Validate event types if being updated
    if "events" in update_data:
        invalid_events = [e for e in update_data["events"] if e not in VALID_EVENT_TYPES]
        if invalid_events:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid event types: {invalid_events}",
            )

    for field, value in update_data.items():
        setattr(webhook, field, value)

    await db.flush()
    await db.refresh(webhook)
    return webhook


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a webhook and all its delivery logs."""
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(webhook)


@router.post("/{webhook_id}/test", response_model=WebhookTestResponse)
async def test_webhook(
    webhook_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Send a test ping to a webhook URL.
    Returns the HTTP status code and response time.
    """
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    test_payload = {
        "event": "webhook.test",
        "message": "This is a test delivery from Product Hub",
        "webhook_id": str(webhook.id),
    }

    success, status_code, response_time, error = send_webhook(
        url=webhook.url,
        event_type="webhook.test",
        payload=test_payload,
        secret=webhook.secret,
    )

    # Log the test delivery
    from app.services.webhook_service import log_webhook_delivery
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.config import get_settings

    settings = get_settings()
    sync_engine = create_engine(settings.DATABASE_SYNC_URL)
    SyncSession = sessionmaker(bind=sync_engine)
    sync_db = SyncSession()
    try:
        log_webhook_delivery(
            db=sync_db,
            webhook_id=str(webhook.id),
            event_type="webhook.test",
            request_body=test_payload,
            response_code=status_code,
            response_time=response_time,
            error_message=error,
        )
    finally:
        sync_db.close()

    return WebhookTestResponse(
        success=success,
        status_code=status_code,
        response_time_ms=round(response_time * 1000, 1) if response_time else None,
        error=error,
    )


@router.get("/{webhook_id}/logs", response_model=list[WebhookLogResponse])
async def get_webhook_logs(
    webhook_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get recent delivery logs for a webhook."""
    # Verify webhook exists
    wh_result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    if not wh_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Webhook not found")

    result = await db.execute(
        select(WebhookLog)
        .where(WebhookLog.webhook_id == webhook_id)
        .order_by(WebhookLog.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
