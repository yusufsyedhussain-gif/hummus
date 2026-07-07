# Product Hub

A web application for importing product catalogs via CSV and managing them through a simple interface. Built to handle large files — up to 500,000 rows — with background processing so the browser stays responsive during the import.

## What it does

**CSV Import**

Drop a CSV file onto the import page and the application handles the rest. The file gets uploaded to the backend, validated, and processed in the background by a Celery worker. The dashboard shows a live progress bar that updates every second, breaking down how many rows were inserted, updated, or errored. When the import finishes you get a summary, and if something goes wrong you can see the failure reason and retry without re-uploading.

**Product Management**

Browse your product catalog with search, status filtering, and pagination. Each product shows its SKU, name, description, and active status. You can toggle a product active or inactive directly from the table. To edit fields or delete a product, use the Edit and Delete buttons on the row.

**Webhooks**

Configure webhook endpoints that get notified when products are created, updated, or deleted. You can test a webhook manually, enable or disable it, and view its delivery log.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.12) |
| Task queue | Celery 5 + Redis 7 |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 (async) |
| Frontend | Next.js 16 (TypeScript) |
| Containers | Docker + Docker Compose |

## Running it

The easiest way is Docker Compose. It starts all five services — PostgreSQL, Redis, the FastAPI backend, a Celery worker, and the Next.js frontend — with one command.

```bash
git clone <repo-url>
cd product-hub

docker compose up --build -d
```

Once everything is healthy:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

To stop:

```bash
docker compose down
```

## Local development

If you want to run the backend or frontend outside Docker, you need PostgreSQL and Redis running first. The quickest way is to start just those two services from Docker Compose:

```bash
docker compose up postgres redis -d
```

**Backend**

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: .\\venv\\Scripts\\activate
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000

# In a separate terminal
celery -A app.celery_app:celery_app worker --loglevel=info --queues=csv,webhooks,celery
```

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on http://localhost:3000 by default. If that port is occupied it falls back to 3001.

## CSV format

The importer expects a CSV with the following columns:

| Column | Required | Notes |
|---|---|---|
| `sku` | Yes | Unique identifier, max 100 characters |
| `name` | Yes | Product name, max 500 characters |
| `price` | Yes | Numeric, must be 0 or greater |
| `description` | No | Free text |
| `quantity` | No | Integer, defaults to 0 |
| `status` | No | `active` or `inactive`, defaults to `active` |

Example:

```csv
sku,name,price,description,quantity,status
PROD-001,Wireless Mouse,29.99,Ergonomic wireless mouse,150,active
PROD-002,USB Keyboard,49.99,Mechanical keyboard,75,active
PROD-003,Monitor Stand,34.99,Adjustable monitor stand,200,inactive
```

Duplicate SKUs are treated as updates rather than errors — the existing product gets overwritten with the new data.

## Architecture

```
Browser (Next.js)
    |
    | HTTP (REST + file upload)
    v
FastAPI backend ──── PostgreSQL (products, import tasks)
    |
    | task dispatch
    v
Redis (Celery broker)
    |
    v
Celery worker ──── PostgreSQL (writes import results)
```

Progress polling: the browser hits `GET /api/v1/tasks/{id}` every second while an import is running. There is no persistent WebSocket connection — plain HTTP polling keeps things simple and avoids issues with proxy buffering.

## Environment variables

The defaults in `docker-compose.yml` work out of the box for local use. If you are deploying elsewhere, the key variables are:

| Variable | Where | Description |
|---|---|---|
| `DATABASE_URL` | backend | Async PostgreSQL connection string |
| `DATABASE_SYNC_URL` | backend | Sync connection string (used by Alembic) |
| `REDIS_URL` | backend | Redis connection string |
| `CELERY_BROKER_URL` | backend | Celery broker (same Redis) |
| `CORS_ORIGINS` | backend | JSON array of allowed frontend origins |
| `NEXT_PUBLIC_API_URL` | frontend | Backend base URL as seen by the browser |

## License

MIT
