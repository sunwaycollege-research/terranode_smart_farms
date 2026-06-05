import type { ReactNode } from 'react';
import type { AccountStatus, AlertSeverity, GatewayStatus } from '@teranode/types';

export type BadgeTone =
  | 'neutral'
  | 'healthy'
  | 'watering'
  | 'warn'
  | 'critical'
  | 'offline'
  | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  healthy: 'tn-badge--healthy',
  watering: 'tn-badge--watering',
  warn: 'tn-badge--warn',
  critical: 'tn-badge--critical',
  offline: 'tn-badge--offline',
  accent: 'tn-badge--accent',
};

export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span className={['tn-badge', TONE_CLASS[tone]].filter(Boolean).join(' ')}>
      {dot && <span className="tn-badge__dot" />}
      {children}
    </span>
  );
}

// --- domain-specific badge helpers (reused across admin pages) ----------------

export function gatewayStatusTone(status: GatewayStatus): BadgeTone {
  if (status === 'online') return 'healthy';
  if (status === 'offline') return 'critical';
  if (status === 'claimed') return 'watering'; // linked to a customer, awaiting first boot
  if (status === 'revoked') return 'warn';
  return 'offline'; // unbound / in-stock
}

/** Human-friendly device lifecycle label for a gateway status. */
export function deviceStatusLabel(status: GatewayStatus): string {
  if (status === 'unbound') return 'In stock';
  if (status === 'claimed') return 'Claimed';
  if (status === 'online') return 'Online';
  if (status === 'offline') return 'Offline';
  if (status === 'revoked') return 'Revoked';
  return status;
}

export function accountStatusTone(status: AccountStatus): BadgeTone {
  return status === 'active' ? 'healthy' : 'offline';
}

export function severityTone(severity: AlertSeverity): BadgeTone {
  if (severity === 'critical') return 'critical';
  if (severity === 'warn') return 'warn';
  return 'watering';
}
