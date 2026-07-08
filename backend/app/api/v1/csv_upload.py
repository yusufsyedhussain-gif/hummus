"""CSV upload and import task progress API endpoints."""

import uuid
import json
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import redis.asyncio as aioredis

from app.database import get_db
from app.config import get_settings
from app.models.task import ImportTask
from app.schemas.task import TaskResponse
from app.tasks.csv_tasks import process_csv_import

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(tags=["CSV Import"])


@router.post("/csv/upload", status_code=202)
async def upload_csv(
    file: UploadFile = File(..., description="CSV file to import"),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a CSV file for async processing.
    CSV content is passed directly to the Celery task as an argument
    (stored in broker/Redis by Celery automatically).
    Returns immediately with a task_id for progress tracking.
    """
    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail="File must be a CSV file (.csv extension)",
        )

    # Validate file size
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds maximum of {settings.MAX_UPLOAD_SIZE_MB}MB",
        )

    task_id = str(uuid.uuid4())

    # Decode CSV content — pass directly to Celery (no separate Redis key needed)
    try:
        csv_text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        csv_text = content.decode("latin-1")

    # Create import task record
    import_task = ImportTask(
        id=uuid.UUID(task_id),
        filename=file.filename,
        status="queued",
    )
    db.add(import_task)
    await db.flush()

    # Enqueue Celery task — CSV content travels with the task message in the broker
    process_csv_import.delay(task_id, csv_text)

    logger.info(f"CSV upload accepted: task={task_id}, file={file.filename}, size={len(content)} bytes")

    return {
        "task_id": task_id,
        "status": "queued",
        "message": "CSV file accepted for processing",
    }


@router.get("/tasks/{task_id}/progress")
async def task_progress_sse(task_id: str):
    """
    Server-Sent Events endpoint for real-time import progress.
    Subscribes to Redis Pub/Sub channel for the given task.
    """
    async def event_generator():
        redis_client = aioredis.from_url(settings.CELERY_BROKER_URL)
        pubsub = redis_client.pubsub()
        channel = f"task:{task_id}:progress"

        try:
            await pubsub.subscribe(channel)

            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )

                if message and message["type"] == "message":
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")
                    yield f"data: {data}\n\n"

                    # Check if task is complete
                    parsed = json.loads(data)
                    if parsed.get("status") in ("completed", "failed"):
                        yield f"data: {json.dumps({'status': 'stream_end'})}\n\n"
                        break
                else:
                    # Send keepalive to prevent connection timeout
                    yield f": keepalive\n\n"
                    await asyncio.sleep(0.5)

        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            await redis_client.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task_status(
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get the current status and details of an import task."""
    result = await db.execute(
        select(ImportTask).where(ImportTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Import task not found")
    return task


@router.post("/tasks/{task_id}/retry", status_code=202)
async def retry_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Retry a failed import task."""
    result = await db.execute(
        select(ImportTask).where(ImportTask.id == uuid.UUID(task_id))
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Import task not found")

    if task.status != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Can only retry failed tasks. Current status: {task.status}",
        )

    # For retry, we can't re-use the original CSV (it was passed as a task argument, not stored).
    # Inform the user they need to re-upload.
    raise HTTPException(
        status_code=410,
        detail="Retry is not supported. Please re-upload the CSV file to start a new import.",
    )

    return {"task_id": task_id, "status": "queued", "message": "Import retry queued"}


@router.get("/tasks", response_model=list[TaskResponse])
async def list_tasks(
    db: AsyncSession = Depends(get_db),
):
    """List all import tasks, most recent first."""
    result = await db.execute(
        select(ImportTask).order_by(ImportTask.created_at.desc()).limit(50)
    )
    return result.scalars().all()
