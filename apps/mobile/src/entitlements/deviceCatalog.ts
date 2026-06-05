/**
 * MODULAR DEVICE CATALOG
 * ----------------------
 * "Under IoT we can have reservoir-measuring devices, valve devices, multiple…
 *  this should be modular and dynamic."  — that requirement lives here.
 *
 * Each capability is data-driven: the retailer (at farmer-creation time) toggles
 * which device classes / features a farmer gets. Adding a new device class is a
 * data change (append to this catalog + a column/flag), NOT a UI rewrite — every
 * screen renders modules by iterating entitlements, never hard-coding them.
 *
 * In production this catalog is served by the backend (GET /catalog/device-types)
 * so the company can publish new device classes over the air.
 */

export type EntitlementKey =
  | 'zoneNodes' // per-zone sensor + valve nodes (numeric: how many zones)
  | 'mainPump'
  | 'fertigation' // dosing pumps (nutrient A/B + pH-down)
  | 'weatherMast' // air temp / humidity / pressure / rain
  | 'reservoirMonitoring' // water-level / reservoir measuring device
  | 'flowMeter' // YF-S201 flow feedback + leak detection
  | 'otaManaged' // company pushes firmware
  | 'mobileApp' // farmer gets the React Native app
  | 'analytics'; // edge analytics / ML (RPi gateway only)

export type EntitlementKind = 'toggle' | 'count';

export interface DeviceClass {
  key: EntitlementKey;
  label: string;
  emoji: string;
  category: 'sensing' | 'actuation' | 'platform';
  kind: EntitlementKind;
  /** for count types */
  min?: number;
  max?: number;
  default: number | boolean;
  /** short helper shown next to the toggle in the create-customer form */
  hint: string;
  /** if true, this module hides/shows whole sections of the farmer dashboard */
  gatesDashboard?: boolean;
}

export const DEVICE_CATALOG: DeviceClass[] = [
  {
    key: 'zoneNodes',
    label: 'Zone nodes',
    emoji: '🌱',
    category: 'sensing',
    kind: 'count',
    min: 1,
    max: 32,
    default: 3,
    hint: 'Per-zone moisture / NPK / pH + that zone’s valve.',
    gatesDashboard: true,
  },
  {
    key: 'mainPump',
    label: 'Main pump + reservoir',
    emoji: '💧',
    category: 'actuation',
    kind: 'toggle',
    default: true,
    hint: 'Central water delivery for the farm.',
    gatesDashboard: true,
  },
  {
    key: 'fertigation',
    label: 'Fertigation (dosing)',
    emoji: '🧪',
    category: 'actuation',
    kind: 'toggle',
    default: true,
    hint: 'Auto nutrient + pH dosing at the manifold.',
    gatesDashboard: true,
  },
  {
    key: 'weatherMast',
    label: 'Weather mast',
    emoji: '🛰️',
    category: 'sensing',
    kind: 'toggle',
    default: true,
    hint: 'Air temp, humidity, pressure, rainfall.',
    gatesDashboard: true,
  },
  {
    key: 'reservoirMonitoring',
    label: 'Reservoir monitoring',
    emoji: '🪣',
    category: 'sensing',
    kind: 'toggle',
    default: false,
    hint: 'Water-level / reservoir measuring device.',
    gatesDashboard: true,
  },
  {
    key: 'flowMeter',
    label: 'Flow meter + leak detect',
    emoji: '🌊',
    category: 'sensing',
    kind: 'toggle',
    default: false,
    hint: 'Valve-open-no-flow alerts; leak detection.',
    gatesDashboard: true,
  },
  {
    key: 'otaManaged',
    label: 'OTA firmware',
    emoji: '⬆️',
    category: 'platform',
    kind: 'toggle',
    default: true,
    hint: 'Company can push firmware updates remotely.',
  },
  {
    key: 'mobileApp',
    label: 'Mobile app access',
    emoji: '📱',
    category: 'platform',
    kind: 'toggle',
    default: true,
    hint: 'Farmer can log in to this app.',
  },
  {
    key: 'analytics',
    label: 'Edge analytics (RPi)',
    emoji: '📈',
    category: 'platform',
    kind: 'toggle',
    default: false,
    hint: 'Local ML / analytics — requires Raspberry Pi gateway.',
  },
];

export function deviceClass(key: EntitlementKey): DeviceClass {
  return DEVICE_CATALOG.find((d) => d.key === key)!;
}
