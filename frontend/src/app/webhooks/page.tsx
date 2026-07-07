/**
 * Webhooks Management Page — CRUD, test, delivery logs.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { webhooksApi, Webhook, WebhookTestResult, WebhookLog } from '@/services/api';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/ToastContainer';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';

const EVENT_TYPES = [
  'product.created',
  'product.updated',
  'product.deleted',
  'product.imported',
  'products.cleared',
];

export default function WebhooksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { toasts, removeToast, success, error: showError, info } = useToast();

  // Data
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<Record<string, WebhookLog[]>>({});
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editWebhook, setEditWebhook] = useState<Webhook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Testing
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, WebhookTestResult>>({});

  // Form
  const [form, setForm] = useState({
    url: '',
    events: [] as string[],
    is_enabled: true,
    secret: '',
  });

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await webhooksApi.list();
      setWebhooks(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load webhooks';
      showError(message);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  // Load logs for a webhook
  const loadLogs = async (webhookId: string) => {
    if (expandedLogs === webhookId) {
      setExpandedLogs(null);
      return;
    }
    try {
      const data = await webhooksApi.getLogs(webhookId);
      setLogs((prev) => ({ ...prev, [webhookId]: data }));
      setExpandedLogs(webhookId);
    } catch {
      showError('Failed to load delivery logs');
    }
  };

  // Create webhook
  const handleCreate = async () => {
    if (!form.url || form.events.length === 0) {
      showError('URL and at least one event type are required');
      return;
    }
    setModalLoading(true);
    try {
      await webhooksApi.create({
        url: form.url,
        events: form.events,
        is_enabled: form.is_enabled,
        secret: form.secret || undefined,
      });
      success('Webhook created');
      setShowCreateModal(false);
      resetForm();
      loadWebhooks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create webhook';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Update webhook
  const handleUpdate = async () => {
    if (!editWebhook) return;
    setModalLoading(true);
    try {
      await webhooksApi.update(editWebhook.id, {
        url: form.url,
        events: form.events,
        is_enabled: form.is_enabled,
      });
      success('Webhook updated');
      setEditWebhook(null);
      resetForm();
      loadWebhooks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update webhook';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Delete webhook
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setModalLoading(true);
    try {
      await webhooksApi.delete(deleteTarget.id);
      success('Webhook deleted');
      setDeleteTarget(null);
      loadWebhooks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete webhook';
      showError(message);
    } finally {
      setModalLoading(false);
    }
  };

  // Test webhook
  const handleTest = async (webhook: Webhook) => {
    setTestingId(webhook.id);
    info(`Testing webhook: ${webhook.url}`);
    try {
      const result = await webhooksApi.test(webhook.id);
      setTestResults((prev) => ({ ...prev, [webhook.id]: result }));
      if (result.success) {
        success(`✓ ${result.status_code} — ${result.response_time_ms?.toFixed(0)}ms`);
      } else {
        showError(`✕ ${result.status_code || 'No response'} — ${result.error || 'Failed'}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Test failed';
      showError(message);
    } finally {
      setTestingId(null);
    }
  };

  // Toggle enabled
  const handleToggleEnabled = async (webhook: Webhook) => {
    try {
      await webhooksApi.update(webhook.id, { is_enabled: !webhook.is_enabled });
      success(`Webhook ${!webhook.is_enabled ? 'enabled' : 'disabled'}`);
      loadWebhooks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update webhook';
      showError(message);
    }
  };

  // Toggle event in form
  const toggleEvent = (event: string) => {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  };

  const resetForm = () => {
    setForm({ url: '', events: [], is_enabled: true, secret: '' });
  };

  const openEditModal = (webhook: Webhook) => {
    setForm({
      url: webhook.url,
      events: [...webhook.events],
      is_enabled: webhook.is_enabled,
      secret: '',
    });
    setEditWebhook(webhook);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  // Form component
  const renderForm = () => (
    <>
      <div className="input-group">
        <label>Webhook URL *</label>
        <input
          className="input"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="https://example.com/webhook"
          id="form-webhook-url"
        />
      </div>
      <div className="input-group">
        <label>Event Types *</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', marginTop: 'var(--space-xs)' }}>
          {EVENT_TYPES.map((event) => (
            <button
              key={event}
              type="button"
              className={`badge ${form.events.includes(event) ? 'badge-primary' : 'badge-info'}`}
              style={{
                cursor: 'pointer',
                padding: '6px 12px',
                fontSize: '0.8rem',
                opacity: form.events.includes(event) ? 1 : 0.5,
                transition: 'all 150ms',
              }}
              onClick={() => toggleEvent(event)}
            >
              {form.events.includes(event) ? '✓ ' : ''}{event}
            </button>
          ))}
        </div>
      </div>
      <div className="input-group">
        <label>Secret (optional — for HMAC signing)</label>
        <input
          className="input"
          type="password"
          value={form.secret}
          onChange={(e) => setForm({ ...form, secret: e.target.value })}
          placeholder="Enter a signing secret"
          id="form-webhook-secret"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.is_enabled}
            onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
            id="form-webhook-enabled"
          />
          <span className="toggle-slider" />
        </label>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          {form.is_enabled ? 'Enabled' : 'Disabled'}
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
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Webhooks</h2>
            <p>Configure endpoints to receive event notifications</p>
          </div>
          <button className="btn btn-primary" onClick={openCreateModal} id="add-webhook-btn">
            Add Webhook
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="empty-state">
            <h3>No webhooks configured</h3>
            <p>Add a webhook to receive notifications when products are created, updated, or deleted</p>
            <button className="btn btn-primary" onClick={openCreateModal}>Add Webhook</button>
          </div>
        ) : (
          <div id="webhooks-list">
            {webhooks.map((webhook) => (
              <div key={webhook.id} className="webhook-card animate-in">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
                      <span className={`badge ${webhook.is_enabled ? 'badge-active' : 'badge-inactive'}`}>
                        {webhook.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <label className="toggle" style={{ transform: 'scale(0.8)' }}>
                        <input
                          type="checkbox"
                          checked={webhook.is_enabled}
                          onChange={() => handleToggleEnabled(webhook)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                    <div className="webhook-url">{webhook.url}</div>
                    <div className="webhook-events">
                      {webhook.events.map((event) => (
                        <span key={event} className="badge badge-info">{event}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Created {formatDate(webhook.created_at)}
                    </div>
                  </div>

                  <div className="webhook-actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleTest(webhook)}
                      disabled={testingId === webhook.id}
                      id={`test-webhook-${webhook.id}`}
                    >
                      {testingId === webhook.id ? (
                        <span className="spinner" style={{ width: 12, height: 12 }} />
                      ) : null} Test
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => loadLogs(webhook.id)}
                    >
                      Logs
                    </button>
                    <button
                      className="action-btn-text"
                      onClick={() => openEditModal(webhook)}
                      style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', padding: '0 4px', fontSize: '0.85rem', fontWeight: 600 }}
                    >
                      Edit
                    </button>
                    <button
                      className="action-btn-text danger"
                      onClick={() => setDeleteTarget(webhook)}
                      style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '0 4px', fontSize: '0.85rem', fontWeight: 600 }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Test Result */}
                {testResults[webhook.id] && (
                  <div
                    style={{
                      marginTop: 'var(--space-md)',
                      padding: 'var(--space-sm) var(--space-md)',
                      borderRadius: 'var(--radius-md)',
                      background: testResults[webhook.id].success
                        ? 'var(--color-success-muted)'
                        : 'var(--color-danger-muted)',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-md)',
                    }}
                  >
                    <span>{testResults[webhook.id].success ? 'Success' : 'Failed'}</span>
                    <span>
                      {testResults[webhook.id].status_code
                        ? `HTTP ${testResults[webhook.id].status_code}`
                        : 'No response'}
                      {testResults[webhook.id].response_time_ms
                        ? ` — ${testResults[webhook.id].response_time_ms?.toFixed(0)}ms`
                        : ''}
                    </span>
                    {testResults[webhook.id].error && (
                      <span style={{ color: 'var(--color-danger)', marginLeft: 'auto' }}>
                        {testResults[webhook.id].error}
                      </span>
                    )}
                  </div>
                )}

                {/* Delivery Logs */}
                {expandedLogs === webhook.id && logs[webhook.id] && (
                  <div style={{ marginTop: 'var(--space-md)' }}>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--space-sm)', color: 'var(--text-secondary)' }}>
                      Recent Deliveries
                    </h4>
                    {logs[webhook.id].length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No delivery logs yet</p>
                    ) : (
                      <div className="table-wrapper" style={{ borderRadius: 'var(--radius-md)' }}>
                        <table className="table" style={{ fontSize: '0.8rem' }}>
                          <thead>
                            <tr>
                              <th>Event</th>
                              <th>Status</th>
                              <th>Time</th>
                              <th>Error</th>
                              <th>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {logs[webhook.id].map((log) => (
                              <tr key={log.id}>
                                <td>
                                  <span className="badge badge-info">{log.event_type}</span>
                                </td>
                                <td>
                                  {log.response_code ? (
                                    <span className={`badge ${log.response_code < 300 ? 'badge-active' : 'badge-inactive'}`}>
                                      {log.response_code}
                                    </span>
                                  ) : (
                                    <span className="badge badge-inactive">—</span>
                                  )}
                                </td>
                                <td>
                                  {log.response_time
                                    ? `${(log.response_time * 1000).toFixed(0)}ms`
                                    : '—'}
                                </td>
                                <td style={{ color: 'var(--color-danger)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {log.error_message || '—'}
                                </td>
                                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        title="Add Webhook"
        onClose={() => setShowCreateModal(false)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowCreateModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={modalLoading} id="save-webhook-btn">
              {modalLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : null}
              Create Webhook
            </button>
          </>
        }
      >
        {renderForm()}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editWebhook}
        title="Edit Webhook"
        onClose={() => setEditWebhook(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEditWebhook(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleUpdate} disabled={modalLoading} id="update-webhook-btn">
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
        title="Delete Webhook"
        message={`Are you sure you want to delete this webhook? All delivery logs will be removed. URL: ${deleteTarget?.url}`}
        confirmText="Delete Webhook"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={modalLoading}
      />

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
