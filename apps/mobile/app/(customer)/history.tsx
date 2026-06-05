import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card, CardTitle, EmptyState, Screen, Segmented, T } from '../../src/components/ui';
import { Sparkline } from '../../src/components/Charts';
import { api } from '../../src/api/client';
import { useT, type TranslationKey } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import { getCrop, type Channel } from '@teranode/agronomy';
import type { TelemetryAgg, TelemetryBucket, ZoneWithCrop } from '@teranode/types';

// ---------------------------------------------------------------------------
// History — rollup sparklines from api.telemetry(zoneId, "1h"|"1d") with a zone
// + channel picker. One sparkline per channel (moisture/pH/EC/soil-temp), each
// showing the bucket average trace plus its min/max range over the window.
// ---------------------------------------------------------------------------

/** Channels the rollups carry, in display order, with a token color + label key. */
const CHANNELS: { ch: Channel; channelType: string; color: string; tx: TranslationKey; unit: string }[] = [
  { ch: 'moisture', channelType: 'moisture', color: colors.watering, tx: 'zone.moisture', unit: '%' },
  { ch: 'ph', channelType: 'ph', color: colors.accent, tx: 'zone.ph', unit: 'pH' },
  { ch: 'ec', channelType: 'ec', color: colors.primary, tx: 'zone.ec', unit: 'mS/cm' },
  { ch: 'soilTemp', channelType: 'soiltemp', color: colors.dry, tx: 'zone.soilTemp', unit: '°C' },
];

const RANGES: TelemetryAgg[] = ['1h', '1d'];

export default function History() {
  const { t, lang } = useT();
  const { fs } = useScale();

  const [zones, setZones] = useState<ZoneWithCrop[]>([]);
  const [zoneId, setZoneId] = useState<string>('');
  const [agg, setAgg] = useState<TelemetryAgg>('1h');
  const [buckets, setBuckets] = useState<TelemetryBucket[]>([]);

  // load the farm's zones once.
  useEffect(() => {
    (async () => {
      const farms = await api.farms();
      if (!farms[0]) return;
      const zs = await api.zones(farms[0].id);
      setZones(zs);
      if (zs[0]) setZoneId(zs[0].id);
    })();
  }, []);

  const pull = useCallback(async () => {
    if (!zoneId) return;
    const res = await api.telemetry(zoneId, agg);
    setBuckets(res.buckets ?? []);
  }, [zoneId, agg]);

  // refresh on selection change + on a gentle interval (virtual gateway is live).
  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), 4000);
    return () => clearInterval(id);
  }, [pull]);

  const activeZone = zones.find((z) => z.id === zoneId);
  const cropLabel = activeZone?.crop
    ? `${activeZone.crop.emoji} ${lang === 'ne' ? activeZone.crop.nameNe : activeZone.crop.nameEn}`
    : '';

  // group buckets per channel, sorted by time, for the sparklines.
  const seriesByChannel = useMemo(() => {
    const out: Record<string, { avg: number[]; min: number; max: number; last: number }> = {};
    for (const def of CHANNELS) {
      const chanId = `chan_${zoneId}_${def.channelType}`;
      const rows = buckets
        .filter((b) => b.channelId === chanId)
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
      if (!rows.length) continue;
      out[def.ch] = {
        avg: rows.map((r) => r.avg),
        min: Math.min(...rows.map((r) => r.min)),
        max: Math.max(...rows.map((r) => r.max)),
        last: rows[rows.length - 1].avg,
      };
    }
    return out;
  }, [buckets, zoneId]);

  const hasAny = Object.keys(seriesByChannel).length > 0;

  return (
    <Screen>
      <T variant="display" tx="history.title" />
      <T variant="muted">
        {t('history.title')} · {t('history.range')} — TimescaleDB rollups (avg/min/max per bucket).
      </T>

      {/* -- zone picker --------------------------------------------------- */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {zones.map((z) => {
          const active = z.id === zoneId;
          return (
            <Pressable
              key={z.id}
              onPress={() => setZoneId(z.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primarySoft : colors.surface,
              }}
            >
              <T style={{ fontFamily: fonts.uiMedium, fontSize: fs(12), color: active ? colors.primaryInk : colors.muted }}>
                {z.crop ? `${z.crop.emoji} ` : ''}
                {z.name}
              </T>
            </Pressable>
          );
        })}
      </View>

      {/* -- range picker -------------------------------------------------- */}
      <View>
        <T variant="label" tx="history.range" style={{ marginBottom: 6 }} />
        <Segmented options={RANGES} value={agg} onChange={setAgg} labels={{ '1h': '1H', '1d': '1D' } as Record<TelemetryAgg, string>} />
      </View>

      {cropLabel ? <T variant="muted">{cropLabel}</T> : null}

      {/* -- one sparkline card per channel -------------------------------- */}
      {!hasAny ? (
        <EmptyState icon="📈" tx="analytics.noData" />
      ) : (
        CHANNELS.map((def) => {
          const s = seriesByChannel[def.ch];
          if (!s) return null;
          const fmt = (v: number) => (def.ch === 'moisture' ? Math.round(v) : Math.round(v * 100) / 100);
          return (
            <Card key={def.ch}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <CardTitle tx={def.tx} />
                <View style={{ flex: 1 }} />
                <T style={{ fontFamily: fonts.mono, fontSize: fs(18), color: def.color }}>
                  {fmt(s.last)}
                  <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: colors.subtle }}> {def.unit}</T>
                </T>
              </View>
              <Sparkline values={s.avg} width={300} height={70} color={def.color} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <T style={{ fontFamily: fonts.mono, fontSize: fs(10), color: colors.subtle }}>
                  min {fmt(s.min)} {def.unit}
                </T>
                <T style={{ fontFamily: fonts.mono, fontSize: fs(10), color: colors.subtle }}>
                  max {fmt(s.max)} {def.unit}
                </T>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
