"""Application configuration using pydantic-settings."""

from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
import json


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Application
    APP_NAME: str = "Product Hub"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://producthub:producthub@localhost:5432/producthub"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10

    # Sync database URL for Celery workers (asyncpg doesn't work in sync context)
    DATABASE_SYNC_URL: str = "postgresql+psycopg2://producthub:producthub@localhost:5432/producthub"

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def fix_db_url(cls, v: str) -> str:
        if isinstance(v, str):
            if v.startswith("postgres://"):
                v = v.replace("postgres://", "postgresql://", 1)
            if v.startswith("postgresql://"):
                v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
            
            # For Supabase / PgBouncer, completely disable prepared statements in URL
            if "pooler.supabase.com" in v or ":6543" in v:
                separator = "&" if "?" in v else "?"
                if "prepared_statement_cache_size" not in v:
                    v += f"{separator}prepared_statement_cache_size=0"
                    
            # Strip pgbouncer=true since SQLAlchemy dialects don't support it as a kwarg
            v = v.replace("?pgbouncer=true&", "?").replace("&pgbouncer=true", "").replace("?pgbouncer=true", "")
        return v

    @field_validator("DATABASE_SYNC_URL", mode="before")
    @classmethod
    def fix_sync_db_url(cls, v: str, info) -> str:
        # If the sync URL wasn't provided but async URL was, derive it
        db_url = info.data.get("DATABASE_URL")
        if db_url and (not v or "localhost:5432" in v):
            sync_url = db_url.replace("+asyncpg", "+psycopg2")
            # Strip asyncpg-specific params that psycopg2/PostgreSQL don't understand
            sync_url = sync_url.replace("?pgbouncer=true&", "?").replace("&pgbouncer=true", "").replace("?pgbouncer=true", "")
            sync_url = sync_url.replace("?prepared_statement_cache_size=0&", "?").replace("&prepared_statement_cache_size=0", "").replace("?prepared_statement_cache_size=0", "")
            return sync_url
            
        if isinstance(v, str):
            if v.startswith("postgres://"):
                v = v.replace("postgres://", "postgresql://", 1)
            if v.startswith("postgresql://"):
                v = v.replace("postgresql://", "postgresql+psycopg2://", 1)
                
            # Strip pgbouncer=true or asyncpg specific params for sync URL
            v = v.replace("?pgbouncer=true&", "?").replace("&pgbouncer=true", "").replace("?pgbouncer=true", "")
            v = v.replace("?prepared_statement_cache_size=0&", "?").replace("&prepared_statement_cache_size=0", "").replace("?prepared_statement_cache_size=0", "")
        return v

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"
    
    @field_validator("REDIS_URL", "CELERY_BROKER_URL", "CELERY_RESULT_BACKEND", mode="before")
    @classmethod
    def clean_redis_url(cls, v: str) -> str:
        if isinstance(v, str):
            # Strip ssl_cert_reqs to prevent it from confusing redis-py
            # (We pass it explicitly via kwargs in the code where needed)
            import re
            v = re.sub(r'[?&]ssl_cert_reqs=[^&]+', '', v)
            if v.endswith('?'):
                v = v[:-1]
        return v

    # CSV Upload
    MAX_UPLOAD_SIZE_MB: int = 100
    CSV_BATCH_SIZE: int = 10000
    UPLOAD_DIR: str = "/tmp/product-hub/uploads"

    # Webhook
    WEBHOOK_TIMEOUT_SECONDS: int = 10
    WEBHOOK_MAX_RETRIES: int = 3

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
