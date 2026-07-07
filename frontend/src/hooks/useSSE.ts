/**
 * Polling-based progress tracking hook.
 *
 * Replaces the SSE implementation which gets buffered by intermediate
 * Docker / nginx proxies and never delivers mid-stream updates.
 * Polls GET /api/v1/tasks/{id} every POLL_INTERVAL_MS instead.
 *
 * The external interface (return value) is identical to the old useSSE
 * hook so no other files need changing.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL_MS = 1000;

export interface ProgressData {
  task_id: string;
  status: string;
  processed_rows: number;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  error_count: number;
  percentage: number;
  current_batch_errors: Array<{ row: number; field?: string; message: string }>;
  error?: string;
}

interface UseSSEOptions {
  onProgress?: (data: ProgressData) => void;
  onComplete?: (data: ProgressData) => void;
  onError?: (error: string) => void;
}

// Derive the task-status URL from the SSE progress URL that the rest of
// the app already produces (e.g. http://localhost:8000/api/v1/tasks/<id>/progress)
// → strip "/progress" to get the REST endpoint.
function taskUrlFromProgressUrl(progressUrl: string): string {
  return progressUrl.replace(/\/progress$/, '');
}

export function useSSE(url: string | null, options: UseSSEOptions = {}) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [allErrors, setAllErrors] = useState<Array<{ row: number; field?: string; message: string }>>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Track seen error rows so we don't duplicate them across polls
  const seenErrorRowsRef = useRef<Set<string>>(new Set());

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setProgress(null);
    setAllErrors([]);
    seenErrorRowsRef.current = new Set();
  }, [stopPolling]);

  useEffect(() => {
    if (!url) {
      stopPolling();
      return;
    }

    const taskUrl = taskUrlFromProgressUrl(url);
    setIsConnected(true);

    const poll = async () => {
      try {
        const res = await fetch(taskUrl);
        if (!res.ok) return;

        const raw = await res.json();

        // Map ImportTask fields → ProgressData shape
        const data: ProgressData = {
          task_id: raw.id,
          status: raw.status,
          processed_rows: raw.processed_rows ?? 0,
          total_rows: raw.total_rows ?? 0,
          inserted_count: raw.inserted_count ?? 0,
          updated_count: raw.updated_count ?? 0,
          error_count: raw.error_count ?? 0,
          percentage:
            raw.total_rows > 0
              ? Math.round((raw.processed_rows / raw.total_rows) * 100)
              : raw.status === 'completed'
              ? 100
              : 0,
          current_batch_errors: [],
          error: raw.errors?.length > 0 ? raw.errors[0]?.message : undefined,
        };

        // Accumulate row errors without duplicates
        if (Array.isArray(raw.errors) && raw.errors.length > 0) {
          const newErrors: typeof allErrors = [];
          for (const e of raw.errors) {
            const key = `${e.row}-${e.field}-${e.message}`;
            if (!seenErrorRowsRef.current.has(key)) {
              seenErrorRowsRef.current.add(key);
              newErrors.push(e);
            }
          }
          if (newErrors.length > 0) {
            setAllErrors((prev) => [...prev, ...newErrors].slice(0, 500));
          }
        }

        setProgress(data);
        optionsRef.current.onProgress?.(data);

        if (data.status === 'completed') {
          stopPolling();
          optionsRef.current.onComplete?.(data);
        }

        if (data.status === 'failed') {
          stopPolling();
          optionsRef.current.onError?.(data.error || 'Import failed');
        }
      } catch {
        // network error – keep polling
      }
    };

    // Poll immediately, then on interval
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      stopPolling();
    };
  }, [url, stopPolling]);

  return {
    progress,
    isConnected,
    allErrors,
    disconnect: stopPolling,
    reset,
  };
}
