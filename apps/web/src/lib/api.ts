import { useAuthStore } from '../stores/auth';

/** Typed fetch wrapper with transparent single-flight token refresh. */

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token: string };
  useAuthStore.getState().setToken(data.access_token);
  return data.access_token;
}

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; blob?: boolean } = {},
): Promise<T> {
  const attempt = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    return fetch(path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'include',
    });
  };

  let response = await attempt(useAuthStore.getState().accessToken);
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    const token = await refreshAccessToken();
    if (token) {
      response = await attempt(token);
    } else {
      useAuthStore.getState().clear();
      throw new ApiError(401, 'Session expired');
    }
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`, body.code, body.details);
  }
  return payload as T;
}

/** Multipart-free streaming upload with progress (XHR). */
export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; key: string; name: string; content_type: string; size: number }> {
  return new Promise((resolve, reject) => {
    const token = useAuthStore.getState().accessToken;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files/upload?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as { url?: string; error?: string; code?: string };
        if (xhr.status >= 200 && xhr.status < 300 && data.url) {
          resolve(data as { url: string; key: string; name: string; content_type: string; size: number });
        } else {
          reject(new ApiError(xhr.status, data.error ?? 'Upload failed', data.code));
        }
      } catch {
        reject(new ApiError(xhr.status, 'Upload failed'));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(file);
  });
}
