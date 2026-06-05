// TERANODE — Zone detail (inspector + valve control + coach).
//
// Driven entirely by the api.* seam (cutover-safe):
//   • api.zones(farmId) / api.zone(id) → the ZoneWithCrop (name, crop, mode)
//   • api.zoneAnalysis(id, lang)       → stage, per-channel status + idealRange,
//                                        readings, recommendations (localized)
//   • api.actuators()                  → the zone's valve (reported + desired)
//   • api.setZoneMode / api.setValve   → control, with desired-vs-reported pending
//
// Layout:
//   • GaugeRing for moisture (tinted against the crop's stage band)
//   • BarMeters for pH / EC / N / P / K with stage-aware target ticks + the
//     acceptable band shaded (taken from analysis.channels[].idealRange)
//   • per-channel below / in / above colored pills
//   • a valve Auto/Manual segmented control + open/close that shows the device's
//     reported state, not just the request
//   • a Coach card with the top recommendation (en/ne via useT)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type {
  Actuator,
  BandStatus,
  Channel,
  ChannelStatus,
  Recommendation,
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { Button, Card, CardTitle, Pill, Screen, Segmented, T } from '../../../src/components/ui';
import { GaugeRing } from '../../../src/components/GaugeRing';
import { BarMeter } from '../../../src/components/BarMeter';
import { StageBadge } from '../../../src/components/FieldTiles';
import { api } from '../../../src/api/client';
import { useT, type TranslationKey } from '../../../src/i18n';
import { colors, fonts, spacing } from '../../../src/theme/tokens';

/* ---------- channel presentation metadata ---------- */
const CHANNEL_LABEL: Partial<Record<Channel, TranslationKey>> = {
  moisture: 'zone.moisture',
  ph: 'zone.ph',
  ec: 'zone.ec',
  n: 'zone.nitrogen',
  p: 'zone.phosphorus',
  k: 'zone.potassium',
  soilTemp: 'zone.soilTemp',
  airTemp: 'zone.airTemp',
};
/** Short label drawn in the bar gutter. */
const CHANNEL_SHORT: Record<Channel, string> = {
  moisture: 'M',
  ph: 'pH',
  ec: 'EC',
  n: 'N',
  p: 'P',
  k: 'K',
  soilTemp: '🌡',
  airTemp: '☀',
};
const CHANNEL_COLOR: Record<Channel, string> = {
  moisture: colors.watering,
  ph: colors.accent,
  ec: colors.watering,
  n: colors.healthy,
  p: colors.healthy,
  k: colors.healthy,
  soilTemp: colors.dry,
  airTemp: colors.dry,
};
const STATUS_KEY: Record<BandStatus, TranslationKey> = {
  below: 'zone.below',
  in: 'zone.in',
  above: 'zone.above',
  unknown: 'zone.in',
};
function statusColor(status: BandStatus): string {
  if (status === 'below') return colors.dry;
  if (status === 'above') return colors.watering;
  if (status === 'in') return colors.healthy;
  return colors.muted;
}

/** Format a channel value for display (decimals where meaningful). */
function fmt(channel: Channel, v: number | null): string {
  if (v == null) return '—';
  if (channel === 'ph' || channel === 'ec') return v.toFixed(2);
  if (channel === 'soilTemp' || channel === 'airTemp') return v.toFixed(1);
  return String(Math.round(v));
}

/** Map a channel value onto a 0–100 bar axis derived from its acceptable band. */
function axisFor(c: ChannelStatus): { pct: number; tickPct: number; bandPct: [number, number] } {
  const [aLo, aHi] = c.acceptableRange;
  const [iLo, iHi] = c.idealRange;
  // pad the axis a little beyond the acceptable band so the bar never pins to 0/100.
  const span = Math.max(1e-6, aHi - aLo);
  const pad = span * 0.25;
  const lo = aLo - pad;
  const hi = aHi + pad;
  const toPct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const value = c.value ?? iLo;
  return {
    pct: toPct(value),
    tickPct: toPct((iLo + iHi) / 2), // stage-aware target = ideal midpoint
    bandPct: [toPct(iLo), toPct(iHi)],
  };
}

