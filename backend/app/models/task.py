"""ImportTask database model for tracking CSV import jobs."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSON, UUID
from app.database import Base


class ImportTask(Base):
    """Tracks the state and progress of CSV import operations."""

    __tablename__ = "import_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(String(500), nullable=True)
    status = Column(String(50), default="queued", nullable=False)
    total_rows = Column(Integer, default=0)
    processed_rows = Column(Integer, default=0)
    inserted_count = Column(Integer, default=0)
    updated_count = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    errors = Column(JSON, default=list)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Valid statuses: queued, parsing, validating, importing, completed, failed

    def __repr__(self):
        return f"<ImportTask(id={self.id}, status={self.status})>"
