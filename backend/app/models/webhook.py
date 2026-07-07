"""Webhook and WebhookLog database models."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, Index
)
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import relationship
from app.database import Base


class Webhook(Base):
    """Webhook configuration model."""

    __tablename__ = "webhooks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url = Column(String(2048), nullable=False)
    events = Column(ARRAY(String), nullable=False, default=list)
    is_enabled = Column(Boolean, default=True)
    secret = Column(String(256), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    logs = relationship(
        "WebhookLog",
        back_populates="webhook",
        cascade="all, delete-orphan",
        order_by="WebhookLog.created_at.desc()",
    )

    def __repr__(self):
        return f"<Webhook(url={self.url}, events={self.events})>"


class WebhookLog(Base):
    """Log of webhook delivery attempts."""

    __tablename__ = "webhook_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    webhook_id = Column(
        UUID(as_uuid=True),
        ForeignKey("webhooks.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type = Column(String(100), nullable=False)
    request_body = Column(JSON, nullable=True)
    response_code = Column(Integer, nullable=True)
    response_time = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    webhook = relationship("Webhook", back_populates="logs")

    __table_args__ = (
        Index("idx_webhook_logs_webhook_created", "webhook_id", "created_at"),
    )

    def __repr__(self):
        return f"<WebhookLog(webhook_id={self.webhook_id}, status={self.response_code})>"
