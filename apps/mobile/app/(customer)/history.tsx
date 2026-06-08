import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, Divider, EmptyState, Loading, Screen, Segmented, T } from '../../src/components/ui';
import { Sparkline } from '../../src/components/Charts';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { useT, type TranslationKey } from '../../src/i18n';
import { useScale } from '../../src/theme/scale';
import { colors, fonts, radius, spacing } from '../../src/theme/tokens';
import type { TelemetryAgg, TelemetryBucket, ZoneWithCrop } from '@teranode/types';

// ---------------------------------------------------------------------------
// History — live telemetry rollups from api.telemetry(zoneId, "1h"|"1d") with a
// zone + range picker. One sparkline per sensor channel the device reports,
// showing the bucket-average trace plus the min/max range over the window.
//
// Account-isolation + dynamic data:
//   • Zones come from api.farms() → api.zones(farmId) for the SIGNED-IN account.
//   • Channels are NOT hardcoded: we group the live buckets by their channelId
//     and derive a label/unit/color per channel. The live API returns opaque
//     channelId UUIDs (no type), so we resolve a friendly name when the id
//     carries a recognizable "..._<type>" suffix and otherwise fall back to a
//     stable "Channel N" — never an invented/sample series.
//   • The last good snapshot is cached under a PER-ACCOUNT key so one farmer can
//     never see another account's cached history on a cold start.
// ---------------------------------------------------------------------------

const RANGES: TelemetryAgg[] = ['1h', '1d'];
const RANGE_LABELS: Record<TelemetryAgg, string> = { raw: 'RAW', '5m': '5M', '1h': '1H', '1d': '1D' };

/** Display meta for the channel types we know how to name/color/unit-ize. */
interface ChannelMeta {
  tx: TranslationKey;
  color: string;
  unit: string;
  /** moisture is shown as a whole number; the rest keep two decimals. */
  decimals: 0 | 2;
}

const CHANNEL_META: Record<string, ChannelMeta> = {
  moisture: { tx: 'zone.moisture', color: colors.watering, unit: '%', decimals: 0 },
  ph: { tx: 'zone.ph', color: colors.accent, unit: 'pH', decimals: 2 },
  ec: { tx: 'zone.ec', color: colors.primary, unit: 'mS/cm', decimals: 2 },
  soiltemp: { tx: 'zone.soilTemp', color: colors.dry, unit: '°C', decimals: 2 },
  n: { tx: 'zone.nitrogen', color: colors.healthy, unit: 'mg/kg', decimals: 0 },
  p: { tx: 'zone.phosphorus', color: colors.healthy, unit: 'mg/kg', decimals: 0 },
  k: { tx: 'zone.potassium', color: colors.healthy, unit: 'mg/kg', decimals: 0 },
};

/**
 * Best-effort channel-type key from an opaque channelId. The mock + provisioning
 * encode the type as a trailing token (e.g. `chan_<zone>_moisture`); live UUIDs
 * carry no type so this returns null and the channel is labeled generically.
 */
function channelTypeFromId(channelId: string): string | null {
  const last = channelId.split(/[_:-]/).pop()?.toLowerCase() ?? '';
  if (last === 'soiltemp' || last === 'soil') return 'soiltemp';
  return CHANNEL_META[last] ? last : null;
}

/** One charted channel: its raw id, resolved meta, and the avg/min/max series. */
interface ChannelSeries {
  channelId: string;
  type: string | null;
  avg: number[];
  min: number;
  max: number;
  last: number;
}

/** Everything the screen renders for one (zone, range) — cached per-account. */
interface HistoryData {
  farmId: string | null;
  zones: ZoneWithCrop[];
  /** Buckets for the currently-selected zone+range. */
  buckets: TelemetryBucket[];
}

const EMPTY: HistoryData = { farmId: null, zones: [], buckets: [] };

