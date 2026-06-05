// Tolerant MQTT topic parsing.
//
// Topic shape (spec §5): teranode/{accountId}/{farmId}/{gatewayId}/{kind}/...
//   - telemetry/zone/{zoneId}   → per-zone soil telemetry
//   - telemetry/weather         → per-farm weather (also accept legacy `weather`)
//   - telemetry/gateway/health  → gateway health (also accept legacy `health`)
//   - state/...                 → actuator state report / LWT
//
// The parser is deliberately lenient: it returns whatever it can resolve and a
// normalized `kind` so the dispatcher can route. Unknown / malformed topics
// resolve to kind `unknown` rather than throwing.

import { MQTT_ROOT } from '@teranode/types';

export type IngestKind =
  | 'zone'
  | 'weather'
  | 'health'
  | 'state'
  | 'cmd'
  | 'unknown';

export interface ParsedTopic {
  kind: IngestKind;
  accountId?: string;
  farmId?: string;
  gatewayId?: string;
  /** Set for device-id-first topics `teranode/dev/{serial}/...`; resolved downstream. */
  serial?: string;
  zoneId?: string;
  /** The raw trailing segments after the kind marker (for diagnostics). */
  rest: string[];
  raw: string;
}

/**
 * Parse a TERANODE MQTT topic into its addressing parts + a normalized kind.
 *
 * Two address forms are accepted:
 *   - device-id-first (preferred): `teranode/dev/{serial}/{kind}/...`
 *       the device knows only its own serial; account/farm/gateway are resolved
 *       from the serial by the ingest worker.
 *   - explicit triple (legacy):    `teranode/{accountId}/{farmId}/{gatewayId}/{kind}/...`
 */
export function parseTopic(topic: string): ParsedTopic {
  const parts = topic.split('/').filter((s) => s.length > 0);
  const base: ParsedTopic = { kind: 'unknown', rest: [], raw: topic };

  if (parts[0] !== MQTT_ROOT) return base;

  let tail: string[];
  if (parts[1] === 'dev') {
    // teranode/dev/{serial}/{kind}/...
    if (parts.length < 4) return base;
    base.serial = parts[2];
    tail = parts.slice(3);
  } else {
    // teranode/{accountId}/{farmId}/{gatewayId}/{kind}/...
    if (parts.length < 5) return base;
    base.accountId = parts[1];
    base.farmId = parts[2];
    base.gatewayId = parts[3];
    tail = parts.slice(4);
  }
  base.rest = tail;

  const seg0 = tail[0];

  if (seg0 === 'telemetry') {
    const seg1 = tail[1];
    if (seg1 === 'zone') {
      return { ...base, kind: 'zone', zoneId: tail[2] };
    }
    if (seg1 === 'weather') {
      return { ...base, kind: 'weather' };
    }
    if (seg1 === 'gateway' && tail[2] === 'health') {
      return { ...base, kind: 'health' };
    }
    // teranode/.../telemetry  (bare) — treat as a zone tick if a zoneId is in payload.
    return { ...base, kind: 'zone', zoneId: tail[1] };
  }

  // Legacy / short forms the type helpers in @teranode/types emit.
  if (seg0 === 'weather') return { ...base, kind: 'weather' };
  if (seg0 === 'health') return { ...base, kind: 'health' };
  if (seg0 === 'state') return { ...base, kind: 'state' };
  if (seg0 === 'cmd') return { ...base, kind: 'cmd' };

  return base;
}

/** Best-effort JSON parse — returns null on any error. */
export function parseJson<T = unknown>(buf: Buffer | string): T | null {
  try {
    const text = typeof buf === 'string' ? buf : buf.toString('utf8');
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
