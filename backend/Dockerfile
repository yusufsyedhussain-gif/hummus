# ── Build Stage ────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime Stage ─────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Copy installed packages
COPY --from=builder /install /usr/local

# Copy application code
COPY . .

# Make startup script executable
RUN chmod +x start.sh

# Create upload directory
RUN mkdir -p /tmp/product-hub/uploads

EXPOSE 8000

# Default: run both FastAPI + Celery via start.sh (used on Render).
# The docker-compose.yml overrides this command per-service for local dev.
CMD ["sh", "start.sh"]
