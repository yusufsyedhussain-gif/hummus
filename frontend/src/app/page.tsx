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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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

      // Auto-reconnect only to tasks started within the last 10 minutes
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const activeTask = data.find(t =>
        ['queued', 'parsing', 'validating', 'importing'].includes(t.status) &&
        t.started_at &&
        new Date(t.started_at).getTime() > tenMinutesAgo
      );
      if (activeTask && !currentTaskId) {
        setCurrentTaskId(activeTask.id);
        setSseUrl(csvApi.getProgressUrl(activeTask.id));
      }
    } catch {
      // ignore
    } finally {
      setLoadingTasks(false);
    }
  }, [currentTaskId]);

  const handleClearProgress = () => {
    setCurrentTaskId(null);
    setSseUrl(null);
    resetSSE();
  };

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
    setUploadProgress(0);
    resetSSE();

    try {
      const result = await csvApi.upload(file, (pct) => {
        setUploadProgress(Math.round(pct));
      });
      setCurrentTaskId(result.task_id);
      setSseUrl(csvApi.getProgressUrl(result.task_id));
      info('CSV file accepted — processing started');
      loadTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      showError(message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
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

  const getDisplayTasks = () => {
    if (!progress) return tasks;
    return tasks.map((task) => {
      if (task.id === progress.task_id) {
        return {
          ...task,
          status: progress.status,
          processed_rows: progress.processed_rows,
          total_rows: progress.total_rows || task.total_rows,
          inserted_count: progress.inserted_count,
          updated_count: progress.updated_count,
          error_count: progress.error_count,
        };
      }
      return task;
    });
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-logo">
          <h1>Product Hub</h1>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-link ${pathname === '/' ? 'active' : ''}`}
            onClick={() => router.push('/')}
            id="nav-dashboard"
          >
            CSV Import
          </button>
          <button
            className={`nav-link ${pathname === '/products' ? 'active' : ''}`}
            onClick={() => router.push('/products')}
            id="nav-products"
          >
            Products
          </button>
          <button
            className={`nav-link ${pathname === '/webhooks' ? 'active' : ''}`}
            onClick={() => router.push('/webhooks')}
            id="nav-webhooks"
          >
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
        {!uploading && !currentTaskId && (
          <div
            className={`upload-zone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            id="upload-zone"
            style={{ position: 'relative', zIndex: 1 }}
          >
            <h3>Drop your CSV file here</h3>
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
        )}

        {/* Unified Upload & Import Progress Card */}
        {(uploading || currentTaskId) && (
          <div className="import-progress-card animate-in" style={{ marginTop: 'var(--space-xl)' }} id="import-progress">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                {uploading ? 'Uploading File' : 'Import Progress'}
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span className={`import-status-badge ${uploading ? 'importing' : (progress?.status || 'queued')}`}>
                  {uploading && 'Uploading'}
                  {!uploading && !progress && 'Connecting...'}
                  {!uploading && progress && (
                    <>
                      {progress.status === 'queued' && 'Queued'}
                      {progress.status === 'parsing' && 'Parsing CSV'}
                      {progress.status === 'validating' && 'Validating'}
                      {progress.status === 'importing' && 'Importing'}
                      {progress.status === 'completed' && 'Complete'}
                      {progress.status === 'failed' && 'Failed'}
                    </>
                  )}
                </span>
                {!uploading && (
                  <button
                    onClick={handleClearProgress}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: '2px 6px' }}
                    title="Dismiss"
                    id="dismiss-progress-btn"
                  >×</button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            {uploading ? (
              <div className="progress-container" style={{ height: 16, marginBottom: 'var(--space-lg)' }}>
                <div
                  className="progress-bar"
                  style={{
                    width: `${uploadProgress ?? 0}%`,
                    background: 'var(--color-primary)',
                    height: '100%',
                    transition: 'width var(--transition-fast)',
                  }}
                />
              </div>
            ) : (
              <div className="progress-container" style={{ height: 16, marginBottom: 'var(--space-lg)', display: 'flex' }}>
                {!progress || progress.total_rows === 0 ? (
                  <div
                    className="progress-bar"
                    style={{
                      width: `${progress?.percentage ?? 0}%`,
                      background: progress?.status === 'failed' ? 'var(--color-danger)' : 'var(--color-primary)',
                      height: '100%',
                      transition: 'width var(--transition-base)',
                    }}
                  />
                ) : (
                  <>
                    <div
                      style={{
                        width: `${(progress.inserted_count / progress.total_rows) * 100}%`,
                        background: 'var(--color-success)',
                        height: '100%',
                        transition: 'width var(--transition-fast)',
                      }}
                      title={`Inserted: ${progress.inserted_count}`}
                    />
                    <div
                      style={{
                        width: `${(progress.updated_count / progress.total_rows) * 100}%`,
                        background: 'var(--color-info)',
                        height: '100%',
                        transition: 'width var(--transition-fast)',
                      }}
                      title={`Updated: ${progress.updated_count}`}
                    />
                    <div
                      style={{
                        width: `${(progress.error_count / progress.total_rows) * 100}%`,
                        background: 'var(--color-danger)',
                        height: '100%',
                        transition: 'width var(--transition-fast)',
                      }}
                      title={`Errors: ${progress.error_count}`}
                    />
                  </>
                )}
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)', fontSize: '1.5rem', fontWeight: 700 }}>
              {uploading ? `${uploadProgress ?? 0}%` : `${progress?.percentage?.toFixed(1) ?? '0.0'}%`}
            </div>

            {/* Stats */}
            {!uploading && progress && (
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
            )}

            {/* Error Detail Display */}
            {!uploading && progress && progress.status === 'failed' && (
              <div style={{ padding: 'var(--space-md)', background: 'var(--color-danger-muted)', color: 'var(--color-danger)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
                <strong>Failure Reason:</strong> {progress.error || 'Unknown error occurred during import.'}
              </div>
            )}

            {/* Error List */}
            {!uploading && allErrors.length > 0 && (
              <details style={{ marginTop: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
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

            {/* Action buttons (Try Again / Import Another / Retry) */}
            {!uploading && (
              <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center', marginTop: 'var(--space-lg)' }}>
                {progress && progress.status === 'completed' && (
                  <button className="btn btn-primary" onClick={handleClearProgress} id="done-import-btn">
                    Import Another File
                  </button>
                )}
                {progress && progress.status === 'failed' && (
                  <>
                    <button className="btn btn-ghost" onClick={handleClearProgress} id="clear-failed-btn">
                      Upload New File
                    </button>
                    {currentTaskId && (
                      <button className="btn btn-primary" onClick={() => handleRetry(currentTaskId)} id="retry-btn">
                        Retry Import
                      </button>
                    )}
                  </>
                )}
                {(!progress && !isConnected) && (
                  <button className="btn btn-danger" onClick={handleClearProgress} id="reset-connection-btn">
                    Try Again / Upload New File
                  </button>
                )}
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
                  {getDisplayTasks().map((task) => (
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
