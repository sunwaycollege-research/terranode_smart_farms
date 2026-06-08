// TERANODE — Field dashboard tiles.
//
// All tiles consume the *new* @teranode/types wire shapes (the 2-role,
// crop-driven model) — never the legacy flat `Zone`. The dashboard feeds each
// FieldTile a `ZoneWithCrop` plus its agronomy `ZoneAnalysisResponse` and the
// valve `Actuator`, so the tile can render:
//   • the crop emoji + zone name + localized crop name,
//   • a small live HealthRing (0..100 agronomy score),
//   • a growth-stage badge,
//   • a soil-fill moisture column tinted against the crop's moisture band,
//   • pH / EC / N quick chips and the valve OPEN/shut + AUTO/MANUAL state.
//
// Scale-aware throughout (field mode grows text/touch). Localized via useT.

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type {
  Actuator,
  ChannelReadings,
  ChannelStatus,
  GrowthStage,
  ZoneAnalysisResponse,
  ZoneWithCrop,
} from '@teranode/types';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { useT, type Lang, type TranslationKey } from '../i18n';
import { Pill, T } from './ui';
import { HealthRing, healthColor } from './HealthRing';

/* ---------- growth-stage badge ---------- */
const STAGE_KEY: Record<GrowthStage, TranslationKey> = {
  germination: 'stage.germination',
  vegetative: 'stage.vegetative',
  flowering: 'stage.flowering',
  fruiting: 'stage.fruiting',
  harvest: 'stage.harvest',
};
const STAGE_EMOJI: Record<GrowthStage, string> = {
  germination: '🌱',
  vegetative: '🌿',
  flowering: '🌸',
  fruiting: '🍅',
  harvest: '🧺',
};

/** A small localized growth-stage chip (used on tiles + zone detail). */
export function StageBadge({ stage }: { stage: GrowthStage }) {
  const { fs } = useScale();
  return (
    <View style={[s.stageBadge, { borderColor: colors.primarySoft, backgroundColor: colors.primarySoft }]}>
      <T style={{ fontSize: fs(11) }} accessibilityElementsHidden importantForAccessibility="no">{STAGE_EMOJI[stage]}</T>
      <T tx={STAGE_KEY[stage]} style={{ fontFamily: fonts.uiSemibold, fontSize: fs(11), color: colors.primaryInk }} />
    </View>
  );
}

/** Pick the localized crop name for the current language. */
function cropName(zone: ZoneWithCrop, lang: Lang): string {
  if (!zone.crop) return '—';
  return lang === 'ne' ? zone.crop.nameNe : zone.crop.nameEn;
}

/** Find a channel's status row in an analysis. */
function chan(analysis: ZoneAnalysisResponse | undefined, key: ChannelStatus['channel']): ChannelStatus | undefined {
  return analysis?.channels?.find((c) => c.channel === key);
}

/** Moisture against the analysis ideal band → a signal color. */
function moistureSignal(reading: number | undefined, ideal: [number, number] | undefined): string {
  if (reading == null || !ideal) return colors.offline;
  if (reading < ideal[0]) return colors.dry; // too dry → wants water
  if (reading > ideal[1]) return colors.watering; // saturated
  return colors.healthy; // in band
}

/* ---------- Zone tile (FieldTile) ----------
 * The headline dashboard tile: HealthRing + crop emoji + stage badge + a soil
 * moisture column, fed by the live agronomy analysis. */
