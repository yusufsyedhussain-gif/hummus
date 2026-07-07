#!/bin/sh
# start.sh — runs FastAPI and Celery worker in a single container.
# Used for the Render free-tier deployment where only one process is allowed.

set -e

# Create upload directory if it doesn't exist
mkdir -p /tmp/product-hub/uploads

echo "Starting Celery worker in background..."
celery -A app.celery_app:celery_app worker \
  --loglevel=info \
  --queues=csv,webhooks,celery \
  --concurrency=2 &

echo "Starting FastAPI server..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers 1
