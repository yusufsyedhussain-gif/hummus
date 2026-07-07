"""Pydantic schemas for import task progress tracking."""

from datetime import datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel


class TaskErrorDetail(BaseModel):
    """Single row-level import error."""
    row: int
    field: Optional[str] = None
    message: str


class TaskResponse(BaseModel):
    """Full import task status response."""
    id: UUID
    filename: Optional[str]
    status: str
    total_rows: int
    processed_rows: int
    inserted_count: int
    updated_count: int
    error_count: int
    errors: list[TaskErrorDetail]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskProgressEvent(BaseModel):
    """Real-time progress event sent via SSE."""
    task_id: str
    status: str
    processed_rows: int
    total_rows: int
    inserted_count: int
    updated_count: int
    error_count: int
    percentage: float
    current_batch_errors: list[TaskErrorDetail] = []