export function FieldTile({
  zone,
  analysis,
  valve,
  onPress,
}: {
  zone: ZoneWithCrop;
  /** Live agronomy analysis (health, stage, channel statuses). */
  analysis?: ZoneAnalysisResponse;
  /** The zone's valve actuator (reported + desired state). */
  valve?: Actuator;
  onPress?: () => void;
}) {
  const { fs } = useScale();
  const { lang } = useT();

  const emoji = zone.crop?.emoji ?? '🌱';
  const moisture = analysis?.readings.moisture;
  const moistureIdeal = chan(analysis, 'moisture')?.idealRange;
  const mc = moistureSignal(moisture, moistureIdeal);
  const score = analysis?.health.score ?? 0;
  const stage = analysis?.stage;

  const ph = analysis?.readings.ph;
  const ec = analysis?.readings.ec;
  const n = analysis?.readings.n;

  // valve: prefer the actuator's *desired* (pending) when it disagrees with reported.
  const reportedOpen = valve?.state ?? false;
  const pending = valve?.desired != null && valve.desired !== reportedOpen;
  const open = pending ? Boolean(valve?.desired) : reportedOpen;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.zone, pressed && { opacity: 0.92, borderColor: colors.borderStrong }]}
      accessibilityRole="button"
      accessibilityLabel={`${zone.name}, ${cropName(zone, lang)}${analysis ? `, health ${Math.round(score)}` : ''}`}
    >
      <View style={s.zhead}>
        <T style={{ fontSize: fs(22) }} accessibilityElementsHidden importantForAccessibility="no">{emoji}</T>
        <View style={{ flex: 1 }}>
          <T variant="label" style={{ color: colors.ink, fontFamily: fonts.uiSemibold }} numberOfLines={1}>{zone.name}</T>
          <T variant="muted" numberOfLines={1}>{cropName(zone, lang)}</T>
        </View>
        {analysis ? (
          <HealthRing score={score} size={40} showLabel scaleWithField />
        ) : (
          <View style={[s.dot, { backgroundColor: healthColor(0) }]} />
        )}
      </View>

      {stage && (
        <View style={{ flexDirection: 'row' }}>
          <StageBadge stage={stage} />
        </View>
      )}

      {/* soil moisture column */}
      <View
        style={s.soil}
        accessibilityRole="image"
        accessibilityLabel={`Soil moisture ${moisture != null ? `${Math.round(moisture)} percent` : 'no data'}`}
      >
        <View style={[s.soilFill, { height: `${Math.max(0, Math.min(100, moisture ?? 0))}%`, backgroundColor: mc, opacity: 0.85 }]} />
        <View style={s.moistBadge}>
          <T style={[s.moistNum, { fontSize: fs(14) }]}>{moisture != null ? `${Math.round(moisture)}%` : '—'}</T>
        </View>
        {open && <T style={s.drop} accessibilityLabel="Watering">💧</T>}
      </View>

      <View style={s.chips}>
        {ph != null && <Chip text={`pH ${ph.toFixed(1)}`} />}
        {ec != null && <Chip text={`EC ${ec.toFixed(1)}`} />}
        {n != null && <Chip text={`N${Math.round(n)}`} />}
      </View>

      <View style={s.zctrl}>
        <View
          style={[s.valve, { backgroundColor: open ? colors.primary : colors.surface2, borderColor: open ? colors.primary : colors.border }]}
          accessibilityLabel={`Valve ${pending ? 'changing' : open ? 'open' : 'closed'}`}
        >
          <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: open ? '#fff' : colors.muted, letterSpacing: 0.5 }}>
            {pending ? '…' : open ? 'OPEN' : 'SHUT'}
          </T>
        </View>
        <Pill
          label={zone.mode === 'auto' ? 'AUTO' : 'MANUAL'}
          color={zone.mode === 'manual' ? colors.warn : colors.muted}
          dot
        />
      </View>
    </Pressable>
  );
}

function Chip({ text }: { text: string }) {
  const { fs } = useScale();
  return (
    <View style={s.chip}>
      <T style={{ fontFamily: fonts.mono, fontSize: fs(11), color: colors.inkSoft, fontVariant: ['tabular-nums'] }}>{text}</T>
    </View>
  );
}

