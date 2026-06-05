/**
 * TERANODE domain models (client-side mirror of the backend schema).
 * See DEVELOPMENT-PLAN.md §3 for the reconciled multi-tier data model.
 */

/** The account tree: company → retailer → farmer. */
export type AccountType = 'company' | 'retailer' | 'farmer';

export type Role =
  | 'company_admin' // us (the platform)
  | 'retailer_admin' // reseller who sells hardware + creates farmers
  | 'farmer_admin' // end customer, owns the farm
  | 'farmer_operator' // farm staff
  | 'farmer_viewer'; // read-only

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  parentId: string | null; // company has null; retailer→company; farmer→retailer
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface User {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: Role;
}

export interface Farm {
  id: string;
  accountId: string; // belongs to a farmer account
  name: string;
  timezone: string;
  gateway: Gateway;
}

export interface Gateway {
  id: string;
  serial: string;
  compute: 'esp32' | 'rpi4';
  online: boolean;
  fwVersion: string;
  lastSeen: string;
}

export interface Zone {
  id: string;
  farmId: string;
  name: string;
  crop: string;
  emoji: string;
  // live readings
  moisture: number; // %
  ph: number;
  ec: number;
  n: number;
  p: number;
  k: number;
  soilTemp: number; // °C
  // control
  low: number; // moisture low threshold
  high: number; // moisture high threshold
  valveOpen: boolean;
  mode: 'auto' | 'manual';
  reason: string; // why the gateway is/ isn't watering
}

export interface Weather {
  airTemp: number;
  humidity: number;
  pressure: number;
  rain1h: number;
  icon: '☀️' | '⛅' | '🌧️' | '🌩️';
}

export interface FarmSystems {
  pumpOn: boolean;
  dosingOn: boolean;
  reservoirLevel: number; // %  (only meaningful if reservoirMonitoring entitlement on)
  flowLpm: number; // L/min (only if flowMeter on)
}

export type AlertSeverity = 'info' | 'warn' | 'critical';
export interface Alert {
  id: string;
  farmId: string;
  severity: AlertSeverity;
  type: string;
  message: string;
  ts: string;
  acknowledgedAt: string | null;
}