export default function ZoneDetail() {
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const id = String(zoneId);
  const { t, lang } = useT();

  const [zone, setZone] = useState<ZoneWithCrop | null>(null);
  const [analysis, setAnalysis] = useState<ZoneAnalysisResponse | null>(null);
  const [valve, setValve] = useState<Actuator | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const pull = useCallback(async (): Promise<void> => {
    try {
      const farms = await api.farms();
      let z: ZoneWithCrop | undefined;
      for (const f of farms) {
        const zs = await api.zones(f.id);
        z = zs.find((x) => x.id === id);
        if (z) break;
      }
      const [a, acts] = await Promise.all([api.zoneAnalysis(id, lang), api.actuators().catch(() => [] as Actuator[])]);
      const v = acts.find((x) => x.type === 'valve' && x.zoneId === id) ?? null;
      if (z) setZone(z);
      setAnalysis(a);
      setValve(v);
      // clear the optimistic pending flag once the device confirms (desired cleared).
      if (v && v.desired == null) setPending(false);
    } catch {
      /* keep last good state; the interval will retry */
    }
  }, [id, lang]);

  useEffect(() => {
    void pull();
    const t2 = setInterval(() => void pull(), 2000);
    return () => clearInterval(t2);
  }, [pull]);

  const setMode = useCallback(
    async (mode: 'auto' | 'manual') => {
      if (!zone) return;
      setZone({ ...zone, mode });
      try {
        await api.setZoneMode(id, mode);
      } finally {
        await pull();
      }
    },
    [id, zone, pull]
  );

  const toggleValve = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const open = !(valve?.state ?? false);
    // optimistic desired state while the device confirms.
    if (valve) setValve({ ...valve, desired: open });
    try {
      const res = await api.setValve(id, open);
      setValve(res.actuator);
    } finally {
      busy.current = false;
      setTimeout(() => void pull(), 800);
    }
  }, [id, valve, pull]);

  if (!analysis) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <T tx="common.loading" />
      </Screen>
    );
  }

  const crop = zone?.crop;
  const cropLabel = crop ? (lang === 'ne' ? crop.nameNe : crop.nameEn) : '';
  const emoji = crop?.emoji ?? '🌱';
  const totalDays = crop?.daysToHarvest ?? 0;

  const moisture = analysis.channels.find((c) => c.channel === 'moisture');
  const moistureVal = moisture?.value ?? analysis.readings.moisture ?? 0;
  const moistureColor =
    moisture?.status === 'below' ? colors.dry : moisture?.status === 'above' ? colors.watering : colors.healthy;

  // the bars we render in the inspector (skip moisture — shown as the gauge).
  const barChannels: Channel[] = ['ph', 'ec', 'n', 'p', 'k'];
  const bars = barChannels
    .map((ch) => analysis.channels.find((c) => c.channel === ch))
    .filter((c): c is ChannelStatus => c != null);

  // the pills row covers every evaluated channel.
  const pills = analysis.channels.filter((c) => c.status !== 'unknown');

  const mode = (zone?.mode ?? 'auto') as 'auto' | 'manual';
  const reportedOpen = valve?.state ?? false;
  const desired = valve?.desired;
  const showPending = pending || (desired != null && desired !== reportedOpen);

  const topRec: Recommendation | undefined = analysis.recommendations[0];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />

      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Button variant="ghost" small tx="common.back" onPress={() => router.back()} />
        <T variant="display" style={{ fontSize: 26, flex: 1 }}>
          {emoji} {zone?.name ?? ''}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <T variant="muted">{cropLabel}</T>
        <StageBadge stage={analysis.stage} />
        {totalDays > 0 && (
          <Pill label={t('zone.dayOf', { day: analysis.daysSincePlanting, total: totalDays })} color={colors.muted} />
        )}
        <Pill label={`${t('field.health')} ${analysis.health.score}`} dot color={
          analysis.health.score >= 80 ? colors.healthy : analysis.health.score >= 50 ? colors.dry : colors.critical
        } />
      </View>

      {/* gauge + bars */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <GaugeRing value={moistureVal} color={moistureColor} label={t('zone.moisture')} />
          <View style={{ flex: 1 }}>
            {bars.map((c) => {
              const ax = axisFor(c);
              return (
                <BarMeter
                  key={c.channel}
                  label={CHANNEL_SHORT[c.channel]}
                  value={fmt(c.channel, c.value)}
                  pct={ax.pct}
                  tickPct={ax.tickPct}
                  bandPct={ax.bandPct}
                  color={CHANNEL_COLOR[c.channel]}
                />
              );
            })}
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
          <T variant="muted">
            🌡️ {t('zone.soilTemp')} {fmt('soilTemp', analysis.readings.soilTemp ?? null)}°C
          </T>
          <T variant="muted">
            {t('zone.target')}: {analysis.rule.moistureLow}–{analysis.rule.moistureHigh}%
          </T>
        </View>
      </Card>

      {/* per-channel status pills */}
      <Card>
        <CardTitle>{t('zone.target')}</CardTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {pills.map((c) => (
            <View key={c.channel} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pill
                label={`${CHANNEL_SHORT[c.channel]} ${t(STATUS_KEY[c.status])}`}
                dot
                color={statusColor(c.status)}
              />
            </View>
          ))}
        </View>
      </Card>

      {/* coach card */}
      <Card style={{ gap: spacing.sm, borderColor: topRec ? colors.primary : colors.border }}>
        <CardTitle tx="zone.coach" />
        {topRec ? (
          <View style={{ gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pill
                label={topRec.severity.toUpperCase()}
                dot
                color={
                  topRec.severity === 'critical' ? colors.critical : topRec.severity === 'warn' ? colors.warn : colors.watering
                }
              />
              <Pill label={CHANNEL_SHORT[topRec.channel]} color={colors.muted} />
            </View>
            <T style={{ fontFamily: fonts.ui, color: colors.inkSoft, lineHeight: 21 }}>
              {lang === 'ne' ? topRec.messageNe : topRec.messageEn}
            </T>
          </View>
        ) : (
          <T variant="muted">{t('alerts.none')}</T>
        )}
      </Card>

      {/* valve control */}
      <Card style={{ gap: spacing.md }}>
        <CardTitle tx="zone.valve" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <T variant="label" style={{ marginBottom: 6 }} tx="zone.mode" />
            <Segmented
              options={['auto', 'manual']}
              value={mode}
              onChange={(m) => void setMode(m)}
              labels={{ auto: t('common.auto'), manual: t('common.manual') }}
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Button
            tx={reportedOpen ? 'common.close' : 'common.open'}
            variant={reportedOpen ? 'danger' : 'primary'}
            disabled={mode !== 'manual' || showPending}
            onPress={() => void toggleValve()}
          />
          {showPending ? (
            <Pill label={t('zone.pending')} color={colors.warn} dot />
          ) : (
            <Pill
              label={reportedOpen ? `${t('zone.valve')}: ${t('common.open').toUpperCase()}` : `${t('zone.valve')}: ${t('common.off')}`}
              color={reportedOpen ? colors.primary : colors.muted}
              dot
            />
          )}
        </View>
        <T variant="muted">
          The gateway runs the control loop locally. Switch to Manual to override — the app shows the device's reported
          state, not just your request.
        </T>
      </Card>
    </Screen>
  );
}
