#!/bin/bash
set -e

echo "Starting Celery worker in background..."
# --pool=solo: single-threaded, no forking — saves ~80MB vs prefork
# --concurrency=1: only one task at a time
celery -A app.celery_app:celery_app worker \
    --loglevel=info \
    --queues=csv,webhooks,celery \
    --concurrency=1 \
    --pool=solo &

echo "Starting FastAPI server..."
# --workers 1: single uvicorn process — the app is I/O-bound (async), not CPU-bound
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers 1
