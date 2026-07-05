import type { ApiErrorBody } from '@wolfiax/shared';

/**
 * Cliente HTTP del dashboard.
 *
 * Modelo de sesión:
 *  - access token SOLO en memoria (nunca localStorage → inmune a XSS persistente)
 *  - refresh token en cookie httpOnly gestionada por la API
 *  - ante un 401 se intenta UNA rotación (/auth/refresh) y se repite la petición
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const BASE = `${API_URL}/api/v1`;

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(
      res.status,
      body.error?.code ?? 'INTERNAL',
      body.error?.message ?? 'Error inesperado',
      body.error?.request_id,
    );
  } catch {
    return new ApiError(res.status, 'INTERNAL', `Error HTTP ${res.status}`);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** interno: evita bucles de refresh */
  _retried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !options._retried && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...options, _retried: true });
    }
  }

  if (!res.ok) {
    throw await parseError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/** Rota el refresh token. Devuelve true si hay sesión válida. */
export async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      setAccessToken(null);
      return false;
    }
    const body = (await res.json()) as { access_token: string };
    setAccessToken(body.access_token);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
