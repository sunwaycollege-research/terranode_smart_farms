// @teranode/types — request/response DTOs for every endpoint in spec §5.
// Grouped by route family. Request bodies are suffixed `Request`; responses
// `Response`. Shared sub-shapes are exported too so clients + server agree.

import type {
  AccountStatus,
  AccountType,
  ActuatorType,
  AlertSeverity,
  ChannelType,
  ComputeKind,
  ControlMode,
  GatewayStatus,
  UserRole,
} from './enums';
import type {
  Account,
  Actuator,
  Alert,
  AuditEntry,
  CropRef,
  CropStageRow,
  DeviceCatalogItem,
  DosingPump,
  DosingProfile,
  Entitlements,
  EntitlementRecord,
  Farm,
  Gateway,
  HarvestLog,
  ISODate,
  ISODateTime,
  Node,
  PublicUser,
  Rule,
  Schedule,
  SensorChannel,
  TelemetryBucket,
  TelemetrySample,
  UsageBucket,
  UUID,
  Zone,
} from './entities';
import type {
  ChannelReadings,
  CropBand,
  CropCategory,
  GrowthStage,
  ZoneAnalysis,
} from './agronomy';

// --- generic envelopes --------------------------------------------------------

/** Standard error body. */
export interface ApiError {
  error: string;
  details?: unknown;
}

/** A bare `{ ok: true }` acknowledgement. */
export interface OkResponse {
  ok: true;
}

// --- auth & identity ----------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  /**
   * Refresh token in the response body — present only for non-browser (mobile)
   * clients. Browser clients receive it as an httpOnly cookie instead, so it is
   * absent here for them.
   */
  refreshToken?: string;
  /**
   * CSRF token (stateless double-submit, bound to the refresh token) returned to
   * browser clients; the browser echoes it back as the `X-CSRF-Token` header on
   * /auth/refresh and /auth/logout.
   */
  csrfToken?: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface LoginResponse extends AuthTokens {
  user: PublicUser;
  account: Account;
}

export interface RefreshRequest {
  /** Mobile/non-browser clients pass the refresh token here; browsers use the cookie. */
  refreshToken?: string;
}

export type RefreshResponse = AuthTokens;

export interface LogoutRequest {
  refreshToken: string;
}

export type LogoutResponse = OkResponse;

/** Claims carried inside the JWT access token. */
export interface JwtClaims {
  userId: UUID;
  accountId: UUID;
  accountType: AccountType;
  role: UserRole;
  /** issued-at / expiry (seconds) — present on decoded tokens. */
  iat?: number;
  exp?: number;
}

/** GET /me */
export interface MeResponse {
  user: PublicUser;
  account: Account;
}

/** GET /me/entitlements */
export interface EntitlementsResponse {
  accountId: UUID;
  values: Entitlements;
  /** The catalog, so clients can render labels/categories without a 2nd call. */
  catalog: DeviceCatalogItem[];
}

// --- admin: customers ---------------------------------------------------------

/** A customer with its entitlement record (admin list/detail rows). */
export interface CustomerWithEntitlements {
  account: Account;
  entitlements: Entitlements;
  /** First/primary user of the customer account, if any. */
  user: PublicUser | null;
}

/** GET /admin/customers */
export interface ListCustomersResponse {
  customers: CustomerWithEntitlements[];
}

/** POST /admin/customers */
export interface CreateCustomerRequest {
  name: string;
  /** The customer's primary user. */
  userEmail: string;
  userName: string;
  password: string;
  plan?: string;
  locale?: string;
  /** Optional initial entitlements (defaults applied from catalog otherwise). */
  entitlements?: Entitlements;
}

export interface CreateCustomerResponse {
  account: Account;
  user: PublicUser;
  entitlements: Entitlements;
}

/** GET /admin/customers/:id */
export type GetCustomerResponse = CustomerWithEntitlements;

/** PATCH /admin/customers/:id */
export interface UpdateCustomerRequest {
  name?: string;
  status?: AccountStatus;
  plan?: string;
  locale?: string;
}

export type UpdateCustomerResponse = Account;

/** PATCH /admin/customers/:id/entitlements */
export interface UpdateEntitlementsRequest {
  values: Entitlements;
}

export type UpdateEntitlementsResponse = EntitlementRecord;

