/**
 * Reusable confirmation dialog modal.
 */

'use client';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const ICONS: Record<string, string> = {
  danger: '⚠️',
  warning: '⚡',
  default: '❓',
};

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay confirm-dialog" onClick={onCancel} id="confirm-dialog">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm-icon ${variant}`}>{ICONS[variant]}</div>
        <h3 style={{ marginBottom: '12px', fontSize: '1.1rem' }}>{title}</h3>
        <p>{message}</p>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel} disabled={loading} id="confirm-cancel-btn">
            {cancelText}
          </button>
          <button
            className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={loading}
            id="confirm-action-btn"
          >
            {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
