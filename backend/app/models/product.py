"""Product database model."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean, Column, DateTime, Integer, Numeric, String, Text, Index
)
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Product(Base):
    """Product model with case-insensitive SKU uniqueness."""

    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku = Column(String(100), nullable=False)
    sku_lower = Column(String(100), nullable=False, unique=True, index=True)
    name = Column(String(500), nullable=False)
    description = Column(Text, default="")
    price = Column(Numeric(12, 2), nullable=False)
    quantity = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("idx_products_is_active", "is_active"),
        Index("idx_products_created_at", "created_at"),
        Index("idx_products_name", "name"),
    )

    def __repr__(self):
        return f"<Product(sku={self.sku}, name={self.name})>"
