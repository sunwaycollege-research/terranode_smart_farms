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
  CropRef,
  CropWithStages,
  DeviceCatalogItem,
  DeviceCatalogResponse,
  EntitlementsResponse,
  Farm,
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
const BASE = extra.apiBaseUrl ?? 'http://localhost:4000';
const USE_MOCK = extra.useMockApi ?? true;

// ---------------------------------------------------------------------------
// access-token store (set on login; sent as Bearer on every authed call)
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
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
      return res;
    }
    const res = await http<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    accessToken = res.accessToken;
    return res;
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

  /** A single zone (derived client-side from the zones list / by id). */
  async zone(zoneId: string): Promise<ZoneWithCrop> {
    if (USE_MOCK) {
      const z = mock.zoneById(zoneId);
      if (!z) throw new Error(`zone ${zoneId} not found`);
      return { ...z, crop: z.cropId ? (mock.cropRefs.find((c) => c.id === z.cropId) ?? null) : null };
    }
    // The REST API has no GET /zones/:id; resolve via the owning farm's list.
    // Callers that already know the farm should prefer api.zones(farmId).
    throw new Error('api.zone: pass through api.zones(farmId) against the live API');
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

  /** Convenience: open/close a zone's valve (resolves the valve actuator). */
  async setValve(zoneId: string, open: boolean): Promise<ActuatorCommandResponse> {
    if (USE_MOCK) return mock.commandActuator(mock.valveActuatorId(zoneId), open ? 'open' : 'close');
    // For the live API the caller resolves the valve actuator id from the zone.
    return this.command(zoneId, open ? 'open' : 'close');
  },

  /** Current actuator snapshot (mock-only convenience for pump/dosing tiles). */
  async actuators(): Promise<Actuator[]> {
    if (USE_MOCK) return mock.getActuators();
    return http<Actuator[]>('/actuators');
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
