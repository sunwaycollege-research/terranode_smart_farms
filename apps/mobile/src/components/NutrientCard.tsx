// TERANODE — Soil nutrients card.
//
// A farmer-first "what does my soil need" card. It reads N, P, K (mg/kg) plus
// pH and EC (mS/cm) straight off a zone's analysis readings (ChannelReadings,
// engine channel keys) and renders, per nutrient:
//   • an icon + plain name,
//   • the measured value with its unit (or "—" when the probe hasn't reported),
//   • a LOW / OK / HIGH chip, colour-coded green / amber / red, and
//   • ONE short plain-language hint (no agronomy jargon), bilingual.
//
// Design: dead-simple, big touch-free rows, icon + colour + one sentence — built
// for low-literacy smallholder farmers. Uses the shared parchment Card/Pill/T
// primitives and the field-mode scale, so it grows in large-touch mode.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ChannelReadings } from '@teranode/types';
import { colors, fonts, radius, spacing } from '../theme/tokens';
import { useScale } from '../theme/scale';
import { useT, type TranslationKey } from '../i18n';
import { Card, CardTitle, EmptyState, T } from './ui';

/* ---------------------------------------------------------------------------
 * GENERIC AGRONOMIC BANDS (crop/stage-agnostic).
 *
 * TODO(agronomy): these are placeholder whole-soil bands used until the cloud
 * agronomy engine returns per crop + growth-stage thresholds. Once the engine
 * exposes channel `idealRange`s for nutrients, swap `band(...)` to read those
 * (analysis.channels[].idealRange) instead of these constants.
 *   N  ~ 50–150 mg/kg · P ~ 25–50 mg/kg · K ~ 120–280 mg/kg
 *   pH 6.0–7.0 · EC 1.0–2.5 mS/cm
 * ------------------------------------------------------------------------- */
type NutrientKey = 'n' | 'p' | 'k' | 'ph' | 'ec';
type Level = 'low' | 'ok' | 'high';

const BANDS: Record<NutrientKey, [number, number]> = {
  n: [50, 150],
  p: [25, 50],
  k: [120, 280],
  ph: [6.0, 7.0],
  ec: [1.0, 2.5],
};

/** Where a value sits relative to its generic band. */
function band(key: NutrientKey, v: number): Level {
  const [lo, hi] = BANDS[key];
  if (v < lo) return 'low';
  if (v > hi) return 'high';
  return 'ok';
}

/** green = good · amber = watch · red = act now. */
const LEVEL_COLOR: Record<Level, string> = {
  low: colors.critical,
  ok: colors.healthy,
  high: colors.warn,
};
const LEVEL_LABEL: Record<Level, TranslationKey> = {
  low: 'nutrient.low',
  ok: 'nutrient.ok',
  high: 'nutrient.high',
};

/* Per-nutrient presentation: icon, name + hint i18n keys, unit + decimals. */
interface NutrientMeta {
  key: NutrientKey;
  icon: string;
  nameKey: TranslationKey;
  unitKey?: TranslationKey;
  decimals: number;
  /** hint key per level (e.g. nutrient.n.low). */
  hint: Record<Level, TranslationKey>;
}