// --- admin: fleet & gateways --------------------------------------------------

/** One row of the admin fleet view. */
export interface FleetGateway {
  gateway: Gateway;
  farm: Farm | null;
  account: Account | null;
  nodes: Node[];
}

/** GET /admin/fleet */
export interface FleetResponse {
  gateways: FleetGateway[];
  summary: {
    total: number;
    online: number;
    offline: number;
    claimed: number; // linked to a customer, awaiting first boot
    unbound: number; // in stock (registered, not yet sold) + revoked
  };
}

/** POST /admin/gateways — register a new serial → returns a one-time device token. */
export interface RegisterGatewayRequest {
  serial: string;
  compute?: ComputeKind;
  model?: string;
}

export interface RegisterGatewayResponse {
  gateway: Gateway;
  /** Plaintext device token, shown once — this is flashed onto the device. */
  deviceToken: string;
}

/** POST /admin/devices/:serial/claim — link an in-stock device to a customer at purchase. */
export interface ClaimDeviceRequest {
  accountId: UUID;
}

export type ClaimDeviceResponse = Gateway;

/** A farm plus its owning customer account (admin cross-tenant view). */
export interface AdminFarm {
  farm: Farm;
  account: Account | null;
}

/** GET /admin/farms — every farm across all customers (for admin pickers). */
export interface AdminFarmsResponse {
  farms: AdminFarm[];
}

/** POST /admin/gateways/:id/bind — attach a gateway to a farm/account. */
export interface BindGatewayRequest {
  farmId: UUID;
  /** Defaults to the farm's owning account when omitted. */
  accountId?: UUID;
}

export type BindGatewayResponse = Gateway;

/** POST /admin/gateways/:id/ota — push a firmware version. */
export interface OtaRequest {
  fwVersion: string;
}

export interface OtaResponse {
  gateway: Gateway;
  accepted: boolean;
}

// --- device provisioning (device-facing, authenticated by serial + secret) ----

/** What a device reports it physically has, used to auto-create sensor channels. */
export interface DeviceCapabilities {
  channels: ChannelType[]; // sensor channels present on this brain
  zones?: number; // how many zones it can drive (default 1)
  pump?: boolean; // has a main pump
  dosing?: boolean; // has fertigation dosing
}

/** POST /provision — the device "phones home" with its baked-in identity. */
export interface ProvisionRequest {
  serial: string;
  secret: string;
  fwVersion?: string;
  wifiSsid?: string;
  capabilities?: DeviceCapabilities;
}

/** Returned once the device is claimed + auto-linked; carries its MQTT identity. */
export interface ProvisionLinkedResponse {
  status: 'linked';
  accountId: UUID;
  farmId: UUID;
  gatewayId: UUID;
  mqttUrl: string;
  mqttUsername: string; // = serial
  topicPrefix: string; // e.g. 'teranode/dev/{serial}'
}

/** Returned when the device is valid but not yet sold/linked — it should retry. */
export interface ProvisionPendingResponse {
  status: 'pending';
  retryAfterSec: number;
}

export type ProvisionResponse = ProvisionLinkedResponse | ProvisionPendingResponse;

/** GET /admin/audit */
export interface AuditQuery {
  accountId?: UUID;
  actorId?: UUID;
  from?: ISODateTime;
  to?: ISODateTime;
  limit?: number;
}

export interface AuditResponse {
  entries: AuditEntry[];
}

/** GET /device-catalog */
export interface DeviceCatalogResponse {
  items: DeviceCatalogItem[];
}

// --- crops --------------------------------------------------------------------

/** A crop with its stage rows (the API shape for GET /crops/:id). */
export interface CropWithStages extends CropRef {
  stages: CropStageRow[];
}

/** GET /crops */
export interface ListCropsResponse {
  crops: CropRef[];
}

/** GET /crops/:id */
export type GetCropResponse = CropWithStages;

/** Editable crop fields (POST /crops, PATCH /crops/:id). */
export interface CropInput {
  id?: string;
  nameEn: string;
  nameNe: string;
  emoji: string;
  category: CropCategory;
  daysToHarvest: number;
  wateringNotesEn?: string;
  wateringNotesNe?: string;
  ideal: CropBand;
  acceptable: CropBand;
}

