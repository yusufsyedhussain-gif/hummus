/**
 * Custom hook for Server-Sent Events (SSE) progress tracking.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

export function useSSE(url: string | null, options: UseSSEOptions = {}) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [allErrors, setAllErrors] = useState<Array<{ row: number; field?: string; message: string }>>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!url) return;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: ProgressData = JSON.parse(event.data);

        if (data.status === 'stream_end') {
          disconnect();
          return;
        }

        setProgress(data);

        // Accumulate batch errors
        if (data.current_batch_errors && data.current_batch_errors.length > 0) {
          setAllErrors((prev) => {
            const combined = [...prev, ...data.current_batch_errors];
            return combined.slice(0, 500); // Cap at 500 errors displayed
          });
        }

        optionsRef.current.onProgress?.(data);

        if (data.status === 'completed') {
          optionsRef.current.onComplete?.(data);
          disconnect();
        }

        if (data.status === 'failed') {
          optionsRef.current.onError?.(data.error || 'Import failed');
          disconnect();
        }
      } catch {
        // Ignore parse errors (keepalive messages)
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects, but if the task is done, we should close
      if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
        disconnect();
      }
    };

    return () => {
      disconnect();
    };
  }, [url, disconnect]);

  const reset = useCallback(() => {
    setProgress(null);
    setAllErrors([]);
    disconnect();
  }, [disconnect]);

  return {
    progress,
    isConnected,
    allErrors,
    disconnect,
    reset,
  };
}
