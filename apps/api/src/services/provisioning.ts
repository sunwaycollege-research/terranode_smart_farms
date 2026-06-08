// Device provisioning service (device-id-first auto-link).
//
// A flashed ESP32 knows only its own { serial, secret }. On first boot it calls
// POST /provision; we:
//   1. verify the secret against device_tokens (bcrypt),
//   2. if the device is still unsold (no account) → tell it to retry (pending),
//   3. if it is claimed to a customer but has no farm yet → auto-create a default
//      farm + zone + sensor_channels (from the device's reported capabilities),
//   4. mark it online and hand back its MQTT identity (serial-keyed topic prefix).
//
// After this, the device publishes to teranode/dev/{serial}/... and the ingest
// worker resolves serial → account/farm; the farmer's app surfaces it live with
// no manual pairing.

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type {
  ChannelType,
  DeviceCapabilities,
  ProvisionResponse,
  UUID,
} from '@teranode/types';
import { db, schema } from '../db/client';
import { HttpError } from '../middleware/error';

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const PROVISION_RETRY_SEC = 30;

// Which channels live on a zone vs. on the farm (weather mast), + their units.
const ZONE_CHANNELS: ChannelType[] = ['moisture', 'ph', 'ec', 'n', 'p', 'k', 'soiltemp'];
const FARM_CHANNELS: ChannelType[] = ['airtemp', 'humidity', 'pressure', 'rain', 'flow'];
const DEFAULT_CHANNELS: ChannelType[] = ['moisture', 'ph', 'ec', 'soiltemp'];
const UNIT: Record<ChannelType, string> = {
  moisture: '%',
  ph: 'pH',
  ec: 'mS/cm',
  n: 'mg/kg',
  p: 'mg/kg',
  k: 'mg/kg',
  soiltemp: '°C',
  airtemp: '°C',
  humidity: '%',
  pressure: 'hPa',
  rain: 'mm',
  flow: 'L/min',
};

export interface ProvisionArgs {
  serial: string;
  secret: string;
  fwVersion?: string;
  wifiSsid?: string;
  capabilities?: DeviceCapabilities;
}

/** Verify { serial, secret } against the gateway's device_tokens. */
async function authenticateDevice(serial: string, secret: string) {
  const gwRows = await db
    .select()
    .from(schema.gateways)
    .where(eq(schema.gateways.serial, serial))
    .limit(1);
  const gateway = gwRows[0];
  if (!gateway) throw new HttpError(404, 'unknown device');

  const tokenRows = await db
    .select()
    .from(schema.deviceTokens)
    .where(eq(schema.deviceTokens.gatewayId, gateway.id));
  const active = tokenRows.filter((t) => !t.revoked);
  if (active.length === 0) throw new HttpError(403, 'device token revoked');

  let ok = false;
  for (const t of active) {
    if (await bcrypt.compare(secret, t.secretHash)) {
      ok = true;
      break;
    }
  }
  if (!ok) throw new HttpError(401, 'invalid device secret');
  if (gateway.status === 'revoked') throw new HttpError(403, 'device is revoked');
  return gateway;
}

export async function provisionDevice(args: ProvisionArgs): Promise<ProvisionResponse> {
  const serial = args.serial.trim();
  if (!serial || !args.secret) throw new HttpError(400, 'serial and secret are required');

  const gateway = await authenticateDevice(serial, args.secret);

  // Not yet sold/linked → ask the device to wait and retry.
  if (!gateway.accountId) {
    return { status: 'pending', retryAfterSec: PROVISION_RETRY_SEC };
  }

  const accountId = gateway.accountId;
  let farmId = gateway.farmId ?? null;

  // First boot of a claimed device → auto-provision a starter farm + zone + channels.
  if (!farmId) {
    const accRows = await db
      .select({ name: schema.accounts.name })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    // Avoid awkward doubling like "Green Valley Farm Farm".
    const base = accRows[0]?.name?.trim() || 'My';
    const farmName = /\b(farm|farms|garden|orchard|estate)\b/i.test(base) ? base : `${base} Farm`;
    const caps = args.capabilities;
    const zoneTypes = pickChannels(caps?.channels, ZONE_CHANNELS);
    const farmTypes = pickChannels(caps?.channels, FARM_CHANNELS);

    farmId = await db.transaction(async (tx) => {
      const farmRows = await tx
        .insert(schema.farms)
        .values({ accountId, name: farmName })
        .returning();
      const farm = farmRows[0];

      const zoneRows = await tx
        .insert(schema.zones)
        .values({ farmId: farm.id, name: 'Zone 1', mode: 'auto' })
        .returning();
      const zone = zoneRows[0];

      const channelValues = [
        ...zoneTypes.map((type) => ({ zoneId: zone.id, type, unit: UNIT[type] })),
        ...farmTypes.map((type) => ({ farmId: farm.id, type, unit: UNIT[type] })),
      ];
      if (channelValues.length > 0) {
        await tx.insert(schema.sensorChannels).values(channelValues);
      }
      return farm.id;
    });
  }

  // Mark the device online + record boot metadata.
  await db
    .update(schema.gateways)
    .set({
      farmId,
      status: 'online',
      provisionedAt: gateway.provisionedAt ?? new Date(),
      lastSeen: new Date(),
      ...(args.fwVersion ? { fwVersion: args.fwVersion } : {}),
      ...(args.wifiSsid ? { wifiSsid: args.wifiSsid } : {}),
    })
    .where(eq(schema.gateways.id, gateway.id));

  return {
    status: 'linked',
    accountId,
    farmId: farmId as UUID,
    gatewayId: gateway.id,
    mqttUrl: MQTT_URL,
    mqttUsername: serial,
    topicPrefix: `teranode/dev/${serial}`,
  };
}

/** Keep only the requested channels that belong to the given bucket; sensible default. */
function pickChannels(
  requested: ChannelType[] | undefined,
  bucket: ChannelType[],
): ChannelType[] {
  if (!requested || requested.length === 0) {
    return bucket.filter((c) => DEFAULT_CHANNELS.includes(c));
  }
  return bucket.filter((c) => requested.includes(c));
}
