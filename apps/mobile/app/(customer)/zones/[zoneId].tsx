// TERANODE — Zone detail (inspector + valve control + coach).
//
// Driven entirely by the api.* seam (cutover-safe), scoped to the signed-in
// customer by the server (api.zone / api.zoneAnalysis / api.rules all 404 / scope
// to the caller's account — no other customer's data is ever reachable):
//   • api.zone(id)               → the ZoneWithCrop (name, crop, mode, farmId)
//   • api.zoneAnalysis(id, lang)  → stage, per-channel status + idealRange,
//                                   readings, recommendations (localized)
//   • api.rules(id)               → the active moisture target band (Rule)
//   • api.actuators(farmId)       → the zone's valve (reported + desired)
//   • api.setZoneMode / api.setValve → control, with desired-vs-reported pending
//
// States: a real fetch can be slow, fail, or return nothing for a brand-new
// account, so this screen shows distinct LOADING (spinner), ERROR (+ Retry) and
// NOT-FOUND screens before it ever renders an inspector. NOTHING here is a
// hardcoded sample — every reading/serial/target comes from api.* or shows "—".

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import type {
  Actuator,
  BandStatus,
  Channel,
  ChannelStatus,
  Recommendation,
  Rule,
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { Button, Card, CardTitle, Divider, EmptyState, Loading, Pill, Screen, Segmented, T } from '../../../src/components/ui';
import { GaugeRing } from '../../../src/components/GaugeRing';
import { BarMeter } from '../../../src/components/BarMeter';
import { StageBadge } from '../../../src/components/FieldTiles';
import { NutrientCard } from '../../../src/components/NutrientCard';
import { FertilizerCard } from '../../../src/components/FertilizerCard';
import { api } from '../../../src/api/client';
import { useT, type TranslationKey } from '../../../src/i18n';
import { useScale } from '../../../src/theme/scale';
import { colors, spacing } from '../../../src/theme/tokens';

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

/* Coach severity → localized label + signal colour (act=red, watch=amber,
 * info=blue) so the recommendation chip reads in Nepali and carries the same
 * icon+colour signal used across the app. */
const SEVERITY_KEY: Record<Recommendation['severity'], TranslationKey> = {
  critical: 'alerts.critical',
  warn: 'alerts.warn',
  info: 'alerts.info',
};
function severityColor(sev: Recommendation['severity']): string {
  if (sev === 'critical') return colors.critical;
  if (sev === 'warn') return colors.warn;
  return colors.watering;
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

/** A header that works on every state screen (back button + zone title). */
function DetailHeader({ title }: { title: string }) {
  const { fs, sp } = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.md) }}>
      <Button variant="ghost" small tx="common.back" onPress={() => router.back()} />
      <T
        variant="display"
        numberOfLines={1}
        accessibilityRole="header"
        style={{ fontSize: fs(24), flex: 1 }}
      >
        {title}
      </T>
    </View>
  );
}

type Phase = 'loading' | 'ready' | 'error' | 'notfound' | 'needsCrop';

