/**
 * Products Management Page — CRUD, filtering, pagination, inline editing.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { productsApi, Product, ProductFilters, PaginationMeta } from '@/services/api';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/ToastContainer';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';

export default function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { toasts, removeToast, success, error: showError } = useToast();

  // Products data
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  // Modals
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Inline edit state
  const [inlineEdit, setInlineEdit] = useState<{ id: string; field: string; value: string } | null>(null);

  // Form state for create/edit
  const [form, setForm] = useState({
    sku: '',
    name: '',
    description: '',
    price: '',
    quantity: '',
    is_active: true,
  });

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const filters: ProductFilters = {
        page,
        page_size: 25,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
      if (search) filters.search = search;
      if (statusFilter) filters.status = statusFilter;

      const data = await productsApi.list(filters);
      setProducts(data.items);
      setPagination(data.pagination);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load products';
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, sortBy, sortOrder, showError]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Create product
  const handleCreate = async () => {
    setModalLoading(true);
    try {
      await productsApi.create({
        sku: form.sku,
        name: form.name,
        description: form.description,
        price: parseFloat(form.price) || 0,
        quantity: parseInt(form.quantity) || 0,
        is_active: form.is_active,
      });
      success('Product created');
      setShowCreateModal(false);
      resetForm();
      loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create product';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Update product
  const handleUpdate = async () => {
    if (!editProduct) return;
    setModalLoading(true);
    try {
      await productsApi.update(editProduct.id, {
        sku: form.sku,
        name: form.name,
        description: form.description,
        price: parseFloat(form.price) || 0,
        quantity: parseInt(form.quantity) || 0,
        is_active: form.is_active,
      });
      success('Product updated');
      setEditProduct(null);
      resetForm();
      loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update product';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Delete product
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setModalLoading(true);
    try {
      await productsApi.delete(deleteTarget.id);
      success(`Product "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete product';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Clear all products
  const handleClearAll = async () => {
    setModalLoading(true);
    try {
      const result = await productsApi.clearAll();
      success(result.message);
      setShowClearAll(false);
      loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to clear products';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Toggle active status
  const handleToggleActive = async (product: Product) => {
    try {
      await productsApi.patch(product.id, { is_active: !product.is_active });
      success(`Product ${!product.is_active ? 'activated' : 'deactivated'}`);
      loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      showError(message);
    }
  };

  // Inline edit
  const handleInlineEditSave = async () => {
    if (!inlineEdit) return;
    try {
      const updateData: Partial<Product> = {};
      if (inlineEdit.field === 'price') {
        (updateData as Record<string, unknown>)[inlineEdit.field] = parseFloat(inlineEdit.value) || 0;
      } else if (inlineEdit.field === 'quantity') {
        (updateData as Record<string, unknown>)[inlineEdit.field] = parseInt(inlineEdit.value) || 0;
      } else {
        (updateData as Record<string, unknown>)[inlineEdit.field] = inlineEdit.value;
      }
      await productsApi.patch(inlineEdit.id, updateData);
      success('Updated');
      setInlineEdit(null);
      loadProducts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Update failed';
      showError(message);
    }
  };

  // Form helpers
  const resetForm = () => {
    setForm({ sku: '', name: '', description: '', price: '', quantity: '', is_active: true });
  };

  const openEditModal = (product: Product) => {
    setForm({
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: String(product.price),
      quantity: String(product.quantity),
      is_active: product.is_active,
    });
    setEditProduct(product);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  // Pagination helpers
  const getPageNumbers = () => {
    if (!pagination) return [];
    const pages: number[] = [];
    const total = pagination.total_pages;
    const current = pagination.page;
    const delta = 2;
    for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
      pages.push(i);
    }
    return pages;
  };

  // Form component used in both create and edit modals
  const renderForm = () => (
    <>
      <div className="input-group">
        <label>SKU *</label>
        <input
          className="input"
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          placeholder="e.g. PROD-001"
          id="form-sku"
        />
      </div>
      <div className="input-group">
        <label>Name *</label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Product name"
          id="form-name"
        />
      </div>
      <div className="input-group">
        <label>Description</label>
        <textarea
          className="textarea"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Product description"
          id="form-description"
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
        <div className="input-group">
          <label>Price *</label>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="0.00"
            id="form-price"
          />
        </div>
        <div className="input-group">
          <label>Quantity</label>
          <input
            className="input"
            type="number"
            min="0"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            placeholder="0"
            id="form-quantity"
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            id="form-active-toggle"
          />
          <span className="toggle-slider" />
        </label>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          {form.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>
    </>
  );

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-logo">
          <h1>Product Hub</h1>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-link ${pathname === '/' ? 'active' : ''}`} onClick={() => router.push('/')} id="nav-dashboard">
            CSV Import
          </button>
          <button className={`nav-link ${pathname === '/products' ? 'active' : ''}`} onClick={() => router.push('/products')} id="nav-products">
            Products
          </button>
          <button className={`nav-link ${pathname === '/webhooks' ? 'active' : ''}`} onClick={() => router.push('/webhooks')} id="nav-webhooks">
            Webhooks
          </button>
        </nav>
      </aside>

      <main className="main-content">
        {/* Header */}
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Products</h2>
            <p>Manage your product catalog • {pagination?.total_items?.toLocaleString() || 0} total</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button className="btn btn-danger btn-sm" onClick={() => setShowClearAll(true)} id="clear-all-btn">
              Clear All
            </button>
            <button className="btn btn-primary" onClick={openCreateModal} id="add-product-btn">
              Add Product
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="filter-bar" id="filter-bar">
          <div className="search-input-wrapper">
            <input
              className="input"
              style={{ paddingLeft: '12px' }}
              placeholder="Search by SKU, name, or description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              id="search-input"
            />
          </div>
          <select
            className="select"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            id="status-filter"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            className="select"
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split(':');
              setSortBy(field);
              setSortOrder(order);
              setPage(1);
            }}
            id="sort-select"
          >
            <option value="created_at:desc">Newest First</option>
            <option value="created_at:asc">Oldest First</option>
            <option value="name:asc">Name A-Z</option>
            <option value="name:desc">Name Z-A</option>
            <option value="price:asc">Price Low-High</option>
            <option value="price:desc">Price High-Low</option>
            <option value="sku:asc">SKU A-Z</option>
          </select>
        </div>

        {/* Product Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <h3>No products found</h3>
            <p>{search || statusFilter ? 'Try adjusting your filters' : 'Upload a CSV or add products manually'}</p>
            <button className="btn btn-primary" onClick={openCreateModal}>Add Product</button>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="table" id="products-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id} className="animate-in">
                      {/* SKU - read only */}
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                          {product.sku}
                        </span>
                      </td>

                      {/* Name - read only */}
                      <td>
                        <span>
                          {product.name}
                        </span>
                      </td>

                      {/* Description - strip any embedded name/sku prefix from backend data */}
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '260px' }}>
                        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {(() => {
                            const raw = product.description || '';
                            // Strip patterns like "name: X | sku: Y | description: Z"
                            const match = raw.match(/description:\s*(.+)$/i);
                            const clean = match ? match[1].trim() : raw;
                            return clean || <em style={{ color: 'var(--text-muted)' }}>—</em>;
                          })()}
                        </span>
                      </td>

                      {/* Status Toggle */}
                      <td>
                        <label className="toggle" title={product.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}>
                          <input
                            type="checkbox"
                            checked={product.is_active}
                            onChange={() => handleToggleActive(product)}
                          />
                          <span className="toggle-slider" />
                        </label>
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="action-cell">
                          <button
                            className="action-btn-text"
                            onClick={() => openEditModal(product)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '0 4px', fontSize: '0.85rem', fontWeight: 600 }}
                          >
                            Edit
                          </button>
                          <button
                            className="action-btn-text danger"
                            onClick={() => setDeleteTarget(product)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '0 4px', fontSize: '0.85rem', fontWeight: 600 }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && pagination.total_pages > 1 && (
              <div className="pagination" id="pagination">
                <div className="pagination-info">
                  Showing {(pagination.page - 1) * pagination.page_size + 1}–
                  {Math.min(pagination.page * pagination.page_size, pagination.total_items)} of{' '}
                  {pagination.total_items.toLocaleString()}
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    disabled={!pagination.has_prev}
                    onClick={() => setPage(page - 1)}
                  >
                    ← Prev
                  </button>
                  {getPageNumbers().map((p) => (
                    <button
                      key={p}
                      className={`pagination-btn ${p === page ? 'active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    className="pagination-btn"
                    disabled={!pagination.has_next}
                    onClick={() => setPage(page + 1)}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        title="Add New Product"
        onClose={() => setShowCreateModal(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowCreateModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={modalLoading} id="save-product-btn">
              {modalLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
              Create Product
            </button>
          </>
        }
      >
        {renderForm()}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editProduct}
        title="Edit Product"
        onClose={() => setEditProduct(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditProduct(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleUpdate} disabled={modalLoading} id="update-product-btn">
              {modalLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
              Save Changes
            </button>
          </>
        }
      >
        {renderForm()}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Product"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={modalLoading}
      />

      {/* Clear All Confirmation */}
      <ConfirmDialog
        isOpen={showClearAll}
        title="Clear All Products"
        message={`This will permanently delete ALL ${pagination?.total_items?.toLocaleString() || 0} products from the database. This action is irreversible!`}
        confirmText="Delete All Products"
        cancelText="Keep Products"
        variant="danger"
        onConfirm={handleClearAll}
        onCancel={() => setShowClearAll(false)}
        loading={modalLoading}
      />

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
