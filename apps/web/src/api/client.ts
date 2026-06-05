// TERANODE web — typed fetch wrapper over the API (spec §5).
// Covers auth/identity + admin + crops + analytics endpoints used by the admin app.
// All DTO shapes are imported from @teranode/types so client + server stay in sync.

import type {
  AckAlertResponse,
  AdminFarmsResponse,
  AlertsQuery,
  AlertsResponse,
  ApiError,
  AuditQuery,
  AuditResponse,
  BindGatewayRequest,
  BindGatewayResponse,
  ClaimDeviceRequest,
  ClaimDeviceResponse,
  CreateCropRequest,
  CreateCropResponse,
  CreateCustomerRequest,
  CreateCustomerResponse,
  DeviceCatalogResponse,
  EntitlementsResponse,
  ExportQuery,
  FleetResponse,
  GetCropResponse,
  GetCustomerResponse,
  ListCropsResponse,
  ListCustomersResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  OtaRequest,
  OtaResponse,
  RefreshResponse,
  RegisterGatewayRequest,
  RegisterGatewayResponse,
  SavingsQuery,
  SavingsResponse,
  UpdateCropRequest,
  UpdateCropResponse,
  UpdateCropStagesRequest,
  UpdateCropStagesResponse,
  UpdateCustomerRequest,
  UpdateCustomerResponse,
  UpdateEntitlementsRequest,
  UpdateEntitlementsResponse,
  UsageQuery,
  UsageResponse,
} from '@teranode/types';

/** Base URL of the API (Vite env, default localhost:4000). */
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const ACCESS_KEY = 'teranode.web.accessToken';
const CSRF_KEY = 'teranode.web.csrf';

// --- token storage ------------------------------------------------------------
//
// The refresh token is NOT stored here — it lives in an httpOnly cookie the
// browser manages, so an XSS cannot read it. We keep only the short-lived access
// token and the CSRF token (echoed back to /auth/refresh + /auth/logout).

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get csrf(): string | null {
    return localStorage.getItem(CSRF_KEY);
  },
  set(access: string, csrf?: string | null): void {
    localStorage.setItem(ACCESS_KEY, access);
    if (csrf) localStorage.setItem(CSRF_KEY, csrf);
  },
  setAccess(access: string): void {
    localStorage.setItem(ACCESS_KEY, access);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(CSRF_KEY);
  },
};

/** Thrown by the client on any non-2xx response. */
export class ApiRequestError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.details = details;
  }
}

/** Called whenever a request 401s after a failed refresh — the auth layer wires this. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// --- query string helper ------------------------------------------------------

function toQuery(params?: object): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// --- core request -------------------------------------------------------------

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip the Authorization header (login/refresh). */
  noAuth?: boolean;
  /** Already attempted a refresh for this call (guards against loops). */
  retried?: boolean;
  /** Return the raw text body instead of parsing JSON (CSV export). */
  raw?: boolean;
  signal?: AbortSignal;
  /** Extra headers (e.g. X-CSRF-Token on auth calls). */
  headers?: Record<string, string>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': 'web' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.noAuth) {
    const token = tokenStore.access;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (opts.headers) Object.assign(headers, opts.headers);

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    // Send/receive the httpOnly refresh cookie on /auth/*.
    credentials: 'include',
  });

  // 401 → try a single refresh, then replay; otherwise surface to the auth layer.
  if (res.status === 401 && !opts.noAuth && !opts.retried) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, { ...opts, retried: true });
    }
    tokenStore.clear();
    onUnauthorized?.();
    throw new ApiRequestError(401, 'Unauthorized');
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const data = (await res.json()) as ApiError;
      if (data?.error) message = data.error;
      details = data?.details;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      tokenStore.clear();
      onUnauthorized?.();
    }
    throw new ApiRequestError(res.status, message, details);
  }

  if (opts.raw) return (await res.text()) as unknown as T;
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/** Rotate the access token using the httpOnly refresh cookie + the CSRF token. */
async function tryRefresh(): Promise<boolean> {
  const csrf = tokenStore.csrf;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Client': 'web',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as RefreshResponse;
    tokenStore.set(data.accessToken, data.csrfToken);
    return true;
  } catch {
    return false;
  }
}

// --- typed endpoint surface ---------------------------------------------------

