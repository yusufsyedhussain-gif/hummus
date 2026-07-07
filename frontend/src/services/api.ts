/**
 * API client for Product Hub backend.
 * All requests go through this module for consistency.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options;

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config);

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      detail = errorData.detail || detail;
    } catch { /* ignore json parse errors */ }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ── Product API ────────────────────────────────────────────────────

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface ProductListResponse {
  items: Product[];
  pagination: PaginationMeta;
}

export interface ProductFilters {
  page?: number;
  page_size?: number;
  search?: string;
  sku?: string;
  status?: string;
  sort_by?: string;
  sort_order?: string;
}

export const productsApi = {
  list(filters: ProductFilters = {}): Promise<ProductListResponse> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== null) {
        params.append(key, String(value));
      }
    });
    const query = params.toString();
    return request(`/products${query ? `?${query}` : ''}`);
  },

  get(id: string): Promise<Product> {
    return request(`/products/${id}`);
  },

  create(data: Partial<Product>): Promise<Product> {
    return request('/products', { method: 'POST', body: data });
  },

  update(id: string, data: Partial<Product>): Promise<Product> {
    return request(`/products/${id}`, { method: 'PUT', body: data });
  },

  patch(id: string, data: Partial<Product>): Promise<Product> {
    return request(`/products/${id}`, { method: 'PATCH', body: data });
  },

  delete(id: string): Promise<void> {
    return request(`/products/${id}`, { method: 'DELETE' });
  },

  clearAll(): Promise<{ message: string; deleted_count: number }> {
    return request('/products?confirm=true', { method: 'DELETE' });
  },
};

// ── CSV Import API ─────────────────────────────────────────────────

export interface ImportTask {
  id: string;
  filename: string | null;
  status: string;
  total_rows: number;
  processed_rows: number;
  inserted_count: number;
  updated_count: number;
  error_count: number;
  errors: Array<{ row: number; field?: string; message: string }>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export const csvApi = {
  upload(
    file: File,
    onUploadProgress?: (percentage: number) => void
  ): Promise<{ task_id: string; status: string; message: string }> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/csv/upload`);

      if (onUploadProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentage = (event.loaded / event.total) * 100;
            onUploadProgress(percentage);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Invalid response JSON'));
          }
        } else {
          let detail = 'Upload failed';
          try {
            const errorData = JSON.parse(xhr.responseText);
            detail = errorData.detail || detail;
          } catch { /* ignore */ }
          reject(new ApiError(xhr.status, detail));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during upload'));
      };

      xhr.send(formData);
    });
  },

  getTask(taskId: string): Promise<ImportTask> {
    return request(`/tasks/${taskId}`);
  },

  retryTask(taskId: string): Promise<{ task_id: string; status: string }> {
    return request(`/tasks/${taskId}/retry`, { method: 'POST' });
  },

  listTasks(): Promise<ImportTask[]> {
    return request('/tasks');
  },

  getProgressUrl(taskId: string): string {
    return `${API_BASE}/tasks/${taskId}/progress`;
  },
};

// ── Webhook API ────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookTestResult {
  success: boolean;
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
}

export interface WebhookLog {
  id: string;
  webhook_id: string;
  event_type: string;
  response_code: number | null;
  response_time: number | null;
  error_message: string | null;
  created_at: string;
}

export const webhooksApi = {
  list(): Promise<Webhook[]> {
    return request('/webhooks');
  },

  create(data: { url: string; events: string[]; is_enabled?: boolean; secret?: string }): Promise<Webhook> {
    return request('/webhooks', { method: 'POST', body: data });
  },

  update(id: string, data: Partial<Webhook>): Promise<Webhook> {
    return request(`/webhooks/${id}`, { method: 'PUT', body: data });
  },

  delete(id: string): Promise<void> {
    return request(`/webhooks/${id}`, { method: 'DELETE' });
  },

  test(id: string): Promise<WebhookTestResult> {
    return request(`/webhooks/${id}/test`, { method: 'POST' });
  },

  getLogs(id: string, limit = 20): Promise<WebhookLog[]> {
    return request(`/webhooks/${id}/logs?limit=${limit}`);
  },

  getEventTypes(): Promise<{ event_types: string[] }> {
    return request('/webhooks/event-types');
  },
};