export type CreateCropRequest = CropInput & { id: string };
export type CreateCropResponse = CropRef;

export type UpdateCropRequest = Partial<CropInput>;
export type UpdateCropResponse = CropRef;

/** One stage in a PATCH /crops/:id/stages payload. */
export interface CropStageInput {
  stage: GrowthStage;
  ordinal: number;
  startDay: number;
  ideal: CropBand;
  acceptable: CropBand;
}

/** PATCH /crops/:id/stages — replaces the crop's stage set. */
export interface UpdateCropStagesRequest {
  stages: CropStageInput[];
}

export interface UpdateCropStagesResponse {
  cropId: string;
  stages: CropStageRow[];
}

// --- farms --------------------------------------------------------------------

/** GET /farms */
export interface ListFarmsResponse {
  farms: Farm[];
}

/** POST /farms */
export interface CreateFarmRequest {
  name: string;
  timezone?: string;
  geo?: Record<string, unknown>;
  /** Admin-only: create on behalf of a customer account. */
  accountId?: UUID;
}

export type CreateFarmResponse = Farm;

/** GET /farms/:id */
export type GetFarmResponse = Farm;

/** PATCH /farms/:id */
export interface UpdateFarmRequest {
  name?: string;
  timezone?: string;
  geo?: Record<string, unknown>;
}

export type UpdateFarmResponse = Farm;

/** DELETE /farms/:id */
export type DeleteFarmResponse = OkResponse;

// --- zones --------------------------------------------------------------------

/** A zone enriched with its crop ref + latest analysis (used by the dashboard). */
export interface ZoneWithCrop extends Zone {
  crop: CropRef | null;
}

/** GET /farms/:id/zones */
export interface ListZonesResponse {
  zones: ZoneWithCrop[];
}

/** POST /zones */
export interface CreateZoneRequest {
  farmId: UUID;
  name: string;
  cropId?: string;
  plantingDate?: ISODate;
  areaM2?: number;
  nodeId?: UUID;
  mode?: ControlMode;
}

export type CreateZoneResponse = Zone;

/** PATCH /zones/:id */
export interface UpdateZoneRequest {
  name?: string;
  areaM2?: number;
  nodeId?: UUID | null;
  mode?: ControlMode;
}

export type UpdateZoneResponse = Zone;

/** DELETE /zones/:id */
export type DeleteZoneResponse = OkResponse;

/** A sensor channel to create when assigning a crop to a zone. */
export interface ZoneChannelInput {
  type: SensorChannel['type'];
  unit: string;
  enabled?: boolean;
  calibration?: Record<string, unknown>;
}

/** POST /zones/:id/assign — assigns a crop and auto-applies the crop rule. */
export interface AssignZoneRequest {
  cropId: string;
  plantingDate: ISODate;
  nodeId?: UUID;
  channels?: ZoneChannelInput[];
}

export interface AssignZoneResponse {
  zone: Zone;
  channels: SensorChannel[];
  rule: Rule;
  analysis: ZoneAnalysis;
}

/** GET /zones/:id/analysis */
export interface ZoneAnalysisResponse extends ZoneAnalysis {
  zoneId: UUID;
  cropId: string;
  /** Echo of the readings used (engine channel keys). */
  readings: ChannelReadings;
}

/** Telemetry aggregation granularity. */
export type TelemetryAgg = 'raw' | '5m' | '1h' | '1d';

/** GET /zones/:id/telemetry?from&to&agg */
export interface TelemetryQuery {
  from?: ISODateTime;
  to?: ISODateTime;
  agg?: TelemetryAgg;
}

export interface TelemetryResponse {
  zoneId: UUID;
  agg: TelemetryAgg;
  /** Present when agg=raw. */
  samples?: TelemetrySample[];
  /** Present when agg=5m|1h|1d. */
  buckets?: TelemetryBucket[];
}

/** The latest value for one sensor channel on a farm (zone- or farm-level). */
export interface FarmReading {
  channelId: UUID;
  type: ChannelType;
  zoneId: UUID | null; // null = farm-level channel (weather mast / flow meter)
  unit: string | null;
  value: number;
  ts: string;
}

/** GET /farms/:id/readings — newest reading per channel across the whole farm. */
export interface FarmReadingsResponse {
  farmId: UUID;
  readings: FarmReading[];
}

