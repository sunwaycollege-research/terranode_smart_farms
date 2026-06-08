// ============================================================================
// TERANODE mobile API client — the single seam every screen talks to.
//
// `api.*` exposes the BUILD-SPEC §5 surface 1:1 with the Express REST API. When
// `USE_MOCK` (app.json → extra.useMockApi, read via expo-constants) is true the
// calls resolve against the in-memory mock in ./mock; otherwise they hit the
// live server at extra.apiBaseUrl. Because the method→endpoint map is identical
// in both branches, the Phase-6 cutover is a single flag flip — no screen change.
// ============================================================================

import Constants from 'expo-constants';
import * as mock from './mock';
import type {
  AckAlertResponse,
  Actuator,
  ActuatorAction,
  ActuatorCommandResponse,
  Alert,
  AlertsResponse,
  AssignZoneRequest,
  AssignZoneResponse,
  CreateHarvestRequest,
  CreateHarvestResponse,
  CreateZoneRequest,
  CreateZoneResponse,
  CropRef,
  CropWithStages,
  DeviceCatalogItem,
  DeviceCatalogResponse,
  EntitlementsResponse,
  Farm,
  FarmReading,
  FarmReadingsResponse,
  Gateway,
  HarvestLog,
  HarvestResponse,
  ListCropsResponse,
  ListFarmsResponse,
  ListZonesResponse,
  LoginResponse,
  MeResponse,
  Rule,
  SavingsResponse,
  TelemetryAgg,
  TelemetryResponse,
  UpdateRuleRequest,
  UsageResponse,
  Zone,
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { getCrop } from '@teranode/agronomy';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; useMockApi?: boolean };
const USE_MOCK = extra.useMockApi ?? true;

/**
 * Resolve the API base URL. On a physical device / emulator, "localhost" points
 * at the device itself — NOT the dev machine — so a localhost apiBaseUrl can't
 * reach the backend ("could not load your field"). In dev we therefore rewrite a
 * localhost host to the IP the device already used to reach the Expo/Metro
 * server (Constants…hostUri), keeping the configured port. On web / iOS
 * simulator that host IS localhost, so nothing changes. Set extra.apiBaseUrl to
 * an explicit non-localhost URL (e.g. a deployed API) to opt out of rewriting.
 */