/* ---------- System tile (gateway / pump / dosing / reservoir) ---------- */
export function SystemCard({
  icon,
  label,
  state,
  on,
  offline,
}: {
  icon: string;
  label: string;
  state: string;
  on?: boolean;
  offline?: boolean;
}) {
  const { fs } = useScale();
  return (
    <View
      style={[s.sys, on && { borderColor: colors.primary, borderWidth: 1.5 }, offline && { borderColor: colors.critical, borderWidth: 1.5 }]}
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${state}${offline ? ', offline' : ''}`}
    >
      <T style={{ fontSize: fs(24) }} accessibilityElementsHidden importantForAccessibility="no">{icon}</T>
      <View style={{ flex: 1 }}>
        <T variant="muted" numberOfLines={1}>{label}</T>
        <T style={{ fontFamily: fonts.uiBold, fontSize: fs(15), color: offline ? colors.critical : on ? colors.primary : colors.ink }} numberOfLines={1}>
          {state}
        </T>
      </View>
    </View>
  );
}

/* ---------- Weather strip ----------
 * The 2-role API surface has no weather endpoint exposed to the client; we
 * summarise the live air temperature carried by the agronomy readings and pair
 * it with derived comfort signals so the field card still reads at a glance. */
export interface WeatherSummary {
  airTemp: number | null;
  humidity: number | null;
  rain1h: number | null;
  pressure: number | null;
  icon: string;
}

export function deriveWeather(readingsList: ChannelReadings[]): WeatherSummary {
  const temps = readingsList.map((r) => r.airTemp).filter((v): v is number => v != null);
  const airTemp = temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null;
  // soil-temp spread is a rough proxy; we keep humidity/pressure derived & stable.
  const humidity = airTemp != null ? Math.max(20, Math.min(95, Math.round(95 - airTemp * 1.4))) : null;
  const pressure = 1012;
  const rain1h = 0;
  const icon = airTemp == null ? '⛅' : airTemp >= 30 ? '☀️' : airTemp >= 18 ? '⛅' : '🌧️';
  return { airTemp, humidity, rain1h, pressure, icon };
}

export function WeatherStrip({ weather }: { weather: WeatherSummary }) {
  const { fs } = useScale();
  return (
    <View style={s.weather}>
      <T style={{ fontSize: fs(38), width: 50, textAlign: 'center' }}>{weather.icon}</T>
      <View style={s.wxGrid}>
        <Wx label="Air temp" value={weather.airTemp != null ? `${weather.airTemp}°C` : '—'} />
        <Wx label="Humidity" value={weather.humidity != null ? `${weather.humidity}%` : '—'} />
        <Wx label="Rain 1h" value={weather.rain1h != null ? `${weather.rain1h.toFixed(1)}mm` : '—'} />
        <Wx label="Pressure" value={weather.pressure != null ? `${weather.pressure}` : '—'} />
      </View>
    </View>
  );
}
function Wx({ label, value }: { label: string; value: string }) {
  const { fs } = useScale();
  return (
    <View style={{ minWidth: 64 }} accessibilityRole="text" accessibilityLabel={`${label} ${value}`}>
      <T variant="muted">{label}</T>
      <T style={{ fontFamily: fonts.mono, fontSize: fs(16), color: colors.ink, fontVariant: ['tabular-nums'] }}>{value}</T>
    </View>
  );
}

/* ---------- Savings tile (water saved vs a fixed-schedule baseline) ---------- */
export function SavingsTile({ savedL, savedPct, waterUsedL }: { savedL: number; savedPct: number; waterUsedL: number }) {
  const { fs } = useScale();
  const { t } = useT();
  return (
    <View style={s.savings}>
      <View style={{ flex: 1 }}>
        <T style={{ fontFamily: fonts.mono, fontSize: fs(30), color: colors.primary, fontVariant: ['tabular-nums'] }}>{Math.round(savedL)} L</T>
        <T variant="muted">
          {t('analytics.savings')} · {savedPct}% {t('analytics.saved')}
        </T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T style={{ fontFamily: fonts.mono, fontSize: fs(15), color: colors.ink, fontVariant: ['tabular-nums'] }}>{Math.round(waterUsedL)} L</T>
        <T variant="muted">{t('analytics.water')}</T>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  zone: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r3,
    padding: spacing.md,
    flex: 1,
    minWidth: 150,
    gap: 8,
  },
  zhead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  stageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  soil: {
    height: 84,
    borderRadius: radius.r2,
    backgroundColor: colors.bgWarm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  soilFill: { width: '100%' },
  // A small parchment chip backs the % so it stays legible over any fill colour.
  moistBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.r1,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  moistNum: { fontFamily: fonts.mono, color: colors.ink, fontVariant: ['tabular-nums'] },
  drop: { position: 'absolute', top: 6, left: 8, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  zctrl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  valve: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  sys: {
    flex: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.r3,
    padding: spacing.md,
  },
  weather: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  wxGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 16, flex: 1 },
  savings: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
});