// --- rules, schedules, dosing -------------------------------------------------

/** GET /zones/:id/rules */
export type GetRuleResponse = Rule;

/** PUT /zones/:id/rules */
export interface UpdateRuleRequest {
  moistureLow?: number;
  moistureHigh?: number;
  rainSkipMm?: number;
  phTarget?: number | null;
  ecTarget?: number | null;
}

export type UpdateRuleResponse = Rule;

/** GET /farms/:id/schedules */
export interface ListSchedulesResponse {
  schedules: Schedule[];
}

/** PUT /schedules/:id */
export interface UpdateScheduleRequest {
  windowStartHour?: number;
  windowEndHour?: number;
  et0Aware?: boolean;
  maxRunMin?: number;
  enabled?: boolean;
}

export type UpdateScheduleResponse = Schedule;

/** GET /farms/:id/dosing-profile */
export type GetDosingProfileResponse = DosingProfile;

/** PUT /farms/:id/dosing-profile */
export interface UpdateDosingProfileRequest {
  ecTarget?: number;
  phTarget?: number;
  pumps?: DosingPump[];
}

export type UpdateDosingProfileResponse = DosingProfile;

// --- actuators ----------------------------------------------------------------

export type ActuatorAction = 'open' | 'close' | 'on' | 'off' | 'dose';

/** POST /actuators/:id/command — desired-vs-reported control. */
export interface ActuatorCommandRequest {
  action: ActuatorAction;
  /** Optional dose volume in mL when action=dose. */
  volumeMl?: number;
}

export interface ActuatorCommandResponse {
  actuator: Actuator;
  /** True while the desired state has not yet been confirmed by the device. */
  pending: boolean;
}

// --- alerts -------------------------------------------------------------------

/** GET /alerts */
export interface AlertsQuery {
  farmId?: UUID;
  zoneId?: UUID;
  severity?: AlertSeverity;
  acknowledged?: boolean;
  limit?: number;
}

export interface AlertsResponse {
  alerts: Alert[];
}

/** POST /alerts/:id/ack */
export type AckAlertResponse = Alert;

// --- harvest ------------------------------------------------------------------

/** GET /harvest */
export interface HarvestQuery {
  zoneId?: UUID;
  farmId?: UUID;
  from?: ISODate;
  to?: ISODate;
}

export interface HarvestResponse {
  logs: HarvestLog[];
}

/** POST /harvest */
export interface CreateHarvestRequest {
  zoneId: UUID;
  cropId?: string;
  harvestedAt: ISODate;
  yieldKg?: number;
  notes?: string;
}

export type CreateHarvestResponse = HarvestLog;

// --- analytics ----------------------------------------------------------------

/** GET /analytics/usage?farmId&from&to&agg */
export interface UsageQuery {
  farmId: UUID;
  /** Admin only: target customer account whose farm to read (scopeToCustomer). */
  accountId?: UUID;
  from?: ISODateTime;
  to?: ISODateTime;
  agg?: TelemetryAgg;
}

export interface UsageResponse {
  farmId: UUID;
  agg: TelemetryAgg;
  buckets: UsageBucket[];
}

/** GET /analytics/savings?farmId&from&to */
export interface SavingsQuery {
  farmId: UUID;
  /** Admin only: target customer account whose farm to read (scopeToCustomer). */
  accountId?: UUID;
  from?: ISODateTime;
  to?: ISODateTime;
}

export interface SavingsResponse {
  farmId: UUID;
  /** Liters of water actually used in the window. */
  waterUsedL: number;
  /** Liters a fixed-schedule baseline would have used. */
  baselineL: number;
  /** Absolute liters saved (baseline − used). */
  savedL: number;
  /** Saved as a 0–100 percentage. */
  savedPct: number;
}

/** GET /analytics/export?farmId&from&to&format=csv */
export interface ExportQuery {
  farmId: UUID;
  /** Admin only: target customer account whose farm to read (scopeToCustomer). */
  accountId?: UUID;
  from?: ISODateTime;
  to?: ISODateTime;
  format?: 'csv';
}

/** The export endpoint streams CSV text; this documents that contract. */
export interface ExportResponse {
  /** `text/csv` body. */
  csv: string;
}