function resolveBase(): string {
  const configured = extra.apiBaseUrl ?? 'http://localhost:4000';
  try {
    if (!/\/\/(localhost|127\.0\.0\.1)\b/.test(configured)) return configured; // explicit/remote → use as-is
    const hostUri =
      (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
      (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
      '';
    const host = String(hostUri).split('/')[0].split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      const port = configured.split(':').pop()?.replace(/\D.*$/, '') || '4000';
      return `http://${host}:${port}`;
    }
  } catch {
    /* fall back to the configured value */
  }
  return configured;
}

const BASE = resolveBase();

// ---------------------------------------------------------------------------
// token store — access + refresh held in memory; the access token is sent as a
// Bearer on every authed call, and the refresh token is used to silently rotate
// on a 401. A persist hook lets the auth layer write rotated tokens back to
// SecureStore so a refresh survives an app restart.
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshToken: string | null = null;
let onTokensPersist: ((access: string, refresh: string | null) => void) | null = null;

export function setTokens(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
}
/** Back-compat: set only the access token (the refresh token is left unchanged). */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
/** Wire a callback invoked when tokens are silently refreshed (persist to SecureStore). */
export function setOnTokensPersist(
  fn: ((access: string, refresh: string | null) => void) | null,
): void {
  onTokensPersist = fn;
}

/** Wire a callback invoked when a request 401s and cannot be refreshed — the auth
 *  layer uses it to clear the session and send the user back to login (instead of
 *  a stuck "could not load" screen with a dead/stale token). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

let refreshing: Promise<boolean> | null = null;

/** Rotate access (+ refresh) via /auth/refresh using the in-memory refresh token. */
async function refreshTokens(): Promise<boolean> {
  if (USE_MOCK || !refreshToken) return false;
  if (!refreshing) {
    refreshing = (async (): Promise<boolean> => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string; refreshToken?: string };
        accessToken = data.accessToken;
        if (data.refreshToken) refreshToken = data.refreshToken;
        onTokensPersist?.(accessToken, refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

async function http<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  // On a 401, try a single silent token refresh, then replay the request once.
  if (res.status === 401 && !retried && !USE_MOCK && refreshToken) {
    if (await refreshTokens()) return http<T>(path, init, true);
  }
  if (!res.ok) {
    // An unrecoverable 401 (no/stale refresh token, or refresh failed) means the
    // session is dead — tell the auth layer to log out so the user re-authenticates
    // rather than seeing a network-style error.
    if (res.status === 401 && !USE_MOCK) onUnauthorized?.();
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status} ${path}${detail ? ` — ${detail}` : ''}`);
  }
  // 204 / empty body tolerant.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------
// the client surface (1:1 with the API)
// ---------------------------------------------------------------------------

export const api = {
  // -- auth & identity -------------------------------------------------------

  /** POST /auth/login → { accessToken, refreshToken, expiresIn, user, account }. */
  async login(email: string, password: string): Promise<LoginResponse> {
    if (USE_MOCK) {
      const user = mock.findUserByEmail(email) ?? mock.users[1];
      const account = mock.accountById(user.accountId)!;
      const res: LoginResponse = {
        accessToken: `mock.${user.id}`,
        refreshToken: `mock.refresh.${user.id}`,
        expiresIn: 900,
        user,
        account,
      };
      accessToken = res.accessToken;
      refreshToken = res.refreshToken ?? null;
      return res;
    }
    // Direct fetch (not http()) so a 401 surfaces as bad credentials rather than
    // triggering a refresh attempt with a stale token.
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      let detail = '';
      try {
        detail = (await r.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new Error(`API ${r.status} /auth/login${detail ? ` — ${detail}` : ''}`);
    }
    const res = (await r.json()) as LoginResponse;
    accessToken = res.accessToken;
    refreshToken = res.refreshToken ?? null;
    return res;
  },

  /** POST /auth/logout — revoke the refresh token server-side + clear local tokens. */
  async logout(): Promise<void> {
    if (!USE_MOCK && refreshToken) {
      try {
        await fetch(`${BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        /* best-effort */
      }
    }
    accessToken = null;
    refreshToken = null;
  },

  /** GET /me → { user, account }. */
  async me(): Promise<MeResponse> {
    if (USE_MOCK) {
      const user = mock.users[1];
      return { user, account: mock.accountById(user.accountId)! };
    }
    return http<MeResponse>('/me');
  },

  /** GET /me/entitlements → { accountId, values, catalog }. */
  async entitlements(): Promise<EntitlementsResponse> {
    if (USE_MOCK) {
      const rec = mock.entitlementsFor(mock.CUSTOMER_ACCOUNT_ID)!;
      return { accountId: rec.accountId, values: rec.values, catalog: mock.deviceCatalog };
    }
    return http<EntitlementsResponse>('/me/entitlements');
  },

  // -- device catalog --------------------------------------------------------

  /** GET /device-catalog → DeviceCatalogItem[]. */
  async deviceCatalog(): Promise<DeviceCatalogItem[]> {
    if (USE_MOCK) return mock.deviceCatalog;
    const res = await http<DeviceCatalogResponse>('/device-catalog');
    return res.items;
  },

  // -- crops -----------------------------------------------------------------

  /** GET /crops → CropRef[]. */
  async crops(): Promise<CropRef[]> {
    if (USE_MOCK) return mock.cropRefs;
    const res = await http<ListCropsResponse>('/crops');
    return res.crops;
  },

  /** GET /crops/:id → crop + stages. */
  async crop(cropId: string): Promise<CropWithStages> {
    if (USE_MOCK) {
      const c = getCrop(cropId);
      if (!c) throw new Error(`crop ${cropId} not found`);
      const ref = mock.cropRef(c);
      return {
        ...ref,
        stages: c.stages.map((s) => ({
          id: `${c.id}:${s.stage}`,
          cropId: c.id,
          stage: s.stage,
          ordinal: s.ordinal,
          startDay: s.startDay,
          ideal: s.ideal,
          acceptable: s.acceptable,
        })),
      };
    }
    return http<CropWithStages>(`/crops/${cropId}`);
  },

  // -- farms -----------------------------------------------------------------

  /** GET /farms → Farm[] (scoped to the signed-in customer). */
  async farms(): Promise<Farm[]> {
    if (USE_MOCK) return mock.farms;
    const res = await http<ListFarmsResponse>('/farms');
    return res.farms;
  },

  /** GET /farms/:id/gateway → the ESP32 brain bound to a farm (or null). */
  async gateway(farmId: string): Promise<Gateway | null> {
    if (USE_MOCK) return mock.gateways.find((g) => g.farmId === farmId) ?? mock.gateways[0] ?? null;
    return http<Gateway | null>(`/farms/${farmId}/gateway`);
  },

  /** GET /farms/:id/readings → newest reading per channel (soil + weather + flow). */
  async readings(farmId: string): Promise<FarmReading[]> {
    if (USE_MOCK) return [];
    const res = await http<FarmReadingsResponse>(`/farms/${farmId}/readings`);
    return res.readings;
  },

  // -- zones -----------------------------------------------------------------

  /** GET /farms/:id/zones → ZoneWithCrop[] (zone + its crop ref). */
  async zones(farmId: string): Promise<ZoneWithCrop[]> {
    if (USE_MOCK) {
      return mock.zones
        .filter((z) => z.farmId === farmId)
        .map((z) => ({ ...z, crop: z.cropId ? (mock.cropRefs.find((c) => c.id === z.cropId) ?? null) : null }));
    }
    const res = await http<ListZonesResponse>(`/farms/${farmId}/zones`);
    return res.zones;
  },

  /** POST /zones → create a new zone (server caps it at the zoneNodes entitlement). */
  async createZone(body: CreateZoneRequest): Promise<Zone> {
    if (USE_MOCK) {
      return {
        id: `zone_${Date.now()}`,
        farmId: body.farmId,
        name: body.name,
        cropId: body.cropId ?? null,
        plantingDate: body.plantingDate ?? null,
        areaM2: body.areaM2 ?? null,
        nodeId: null,
        mode: body.mode ?? 'auto',
        createdAt: new Date().toISOString(),
      } as Zone;
    }
    return http<CreateZoneResponse>('/zones', { method: 'POST', body: JSON.stringify(body) });
  },

  /** A single zone (derived client-side from the zones list / by id). */
  async zone(zoneId: string): Promise<ZoneWithCrop> {
    if (USE_MOCK) {
      const z = mock.zoneById(zoneId);
      if (!z) throw new Error(`zone ${zoneId} not found`);
      return { ...z, crop: z.cropId ? (mock.cropRefs.find((c) => c.id === z.cropId) ?? null) : null };
    }
    return http<ZoneWithCrop>(`/zones/${zoneId}`);
  },

  /** GET /zones/:id/analysis → ZoneAnalysis (+ zoneId, cropId, readings). */
  async zoneAnalysis(zoneId: string, locale: 'en' | 'ne' = 'en'): Promise<ZoneAnalysisResponse> {
    if (USE_MOCK) {
      const z = mock.zoneById(zoneId);
      const a = mock.analysis(zoneId, locale);
      return { ...a, zoneId, cropId: z?.cropId ?? '', readings: mock.readingsFor(zoneId) };
    }
    return http<ZoneAnalysisResponse>(`/zones/${zoneId}/analysis`);
  },

  /** POST /zones/:id/assign → { zone, channels, rule, analysis }. */
  async assignZone(zoneId: string, body: AssignZoneRequest): Promise<AssignZoneResponse> {
    if (USE_MOCK) return mock.assignZone(zoneId, body);
    return http<AssignZoneResponse>(`/zones/${zoneId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** PUT /zones/:id/mode equivalent — flips the zone's control mode. */
  async setZoneMode(zoneId: string, mode: 'auto' | 'manual'): Promise<Zone> {
    if (USE_MOCK) return mock.setZoneMode(zoneId, mode);
    // PATCH /zones/:id carries { mode } in the real API.
    return http<Zone>(`/zones/${zoneId}`, { method: 'PATCH', body: JSON.stringify({ mode }) });
  },

  // -- actuators -------------------------------------------------------------

  /** POST /actuators/:id/command — desired-vs-reported control. */
  async command(actuatorId: string, action: ActuatorAction, volumeMl?: number): Promise<ActuatorCommandResponse> {
    if (USE_MOCK) return mock.commandActuator(actuatorId, action);
    return http<ActuatorCommandResponse>(`/actuators/${actuatorId}/command`, {
      method: 'POST',
      body: JSON.stringify({ action, volumeMl }),
    });
  },

  /** Convenience: open/close a zone's valve (server resolves the valve actuator). */
  async setValve(zoneId: string, open: boolean): Promise<ActuatorCommandResponse> {
    if (USE_MOCK) return mock.commandActuator(mock.valveActuatorId(zoneId), open ? 'open' : 'close');
    return http<ActuatorCommandResponse>(`/zones/${zoneId}/valve`, {
      method: 'POST',
      body: JSON.stringify({ open }),
    });
  },

  /** Actuator snapshot for a farm (pump / dosing / per-zone valves). */
  async actuators(farmId?: string): Promise<Actuator[]> {
    if (USE_MOCK) return mock.getActuators();
    if (!farmId) return [];
    return http<Actuator[]>(`/farms/${farmId}/actuators`);
  },

  // -- rules -----------------------------------------------------------------

  /** GET /zones/:id/rules → Rule. */
  async rules(zoneId: string): Promise<Rule> {
    if (USE_MOCK) return mock.ruleFor(zoneId);
    return http<Rule>(`/rules/zones/${zoneId}`);
  },

  /** PUT /zones/:id/rules → Rule. */
  async setRule(zoneId: string, patch: UpdateRuleRequest): Promise<Rule> {
    if (USE_MOCK) {
      const r = { ...mock.ruleFor(zoneId), ...patch, source: 'manual' as const, updatedAt: new Date().toISOString() };
      return r;
    }
    return http<Rule>(`/rules/zones/${zoneId}`, { method: 'PUT', body: JSON.stringify(patch) });
  },

  // -- alerts ----------------------------------------------------------------

  /** GET /alerts → Alert[]. */
  async alerts(): Promise<Alert[]> {
    if (USE_MOCK) return [...mock.alerts].sort((a, b) => b.ts.localeCompare(a.ts));
    const res = await http<AlertsResponse>('/alerts');
    return res.alerts;
  },

  /** POST /alerts/:id/ack → Alert. */
  async ackAlert(id: string): Promise<AckAlertResponse> {
    if (USE_MOCK) {
      const a = mock.ackAlert(id);
      if (!a) throw new Error(`alert ${id} not found`);
      return a;
    }
    return http<AckAlertResponse>(`/alerts/${id}/ack`, { method: 'POST' });
  },

  // -- harvest ---------------------------------------------------------------

  /** GET /harvest → HarvestLog[]. */
  async harvest(query?: { zoneId?: string; farmId?: string }): Promise<HarvestLog[]> {
    if (USE_MOCK) {
      let logs = [...mock.harvestLog];
      if (query?.zoneId) logs = logs.filter((h) => h.zoneId === query.zoneId);
      return logs.sort((a, b) => b.harvestedAt.localeCompare(a.harvestedAt));
    }
    const res = await http<HarvestResponse>(`/harvest${qs({ zoneId: query?.zoneId, farmId: query?.farmId })}`);
    return res.logs;
  },

  /** POST /harvest → HarvestLog. */
  async addHarvest(body: CreateHarvestRequest): Promise<CreateHarvestResponse> {
    if (USE_MOCK) return mock.addHarvest(body);
    return http<CreateHarvestResponse>('/harvest', { method: 'POST', body: JSON.stringify(body) });
  },

  // -- analytics -------------------------------------------------------------

  /** GET /analytics/usage?farmId&agg → daily usage buckets. */
  async analyticsUsage(farmId: string, agg: TelemetryAgg = '1d'): Promise<UsageResponse> {
    if (USE_MOCK) return { farmId, agg, buckets: mock.usageBuckets(farmId) };
    return http<UsageResponse>(`/analytics/usage${qs({ farmId, agg })}`);
  },

  /** GET /analytics/savings?farmId → savings vs baseline. */
  async analyticsSavings(farmId: string): Promise<SavingsResponse> {
    if (USE_MOCK) return mock.savings(farmId);
    return http<SavingsResponse>(`/analytics/savings${qs({ farmId })}`);
  },

  /** GET /analytics/export?farmId&format=csv → CSV text (for share/download). */
  async analyticsExportCsv(farmId: string, from?: string, to?: string): Promise<string> {
    if (USE_MOCK) {
      const rows = [['date', 'zoneId', 'kind', 'total'], ...mock.usageBuckets(farmId).map((b) => [b.bucket, b.zoneId ?? '', b.kind, String(b.total)])];
      return rows.map((r) => r.join(',')).join('\n');
    }
    const res = await fetch(`${BASE}/analytics/export${qs({ farmId, from, to, format: 'csv' })}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (!res.ok) throw new Error(`API ${res.status} /analytics/export`);
    return res.text();
  },

  // -- telemetry -------------------------------------------------------------

  /** GET /zones/:id/telemetry?agg → raw samples or rollup buckets. */
  async telemetry(zoneId: string, agg: TelemetryAgg = 'raw'): Promise<TelemetryResponse> {
    if (USE_MOCK) {
      if (agg === 'raw') return { zoneId, agg, samples: mock.telemetryRaw(zoneId) };
      return { zoneId, agg, buckets: mock.telemetryBuckets(zoneId, agg) };
    }
    return http<TelemetryResponse>(`/zones/${zoneId}/telemetry${qs({ agg })}`);
  },
};

export { USE_MOCK, BASE };
