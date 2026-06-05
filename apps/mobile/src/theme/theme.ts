import { colors } from './tokens';

/** Map a soil-moisture % against a zone's low/high band to a signal color. */
export function moistureColor(m: number, low: number, high: number): string {
  if (m < low) return colors.dry; // too dry → wants water
  if (m > high) return colors.watering; // saturated
  return colors.healthy; // in band
}

/** Generic status → color. */
export type Status = 'online' | 'offline' | 'healthy' | 'warn' | 'critical' | 'watering' | 'idle';

export function statusColor(s: Status): string {
  switch (s) {
    case 'online':
    case 'healthy':
      return colors.healthy;
    case 'watering':
      return colors.watering;
    case 'warn':
      return colors.warn;
    case 'critical':
      return colors.critical;
    case 'offline':
    case 'idle':
    default:
      return colors.offline;
  }
}

export { colors } from './tokens';
export { radius, spacing, fonts, elevation } from './tokens';
