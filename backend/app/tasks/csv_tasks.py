"""Celery task for asynchronous CSV import processing."""

import io
import json
import logging
from datetime import datetime, timezone

import redis
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.config import get_settings
import os
from app.services.csv_service import (
    count_csv_rows,
    stream_csv_batches,
    validate_row,
    bulk_upsert_products,
)

logger = logging.getLogger(__name__)
settings = get_settings()

# Sync engine for Celery workers (asyncpg doesn't work in sync context)
sync_engine = create_engine(settings.DATABASE_SYNC_URL)
SyncSession = sessionmaker(bind=sync_engine)

# Redis client for publishing progress
redis_client = redis.from_url(settings.CELERY_BROKER_URL)


def publish_progress(task_id: str, data: dict):
    """Publish progress update to Redis Pub/Sub channel."""
    channel = f"task:{task_id}:progress"
    redis_client.publish(channel, json.dumps(data, default=str))


@celery_app.task(
    bind=True,
    name="app.tasks.csv_tasks.process_csv_import",
    max_retries=2,
    default_retry_delay=30,
    acks_late=True,
)
def process_csv_import(self, task_id: str, filepath: str):
    """
    Process a CSV file: stream from disk, validate, and bulk upsert products.
    filepath is passed from the upload endpoint.
    Publishes real-time progress via Redis Pub/Sub.
    """
    logger.info(f"[task={task_id}] Celery task started, filepath={filepath}")
    db = SyncSession()

    try:
        logger.info(f"[task={task_id}] Opening DB session, testing connection...")
        # Quick connection test
        from sqlalchemy import text as sa_text
        db.execute(sa_text("SELECT 1"))
        logger.info(f"[task={task_id}] DB connection OK")
        _update_task_status(db, task_id, "parsing")
        publish_progress(task_id, {"status": "parsing", "percentage": 0})

        # Count total rows (streaming from disk)
        total_rows = count_csv_rows(filepath)
        db.execute(
            _task_update_sql(),
            {"id": task_id, "total_rows": total_rows, "status": "parsing",
             "started_at": datetime.now(timezone.utc)},
        )
        db.commit()

        if total_rows == 0:
            _finalize_task(db, task_id, "completed", 0, 0, 0, 0, [])
            publish_progress(task_id, {
                "status": "completed", "percentage": 100,
                "processed_rows": 0, "total_rows": 0,
                "inserted_count": 0, "updated_count": 0, "error_count": 0,
                "current_batch_errors": [],
            })
            return {"task_id": task_id, "status": "completed"}

        # Process in batches
        total_processed = 0
        total_inserted = 0
        total_updated = 0
        total_errors = 0
        all_errors = []
        batch_number = 0

        _update_task_status(db, task_id, "importing")

        for batch in stream_csv_batches(filepath, settings.CSV_BATCH_SIZE):
            batch_number += 1
            valid_rows = []
            batch_errors = []

            for i, row in enumerate(batch):
                row_number = total_processed + i + 1
                validated, error = validate_row(row, row_number)

                if validated:
                    valid_rows.append(validated)
                elif error:
                    batch_errors.append(error)
                    total_errors += 1

            # Bulk upsert valid rows
            if valid_rows:
                inserted, updated = bulk_upsert_products(db, valid_rows)
                total_inserted += inserted
                total_updated += updated

            total_processed += len(batch)

            # Cap stored errors to prevent DB bloat
            if len(all_errors) < 500:
                all_errors.extend(batch_errors[:500 - len(all_errors)])

            # Calculate percentage
            percentage = min((total_processed / total_rows) * 100, 100) if total_rows > 0 else 0

            # Publish progress
            progress_data = {
                "task_id": task_id,
                "status": "importing",
                "processed_rows": total_processed,
                "total_rows": total_rows,
                "inserted_count": total_inserted,
                "updated_count": total_updated,
                "error_count": total_errors,
                "percentage": round(percentage, 1),
                "current_batch_errors": batch_errors[:10],  # Limit per-batch errors in SSE
            }
            publish_progress(task_id, progress_data)

            # Update task record periodically (every 5 batches to reduce DB writes)
            if batch_number % 5 == 0:
                _update_task_progress(
                    db, task_id, total_processed, total_inserted,
                    total_updated, total_errors, all_errors,
                )

        # Finalize
        _finalize_task(
            db, task_id, "completed",
            total_processed, total_inserted, total_updated, total_errors, all_errors,
        )

        publish_progress(task_id, {
            "task_id": task_id,
            "status": "completed",
            "processed_rows": total_processed,
            "total_rows": total_rows,
            "inserted_count": total_inserted,
            "updated_count": total_updated,
            "error_count": total_errors,
            "percentage": 100,
            "current_batch_errors": [],
        })

        logger.info(
            f"CSV import complete: task={task_id}, "
            f"inserted={total_inserted}, updated={total_updated}, errors={total_errors}"
        )

        # Cleanup file
        if os.path.exists(filepath):
            os.remove(filepath)

        return {
            "task_id": task_id,
            "status": "completed",
            "inserted": total_inserted,
            "updated": total_updated,
            "errors": total_errors,
        }

    except Exception as exc:
        logger.exception(f"CSV import failed: task={task_id}")
        _update_task_status(db, task_id, "failed")
        publish_progress(task_id, {
            "task_id": task_id,
            "status": "failed",
            "error": str(exc),
            "processed_rows": total_processed if "total_processed" in dir() else 0,
            "total_rows": total_rows if "total_rows" in dir() else 0,
            "inserted_count": 0,
            "updated_count": 0,
            "error_count": 0,
            "percentage": 0,
            "current_batch_errors": [],
        })
        raise self.retry(exc=exc)

    finally:
        db.close()


# ── Helper functions ─────────────────────────────────────────────

def _task_update_sql():
    from sqlalchemy import text
    return text("""
        UPDATE import_tasks
        SET total_rows = :total_rows, status = :status, started_at = :started_at
        WHERE id = CAST(:id AS uuid)
    """)


def _update_task_status(db, task_id: str, status: str):
    from sqlalchemy import text
    db.execute(
        text("UPDATE import_tasks SET status = :status WHERE id = CAST(:id AS uuid)"),
        {"id": task_id, "status": status},
    )
    db.commit()


def _update_task_progress(db, task_id, processed, inserted, updated, errors, error_list):
    from sqlalchemy import text
    db.execute(
        text("""
            UPDATE import_tasks
            SET processed_rows = :processed, inserted_count = :inserted,
                updated_count = :updated, error_count = :errors,
                errors = CAST(:error_list AS jsonb)
            WHERE id = CAST(:id AS uuid)
        """),
        {
            "id": task_id,
            "processed": processed,
            "inserted": inserted,
            "updated": updated,
            "errors": errors,
            "error_list": json.dumps(error_list, default=str),
        },
    )
    db.commit()


def _finalize_task(db, task_id, status, processed, inserted, updated, errors, error_list):
    from sqlalchemy import text
    db.execute(
        text("""
            UPDATE import_tasks
            SET status = :status, processed_rows = :processed,
                inserted_count = :inserted, updated_count = :updated,
                error_count = :errors, errors = CAST(:error_list AS jsonb),
                completed_at = NOW()
            WHERE id = CAST(:id AS uuid)
        """),
        {
            "id": task_id,
            "status": status,
            "processed": processed,
            "inserted": inserted,
            "updated": updated,
            "errors": errors,
            "error_list": json.dumps(error_list, default=str),
        },
    )
    db.commit()
