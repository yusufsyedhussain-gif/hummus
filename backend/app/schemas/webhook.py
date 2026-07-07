"""Pydantic schemas for Webhook API request/response validation."""

from datetime import datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field, HttpUrl


VALID_EVENT_TYPES = [
    "product.created",
    "product.updated",
    "product.deleted",
    "product.imported",
    "products.cleared",
]


class WebhookBase(BaseModel):
    """Shared webhook fields."""
    url: str = Field(..., max_length=2048, description="Webhook endpoint URL")
    events: list[str] = Field(
        ...,
        min_length=1,
        description="Event types to subscribe to",
    )
    is_enabled: bool = Field(default=True, description="Whether the webhook is active")


class WebhookCreate(WebhookBase):
    """Schema for creating a new webhook."""
    secret: Optional[str] = Field(None, max_length=256, description="HMAC signing secret")


class WebhookUpdate(BaseModel):
    """Schema for updating a webhook (all fields optional)."""
    url: Optional[str] = Field(None, max_length=2048)
    events: Optional[list[str]] = Field(None, min_length=1)
    is_enabled: Optional[bool] = None
    secret: Optional[str] = Field(None, max_length=256)


class WebhookResponse(BaseModel):
    """Schema for webhook API responses."""
    id: UUID
    url: str
    events: list[str]
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WebhookTestResponse(BaseModel):
    """Response from testing a webhook."""
    success: bool
    status_code: Optional[int] = None
    response_time_ms: Optional[float] = None
    error: Optional[str] = None


class WebhookLogResponse(BaseModel):
    """Schema for webhook delivery log entries."""
    id: UUID
    webhook_id: UUID
    event_type: str
    response_code: Optional[int]
    response_time: Optional[float]
    error_message: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
