// @teranode/types — the canonical device-catalog seed (9 modules, spec §2).
// The DB `device_catalog` table is seeded from this list; clients render
// entitlement editors from it. Categories: sensing/actuation/platform.

import type { DeviceCatalogItem } from './entities';

export const DEVICE_CATALOG: readonly DeviceCatalogItem[] = [
  {
    key: 'zoneNodes',
    label: 'Zone Nodes',
    category: 'sensing',
    kind: 'count',
    defaultValue: 3,
    hint: 'Number of wireless sensor nodes (one per zone).',
    gatesDashboard: false,
  },
  {
    key: 'mainPump',
    label: 'Main Pump',
    category: 'actuation',
    kind: 'toggle',
    defaultValue: true,
    hint: 'Primary irrigation pump control.',
    gatesDashboard: false,
  },
  {
    key: 'fertigation',
    label: 'Fertigation',
    category: 'actuation',
    kind: 'toggle',
    defaultValue: true,
    hint: 'EC/pH dosing pumps for nutrient injection.',
    gatesDashboard: false,
  },
  {
    key: 'weatherMast',
    label: 'Weather Mast',
    category: 'sensing',
    kind: 'toggle',
    defaultValue: true,
    hint: 'Air temp / humidity / pressure / rain station.',
    gatesDashboard: false,
  },
  {
    key: 'reservoirMonitoring',
    label: 'Reservoir Monitoring',
    category: 'sensing',
    kind: 'toggle',
    defaultValue: false,
    hint: 'Tank level sensing.',
    gatesDashboard: false,
  },
  {
    key: 'flowMeter',
    label: 'Flow Meter',
    category: 'sensing',
    kind: 'toggle',
    defaultValue: false,
    hint: 'Inline flow metering for accurate water usage.',
    gatesDashboard: false,
  },
  {
    key: 'otaManaged',
    label: 'OTA Managed',
    category: 'platform',
    kind: 'toggle',
    defaultValue: true,
    hint: 'Over-the-air firmware updates managed by TERANODE.',
    gatesDashboard: false,
  },
  {
    key: 'mobileApp',
    label: 'Mobile App',
    category: 'platform',
    kind: 'toggle',
    defaultValue: true,
    hint: 'Customer mobile app access.',
    gatesDashboard: true,
  },
  {
    key: 'analytics',
    label: 'Analytics',
    category: 'platform',
    kind: 'toggle',
    defaultValue: false,
    hint: 'Usage trends, savings, and harvest analytics.',
    gatesDashboard: true,
  },
];

/** Lookup map by catalog key. */
export const DEVICE_CATALOG_BY_KEY: Readonly<Record<string, DeviceCatalogItem>> =
  Object.fromEntries(DEVICE_CATALOG.map((d) => [d.key, d]));

/** The default entitlement values built from the catalog. */
export function defaultEntitlements(): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const item of DEVICE_CATALOG) out[item.key] = item.defaultValue;
  return out;
}
