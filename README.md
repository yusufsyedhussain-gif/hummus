# 📦 Product Hub

High-performance web application for bulk CSV product import (up to 500,000 entries), product CRUD management, and webhook configuration.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.12) |
| Task Queue | Celery 5 + Redis |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 (async) |
| Frontend | Next.js 14 (TypeScript) |
| Containerization | Docker + Docker Compose |

## Features

- **CSV Import**: Drag-and-drop upload with real-time SSE progress tracking
- **Product Management**: Full CRUD with search, filtering, pagination, and inline editing
- **Webhook System**: Configure webhooks, test delivery, view logs
- **Bulk Operations**: Import 500K products, clear all with confirmation
- **Async Processing**: Celery workers for background CSV processing and webhook delivery

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local frontend development)
- Python 3.11+ (for local backend development)

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repo-url>
cd product-hub

# Start all services
docker compose up --build

# Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### Local Development

#### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or .\venv\Scripts\activate on Windows

# Install dependencies
pip install -r requirements.txt

# Start PostgreSQL and Redis (via Docker)
docker compose up postgres redis -d

# Run the API server
uvicorn app.main:app --reload --port 8000

# In another terminal, start Celery worker
celery -A app.celery_app:celery_app worker --loglevel=info --queues=csv,webhooks,celery
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

## CSV File Format

The CSV file should have the following columns:

| Column | Required | Description |
|---|---|---|
| `sku` | ✅ | Unique product identifier (max 100 chars) |
| `name` | ✅ | Product name (max 500 chars) |
| `price` | ✅ | Product price (numeric, >= 0) |
| `description` | ❌ | Product description |
| `quantity` | ❌ | Stock quantity (integer, >= 0, default: 0) |
| `status` | ❌ | "active" or "inactive" (default: "active") |

### Example

```csv
sku,name,price,description,quantity,status
PROD-001,Wireless Mouse,29.99,Ergonomic wireless mouse,150,active
PROD-002,USB Keyboard,49.99,Mechanical keyboard,75,active
PROD-003,Monitor Stand,34.99,Adjustable monitor stand,200,inactive
```

## API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Architecture

```
Browser (Next.js) → FastAPI REST API → PostgreSQL
                        ↓
                    Redis (Broker)
                        ↓
                  Celery Workers → PostgreSQL
                        ↓
                  Redis (Pub/Sub) → SSE → Browser
```

## License

MIT
