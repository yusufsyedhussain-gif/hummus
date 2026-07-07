/**
 * Product Hub — Main Dashboard / CSV Upload Page
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { csvApi, ImportTask } from '@/services/api';
import { useSSE, ProgressData } from '@/hooks/useSSE';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/ToastContainer';

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { toasts, removeToast, success, error: showError, info } = useToast();

  // Upload state
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [sseUrl, setSseUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import history
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // SSE progress
  const { progress, allErrors, isConnected, reset: resetSSE } = useSSE(sseUrl, {
    onComplete: (data) => {
      success(`Import complete! ${data.inserted_count} inserted, ${data.updated_count} updated`);
      loadTasks();
    },
    onError: (err) => {
      showError(`Import failed: ${err}`);
      loadTasks();
    },
  });

  const loadTasks = useCallback(async () => {
    try {
      const data = await csvApi.listTasks();
      setTasks(data);
    } catch {
      // ignore
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // File upload handler
  const handleUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showError('Please upload a CSV file');
      return;
    }

    setUploading(true);
    resetSSE();

    try {
      const result = await csvApi.upload(file);
      setCurrentTaskId(result.task_id);
      setSseUrl(csvApi.getProgressUrl(result.task_id));
      info('CSV file accepted — processing started');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      showError(message);
    } finally {
      setUploading(false);
    }
  }, [showError, info, resetSSE]);

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  // Retry handler
  const handleRetry = async (taskId: string) => {
    try {
      await csvApi.retryTask(taskId);
      setCurrentTaskId(taskId);
      setSseUrl(csvApi.getProgressUrl(taskId));
      info('Retrying import...');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      showError(message);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  };

  const isProcessing = progress && !['completed', 'failed'].includes(progress.status);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📦</div>
          <h1>Product Hub</h1>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-link ${pathname === '/' ? 'active' : ''}`}
            onClick={() => router.push('/')}
            id="nav-dashboard"
          >
            <span className="nav-icon">📤</span>
            CSV Import
          </button>
          <button
            className={`nav-link ${pathname === '/products' ? 'active' : ''}`}
            onClick={() => router.push('/products')}
            id="nav-products"
          >
            <span className="nav-icon">🏷️</span>
            Products
          </button>
          <button
            className={`nav-link ${pathname === '/webhooks' ? 'active' : ''}`}
            onClick={() => router.push('/webhooks')}
            id="nav-webhooks"
          >
            <span className="nav-icon">🔗</span>
            Webhooks
          </button>
        </nav>
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 'var(--space-md)', marginTop: 'auto' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Product Hub v1.0</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="page-header">
          <h2>CSV Import</h2>
          <p>Upload CSV files with up to 500,000 product entries for bulk import</p>
        </div>

        {/* Upload Zone */}
        <div
          className={`upload-zone ${isDragOver ? 'dragover' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          id="upload-zone"
          style={{ position: 'relative', zIndex: 1 }}
        >
          <div className="upload-zone-icon">{uploading ? '⏳' : '📄'}</div>
          <h3>{uploading ? 'Uploading...' : 'Drop your CSV file here'}</h3>
          <p>or click to browse • Supports up to 100MB • .csv files only</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            id="file-input"
          />
        </div>

        {/* Import Progress */}
        {progress && (
          <div className="import-progress-card animate-in" style={{ marginTop: 'var(--space-xl)' }} id="import-progress">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Import Progress</h3>
              <span className={`import-status-badge ${progress.status}`}>
                {isConnected && isProcessing && (
                  <span className="spinner" style={{ width: 12, height: 12 }} />
                )}
                {progress.status === 'queued' && 'Queued'}
                {progress.status === 'parsing' && 'Parsing CSV'}
                {progress.status === 'validating' && 'Validating'}
                {progress.status === 'importing' && 'Importing'}
                {progress.status === 'completed' && '✓ Complete'}
                {progress.status === 'failed' && '✕ Failed'}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="progress-container" style={{ height: 12, marginBottom: 'var(--space-lg)' }}>
              <div
                className="progress-bar"
                style={{
                  width: `${progress.percentage}%`,
                  background: progress.status === 'completed'
                    ? 'var(--gradient-success)'
                    : progress.status === 'failed'
                      ? 'var(--gradient-danger)'
                      : 'var(--gradient-accent)',
                }}
              />
            </div>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)', fontSize: '1.5rem', fontWeight: 700 }}>
              {progress.percentage.toFixed(1)}%
            </div>

            {/* Stats */}
            <div className="import-stats">
              <div className="import-stat">
                <div className="label">Processed</div>
                <div className="value">{progress.processed_rows.toLocaleString()}</div>
              </div>
              <div className="import-stat">
                <div className="label">Inserted</div>
                <div className="value" style={{ color: 'var(--color-success)' }}>
                  {progress.inserted_count.toLocaleString()}
                </div>
              </div>
              <div className="import-stat">
                <div className="label">Updated</div>
                <div className="value" style={{ color: 'var(--color-info)' }}>
                  {progress.updated_count.toLocaleString()}
                </div>
              </div>
              <div className="import-stat">
                <div className="label">Errors</div>
                <div className="value" style={{ color: progress.error_count > 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                  {progress.error_count.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Error List */}
            {allErrors.length > 0 && (
              <details style={{ marginTop: 'var(--space-md)' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--color-danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                  Show errors ({allErrors.length})
                </summary>
                <div className="error-list">
                  {allErrors.map((err, i) => (
                    <div key={i} className="error-item">
                      <span>Row {err.row}</span>
                      {err.field && <span>[{err.field}]</span>} {err.message}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Retry button */}
            {progress.status === 'failed' && currentTaskId && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-lg)' }}>
                <button className="btn btn-primary" onClick={() => handleRetry(currentTaskId)} id="retry-btn">
                  ↻ Retry Import
                </button>
              </div>
            )}
          </div>
        )}

        {/* Recent Imports */}
        <div style={{ marginTop: 'var(--space-2xl)' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
            Recent Imports
          </h3>

          {loadingTasks ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
              <div className="spinner spinner-lg" style={{ margin: '0 auto' }} />
            </div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <h3>No imports yet</h3>
              <p>Upload your first CSV file to get started</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table" id="import-history-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Rows</th>
                    <th>Inserted</th>
                    <th>Updated</th>
                    <th>Errors</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id} className="animate-in">
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                        {task.filename || '—'}
                      </td>
                      <td>
                        <span className={`import-status-badge ${task.status}`}>{task.status}</span>
                      </td>
                      <td>{task.total_rows.toLocaleString()}</td>
                      <td style={{ color: 'var(--color-success)' }}>{task.inserted_count.toLocaleString()}</td>
                      <td style={{ color: 'var(--color-info)' }}>{task.updated_count.toLocaleString()}</td>
                      <td style={{ color: task.error_count > 0 ? 'var(--color-danger)' : undefined }}>
                        {task.error_count.toLocaleString()}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {formatDate(task.created_at)}
                      </td>
                      <td>
                        {task.status === 'failed' && (
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleRetry(task.id)}
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