const NUTRIENTS: NutrientMeta[] = [
  {
    key: 'n',
    icon: '🌿',
    nameKey: 'zone.nitrogen',
    unitKey: 'nutrient.unit.npk',
    decimals: 0,
    hint: { low: 'nutrient.n.low', ok: 'nutrient.n.ok', high: 'nutrient.n.high' },
  },
  {
    key: 'p',
    icon: '🌸',
    nameKey: 'zone.phosphorus',
    unitKey: 'nutrient.unit.npk',
    decimals: 0,
    hint: { low: 'nutrient.p.low', ok: 'nutrient.p.ok', high: 'nutrient.p.high' },
  },
  {
    key: 'k',
    icon: '🍅',
    nameKey: 'zone.potassium',
    unitKey: 'nutrient.unit.npk',
    decimals: 0,
    hint: { low: 'nutrient.k.low', ok: 'nutrient.k.ok', high: 'nutrient.k.high' },
  },
  {
    key: 'ph',
    icon: '⚗️',
    nameKey: 'zone.ph',
    decimals: 1,
    hint: { low: 'nutrient.ph.low', ok: 'nutrient.ph.ok', high: 'nutrient.ph.high' },
  },
  {
    key: 'ec',
    icon: '🧂',
    nameKey: 'zone.ec',
    unitKey: 'nutrient.unit.ec',
    decimals: 1,
    hint: { low: 'nutrient.ec.low', ok: 'nutrient.ec.ok', high: 'nutrient.ec.high' },
  },
];

/* ---------- a single nutrient row ---------- */
function NutrientRow({ meta, value }: { meta: NutrientMeta; value: number | undefined }) {
  const { t } = useT();
  const { fs, sp } = useScale();
  const has = value != null && Number.isFinite(value);
  const level = has ? band(meta.key, value as number) : null;
  const color = level ? LEVEL_COLOR[level] : colors.offline;
  const unit = meta.unitKey ? t(meta.unitKey) : '';
  const valueText = has ? `${(value as number).toFixed(meta.decimals)}${unit ? ` ${unit}` : ''}` : '—';
  const levelText = level ? t(LEVEL_LABEL[level]) : '—';

  return (
    <View
      style={[s.row, { minHeight: sp(48), borderLeftWidth: 3, borderLeftColor: has ? color : colors.borderSoft, paddingLeft: spacing.sm }]}
      accessibilityRole="text"
      accessibilityLabel={`${t(meta.nameKey)}, ${valueText}, ${levelText}`}
    >
      <T style={{ fontSize: fs(20), width: fs(26), textAlign: 'center' }} accessibilityElementsHidden importantForAccessibility="no">{meta.icon}</T>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.rowTop}>
          <T variant="label" style={{ color: colors.ink, fontFamily: fonts.uiSemibold }}>
            {t(meta.nameKey)}
          </T>
          <T style={{ fontFamily: fonts.mono, fontSize: fs(14), color: colors.ink, fontVariant: ['tabular-nums'] }}>
            {valueText}
          </T>
        </View>
        <T variant="muted" style={{ lineHeight: fs(18) }}>
          {level ? t(meta.hint[level]) : '—'}
        </T>
      </View>
      {/* status chip: LOW / OK / HIGH, colour-coded green=good / amber=watch / red=act */}
      <View style={[s.chip, { backgroundColor: has ? color : colors.surface2, borderColor: has ? color : colors.border }]}>
        <T style={{ fontFamily: fonts.uiBold, fontSize: fs(11), color: has ? '#fff' : colors.muted, letterSpacing: 0.3 }}>
          {levelText}
        </T>
      </View>
    </View>
  );
}

/* ---------- the card ---------- */
export function NutrientCard({ readings }: { readings: ChannelReadings | undefined }) {
  const r = readings ?? {};
  // We have something to show only if at least one nutrient channel reported.
  const hasAny = NUTRIENTS.some((m) => r[m.key] != null && Number.isFinite(r[m.key] as number));

  return (
    <Card style={{ gap: spacing.sm }}>
      <CardTitle tx="nutrient.title" />
      {hasAny ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="muted" tx="nutrient.subtitle" />
          {NUTRIENTS.map((m) => (
            <NutrientRow key={m.key} meta={m} value={r[m.key]} />
          ))}
          {/* The 7-in-1 probe derives N/P/K from EC — a coarse trend, not a lab test. */}
          <T variant="muted" tx="nutrient.approx" style={{ fontSize: 11, marginTop: 2 }} />
        </View>
      ) : (
        <EmptyState icon="🧪" tx="nutrient.empty" />
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 44,
    alignItems: 'center',
  },
});