export default function History() {
  const { session } = useAuth();
  const { t, lang } = useT();
  const { fs, sp, touch } = useScale();

  // Per-account cache key — NEVER global, so one farmer can never see another
  // account's cached telemetry on a cold start.
  const cacheKey = `teranode.history.${session?.account.id ?? 'anon'}`;

  const [data, setData] = useState<HistoryData>(EMPTY);
  const [zoneId, setZoneId] = useState<string>('');
  const [agg, setAgg] = useState<TelemetryAgg>('1h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hydrated = useRef(false);

  const { farmId, zones, buckets } = data;

  // Load the signed-in customer's zones + the selected zone's rollups. The
  // zone/range are passed in so an interval poll always reads the latest pick.
  const load = useCallback(
    async (selZone: string, selAgg: TelemetryAgg): Promise<void> => {
      setError(false);
      try {
        const farms = await api.farms();
        const farm = farms[0] ?? null;
        if (!farm) {
          const next = EMPTY;
          setData(next);
          await AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
          return;
        }
        const zs = await api.zones(farm.id);
        // Resolve the active zone: keep the current pick if still valid, else first.
        const activeId = selZone && zs.some((z) => z.id === selZone) ? selZone : (zs[0]?.id ?? '');
        const tel = activeId ? await api.telemetry(activeId, selAgg) : null;
        const next: HistoryData = { farmId: farm.id, zones: zs, buckets: tel?.buckets ?? [] };
        setData(next);
        if (activeId !== selZone) setZoneId(activeId);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(next)).catch(() => {});
      } catch {
        // Network/offline: fall back to this account's cached snapshot if present,
        // otherwise surface a retryable error.
        let restored = false;
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) {
            const cached = JSON.parse(raw) as HistoryData;
            setData(cached);
            if (!zoneId && cached.zones[0]) setZoneId(cached.zones[0].id);
            restored = true;
          }
        } catch {
          /* ignore */
        }
        if (!restored) setError(true);
      } finally {
        hydrated.current = true;
        setLoading(false);
      }
    },
    [cacheKey, zoneId]
  );

  // Reset to a clean slate whenever the account changes so stale account data
  // never flashes before the new account's data loads.
  useEffect(() => {
    hydrated.current = false;
    setData(EMPTY);
    setZoneId('');
    setLoading(true);
    setError(false);
    void load('', agg);
    // Re-run only on account change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Refresh on selection change + on a gentle interval (the gateway is live).
  useEffect(() => {
    if (!hydrated.current) return;
    void load(zoneId, agg);
    const id = setInterval(() => void load(zoneId, agg), 5000);
    return () => clearInterval(id);
  }, [zoneId, agg, load]);

  const onRetry = useCallback(() => {
    setLoading(true);
    void load(zoneId, agg);
  }, [load, zoneId, agg]);

  const activeZone = zones.find((z) => z.id === zoneId);
  const cropLabel = activeZone?.crop
    ? `${activeZone.crop.emoji} ${lang === 'ne' ? activeZone.crop.nameNe : activeZone.crop.nameEn}`
    : '';

  // Group the live buckets by channelId — the channels are whatever the device
  // actually reports, in stable id order. No hardcoded channel list.
  const series = useMemo<ChannelSeries[]>(() => {
    const byChannel = new Map<string, TelemetryBucket[]>();
    for (const b of buckets) {
      const arr = byChannel.get(b.channelId);
      if (arr) arr.push(b);
      else byChannel.set(b.channelId, [b]);
    }
    const out: ChannelSeries[] = [];
    for (const [channelId, rows] of byChannel) {
      rows.sort((a, b) => a.bucket.localeCompare(b.bucket));
      if (!rows.length) continue;
      out.push({
        channelId,
        type: channelTypeFromId(channelId),
        avg: rows.map((r) => r.avg),
        min: Math.min(...rows.map((r) => r.min)),
        max: Math.max(...rows.map((r) => r.max)),
        last: rows[rows.length - 1].avg,
      });
    }
    // Stable order: named channels first (by their canonical order), then the rest.
    const order = ['moisture', 'ph', 'ec', 'n', 'p', 'k', 'soiltemp'];
    return out.sort((a, b) => {
      const ai = a.type ? order.indexOf(a.type) : 99;
      const bi = b.type ? order.indexOf(b.type) : 99;
      if (ai !== bi) return ai - bi;
      return a.channelId.localeCompare(b.channelId);
    });
  }, [buckets]);

  // -- branch: loading (first paint, nothing cached) ------------------------
  if (loading && !hydrated.current) {
    return (
      <Screen>
        <T variant="display" tx="history.title" accessibilityRole="header" />
        <Loading />
      </Screen>
    );
  }

  // -- branch: error (network failed, no cache to fall back to) -------------
  if (error) {
    return (
      <Screen>
        <T variant="display" tx="history.title" accessibilityRole="header" />
        <Card style={{ gap: sp(spacing.md), alignItems: 'center' }} accessible accessibilityRole="alert">
          {/* Red-coded icon badge so the "needs attention" status reads at a
           * glance even before the text is parsed (icon + colour coding). */}
          <View
            style={{
              width: sp(56),
              height: sp(56),
              borderRadius: sp(28),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.criticalSoft,
            }}
          >
            <T style={{ fontSize: fs(28), lineHeight: fs(34) }}>⚠️</T>
          </View>
          <T variant="body" tx="history.error" style={{ textAlign: 'center', color: colors.inkSoft }} />
          <Button tx="common.retry" onPress={onRetry} />
        </Card>
      </Screen>
    );
  }

  // -- branch: no farm/zones set up for this account ------------------------
  if (!farmId || zones.length === 0) {
    return (
      <Screen>
        <T variant="display" tx="history.title" accessibilityRole="header" />
        <EmptyState icon="🌱" tx="history.noFarm" />
      </Screen>
    );
  }

  // Sparkline width = viewport minus the Screen's (scaled) horizontal padding
  // and the Card's (fixed) horizontal padding, so every chart spans the card
  // edge-to-edge at any device size / field-mode scale instead of a fixed 300.
  const chartW = Math.max(
    160,
    Math.round(Dimensions.get('window').width - sp(spacing.lg) * 2 - spacing.lg * 2)
  );

  return (
    <Screen>
      {/* -- header: title + one-line subtitle, tightly grouped ------------- */}
      <View style={{ gap: sp(spacing.xs) }}>
        <T variant="display" tx="history.title" accessibilityRole="header" />
        <T variant="muted" tx="history.subtitle" />
      </View>

      {/* -- zone picker ----------------------------------------------------
       * A real radio group: one big tap target per zone (≥44px via `touch`),
       * selected state announced to screen readers, and an active chip that
       * reads with strong contrast (filled tint + brand ink). A labelled
       * group mirrors the range picker below for a consistent hierarchy.
       * NOTE: the "Zone" group label uses a new i18n key `history.zone`
       * (listed in the summary) — until it lands the group stays label-less. */}
      <View style={{ gap: sp(spacing.xs) }}>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(spacing.sm) }}
          accessibilityRole="radiogroup"
        >
          {zones.map((z) => {
            const active = z.id === zoneId;
            const zLabel = `${z.crop ? `${z.crop.emoji} ` : ''}${z.name}`;
            return (
              <Pressable
                key={z.id}
                onPress={() => setZoneId(z.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={zLabel}
                style={({ pressed }) => ({
                  minHeight: touch,
                  justifyContent: 'center',
                  paddingHorizontal: sp(spacing.md),
                  paddingVertical: sp(spacing.sm),
                  borderRadius: radius.pill,
                  borderWidth: 1.5,
                  // Active = brand outline; pressed (inactive) = focus ring so
                  // the tap reads instantly in bright light.
                  borderColor: active
                    ? colors.primary
                    : pressed
                      ? colors.focus
                      : colors.border,
                  backgroundColor: active
                    ? colors.primarySoft
                    : pressed
                      ? colors.bgWarm
                      : colors.surface,
                  transform: [{ scale: pressed && !active ? 0.98 : 1 }],
                })}
              >
                <T
                  style={{
                    fontFamily: active ? fonts.uiSemibold : fonts.uiMedium,
                    fontSize: fs(13),
                    color: active ? colors.primaryInk : colors.inkSoft,
                  }}
                >
                  {zLabel}
                </T>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* -- range picker -------------------------------------------------- */}
      <View style={{ gap: sp(spacing.xs) }}>
        <T variant="label" tx="history.range" />
        <Segmented options={RANGES} value={agg} onChange={setAgg} labels={RANGE_LABELS} />
      </View>

      {/* -- active crop context chip, aligned with the pickers above ------- */}
      {cropLabel ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: sp(spacing.xs),
            paddingHorizontal: sp(spacing.md),
            paddingVertical: sp(spacing.xs),
            borderRadius: radius.pill,
            backgroundColor: colors.primarySoft,
          }}
        >
          <T style={{ fontFamily: fonts.uiMedium, fontSize: fs(12), color: colors.primaryInk }}>
            {cropLabel}
          </T>
        </View>
      ) : null}

      {/* -- one sparkline card per reported channel ----------------------- */}
      {series.length === 0 ? (
        <EmptyState icon="📈" tx="history.empty" />
      ) : (
        series.map((s, i) => {
          const meta = s.type ? CHANNEL_META[s.type] : undefined;
          const color = meta?.color ?? colors.muted;
          const unit = meta?.unit ?? '';
          const name = meta ? t(meta.tx) : `${t('history.channel')} ${i + 1}`;
          const fmt = (v: number) =>
            meta?.decimals === 0 ? Math.round(v) : Math.round(v * 100) / 100;
          const unitSuffix = unit ? ` ${unit}` : '';
          // Sparklines are invisible to screen readers, so summarise the whole
          // card (channel · latest · min/max range) as one spoken sentence.
          const a11y = `${name}: ${fmt(s.last)}${unitSuffix}. min ${fmt(s.min)}${unitSuffix}, max ${fmt(s.max)}${unitSuffix}.`;
          return (
            <Card key={s.channelId} accessible accessibilityLabel={a11y}>
              {/* header row: colour dot + name + latest value --------------
               * Plain h3 (not CardTitle) so the title stays vertically
               * centred in the row instead of carrying CardTitle's built-in
               * bottom margin, which mis-aligned it against the dot/value. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(spacing.sm), marginBottom: sp(spacing.md) }}>
                <View
                  style={{
                    width: sp(10),
                    height: sp(10),
                    borderRadius: sp(5),
                    backgroundColor: color,
                  }}
                />
                <T variant="h3" tx={meta?.tx} accessibilityRole="header">
                  {meta ? undefined : name}
                </T>
                <View style={{ flex: 1 }} />
                {/* latest value, baseline-aligned with its unit ------------- */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: sp(2) }}>
                  <T style={{ fontFamily: fonts.mono, fontSize: fs(20), color, fontVariant: ['tabular-nums'] }}>
                    {fmt(s.last)}
                  </T>
                  {unit ? (
                    <T style={{ fontFamily: fonts.mono, fontSize: fs(12), color: colors.subtle }}>{unit}</T>
                  ) : null}
                </View>
              </View>

              <Sparkline values={s.avg} width={chartW} height={sp(72)} color={color} />

              {/* hairline separates the live trace from its range footer --- */}
              <Divider style={{ marginTop: sp(spacing.sm) }} />

              {/* min / max range footer -----------------------------------
               * "min/max" reads as a quiet caption while the value carries
               * stronger ink, so the number is what the eye lands on. Arrow
               * glyphs add a non-colour cue for the low/high ends. The whole
               * range is already spoken via the Card's a11y label above. */}
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: sp(spacing.sm) }}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: colors.subtle, fontVariant: ['tabular-nums'] }}>
                  {'↓ min '}
                  <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: colors.muted, fontVariant: ['tabular-nums'] }}>
                    {`${fmt(s.min)}${unitSuffix}`}
                  </T>
                </T>
                <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: colors.subtle, fontVariant: ['tabular-nums'] }}>
                  {'↑ max '}
                  <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: colors.muted, fontVariant: ['tabular-nums'] }}>
                    {`${fmt(s.max)}${unitSuffix}`}
                  </T>
                </T>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
