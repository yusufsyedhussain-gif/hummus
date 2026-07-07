"""Product CRUD API endpoints with filtering, pagination, and bulk operations."""

import math
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.product import Product
from app.schemas.product import (
    ProductCreate,
    ProductUpdate,
    ProductResponse,
    ProductListResponse,
    PaginationMeta,
)
from app.tasks.webhook_tasks import dispatch_event

router = APIRouter(prefix="/products", tags=["Products"])


@router.get("", response_model=ProductListResponse)
async def list_products(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(25, ge=1, le=100, description="Items per page"),
    search: str = Query(None, description="Search across SKU, name, description"),
    sku: str = Query(None, description="Filter by exact SKU (case-insensitive)"),
    status: str = Query(None, description="Filter by status: active or inactive"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort direction: asc or desc"),
    db: AsyncSession = Depends(get_db),
):
    """List products with filtering, search, and pagination."""
    query = select(Product)
    count_query = select(func.count(Product.id))

    # Apply filters
    if search:
        search_term = f"%{search}%"
        search_filter = or_(
            Product.sku_lower.ilike(search_term),
            Product.name.ilike(search_term),
            Product.description.ilike(search_term),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    if sku:
        sku_filter = Product.sku_lower == sku.strip().lower()
        query = query.where(sku_filter)
        count_query = count_query.where(sku_filter)

    if status:
        if status.lower() == "active":
            query = query.where(Product.is_active == True)
            count_query = count_query.where(Product.is_active == True)
        elif status.lower() == "inactive":
            query = query.where(Product.is_active == False)
            count_query = count_query.where(Product.is_active == False)

    # Sorting
    valid_sort_fields = {
        "name": Product.name,
        "sku": Product.sku_lower,
        "price": Product.price,
        "quantity": Product.quantity,
        "created_at": Product.created_at,
        "updated_at": Product.updated_at,
    }
    sort_column = valid_sort_fields.get(sort_by, Product.created_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # Get total count
    total_result = await db.execute(count_query)
    total_items = total_result.scalar()

    # Pagination
    total_pages = math.ceil(total_items / page_size) if total_items > 0 else 1
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    products = result.scalars().all()

    return ProductListResponse(
        items=[ProductResponse.model_validate(p) for p in products],
        pagination=PaginationMeta(
            page=page,
            page_size=page_size,
            total_items=total_items,
            total_pages=total_pages,
            has_next=page < total_pages,
            has_prev=page > 1,
        ),
    )


@router.post("", response_model=ProductResponse, status_code=201)
async def create_product(
    product: ProductCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new product. SKU must be unique (case-insensitive)."""
    # Check for duplicate SKU
    existing = await db.execute(
        select(Product).where(Product.sku_lower == product.sku.strip().lower())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Product with SKU '{product.sku}' already exists",
        )

    db_product = Product(
        sku=product.sku,
        sku_lower=product.sku.strip().lower(),
        name=product.name,
        description=product.description,
        price=product.price,
        quantity=product.quantity,
        is_active=product.is_active,
    )
    db.add(db_product)
    await db.flush()
    await db.refresh(db_product)

    # Dispatch webhook event
    dispatch_event.delay("product.created", {
        "event": "product.created",
        "product": ProductResponse.model_validate(db_product).model_dump(mode="json"),
    })

    return db_product


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single product by ID."""
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: UUID,
    product_update: ProductUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a product by ID."""
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    update_data = product_update.model_dump(exclude_unset=True)

    # If SKU is being changed, check for conflicts
    if "sku" in update_data:
        new_sku_lower = update_data["sku"].strip().lower()
        existing = await db.execute(
            select(Product).where(
                Product.sku_lower == new_sku_lower,
                Product.id != product_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"Product with SKU '{update_data['sku']}' already exists",
            )
        update_data["sku_lower"] = new_sku_lower

    for field, value in update_data.items():
        setattr(product, field, value)

    await db.flush()
    await db.refresh(product)

    dispatch_event.delay("product.updated", {
        "event": "product.updated",
        "product": ProductResponse.model_validate(product).model_dump(mode="json"),
    })

    return product


@router.patch("/{product_id}", response_model=ProductResponse)
async def patch_product(
    product_id: UUID,
    product_update: ProductUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Partially update a product (same logic as PUT but semantically for partial updates)."""
    return await update_product(product_id, product_update, db)


@router.delete("/{product_id}", status_code=204)
async def delete_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single product by ID."""
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    product_data = ProductResponse.model_validate(product).model_dump(mode="json")
    await db.delete(product)

    dispatch_event.delay("product.deleted", {
        "event": "product.deleted",
        "product": product_data,
    })


@router.delete("", status_code=200)
async def clear_all_products(
    confirm: bool = Query(False, description="Must be true to confirm deletion"),
    db: AsyncSession = Depends(get_db),
):
    """Delete ALL products. Requires confirm=true query parameter."""
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Set ?confirm=true to confirm deletion of all products",
        )

    count_result = await db.execute(select(func.count(Product.id)))
    total = count_result.scalar()

    await db.execute(delete(Product))

    dispatch_event.delay("products.cleared", {
        "event": "products.cleared",
        "deleted_count": total,
    })

    return {"message": f"Successfully deleted {total} products", "deleted_count": total}