export const api = {
  // auth & identity ----------------------------------------------------------
  login(body: LoginRequest): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body,
      noAuth: true,
    });
  },
  refresh(): Promise<RefreshResponse> {
    const csrf = tokenStore.csrf;
    return request<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      noAuth: true,
      headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
    });
  },
  logout(): Promise<LogoutResponse> {
    const csrf = tokenStore.csrf;
    return request<LogoutResponse>('/auth/logout', {
      method: 'POST',
      headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
    });
  },
  getMe(): Promise<MeResponse> {
    return request<MeResponse>('/me');
  },
  getMyEntitlements(): Promise<EntitlementsResponse> {
    return request<EntitlementsResponse>('/me/entitlements');
  },

  // admin: customers ----------------------------------------------------------
  listCustomers(): Promise<ListCustomersResponse> {
    return request<ListCustomersResponse>('/admin/customers');
  },
  createCustomer(body: CreateCustomerRequest): Promise<CreateCustomerResponse> {
    return request<CreateCustomerResponse>('/admin/customers', {
      method: 'POST',
      body,
    });
  },
  getCustomer(id: string): Promise<GetCustomerResponse> {
    return request<GetCustomerResponse>(`/admin/customers/${id}`);
  },
  updateCustomer(
    id: string,
    body: UpdateCustomerRequest,
  ): Promise<UpdateCustomerResponse> {
    return request<UpdateCustomerResponse>(`/admin/customers/${id}`, {
      method: 'PATCH',
      body,
    });
  },
  updateEntitlements(
    id: string,
    body: UpdateEntitlementsRequest,
  ): Promise<UpdateEntitlementsResponse> {
    return request<UpdateEntitlementsResponse>(
      `/admin/customers/${id}/entitlements`,
      { method: 'PATCH', body },
    );
  },

  // admin: fleet & gateways ---------------------------------------------------
  getFleet(): Promise<FleetResponse> {
    return request<FleetResponse>('/admin/fleet');
  },
  /** Every farm across all customers (for admin farm pickers). */
  getAdminFarms(): Promise<AdminFarmsResponse> {
    return request<AdminFarmsResponse>('/admin/farms');
  },
  registerGateway(
    body: RegisterGatewayRequest,
  ): Promise<RegisterGatewayResponse> {
    return request<RegisterGatewayResponse>('/admin/gateways', {
      method: 'POST',
      body,
    });
  },
  bindGateway(id: string, body: BindGatewayRequest): Promise<BindGatewayResponse> {
    return request<BindGatewayResponse>(`/admin/gateways/${id}/bind`, {
      method: 'POST',
      body,
    });
  },
  otaGateway(id: string, body: OtaRequest): Promise<OtaResponse> {
    return request<OtaResponse>(`/admin/gateways/${id}/ota`, {
      method: 'POST',
      body,
    });
  },
  /** Claim an in-stock device (by serial) to a customer account at purchase. */
  claimDevice(serial: string, body: ClaimDeviceRequest): Promise<ClaimDeviceResponse> {
    return request<ClaimDeviceResponse>(`/admin/devices/${encodeURIComponent(serial)}/claim`, {
      method: 'POST',
      body,
    });
  },

  // admin: audit & catalog ----------------------------------------------------
  getAudit(query?: AuditQuery): Promise<AuditResponse> {
    return request<AuditResponse>(`/admin/audit${toQuery(query)}`);
  },
  getDeviceCatalog(): Promise<DeviceCatalogResponse> {
    return request<DeviceCatalogResponse>('/device-catalog');
  },

  // crops ---------------------------------------------------------------------
  listCrops(): Promise<ListCropsResponse> {
    return request<ListCropsResponse>('/crops');
  },
  getCrop(id: string): Promise<GetCropResponse> {
    return request<GetCropResponse>(`/crops/${id}`);
  },
  createCrop(body: CreateCropRequest): Promise<CreateCropResponse> {
    return request<CreateCropResponse>('/crops', { method: 'POST', body });
  },
  updateCrop(id: string, body: UpdateCropRequest): Promise<UpdateCropResponse> {
    return request<UpdateCropResponse>(`/crops/${id}`, { method: 'PATCH', body });
  },
  updateCropStages(
    id: string,
    body: UpdateCropStagesRequest,
  ): Promise<UpdateCropStagesResponse> {
    return request<UpdateCropStagesResponse>(`/crops/${id}/stages`, {
      method: 'PATCH',
      body,
    });
  },

  // analytics (cross-tenant, admin) -------------------------------------------
  getUsage(query: UsageQuery): Promise<UsageResponse> {
    return request<UsageResponse>(`/analytics/usage${toQuery(query)}`);
  },
  getSavings(query: SavingsQuery): Promise<SavingsResponse> {
    return request<SavingsResponse>(`/analytics/savings${toQuery(query)}`);
  },
  exportCsv(query: ExportQuery): Promise<string> {
    return request<string>(
      `/analytics/export${toQuery({ ...query, format: query.format ?? 'csv' })}`,
      { raw: true },
    );
  },

  // alerts (used in fleet/ops views) ------------------------------------------
  getAlerts(query?: AlertsQuery): Promise<AlertsResponse> {
    return request<AlertsResponse>(`/alerts${toQuery(query)}`);
  },
  ackAlert(id: string): Promise<AckAlertResponse> {
    return request<AckAlertResponse>(`/alerts/${id}/ack`, { method: 'POST' });
  },
};

export type Api = typeof api;
