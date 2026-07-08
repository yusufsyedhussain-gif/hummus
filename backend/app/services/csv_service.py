"""CSV processing service — streaming parse, validate, and bulk upsert."""

import csv
import io
import os
import logging
import re
import hashlib
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Generator

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def count_csv_rows(filepath: str) -> int:
    """Count total data rows in CSV (excludes header if detected). Streams to avoid memory issues."""
    count = 0
    with open(filepath, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        try:
            first_row = next(reader)
        except StopIteration:
            return 0
        
        # Check if first row is headers
        _, has_header = detect_headers(first_row)
        if has_header:
            # First row is header, count other rows
            for _ in reader:
                count += 1
        else:
            # First row is data, count first row + all others
            count = 1
            for _ in reader:
                count += 1
    return count


def count_csv_rows_from_text(csv_text: str) -> int:
    """Count total data rows in CSV string (excludes header if detected)."""
    count = 0
    reader = csv.reader(io.StringIO(csv_text))
    try:
        first_row = next(reader)
    except StopIteration:
        return 0
    _, has_header = detect_headers(first_row)
    if has_header:
        for _ in reader:
            count += 1
    else:
        count = 1
        for _ in reader:
            count += 1
    return count


def stream_csv_batches_from_text(csv_text: str, batch_size: int) -> Generator[list[dict], None, None]:
    """Stream CSV string in batches. Yields lists of raw row dicts mapped to headers."""
    batch = []
    reader = csv.reader(io.StringIO(csv_text))
    try:
        first_row = next(reader)
    except StopIteration:
        return

    headers, has_header = detect_headers(first_row)

    if not has_header:
        row_dict = {headers[i]: val for i, val in enumerate(first_row) if i < len(headers)}
        batch.append(row_dict)

    for row in reader:
        row_dict = {}
        for i, val in enumerate(row):
            header_name = headers[i] if i < len(headers) else f"col_{i}"
            row_dict[header_name] = val
        batch.append(row_dict)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch



def detect_headers(first_row: list[str]) -> tuple[list[str], bool]:
    """Check if first_row looks like a header, otherwise generate default col_N headers."""
    header_keywords = {"sku", "name", "price", "title", "id", "qty", "quantity", "description", "status", "cost"}
    normalized = [str(cell).strip().lower() for cell in first_row]
    
    # If any cell matches a keyword, we assume it's a header row
    has_header = any(any(kw in cell for kw in header_keywords) for cell in normalized if cell)
    
    if has_header:
        headers = [c if c else f"col_{i}" for i, c in enumerate(normalized)]
        return headers, True
    else:
        headers = [f"col_{i}" for i in range(len(first_row))]
        return headers, False


def validate_row(row: dict, row_number: int) -> tuple[dict | None, dict | None]:
    """
    Highly flexible mapping function that never fails.
    Automatically generates missing values to adapt to raw unfiltered CSVs.
    """
    # Helper to clean and join all values for description or hashing
    all_values = [str(v).strip() for v in row.values() if v is not None]
    row_text = " ".join(all_values)

    # 1. SKU Extraction
    sku = ""
    sku_keys = ["sku", "id", "product_id", "productid", "item_no", "itemno", "code", "part", "number", "key"]
    for key in row.keys():
        if any(sk in key.lower() for sk in sku_keys):
            sku = str(row[key]).strip()
            if sku:
                break
    
    # Fallback to first non-empty value in the row
    if not sku:
        for val in row.values():
            if val and str(val).strip():
                sku = str(val).strip()
                break

    # If still empty or too long, use a deterministic hash of row text to prevent duplicates
    if not sku or len(sku) > 100:
        hash_val = hashlib.md5(row_text.encode('utf-8', errors='ignore')).hexdigest()
        sku = f"GEN-{hash_val[:12].upper()}"

    # 2. Name Extraction
    name = ""
    name_keys = ["name", "title", "label", "item", "product", "head"]
    for key in row.keys():
        if any(nk in key.lower() for nk in name_keys):
            name = str(row[key]).strip()
            if name:
                break
    
    if not name:
        # Extract first 5 words or use generic name
        words = [w for w in re.split(r'\s+', row_text) if w]
        if words:
            name = " ".join(words[:5])
        else:
            name = f"Product {row_number}"

    if len(name) > 500:
        name = name[:497] + "..."

    # 3. Price Extraction
    price = 0.0
    price_keys = ["price", "cost", "rate", "amount", "value", "val"]
    price_found = False
    for key in row.keys():
        if any(pk in key.lower() for pk in price_keys):
            val_str = str(row[key]).strip()
            match = re.search(r'\d+(\.\d+)?', val_str)
            if match:
                try:
                    price = float(match.group())
                    price_found = True
                    break
                except ValueError:
                    pass

    # Fallback: search the entire row for any numeric value
    if not price_found:
        for val in row.values():
            match = re.search(r'\d+\.\d{2}', str(val))
            if not match:
                match = re.search(r'\d+(\.\d+)?', str(val))
            if match:
                try:
                    price = float(match.group())
                    break
                except ValueError:
                    pass

    # 4. Quantity Extraction
    quantity = 0
    qty_keys = ["qty", "quantity", "count", "stock", "inventory", "num"]
    qty_found = False
    for key in row.keys():
        if any(qk in key.lower() for qk in qty_keys):
            val_str = str(row[key]).strip()
            match = re.search(r'\d+', val_str)
            if match:
                try:
                    quantity = int(match.group())
                    qty_found = True
                    break
                except ValueError:
                    pass
    if not qty_found:
        for val in row.values():
            match = re.search(r'\b\d+\b', str(val))
            if match:
                try:
                    quantity = int(match.group())
                    break
                except ValueError:
                    pass

    # 5. Description - store all raw unfiltered info
    desc_parts = []
    for k, v in row.items():
        val_str = str(v).strip()
        if val_str:
            desc_parts.append(f"{k}: {val_str}")
    description = " | ".join(desc_parts)

    # 6. Status
    is_active = True
    status_keys = ["status", "active", "enabled"]
    for key in row.keys():
        if any(sk in key.lower() for sk in status_keys):
            val_str = str(row[key]).strip().lower()
            if val_str in ("inactive", "0", "false", "no"):
                is_active = False
                break

    return {
        "sku": sku,
        "sku_lower": sku.lower(),
        "name": name,
        "description": description,
        "price": price,
        "quantity": quantity,
        "is_active": is_active,
    }, None


def stream_csv_batches(filepath: str, batch_size: int) -> Generator[list[dict], None, None]:
    """
    Stream CSV file in batches. Yields lists of raw row dicts mapped to headers.
    Memory-efficient: only one batch is in memory at a time.
    """
    batch = []
    with open(filepath, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        try:
            first_row = next(reader)
        except StopIteration:
            return

        headers, has_header = detect_headers(first_row)
        
        # If the first row was data, process it first
        if not has_header:
            row_dict = {headers[i]: val for i, val in enumerate(first_row) if i < len(headers)}
            batch.append(row_dict)

        for row in reader:
            # Map row to headers
            row_dict = {}
            for i, val in enumerate(row):
                header_name = headers[i] if i < len(headers) else f"col_{i}"
                row_dict[header_name] = val
            batch.append(row_dict)
            if len(batch) >= batch_size:
                yield batch
                batch = []
        if batch:
            yield batch


def bulk_upsert_products(db: Session, valid_rows: list[dict]) -> tuple[int, int]:
    """
    Perform bulk upsert using INSERT ... ON CONFLICT.
    Returns (inserted_count, updated_count).
    """
    if not valid_rows:
        return 0, 0

    # Deduplicate within the batch (keep the last one)
    deduped = {}
    for r in valid_rows:
        deduped[r["sku_lower"]] = r
    unique_rows = list(deduped.values())

    # Get a list of all skus to check which ones exist in the DB
    skus = [r["sku_lower"] for r in unique_rows]

    # Query existing SKUs in DB
    existing_result = db.execute(
        text("SELECT sku_lower FROM products WHERE sku_lower = ANY(:skus)"),
        {"skus": skus}
    )
    existing_skus = {row[0] for row in existing_result.fetchall()}

    updated_count = sum(1 for r in unique_rows if r["sku_lower"] in existing_skus)
    inserted_count = len(unique_rows) - updated_count

    # Execute bulk upsert without RETURNING
    upsert_sql = text("""
        INSERT INTO products (id, sku, sku_lower, name, description, price, quantity, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), :sku, :sku_lower, :name, :description, :price, :quantity, :is_active, NOW(), NOW())
        ON CONFLICT (sku_lower)
        DO UPDATE SET
            sku = EXCLUDED.sku,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            price = EXCLUDED.price,
            quantity = EXCLUDED.quantity,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
    """)

    db.execute(upsert_sql, unique_rows)
    db.commit()

    return inserted_count, updated_count


def cleanup_temp_file(filepath: str):
    """Remove temporary CSV file after processing."""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
            logger.info(f"Cleaned up temp file: {filepath}")
    except OSError as e:
        logger.warning(f"Failed to clean up temp file {filepath}: {e}")