export default function ZoneDetail() {
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const id = String(zoneId);
  const { t, lang } = useT();
  const { fs, sp, lh } = useScale();

  const [phase, setPhase] = useState<Phase>('loading');
  const [zone, setZone] = useState<ZoneWithCrop | null>(null);
  const [analysis, setAnalysis] = useState<ZoneAnalysisResponse | null>(null);
  const [rule, setRule] = useState<Rule | null>(null);
  const [valve, setValve] = useState<Actuator | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  // `pull` re-fetches live state. `initial` distinguishes the very first load
  // (which drives the loading/error/not-found phase) from the silent 2s refresh
  // (which keeps the last-good UI on a transient failure).
  const pull = useCallback(
    async (initial = false): Promise<void> => {
      if (initial) setPhase('loading');
      try {
        // The zone itself is the source of truth for farmId + crop + mode; the
        // server scopes it to the signed-in account and 404s anything else.
        const z = await api.zone(id);
        setZone(z);
        // A freshly-created zone has no crop yet → analysis returns 409. That's
        // not an error: invite the farmer to assign a crop (don't block the zone).
        let a: ZoneAnalysisResponse;
        try {
          a = await api.zoneAnalysis(id, lang);
        } catch (ae) {
          const m = ae instanceof Error ? ae.message : '';
          if (/\b409\b/.test(m) || /no crop/i.test(m)) {
            if (initial) setPhase('needsCrop');
            return;
          }
          throw ae;
        }
        const [r, acts] = await Promise.all([
          api.rules(id).catch(() => null),
          api.actuators(z.farmId).catch(() => [] as Actuator[]),
        ]);
        const v = acts.find((x) => x.type === 'valve' && x.zoneId === id) ?? null;
        setAnalysis(a);
        setRule(r);
        setValve(v);
        // clear the optimistic pending flag once the device confirms.
        if (v && v.desired == null) setPending(false);
        setPhase('ready');
      } catch (e) {
        if (initial) {
          // A 404 means this zone doesn't exist / isn't ours → not-found, not an
          // error the user can retry away.
          const msg = e instanceof Error ? e.message : '';
          setPhase(/\b404\b/.test(msg) ? 'notfound' : 'error');
        }
        // non-initial: keep last good state; the interval will retry.
      }
    },
    [id, lang]
  );

  useEffect(() => {
    void pull(true);
    const t2 = setInterval(() => void pull(false), 2000);
    return () => clearInterval(t2);
  }, [pull]);

  const setMode = useCallback(
    async (mode: 'auto' | 'manual') => {
      if (!zone) return;
      setZone({ ...zone, mode });
      try {
        await api.setZoneMode(id, mode);
      } finally {
        await pull(false);
      }
    },
    [id, zone, pull]
  );

  const toggleValve = useCallback(async () => {
    if (busy.current || !valve) return;
    busy.current = true;
    setPending(true);
    const open = !valve.state;
    // optimistic desired state while the device confirms.
    setValve({ ...valve, desired: open });
    try {
      const res = await api.setValve(id, open);
      setValve(res.actuator);
      if (!res.pending) setPending(false);
    } finally {
      busy.current = false;
      setTimeout(() => void pull(false), 800);
    }
  }, [id, valve, pull]);

  /* ---------- LOADING ---------- */
  if (phase === 'loading') {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailHeader title={t('common.loading')} />
        {/* shared, centred spinner + caption so the load state matches every screen */}
        <Card>
          <Loading />
        </Card>
      </Screen>
    );
  }

  /* ---------- NOT FOUND ---------- */
  if (phase === 'notfound') {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailHeader title="—" />
        <Card style={{ gap: sp(spacing.md) }}>
          <EmptyState icon="🔍" tx="zone.notFound" />
          <Button tx="common.back" variant="ghost" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  /* ---------- NEEDS CROP (zone created, no crop assigned yet) ---------- */
  if (phase === 'needsCrop') {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailHeader title={zone?.name ?? t('common.loading')} />
        <Card style={{ gap: sp(spacing.md), alignItems: 'center', paddingVertical: sp(spacing.xl) }}>
          <T style={{ fontSize: fs(36) }} importantForAccessibility="no">
            🌱
          </T>
          <T variant="h3" tx="zone.needsCropTitle" style={{ textAlign: 'center' }} />
          <T
            variant="body"
            tx="zone.needsCropBody"
            style={{ textAlign: 'center', color: colors.muted, maxWidth: 300, lineHeight: lh(20) }}
          />
          <Button tx="zone.assignCrop" onPress={() => router.push(`/(customer)/zones/new?zoneId=${id}`)} />
          <Button tx="common.back" variant="ghost" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  /* ---------- ERROR ---------- */
  if (phase === 'error' || !analysis || !zone) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailHeader title="—" />
        <Card
          style={{ gap: sp(spacing.md), alignItems: 'center', paddingVertical: sp(spacing.xl) }}
          accessible
          accessibilityRole="alert"
        >
          <T style={{ fontSize: fs(32) }} accessibilityElementsHidden importantForAccessibility="no">
            ⚠️
          </T>
          <T variant="body" tx="zone.loadError" style={{ textAlign: 'center', color: colors.muted, maxWidth: 280 }} />
          <Button tx="common.retry" onPress={() => void pull(true)} />
        </Card>
      </Screen>
    );
  }

  /* ---------- READY ---------- */
  const crop = zone.crop;
  const cropLabel = crop ? (lang === 'ne' ? crop.nameNe : crop.nameEn) : '—';
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

  const mode = (zone.mode ?? 'auto') as 'auto' | 'manual';
  const reportedOpen = valve?.state ?? false;
  const desired = valve?.desired;
  const showPending = pending || (desired != null && desired !== reportedOpen);

  // target band comes from the live rule, falling back to the analysis echo.
  const targetLow = rule?.moistureLow ?? analysis.rule.moistureLow;
  const targetHigh = rule?.moistureHigh ?? analysis.rule.moistureHigh;

  const topRec: Recommendation | undefined = analysis.recommendations[0];
  const soilTemp = analysis.readings.soilTemp ?? null;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />

      {/* header */}
      <DetailHeader title={`${emoji} ${zone.name}`} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm), flexWrap: 'wrap' }}>
        <T variant="muted">{cropLabel}</T>
        <StageBadge stage={analysis.stage} />
        {totalDays > 0 && (
          <Pill label={t('zone.dayOf', { day: analysis.daysSincePlanting, total: totalDays })} color={colors.muted} />
        )}
        <Pill
          label={`${t('field.health')} ${analysis.health.score}`}
          dot
          color={
            analysis.health.score >= 80
              ? colors.healthy
              : analysis.health.score >= 50
                ? colors.warn
                : colors.critical
          }
        />
      </View>

      {/* gauge + bars */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.lg) }}>
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
        <Divider style={{ marginTop: sp(spacing.md), marginBottom: sp(spacing.sm) }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: sp(spacing.sm) }}>
          <T variant="muted" accessibilityLabel={`${t('zone.soilTemp')} ${fmt('soilTemp', soilTemp)}${soilTemp != null ? '°C' : ''}`}>
            🌡️ {t('zone.soilTemp')} {fmt('soilTemp', soilTemp)}{soilTemp != null ? '°C' : ''}
          </T>
          <T variant="muted" accessibilityLabel={`${t('zone.moisture')} ${t('zone.target')} ${targetLow} ${targetHigh} percent`}>
            {t('zone.target')}: {targetLow}–{targetHigh}%
          </T>
        </View>
      </Card>

      {/* per-channel status pills — green=in range / amber=below / blue=above */}
      <Card>
        <CardTitle>{t('zone.status')}</CardTitle>
        {pills.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(spacing.sm) }}>
            {pills.map((c) => (
              <Pill
                key={c.channel}
                label={`${CHANNEL_SHORT[c.channel]} ${t(STATUS_KEY[c.status])}`}
                dot
                color={statusColor(c.status)}
              />
            ))}
          </View>
        ) : (
          <EmptyState icon="📡" tx="alerts.none" />
        )}
      </Card>

      {/* soil nutrients (N/P/K + pH/EC, plain LOW/OK/HIGH guidance) */}
      <NutrientCard readings={analysis.readings} />

      {/* stage-aware fertilizer plan (research-backed dose + organic option) */}
      <FertilizerCard cropId={crop?.id ?? null} stage={analysis.stage} />

      {/* coach card — left accent + severity/channel chips + one plain sentence.
          A live recommendation gets a coloured rail matching its severity so the
          single most-important action stands out at a glance. */}
      <Card
        style={{
          gap: sp(spacing.sm),
          borderColor: topRec ? severityColor(topRec.severity) : colors.border,
          borderLeftWidth: 4,
          borderLeftColor: topRec ? severityColor(topRec.severity) : colors.border,
        }}
      >
        <CardTitle tx="zone.coach" />
        {topRec ? (
          <View style={{ gap: sp(spacing.sm) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm), flexWrap: 'wrap' }}>
              <Pill label={t(SEVERITY_KEY[topRec.severity])} dot color={severityColor(topRec.severity)} />
              <Pill label={CHANNEL_SHORT[topRec.channel]} color={colors.muted} />
            </View>
            <T variant="body" style={{ color: colors.ink }}>
              {lang === 'ne' ? topRec.messageNe : topRec.messageEn}
            </T>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm) }}>
            <Pill label={t('field.health')} dot color={colors.healthy} />
            <T variant="muted" tx="alerts.none" style={{ flex: 1 }} />
          </View>
        )}
      </Card>

      {/* valve control — Auto/Manual mode + the live OPEN/SHUT action. The pill
          always voices the device's *reported* state (or Pending) so the farmer
          sees what the gateway is actually doing, not just their request. */}
      <Card style={{ gap: sp(spacing.md) }}>
        <CardTitle tx="zone.valve" />
        {valve ? (
          <>
            <View style={{ gap: sp(spacing.xs) }}>
              <T variant="label" tx="zone.mode" />
              <Segmented
                options={['auto', 'manual']}
                value={mode}
                onChange={(m) => void setMode(m)}
                labels={{ auto: t('common.auto'), manual: t('common.manual') }}
              />
            </View>
            <Divider />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: sp(spacing.sm),
                flexWrap: 'wrap',
              }}
            >
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
                  label={
                    reportedOpen
                      ? `${t('zone.valve')}: ${t('common.open').toUpperCase()}`
                      : `${t('zone.valve')}: ${t('common.off')}`
                  }
                  color={reportedOpen ? colors.primary : colors.muted}
                  dot
                />
              )}
            </View>
            <T variant="muted" tx="zone.valveHint" style={{ lineHeight: lh(12) }} />
          </>
        ) : (
          <EmptyState icon="🚰" tx="zone.noValve" />
        )}
      </Card>
    </Screen>
  );
}
