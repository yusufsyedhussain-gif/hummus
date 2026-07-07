"""Pydantic schemas for Product API request/response validation."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class ProductBase(BaseModel):
    """Shared product fields."""
    name: str = Field(..., min_length=1, max_length=500, description="Product name")
    description: str = Field(default="", max_length=5000, description="Product description")
    price: Decimal = Field(..., ge=0, decimal_places=2, description="Product price")
    quantity: int = Field(default=0, ge=0, description="Stock quantity")
    is_active: bool = Field(default=True, description="Whether the product is active")


class ProductCreate(ProductBase):
    """Schema for creating a new product."""
    sku: str = Field(..., min_length=1, max_length=100, description="Unique product SKU")

    @field_validator("sku")
    @classmethod
    def validate_sku(cls, v: str) -> str:
        return v.strip()

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return v.strip()


class ProductUpdate(BaseModel):
    """Schema for updating a product (all fields optional)."""
    sku: Optional[str] = Field(None, min_length=1, max_length=100)
    name: Optional[str] = Field(None, min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=5000)
    price: Optional[Decimal] = Field(None, ge=0)
    quantity: Optional[int] = Field(None, ge=0)
    is_active: Optional[bool] = None

    @field_validator("sku")
    @classmethod
    def validate_sku(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v else v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v else v


class ProductResponse(BaseModel):
    """Schema for product API responses."""
    id: UUID
    sku: str
    name: str
    description: str
    price: Decimal
    quantity: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PaginationMeta(BaseModel):
    """Pagination metadata."""
    page: int
    page_size: int
    total_items: int
    total_pages: int
    has_next: bool
    has_prev: bool


class ProductListResponse(BaseModel):
    """Paginated product list response."""
    items: list[ProductResponse]
    pagination: PaginationMeta
